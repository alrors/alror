import assert from "node:assert/strict";
import { test } from "node:test";
import { tuningInbox } from "../src/lib/console/oversight";
import { decidePull } from "../src/lib/server/decision/decide";
import { scoreChange, weigh, weightFor, type FactorKey } from "../src/lib/server/decision/score";
import { DAY_MS, DEFAULT_BOUNDS, quantile, resolveBounds } from "../src/lib/server/tuning/bounds";
import { cloneOverride, effectivePolicy, tuneService, type ReleaseObs } from "../src/lib/server/tuning/thresholds";
import { expectedEffect, tuneWeights, type OutcomeObs } from "../src/lib/server/tuning/weights";

const NOW = Date.UTC(2026, 9, 28, 12);
const ORG = { max_regression: { error_rate: 0.25, latency_p95: 0.15 } };

/** Deterministic pseudo-random numbers so tests do not flake. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Releases whose healthy deltas are uniform in [-spread, spread]. */
function releases(n: number, opts: { spread?: Record<string, number>; status?: (i: number) => ReleaseObs["status"]; evidence?: string; zeroBaseline?: boolean; daysBack?: number } = {}): ReleaseObs[] {
  const r = rng(7);
  const spread = opts.spread ?? { error_rate: 0.06, latency_p95: 0.03 };
  return Array.from({ length: n }, (_, i) => ({
    id: `dep_${i}`,
    at: NOW - ((opts.daysBack ?? 25) * DAY_MS * (i + 1)) / (n + 1),
    status: opts.status?.(i) ?? "promoted",
    verdicts: [0, 1].map((k) => ({
      at: NOW - i * 1000 - k,
      evidence: opts.evidence,
      results: Object.entries(spread).map(([metric, s]) => {
        const delta = (r() * 2 - 1) * s;
        return opts.zeroBaseline
          ? { metric, delta: 0, baseline: 0, abs_delta: Math.abs(delta) / 10, pass: true, status: "pass" }
          : { metric, delta, baseline: 1, pass: true, status: "pass" };
      }),
    })),
  }));
}

const tune = (rel: ReleaseObs[], over: Parameters<typeof tuneService>[0]["override"] = null, bounds = DEFAULT_BOUNDS) =>
  tuneService({ service: "api", now: NOW, bounds, current: effectivePolicy(ORG, over), override: over, releases: rel });

test("quantile interpolates and is NaN when empty", () => {
  assert.equal(quantile([3, 1, 2], 0.5), 2);
  assert.equal(quantile([0, 10], 0.95), 9.5);
  assert.ok(Number.isNaN(quantile([], 0.5)));
});

test("too little history is reported honestly as releases still needed, never guessed", () => {
  const t = tune(releases(3));
  assert.equal(t.proposal, undefined);
  for (const m of t.metrics) {
    assert.equal(m.status, "insufficient");
    assert.equal(m.proposed, undefined);
    assert.match(m.note, /^Needs \d+ more healthy releases?/);
  }
  // 6 checks from 3 releases (2 per release): 14 more checks = 7 more releases.
  assert.match(t.metrics[0].note, /Needs 7 more healthy releases/);
  assert.equal(t.bake.status, "insufficient");
  assert.match(t.bake.note, /Needs 17 more clean releases in a row/);
});

test("a quiet service gets tighter limits with headroom, bounded by one step", () => {
  const t = tune(releases(15));
  const err = t.metrics.find((m) => m.metric === "error_rate")!;
  const lat = t.metrics.find((m) => m.metric === "latency_p95")!;
  assert.equal(err.status, "proposed");
  // p95 of uniform(-6%, 6%) ≈ 5.4%: 1.5x ≈ 8.1%, but one proposal moves at most 50%: 25% → 12.5% → rounded up 13%.
  assert.equal(err.proposed, 0.13);
  assert.equal(lat.status, "proposed");
  assert.ok(lat.proposed! >= lat.stats.p95! + 0.03 - 1e-9, "keeps at least 3 points of headroom above p95");
  assert.ok(lat.proposed! >= 0.075, "never more than 50% tighter in one proposal");
  assert.equal(err.stats.healthyOver, 0, "no healthy check from the window would fail the new limit");
  assert.deepEqual(t.proposal?.before, {});
  assert.deepEqual(t.proposal?.after.max_regression, { error_rate: 0.13, latency_p95: lat.proposed });
  assert.match(t.proposal!.summary, /error_rate \+25% → \+13%/);
});

