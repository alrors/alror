import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { base62, hashPassword } from "../auth/crypto";
import { db } from "../db";
import { memberships, orgs, users, type Role } from "../db/schema";
import { conflict, notFound } from "../errors";
import { redis } from "../redis";
import { assertAdmin, type AdminCtx } from "./access";
import { recordAdminAction } from "./log";
import { isoTime, likeEscape, num, str, UUID_RE } from "./util";

export type UserMembership = { org_id: string; slug: string; name: string; role: Role; joined_at: string };

export type AdminUserRow = {
  id: string;
  email: string;
  name: string;
  created_at: string;
  last_login_at: string | null;
  memberships: UserMembership[];
};

/** One page of every user on the instance with their orgs and roles. */
export async function listUsersAdmin(
  admin: AdminCtx,
  opts: { q?: string; orgId?: string; page: number; per: number },
): Promise<{ items: AdminUserRow[]; total: number }> {
  assertAdmin(admin);
  const q = (opts.q ?? "").trim().slice(0, 100).toLowerCase();
  const pattern = `%${likeEscape(q)}%`;
  const orgId = opts.orgId && UUID_RE.test(opts.orgId) ? opts.orgId : undefined;
  const filter = sql`where true
    ${q ? sql`and (u.email like ${pattern} or lower(u.name) like ${pattern})` : sql``}
    ${orgId ? sql`and exists (select 1 from memberships m where m.user_id = u.id and m.org_id = ${orgId})` : sql``}`;
  const offset = (Math.max(opts.page, 1) - 1) * opts.per;
  const [rows, [count]] = await Promise.all([
    db.execute<Record<string, unknown>>(sql`
      select u.id, u.email, u.name, u.created_at, u.last_login_at,
        coalesce((select json_agg(json_build_object('org_id', o.id, 'slug', o.slug, 'name', o.name, 'role', m.role, 'joined_at', m.created_at) order by m.created_at)
          from memberships m join orgs o on o.id = m.org_id where m.user_id = u.id), '[]'::json) as memberships
      from users u ${filter}
      order by u.created_at desc, u.id
      limit ${opts.per} offset ${offset}`),
    db.execute<{ n: number }>(sql`select count(*)::int as n from users u ${filter}`),
  ]);
  return { items: rows.map(toRow), total: num(count?.n) };
}

function toRow(r: Record<string, unknown>): AdminUserRow {
  const ms = (typeof r.memberships === "string" ? JSON.parse(r.memberships) : r.memberships) as Record<string, unknown>[];
  return {
    id: str(r.id),
    email: str(r.email),
    name: str(r.name),
    created_at: isoTime(r.created_at) ?? "",
    last_login_at: isoTime(r.last_login_at),
    memberships: (ms ?? []).map((m) => ({
      org_id: str(m.org_id),
      slug: str(m.slug),
      name: str(m.name),
      role: str(m.role) as Role,
      joined_at: isoTime(m.joined_at) ?? "",
    })),
  };
}

export async function getUserAdmin(admin: AdminCtx, id: string): Promise<AdminUserRow | null> {
  assertAdmin(admin);
  if (!UUID_RE.test(id)) return null;
  const rows = await db.execute<Record<string, unknown>>(sql`
    select u.id, u.email, u.name, u.created_at, u.last_login_at,
      coalesce((select json_agg(json_build_object('org_id', o.id, 'slug', o.slug, 'name', o.name, 'role', m.role, 'joined_at', m.created_at) order by m.created_at)
        from memberships m join orgs o on o.id = m.org_id where m.user_id = u.id), '[]'::json) as memberships
    from users u where u.id = ${id}`);
  return rows[0] ? toRow(rows[0]) : null;
}

async function mustUser(id: string) {
  if (!UUID_RE.test(id)) throw notFound("User not found.");
  const [u] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, id)).limit(1);
  if (!u) throw notFound("User not found.");
  return u;
}

async function userOrgs(userId: string): Promise<{ id: string; slug: string }[]> {
  return db
    .select({ id: orgs.id, slug: orgs.slug })
    .from(memberships)
    .innerJoin(orgs, eq(orgs.id, memberships.orgId))
    .where(eq(memberships.userId, userId));
}

