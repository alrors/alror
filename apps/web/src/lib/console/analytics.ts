// Pure analytics over deployments. Safe on server and client; no I/O here.

import type { DeployEvent, Deployment, Level, Status } from "./types";

export const DAY = 864e5;

export function isBad(s: Status): boolean {
  return s === "rolled_back" || s === "failed";
}

export function isFinished(s: Status): boolean {
  return s === "promoted" || s === "rolled_back" || s === "failed";
}

/**
 * The moment the dashboards treat as "now". Normally the wall clock; if the
 * newest deployment is older than two days (stale demo data), anchor on it
 * instead so charts are never empty.
 */
export function anchorNow(deps: Deployment[], now = Date.now()): number {
  const latest = deps.reduce((m, d) => Math.max(m, Date.parse(d.updated_at)), 0);
  return latest && latest < now - 2 * DAY ? latest : now;
}

export function parseRange(v: string | string[] | undefined): 7 | 30 {
  const s = Array.isArray(v) ? v[0] : v;
  return s === "7" || s === "7d" ? 7 : 30;
}

/** Start of the UTC day containing t. */
export function dayStart(t: number): number {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function inWindow(deps: Deployment[], from: number, to: number): Deployment[] {
  return deps.filter((d) => {
    const t = Date.parse(d.created_at);
    return t >= from && t < to;
  });
}

/** Deploys in the last `days` UTC days (including today) and in the period before it. */
export function periods(deps: Deployment[], days: number, now: number) {
  const end = dayStart(now) + DAY;
  const start = end - days * DAY;
  return {
    start,
    end,
    current: inWindow(deps, start, end),
    previous: inWindow(deps, start - days * DAY, start),
  };
}

export function restoreMs(d: Deployment): number | null {
  if (!isBad(d.status)) return null;
  return Math.max(0, Date.parse(d.updated_at) - Date.parse(d.created_at));
}

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export type Summary = {
  total: number;
  promoted: number;
  rolledBack: number;
  failed: number;
  inFlight: number;
  finished: number;
  cfr: number;
  avgRisk: number;
  aiShare: number;
  mttrMs: number | null;
};

export function summarize(deps: Deployment[]): Summary {
  let promoted = 0;
  let rolledBack = 0;
  let failed = 0;
  let risk = 0;
  let ai = 0;
  const restores: number[] = [];
  for (const d of deps) {
    if (d.status === "promoted") promoted++;
    else if (d.status === "rolled_back") rolledBack++;
    else if (d.status === "failed") failed++;
    risk += d.risk?.score ?? 0;
    if (d.risk?.ai_authored) ai++;
    const r = restoreMs(d);
    if (r !== null) restores.push(r);
  }
  const finished = promoted + rolledBack + failed;
  return {
    total: deps.length,
    promoted,
    rolledBack,
    failed,
    inFlight: deps.length - finished,
    finished,
    cfr: finished ? (rolledBack + failed) / finished : 0,
    avgRisk: deps.length ? risk / deps.length : 0,
    aiShare: deps.length ? ai / deps.length : 0,
    mttrMs: median(restores),
  };
}

export type DayStat = {
  day: number; // UTC midnight
  deps: Deployment[];
  promoted: number;
  bad: number;
  other: number;
};

export function daily(deps: Deployment[], start: number, days: number): DayStat[] {
  const out: DayStat[] = Array.from({ length: days }, (_, i) => ({
    day: start + i * DAY,
    deps: [],
    promoted: 0,
    bad: 0,
    other: 0,
  }));
  for (const d of deps) {
    const i = Math.floor((Date.parse(d.created_at) - start) / DAY);
    if (i < 0 || i >= days) continue;
    const b = out[i];
    b.deps.push(d);
    if (d.status === "promoted") b.promoted++;
    else if (isBad(d.status)) b.bad++;
    else b.other++;
  }
  return out;
}

/** Fill gaps in a sparse series by carrying the last value forward (first gaps take the first value). */
export function carry(xs: (number | null)[]): number[] {
  const first = xs.find((x) => x !== null) ?? 0;
  let last = first;
  return xs.map((x) => (x === null ? last : (last = x)));
}

/** Rolling-window values, so sparse daily metrics read as a trend. */
export function rolling(days: DayStat[], window: number, f: (deps: Deployment[]) => number | null): (number | null)[] {
  return days.map((_, i) => {
    const slice = days.slice(Math.max(0, i - window + 1), i + 1).flatMap((d) => d.deps);
    return slice.length ? f(slice) : null;
  });
}

export type Bucket = { from: number; to: number; count: number; bad: number; level: Level };

export function riskHistogram(deps: Deployment[]): Bucket[] {
  const out: Bucket[] = Array.from({ length: 10 }, (_, i) => ({
    from: i * 10,
    to: i * 10 + 9,
    count: 0,
    bad: 0,
    // 30-39 straddles the 35 threshold; it is drawn as medium.
    level: i >= 7 ? "high" : i >= 3 ? "medium" : "low",
  }));
  for (const d of deps) {
    const i = Math.min(9, Math.floor((d.risk?.score ?? 0) / 10));
    out[i].count++;
    if (isBad(d.status)) out[i].bad++;
  }
  return out;
}

export function groupBy<T, K>(xs: T[], key: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of xs) {
    const k = key(x);
    const list = m.get(k);
    if (list) list.push(x);
    else m.set(k, [x]);
  }
  return m;
}