test("tuning never goes below the floor or above the ceiling", () => {
  const bounds = resolveBounds({ maxRegression: { error_rate: { floor: 0.2, ceiling: 0.3 }, latency_p95: { floor: 0.12, ceiling: 0.2 } } });
  const quiet = tune(releases(15, { spread: { error_rate: 0.001, latency_p95: 0.001 } }), null, bounds);
  for (const m of quiet.metrics) if (m.proposed !== undefined) assert.ok(m.proposed >= m.bounds.floor, `${m.metric} ${m.proposed} below floor`);
  assert.equal(quiet.metrics.find((m) => m.metric === "error_rate")!.proposed, 0.2);

  const noisy = tune(releases(15, { spread: { error_rate: 0.4, latency_p95: 0.4 } }), null, bounds);
  for (const m of noisy.metrics) if (m.proposed !== undefined) assert.ok(m.proposed <= m.bounds.ceiling, `${m.metric} ${m.proposed} above ceiling`);
  assert.equal(noisy.metrics.find((m) => m.metric === "error_rate")!.proposed, 0.3);
});

test("a limit set by hand outside the tuning range is left alone", () => {
  const t = tune(releases(15), { max_regression: { error_rate: 0.02 } });
  const err = t.metrics.find((m) => m.metric === "error_rate")!;
  assert.equal(err.status, "out_of_bounds");
  assert.equal(err.proposed, undefined);
  assert.equal(t.proposal?.after.max_regression?.error_rate, 0.02, "the override keeps its value");
});

test("synthetic verdicts and unhealthy releases are not evidence of normal variation", () => {
  const synthetic = tune(releases(15, { evidence: "synthetic" }));
  assert.equal(synthetic.metrics[0].status, "insufficient");
  assert.equal(synthetic.syntheticChecksIgnored, 15 * 2 * 2);
  const rolledBack = tune(releases(15, { status: () => "rolled_back" }));
  assert.ok(rolledBack.metrics.every((m) => m.status === "insufficient"));
  const old = tune(releases(15, { daysBack: 400 }));
  assert.ok(old.releases < 15, "releases outside the window are ignored");
});

test("zero-baseline error rates propose max_increase within its own bounds", () => {
  const t = tune(releases(15, { zeroBaseline: true, spread: { error_rate: 0.02 } }));
  const inc = t.metrics.find((m) => m.kind === "max_increase")!;
  assert.equal(inc.status, "proposed");
  assert.ok(inc.proposed! >= DEFAULT_BOUNDS.maxIncrease.error_rate.floor && inc.proposed! <= 0.01);
  assert.equal(t.proposal?.after.max_increase?.error_rate, inc.proposed);
});

test("a long clean record shortens the bake, never below the floor; a rollback restores it", () => {
  const clean = tune(releases(25));
  assert.equal(clean.bake.status, "proposed");
  assert.equal(clean.bake.proposed, 0.75);
  assert.equal(clean.proposal?.after.bake_scale, 0.75);

  const longer = tune(releases(60), { bake_scale: 0.75 });
  assert.equal(longer.bake.proposed, 0.5);
  const atFloor = tune(releases(60), { bake_scale: 0.5 });
  assert.equal(atFloor.bake.status, "unchanged");

  const withRollback = tune(releases(25, { status: (i) => (i === 3 ? "rolled_back" : "promoted") }), { bake_scale: 0.5 });
  assert.equal(withRollback.bake.proposed, 1);
  assert.equal(withRollback.proposal?.after.bake_scale, undefined, "back to the org plan drops the key");
});

test("override helpers keep only known, finite values", () => {
  assert.deepEqual(cloneOverride({ max_regression: { a: 0.1, b: "x", c: -1 }, bake_scale: 0, extra: 1 }), { max_regression: { a: 0.1 } });
  assert.deepEqual(effectivePolicy(ORG, { max_regression: { latency_p95: 0.08 }, bake_scale: 0.5 }), {
    max_regression: { error_rate: 0.25, latency_p95: 0.08 }, max_increase: {}, bake_scale: 0.5,
  });
});

