/**
 * Per-service verification thresholds and bake times, learned from stored
 * verdict history. Pure: the store loads releases and verdicts, this decides.
 *
 * Normal variation of a metric is the distribution of canary-vs-baseline
 * deltas in checks that passed on releases that stayed promoted. The proposed
 * limit leaves headroom above the 95th percentile of that variation, moves at
 * most `maxStep` from the current value in one proposal, and never leaves the
 * configured [floor, ceiling]. Synthetic verdicts are never used as evidence.
 */
import {
  DAY_MS, clamp, meaningful, pct, plural, quantile, regressionRange, roundTo,
  type Range, type TuningBounds,
} from "./bounds";

/** One metric result of a stored verdict (Go domain.MetricResult; older records lack the newer fields). */
export type ResultObs = {
  metric: string;
  delta: number;
  baseline: number;
  abs_delta?: number;
  pass: boolean;
  status?: string;
  reason?: string;
};
export type VerdictObs = { at: number; evidence?: string; results: ResultObs[] };
export type ReleaseObs = {
  id: string;
  at: number;
  /** Final status; a promoted release that was later rolled back by hand is rolled_back. */
  status: "pending" | "rolling" | "promoted" | "rolled_back" | "failed";
  verdicts: VerdictObs[];
};

/** The service policy override shape stored in services.policy_override and served as services[].policy. */
export type ServiceOverride = { max_regression?: Record<string, number>; max_increase?: Record<string, number>; bake_scale?: number };
/** What the verifier uses for this service today (org policy with the override merged in). */
export type EffectivePolicy = { max_regression: Record<string, number>; max_increase: Record<string, number>; bake_scale: number };

/** Go verify defaults for a zero baseline when max_increase is unset (internal/verify). */
export const VERIFIER_MAX_INCREASE: Record<string, number> = { error_rate: 0.01 };

export type FindingStatus = "proposed" | "unchanged" | "insufficient" | "out_of_bounds";
export type MetricFinding = {
  kind: "max_regression" | "max_increase";
  metric: string;
  status: FindingStatus;
  current: number;
  proposed?: number;
  /** "needs 6 more releases" style explanation, or why the value stays. */
  note: string;
  stats: {
    checks: number;
    releases: number;
    p50?: number;
    p95?: number;
    max?: number;
    /** Expected effect of the proposed value, replayed on the same window. */
    healthyOver?: number;
    regressions?: number;
    regressionsCaught?: number;
  };
  bounds: Range;
};
export type BakeFinding = {
  status: FindingStatus;
  current: number;
  proposed?: number;
  note: string;
  stats: { cleanStreak: number; releases: number; rollbacks: number };
  bounds: Range;
};
export type ServiceTuning = {
  service: string;
  window: { from: string; to: string; days: number };
  releases: number;
  healthyReleases: number;
  syntheticChecksIgnored: number;
  metrics: MetricFinding[];
  bake: BakeFinding;
  /** Present when at least one value should change. */
  proposal?: { before: ServiceOverride; after: ServiceOverride; summary: string };
};

const usable = (r: ResultObs) =>
  Number.isFinite(r.delta) && Number.isFinite(r.baseline) && !/^insufficient|invalid/i.test(r.reason ?? "") &&
  (r.status === undefined || r.status === "" || r.status === "pass" || r.status === "regression");
const passed = (r: ResultObs) => r.pass && (r.status === undefined || r.status === "" || r.status === "pass");
const regressed = (r: ResultObs) => !r.pass && (r.status === undefined || r.status === "" || r.status === "regression");

