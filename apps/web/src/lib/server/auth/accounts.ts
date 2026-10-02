import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { scopesForRole, type Actor, type OrgCtx } from "../context";
import { db } from "../db";
import { memberships, orgs, users, type Plan, type Role } from "../db/schema";
import { ApiError, conflict, forbidden, invalid } from "../errors";
import { writeAudit } from "../data/audit";
import { createOrgWithOwner } from "../data/orgs";
import {
  deleteSession,
  putSession,
  rateLimitHit,
  rateLimitPeek,
  rateLimitReset,
  readSession,
  updateSessionOrg,
} from "../redis";
import { dummyPasswordHash, hashPassword, randomId, verifyPassword } from "./crypto";

export type SessionUser = { id: string; email: string; name: string };
export type SessionOrg = { id: string; slug: string; name: string; plan: Plan };

/** A validated console session: the user, the org they are acting in and their role there. */
export type SessionContext = {
  sid: string;
  user: SessionUser;
  org: SessionOrg;
  role: Role;
};

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD = 8;

export const normalizeEmail = (e: string) => e.trim().toLowerCase();

export function actorFor(s: SessionContext): Actor {
  return { type: "user", id: s.user.id, label: s.user.email, userId: s.user.id, role: s.role, scopes: scopesForRole(s.role) };
}

export function ctxFor(s: SessionContext): OrgCtx {
  return { orgId: s.org.id, actor: actorFor(s) };
}

function validateCredentials(email: string, password: string) {
  if (!EMAIL_RE.test(email) || email.length > 254) throw invalid("Enter a valid email address.");
  if (password.length < MIN_PASSWORD) throw invalid(`Passwords need at least ${MIN_PASSWORD} characters.`);
  if (password.length > 512) throw invalid("That password is too long.");
}

async function newSession(userId: string, orgId: string): Promise<string> {
  const sid = randomId(32);
  await putSession(sid, { userId, orgId, createdAt: new Date().toISOString() });
  return sid;
}

export async function isFirstRun(): Promise<boolean> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  return (r?.n ?? 0) === 0;
}

/**
 * Creates a user and a new org they own (with default environments and policy),
 * then opens a session. The very first signup on an empty install works the same way.
 */
export async function signup(input: { email: string; password: string; name?: string; orgName?: string }): Promise<{
  sid: string;
  userId: string;
  orgId: string;
  firstRun: boolean;
}> {
  const email = normalizeEmail(input.email);
  validateCredentials(email, input.password);
  const name = (input.name ?? "").trim().slice(0, 120);
  const orgName = (input.orgName ?? "").trim().slice(0, 80) || `${name || email.split("@")[0]}'s org`;
  const passwordHash = await hashPassword(input.password);
  const firstRun = await isFirstRun();

  const { userId, orgId } = await db.transaction(async (tx) => {
    const [user] = await tx.insert(users).values({ email, name, passwordHash, lastLoginAt: new Date() }).onConflictDoNothing().returning();
    if (!user) throw conflict("An account with that email already exists. Sign in instead.");
    const org = await createOrgWithOwner(tx, { name: orgName, ownerId: user.id });
    const ctx: OrgCtx = { orgId: org.id, actor: { type: "user", id: user.id, label: email, userId: user.id, role: "owner", scopes: [] } };
    await writeAudit(ctx, "org.create", org.slug, { first_run: firstRun }, tx);
    return { userId: user.id, orgId: org.id };
  });
  return { sid: await newSession(userId, orgId), userId, orgId, firstRun };
}

export const LOGIN_LIMIT = 10;
export const LOGIN_WINDOW_SECONDS = 15 * 60;

/**
 * Verifies credentials and opens a session in the user's first org. Rate
 * limited per IP and per email (10 failed attempts per 15 minutes).
 */
export async function login(input: { email: string; password: string; ip: string }): Promise<{ sid: string; userId: string; orgId: string }> {
  const email = normalizeEmail(input.email);
  const ipKey = `rl:login:${input.ip || "unknown"}`;
  const emailKey = `rl:login:${email}`;
  const [byIp, byEmail] = await Promise.all([rateLimitPeek(ipKey, LOGIN_LIMIT), rateLimitPeek(emailKey, LOGIN_LIMIT)]);
  if (!byIp.allowed || !byEmail.allowed) {
    const wait = Math.max(byIp.retryAfter, byEmail.retryAfter);
    throw new ApiError(429, "rate_limited", `Too many sign-in attempts. Try again in ${Math.ceil(wait / 60)} minutes.`, { retry_after: wait });
  }

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const ok = await verifyPassword(input.password, user?.passwordHash ?? (await dummyPasswordHash()));
  if (!user || !ok) {
    await Promise.all([rateLimitHit(ipKey, LOGIN_LIMIT, LOGIN_WINDOW_SECONDS), rateLimitHit(emailKey, LOGIN_LIMIT, LOGIN_WINDOW_SECONDS)]);
    throw new ApiError(401, "unauthorized", "That email and password did not match.");
  }

  const [m] = await db
    .select({ orgId: memberships.orgId })
    .from(memberships)
    .where(eq(memberships.userId, user.id))
    .orderBy(memberships.createdAt)
    .limit(1);
  if (!m) throw forbidden("This account is not a member of any organization.");

  await Promise.all([rateLimitReset(emailKey), db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id))]);
  return { sid: await newSession(user.id, m.orgId), userId: user.id, orgId: m.orgId };
}

export async function logout(sid: string | undefined): Promise<void> {
  if (sid) await deleteSession(sid);
}

/**
 * Resolves a session id to the user, org and role. Returns null when the
 * session is gone, the user was deleted or they lost every membership. If the
 * user was removed from the session's org, it falls back to their first org.
 */
export async function loadSession(sid: string | undefined): Promise<SessionContext | null> {
  if (!sid || sid.length > 128) return null;
  const rec = await readSession(sid);
  if (!rec) return null;
  const rows = await db
    .select({ user: users, org: orgs, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(orgs, eq(orgs.id, memberships.orgId))
    .where(eq(memberships.userId, rec.userId))
    .orderBy(memberships.createdAt);
  if (rows.length === 0) return null;
  const pick = rows.find((r) => r.org.id === rec.orgId) ?? rows[0];
  if (pick.org.id !== rec.orgId) await updateSessionOrg(sid, pick.org.id);
  return {
    sid,
    user: { id: pick.user.id, email: pick.user.email, name: pick.user.name },
    org: { id: pick.org.id, slug: pick.org.slug, name: pick.org.name, plan: pick.org.plan },
    role: pick.role,
  };
}

/** Points the session at another org the user belongs to. */
export async function switchOrg(sid: string, userId: string, orgId: string): Promise<void> {
  const [m] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
    .limit(1);
  if (!m) throw forbidden("You are not a member of that organization.");
  await updateSessionOrg(sid, orgId);
}

/** Creates an additional org owned by the signed-in user and switches to it. */
export async function createOrg(s: SessionContext, name: string): Promise<SessionOrg> {
  if (!name.trim()) throw invalid("Give the organization a name.");
  const org = await db.transaction(async (tx) => {
    const o = await createOrgWithOwner(tx, { name, ownerId: s.user.id });
    await writeAudit({ orgId: o.id, actor: { ...actorFor(s), role: "owner" } }, "org.create", o.slug, {}, tx);
    return o;
  });
  await updateSessionOrg(s.sid, org.id);
  return { id: org.id, slug: org.slug, name: org.name, plan: org.plan };
}