// ---------- Sessions (Redis sess:<id> -> {userId, orgId, createdAt}) ----------

const SCAN_LIMIT = 100_000;

/**
 * Walks every session key once and returns the session ids per user. Sessions
 * are keyed by id only, so a full SCAN is the only way to find a user's
 * sessions; it is bounded and fine for an operator action.
 */
export async function sessionsByUser(): Promise<Map<string, string[]>> {
  const r = redis();
  const out = new Map<string, string[]>();
  let cursor = "0";
  let seen = 0;
  do {
    const [next, keys] = await r.scan(cursor, "MATCH", "sess:*", "COUNT", 500);
    cursor = next;
    seen += keys.length;
    if (keys.length) {
      const vals = await r.mget(...keys);
      keys.forEach((k, i) => {
        const v = vals[i];
        if (!v) return;
        try {
          const uid = (JSON.parse(v) as { userId?: string }).userId;
          if (typeof uid === "string") out.set(uid, [...(out.get(uid) ?? []), k]);
        } catch {
          // ignore malformed sessions
        }
      });
    }
  } while (cursor !== "0" && seen < SCAN_LIMIT);
  return out;
}

/** Active session counts per user id (best effort; empty when Redis is down). */
export async function sessionCounts(admin: AdminCtx): Promise<Record<string, number>> {
  assertAdmin(admin);
  try {
    const m = await sessionsByUser();
    return Object.fromEntries([...m].map(([k, v]) => [k, v.length]));
  } catch {
    return {};
  }
}

async function dropSessions(userId: string): Promise<number> {
  const keys = (await sessionsByUser()).get(userId) ?? [];
  if (keys.length) await redis().del(...keys);
  return keys.length;
}

/** Deletes every Redis session of the user; they are signed out on their next request. */
export async function signOutEverywhere(admin: AdminCtx, userId: string): Promise<{ email: string; sessions: number }> {
  assertAdmin(admin);
  const u = await mustUser(userId);
  const sessions = await dropSessions(u.id);
  await recordAdminAction(admin, { action: "admin.user.sign_out", target: u.email, orgs: await userOrgs(u.id), meta: { user_id: u.id, sessions } });
  return { email: u.email, sessions };
}

/**
 * Replaces the user's password with a random temporary one, returned once and
 * never stored in clear, and signs them out everywhere.
 */
export async function resetPasswordAdmin(admin: AdminCtx, userId: string): Promise<{ email: string; password: string; sessions: number }> {
  assertAdmin(admin);
  const u = await mustUser(userId);
  const password = `${base62(6)}-${base62(6)}-${base62(6)}`;
  await db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, u.id));
  const sessions = await dropSessions(u.id);
  await recordAdminAction(admin, { action: "admin.user.reset_password", target: u.email, orgs: await userOrgs(u.id), meta: { user_id: u.id, sessions } });
  return { email: u.email, password, sessions };
}

/** Removes a user from one org. The last owner of an org cannot be removed. */
export async function removeFromOrgAdmin(admin: AdminCtx, userId: string, orgId: string): Promise<{ email: string; org: string }> {
  assertAdmin(admin);
  const u = await mustUser(userId);
  if (!UUID_RE.test(orgId)) throw notFound("Membership not found.");
  const [m] = await db
    .select({ role: memberships.role, slug: orgs.slug })
    .from(memberships)
    .innerJoin(orgs, eq(orgs.id, memberships.orgId))
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
    .limit(1);
  if (!m) throw notFound("Membership not found.");
  if (m.role === "owner") {
    const [c] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.role, "owner")));
    if ((c?.n ?? 0) <= 1) throw conflict(`${u.email} is the last owner of ${m.slug}. Make someone else an owner first, or delete the org.`);
  }
  await db.transaction(async (tx) => {
    await tx.delete(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)));
    await recordAdminAction(admin, {
      action: "admin.member.remove",
      target: u.email,
      orgs: [{ id: orgId, slug: m.slug }],
      meta: { user_id: u.id, role: m.role },
      tx,
    });
  });
  return { email: u.email, org: m.slug };
}