/** Proposes thresholds and bake time for one service from its releases in the window. */
export function tuneService(input: {
  service: string;
  now: number;
  bounds: TuningBounds;
  /** Effective policy for the service today. */
  current: EffectivePolicy;
  /** The service's stored override (null = none). */
  override: ServiceOverride | null;
  releases: ReleaseObs[];
}): ServiceTuning {
  const { bounds: b, current, now } = input;
  const since = now - b.windowDays * DAY_MS;
  const inWindow = input.releases.filter((r) => r.at >= since && r.at <= now);
  const finished = inWindow.filter((r) => r.status === "promoted" || r.status === "rolled_back" || r.status === "failed");
  const healthy = finished.filter((r) => r.status === "promoted");

  let synthetic = 0;
  // metric -> samples with the release they came from
  const rel = new Map<string, { v: number; release: string }[]>();
  const abs = new Map<string, { v: number; release: string }[]>();
  const bad = new Map<string, { rel?: number; abs?: number }[]>();
  for (const r of finished) {
    for (const v of r.verdicts) {
      if (v.evidence === "synthetic") { synthetic += v.results.length; continue; }
      for (const m of v.results) {
        if (!usable(m)) continue;
        const zero = m.baseline <= 0;
        if (r.status === "promoted" && passed(m)) {
          if (!zero) push(rel, m.metric, { v: m.delta, release: r.id });
          else if (typeof m.abs_delta === "number" && Number.isFinite(m.abs_delta)) push(abs, m.metric, { v: m.abs_delta, release: r.id });
        } else if (regressed(m)) {
          push(bad, m.metric, zero ? { abs: m.abs_delta } : { rel: m.delta });
        }
      }
    }
  }

  const metrics: MetricFinding[] = [];
  const perRelease = (samples: { release: string }[]) => new Set(samples.map((s) => s.release)).size;
  const needMore = (checks: number, releases: number) => {
    const rate = releases > 0 ? checks / releases : 2;
    const forChecks = Math.ceil(Math.max(0, b.minChecks - checks) / Math.max(rate, 1));
    return Math.max(b.minReleases - releases, forChecks, 1);
  };

  for (const metric of Object.keys(current.max_regression).sort()) {
    const now_ = current.max_regression[metric];
    const range = regressionRange(b, metric);
    const samples = rel.get(metric) ?? [];
    const releases = perRelease(samples);
    const base = { kind: "max_regression" as const, metric, current: now_, bounds: range };
    if (samples.length < b.minChecks || releases < b.minReleases) {
      const n = needMore(samples.length, releases);
      metrics.push({ ...base, status: "insufficient", note: `Needs ${plural(n, "more healthy release")} with measured ${metric} (has ${plural(samples.length, "check")} from ${plural(releases, "release")}; needs ${b.minChecks} from ${b.minReleases}).`, stats: { checks: samples.length, releases } });
      continue;
    }
    const values = samples.map((s) => s.v);
    const p95 = quantile(values, 0.95);
    const stats = { checks: values.length, releases, p50: quantile(values, 0.5), p95, max: Math.max(...values) };
    if (now_ < range.floor || now_ > range.ceiling) {
      metrics.push({ ...base, status: "out_of_bounds", note: `Set by hand outside the tuning range ${pct(range.floor)}–${pct(range.ceiling)}; left alone.`, stats });
      continue;
    }
    // Headroom: 1.5x the 95th percentile of healthy variation, and at least 3 points above it.
    const noise = Math.max(0, p95);
    const target = Math.max(noise * 1.5, noise + 0.03);
    const proposed = roundTo(clamp(clamp(target, now_ * (1 - b.maxStep), now_ * (1 + b.maxStep)), range.floor, range.ceiling), 0.01, "up");
    const regs = (bad.get(metric) ?? []).flatMap((x) => (x.rel === undefined ? [] : [x.rel]));
    const effect = { healthyOver: values.filter((x) => x > proposed).length, regressions: regs.length, regressionsCaught: regs.filter((x) => x > proposed).length };
    if (!meaningful(now_, proposed, 0.01)) {
      metrics.push({ ...base, status: "unchanged", note: `Healthy variation (95th percentile ${signed(p95)}) fits the current limit.`, stats: { ...stats, ...effect } });
      continue;
    }
    const dir = proposed < now_ ? "Tighter" : "Looser";
    metrics.push({
      ...base, status: "proposed", proposed, stats: { ...stats, ...effect },
      note: `${dir}: healthy releases vary by up to ${signed(p95)} (95th percentile of ${values.length} checks), so +${pct(proposed)} keeps ${pct(proposed - Math.max(0, p95))} of headroom.`,
    });
  }

  for (const metric of Object.keys(b.maxIncrease).sort()) {
    const range = b.maxIncrease[metric];
    const now_ = current.max_increase[metric] ?? VERIFIER_MAX_INCREASE[metric] ?? 0;
    const samples = abs.get(metric) ?? [];
    const releases = perRelease(samples);
    const base = { kind: "max_increase" as const, metric, current: now_, bounds: range };
    if (samples.length === 0) continue; // this service never ran on a zero baseline: nothing to say
    if (samples.length < b.minChecks || releases < b.minReleases) {
      const n = needMore(samples.length, releases);
      metrics.push({ ...base, status: "insufficient", note: `Needs ${plural(n, "more healthy release")} on a zero ${metric} baseline (has ${plural(samples.length, "check")}).`, stats: { checks: samples.length, releases } });
      continue;
    }
    const values = samples.map((s) => s.v);
    const p95 = quantile(values, 0.95);
    const stats = { checks: values.length, releases, p50: quantile(values, 0.5), p95, max: Math.max(...values) };
    if (now_ <= 0 || now_ < range.floor || now_ > range.ceiling) {
      metrics.push({ ...base, status: "out_of_bounds", note: now_ <= 0 ? "Any increase over a zero baseline fails today; tuning never loosens that." : "Set by hand outside the tuning range; left alone.", stats });
      continue;
    }
    const target = Math.max(0, p95) * 1.5;
    const proposed = roundTo(clamp(clamp(target, now_ * (1 - b.maxStep), now_ * (1 + b.maxStep)), range.floor, range.ceiling), 0.0001, "up");
    const regs = (bad.get(metric) ?? []).flatMap((x) => (typeof x.abs === "number" ? [x.abs] : []));
    const effect = { healthyOver: values.filter((x) => x > proposed).length, regressions: regs.length, regressionsCaught: regs.filter((x) => x > proposed).length };
    if (!meaningful(now_, proposed, range.floor / 2)) {
      metrics.push({ ...base, status: "unchanged", note: "Healthy variation over a zero baseline fits the current allowance.", stats: { ...stats, ...effect } });
      continue;
    }
    metrics.push({ ...base, status: "proposed", proposed, stats: { ...stats, ...effect }, note: `${proposed < now_ ? "Tighter" : "Looser"}: healthy absolute increases reach ${p95.toPrecision(2)} (95th percentile).` });
  }

  const bake = tuneBake(finished, healthy.length, input.override?.bake_scale, b);

  const tuning: ServiceTuning = {
    service: input.service,
    window: { from: new Date(since).toISOString(), to: new Date(now).toISOString(), days: b.windowDays },
    releases: finished.length,
    healthyReleases: healthy.length,
    syntheticChecksIgnored: synthetic,
    metrics,
    bake,
  };
  const changed = metrics.filter((m) => m.status === "proposed");
  if (changed.length || bake.status === "proposed") {
    const before: ServiceOverride = cloneOverride(input.override);
    const after: ServiceOverride = cloneOverride(input.override);
    for (const m of changed) {
      const key = m.kind;
      after[key] = { ...(after[key] ?? {}), [m.metric]: m.proposed! };
    }
    if (bake.status === "proposed") {
      if (bake.proposed === 1) delete after.bake_scale;
      else after.bake_scale = bake.proposed;
    }
    const parts = [
      ...changed.map((m) => `${m.metric} ${m.kind === "max_regression" ? `+${pct(m.current)} → +${pct(m.proposed!)}` : `${m.current} → ${m.proposed}`}`),
      ...(bake.status === "proposed" ? [`bake ×${bake.current} → ×${bake.proposed}`] : []),
    ];
    tuning.proposal = { before, after, summary: `${input.service}: ${parts.join(", ")}` };
  }
  return tuning;
}