/* ------------------------------------ Weights ------------------------------------ */

function outcomes(spec: { n: number; rate: number; points: Partial<Record<FactorKey, number>> }[]): OutcomeObs[] {
  const out: OutcomeObs[] = [];
  let i = 0;
  for (const s of spec) {
    const bad = Math.round(s.n * s.rate);
    for (let k = 0; k < s.n; k++, i++) {
      const score = Object.values(s.points).reduce((a, b) => a + (b ?? 0), 0);
      out.push({ at: NOW - (i % 80) * DAY_MS, outcome: k < bad ? "rolled_back" : "promoted", score, points: s.points });
    }
  }
  return out;
}

test("weights: not enough releases or rollbacks is reported, nothing proposed", () => {
  const w = tuneWeights({ now: NOW, bounds: DEFAULT_BOUNDS, current: {}, observations: outcomes([{ n: 30, rate: 0.05, points: { no_tests: 10 } }]) });
  assert.equal(w.status, "insufficient");
  assert.equal(w.proposal, undefined);
  assert.match(w.note, /Needs 3 more rollbacks to learn from/);
});

test("weights: a factor that predicts rollbacks gains points, one with fewer rollbacks than releases without it loses some", () => {
  const obs = outcomes([
    { n: 40, rate: 0.3, points: { ai_authored: 10, diff_size: 8 } },
    { n: 40, rate: 0.05, points: { no_tests: 10, diff_size: 8 } },
    { n: 40, rate: 0.05, points: { sensitive_paths: 10 } },
    { n: 40, rate: 0.08, points: { diff_size: 15, sensitive_paths: 10 } },
  ]);
  const w = tuneWeights({ now: NOW, bounds: DEFAULT_BOUNDS, current: {}, observations: obs });
  assert.equal(w.status, "ready");
  const ai = w.factors.find((f) => f.key === "ai_authored")!;
  const noTests = w.factors.find((f) => f.key === "no_tests")!;
  assert.equal(ai.status, "proposed");
  assert.ok(ai.proposed! > 1 && ai.proposed! <= 1.5, `ai ${ai.proposed}: up, at most +50% in one proposal`);
  assert.equal(noTests.status, "proposed");
  assert.ok(noTests.proposed! < 1 && noTests.proposed! >= 0.5, `no tests ${noTests.proposed}: down, at most -50%`);
  // Factors never seen are not judged.
  assert.equal(w.factors.find((f) => f.key === "blast_radius")!.status, "insufficient");
  assert.ok(w.proposal);
  assert.equal(w.proposal.after.ai_authored, ai.proposed);
  // Expected effect replays the window: rolled-back releases score higher on average.
  assert.ok(w.proposal.effect.rolledBack.after > w.proposal.effect.rolledBack.before);
});

test("weights: a difference that could be chance is reported, not proposed", () => {
  const obs = outcomes([
    { n: 20, rate: 0.15, points: { ai_authored: 10 } },
    { n: 60, rate: 0.1, points: { diff_size: 8 } },
  ]);
  const w = tuneWeights({ now: NOW, bounds: DEFAULT_BOUNDS, current: {}, observations: obs });
  const ai = w.factors.find((f) => f.key === "ai_authored")!;
  assert.equal(ai.status, "unchanged");
  assert.match(ai.note, /Not enough evidence to change/);
  assert.equal(w.proposal?.after.ai_authored, undefined);
});

