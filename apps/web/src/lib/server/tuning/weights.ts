/**
 * Learned risk weights: how well each shared-rules factor predicted rollbacks
 * in one organisation. Pure: the store loads release outcomes, this decides.
 *
 * For every factor, compare the rollback rate of releases that had it with
 * releases that did not. Both rates are smoothed towards the org's overall
 * rate (`prior` pseudo-releases each side), and a factor is judged only with
 * enough releases on both sides and enough rollbacks overall. A factor
 * counts as predictive only when the raw rates differ beyond chance
 * (two-proportion z-test, |z| >= MIN_Z). The target weight is the square root of the lift
 * (rate with ÷ rate without; inverted for a risk-lowering factor such as well
 * tested), or 1 without such evidence; each proposal moves a weight towards
 * its target by at most ±maxStep, and every weight stays in [min, max].
 * Weights never edit rules.json; they are per-org multipliers on its points.
 */
import { FACTOR_KEYS, factorLabel, levelFor, rules, weightFor, type FactorKey, type RiskLevel, type RiskWeights } from "../decision/score";
import { DAY_MS, clamp, meaningful, plural, roundTo, type TuningBounds } from "./bounds";

export type OutcomeObs = {
  at: number;
  outcome: "promoted" | "rolled_back";
  score: number;
  /** Points per factor as recorded with the release (already weighted by the weights in effect then). */
  points: Partial<Record<FactorKey, number>>;
};

export type FactorFinding = {
  key: FactorKey;
  label: string;
  /** Sign of the factor's rule points: +1 raises risk, -1 lowers it (well tested). */
  direction: 1 | -1;
  status: "proposed" | "unchanged" | "insufficient";
  current: number;
  proposed?: number;
  note: string;
  stats: { with: number; withRollbacks: number; without: number; withoutRollbacks: number; rateWith?: number; rateWithout?: number; lift?: number; z?: number };
};

export type ExpectedEffect = {
  /** Mean recorded score of rolled-back and promoted releases, before and after the proposed weights. */
  rolledBack: { n: number; before: number; after: number };
  promoted: { n: number; before: number; after: number };
  /** Rolled-back releases that would have been planned at medium or high risk. */
  rolledBackCautious: { before: number; after: number };
  /** Promoted releases that would have been planned at high risk (slowest plan). */
  promotedHigh: { before: number; after: number };
};

export type WeightTuning = {
  window: { from: string; to: string; days: number };
  releases: number;
  rollbacks: number;
  /** Releases skipped because their risk came from a manual or default score. */
  skipped: number;
  status: "ready" | "insufficient";
  note: string;
  factors: FactorFinding[];
  proposal?: { before: RiskWeights; after: RiskWeights; summary: string; effect: ExpectedEffect };
};

const ruleSign = (key: FactorKey): 1 | -1 => {
  const f = rules.factors[key] as { points?: number };
  return typeof f.points === "number" && f.points < 0 ? -1 : 1;
};

