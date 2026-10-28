// Integration tests for alert intake, incidents and "what changed?" rollbacks,
// run against the live dev server and database.
//
//   npm run dev                         (in another terminal)
//   ALROR_TEST_URL=http://localhost:3000 node --env-file-if-exists=.env.local --conditions=react-server \
//     --import tsx --test --test-concurrency=1 tests/incidents-api.test.ts
//
// Each run signs up two fresh orgs (A and B) and deletes them at the end.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { createApiKey } from "@/lib/server/auth/api-keys";
import type { OrgCtx } from "@/lib/server/context";
import { revokeAlertSecret, rotateAlertSecret, updateAlertSettings } from "@/lib/server/data/alert-settings";
import { listOpenIncidents } from "@/lib/server/data/incidents";
import { createService } from "@/lib/server/data/services";
import { closeDb, db } from "@/lib/server/db";
import { auditLog, notifications, orgs, users } from "@/lib/server/db/schema";
import { closeRedis } from "@/lib/server/redis";

const BASE = (process.env.ALROR_TEST_URL || "http://localhost:3000").replace(/\/$/, "");
const RUN = randomBytes(4).toString("hex");
const PASSWORD = "test-password-123";

type Json = Record<string, unknown>;
type Res = { status: number; body: Json & Json[] };

const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

async function call(method: string, path: string, opts: { body?: unknown; raw?: string; headers?: Record<string, string>; ip?: string } = {}): Promise<Res & { headers: Headers }> {
  const headers: Record<string, string> = { "x-forwarded-for": opts.ip ?? ip(), ...opts.headers };
  if (opts.body !== undefined || opts.raw !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(BASE + path, { method, headers, body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)), redirect: "manual" });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed as Json & Json[], headers: res.headers };
}

const emails = { a: `inc-a-${RUN}@test.alror`, b: `inc-b-${RUN}@test.alror` };
const orgIds: string[] = [];
let ctxA: OrgCtx;
let ctxB: OrgCtx;
let keyA: string;
let readA: string;
let keyB: string;
let secretA: string;
let secretB: string;

const bearer = (k: string) => ({ authorization: `Bearer ${k}` });
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const depId = (s: string) => `dep_${RUN}T000000_${s}`;
const STEP_NS = 60_000_000_000;

function deployment(id: string, service: string, over: Json = {}): Json {
  return {
    id,
    service,
    image: `registry/${service}:1.4.${Math.floor(Math.random() * 100)}`,
    risk: { score: 70, level: "high", factors: [], services: [service], ai_authored: false },
    plan: { strategy: "canary", steps: [{ weight: 10, bake: 5 * STEP_NS }, { weight: 100, bake: 0 }] },
    status: "rolling",
    step_index: 0,
    weight: 10,
    environment: "production",
    ...over,
  };
}

const am = (fingerprint: string, status: "firing" | "resolved", service = "checkout") => ({
  version: "4",
  status,
  receiver: "alror",
  commonLabels: { alertname: "HighErrorRate", env: "prod" },
  alerts: [
    {
      status,
      labels: { alertname: "HighErrorRate", service, severity: "critical", env: "prod" },
      annotations: { summary: `${service} 5xx above 5%` },
      startsAt: new Date().toISOString(),
      fingerprint,
    },
  ],
});

