// Seeds a demo org into Postgres through the same data layer as real writes.
//
//   npm run db:seed [-- --now=2026-10-02T12:00:00Z --seed=42]
//
// Dev only and idempotent: the "acme" org is deleted and recreated on every
// run (users are kept and their passwords reset). It creates:
//   - org acme (slug acme), owner admin@acme.test and member dev@acme.test (password alror-demo)
//   - environments production and staging, the policy and 12 services
//   - ~30 days of deployment history with events (2 live rollouts), ported from
//     the former scripts/seed-demo.mjs generator (deterministic for a --seed/--now)
//   - a few audit and notification rows, a pending invite
//   - an API key (all scopes), printed and written to .alror-dev-key

import { writeFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { DeployEvent, Deployment, Level, Verdict } from "@/lib/console/types";
import { createApiKey } from "@/lib/server/auth/api-keys";
import { hashPassword } from "@/lib/server/auth/crypto";
import { createInvite } from "@/lib/server/auth/members";
import { systemActor, type OrgCtx } from "@/lib/server/context";
import { closeDb, db } from "@/lib/server/db";
import { memberships, orgs, users } from "@/lib/server/db/schema";
import { writeAudit } from "@/lib/server/data/audit";
import { appendEvent, upsertDeployment } from "@/lib/server/data/deployments";
import { createNotification } from "@/lib/server/data/notifications";
import { createOrgWithOwner } from "@/lib/server/data/orgs";
import { updatePolicy } from "@/lib/server/data/policy";
import { upsertServiceByName } from "@/lib/server/data/services";
import { closeRedis } from "@/lib/server/redis";

if (process.env.NODE_ENV === "production" && !process.argv.includes("--force")) {
  console.error("Refusing to seed with NODE_ENV=production (pass --force to override).");
  process.exit(1);
}

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=") || "true"];
  }),
);

const NOW = args.now ? Date.parse(args.now) : Math.floor(Date.now() / 60_000) * 60_000;
if (!Number.isFinite(NOW)) throw new Error(`bad --now: ${args.now}`);
const DAYS = 30;
const PASSWORD = "alror-demo";
const ORG = { slug: "acme", name: "Acme" };