/** Proposes bounded adjustments to factor weights from release outcomes. */
export function tuneWeights(input: { now: number; bounds: TuningBounds; current: RiskWeights; observations: OutcomeObs[]; skipped?: number }): WeightTuning {
  const w = input.bounds.weights;
  const step = input.bounds.maxStep;
  const since = input.now - w.windowDays * DAY_MS;
  const obs = input.observations.filter((o) => o.at >= since && o.at <= input.now);
  const n = obs.length;
  const r = obs.filter((o) => o.outcome === "rolled_back").length;
  const out: WeightTuning = {
    window: { from: new Date(since).toISOString(), to: new Date(input.now).toISOString(), days: w.windowDays },
    releases: n, rollbacks: r, skipped: input.skipped ?? 0, status: "ready", note: "", factors: [],
  };
  const needReleases = w.minWith + w.minWithout;
  if (n < needReleases || r < w.minRollbacks) {
    out.status = "insufficient";
    const parts = [
      ...(n < needReleases ? [`${plural(needReleases - n, "more scored release")}`] : []),
      ...(r < w.minRollbacks ? [`${plural(w.minRollbacks - r, "more rollback")} to learn from`] : []),
    ];
    out.note = `Needs ${parts.join(" and ")} (has ${plural(n, "release")} and ${plural(r, "rollback")} in ${w.windowDays} days).`;
    out.factors = FACTOR_KEYS.map((key) => ({ key, label: factorLabel(key), direction: ruleSign(key), status: "insufficient", current: weightFor(input.current, key), note: "Not enough history yet.", stats: { with: 0, withRollbacks: 0, without: 0, withoutRollbacks: 0 } }));
    return out;
  }

  const base = r / n;
  const smooth = (rb: number, total: number) => (rb + w.prior * base) / (total + w.prior);
  type Judged = FactorFinding & { lift: number };
  const judged: Judged[] = [];
  for (const key of FACTOR_KEYS) {
    const has = obs.filter((o) => (o.points[key] ?? 0) !== 0);
    const not = obs.filter((o) => (o.points[key] ?? 0) === 0);
    const stats = { with: has.length, withRollbacks: has.filter((o) => o.outcome === "rolled_back").length, without: not.length, withoutRollbacks: not.filter((o) => o.outcome === "rolled_back").length };
    const current = weightFor(input.current, key);
    const finding = { key, label: factorLabel(key), direction: ruleSign(key), current };
    if (stats.with < w.minWith || stats.without < w.minWithout) {
      const short = stats.with < w.minWith ? `${plural(w.minWith - stats.with, "more release")} with this factor` : `${plural(w.minWithout - stats.without, "more release")} without it`;
      out.factors.push({ ...finding, status: "insufficient", note: `Needs ${short} (has ${stats.with} with, ${stats.without} without).`, stats });
      continue;
    }
    const rateWith = smooth(stats.withRollbacks, stats.with);
    const rateWithout = smooth(stats.withoutRollbacks, stats.without);
    const lift = rateWith / rateWithout;
    judged.push({ ...finding, status: "unchanged", note: "", stats: { ...stats, rateWith, rateWithout, lift }, lift });
  }

  const after: RiskWeights = { ...cleanCurrent(input.current) };
  const changes: string[] = [];
  for (const j of judged) {
    const s = j.stats;
    // A risk-lowering factor (well tested) earns more weight when releases with it roll back less.
    const rel = j.direction === 1 ? j.lift : 1 / j.lift;
    const z = j.direction * twoProportionZ(s.withRollbacks, s.with, s.withoutRollbacks, s.without);
    s.z = Number(z.toFixed(2));
    // Target is absolute (relative to the rule's points), so re-running on the same data converges instead of
    // compounding: sqrt(lift) when the difference is beyond chance, else 1 (the shared rules).
    const significant = Math.abs(z) >= MIN_Z;
    const target = significant ? clamp(Math.sqrt(rel), w.min, w.max) : 1;
    const proposed = roundTo(clamp(clamp(target, j.current * (1 - step), j.current * (1 + step)), w.min, w.max), 0.05);
    const rates = `${pctRate(s.rateWith!)} rolled back with it vs ${pctRate(s.rateWithout!)} without (lift ${j.lift.toFixed(2)}×, z ${s.z})`;
    const { lift: _lift, ...finding } = j;
    void _lift;
    if (!meaningful(j.current, proposed, 0.1, 0)) {
      out.factors.push({ ...finding, note: significant ? `Weight matches the evidence: ${rates}.` : `Not enough evidence to change: ${rates}.` });
      continue;
    }
    after[j.key] = proposed;
    if (proposed === 1) delete after[j.key];
    changes.push(`${j.label} ×${j.current} → ×${proposed}`);
    out.factors.push({ ...finding, status: "proposed", proposed, note: `${significant ? (proposed > j.current ? "More points" : "Fewer points") : "Back towards the shared rules (no clear evidence any more)"}: ${rates}.` });
  }
  out.factors.sort((a, b) => FACTOR_KEYS.indexOf(a.key) - FACTOR_KEYS.indexOf(b.key));
  out.note = `${plural(judged.length, "factor")} judged on ${plural(n, "release")} (${plural(r, "rollback")}) in ${w.windowDays} days.`;
  if (changes.length) {
    out.proposal = { before: cleanCurrent(input.current), after, summary: `Risk weights: ${changes.join(", ")}`, effect: expectedEffect(obs, input.current, after) };
  }
  return out;
}

/** |z| needed before a weight moves (about 90% one-sided confidence). */
export const MIN_Z = 1.28;

/** z statistic of rate a/n vs b/m with the pooled proportion; 0 when undefined. */
export function twoProportionZ(a: number, n: number, b: number, m: number): number {
  if (n === 0 || m === 0) return 0;
  const p = (a + b) / (n + m);
  const se = Math.sqrt(p * (1 - p) * (1 / n + 1 / m));
  return se === 0 ? 0 : (a / n - b / m) / se;
}

const pctRate = (v: number) => `${(v * 100).toFixed(1)}%`;

function cleanCurrent(c: RiskWeights): RiskWeights {
  const out: RiskWeights = {};
  for (const k of FACTOR_KEYS) {
    const v = weightFor(c, k);
    if (v !== 1) out[k] = v;
  }
  return out;
}

/** Score of a recorded release under other weights: recorded points × (new weight ÷ weight then), capped like the rules. */
export function rescore(o: OutcomeObs, from: RiskWeights, to: RiskWeights): number {
  let total = 0;
  for (const [k, p] of Object.entries(o.points) as [FactorKey, number][]) {
    const was = weightFor(from, k);
    total += was === 0 ? 0 : (p * weightFor(to, k)) / was;
  }
  return clamp(Math.round(total), 0, rules.max_score);
}

/** Replays the window's releases with the proposed weights. */
export function expectedEffect(obs: OutcomeObs[], from: RiskWeights, to: RiskWeights): ExpectedEffect {
  const mean = (xs: number[]) => (xs.length ? Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1)) : 0);
  const rb = obs.filter((o) => o.outcome === "rolled_back");
  const ok = obs.filter((o) => o.outcome === "promoted");
  const before = (o: OutcomeObs) => rescore(o, from, from);
  const after = (o: OutcomeObs) => rescore(o, from, to);
  const cautious = (l: RiskLevel) => l !== "low";
  return {
    rolledBack: { n: rb.length, before: mean(rb.map(before)), after: mean(rb.map(after)) },
    promoted: { n: ok.length, before: mean(ok.map(before)), after: mean(ok.map(after)) },
    rolledBackCautious: { before: rb.filter((o) => cautious(levelFor(before(o)))).length, after: rb.filter((o) => cautious(levelFor(after(o)))).length },
    promotedHigh: { before: ok.filter((o) => levelFor(before(o)) === "high").length, after: ok.filter((o) => levelFor(after(o)) === "high").length },
  };
}
