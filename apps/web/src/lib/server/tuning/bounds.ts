/**
 * Safety bounds for tuning, and the small statistics helpers the pure tuning
 * functions share. No I/O: imported by the server store and by unit tests.
 */

export const DAY_MS = 86_400_000;

/** Tightest and loosest value tuning may propose for one metric. */
export type Range = { floor: number; ceiling: number };

export type TuningBounds = {
  /** Verdict history used for thresholds and bake times, in days. */
  windowDays: number;
  /** Healthy checks (verdict results) per metric needed before a threshold is proposed. */
  minChecks: number;
  /** Distinct healthy releases needed before anything is proposed for a service. */
  minReleases: number;
  /** Relative regression limit (0.25 = +25%) per metric; `default` covers metrics not listed. */
  maxRegression: Record<string, Range> & { default: Range };
  /** Absolute increase over a zero baseline. Only metrics listed here are tuned (units differ per metric). */
  maxIncrease: Record<string, Range>;
  /** Service bake multiplier: floor is the shortest bake tuning may propose; ceiling 1 = the org plan. */
  bakeScale: Range;
  /** Consecutive clean releases before a shorter bake is proposed (twice as many for the floor). */
  cleanStreak: number;
  /** One proposal moves a value by at most this share of its current value (0.5 = ±50%). */
  maxStep: number;
  weights: {
    /** Release outcomes used to learn weights, in days. */
    windowDays: number;
    /** Releases with and without a factor needed before its weight is judged. */
    minWith: number;
    minWithout: number;
    /** Rollbacks in the window needed before any weight is judged. */
    minRollbacks: number;
    /** Smoothing: pseudo-releases at the org's overall rollback rate added to each side. */
    prior: number;
    /** Cumulative multiplier range for any factor. */
    min: number;
    max: number;
  };
};

export const DEFAULT_BOUNDS: TuningBounds = {
  windowDays: 30,
  minChecks: 20,
  minReleases: 8,
  maxRegression: {
    default: { floor: 0.05, ceiling: 0.5 },
    error_rate: { floor: 0.05, ceiling: 0.5 },
    latency_p95: { floor: 0.03, ceiling: 0.3 },
  },
  maxIncrease: { error_rate: { floor: 0.001, ceiling: 0.02 } },
  bakeScale: { floor: 0.5, ceiling: 1 },
  cleanStreak: 20,
  maxStep: 0.5,
  weights: { windowDays: 90, minWith: 10, minWithout: 10, minRollbacks: 5, prior: 10, min: 0.25, max: 2 },
};

const num = (v: unknown, lo: number, hi: number, dflt: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;

function range(v: unknown, dflt: Range, hi: number): Range {
  const o = (v && typeof v === "object" ? v : {}) as Partial<Range>;
  const floor = num(o.floor, 0, hi, dflt.floor);
  const ceiling = num(o.ceiling, 0, hi, dflt.ceiling);
  return floor <= ceiling ? { floor, ceiling } : dflt;
}

/** Stored bounds merged over the defaults; anything malformed falls back to the default. */
export function resolveBounds(raw: unknown): TuningBounds {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_BOUNDS;
  const mr = (r.maxRegression && typeof r.maxRegression === "object" ? r.maxRegression : {}) as Record<string, unknown>;
  const maxRegression = { ...d.maxRegression } as TuningBounds["maxRegression"];
  for (const [k, v] of Object.entries(mr)) maxRegression[k] = range(v, d.maxRegression[k] ?? d.maxRegression.default, 10);
  const mi = (r.maxIncrease && typeof r.maxIncrease === "object" ? r.maxIncrease : {}) as Record<string, unknown>;
  const maxIncrease = { ...d.maxIncrease };
  for (const [k, v] of Object.entries(mi)) maxIncrease[k] = range(v, d.maxIncrease[k] ?? { floor: 0, ceiling: 0 }, 1e9);
  const w = (r.weights && typeof r.weights === "object" ? r.weights : {}) as Record<string, unknown>;
  const wMin = num(w.min, 0, 1, d.weights.min);
  const wMax = num(w.max, 1, 4, d.weights.max);
  return {
    windowDays: Math.round(num(r.windowDays, 7, 180, d.windowDays)),
    minChecks: Math.round(num(r.minChecks, 5, 10_000, d.minChecks)),
    minReleases: Math.round(num(r.minReleases, 3, 10_000, d.minReleases)),
    maxRegression,
    maxIncrease,
    bakeScale: range(r.bakeScale, d.bakeScale, 1),
    cleanStreak: Math.round(num(r.cleanStreak, 5, 10_000, d.cleanStreak)),
    maxStep: num(r.maxStep, 0.05, 0.5, d.maxStep),
    weights: {
      windowDays: Math.round(num(w.windowDays, 14, 365, d.weights.windowDays)),
      minWith: Math.round(num(w.minWith, 5, 10_000, d.weights.minWith)),
      minWithout: Math.round(num(w.minWithout, 5, 10_000, d.weights.minWithout)),
      minRollbacks: Math.round(num(w.minRollbacks, 3, 10_000, d.weights.minRollbacks)),
      prior: num(w.prior, 1, 1000, d.weights.prior),
      min: wMin,
      max: Math.max(wMax, wMin),
    },
  };
}

export const regressionRange = (b: TuningBounds, metric: string): Range => b.maxRegression[metric] ?? b.maxRegression.default;

/** Linear-interpolated quantile of an unsorted sample (q in [0, 1]); NaN when empty. */
export function quantile(values: number[], q: number): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Round to `step` (e.g. 0.01), up or to nearest; avoids 0.30000000000000004 in stored values. */
export const roundTo = (v: number, step: number, mode: "up" | "nearest" = "nearest") =>
  Number(((mode === "up" ? Math.ceil(v / step - 1e-9) : Math.round(v / step)) * step).toFixed(6));
/** Whether two values differ enough to be worth a proposal. */
export const meaningful = (from: number, to: number, minAbs: number, minRel = 0.1) =>
  Math.abs(to - from) >= Math.max(minAbs, Math.abs(from) * minRel);

export const pct = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`;
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
