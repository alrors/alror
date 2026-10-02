// Analytics used only by the Overview board. Pure, no I/O: safe on server and client.

import { DAY, isBad, median, restoreMs, summarize, type ServiceRow } from "./analytics";
import type { DeployEvent, Deployment, Level } from "./types";

export const HOUR = 3_600_000;

/* --------------------------------- Time range --------------------------------- */

export const OVERVIEW_RANGES = ["24h", "7d", "30d"] as const;
export type OverviewRange = (typeof OVERVIEW_RANGES)[number];

export const DEFAULT_RANGE: OverviewRange = "7d";

export function parseOverviewRange(v: string | string[] | undefined): OverviewRange {
  const s = Array.isArray(v) ? v[0] : v;
  return (OVERVIEW_RANGES as readonly string[]).includes(s ?? "") ? (s as OverviewRange) : DEFAULT_RANGE;
}

/** Bucket size and count per range: hourly for 24h, 6-hourly for 7d, daily for 30d. */
export const RANGE_SPEC: Record<OverviewRange, { bucket: number; buckets: number; days: number; label: string; prev: string }> = {
  "24h": { bucket: HOUR, buckets: 24, days: 1, label: "Last 24 hours", prev: "vs prior 24h" },
  "7d": { bucket: 6 * HOUR, buckets: 28, days: 7, label: "Last 7 days", prev: "vs prior 7d" },
  "30d": { bucket: DAY, buckets: 30, days: 30, label: "Last 30 days", prev: "vs prior 30d" },
};

export type Window = { start: number; end: number; prevStart: number; bucket: number; buckets: number };

/** The window ends at the close of the bucket holding `now` (UTC-aligned); the previous window is the same length before it. */
export function rangeWindow(range: OverviewRange, now: number): Window {
  const { bucket, buckets } = RANGE_SPEC[range];
  const end = Math.floor(now / bucket) * bucket + bucket;
  const start = end - buckets * bucket;
  return { start, end, prevStart: start - buckets * bucket, bucket, buckets };
}

const createdIn = (d: Deployment, from: number, to: number) => {
  const t = Date.parse(d.created_at);
  return t >= from && t < to;
};

export type PulseBucket = { start: number; deps: Deployment[]; promoted: number; bad: number; inFlight: number };

/** Releases per bucket by their outcome so far. */
export function pulse(deps: Deployment[], w: Window): PulseBucket[] {
  const out: PulseBucket[] = Array.from({ length: w.buckets }, (_, i) => ({ start: w.start + i * w.bucket, deps: [], promoted: 0, bad: 0, inFlight: 0 }));
  for (const d of deps) {
    const i = Math.floor((Date.parse(d.created_at) - w.start) / w.bucket);
    if (i < 0 || i >= w.buckets) continue;
    const b = out[i];
    b.deps.push(d);
    if (d.status === "promoted") b.promoted++;
    else if (isBad(d.status)) b.bad++;
    else b.inFlight++;
  }
  return out;
}

/* ------------------------------------ KPIs ------------------------------------ */

export type Kpi = {
  key: "frequency" | "cfr" | "restore" | "rollbacks";
  /** null when there is nothing to measure yet. */
  value: number | null;
  prev: number | null;
  spark: number[];
};

/** Carry the last known value over gaps; leading gaps take the first value. */
function carry(xs: (number | null)[]): number[] {
  const first = xs.find((x) => x !== null) ?? 0;
  let last = first;
  return xs.map((x) => (x === null ? last : (last = x)));
}

/** Rolling metric over the last `k` buckets, so sparse buckets still read as a trend. */
function rollingBy(buckets: PulseBucket[], k: number, f: (deps: Deployment[]) => number | null): number[] {
  return carry(buckets.map((_, i) => f(buckets.slice(Math.max(0, i - k + 1), i + 1).flatMap((b) => b.deps))));
}

const cfrOf = (deps: Deployment[]) => {
  const s = summarize(deps);
  return s.finished ? s.cfr : null;
};
const restoreOf = (deps: Deployment[]) => median(deps.map(restoreMs).filter((x): x is number => x !== null));

/** The four DORA-style numbers for the window and the window before it, with per-bucket sparklines. */
export function kpis(deps: Deployment[], w: Window, days: number): { kpis: Kpi[]; current: Deployment[]; previous: Deployment[]; buckets: PulseBucket[] } {
  const current = deps.filter((d) => createdIn(d, w.start, w.end));
  const previous = deps.filter((d) => createdIn(d, w.prevStart, w.start));
  const buckets = pulse(current, w);
  const k = Math.max(2, Math.round(w.buckets / 4));
  const bad = (l: Deployment[]) => l.filter((d) => isBad(d.status)).length;
  return {
    current,
    previous,
    buckets,
    kpis: [
      { key: "frequency", value: current.length / days, prev: previous.length / days, spark: buckets.map((b) => b.deps.length) },
      { key: "cfr", value: cfrOf(current), prev: cfrOf(previous), spark: rollingBy(buckets, k, cfrOf) },
      { key: "restore", value: restoreOf(current), prev: restoreOf(previous), spark: rollingBy(buckets, k, restoreOf) },
      { key: "rollbacks", value: bad(current), prev: previous.length ? bad(previous) : null, spark: buckets.map((b) => b.bad) },
    ],
  };
}

/** Relative change, or null when there is no baseline. */
export function delta(cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null) return null;
  if (prev === 0) return cur === 0 ? 0 : null;
  return (cur - prev) / prev;
}

/* --------------------------------- Risk mix --------------------------------- */

export type RiskMix = { level: Level; total: number; bad: number; finished: number };