export type Outcome = { label: string; total: number; promoted: number; bad: number; avgRisk: number; cfr: number };

export function outcome(label: string, deps: Deployment[]): Outcome {
  const s = summarize(deps);
  return {
    label,
    total: s.total,
    promoted: s.promoted,
    bad: s.rolledBack + s.failed,
    avgRisk: s.avgRisk,
    cfr: s.cfr,
  };
}

/** Change of `cur` vs `prev` as a fraction; null when there is nothing to compare. */
export function change(cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null || prev === 0) return null;
  return (cur - prev) / prev;
}

/** One-line summary of a recent event across all deployments, for activity feeds. */
export type FeedItem = { at: string; kind: DeployEvent["kind"]; message: string; dep: Deployment; pass?: boolean };

export function feed(deps: Deployment[], events: Map<string, DeployEvent[]>, limit = 14): FeedItem[] {
  const items: FeedItem[] = [];
  for (const d of deps) {
    for (const e of events.get(d.id) ?? []) {
      if (e.kind === "step") continue; // the verdict that follows carries the information
      items.push({ at: e.at, kind: e.kind, message: e.message, dep: d, pass: e.verdict?.pass });
    }
  }
  return items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit);
}

export type StageState = "pass" | "fail" | "active" | "pending" | "skipped";

/** Per-step state of a rollout. Uses verdict events when given, else infers from the record. */
export function stageStates(d: Deployment, events?: DeployEvent[]): StageState[] {
  const steps = d.plan?.steps ?? [];
  const verdictFor = new Map<number, boolean>();
  for (const e of events ?? []) if (e.kind === "verdict" && e.verdict) verdictFor.set(e.weight ?? -1, e.verdict.pass);
  const halted = isBad(d.status);
  const reachedFull = d.status === "promoted" || (events ?? []).some((e) => e.kind === "promoted");
  return steps.map((s, i) => {
    const v = verdictFor.get(s.weight);
    if (v === true) return "pass";
    if (v === false) return "fail";
    if (reachedFull) return "pass";
    if (halted) return i < d.step_index ? "pass" : i === d.step_index ? "fail" : "skipped";
    if (i === d.step_index && d.status === "rolling") return "active";
    return i < d.step_index ? "pass" : "pending";
  });
}

export type ServiceHealth = "healthy" | "rolling" | "rolled_back" | "idle";

export type ServiceRow = {
  name: string;
  target: string;
  paths: string[];
  critical: boolean;
  cluster?: string;
  deps: Deployment[]; // newest first, all time
  recent: Deployment[]; // last 30 days
  daily: number[]; // deploys per day, last 30 days
  last: Deployment | null;
  lastFinished: Deployment | null;
  lastRollback: Deployment | null;
  live: Deployment | null;
  health: ServiceHealth;
  cfr: number;
  avgRisk: number;
};

/** Per-service rollup. `services` comes from alror.yaml; services seen only in history are appended. */
export function serviceRows(
  services: { name: string; target: string; paths: string[]; critical: boolean; cluster?: string }[],
  deps: Deployment[],
  now: number,
): ServiceRow[] {
  const by = groupBy(deps, (d) => d.service);
  const known = new Set(services.map((s) => s.name));
  const all = [...services, ...[...by.keys()].filter((n) => !known.has(n)).map((name) => ({ name, target: "unknown", paths: [], critical: false }))];
  const start = dayStart(now) + DAY - 30 * DAY;
  return all.map((s) => {
    const list = by.get(s.name) ?? [];
    const recent = list.filter((d) => Date.parse(d.created_at) >= start);
    const live = list.find((d) => d.status === "rolling" || d.status === "pending") ?? null;
    const lastFinished = list.find((d) => isFinished(d.status)) ?? null;
    const sum = summarize(recent);
    const health: ServiceHealth = live ? "rolling" : !lastFinished ? "idle" : isBad(lastFinished.status) ? "rolled_back" : "healthy";
    return {
      ...s,
      deps: list,
      recent,
      daily: daily(recent, start, 30).map((b) => b.deps.length),
      last: list[0] ?? null,
      lastFinished,
      lastRollback: list.find((d) => isBad(d.status)) ?? null,
      live,
      health,
      cfr: sum.cfr,
      avgRisk: sum.avgRisk,
    };
  });
}
