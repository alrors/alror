import assert from "node:assert/strict";
import { test } from "node:test";
import { explainRelease, gateFindings, impact, isManualRollback, pullInbox, releaseDid, releaseInbox, requiredCheckStates } from "../src/lib/console/oversight";
import type { DeployEvent, Deployment, MetricResult, Status } from "../src/lib/console/types";
import type { DecisionView } from "../src/lib/server/github/types";

const at = "2026-10-03T12:00:00Z";
const later = "2026-10-03T12:15:00Z";
const now = Date.parse("2026-10-03T13:00:00Z");
const limits = { error_rate: 0.25, latency_p95: 0.15 };

function dep(status: Status, extra: Partial<Deployment> = {}): Deployment {
  return { id: `d-${status}`, service: "api", ref: "#1", image: "api:1", risk: { score: 20, level: "low", factors: [], services: [], ai_authored: false }, plan: { strategy: "canary", steps: [{ weight: 5, bake: 1 }, { weight: 100, bake: 0 }] }, status, step_index: 0, weight: 5, created_at: at, updated_at: later, ...extra };
}
function verdict(results: MetricResult[], weight = 5): DeployEvent {
  return { at: later, kind: "verdict", weight, message: "v", verdict: { pass: results.every((r) => r.pass), summary: "", results } };
}
const metric = (m: string, delta: number, pass: boolean, reason?: string): MetricResult => ({ metric: m, canary: 1 + delta, baseline: 1, delta, p_value: pass ? 0.5 : 0.001, pass, reason });
function decision(extra: Partial<DecisionView>): DecisionView {
  return { id: "x", repositoryId: "1", repository: "acme/web", pullNumber: 7, title: "Change", url: "https://github.com/acme/web/pull/7", headSha: "abc", outcome: "eligible", score: 0, reasons: [], mode: "auto_merge", updatedAt: at, ...extra };
}

test("gate findings split protected files, allowlist files and checks", () => {
  const f = gateFindings([
    "Protected changes need review: a/auth/x.ts, b/payments/y.ts, c, d, e, ….",
    "Changes outside the automatic-merge allowlist: src/a.ts.",
    "Waiting for ci from GitHub App 12.",
    "Required check lint did not pass (failure).",
    "Code changed without added or updated tests.",
  ]);
  assert.deepEqual(f.protectedFiles, ["a/auth/x.ts", "b/payments/y.ts", "c", "d", "e"]);
  assert.equal(f.protectedTruncated, true);
  assert.deepEqual(f.outsideFiles, ["src/a.ts"]);
  assert.deepEqual(f.waitingChecks, ["ci"]);
  assert.deepEqual(f.failedChecks, [{ name: "lint", conclusion: "failure" }]);
  assert.deepEqual(f.other, ["Code changed without added or updated tests."]);
  const states = requiredCheckStates([{ name: "ci", appId: 12 }, { name: "lint", appId: 12 }, { name: "build", appId: 12 }], { outcome: "review_required", reasons: ["Waiting for ci from GitHub App 12.", "Required check lint did not pass (failure)."] });
  assert.deepEqual(states.map((s) => s.state), ["pending", "failed", "passed"]);
});

test("pull inbox: review required, long waits, and not eligible ones", () => {
  const items = pullInbox(
    [
      decision({ pullNumber: 1, outcome: "review_required", reasons: ["Protected changes need review: auth/a.ts."] }),
      decision({ pullNumber: 2, outcome: "waiting", reasons: ["Waiting for ci from GitHub App 1."] }),
      decision({ pullNumber: 3, outcome: "waiting", updatedAt: new Date(now - 60_000).toISOString() }),
      decision({ pullNumber: 4, outcome: "eligible" }),
    ],
    now,
  );
  assert.deepEqual(items.map((i) => i.kind), ["pull_review", "pull_waiting"]);
  assert.match(items[0].reason, /protected paths \(auth\/a\.ts\)/);
  assert.equal(items[0].secondary?.href, "/app/github/repositories/1/pulls/1");
});

test("release inbox: unconfirmed rollback, thin data, borderline; newer release supersedes", () => {
  const failed = dep("failed", { id: "f", service: "a" });
  const thin = dep("promoted", { id: "t", service: "b" });
  const close = dep("promoted", { id: "c", service: "c" });
  const old = dep("failed", { id: "o", service: "d", created_at: "2026-10-03T10:00:00Z" });
  const newer = dep("promoted", { id: "n", service: "d", created_at: "2026-10-03T11:00:00Z" });
  const events = new Map<string, DeployEvent[]>([
    ["f", [{ at: later, kind: "error", weight: 5, message: "mesh conflict" }]],
    ["t", [verdict([metric("error_rate", 0, true, "insufficient data (3/40 samples, need 20)")])]],
    ["c", [verdict([metric("latency_p95", 0.13, true)])]],
    ["n", [verdict([metric("error_rate", 0.01, true)])]],
  ]);
  const items = releaseInbox([failed, thin, close, old, newer], events, limits, now);
  assert.deepEqual(items.map((i) => [i.kind, i.subject]), [["rollback_unconfirmed", "a #1"], ["insufficient_data", "b #1"], ["borderline", "c #1"]]);
  assert.match(items[0].reason, /mesh conflict/);
});

test("release explanations and feed reasons come from verdicts", () => {
  const rb = dep("rolled_back");
  const ev = [verdict([metric("error_rate", 1.25, false, "up 125% vs baseline (limit 25%, p=0.001)")]), { at: later, kind: "rolled_back" as const, weight: 5, message: "Rolled back" }];
  assert.equal(isManualRollback(ev), false);
  assert.match(explainRelease(rb, ev, limits).title, /automatically at 5% because error rate rose 125% vs baseline, past its \+25% limit/);
  assert.match(releaseDid(rb, ev).reason, /Error rate rose 125% vs baseline at 5% traffic/);
  const manual = [{ at: later, kind: "rolled_back" as const, message: "Manual rollback · hotfix" }];
  assert.equal(isManualRollback(manual), true);
  assert.match(explainRelease(rb, manual, limits).title, /by a person: hotfix/);
  const p = explainRelease(dep("promoted"), [verdict([metric("error_rate", 0.01, true)])], limits);
  assert.match(p.title, /1 of 1 verification check passed/);
});

test("impact counts only the window and splits automatic rollbacks", () => {
  const w = { start: Date.parse("2026-10-03T00:00:00Z"), end: now };
  const deps = [dep("promoted", { id: "p" }), dep("rolled_back", { id: "r1" }), dep("rolled_back", { id: "r2" }), dep("promoted", { id: "old", updated_at: "2026-09-01T00:00:00Z" })];
  const i = impact(deps, new Set(["r2"]), w, null);
  assert.equal(i.finished, 3);
  assert.equal(i.stopped, 1);
  assert.equal(i.rollbacks, 2);
  assert.equal(i.restoreMs, 15 * 60_000);
  assert.equal(i.prsAutoMerged, null);
});