/**
 * Shorter bake for a long clean record: `cleanStreak` consecutive clean releases → ×0.75, twice that → the floor.
 * A rollback or failure in the window takes a shortened bake back to the org plan (×1).
 * `scale` is the service multiplier on top of the org bake scale.
 */
function tuneBake(finished: ReleaseObs[], healthyCount: number, overrideScale: number | undefined, b: TuningBounds): BakeFinding {
  const current = overrideScale && overrideScale > 0 ? overrideScale : 1;
  const sorted = [...finished].sort((x, y) => y.at - x.at);
  let streak = 0;
  for (const r of sorted) {
    if (r.status !== "promoted") break;
    streak++;
  }
  const rollbacks = finished.length - healthyCount;
  const stats = { cleanStreak: streak, releases: finished.length, rollbacks };
  const base = { current, stats, bounds: b.bakeScale };
  if (current < b.bakeScale.floor || current > b.bakeScale.ceiling) {
    return { ...base, status: "out_of_bounds", note: "Bake multiplier set by hand outside the tuning range; left alone." };
  }
  if (rollbacks > 0 && current < 1) {
    return { ...base, status: "proposed", proposed: 1, note: `${plural(rollbacks, "rollback or failure", "rollbacks or failures")} in the window: back to the full org bake.` };
  }
  if (streak < b.cleanStreak) {
    return { ...base, status: current < 1 ? "unchanged" : "insufficient", note: current < 1 ? `Clean streak of ${streak}; keeping ×${current}.` : `Needs ${plural(b.cleanStreak - streak, "more clean release")} in a row for a shorter bake (streak ${streak} of ${b.cleanStreak}).` };
  }
  const target = streak >= 2 * b.cleanStreak ? b.bakeScale.floor : Math.max(b.bakeScale.floor, 0.75);
  const proposed = roundTo(clamp(Math.max(target, current * (1 - b.maxStep)), b.bakeScale.floor, Math.min(b.bakeScale.ceiling, current)), 0.05);
  if (!meaningful(current, proposed, 0.05)) {
    return { ...base, status: "unchanged", note: proposed <= b.bakeScale.floor ? `Already at the bake floor ×${b.bakeScale.floor}.` : `Clean streak of ${streak}; ×${current} stays until ${2 * b.cleanStreak}.` };
  }
  return { ...base, status: "proposed", proposed, note: `${streak} clean releases in a row and no rollbacks in the window: bake ×${proposed} (floor ×${b.bakeScale.floor}).` };
}