async function signup(email: string, org: string): Promise<string> {
  const r = await call("POST", "/api/v1/auth/signup", { body: { email, password: PASSWORD, org } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return (r.body.org as Json).id as string;
}

before(async () => {
  const health = await fetch(BASE + "/login").catch(() => null);
  assert.ok(health, `dev server not reachable at ${BASE}`);
  orgIds.push(await signup(emails.a, `Incidents A ${RUN}`), await signup(emails.b, `Incidents B ${RUN}`));
  const sys = { type: "system" as const, id: null, label: "test", scopes: [] };
  ctxA = { orgId: orgIds[0], actor: sys };
  ctxB = { orgId: orgIds[1], actor: sys };
  keyA = (await createApiKey(ctxA, { name: "all", scopes: ["deploy:read", "deploy:write"] }, { authorized: true })).token;
  readA = (await createApiKey(ctxA, { name: "read", scopes: ["deploy:read"] }, { authorized: true })).token;
  keyB = (await createApiKey(ctxB, { name: "all", scopes: ["deploy:read", "deploy:write"] }, { authorized: true })).token;
  for (const name of ["checkout", "search"]) await createService(ctxA, { name });
  await createService(ctxB, { name: "checkout" });
  secretA = (await rotateAlertSecret(ctxA, { authorized: true })).token;
  secretB = (await rotateAlertSecret(ctxB, { authorized: true })).token;

  // Org A: checkout rolling since 8 minutes ago (the likely cause), search promoted an hour
  // ago, and an old checkout release outside the 2-hour window.
  const deps = [
    deployment(depId("checkout"), "checkout", { created_at: minutesAgo(8) }),
    deployment(depId("search"), "search", { status: "promoted", weight: 100, step_index: 1, created_at: minutesAgo(60), risk: { score: 20, level: "low", factors: [], services: ["search"], ai_authored: false } }),
    deployment(depId("old"), "checkout", { status: "promoted", weight: 100, step_index: 1, created_at: minutesAgo(300) }),
  ];
  for (const d of deps) {
    const r = await call("POST", "/api/v1/deployments", { body: d, headers: bearer(keyA) });
    assert.equal(r.status, 201, JSON.stringify(r.body));
  }
  const rb = await call("POST", "/api/v1/deployments", { body: deployment(depId("b"), "checkout", { created_at: minutesAgo(5) }), headers: bearer(keyB) });
  assert.equal(rb.status, 201);
});

after(async () => {
  if (orgIds.length) await db.delete(orgs).where(inArray(orgs.id, orgIds));
  await db.delete(users).where(inArray(users.email, Object.values(emails)));
  await closeDb();
  await closeRedis();
});

let incidentId = "";

describe("alert intake: auth and validation", () => {
  test("unknown source is 404", async () => {
    const r = await call("POST", `/api/v1/alerts/pagerduty?token=${secretA}`, { body: {} });
    assert.equal(r.status, 404);
  });

  test("missing or wrong secret is 401", async () => {
    assert.equal((await call("POST", "/api/v1/alerts/generic", { body: { title: "x" } })).status, 401);
    const wrong = `alrwh_${"A".repeat(40)}`;
    assert.equal((await call("POST", `/api/v1/alerts/generic?token=${wrong}`, { body: { title: "x" } })).status, 401);
    assert.equal((await call("POST", "/api/v1/alerts/generic", { body: { title: "x" }, headers: { "x-alror-token": secretA.slice(0, -1) + "x" } })).status, 401);
    // An API key is not an alert secret.
    assert.equal((await call("POST", "/api/v1/alerts/generic", { body: { title: "x" }, headers: bearer(keyA) })).status, 401);
  });

  test("malformed JSON is 400, a payload that does not fit the source is 422", async () => {
    const bad = await call("POST", "/api/v1/alerts/generic", { raw: "{nope", headers: { "x-alror-token": secretA } });
    assert.equal(bad.status, 400);
    const r = await call("POST", "/api/v1/alerts/alertmanager", { body: { status: "firing" }, headers: { "x-alror-token": secretA } });
    assert.equal(r.status, 422);
    assert.equal((r.body.error as Json).code, "invalid");
    assert.match((r.body.error as Json).message as string, /alerts array/);
  });
});

describe("incidents: create, rank, dedupe, resolve", () => {
  test("an Alertmanager alert opens an incident with ranked, explained candidates", async () => {
    const r = await call("POST", `/api/v1/alerts/alertmanager?token=${secretA}`, { body: am(`fp-${RUN}`, "firing") });
    assert.equal(r.status, 202, JSON.stringify(r.body));
    const [res] = r.body.results as Json[];
    assert.equal(res.action, "created");
    incidentId = res.incident_id as string;

    const g = await call("GET", `/api/v1/incidents/${incidentId}`, { headers: bearer(keyA) });
    assert.equal(g.status, 200);
    assert.equal(g.body.service, "checkout");
    assert.equal(g.body.environment, "production");
    assert.equal(g.body.severity, "critical");
    assert.equal(g.body.status, "open");
    const items = (g.body.candidates as Json).items as Json[];
    assert.deepEqual(
      items.map((c) => c.deployment_id),
      [depId("checkout"), depId("search")],
      "the old release is outside the window",
    );
    assert.equal(items[0].service_match, "exact");
    assert.ok((items[0].score as number) >= 80, `top scored ${items[0].score}`);
    assert.ok((items[0].score as number) - (items[1].score as number) >= 15);
    const signals = items[0].signals as Json[];
    assert.deepEqual(
      signals.map((s) => s.signal),
      ["service", "recency", "risk", "state", "metrics", "environment"],
    );
    // Off by default: evaluated, recorded, not acted on.
    const auto = g.body.auto_action as Json;
    assert.equal(auto.rollback, false);
    assert.equal(((auto.checks as Json[]).find((c) => c.rule === "enabled") as Json).pass, false);
    assert.equal(g.body.rollback_job_id, null);
    assert.ok(g.body.raw, "raw payload stored");
  });

  test("a repeat delivery is deduplicated by fingerprint", async () => {
    const r = await call("POST", "/api/v1/alerts/alertmanager", { body: am(`fp-${RUN}`, "firing"), headers: { authorization: `Bearer ${secretA}` } });
    assert.equal(r.status, 202);
    assert.equal((r.body.results as Json[])[0].action, "deduplicated");
    assert.equal((r.body.results as Json[])[0].incident_id, incidentId);
    const g = await call("GET", `/api/v1/incidents/${incidentId}`, { headers: bearer(keyA) });
    assert.equal(g.body.event_count, 2);
  });

  test("the incident is listed, queryable with listOpenIncidents, and notifies the org", async () => {
    const list = await call("GET", "/api/v1/incidents?status=open", { headers: bearer(readA) });
    assert.equal(list.status, 200);
    assert.ok((list.body as Json[]).some((i) => i.id === incidentId));
    assert.equal((list.body as Json[])[0].raw, undefined, "lists leave out raw payloads");
    const open = await listOpenIncidents(ctxA);
    assert.ok(open.some((i) => i.id === incidentId));
    const [n] = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.orgId, orgIds[0]), eq(notifications.kind, "incident.opened")));
    assert.ok(n, "notification created");
    assert.equal(n.href, `/app/incidents/${incidentId}`);
  });

  test("other orgs cannot see the incident", async () => {
    assert.equal((await call("GET", `/api/v1/incidents/${incidentId}`, { headers: bearer(keyB) })).status, 404);
    const list = await call("GET", "/api/v1/incidents", { headers: bearer(keyB) });
    assert.ok(!(list.body as Json[]).some((i) => i.id === incidentId));
  });

  test("a resolved event resolves it; a resolved event with nothing open is ignored", async () => {
    const r = await call("POST", `/api/v1/alerts/alertmanager?token=${secretA}`, { body: am(`fp-${RUN}`, "resolved") });
    assert.equal((r.body.results as Json[])[0].action, "resolved");
    const g = await call("GET", `/api/v1/incidents/${incidentId}`, { headers: bearer(keyA) });
    assert.equal(g.body.status, "resolved");
    assert.ok(g.body.resolved_at);
    const again = await call("POST", `/api/v1/alerts/alertmanager?token=${secretA}`, { body: am(`fp-${RUN}`, "resolved") });
    assert.equal((again.body.results as Json[])[0].action, "ignored");
    // Firing again after resolution opens a new incident.
    const reopen = await call("POST", `/api/v1/alerts/alertmanager?token=${secretA}`, { body: am(`fp-${RUN}`, "firing") });
    const res = (reopen.body.results as Json[])[0];
    assert.equal(res.action, "created");
    assert.notEqual(res.incident_id, incidentId);
    incidentId = res.incident_id as string;
  });

  test("Datadog, Sentry and generic payloads are accepted", async () => {
    const dd = await call("POST", `/api/v1/alerts/datadog?token=${secretA}`, {
      body: { title: "[Triggered] Search latency", alert_id: "77", alert_scope: "service:search", alert_transition: "Triggered", alert_type: "warning", tags: "service:search,env:prod", date: String(Date.now()) },
    });
    assert.equal(dd.status, 202, JSON.stringify(dd.body));
    const ddInc = await call("GET", `/api/v1/incidents/${(dd.body.results as Json[])[0].incident_id}`, { headers: bearer(keyA) });
    assert.equal(ddInc.body.title, "Search latency");
    assert.equal((((ddInc.body.candidates as Json).items as Json[])[0] as Json).deployment_id, depId("search"));

    const sentry = await call("POST", `/api/v1/alerts/sentry?token=${secretA}`, {
      body: { action: "created", data: { issue: { id: `s-${RUN}`, title: "TypeError in cart", level: "error", project: { slug: "checkout" } } } },
    });
    assert.equal(sentry.status, 202);
    assert.equal((sentry.body.results as Json[])[0].action, "created");

    const gen = await call("POST", `/api/v1/alerts/generic?token=${secretA}`, { body: { title: "Queue backlog", service: "search", severity: "info", fingerprint: `g-${RUN}` } });
    assert.equal(gen.status, 202);
    assert.equal(gen.body.received, 1);
  });
});