// ---------- Deterministic PRNG (mulberry32) ----------
let seed = Number(args.seed ?? 42) >>> 0;
function rand() {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const chance = (p: number) => rand() < p;
const between = (a: number, b: number) => a + rand() * (b - a);
const int = (a: number, b: number) => Math.floor(between(a, b + 1));
const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
function weighted<T>(entries: [T, number][]): T {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of entries) if ((r -= w) <= 0) return v;
  return entries[entries.length - 1][0];
}
function normal(mu = 0, sigma = 1) {
  const u = 1 - rand();
  const v = rand();
  return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const hex = (n: number) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join("");

// ---------- Services ----------
type Svc = { name: string; paths: string[]; critical?: boolean; rate: number; err: number; p95: number; sensitive: string[]; version: number[] };
const SERVICES: Svc[] = [
  { name: "checkout-api", paths: ["services/checkout/"], critical: true, rate: 1.3, err: 0.21, p95: 182, sensitive: ["payment"], version: [3, 18, 0] },
  { name: "search-indexer", paths: ["services/search/"], rate: 0.9, err: 0.12, p95: 240, sensitive: [], version: [2, 7, 0] },
  { name: "notifications", paths: ["services/notifications/"], rate: 0.8, err: 0.31, p95: 96, sensitive: [], version: [1, 22, 0] },
  { name: "auth-gateway", paths: ["services/auth/"], critical: true, rate: 0.7, err: 0.08, p95: 64, sensitive: ["auth", "security"], version: [4, 3, 0] },
  { name: "web-frontend", paths: ["web/"], rate: 1.8, err: 0.42, p95: 310, sensitive: [], version: [1, 14, 0] },
  { name: "pricing-svc", paths: ["services/pricing/"], rate: 0.8, err: 0.17, p95: 118, sensitive: [], version: [2, 2, 0] },
  { name: "payments-ledger", paths: ["services/ledger/", "migrations/ledger/"], critical: true, rate: 0.6, err: 0.05, p95: 142, sensitive: ["ledger", "payment"], version: [5, 1, 0] },
  { name: "inventory-svc", paths: ["services/inventory/"], rate: 0.9, err: 0.19, p95: 88, sensitive: [], version: [1, 9, 0] },
  { name: "recommendations", paths: ["services/recs/", "ml/recs/"], rate: 1.0, err: 0.36, p95: 205, sensitive: [], version: [0, 31, 0] },
  { name: "api-gateway", paths: ["services/gateway/", "deploy/helm/gateway/"], critical: true, rate: 1.0, err: 0.09, p95: 54, sensitive: ["rbac", "helm"], version: [6, 0, 0] },
  { name: "billing-worker", paths: ["services/billing/"], critical: true, rate: 0.6, err: 0.14, p95: 410, sensitive: ["billing"], version: [2, 11, 0] },
  { name: "media-transcoder", paths: ["services/media/"], rate: 0.5, err: 0.48, p95: 820, sensitive: [], version: [1, 4, 0] },
];
const byName = new Map(SERVICES.map((s) => [s.name, s]));

const POLICY = { max_regression: { error_rate: 0.25, latency_p95: 0.15 } as Record<string, number>, alpha: 0.05 };
const MIN = 60_000_000_000; // one minute in nanoseconds
const PLANS: Record<Level, [number, number][]> = {
  low: [[25, 5 * MIN], [100, 0]],
  medium: [[5, 10 * MIN], [25, 10 * MIN], [50, 10 * MIN], [100, 0]],
  high: [[1, 15 * MIN], [5, 15 * MIN], [25, 15 * MIN], [50, 15 * MIN], [100, 0]],
};
const goDuration = (ns: number) => `${Math.round(ns / MIN)}m0s`;
const levelFor = (score: number): Level => (score >= 70 ? "high" : score >= 35 ? "medium" : "low");

const ts = (ms: number) => new Date(Math.floor(ms)).toISOString();
function idFor(ms: number) {
  const d = new Date(ms).toISOString();
  return `dep_${d.slice(0, 4)}${d.slice(5, 7)}${d.slice(8, 10)}T${d.slice(11, 13)}${d.slice(14, 16)}${d.slice(17, 19)}_${hex(6)}`;
}

// ---------- Risk ----------
type Risk = Deployment["risk"];
const rollbackLog: { service: string; at: number }[] = [];
const recentRollbacks = (service: string, at: number) =>
  rollbackLog.filter((r) => r.service === service && r.at < at && r.at > at - 30 * 864e5).length;

function scoreChange(svc: Svc, at: number, opts: { forceLevel?: Level; ai?: boolean } = {}): Risk {
  const factors: { name: string; detail: string; points: number }[] = [];
  const add = (name: string, detail: string, points: number) => {
    if (points) factors.push({ name, detail, points });
  };
  const services = new Set([svc.name]);

  if (!opts.forceLevel && chance(0.04)) {
    const docs = int(1, 6);
    return { score: 2, level: "low", factors: [{ name: "Docs only", detail: `${docs} documentation files`, points: 2 }], services: [svc.name], ai_authored: false };
  }

  const lines = Math.max(4, Math.round(Math.exp(normal(4.85, 1.1)) * (opts.forceLevel === "high" || chance(0.12) ? 4 : 1)));
  const files = Math.max(1, Math.round(lines / between(18, 40)));
  if (lines >= 1000) add("Large diff", `${lines} lines changed`, 30);
  else if (lines >= 500) add("Large diff", `${lines} lines changed`, 22);
  else if (lines >= 200) add("Medium diff", `${lines} lines changed`, 15);
  else if (lines >= 50) add("Small diff", `${lines} lines changed`, 8);
  if (files > 50) add("Many files", `${files} files touched`, 12);
  else if (files > 20) add("Many files", `${files} files touched`, 8);

  const extra = chance(0.05) ? 2 : chance(0.17) ? 1 : 0;
  while (services.size < 1 + extra) services.add(pick(SERVICES).name);
  const svcList = [...services].sort();
  if (svcList.length > 1) add("Blast radius", `touches ${svcList.length} services: ${svcList.join(", ")}`, Math.min(8 * (svcList.length - 1), 20));
  const crit = svcList.find((n) => byName.get(n)?.critical);
  if (crit) add("Critical service", `${crit} is marked critical`, 12);

  const hits = new Set<string>();
  for (const k of svc.sensitive) if (chance(0.55)) hits.add(k);
  if (chance(0.1)) hits.add(pick(["migration", "schema", "terraform", "helm", "iam"]));
  if (hits.size) add("Sensitive paths", `changes in ${[...hits].sort().join(", ")}`, Math.min(10 * hits.size, 20));

  const code = Math.max(1, Math.round(files * between(0.5, 0.9)));
  const testRoll = rand();
  if (testRoll < 0.4) add("No tests changed", `${code} code files, 0 test files`, 10);
  else if (testRoll > 0.7) add("Well tested", `${Math.ceil(code / 2) + int(0, 2)} test files for ${code} code files`, -5);

  const ai = opts.ai ?? chance(0.42);
  if (ai) add("AI-authored", "commit authors or trailers indicate a coding agent", 10);

  const rb = svcList.reduce((s, n) => s + recentRollbacks(n, at), 0);
  if (rb > 0) add("Recent rollbacks", `${rb} rollbacks on these services in 30 days`, Math.min(6 * rb, 18));

  if (factors.length === 0) add("Small diff", `${lines} lines changed`, Math.max(1, Math.round(lines / 12)));
  const score = Math.max(0, Math.min(100, factors.reduce((s, f) => s + f.points, 0)));
  factors.sort((a, b) => b.points - a.points);
  return { score, level: levelFor(score), factors, services: svcList, ai_authored: ai };
}

// ---------- Verification ----------
function metricResult(metric: string, svc: Svc, fail: boolean) {
  const base = metric === "error_rate" ? svc.err * between(0.85, 1.15) : svc.p95 * between(0.92, 1.08);
  const limit = POLICY.max_regression[metric];
  let delta: number;
  let p: number;
  if (fail) {
    delta = between(limit + 0.08, metric === "error_rate" ? 1.4 : 0.7);
    p = chance(0.6) ? 0 : between(0, 0.004);
  } else {
    delta = normal(-0.005, metric === "error_rate" ? 0.07 : 0.035);
    if (delta > limit * 0.8) delta = limit * between(0.2, 0.7);
    p = delta <= 0 ? between(0.45, 0.999) : Math.max(0.06, between(0.08, 0.6) - delta);
  }
  const r: { metric: string; canary: number; baseline: number; delta: number; p_value: number; pass: boolean; reason?: string } = {
    metric,
    canary: base * (1 + delta),
    baseline: base,
    delta,
    p_value: p,
    pass: !fail,
  };
  if (fail) r.reason = `up ${Math.round(delta * 100)}% vs baseline (limit ${Math.round(limit * 100)}%, p=${p.toFixed(3)})`;
  return r;
}

function verdict(svc: Svc, failMetric: string | null): Verdict {
  const results = ["error_rate", "latency_p95"].map((m) => metricResult(m, svc, m === failMetric));
  const failed = results.filter((r) => !r.pass);
  const summary = failed.length ? "Regression: " + failed.map((r) => `${r.metric} ${r.reason}`).join("; ") : `No regression across ${results.length} metrics`;
  return { pass: failed.length === 0, results, summary };
}

// ---------- Deployment simulation ----------
const prCounter = { n: 4180 };
function nextRef() {
  prCounter.n += int(1, 6);
  return chance(0.08) ? hex(7) : `#${prCounter.n}`;
}
function nextImage(svc: Svc, risk: Risk) {
  const v = svc.version;
  if (risk.level === "high" && chance(0.25)) {
    v[1] += 1;
    v[2] = 0;
  } else v[2] += 1;
  return `registry/${svc.name}:${v.join(".")}`;
}

type Outcome = "promoted" | "auto_rollback" | "failed" | "manual" | { step: number };
type Sim = { d: Deployment; events: DeployEvent[]; source: "ci" | "cli" };

function simulate(svc: Svc, start: number, risk: Risk, outcome: Outcome): Sim {
  const steps = PLANS[risk.level].map(([weight, bake]) => ({ weight, bake }));
  const d: Deployment = {
    id: idFor(start),
    service: svc.name,
    image: nextImage(svc, risk),
    ref: nextRef(),
    risk,
    plan: { strategy: "canary", steps },
    status: "rolling",
    step_index: 0,
    weight: 0,
    created_at: ts(start),
    updated_at: ts(start),
  };
  const events: DeployEvent[] = [];
  let t = start;
  const emit = (kind: DeployEvent["kind"], message: string, weight?: number, v?: Verdict) => {
    const e: DeployEvent = { at: ts(t), kind, message };
    if (weight) e.weight = weight;
    if (v) e.verdict = v;
    events.push(e);
    d.updated_at = e.at;
  };
  emit("created", `Risk ${risk.score} (${risk.level}) · canary plan with ${steps.length} steps`);

  const canaryCount = steps.length - 1;
  const failAt = outcome === "auto_rollback" ? Math.min(canaryCount - 1, Math.floor(Math.pow(rand(), 1.8) * canaryCount)) : -1;
  const errorAt = outcome === "failed" ? int(0, canaryCount - 1) : -1;
  const rolling = typeof outcome === "object" ? outcome : null;

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    d.step_index = i;
    d.weight = s.weight;
    t += between(40, 900);
    if (s.weight >= 100) {
      d.status = "promoted";
      emit("promoted", `Verified at every step · promoted ${svc.name} to 100%`, 100);
      break;
    }
    if (i === errorAt) {
      d.status = "failed";
      const msg = pick([
        `simulated: set weight ${s.weight}%: upstream connect timeout after 30s`,
        `simulated: set weight ${s.weight}%: mesh route conflict on ${svc.name}-canary`,
        `metrics: query ${pick(["error_rate", "latency_p95"])}: provider returned 503`,
        "interrupted: context canceled",
      ]);
      d.reason = msg;
      t += between(2000, 25000);
      emit("error", msg, s.weight);
      break;
    }
    emit("step", `Canary at ${s.weight}% · baking ${goDuration(s.bake)}`, s.weight);
    if (rolling && i === rolling.step) break; // mid-bake: no verdict yet
    t += s.bake / 1e6 + between(600, 2400);
    const failMetric = i === failAt ? weighted<string>([["error_rate", 0.6], ["latency_p95", 0.4]]) : null;
    const v = verdict(svc, failMetric);
    emit("verdict", v.summary, s.weight, v);
    if (!v.pass) {
      d.status = "rolled_back";
      d.reason = v.summary;
      t += between(800, 4000);
      emit("rolled_back", `Rolled back at ${s.weight}% traffic · ${v.summary}`, s.weight);
      rollbackLog.push({ service: svc.name, at: start });
      break;
    }
  }

  if (outcome === "manual" && d.status === "promoted") {
    t += between(25, 300) * 60_000;
    const reason = pick([
      "elevated 5xx reported by on-call",
      "customer-facing regression in checkout flow",
      "memory growth after promotion",
      "rolled back from console",
      "reverting to unblock hotfix",
    ]);
    d.status = "rolled_back";
    d.reason = reason;
    d.weight = 0;
    emit("rolled_back", `Manual rollback · ${reason}`);
    rollbackLog.push({ service: svc.name, at: start });
  }
  return { d, events, source: chance(0.8) ? "ci" : "cli" };
}

