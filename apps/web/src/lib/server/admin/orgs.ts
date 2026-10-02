import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { apiKeys, orgs, PLANS, type Plan } from "../db/schema";
import { conflict, invalid, notFound } from "../errors";
import { jobsKey, redis } from "../redis";
import { assertAdmin, type AdminCtx } from "./access";
import { recordAdminAction } from "./log";
import { isoTime, likeEscape, num, str, UUID_RE } from "./util";

export type AdminOrgRow = {
  id: string;
  slug: string;
  name: string;
  plan: Plan;
  members: number;
  services: number;
  deploys_30d: number;
  finished_30d: number;
  rollback_rate: number | null;
  created_at: string;
};

export const ORG_SORTS = ["created", "name", "deploys", "members", "rollback"] as const;
export type OrgSort = (typeof ORG_SORTS)[number];

const ORDER: Record<OrgSort, string> = {
  created: "o.created_at desc",
  name: "lower(o.name) asc",
  deploys: "deploys_30d desc, o.created_at desc",
  members: "members desc, o.created_at desc",
  rollback: "(case when finished_30d = 0 then null else rolled_back_30d::float / finished_30d end) desc nulls last",
};

/** One page of every org on the instance, with usage counters. */
export async function listOrgsAdmin(
  admin: AdminCtx,
  opts: { q?: string; plan?: Plan; sort?: OrgSort; page: number; per: number },
): Promise<{ items: AdminOrgRow[]; total: number }> {
  assertAdmin(admin);
  const q = (opts.q ?? "").trim().slice(0, 100);
  const pattern = `%${likeEscape(q.toLowerCase())}%`;
  const filter = sql`where true
    ${q ? sql`and (lower(o.name) like ${pattern} or o.slug like ${pattern} or o.id::text = ${q})` : sql``}
    ${opts.plan ? sql`and o.plan = ${opts.plan}` : sql``}`;
  const sort = sql.raw(ORDER[opts.sort ?? "created"]);
  const offset = (Math.max(opts.page, 1) - 1) * opts.per;
  const [rows, [count]] = await Promise.all([
    db.execute<Record<string, unknown>>(sql`
      select * from (
        select o.id, o.slug, o.name, o.plan, o.created_at,
          (select count(*) from memberships m where m.org_id = o.id)::int as members,
          (select count(*) from services s where s.org_id = o.id and s.archived_at is null)::int as services,
          (select count(*) from deployments d where d.org_id = o.id and d.created_at > now() - interval '30 days')::int as deploys_30d,
          (select count(*) from deployments d where d.org_id = o.id and d.created_at > now() - interval '30 days'
             and d.status in ('promoted','rolled_back','failed'))::int as finished_30d,
          (select count(*) from deployments d where d.org_id = o.id and d.created_at > now() - interval '30 days'
             and d.status = 'rolled_back')::int as rolled_back_30d
        from orgs o ${filter}
      ) o
      order by ${sort}, o.id
      limit ${opts.per} offset ${offset}`),
    db.execute<{ n: number }>(sql`select count(*)::int as n from orgs o ${filter}`),
  ]);
  return {
    total: num(count?.n),
    items: rows.map((r) => {
      const fin = num(r.finished_30d);
      return {
        id: str(r.id),
        slug: str(r.slug),
        name: str(r.name),
        plan: str(r.plan) as Plan,
        members: num(r.members),
        services: num(r.services),
        deploys_30d: num(r.deploys_30d),
        finished_30d: fin,
        rollback_rate: fin ? num(r.rolled_back_30d) / fin : null,
        created_at: isoTime(r.created_at) ?? "",
      };
    }),
  };
}

/** Every org as {id, slug, name}, for filter pickers. */
export async function orgOptions(admin: AdminCtx): Promise<{ id: string; slug: string; name: string }[]> {
  assertAdmin(admin);
  return db.select({ id: orgs.id, slug: orgs.slug, name: orgs.name }).from(orgs).orderBy(orgs.slug).limit(1000);
}

export async function getOrgAdmin(admin: AdminCtx, id: string) {
  assertAdmin(admin);
  if (!UUID_RE.test(id)) return null;
  const [o] = await db.select().from(orgs).where(eq(orgs.id, id)).limit(1);
  return o ?? null;
}

