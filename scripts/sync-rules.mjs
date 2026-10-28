#!/usr/bin/env node
// Copies the canonical shared risk rules and fixtures from internal/risk (Go,
// embedded at build time) to the portal (apps/web), which deploys on its own
// and cannot read files outside apps/web.
//
//   node scripts/sync-rules.mjs          copy rules.json and fixtures to apps/web
//   node scripts/sync-rules.mjs --check  exit 1 if any copy differs (CI)
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const fixturesSrc = join(root, "internal/risk/testdata/fixtures");
const fixturesDst = join(root, "apps/web/tests/fixtures/risk");

const fixtures = readdirSync(fixturesSrc).filter((f) => f.endsWith(".json")).sort();
const pairs = [
  [join(root, "internal/risk/rules.json"), join(root, "apps/web/src/lib/server/decision/rules.json")],
  ...fixtures.map((f) => [join(fixturesSrc, f), join(fixturesDst, f)]),
];
const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const rel = (p) => p.slice(root.length + 1).replace(/\\/g, "/");

const drift = [];
for (const [src, dst] of pairs) {
  if (existsSync(dst) && read(src) === read(dst)) continue;
  drift.push(rel(dst));
  if (!check) { mkdirSync(dirname(dst), { recursive: true }); copyFileSync(src, dst); }
}
const extra = existsSync(fixturesDst) ? readdirSync(fixturesDst).filter((f) => f.endsWith(".json") && !fixtures.includes(f)) : [];
for (const f of extra) {
  drift.push(`${rel(join(fixturesDst, f))} (no canonical fixture)`);
  if (!check) rmSync(join(fixturesDst, f));
}

if (check && drift.length) {
  console.error(`Shared risk rules drifted from internal/risk. Run node scripts/sync-rules.mjs and commit:\n  ${drift.join("\n  ")}`);
  process.exit(1);
}
console.log(drift.length ? `Synced ${drift.length} file(s):\n  ${drift.join("\n  ")}` : `Shared risk rules in sync (${pairs.length} files).`);