describe("rollback from an incident", () => {
  test("needs deploy:write, and only candidates can be rolled back", async () => {
    const denied = await call("POST", `/api/v1/incidents/${incidentId}/rollback`, { body: { deployment_id: depId("checkout") }, headers: bearer(readA) });
    assert.equal(denied.status, 403);
    const notCandidate = await call("POST", `/api/v1/incidents/${incidentId}/rollback`, { body: { deployment_id: depId("old") }, headers: bearer(keyA) });
    assert.equal(notCandidate.status, 422);
    const otherOrg = await call("POST", `/api/v1/incidents/${incidentId}/rollback`, { body: { deployment_id: depId("checkout") }, headers: bearer(keyB) });
    assert.equal(otherOrg.status, 404);
  });

  test("queues a rollback job for the runner and audits it", async () => {
    const r = await call("POST", `/api/v1/incidents/${incidentId}/rollback`, { body: { deployment_id: depId("checkout") }, headers: bearer(keyA) });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.kind, "rollback");
    assert.equal(r.body.status, "queued");
    assert.equal((r.body.payload as Json).deployment_id, depId("checkout"));
    const g = await call("GET", `/api/v1/incidents/${incidentId}`, { headers: bearer(keyA) });
    assert.equal(g.body.rollback_job_id, r.body.id);
    const [a] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.orgId, orgIds[0]), eq(auditLog.action, "incident.rollback")));
    assert.equal(a.target, depId("checkout"));
    assert.equal(a.meta.job_id, r.body.id);
    assert.ok(Array.isArray(a.meta.signals));
  });

  test("resolve by hand; resolving twice is 409", async () => {
    const r = await call("POST", `/api/v1/incidents/${incidentId}/resolve`, { headers: bearer(keyA) });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, "resolved");
    assert.equal((await call("POST", `/api/v1/incidents/${incidentId}/resolve`, { headers: bearer(keyA) })).status, 409);
  });
});