async function mustOrg(id: string) {
  if (!UUID_RE.test(id)) throw notFound("Organization not found.");
  const [o] = await db.select().from(orgs).where(eq(orgs.id, id)).limit(1);
  if (!o) throw notFound("Organization not found.");
  return o;
}

export async function setOrgPlan(admin: AdminCtx, orgId: string, plan: string): Promise<{ from: Plan; to: Plan; slug: string }> {
  assertAdmin(admin);
  if (!(PLANS as readonly string[]).includes(plan)) throw invalid(`Plan must be one of: ${PLANS.join(", ")}.`);
  const o = await mustOrg(orgId);
  const to = plan as Plan;
  if (o.plan === to) return { from: o.plan, to, slug: o.slug };
  await db.transaction(async (tx) => {
    await tx.update(orgs).set({ plan: to }).where(eq(orgs.id, orgId));
    await recordAdminAction(admin, { action: "admin.org.plan", target: o.slug, orgs: [{ id: o.id, slug: o.slug }], meta: { from: o.plan, to }, tx });
  });
  return { from: o.plan, to, slug: o.slug };
}

export async function revokeAllKeys(admin: AdminCtx, orgId: string): Promise<number> {
  assertAdmin(admin);
  const o = await mustOrg(orgId);
  const rows = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.orgId, orgId), isNull(apiKeys.revokedAt)))
    .returning({ prefix: apiKeys.prefix });
  await recordAdminAction(admin, {
    action: "admin.api_key.revoke_all",
    target: o.slug,
    orgs: [{ id: o.id, slug: o.slug }],
    meta: { count: rows.length, prefixes: rows.map((r) => r.prefix) },
  });
  return rows.length;
}

export async function revokeKeyAdmin(admin: AdminCtx, orgId: string, keyId: string): Promise<string> {
  assertAdmin(admin);
  const o = await mustOrg(orgId);
  if (!UUID_RE.test(keyId)) throw notFound("API key not found.");
  const [row] = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.orgId, orgId), eq(apiKeys.id, keyId), isNull(apiKeys.revokedAt)))
    .returning();
  if (!row) throw notFound("API key not found or already revoked.");
  await recordAdminAction(admin, {
    action: "admin.api_key.revoke",
    target: row.prefix,
    orgs: [{ id: o.id, slug: o.slug }],
    meta: { key_id: row.id, name: row.name },
  });
  return row.prefix;
}

/**
 * Deletes an org and everything it owns (cascade). `confirm` must equal the
 * org's slug. The record survives in the instance log, since the org's own
 * audit rows are deleted with it.
 */
export async function deleteOrgAdmin(admin: AdminCtx, orgId: string, confirm: string): Promise<{ slug: string; name: string }> {
  assertAdmin(admin);
  const o = await mustOrg(orgId);
  if (confirm.trim() !== o.slug) throw invalid(`Type the org slug "${o.slug}" to confirm.`);
  const [counts] = await db.execute<Record<string, unknown>>(sql`
    select (select count(*) from memberships where org_id = ${orgId})::int as members,
           (select count(*) from services where org_id = ${orgId})::int as services,
           (select count(*) from deployments where org_id = ${orgId})::int as deployments`);
  await db.transaction(async (tx) => {
    // deployments reference services and environments with "no action"; remove them first.
    await tx.execute(sql`delete from deployments where org_id = ${orgId}`);
    const [gone] = await tx.delete(orgs).where(eq(orgs.id, orgId)).returning({ id: orgs.id });
    if (!gone) throw conflict("The organization was already deleted.");
  });
  await recordAdminAction(admin, {
    action: "admin.org.delete",
    target: o.slug,
    orgs: [{ id: o.id, slug: o.slug }],
    meta: { name: o.name, plan: o.plan, members: num(counts?.members), services: num(counts?.services), deployments: num(counts?.deployments) },
    skipOrgAudit: true,
  });
  // Drop the org's job wake-up list; its jobs are gone.
  await redis().del(jobsKey(o.id)).catch(() => 0);
  return { slug: o.slug, name: o.name };
}
