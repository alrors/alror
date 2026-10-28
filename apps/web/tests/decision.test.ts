import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { decidePull } from "../src/lib/server/decision/decide";
import { levelFor, planFor, rules, scoreChange, sensitiveArea, type RiskFactor, type RiskWeights, type ServiceRule } from "../src/lib/server/decision/score";

// Shared fixtures: copies of internal/risk/testdata/fixtures (node scripts/sync-rules.mjs). The same files run in
// `go test ./internal/risk`, so the CLI and the portal score every case identically.
type Fixture = {
  name: string; description: string; services: ServiceRule[]; weights?: RiskWeights;
  change: { files: { path: string; added: number; deleted: number }[]; authors: string[]; message: string; recent_rollbacks: Record<string, number> };
  expected: { score: number; level: string; factors: RiskFactor[]; services: string[]; ai_authored: boolean; plan: { strategy: string; steps: { weight: number; bake_seconds: number }[] } };
};
const dir = join(import.meta.dirname, "fixtures", "risk");
const fixtures: Fixture[] = readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));

test("at least 12 shared fixtures are present", () => assert(fixtures.length >= 12, `found ${fixtures.length}`));

for (const fx of fixtures) {
  test(`shared fixture ${fx.name}: ${fx.description}`, () => {
    const risk = scoreChange(fx.services, { files: fx.change.files, authors: fx.change.authors, message: fx.change.message, recentRollbacks: fx.change.recent_rollbacks }, fx.weights);
    assert.deepEqual({ ...risk, plan: planFor(risk.level) }, fx.expected);
  });
}

test("level thresholds and plans come from the rules file", () => {
  assert.equal(levelFor(rules.levels.medium - 1), "low");
  assert.equal(levelFor(rules.levels.medium), "medium");
  assert.equal(levelFor(rules.levels.high), "high");
  for (const level of ["low", "medium", "high"] as const) assert.equal(planFor(level).steps.at(-1)?.weight, 100);
  assert.equal(sensitiveArea("db/migrations/0042_add_ledger.sql"), "migration");
});

test("a pull request's commits feed AI authorship and file changes feed the score", () => {
  const decision = decidePull(
    [{ filename: "web/hooks/useCart.ts", status: "modified", additions: 10, deletions: 0 }],
    [{ commit: { message: "Add cart hook", author: { name: "Copilot", email: "198982749+Copilot@users.noreply.github.com" } }, author: { login: "Copilot" } }],
    { services: [{ name: "web", paths: ["web/"], critical: false }], recentRollbacks: {} },
  );
  assert.equal(decision.rulesVersion, rules.version);
  assert.equal(decision.risk.ai_authored, true);
  assert.deepEqual(decision.risk.services, ["web"]);
  assert.equal(decision.risk.score, 20);
  assert.equal(decision.plan.steps.length, 2);
});