// ---------- Schedule ----------
const DOW = [0.15, 0.85, 1.3, 1.35, 1.2, 0.6, 0.15];
const BASE_PER_DAY = 8.6;
function poisson(lambda: number) {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand();
  } while (p > L);
  return k - 1;
}

function generate(): Sim[] {
  const plan: number[] = [];
  const now = new Date(NOW);
  const startDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (DAYS - 1) * 864e5;
  for (let day = 0; day < DAYS; day++) {
    const dayStart = startDay + day * 864e5;
    const n = poisson(BASE_PER_DAY * DOW[new Date(dayStart).getUTCDay()]);
    for (let k = 0; k < n; k++) {
      const hour = Math.max(7, Math.min(23.5, normal(15.5, 3.4)));
      const at = dayStart + hour * 3600_000 + between(0, 59_000);
      if (at > NOW - 50 * 60_000) continue; // the last hour belongs to the live rollouts
      plan.push(at);
    }
  }
  plan.sort((a, b) => a - b);

  const rateTable: [Svc, number][] = SERVICES.map((s) => [s, s.rate]);
  const out: Sim[] = [];
  for (const at of plan) {
    const svc = weighted(rateTable);
    const risk = scoreChange(svc, at);
    const pFail = { low: 0.015, medium: 0.075, high: 0.26 }[risk.level] * (risk.ai_authored ? 1.25 : 1);
    const r = rand();
    let outcome: Outcome = "promoted";
    if (r < pFail) outcome = "auto_rollback";
    else if (r < pFail + 0.012) outcome = "failed";
    else if (r < pFail + 0.012 + 0.014) outcome = "manual";
    out.push(simulate(svc, at, risk, outcome));
  }

  {
    const svc = byName.get("payments-ledger")!;
    const risk = scoreChange(svc, NOW, { forceLevel: "high", ai: true });
    if (risk.level !== "high") Object.assign(risk, { level: "high", score: Math.max(risk.score, 74) });
    out.push(simulate(svc, NOW - 36 * 60_000 - 20_000, risk, { step: 2 }));
  }
  {
    const svc = byName.get("web-frontend")!;
    let risk = scoreChange(svc, NOW);
    for (let i = 0; risk.level !== "medium" && i < 50; i++) risk = scoreChange(svc, NOW);
    out.push(simulate(svc, NOW - 24 * 60_000 - 40_000, risk, { step: 2 }));
  }
  return out;
}