function push<T>(m: Map<string, T[]>, k: string, v: T) {
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
}

const signed = (v: number) => `${v >= 0 ? "+" : ""}${pct(v, 1)}`;

/** A clean copy of a stored override: only known keys with finite, non-negative values. */
export function cloneOverride(raw: unknown): ServiceOverride {
  const out: ServiceOverride = {};
  if (!raw || typeof raw !== "object") return out;
  const o = raw as Record<string, unknown>;
  for (const key of ["max_regression", "max_increase"] as const) {
    const m = o[key];
    if (!m || typeof m !== "object") continue;
    const clean: Record<string, number> = {};
    for (const [k, v] of Object.entries(m as Record<string, unknown>)) if (typeof v === "number" && Number.isFinite(v) && v >= 0) clean[k] = v;
    if (Object.keys(clean).length) out[key] = clean;
  }
  if (typeof o.bake_scale === "number" && Number.isFinite(o.bake_scale) && o.bake_scale > 0) out.bake_scale = o.bake_scale;
  return out;
}

/** The policy the verifier uses for a service: org policy with the override merged in (Go: config.PolicyFor). */
export function effectivePolicy(org: { max_regression: Record<string, number> }, override: ServiceOverride | null): EffectivePolicy {
  const o = cloneOverride(override);
  return {
    max_regression: { ...org.max_regression, ...(o.max_regression ?? {}) },
    max_increase: { ...(o.max_increase ?? {}) },
    bake_scale: o.bake_scale ?? 1,
  };
}
