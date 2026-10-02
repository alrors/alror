import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRolloutTree } from "../src/lib/console/rollout-tree";
import { headline } from "../src/components/console/release-story";
import type { DeployEvent, Deployment, Status } from "../src/lib/console/types";

const at = "2026-10-03T12:00:00Z";
const now = Date.parse("2026-10-03T12:02:00Z");
function deployment(status: Status): Deployment {
  return { id: "test", service: "api", image: "api:test", risk: { score: 20, level: "low", factors: [], services: [], ai_authored: false }, plan: { strategy: "canary", steps: [{ weight: 5, bake: 300e9 }, { weight: 50, bake: 300e9 }, { weight: 100, bake: 0 }] }, status, step_index: 0, weight: status === "promoted" ? 100 : 5, created_at: at, updated_at: at };
}
function step(weight: number): DeployEvent { return { at, kind: "step", weight, message: "shift" }; }
function verdict(weight: number, pass: boolean): DeployEvent {
  return { at, kind: "verdict", weight, message: "verdict", verdict: { pass, summary: "verdict", results: [{ metric: "error_rate", canary: 0.02, baseline: 0.01, delta: 1, p_value: 0.001, pass }] } };
}
const promoted: DeployEvent = { at, kind: "promoted", weight: 100, message: "promoted" };
const successful = [step(5), verdict(5, true), step(50), verdict(50, true), promoted];

test("promotion counts canary verification separately from promotion", () => {
 const d = deployment("promoted"), tree = buildRolloutTree(d, successful, now);
 assert.equal(tree.outcome, "promoted");
 assert.equal(tree.liveWeight, 100);
 assert.match(headline(d, successful, tree, {}, now), /2 of 2 canary stages/);
});
test("shadow continuation retains failed metrics and opens warning details", () => {
 const d = deployment("promoted");
 const events = [step(5), verdict(5, false), { at, kind: "verdict" as const, weight: 5, message: "Shadow mode: continuing" }, step(50), verdict(50, true), promoted];
 const tree = buildRolloutTree(d, events, now);
 assert.equal(tree.stages[0].state, "warning");
 assert.equal(tree.stages[0].open, true);
 assert.ok(tree.stages[0].children.some(c => c.kind === "metric" && !c.result.pass));
 assert.equal(tree.stages[1].state, "pass");
 assert.match(headline(d, events, tree, {}, now), /1 of 2 canary stages.*1 continued despite warnings/);
});
test("automatic rollback stops at failing stage and skips later stages", () => {
 const tree = buildRolloutTree(deployment("rolled_back"), [step(5), verdict(5, false), { at, kind: "rolled_back", weight: 5, message: "regression" }], now);
 assert.equal(tree.outcome, "rolled_back");
 assert.equal(tree.liveWeight, 0);
 assert.deepEqual(tree.stages.map(s => s.state), ["fail", "skipped", "skipped"]);
});
test("manual rollback after promotion preserves successful history", () => {
 const tree = buildRolloutTree(deployment("rolled_back"), [...successful, { at, kind: "rolled_back", message: "Manual rollback" }], now);
 assert.equal(tree.outcome, "manual_rollback");
 assert.deepEqual(tree.stages.map(s => s.state), ["pass", "pass", "pass"]);
 assert.equal(tree.stages[2].open, true);
});
test("manual rollback during rollout skips later stages", () => {
 const tree = buildRolloutTree(deployment("rolled_back"), [step(5), { at, kind: "rolled_back", message: "Manual rollback" }], now);
 assert.equal(tree.outcome, "manual_rollback");
 assert.deepEqual(tree.stages.map(s => s.state), ["fail", "skipped", "skipped"]);
});
test("driver failures do not claim successful traffic restoration", () => {
 const d = deployment("failed"), events: DeployEvent[] = [step(5), { at, kind: "error", weight: 5, message: "driver unavailable" }];
 const tree = buildRolloutTree(d, events, now);
 const notes = tree.stages.flatMap(s => s.children).filter(c => c.kind === "note").map(c => c.text).join(" ");
 assert.equal(tree.outcome, "failed");
 assert.match(notes, /restoration is unconfirmed/);
 assert.doesNotMatch(notes, /traffic returned to stable/);
 assert.match(headline(d, events, tree, {}, now), /restoration is unconfirmed/);
});
test("missing events preserve terminal status without inventing history or manual rollback", () => {
 for (const status of ["promoted", "failed", "rolled_back"] as const) {
  const d = deployment(status), tree = buildRolloutTree(d, [], now);
  assert.equal(tree.outcome, status);
  assert.ok(tree.stages.every(s => s.state === "pending" && s.children.length === 0));
  if (status === "rolled_back") assert.doesNotMatch(headline(d, [], tree, {}, now), /manually/);
 }
 assert.equal(buildRolloutTree(deployment("rolled_back"), successful, now).outcome, "rolled_back");
});
test("rolling timers are estimates and tolerate invalid timestamps", () => {
 const d = deployment("rolling"), tree = buildRolloutTree(d, [step(5)], now);
 assert.equal(tree.stages[0].remainingMs, 180000);
 assert.match(headline(d, [], tree, {}, now), /Estimated bake time remaining/);
 assert.equal(buildRolloutTree(d, [{ ...step(5), at: "invalid" }], now).stages[0].remainingMs, undefined);
});
test("empty plans retain outcome without manufacturing stages", () => {
 const d = deployment("promoted"); d.plan.steps = [];
 const tree = buildRolloutTree(d, [promoted], now);
 assert.equal(tree.outcome, "promoted");
 assert.equal(tree.stages.length, 0);
 assert.match(headline(d, [promoted], tree, {}, now), /no canary verification stages/);
});
