// Integration tests for the platform API, run against the live dev server and database.
//
//   docker compose up -d && npm run db:migrate && npm run dev   (in another terminal)
//   npm run test:api                                             (ALROR_TEST_URL defaults to http://localhost:3000)
//
// Each run signs up two fresh orgs (A and B) and deletes them at the end.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import { createApiKey, revokeApiKey } from "@/lib/server/auth/api-keys";
import { createInvite, acceptInvite, changeRole, listMembers, removeMember } from "@/lib/server/auth/members";
import { pageAudit } from "@/lib/server/data/audit";
import { createFeedback, listFeedback } from "@/lib/server/data/feedback";
import { cancelJob, jobsForService, pageJobs } from "@/lib/server/data/jobs";
import { getOrg, updateOrg } from "@/lib/server/data/orgs";
import { disablePlugin, enabledTargets, installPlugin, pluginVotesFor, togglePluginVote, uninstallPlugin } from "@/lib/server/data/plugins";
import { searchConsole } from "@/lib/server/data/search";
import { archiveService, createService, updateService } from "@/lib/server/data/services";
import type { OrgCtx } from "@/lib/server/context";
import { closeDb, db } from "@/lib/server/db";
import { orgs, users } from "@/lib/server/db/schema";
import { closeRedis } from "@/lib/server/redis";
import { ApiError, classifyError, ServiceUnavailableError } from "@/lib/server/errors";
import { kindOf, previewDigest } from "@/lib/error-kind";

const BASE = (process.env.ALROR_TEST_URL || "http://localhost:3000").replace(/\/$/, "");
const RUN = randomBytes(4).toString("hex");
const PASSWORD = "test-password-123";

type Json = Record<string, unknown>;
type Res = { status: number; body: Json & Json[]; headers: Headers };

/** A tiny HTTP client that remembers the session cookie and spoofs a per-client IP for rate limits. */
class Client {
  cookie = "";
  ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  constructor(public key?: string) {}

  async req(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<Res> {
    const headers: Record<string, string> = { "x-forwarded-for": this.ip, ...extra };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.key) headers.authorization = `Bearer ${this.key}`;
    if (this.cookie) headers.cookie = this.cookie;
    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) {
      const m = /^alror_sid=([^;]*)/.exec(c);
      if (m) this.cookie = m[1] ? `alror_sid=${m[1]}` : "";
    }
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed as Json & Json[], headers: res.headers };
  }
  get = (p: string) => this.req("GET", p);
  post = (p: string, b?: unknown) => this.req("POST", p, b ?? {});
  put = (p: string, b?: unknown) => this.req("PUT", p, b ?? {});
}

const anon = new Client();
const ownerA = new Client();
const ownerB = new Client();
const member = new Client();
let keyA: Client; // all scopes, org A
let readA: Client; // deploy:read only, org A
let keyB: Client; // all scopes, org B
let ctxA: OrgCtx;
const orgIds: string[] = [];
const emails = {
  a: `owner-a-${RUN}@test.alror`,
  b: `owner-b-${RUN}@test.alror`,
  member: `member-${RUN}@test.alror`,
};

const STEP_NS = 60_000_000_000;
function deployment(id: string, service = "api", over: Json = {}): Json {
  const now = new Date().toISOString();
  return {
    id,
    service,
    image: `registry/${service}:1.0.${Math.floor(Math.random() * 100)}`,
    ref: "#42",
    risk: { score: 40, level: "medium", factors: [{ name: "Medium diff", detail: "210 lines changed", points: 15 }], services: [service], ai_authored: true },
    plan: { strategy: "canary", steps: [{ weight: 5, bake: 10 * STEP_NS }, { weight: 100, bake: 0 }] },
    status: "rolling",
    step_index: 0,
    weight: 5,
    created_at: now,
    updated_at: now,
    ...over,
  };
}
const depId = (suffix: string) => `dep_${RUN}T000000_${suffix}`;

before(async () => {
  const health = await fetch(BASE + "/login").catch(() => null);
  assert.ok(health, `dev server not reachable at ${BASE}`);
});

after(async () => {
  if (orgIds.length) await db.delete(orgs).where(inArray(orgs.id, orgIds));
  await db.delete(users).where(inArray(users.email, Object.values(emails)));
  await closeDb();
  await closeRedis();
});

describe("auth: signup, login, session", () => {
  test("signup creates a user, an org with default environments, and a session", async () => {
    const r = await ownerA.post("/api/v1/auth/signup", { email: emails.a.toUpperCase(), password: PASSWORD, name: "Owner A", org: `Test A ${RUN}` });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal((r.body.user as Json).email, emails.a, "email is lowercased");
    assert.equal(r.body.role, "owner");
    assert.ok(ownerA.cookie, "session cookie set");
    orgIds.push((r.body.org as Json).id as string);

    const s = await ownerA.get("/api/v1/auth/session");
    assert.equal(s.status, 200);
    assert.equal((s.body.org as Json).id, orgIds[0]);

    const rb = await ownerB.post("/api/v1/auth/signup", { email: emails.b, password: PASSWORD, org: `Test B ${RUN}` });
    assert.equal(rb.status, 201);
    orgIds.push((rb.body.org as Json).id as string);

    ctxA = { orgId: orgIds[0], actor: { type: "system", id: null, label: "test", scopes: [] } };
  });

  test("duplicate signup is a 409, weak password a 422", async () => {
    assert.equal((await anon.post("/api/v1/auth/signup", { email: emails.a, password: PASSWORD })).status, 409);
    assert.equal((await anon.post("/api/v1/auth/signup", { email: `x-${RUN}@test.alror`, password: "short" })).status, 422);
  });

  test("login: wrong password 401, right password 200, logout ends the session", async () => {
    const c = new Client();
    const bad = await c.post("/api/v1/auth/login", { email: emails.a, password: "nope-nope-nope" });
    assert.equal(bad.status, 401);
    assert.equal((bad.body.error as Json).code, "unauthorized");
    const ok = await c.post("/api/v1/auth/login", { email: emails.a, password: PASSWORD });
    assert.equal(ok.status, 200);
    assert.equal((await c.get("/api/v1/whoami")).status, 200);
    const sid = c.cookie;
    assert.equal((await c.post("/api/v1/auth/logout")).status, 204);
    c.cookie = sid; // replaying the old cookie must fail
    assert.equal((await c.get("/api/v1/whoami")).status, 401);
  });

  test("login is rate limited after 10 failures", async () => {
    const c = new Client();
    const email = `nobody-${RUN}@test.alror`;
    for (let i = 0; i < 10; i++) assert.equal((await c.post("/api/v1/auth/login", { email, password: "wrong-password" })).status, 401);
    const r = await c.post("/api/v1/auth/login", { email, password: "wrong-password" });
    assert.equal(r.status, 429);
    assert.equal((r.body.error as Json).code, "rate_limited");
  });

  test("the console redirects without a session and renders with one", async () => {
    const r = await fetch(BASE + "/app", { redirect: "manual" });
    assert.equal(r.status, 307);
    assert.match(r.headers.get("location") ?? "", /\/login/);
    const ok = await fetch(BASE + "/app", { headers: { cookie: ownerA.cookie }, redirect: "manual" });
    assert.equal(ok.status, 200);
  });
});