test("weights: re-running on the same data converges instead of compounding", () => {
  const obs = outcomes([
    { n: 40, rate: 0.3, points: { ai_authored: 10, diff_size: 8 } },
    { n: 40, rate: 0.05, points: { no_tests: 10, diff_size: 8 } },
    { n: 40, rate: 0.05, points: { sensitive_paths: 10 } },
  ]);
  // Each run moves at most ±50% towards the target sqrt(lift) (capped at 2); then it stops.
  let current = {};
  const seen: (number | undefined)[] = [];
  for (let i = 0; i < 4; i++) {
    const run = tuneWeights({ now: NOW, bounds: DEFAULT_BOUNDS, current, observations: obs });
    seen.push(run.factors.find((f) => f.key === "ai_authored")!.proposed);
    current = run.proposal?.after ?? current;
  }
  assert.deepEqual(seen, [1.5, 2, undefined, undefined]);
  // Without evidence an accepted weight drifts back towards the shared rules.
  const none = tuneWeights({ now: NOW, bounds: DEFAULT_BOUNDS, current: { ai_authored: 1.5 }, observations: outcomes([
    { n: 40, rate: 0.1, points: { ai_authored: 10 } }, { n: 40, rate: 0.1, points: { diff_size: 8 } },
  ]) });
  assert.equal(none.factors.find((f) => f.key === "ai_authored")!.proposed, 1);
  assert.equal(none.proposal?.after.ai_authored, undefined, "weight 1 is dropped from the stored weights");
});

test("weights stay within the cumulative bounds", () => {
  const obs = outcomes([
    { n: 40, rate: 0.6, points: { ai_authored: 10 } },
    { n: 40, rate: 0.02, points: { no_tests: 10 } },
    { n: 40, rate: 0.02, points: { sensitive_paths: 10 } },
    { n: 40, rate: 0.02, points: { diff_size: 8 } },
  ]);
  const w = tuneWeights({ now: NOW, bounds: DEFAULT_BOUNDS, current: { ai_authored: 1.9, no_tests: 0.3 }, observations: obs });
  assert.equal(w.proposal?.after.ai_authored, 2, "never above weights.max");
  assert.ok((w.proposal?.after.no_tests ?? 0.3) >= 0.25, "never below weights.min");
  for (const v of Object.values(w.proposal?.after ?? {})) assert.ok(v >= 0.25 && v <= 2);
});

test("expectedEffect rescales recorded points by the weight ratio", () => {
  const obs: OutcomeObs[] = [{ at: NOW, outcome: "rolled_back", score: 30, points: { ai_authored: 10, no_tests: 20 } }];
  const e = expectedEffect(obs, { no_tests: 2 }, { ai_authored: 1.5, no_tests: 1 });
  assert.deepEqual(e.rolledBack, { n: 1, before: 30, after: 25 });
});

/* ------------------------------ Applying weights to scores ------------------------------ */

test("weights apply in the portal scorer, rounding like Go, and change nothing when absent", () => {
  assert.equal(weigh(5, 1.5), 8);
  assert.equal(weigh(-5, 1.5), -8);
  assert.equal(weigh(10, 0), 0);
  assert.equal(weightFor({ no_tests: 9 }, "no_tests"), 4);
  assert.equal(weightFor({ no_tests: Number.NaN }, "no_tests"), 1);
  const services = [{ name: "web", paths: ["web/"], critical: false }];
  const change = { files: [{ path: "web/app.ts", added: 60, deleted: 0 }], authors: [], message: "", recentRollbacks: {} };
  const plain = scoreChange(services, change);
  assert.deepEqual(scoreChange(services, change, {}), plain);
  const tuned = scoreChange(services, change, { no_tests: 1.5 });
  assert.equal(tuned.score, plain.score + 5);
  const d = decidePull([{ filename: "web/app.ts", status: "modified", additions: 60, deletions: 0 }], [], { services, recentRollbacks: {}, weights: { no_tests: 1.5 } });
  assert.deepEqual(d.weights, { no_tests: 1.5 });
  assert.equal(d.risk.score, tuned.score);
});

test("Needs you shows one item for open tuning proposals", () => {
  assert.deepEqual(tuningInbox([]), []);
  const items = tuningInbox([
    { id: "b", kind: "service_policy", service: "api", summary: "api: error_rate +25% → +13%", created_at: "2026-10-27T10:00:00Z" },
    { id: "a", kind: "risk_weights", service: null, summary: "Risk weights: AI-authored ×1 → ×1.3", created_at: "2026-10-26T10:00:00Z" },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "tuning");
  assert.equal(items[0].subject, "Tuning proposals ready (2)");
  assert.equal(items[0].at, "2026-10-26T10:00:00Z");
  assert.equal(items[0].primary.href, "/app/policies/tuning");
  assert.match(items[0].reason, /thresholds for api; learned risk weights/);
});
