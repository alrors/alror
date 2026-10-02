// Integration tests for the platform admin area (/admin), run against the live dev server and database.
//
//   docker compose up -d && npm run db:migrate && npm run db:seed && npm run dev   (in another terminal)
//   npm run test:admin                                                            (ALROR_TEST_URL defaults to http://localhost:3000)
//
// The server must treat ALROR_TEST_ADMIN_EMAIL (default admin@acme.test, the
// development default of ALROR_PLATFORM_ADMINS) as a platform admin, and
// ALROR_TEST_MEMBER_EMAIL (default dev@acme.test) as a regular user.
// Each run signs up one fresh org, acts on it as the admin, and deletes it.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import { assertAdmin, isPlatformAdmin, type AdminCtx } from "@/lib/server/admin/access";
import { setOrgPlan } from "@/lib/server/admin/orgs";
import { closeDb, db } from "@/lib/server/db";
import { auditLog, jobs, orgs, users } from "@/lib/server/db/schema";
import { closeRedis } from "@/lib/server/redis";

const BASE = (process.env.ALROR_TEST_URL || "http://localhost:3000").replace(/\/$/, "");
const ADMIN_EMAIL = process.env.ALROR_TEST_ADMIN_EMAIL || "admin@acme.test";
const MEMBER_EMAIL = process.env.ALROR_TEST_MEMBER_EMAIL || "dev@acme.test";
const SEED_PASSWORD = process.env.ALROR_TEST_SEED_PASSWORD || "alror-demo";
const RUN = randomBytes(4).toString("hex");
const PASSWORD = "test-password-123";

type Res = { status: number; body: Record<string, unknown>; text: string };

class Client {
  cookie = "";
  ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  async req(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<Res> {
    const headers: Record<string, string> = { "x-forwarded-for": this.ip, ...extra };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.cookie) headers.cookie = this.cookie;
    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const m = /^alror_sid=([^;]*)/.exec(c);
      if (m) this.cookie = m[1] ? `alror_sid=${m[1]}` : "";
    }
    const text = await res.text();
    let parsed: unknown = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = {};
    }
    return { status: res.status, body: parsed as Record<string, unknown>, text };
  }
  get = (p: string) => this.req("GET", p);
  post = (p: string, b?: unknown) => this.req("POST", p, b ?? {});
}

const admin = new Client();
const member = new Client();
const anon = new Client();
const target = new Client();
const targetEmail = `admin-target-${RUN}@test.alror`;
let targetOrgId = "";
let targetSlug = "";

const PAGES = ["/admin", "/admin/orgs", "/admin/users", "/admin/jobs", "/admin/jobs?status=stalled", "/admin/plugins", "/admin/feedback", "/admin/audit", "/admin/audit?view=admin", "/admin/system"];

before(async () => {
  const a = await admin.post("/api/v1/auth/login", { email: ADMIN_EMAIL, password: SEED_PASSWORD });
  assert.equal(a.status, 200, `admin login failed (${a.status}); run npm run db:seed`);
  const m = await member.post("/api/v1/auth/login", { email: MEMBER_EMAIL, password: SEED_PASSWORD });
  assert.equal(m.status, 200, `member login failed (${m.status}); run npm run db:seed`);
  const s = await target.post("/api/v1/auth/signup", { email: targetEmail, password: PASSWORD, name: "Admin target", org: `Admin target ${RUN}` });
  assert.equal(s.status, 201, s.text);
  const session = await target.get("/api/v1/auth/session");
  const org = session.body.org as { id: string; slug: string };
  targetOrgId = org.id;
  targetSlug = org.slug;
});

after(async () => {
  // Best-effort cleanup if a test failed before the delete step.
  const left = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.id, targetOrgId));
  if (left.length) {
    await db.execute(`delete from deployments where org_id = '${targetOrgId}'`);
    await db.delete(orgs).where(inArray(orgs.id, [targetOrgId]));
  }
  await db.delete(users).where(eq(users.email, targetEmail));
  await closeDb();
  await closeRedis();
});

describe("admin pages", () => {
  test("a platform admin gets 200 on every admin page", async () => {
    for (const p of [...PAGES, `/admin/orgs/${targetOrgId}`]) {
      const r = await admin.get(p);
      assert.equal(r.status, 200, `${p} -> ${r.status}`);
    }
  });

  test("a regular member gets 404, not a redirect", async () => {
    for (const p of [...PAGES, `/admin/orgs/${targetOrgId}`]) {
      const r = await member.get(p);
      assert.equal(r.status, 404, `${p} -> ${r.status}`);
    }
  });

  test("a signed-out visitor gets 404, not a redirect to /login", async () => {
    for (const p of PAGES) {
      const r = await anon.get(p);
      assert.equal(r.status, 404, `${p} -> ${r.status}`);
    }
  });

  test("server actions posted to admin pages are rejected for non-admins", async () => {
    const r = await member.req("POST", "/admin/orgs", undefined, { "next-action": "0".repeat(42), "content-type": "text/plain" });
    assert.equal(r.status, 404);
  });
});