export function riskMix(deps: Deployment[]): RiskMix[] {
  const levels: Level[] = ["low", "medium", "high"];
  return levels.map((level) => {
    const list = deps.filter((d) => (d.risk?.level ?? "low") === level);
    const s = summarize(list);
    return { level, total: list.length, bad: s.rolledBack + s.failed, finished: s.finished };
  });
}

/* -------------------------------- Live lanes -------------------------------- */

export type LaneVerdict = { metric: string; pass: boolean; reason?: string };

export type Lane = {
  dep: Deployment;
  /** Planned stage weights, in order. */
  weights: number[];
  /** When the current stage started (last step event at the current weight, else the release start). */
  stageSince: string;
  /** Bake time of the current stage in ms (0 when unknown). */
  bakeMs: number;
  /** Latest verdict per metric. */
  verdicts: LaneVerdict[];
  failing: boolean;
};

export function lane(d: Deployment, events: DeployEvent[]): Lane {
  const steps = d.plan?.steps ?? [];
  const cur = steps[d.step_index];
  const stepEvents = events.filter((e) => e.kind === "step" && (cur ? e.weight === cur.weight : true));
  const stageSince = stepEvents.length ? stepEvents[stepEvents.length - 1].at : d.created_at;
  const latest = new Map<string, LaneVerdict>();
  for (const e of events) {
    if (e.kind !== "verdict" || !e.verdict) continue;
    for (const r of e.verdict.results ?? []) latest.set(r.metric, { metric: r.metric, pass: r.pass, reason: r.reason });
  }
  const verdicts = [...latest.values()];
  return {
    dep: d,
    weights: steps.map((s) => s.weight),
    stageSince,
    bakeMs: cur ? Math.round(cur.bake / 1e6) : 0,
    verdicts,
    failing: verdicts.some((v) => !v.pass),
  };
}

/* ------------------------------- Service tiles ------------------------------- */

export type TileState = "rolling" | "attention" | "healthy" | "idle";

export type ServiceTile = {
  name: string;
  critical: boolean;
  state: TileState;
  /** ISO time of the newest release, if any. */
  last: string | null;
  lastStatus: Deployment["status"] | null;
  deploys30: number;
  bad30: number;
  /** Share of finished releases in 30 days that rolled back or failed; null when none finished. */
  rollbackRate: number | null;
  daily: number[];
};

export function serviceTiles(rows: ServiceRow[], now: number): ServiceTile[] {
  const weekAgo = now - 7 * DAY;
  return rows.map((r) => {
    const s = summarize(r.recent);
    const recentBad = r.lastRollback && Date.parse(r.lastRollback.updated_at) >= weekAgo;
    const state: TileState = r.live ? "rolling" : r.health === "rolled_back" || recentBad ? "attention" : r.health === "idle" ? "idle" : "healthy";
    return {
      name: r.name,
      critical: r.critical,
      state,
      last: r.last?.created_at ?? null,
      lastStatus: r.last?.status ?? null,
      deploys30: r.recent.length,
      bad30: s.rolledBack + s.failed,
      rollbackRate: s.finished ? s.cfr : null,
      daily: r.daily,
    };
  });
}

/* ------------------------------- Needs attention ------------------------------- */

export type Severity = "critical" | "high" | "medium";
export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2 };

export type AttentionItem = {
  /** Stable per occurrence, so a dismissed item comes back when something new happens. */
  key: string;
  severity: Severity;
  kind: "verdict" | "risk" | "stalled" | "queued" | "rolled_back" | "recovered";
  title: string;
  detail: string;
  at: string;
  action: { label: string; href: string };
  /** Deployment the item can roll back (live releases only). */
  rollback?: { id: string; service: string };
};

export function sortAttention(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || Date.parse(b.at) - Date.parse(a.at));
}

/* ------------------------------------ Runners ------------------------------------ */

export type JobLite = {
  id: string;
  kind: string;
  status: string;
  claimed_by: string | null;
  created_at: string;
  claimed_at: string | null;
  heartbeat_at: string | null;
  finished_at: string | null;
};

export type RunnerSeen = { name: string; lastSeen: number; online: boolean; jobs: number };

export const RUNNER_ONLINE_MS = 5 * 60_000;

/** Runners as seen through the jobs they claimed: last heartbeat, claim or finish. */
export function runnersFrom(jobs: JobLite[], now: number): RunnerSeen[] {
  const by = new Map<string, RunnerSeen>();
  for (const j of jobs) {
    if (!j.claimed_by) continue;
    const seen = Math.max(...[j.heartbeat_at, j.claimed_at, j.finished_at].map((t) => (t ? Date.parse(t) : 0)));
    const cur = by.get(j.claimed_by) ?? { name: j.claimed_by, lastSeen: 0, online: false, jobs: 0 };
    cur.lastSeen = Math.max(cur.lastSeen, seen);
    cur.jobs++;
    by.set(j.claimed_by, cur);
  }
  return [...by.values()]
    .map((r) => ({ ...r, online: now - r.lastSeen <= RUNNER_ONLINE_MS }))
    .sort((a, b) => Number(b.online) - Number(a.online) || b.lastSeen - a.lastSeen);
}

/* ------------------------------------ Activity ------------------------------------ */

export type ActivityKind = "release" | "promoted" | "rolled_back" | "failed" | "job" | "policy" | "plugin" | "service" | "environment";

export type ActivityItem = {
  key: string;
  at: string;
  kind: ActivityKind;
  title: string;
  detail?: string;
  href?: string;
};

/** "Today", "Yesterday" or "Earlier", by UTC day relative to `now`. */
export function dayGroup(at: string, now: number): "Today" | "Yesterday" | "Earlier" {
  const day = (t: number) => Math.floor(t / DAY);
  const diff = day(now) - day(Date.parse(at));
  return diff <= 0 ? "Today" : diff === 1 ? "Yesterday" : "Earlier";
}