describe("automatic rollback", () => {
  test("when enabled and every rule passes, a rollback job is queued with an audited decision", async () => {
    await updateAlertSettings(ctxA, { auto_rollback: true });
    const r = await call("POST", `/api/v1/alerts/generic?token=${secretA}`, {
      body: { title: "Checkout errors", service: "checkout", environment: "production", severity: "critical", fingerprint: `auto-${RUN}` },
    });
    assert.equal(r.status, 202);
    const id = (r.body.results as Json[])[0].incident_id as string;
    const g = await call("GET", `/api/v1/incidents/${id}`, { headers: bearer(keyA) });
    const auto = g.body.auto_action as Json;
    assert.equal(auto.rollback, true, JSON.stringify(auto.checks));
    assert.equal(auto.deployment_id, depId("checkout"));
    assert.ok(auto.job_id);
    assert.equal(g.body.rollback_job_id, auto.job_id);

    const jobs = await call("GET", "/api/v1/jobs?status=queued", { headers: bearer(keyA) });
    assert.ok((jobs.body as Json[]).some((j) => j.id === auto.job_id && j.kind === "rollback"));
    const [a] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.orgId, orgIds[0]), eq(auditLog.action, "incident.auto_rollback")));
    assert.equal(a.actorType, "system");
    assert.equal(a.meta.incident_id, id);
    assert.ok(Array.isArray(a.meta.checks) && Array.isArray(a.meta.signals), "evidence in the audit row");
  });

  test("an alert for a related service never triggers it (service must match exactly)", async () => {
    const r = await call("POST", `/api/v1/alerts/generic?token=${secretA}`, { body: { title: "Worker lag", service: "checkout-worker", environment: "production", fingerprint: `rel-${RUN}` } });
    const g = await call("GET", `/api/v1/incidents/${(r.body.results as Json[])[0].incident_id}`, { headers: bearer(keyA) });
    assert.equal((g.body.auto_action as Json).rollback, false);
    assert.equal(g.body.rollback_job_id, null);
    await updateAlertSettings(ctxA, { auto_rollback: false });
  });
});

describe("secrets and rate limits", () => {
  test("a revoked secret stops working", async () => {
    await revokeAlertSecret(ctxB);
    assert.equal((await call("POST", `/api/v1/alerts/generic?token=${secretB}`, { body: { title: "x" } })).status, 401);
    secretB = (await rotateAlertSecret(ctxB, { authorized: true })).token;
    assert.equal((await call("POST", `/api/v1/alerts/generic?token=${secretB}`, { raw: "{" })).status, 400);
  });

  test("invalid secrets are rate limited per client IP", async () => {
    const addr = ip();
    const wrong = `alrwh_${"B".repeat(40)}`;
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await call("POST", `/api/v1/alerts/generic?token=${wrong}`, { body: { title: "x" }, ip: addr })).status;
    assert.equal(last, 429);
  });

  test("alerts are rate limited per org", async () => {
    let limited: Res & { headers: Headers } | null = null;
    for (let i = 0; i < 125 && !limited; i++) {
      const r = await call("POST", `/api/v1/alerts/generic?token=${secretB}`, { raw: "{" });
      if (r.status === 429) limited = r;
      else assert.equal(r.status, 400);
    }
    assert.ok(limited, "429 after 120 requests a minute");
    assert.equal((limited.body.error as Json).code, "rate_limited");
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
  });
});