// ---------- Write through the data layer ----------

async function upsertUser(email: string, name: string): Promise<string> {
  const passwordHash = await hashPassword(PASSWORD);
  const [u] = await db
    .insert(users)
    .values({ email, name, passwordHash })
    .onConflictDoUpdate({ target: users.email, set: { name, passwordHash } })
    .returning({ id: users.id });
  return u.id;
}

async function main() {
  const started = Date.now();
  const sims = generate();

  // Idempotency: drop the previous demo org (cascades to everything it owns).
  await db.delete(orgs).where(eq(orgs.slug, ORG.slug));

  const adminId = await upsertUser("admin@acme.test", "Acme Admin");
  const devId = await upsertUser("dev@acme.test", "Dana Developer");

  const org = await db.transaction(async (tx) => {
    const o = await createOrgWithOwner(tx, { name: ORG.name, slug: ORG.slug, ownerId: adminId, plan: "team" });
    await tx.insert(memberships).values({ orgId: o.id, userId: devId, role: "member" });
    return o;
  });

  const admin: OrgCtx = {
    orgId: org.id,
    actor: { type: "user", id: adminId, label: "admin@acme.test", userId: adminId, role: "owner", scopes: ["deploy:read", "deploy:write", "config:write"] },
  };

  await writeAudit(admin, "org.create", org.slug, { seeded: true });
  await writeAudit(admin, "member.add", "dev@acme.test", { role: "member" });

  for (const s of SERVICES) {
    await upsertServiceByName(admin, { name: s.name, paths: s.paths, target: "simulated", critical: s.critical ?? false });
  }
  await writeAudit(admin, "config.push", "config", { services_created: SERVICES.map((s) => s.name) });
  await updatePolicy(admin, {
    max_regression: POLICY.max_regression,
    alpha: POLICY.alpha,
    auto_rollback: true,
    bake_scale: 0.003,
    metrics: { provider: "synthetic" },
  });

  // Deployments and events. Terminal side effects (notification + audit) only
  // for the 8 most recent finished deployments, so the inbox holds a handful of items.
  const notify = new Set(
    sims
      .filter((s) => s.d.status !== "rolling")
      .slice(-8)
      .map((s) => s.d.id),
  );
  let events = 0;
  for (const { d, events: evs, source } of sims) {
    const ctx: OrgCtx = { orgId: org.id, actor: { ...systemActor(), label: source === "ci" ? "ci" : "alror cli" } };
    // Write the initial state first, then the final one, like the engine does.
    await upsertDeployment(ctx, { ...d, status: "rolling", step_index: 0, weight: 0, reason: undefined, updated_at: d.created_at, source },
      { sideEffects: false, trustTimestamps: true },
    );
    for (const e of evs) {
      await appendEvent(ctx, d.id, e);
      events++;
    }
    await upsertDeployment(ctx, { ...d, source }, { sideEffects: notify.has(d.id), trustTimestamps: true });
  }

  await createNotification(org.id, {
    kind: "org.welcome",
    title: "Welcome to Alror",
    body: "Connect the CLI with `alror login --server http://localhost:3000 --key <key>` and run `alror runner` to process console jobs.",
    href: "/app",
  });
  await createNotification(org.id, {
    userId: devId,
    kind: "member.joined",
    title: "You joined acme",
    body: "Admin added you to the acme organization as a member.",
    href: "/app",
  });

  await createInvite(admin, { email: "ops@acme.test", role: "admin" });
  const { token, key } = await createApiKey(
    admin,
    { name: "dev (seed)", scopes: ["deploy:read", "deploy:write", "jobs:run", "config:write"] },
    { authorized: true },
  );

  const keyFile = path.resolve(process.cwd(), ".alror-dev-key");
  writeFileSync(keyFile, token + "\n", { mode: 0o600 });

  // ---------- Summary ----------
  const all = sims.map((s) => s.d);
  const count = (f: (d: Deployment) => boolean) => all.filter(f).length;
  const finished = count((d) => d.status !== "rolling");
  const bad = count((d) => d.status === "rolled_back" || d.status === "failed");
  console.log(`Seeded org "${org.slug}" (${org.id}) in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`  users: admin@acme.test (owner), dev@acme.test (member) · password ${PASSWORD}`);
  console.log(`  ${all.length} deployments, ${events} events across ${new Set(all.map((d) => d.service)).size} services`);
  console.log(
    `  promoted ${count((d) => d.status === "promoted")} · rolled back ${count((d) => d.status === "rolled_back")} · failed ${count((d) => d.status === "failed")} · rolling ${count((d) => d.status === "rolling")}`,
  );
  console.log(`  change failure rate ${((bad / finished) * 100).toFixed(1)}% · AI-authored ${((count((d) => d.risk.ai_authored) / all.length) * 100).toFixed(0)}%`);
  console.log(`  API key "${key.name}" (${key.scopes.join(", ")}):`);
  console.log(`    ${token}`);
  console.log(`  written to ${keyFile}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
    await closeRedis();
  });