describe("API keys and scopes", () => {
  test("keys resolve org and scopes (whoami)", async () => {
    keyA = new Client((await createApiKey(ctxA, { name: "test all", scopes: ["deploy:read", "deploy:write", "jobs:run", "config:write"] }, { authorized: true })).token);
    readA = new Client((await createApiKey(ctxA, { name: "test read", scopes: ["deploy:read"] }, { authorized: true })).token);
    const ctxB: OrgCtx = { orgId: orgIds[1], actor: ctxA.actor };
    keyB = new Client((await createApiKey(ctxB, { name: "test b", scopes: ["deploy:read", "deploy:write", "jobs:run", "config:write"] }, { authorized: true })).token);

    const w = await keyA.get("/api/v1/whoami");
    assert.equal(w.status, 200);
    assert.equal((w.body.org as Json).id, orgIds[0]);
    assert.equal((w.body.actor as Json).type, "api_key");
    assert.deepEqual(w.body.scopes, ["deploy:read", "deploy:write", "jobs:run", "config:write"]);
  });

  test("401 without auth, with a malformed key, and with a revoked key", async () => {
    const r = await anon.get("/api/v1/deployments");
    assert.equal(r.status, 401);
    assert.deepEqual(Object.keys(r.body), ["error"]);
    assert.equal((r.body.error as Json).code, "unauthorized");
    assert.equal((await new Client("alr_live_" + "x".repeat(32)).get("/api/v1/whoami")).status, 401);
    assert.equal((await new Client("not-a-key").get("/api/v1/whoami")).status, 401);
    const { key, token } = await createApiKey(ctxA, { name: "to revoke", scopes: ["deploy:read"] }, { authorized: true });
    assert.equal((await new Client(token).get("/api/v1/whoami")).status, 200);
    await revokeApiKey({ ...ctxA, actor: { ...ctxA.actor, type: "system" } }, key.id);
    assert.equal((await new Client(token).get("/api/v1/whoami")).status, 401);
  });

  test("403 when a scope is missing", async () => {
    const r = await readA.post("/api/v1/deployments", deployment(depId("noscope")));
    assert.equal(r.status, 403);
    assert.equal((r.body.error as Json).code, "forbidden");
    assert.equal((await readA.post("/api/v1/jobs/claim", { worker: "t" })).status, 403);
    assert.equal((await readA.put("/api/v1/config", { services: [] })).status, 403);
    assert.equal((await keyA.get("/api/v1/stream")).status, 403, "stream is session-only");
  });
});