describe("admin actions", () => {
  test("non-admins cannot call admin endpoints", async () => {
    for (const c of [member, anon]) {
      assert.equal((await c.get("/admin/api/summary")).status, 404);
      assert.equal((await c.get("/admin/api/access")).status, 404);
      assert.equal((await c.post("/admin/api/org-plan", { org: targetOrgId, plan: "business" })).status, 404);
      assert.equal((await c.post("/admin/api/org-delete", { org: targetOrgId, confirm: targetSlug })).status, 404);
      assert.equal((await c.post("/admin/api/user-reset-password", { user: "00000000-0000-0000-0000-000000000000" })).status, 404);
    }
    const [o] = await db.select({ plan: orgs.plan }).from(orgs).where(eq(orgs.id, targetOrgId));
    assert.equal(o.plan, "team", "the plan must be unchanged");
  });

  test("the data layer refuses a non-admin context", async () => {
    assert.equal(isPlatformAdmin(MEMBER_EMAIL), false);
    const fake = { email: MEMBER_EMAIL, userId: "x", actor: { type: "user", id: "x", label: MEMBER_EMAIL, scopes: [] } } as unknown as AdminCtx;
    assert.throws(() => assertAdmin(fake), /Not found/);
    await assert.rejects(setOrgPlan(fake, targetOrgId, "business"), /Not found/);
  });

  test("summary returns instance KPIs", async () => {
    const r = await admin.get("/admin/api/summary");
    assert.equal(r.status, 200);
    for (const k of ["orgs", "users", "active_keys", "deploys_24h", "jobs_stalled", "runners_5m"]) assert.equal(typeof r.body[k], "number", k);
    assert.ok((r.body.orgs as number) >= 1);
  });

  test("change plan writes an audit row in the org", async () => {
    const r = await admin.post("/admin/api/org-plan", { org: targetOrgId, plan: "business" });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.body.from, r.body.to], ["team", "business"]);
    const rows = await db.select().from(auditLog).where(eq(auditLog.orgId, targetOrgId));
    const row = rows.find((x) => x.action === "admin.org.plan");
    assert.ok(row, "audit row");
    assert.match(row.actorLabel, new RegExp(ADMIN_EMAIL.replace(".", "\\.")));
    assert.equal((await admin.post("/admin/api/org-plan", { org: targetOrgId, plan: "enterprise" })).status, 422);
  });

  test("sign out everywhere ends the user's sessions", async () => {
    assert.equal((await target.get("/api/v1/auth/session")).status, 200);
    const s = await target.get("/api/v1/auth/session");
    const userId = (s.body.user as { id: string }).id;
    const r = await admin.post("/admin/api/user-sign-out", { user: userId });
    assert.equal(r.status, 200, r.text);
    assert.ok((r.body.sessions as number) >= 1);
    assert.equal((await target.get("/api/v1/auth/session")).status, 401);
  });

  test("reset password returns a one-time password that works", async () => {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, targetEmail));
    const r = await admin.post("/admin/api/user-reset-password", { user: u.id });
    assert.equal(r.status, 200, r.text);
    const temp = r.body.password as string;
    assert.ok(temp && temp.length >= 16);
    const fresh = new Client();
    assert.equal((await fresh.post("/api/v1/auth/login", { email: targetEmail, password: PASSWORD })).status, 401);
    assert.equal((await fresh.post("/api/v1/auth/login", { email: targetEmail, password: temp })).status, 200);
  });

  test("the last owner cannot be removed from an org", async () => {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, targetEmail));
    const r = await admin.post("/admin/api/user-remove", { user: u.id, org: targetOrgId });
    assert.equal(r.status, 409, r.text);
  });

  test("jobs can be canceled and requeued across orgs", async () => {
    const [job] = await db
      .insert(jobs)
      .values({ orgId: targetOrgId, kind: "deploy", payload: { service: "api", image: "api:test", environment: "production" } })
      .returning({ id: jobs.id });
    assert.equal((await member.post("/admin/api/job-cancel", { job: job.id })).status, 404);
    assert.equal((await admin.post("/admin/api/job-requeue", { job: job.id })).status, 409, "a queued job cannot be requeued");
    assert.equal((await admin.post("/admin/api/job-cancel", { job: job.id })).status, 200);
    let [row] = await db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, job.id));
    assert.equal(row.status, "canceled");
    assert.equal((await admin.post("/admin/api/job-requeue", { job: job.id })).status, 200);
    [row] = await db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, job.id));
    assert.equal(row.status, "queued");
    // A stalled claim (heartbeat older than the 2 minute lease) can be requeued too.
    await db.execute(sql`update jobs set status = 'claimed', claimed_by = 'test-runner', claimed_at = now() - interval '10 minutes', heartbeat_at = now() - interval '5 minutes' where id = ${job.id}`);
    const list = await admin.get(`/admin/jobs?status=stalled&org=${targetOrgId}`);
    assert.equal(list.status, 200);
    assert.ok(list.text.includes(job.id.slice(0, 8)), "the stalled filter lists the job");
    assert.equal((await admin.post("/admin/api/job-requeue", { job: job.id })).status, 200);
    assert.equal((await admin.post("/admin/api/job-cancel", { job: job.id })).status, 200);
    const actions = (await db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.orgId, targetOrgId))).map((r) => r.action);
    assert.ok(actions.includes("admin.job.cancel") && actions.includes("admin.job.requeue"));
  });

  test("delete org needs the typed slug, then removes it and logs it", async () => {
    assert.equal((await admin.post("/admin/api/org-delete", { org: targetOrgId, confirm: "wrong" })).status, 422);
    const r = await admin.post("/admin/api/org-delete", { org: targetOrgId, confirm: targetSlug });
    assert.equal(r.status, 200, r.text);
    assert.equal((await db.select().from(orgs).where(eq(orgs.id, targetOrgId))).length, 0);
    const page = await admin.get("/admin/audit?view=admin");
    assert.equal(page.status, 200);
    assert.ok(page.text.includes(targetSlug), "the instance log lists the deleted org");
  });
});