describe("config", () => {
  test("owner session PUT /config upserts services and policy; GET returns the alror.yaml shape", async () => {
    const r = await ownerA.put("/api/v1/config", {
      project: "ignored",
      services: [
        { name: "api", paths: ["services/api/"], target: "simulated", critical: true },
        { name: "web", paths: ["web/"], target: "kubernetes", cluster: "prod", namespace: "web" },
      ],
      metrics: { provider: "synthetic" },
      policy: { max_regression: { error_rate: 0.2, latency_p95: 0.1 }, alpha: 0.01, auto_rollback: true, bake_scale: 0.5 },
      notify: {},
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const g = await keyA.get("/api/v1/config");
    assert.equal(g.status, 200);
    assert.deepEqual(Object.keys(g.body), ["project", "services", "metrics", "policy", "notify"]);
    const services = g.body.services as unknown as Json[];
    assert.deepEqual(
      services.map((s) => s.name),
      ["api", "web"],
    );
    assert.deepEqual(services[1], { name: "web", paths: ["web/"], target: "kubernetes", cluster: "prod", namespace: "web", critical: false });
    assert.deepEqual(g.body.policy, { max_regression: { error_rate: 0.2, latency_p95: 0.1 }, alpha: 0.01, auto_rollback: true, bake_scale: 0.5 });
  });

  test("config:write key can PUT; member session cannot", async () => {
    const r = await keyA.put("/api/v1/config", { services: [{ name: "worker-svc", paths: [] }] });
    assert.equal(r.status, 200);
    assert.ok((r.body.services as unknown as Json[]).some((s) => s.name === "worker-svc"));

    const owner: OrgCtx = { orgId: orgIds[0], actor: { type: "user", id: null, label: emails.a, role: "owner", scopes: [] } };
    const { token } = await createInvite(owner, { email: emails.member, role: "member" });
    await acceptInvite({ token, password: PASSWORD, name: "Member" });
    assert.equal((await member.post("/api/v1/auth/login", { email: emails.member, password: PASSWORD })).status, 200);
    const m = await member.put("/api/v1/config", { services: [] });
    assert.equal(m.status, 403);
    assert.equal((await member.get("/api/v1/config")).status, 200);
  });
});

describe("deployments", () => {
  const id1 = depId("aaa111");
  const id2 = depId("aaa222");

  test("POST upserts (201), PUT updates (200), GET returns Go-shaped JSON", async () => {
    const c = await keyA.post("/api/v1/deployments", deployment(id1));
    assert.equal(c.status, 201, JSON.stringify(c.body));
    assert.deepEqual(Object.keys(c.body), [
      "id", "service", "image", "ref", "risk", "plan", "status", "step_index", "weight", "created_at", "updated_at", "environment", "source",
    ]);
    assert.equal(c.body.environment, "production");
    assert.equal(c.body.source, "cli", "API key writes default to source cli");
    assert.equal(((c.body.plan as Json).steps as Json[])[0].bake, 10 * STEP_NS, "bake is integer nanoseconds");

    const again = await keyA.post("/api/v1/deployments", deployment(id1, "api", { step_index: 1, weight: 100 }));
    assert.equal(again.status, 201);

    const u = await keyA.put(`/api/v1/deployments/${id1}`, deployment(id1, "api", { status: "promoted", step_index: 1, weight: 100 }));
    assert.equal(u.status, 200);
    assert.equal(u.body.status, "promoted");

    const g = await keyA.get(`/api/v1/deployments/${id1}`);
    assert.equal(g.status, 200);
    assert.equal(g.body.status, "promoted");
    assert.equal("reason" in g.body, false, "empty reason is omitted like Go omitempty");
  });

  test("unknown service is 422 unknown_service; invalid body is 422; bad JSON is 400", async () => {
    const r = await keyA.post("/api/v1/deployments", deployment(depId("nosvc"), "does-not-exist"));
    assert.equal(r.status, 422);
    assert.equal((r.body.error as Json).code, "unknown_service");
    assert.equal((await keyA.post("/api/v1/deployments", { id: "x" })).status, 422);
    const raw = await fetch(BASE + "/api/v1/deployments", {
      method: "POST",
      headers: { authorization: `Bearer ${keyA.key}`, "content-type": "application/json" },
      body: "{nope",
    });
    assert.equal(raw.status, 400);
  });

  test("events append in order", async () => {
    const at = new Date().toISOString();
    assert.equal((await keyA.post(`/api/v1/deployments/${id1}/events`, { at, kind: "created", message: "Risk 40 (medium)" })).status, 201);
    const verdict = {
      pass: true,
      results: [{ metric: "error_rate", canary: 0.2, baseline: 0.21, delta: -0.04, p_value: 0.7, pass: true }],
      summary: "No regression across 1 metrics",
    };
    assert.equal((await keyA.post(`/api/v1/deployments/${id1}/events`, { kind: "verdict", message: "ok", weight: 5, verdict })).status, 201);
    assert.equal((await keyA.post(`/api/v1/deployments/${id1}/events`, { kind: "nonsense", message: "x" })).status, 422);
    const e = await keyA.get(`/api/v1/deployments/${id1}/events`);
    assert.equal(e.status, 200);
    assert.deepEqual(
      (e.body as unknown as Json[]).map((x) => x.kind),
      ["created", "verdict"],
    );
    assert.equal("weight" in (e.body as unknown as Json[])[0], false, "zero weight omitted");
    assert.deepEqual((e.body as unknown as Json[])[1].verdict, verdict);
    assert.equal((await keyA.post(`/api/v1/deployments/${depId("missing")}/events`, { kind: "step", message: "x" })).status, 404);
  });

  test("list filters and newest-first order", async () => {
    await keyA.post("/api/v1/deployments", deployment(id2, "web", { created_at: new Date(Date.now() + 1000).toISOString() }));
    const all = await keyA.get("/api/v1/deployments?limit=10");
    assert.equal(all.status, 200);
    const ids = (all.body as unknown as Json[]).map((d) => d.id);
    assert.deepEqual(ids.slice(0, 2), [id2, id1]);
    const web = await keyA.get("/api/v1/deployments?service=web");
    assert.deepEqual(
      (web.body as unknown as Json[]).map((d) => d.id),
      [id2],
    );
    const promoted = await keyA.get("/api/v1/deployments?status=promoted");
    assert.deepEqual(
      (promoted.body as unknown as Json[]).map((d) => d.id),
      [id1],
    );
    assert.equal((await keyA.get("/api/v1/deployments?status=bogus")).status, 422);
  });

  test("GET by unique prefix, 409 on an ambiguous prefix, 404 when missing", async () => {
    const one = await keyA.get(`/api/v1/deployments/${id1.slice(0, -2)}`);
    assert.equal(one.status, 200);
    assert.equal(one.body.id, id1);
    const amb = await keyA.get(`/api/v1/deployments/${id1.slice(0, -6)}`);
    assert.equal(amb.status, 409);
    assert.equal((amb.body.error as Json).code, "ambiguous");
    const nf = await keyA.get(`/api/v1/deployments/dep_nothing_here`);
    assert.equal(nf.status, 404);
    assert.equal((nf.body.error as Json).code, "not_found");
  });

  test("org isolation: org B cannot read or overwrite org A's deployment", async () => {
    assert.equal((await keyB.get(`/api/v1/deployments/${id1}`)).status, 404);
    assert.equal((await keyB.get(`/api/v1/deployments/${id1.slice(0, 12)}`)).status, 404);
    assert.equal((await keyB.get(`/api/v1/deployments/${id1}/events`)).status, 404);
    assert.equal((await keyB.post(`/api/v1/deployments/${id1}/events`, { kind: "step", message: "x" })).status, 404);
    const list = await keyB.get("/api/v1/deployments");
    assert.deepEqual(list.body, []);
    await keyB.put("/api/v1/config", { services: [{ name: "api" }] });
    const steal = await keyB.post("/api/v1/deployments", deployment(id1, "api"));
    assert.equal(steal.status, 409);
    assert.equal((await keyA.get(`/api/v1/deployments/${id1}`)).body.status, "promoted", "A's deployment untouched");
    assert.equal((await ownerB.get(`/api/v1/deployments/${id1}`)).status, 404, "B's session cannot read it either");
  });

  test("rollbacks/recent counts rolled back deployments per service", async () => {
    await keyA.post("/api/v1/deployments", deployment(depId("rb0001"), "api", { status: "rolled_back", reason: "Regression: error_rate up 80%" }));
    const r = await keyA.get(`/api/v1/rollbacks/recent?since=${encodeURIComponent(new Date(Date.now() - 3600_000).toISOString())}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { api: 1 });
    assert.equal((await keyA.get("/api/v1/rollbacks/recent?since=garbage")).status, 422);
  });
});

describe("jobs", () => {
  test("enqueue -> long-poll claim wakes up -> finish", async () => {
    const t0 = Date.now();
    const claimP = keyA.post("/api/v1/jobs/claim", { worker: "test-runner" });
    await new Promise((r) => setTimeout(r, 1200));
    const j = await ownerA.post("/api/v1/jobs", { kind: "deploy", payload: { service: "api", image: "registry/api:2.0.0", ref: "#7" } });
    assert.equal(j.status, 201, JSON.stringify(j.body));
    assert.equal(j.body.status, "queued");
    assert.deepEqual(Object.keys(j.body), [
      "id", "kind", "payload", "status", "claimed_by", "deployment_id", "error", "created_at", "claimed_at", "finished_at", "heartbeat_at", "attempts",
    ]);

    const c = await claimP;
    const waited = Date.now() - t0;
    assert.equal(c.status, 200, `claim returned ${c.status}`);
    assert.equal(c.body.id, j.body.id);
    assert.equal(c.body.status, "claimed");
    assert.equal(c.body.claimed_by, "test-runner");
    assert.ok(waited < 6000, `claim should wake on the Redis signal, took ${waited} ms`);

    const f = await keyA.post(`/api/v1/jobs/${j.body.id}/finish`, { status: "done", deployment_id: depId("job001") });
    assert.equal(f.status, 200);
    assert.equal(f.body.status, "done");
    assert.equal(f.body.deployment_id, depId("job001"));
    assert.ok(f.body.finished_at);
    const again = await keyA.post(`/api/v1/jobs/${j.body.id}/finish`, { status: "done" });
    assert.equal(again.status, 200, "repeating a finish is idempotent");
    assert.equal((await keyA.post(`/api/v1/jobs/${j.body.id}/finish`, { status: "failed" })).status, 409);

    const list = await keyA.get("/api/v1/jobs?status=done");
    assert.ok((list.body as unknown as Json[]).some((x) => x.id === j.body.id));
  });

  test("rollback jobs validate the deployment; claim returns 204 when idle; org B never sees A's jobs", async () => {
    const id = depId("rbjob1");
    await keyA.post("/api/v1/deployments", deployment(id));
    const j = await keyA.post("/api/v1/jobs", { kind: "rollback", payload: { deployment_id: id, reason: "test" } });
    assert.equal(j.status, 201);
    assert.equal(j.body.deployment_id, id);
    assert.equal((await keyA.post("/api/v1/jobs", { kind: "rollback", payload: { deployment_id: depId("nope00") } })).status, 404);
    assert.equal((await keyA.post("/api/v1/jobs", { kind: "deploy", payload: { service: "ghost", image: "x" } })).status, 422);

    const b = await keyB.post("/api/v1/jobs/claim", { worker: "b", wait: 1 });
    assert.equal(b.status, 204, "org B must not claim org A's job");
    const a = await keyA.post("/api/v1/jobs/claim", { worker: "a", wait: 1 });
    assert.equal(a.status, 200);
    assert.equal(a.body.id, j.body.id);
    const idle = await keyA.post("/api/v1/jobs/claim", { worker: "a", wait: 1 });
    assert.equal(idle.status, 204);
    assert.equal((await keyA.post(`/api/v1/jobs/${j.body.id}/finish`, { status: "failed", error: "boom" })).body.status, "failed");
  });
});

describe("stream", () => {
  test("401 without a session", async () => {
    assert.equal((await anon.get("/api/v1/stream")).status, 401);
  });

  test("SSE relays deployment.updated for the session's org", async () => {
    const ac = new AbortController();
    const res = await fetch(BASE + "/api/v1/stream", { headers: { cookie: ownerA.cookie }, signal: ac.signal });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const id = depId("sse001");

    const got = (async () => {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        for (const f of frames) {
          if (f.includes("event: deployment.updated") && f.includes(id)) return f;
        }
      }
      return null;
    })();

    await new Promise((r) => setTimeout(r, 500)); // let the subscription settle
    // Org B's write must not reach A's stream; A's must.
    await keyB.post("/api/v1/deployments", deployment(depId("sseB01"), "api"));
    assert.equal((await keyA.post("/api/v1/deployments", deployment(id))).status, 201);
    const frame = await got;
    ac.abort();
    assert.ok(frame, `no deployment.updated frame received; got: ${buf.slice(0, 300)}`);
    const data = JSON.parse(frame!.split("\n").find((l) => l.startsWith("data: "))!.slice(6));
    assert.equal(data.type, "deployment.updated");
    assert.equal(data.deployment.id, id);
    assert.equal(buf.includes(depId("sseB01")), false, "org B event leaked into org A's stream");
  });
});

describe("contract decisions (v1.1)", () => {
  test("1. risk_override accepts a level or a 0-100 score and is stored as sent", async () => {
    for (const ro of ["high", 85, "42"]) {
      const r = await keyA.post("/api/v1/jobs", { kind: "deploy", payload: { service: "api", image: "registry/api:3", risk_override: ro } });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.equal((r.body.payload as Json).risk_override, ro);
    }
    for (const bad of ["huge", 101, -1, "101"]) {
      const r = await keyA.post("/api/v1/jobs", { kind: "deploy", payload: { service: "api", image: "x", risk_override: bad } });
      assert.equal(r.status, 422, `risk_override ${JSON.stringify(bad)} should be rejected`);
    }
    // Drain the queued deploy jobs so later claims are deterministic.
    for (;;) {
      const c = await keyA.post("/api/v1/jobs/claim", { worker: "drain", wait: 0 });
      if (c.status !== 200) break;
      await keyA.post(`/api/v1/jobs/${c.body.id}/finish`, { status: "done", worker: "drain" });
    }
  });

  test("2. environment and source on deployments", async () => {
    const staging = await keyA.post("/api/v1/deployments", deployment(depId("env001"), "api", { environment: "staging" }));
    assert.equal(staging.status, 201);
    assert.equal(staging.body.environment, "staging");
    const upd = await keyA.put(`/api/v1/deployments/${depId("env001")}`, deployment(depId("env001"), "api", { step_index: 1 }));
    assert.equal(upd.body.environment, "staging", "environment kept when absent on update");
    const bad = await keyA.post("/api/v1/deployments", deployment(depId("env002"), "api", { environment: "moon" }));
    assert.equal(bad.status, 422);
    assert.equal((bad.body.error as Json).code, "unknown_environment");
    assert.equal((await keyA.get("/api/v1/deployments?environment=staging")).body.length, 1);

    const runner = await keyA.req("POST", "/api/v1/deployments", deployment(depId("src001")), { "x-alror-source": "runner" });
    assert.equal(runner.body.source, "runner", "X-Alror-Source header");
    const explicit = await keyA.req("POST", "/api/v1/deployments", deployment(depId("src002"), "api", { source: "ci" }), { "x-alror-source": "runner" });
    assert.equal(explicit.body.source, "ci", "body source wins over the header");
    const session = await ownerA.post("/api/v1/deployments", deployment(depId("src003")));
    assert.equal(session.body.source, "console", "session writes default to console");
    assert.equal((await keyA.post("/api/v1/deployments", deployment(depId("src004"), "api", { source: "worker" }))).status, 422);
  });

  test("3. job leases: heartbeat, re-claim after expiry, stale finish is 409", async () => {
    const j = await keyA.post("/api/v1/jobs", { kind: "deploy", payload: { service: "api", image: "registry/api:lease", environment: "staging" } });
    assert.equal(j.status, 201);
    const c1 = await keyA.post("/api/v1/jobs/claim", { worker: "runner-1", wait: 0 });
    assert.equal(c1.status, 200);
    assert.equal(c1.body.id, j.body.id);
    assert.equal(c1.body.attempts, 1);
    assert.ok(c1.body.heartbeat_at);
    assert.equal((c1.body.payload as Json).environment, "staging");

    assert.equal((await keyA.post(`/api/v1/jobs/${j.body.id}/heartbeat`, { worker: "runner-1" })).status, 200);
    assert.equal((await keyA.post(`/api/v1/jobs/${j.body.id}/heartbeat`, { worker: "someone-else" })).status, 409);
    assert.equal((await readA.post(`/api/v1/jobs/${j.body.id}/heartbeat`, { worker: "runner-1" })).status, 403);

    // Nothing else is claimable while the lease is fresh.
    assert.equal((await keyA.post("/api/v1/jobs/claim", { worker: "runner-2", wait: 0 })).status, 204);

    // Expire the lease (runner-1 stopped heartbeating 3 minutes ago).
    await db.execute(sql`update jobs set heartbeat_at = now() - interval '3 minutes' where id = ${j.body.id as string}`);
    const c2 = await keyA.post("/api/v1/jobs/claim", { worker: "runner-2", wait: 0 });
    assert.equal(c2.status, 200);
    assert.equal(c2.body.id, j.body.id, "expired job is claimable again");
    assert.equal(c2.body.claimed_by, "runner-2");
    assert.equal(c2.body.attempts, 2);

    assert.equal((await keyA.post(`/api/v1/jobs/${j.body.id}/heartbeat`, { worker: "runner-1" })).status, 409, "old runner lost the lease");
    assert.equal((await keyA.post(`/api/v1/jobs/${j.body.id}/finish`, { status: "done", worker: "runner-1" })).status, 409, "old runner cannot finish");
    assert.equal((await keyA.post(`/api/v1/jobs/${j.body.id}/finish`, { status: "done", worker: "runner-2" })).status, 200);
    assert.equal((await keyA.post(`/api/v1/jobs/${j.body.id}/heartbeat`, { worker: "runner-2" })).status, 409, "no heartbeat after finish");
  });

  test("4. the server owns updated_at; created_at is kept from the first insert; PUT on an unknown id is 404", async () => {
    const id = depId("ts0001");
    const created = "2026-01-02T03:04:05Z";
    const t0 = Date.now();
    const r = await keyA.post("/api/v1/deployments", deployment(id, "api", { created_at: created, updated_at: "2001-01-01T00:00:00Z" }));
    assert.equal(r.status, 201);
    assert.equal(r.body.created_at, created);
    assert.ok(Math.abs(Date.parse(r.body.updated_at as string) - t0) < 60_000, `updated_at ${r.body.updated_at} should be server time`);
    const u = await keyA.put(`/api/v1/deployments/${id}`, deployment(id, "api", { created_at: "2030-01-01T00:00:00Z", updated_at: "2001-01-01T00:00:00Z" }));
    assert.equal(u.body.created_at, created, "created_at never changes after insert");
    assert.ok(Date.parse(u.body.updated_at as string) >= Date.parse(r.body.updated_at as string));
    const nf = await keyA.put(`/api/v1/deployments/${depId("nope99")}`, deployment(depId("nope99")));
    assert.equal(nf.status, 404);
    assert.equal((await keyA.get(`/api/v1/deployments/${depId("nope99")}`)).status, 404, "PUT did not create it");
    assert.equal((await keyB.put(`/api/v1/deployments/${id}`, deployment(id))).status, 404, "another org's id is a 404 on PUT");
  });

  test("5. GET /deployments: limit up to 1000 and a before cursor", async () => {
    assert.equal((await keyA.get("/api/v1/deployments?limit=1000")).status, 200);
    assert.equal((await keyA.get("/api/v1/deployments?limit=1001")).status, 422);
    const ids = ["cur001", "cur002", "cur003"].map(depId);
    const base = Date.parse("2025-06-01T00:00:00Z");
    for (let i = 0; i < ids.length; i++) {
      await keyA.post("/api/v1/deployments", deployment(ids[i], "web", { created_at: new Date(base + i * 60_000).toISOString() }));
    }
    const page1 = await keyA.get("/api/v1/deployments?service=web&limit=2&before=2025-12-31T00:00:00Z");
    assert.deepEqual(
      (page1.body as unknown as Json[]).map((d) => d.id),
      [ids[2], ids[1]],
    );
    const page2 = await keyA.get(`/api/v1/deployments?service=web&limit=2&before=${ids[1]}`);
    assert.deepEqual(
      (page2.body as unknown as Json[]).map((d) => d.id),
      [ids[0]],
    );
    assert.equal((await keyA.get("/api/v1/deployments?before=dep_unknown_cursor")).status, 422);

    // Ties: identical, sub-millisecond created_at values page by (created_at, id) with no gaps or duplicates.
    const tie = "2025-07-01T00:00:00.123456789Z";
    const tied = ["tie003", "tie001", "tie002", "tie004"].map(depId);
    for (const id of tied) await keyA.post("/api/v1/deployments", deployment(id, "web", { created_at: tie }));
    const want = [...tied].sort().reverse();
    const seen: string[] = [];
    let cursor = "2025-07-02T00:00:00Z";
    for (let i = 0; i < 10; i++) {
      const page = (await keyA.get(`/api/v1/deployments?service=web&limit=1&before=${cursor}`)).body as unknown as Json[];
      const id = page[0]?.id as string | undefined;
      if (!id || !id.includes("tie")) break;
      seen.push(id);
      cursor = id;
    }
    assert.deepEqual(seen, want);
    assert.equal((await keyB.get(`/api/v1/deployments?before=${ids[1]}`)).status, 422, "cursor ids are org-scoped");
  });
});

describe("console (v1.2): settings, services, policy, jobs, search, feedback", () => {
  const uid = async (email: string) => (await db.select({ id: users.id }).from(users).where(eq(users.email, email)))[0].id;
  const userCtx = async (email: string, role: "owner" | "admin" | "member"): Promise<OrgCtx> => {
    const id = await uid(email);
    return { orgId: orgIds[0], actor: { type: "user", id, label: email, userId: id, role, scopes: role === "member" ? ["deploy:read", "deploy:write"] : ["deploy:read", "deploy:write", "config:write"] } };
  };

  test("PUT /config accepts custom rollout plans, validates them, and null resets them", async () => {
    const plans = { low: [{ weight: 50, bake: 2 * STEP_NS }, { weight: 100, bake: 0 }] };
    const ok = await keyA.put("/api/v1/config", { policy: { plans } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual((ok.body.policy as Json).plans, plans);
    const bad = await keyA.put("/api/v1/config", { policy: { plans: { high: [{ weight: 50, bake: STEP_NS }, { weight: 25, bake: 0 }] } } });
    assert.equal(bad.status, 422);
    const reset = await keyA.put("/api/v1/config", { policy: { plans: null } });
    assert.equal(reset.status, 200);
    assert.equal("plans" in (reset.body.policy as Json), false, "plans omitted when not customised");
  });

  test("org rename and slug change: owners only, unique slug, audit-logged", async () => {
    const owner = await userCtx(emails.a, "owner");
    const memberCtx = await userCtx(emails.member, "member");
    await assert.rejects(updateOrg(memberCtx, { name: "nope" }), /owners and admins/);
    const b = await getOrg(orgIds[1]);
    await assert.rejects(updateOrg(owner, { slug: b!.slug }), (e: Error & { status?: number }) => e.status === 409);
    await assert.rejects(updateOrg(owner, { slug: "-bad-" }), (e: Error & { status?: number }) => e.status === 422);
    const renamed = await updateOrg(owner, { name: `Renamed ${RUN}`, slug: `renamed-${RUN}` });
    assert.equal(renamed.slug, `renamed-${RUN}`);
    assert.equal((await keyA.get("/api/v1/config")).body.project, `renamed-${RUN}`);
    const audit = await pageAudit(owner, { page: 1, per: 5, category: "org" });
    assert.equal(audit.items[0].action, "org.update");
    await assert.rejects(pageAudit(memberCtx, { page: 1, per: 5 }), /owners and admins/);
  });

  test("members: role changes and removal follow the owner rules", async () => {
    const owner = await userCtx(emails.a, "owner");
    const memberId = await uid(emails.member);
    await changeRole(owner, memberId, "admin");
    const admin = await userCtx(emails.member, "admin");
    await assert.rejects(changeRole(admin, owner.actor.userId!, "member"), /Only owners/);
    await assert.rejects(removeMember(owner, owner.actor.userId!), /at least one owner/);
    await changeRole(owner, memberId, "member");
    const roles = Object.fromEntries((await listMembers(owner)).map((m) => [m.email, m.role]));
    assert.equal(roles[emails.member], "member");
  });

  test("services: create, edit and archive are admin-only; archived services reject deploys", async () => {
    const owner = await userCtx(emails.a, "owner");
    const memberCtx = await userCtx(emails.member, "member");
    await assert.rejects(createService(memberCtx, { name: "svc-x" }), /owners and admins/);
    await createService(owner, { name: "svc-x", paths: ["x/**"], target: "kubernetes", cluster: "c1", namespace: "ns" });
    const s = await updateService(owner, "svc-x", { critical: true, paths: ["x/**", "y/**"] });
    assert.deepEqual([s.critical, s.paths], [true, ["x/**", "y/**"]]);
    await archiveService(owner, "svc-x", true);
    const r = await member.post("/api/v1/jobs", { kind: "deploy", payload: { service: "svc-x", image: "r/x:1" } });
    assert.equal(r.status, 422);
    assert.equal((r.body.error as Json).code, "unknown_service");
    await archiveService(owner, "svc-x", false);
    assert.equal((await member.post("/api/v1/jobs", { kind: "deploy", payload: { service: "svc-x", image: "r/x:1" } })).status, 201);
  });

  test("jobs views: per-service listing, paging counts, cancel scoped to the org", async () => {
    const memberCtx = await userCtx(emails.member, "member");
    const svcJobs = await jobsForService(memberCtx, "svc-x");
    assert.ok(svcJobs.length >= 1);
    assert.equal(svcJobs[0].requested_by, emails.member);
    const page = await pageJobs(memberCtx, { status: "queued", page: 1, per: 25 });
    assert.ok(page.counts.queued >= 1 && page.items.every((j) => j.status === "queued"));
    const ctxB: OrgCtx = { orgId: orgIds[1], actor: { type: "user", id: null, label: "b", role: "owner", scopes: ["deploy:write"] } };
    await assert.rejects(cancelJob(ctxB, svcJobs[0].id), (e: Error & { status?: number }) => e.status === 409);
    const canceled = await cancelJob(memberCtx, svcJobs[0].id);
    assert.equal(canceled.status, "canceled");
  });

  test("search and feedback are scoped to the org", async () => {
    const owner = await userCtx(emails.a, "owner");
    const a = await searchConsole(owner, "svc-");
    assert.ok(a.services.some((s) => s.name === "svc-x"));
    const ctxB: OrgCtx = { orgId: orgIds[1], actor: owner.actor };
    assert.equal((await searchConsole(ctxB, "svc-x")).services.length, 0);
    const memberCtx = await userCtx(emails.member, "member");
    await assert.rejects(createFeedback(memberCtx, { message: "x" }), /a little more/);
    await createFeedback(memberCtx, { message: "The jobs page is great", page: "/app/jobs" });
    await assert.rejects(listFeedback(memberCtx), /owners and admins/);
    assert.equal((await listFeedback(owner))[0].from, emails.member);
  });

  test("console pages render for the owner; settings pages refuse members", async () => {
    for (const p of ["/app/settings", "/app/settings/members", "/app/settings/api-keys", "/app/settings/audit", "/app/jobs", "/app/policies", "/app/onboarding", "/app/services/svc-x"]) {
      const r = await ownerA.req("GET", p);
      assert.equal(r.status, 200, p);
    }
    const r = await member.req("GET", "/app/settings/api-keys");
    assert.equal(r.status, 200);
    assert.match(String(r.body), /Only owners and admins of/);
    assert.doesNotMatch(String(r.body), /alr_live_/);
  });
});

describe("marketplace (v1.3): plugins API, installs and permissions", () => {
  const userCtxFor = async (email: string, role: "owner" | "member"): Promise<OrgCtx> => {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    return {
      orgId: orgIds[0],
      actor: { type: "user", id: u.id, label: email, userId: u.id, role, scopes: role === "member" ? ["deploy:read", "deploy:write"] : ["deploy:read", "deploy:write", "config:write"] },
    };
  };
  const PROM = { url: "http://prometheus.internal:9090/", query_error_rate: 'sum(rate(errors{app="{{service}}"}[1m]))', query_latency_p95: "histogram_quantile(0.95, x)" };
  const WEBHOOK = `https://hooks.slack.com/services/T000/B000/${RUN}secret`;
  const status = (n: number) => (e: Error & { status?: number }) => e.status === n;

  test("GET /plugins needs auth and deploy:read; starts empty with synthetic metrics and the simulated target", async () => {
    assert.equal((await anon.get("/api/v1/plugins")).status, 401);
    const r = await readA.get("/api/v1/plugins");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.plugins, []);
    assert.equal(r.body.metrics_provider, "synthetic");
    assert.deepEqual(r.body.targets, ["simulated"]);
  });

  test("members can browse but not install, disable or uninstall", async () => {
    const memberCtx = await userCtxFor(emails.member, "member");
    await assert.rejects(installPlugin(memberCtx, "prometheus", PROM), /owners and admins/);
    await assert.rejects(disablePlugin(memberCtx, "prometheus"), /owners and admins/);
    await assert.rejects(uninstallPlugin(memberCtx, "prometheus"), /owners and admins/);
    const keyCtx: OrgCtx = { orgId: orgIds[0], actor: { type: "api_key", id: null, label: "k", scopes: ["config:write"] } };
    await assert.rejects(installPlugin(keyCtx, "prometheus", PROM), /owners and admins/);
    assert.equal((await member.get("/api/v1/plugins")).status, 200);
  });

  test("validation: unknown 404, built-in / guide / planned 409, bad values 422", async () => {
    const owner = await userCtxFor(emails.a, "owner");
    await assert.rejects(installPlugin(owner, "nope", {}), status(404));
    for (const id of ["synthetic", "simulated", "github-actions", "go-sdk", "pagerduty"]) await assert.rejects(installPlugin(owner, id, {}), status(409), id);
    await assert.rejects(installPlugin(owner, "prometheus", { ...PROM, url: "not a url" }), status(422));
    await assert.rejects(installPlugin(owner, "prometheus", { ...PROM, url: "ftp://x" }), status(422));
    await assert.rejects(installPlugin(owner, "prometheus", { url: PROM.url }), status(422), "queries are required");
    await assert.rejects(installPlugin(owner, "datadog", { ...PROM, site: "https://evil.example" }), status(422));
    await assert.rejects(installPlugin(owner, "slack", { webhook: "https://example.com/hook" }), status(422));
  });

  test("Prometheus sets the policy metrics; Datadog replaces it without storing keys; disable reverts to synthetic", async () => {
    const owner = await userCtxFor(emails.a, "owner");
    assert.deepEqual(await installPlugin(owner, "prometheus", PROM), { created: true, enabled: true });
    let cfg = await keyA.get("/api/v1/config");
    assert.deepEqual(cfg.body.metrics, {
      provider: "prometheus",
      url: "http://prometheus.internal:9090",
      queries: { error_rate: PROM.query_error_rate, latency_p95: PROM.query_latency_p95 },
    });

    const dd = await installPlugin(owner, "datadog", {
      site: "https://api.datadoghq.eu",
      query_error_rate: "a",
      query_latency_p95: "b",
      api_key: "dd-should-not-be-stored",
      app_key: "dd-app-should-not-be-stored",
    });
    assert.equal(dd.created, true);
    cfg = await keyA.get("/api/v1/config");
    assert.deepEqual(cfg.body.metrics, { provider: "datadog", url: "https://api.datadoghq.eu", queries: { error_rate: "a", latency_p95: "b" } });

    const r = await readA.get("/api/v1/plugins");
    const byId = Object.fromEntries((r.body.plugins as Json[]).map((p) => [p.id, p]));
    assert.equal(byId.prometheus.enabled, false, "enabling Datadog disables Prometheus");
    assert.equal(byId.datadog.enabled, true);
    assert.equal(r.body.metrics_provider, "datadog");
    assert.doesNotMatch(JSON.stringify(r.body), /should-not-be-stored/);
    const rows = await db.execute(sql`select config from org_plugins where org_id = ${orgIds[0]} and plugin_id = 'datadog'`);
    assert.doesNotMatch(JSON.stringify(rows), /should-not-be-stored|api_key|app_key/);

    await disablePlugin(owner, "datadog");
    cfg = await keyA.get("/api/v1/config");
    assert.deepEqual(cfg.body.metrics, { provider: "synthetic" });
    await uninstallPlugin(owner, "datadog");
    await uninstallPlugin(owner, "prometheus");
    assert.deepEqual((await readA.get("/api/v1/plugins")).body.plugins, []);
    await assert.rejects(uninstallPlugin(owner, "prometheus"), status(404));
  });

  test("Slack: the webhook goes to the policy only, is never listed, and uninstall clears it", async () => {
    const owner = await userCtxFor(emails.a, "owner");
    await assert.rejects(installPlugin(owner, "slack", {}), status(422), "webhook required on first install");
    await installPlugin(owner, "slack", { webhook: WEBHOOK });
    assert.equal(((await keyA.get("/api/v1/config")).body.notify as Json).slack_webhook, WEBHOOK);
    const r = await readA.get("/api/v1/plugins");
    assert.doesNotMatch(JSON.stringify(r.body), new RegExp(`${RUN}secret`));
    assert.equal((r.body.plugins as Json[]).find((p) => p.id === "slack")?.webhook_set, true);
    // Saving again without a webhook keeps the stored one.
    await installPlugin(owner, "slack", { webhook: "" });
    assert.equal(((await keyA.get("/api/v1/config")).body.notify as Json).slack_webhook, WEBHOOK);
    await uninstallPlugin(owner, "slack");
    assert.deepEqual((await keyA.get("/api/v1/config")).body.notify, {});
  });

  test("deploy targets: enabled targets are offered, with defaults; org B sees none of A's plugins", async () => {
    const owner = await userCtxFor(emails.a, "owner");
    await installPlugin(owner, "kubernetes", { default_cluster: "prod-eu", default_namespace: "shop" });
    const targets = await enabledTargets(owner);
    assert.deepEqual(
      targets.map((t) => t.target),
      ["simulated", "kubernetes"],
    );
    assert.deepEqual(targets[1].defaults, { cluster: "prod-eu", namespace: "shop" });
    assert.deepEqual((await readA.get("/api/v1/plugins")).body.targets, ["simulated", "kubernetes"]);
    const b = await keyB.get("/api/v1/plugins");
    assert.equal(b.status, 200);
    assert.deepEqual(b.body.plugins, []);
    assert.deepEqual(b.body.targets, ["simulated"]);
    await disablePlugin(owner, "kubernetes");
    assert.deepEqual(
      (await enabledTargets(owner)).map((t) => t.target),
      ["simulated"],
    );
  });

  test("votes for planned items: any member, toggles, audit-logged", async () => {
    const memberCtx = await userCtxFor(emails.member, "member");
    const owner = await userCtxFor(emails.a, "owner");
    assert.deepEqual(await togglePluginVote(memberCtx, "pagerduty"), { count: 1, mine: true });
    assert.deepEqual(await togglePluginVote(owner, "pagerduty"), { count: 2, mine: true });
    assert.deepEqual((await pluginVotesFor(memberCtx)).pagerduty, { count: 2, mine: true });
    assert.deepEqual(await togglePluginVote(memberCtx, "pagerduty"), { count: 1, mine: false });
    await assert.rejects(togglePluginVote(memberCtx, "prometheus"), status(409));
    const keyCtx: OrgCtx = { orgId: orgIds[0], actor: { type: "api_key", id: null, label: "k", scopes: ["deploy:read"] } };
    await assert.rejects(togglePluginVote(keyCtx, "pagerduty"), status(403));

    const audit = await pageAudit(owner, { page: 1, per: 100, category: "plugin" });
    const actions = new Set(audit.items.map((e) => e.action));
    for (const a of ["plugin.install", "plugin.configure", "plugin.disable", "plugin.uninstall", "plugin.vote", "plugin.unvote"]) assert.ok(actions.has(a), a);
  });
});

describe("health and error classification", () => {
  test("GET /health needs no auth and reports both stores", async () => {
    const r = await anon.get("/api/v1/health");
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "no-store");
    const body = r.body as unknown as { status: string; postgres: { ok: boolean; latency_ms: number }; redis: { ok: boolean; latency_ms: number }; version: string };
    assert.equal(body.status, "ok");
    assert.equal(body.postgres.ok, true);
    assert.equal(body.redis.ok, true);
    assert.equal(typeof body.postgres.latency_ms, "number");
    assert.equal(typeof body.redis.latency_ms, "number");
    assert.match(body.version, /\S/);
  });

  test("connection failures are attributed to Postgres or Redis", () => {
    const refused = (port: number) => Object.assign(new Error(`connect ECONNREFUSED 127.0.0.1:${port}`), { code: "ECONNREFUSED", port, address: "127.0.0.1" });
    // localhost resolving to ::1 and 127.0.0.1: an AggregateError with an empty message.
    const aggregate = Object.assign(new AggregateError([refused(5432), refused(5432)], ""), { code: "ECONNREFUSED" });
    // drizzle wraps driver errors: "Failed query: ..." with the driver error as cause.
    const wrapped = new Error("Failed query: select 1", { cause: aggregate });
    assert.equal(classifyError(wrapped), "database_unavailable");
    assert.equal(classifyError(refused(6379)), "cache_unavailable");
    assert.equal(classifyError(Object.assign(new Error("Reached the max retries per request limit (which is 3)."), { name: "MaxRetriesPerRequestError" })), "cache_unavailable");
    assert.equal(classifyError(Object.assign(new Error("write CONNECT_TIMEOUT db:5432"), { code: "CONNECT_TIMEOUT" })), "database_unavailable");
    assert.equal(classifyError(Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" }), "cache_unavailable"), "cache_unavailable");
    assert.equal(classifyError(new ApiError(401, "unauthorized", "no")), "unauthorized");
    assert.equal(classifyError(new ApiError(404, "not_found", "no")), "not_found");
    assert.equal(classifyError(new ApiError(429, "rate_limited", "slow down")), "rate_limited");
    assert.equal(classifyError(new Error('relation "x" does not exist')), "unknown");
    assert.equal(classifyError("boom"), "unknown");
  });

  test("the kind survives as a digest (all error.tsx gets in production)", () => {
    const e = new ServiceUnavailableError("cache_unavailable");
    assert.match(e.digest, /^alror:cache_unavailable:[a-z0-9]+$/);
    assert.equal(kindOf({ message: "An error occurred in the Server Components render.", digest: e.digest }), "cache_unavailable");
    assert.equal(kindOf({ digest: previewDigest("database_unavailable") }), "database_unavailable");
    assert.equal(kindOf({ message: "x", digest: "2489173561" }), "unknown");
    assert.equal(classifyError(new Error("wrapped", { cause: e })), "cache_unavailable");
  });
});
