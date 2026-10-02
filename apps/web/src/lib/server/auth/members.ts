import "server-only";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { requireAdmin, type OrgCtx } from "../context";
import { db } from "../db";
import { invites, memberships, orgs, users, type Role } from "../db/schema";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { writeAudit } from "../data/audit";
import { putSession } from "../redis";
import { EMAIL_RE, MIN_PASSWORD, normalizeEmail } from "./accounts";
import { hashPassword, randomId, sha256Hex, verifyPassword } from "./crypto";

export type Member = { user_id: string; email: string; name: string; role: Role; joined_at: string; last_login_at: string | null };

export async function listMembers(ctx: OrgCtx): Promise<Member[]> {
  const rows = await db
    .select({ m: memberships, u: users })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, ctx.orgId))
    .orderBy(asc(memberships.createdAt));
  return rows.map(({ m, u }) => ({
    user_id: u.id,
    email: u.email,
    name: u.name,
    role: m.role,
    joined_at: m.createdAt.toISOString(),
    last_login_at: u.lastLoginAt?.toISOString() ?? null,
  }));
}

async function ownerCount(ctx: OrgCtx): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.role, "owner")));
  return r?.n ?? 0;
}

async function member(ctx: OrgCtx, userId: string): Promise<{ role: Role; email: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw notFound("Member not found.");
  const [m] = await db
    .select({ role: memberships.role, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, userId)))
    .limit(1);
  if (!m) throw notFound("Member not found.");
  return m;
}

/** Owners and admins change roles; only owners grant or revoke owner; the last owner stays. */
export async function changeRole(ctx: OrgCtx, userId: string, role: Role): Promise<void> {
  requireAdmin(ctx);
  if (!["owner", "admin", "member"].includes(role)) throw invalid("Role must be owner, admin or member.");
  const { role: current, email } = await member(ctx, userId);
  if (current === role) return;
  if ((role === "owner" || current === "owner") && ctx.actor.role !== "owner") throw forbidden("Only owners can grant or revoke the owner role.");
  if (current === "owner" && role !== "owner" && (await ownerCount(ctx)) <= 1) throw conflict("An organization needs at least one owner.");
  await db
    .update(memberships)
    .set({ role })
    .where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, userId)));
  await writeAudit(ctx, "member.role", email, { user_id: userId, from: current, to: role });
}

/** Removes a member (or lets a user leave). Their sessions fall back to another org on next use. */
export async function removeMember(ctx: OrgCtx, userId: string): Promise<void> {
  if (ctx.actor.userId !== userId) requireAdmin(ctx);
  const { role: current, email } = await member(ctx, userId);
  if (current === "owner" && ctx.actor.role !== "owner" && ctx.actor.userId !== userId) throw forbidden("Only owners can remove an owner.");
  if (current === "owner" && (await ownerCount(ctx)) <= 1) throw conflict("An organization needs at least one owner.");
  await db.delete(memberships).where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, userId)));
  await writeAudit(ctx, "member.remove", email, { user_id: userId, role: current });
}

// ---------- Invites ----------

export const INVITE_TTL_DAYS = 7;

export type Invite = {
  id: string;
  email: string;
  role: Role;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
  invited_by?: string | null;
};

/** Creates an invite. The token (and the link built from it) is returned once and stored only as a hash. */
export async function createInvite(ctx: OrgCtx, input: { email: string; role?: Role }): Promise<{ invite: Invite; token: string }> {
  requireAdmin(ctx);
  const email = normalizeEmail(input.email);
  if (!EMAIL_RE.test(email)) throw invalid("Enter a valid email address.");
  const role = input.role ?? "member";
  if (role === "owner" && ctx.actor.role !== "owner") throw forbidden("Only owners can invite owners.");
  const token = randomId(32);
  const [row] = await db
    .insert(invites)
    .values({
      orgId: ctx.orgId,
      email,
      role,
      tokenHash: sha256Hex(token),
      invitedBy: ctx.actor.userId ?? null,
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 864e5),
    })
    .returning();
  await writeAudit(ctx, "member.invite", email, { role, invite_id: row.id });
  return {
    token,
    invite: {
      id: row.id,
      email: row.email,
      role: row.role,
      expires_at: row.expiresAt.toISOString(),
      accepted_at: null,
      created_at: row.createdAt.toISOString(),
    },
  };
}

export async function listInvites(ctx: OrgCtx, opts: { pendingOnly?: boolean } = { pendingOnly: true }): Promise<Invite[]> {
  const rows = await db
    .select({ r: invites, by: users.email })
    .from(invites)
    .leftJoin(users, eq(users.id, invites.invitedBy))
    .where(
      and(
        eq(invites.orgId, ctx.orgId),
        opts.pendingOnly ? isNull(invites.acceptedAt) : undefined,
        opts.pendingOnly ? gt(invites.expiresAt, new Date()) : undefined,
      ),
    )
    .orderBy(asc(invites.createdAt));
  return rows.map(({ r, by }) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    expires_at: r.expiresAt.toISOString(),
    accepted_at: r.acceptedAt?.toISOString() ?? null,
    created_at: r.createdAt.toISOString(),
    invited_by: by ?? null,
  }));
}

export async function revokeInvite(ctx: OrgCtx, id: string): Promise<void> {
  requireAdmin(ctx);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Invite not found.");
  const [row] = await db
    .delete(invites)
    .where(and(eq(invites.orgId, ctx.orgId), eq(invites.id, id), isNull(invites.acceptedAt)))
    .returning({ email: invites.email });
  if (!row) throw notFound("Invite not found.");
  await writeAudit(ctx, "member.invite_revoke", row.email, { invite_id: id });
}

export type InvitePreview = { org: { name: string; slug: string }; email: string; role: Role; existingUser: boolean };

async function pendingInvite(token: string) {
  if (!token || token.length > 128) return null;
  const [r] = await db
    .select({ invite: invites, org: orgs })
    .from(invites)
    .innerJoin(orgs, eq(orgs.id, invites.orgId))
    .where(and(eq(invites.tokenHash, sha256Hex(token)), isNull(invites.acceptedAt), gt(invites.expiresAt, new Date())))
    .limit(1);
  return r ?? null;
}

/** What the /invite/<token> page shows. Null when the token is unknown, used or expired. */
export async function previewInvite(token: string): Promise<InvitePreview | null> {
  const r = await pendingInvite(token);
  if (!r) return null;
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, r.invite.email)).limit(1);
  return { org: { name: r.org.name, slug: r.org.slug }, email: r.invite.email, role: r.invite.role, existingUser: Boolean(u) };
}

/**
 * Accepts an invite. New emails create an account with the given password;
 * existing accounts must confirm their password. Opens a session in the org.
 */
export async function acceptInvite(input: { token: string; password: string; name?: string }): Promise<{ sid: string; orgId: string; userId: string }> {
  const r = await pendingInvite(input.token);
  if (!r) throw notFound("This invite link is invalid or has expired.");
  const { invite } = r;

  const [existing] = await db.select().from(users).where(eq(users.email, invite.email)).limit(1);
  let userId: string;
  if (existing) {
    if (!(await verifyPassword(input.password, existing.passwordHash))) throw invalid("That password does not match your existing account.");
    userId = existing.id;
  } else {
    if (input.password.length < MIN_PASSWORD) throw invalid(`Passwords need at least ${MIN_PASSWORD} characters.`);
    const passwordHash = await hashPassword(input.password);
    const [u] = await db
      .insert(users)
      .values({ email: invite.email, name: (input.name ?? "").trim().slice(0, 120), passwordHash })
      .onConflictDoNothing()
      .returning({ id: users.id });
    if (!u) throw conflict("An account with that email was just created. Try again.");
    userId = u.id;
  }

  await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(invites)
      .set({ acceptedAt: new Date() })
      .where(and(eq(invites.id, invite.id), isNull(invites.acceptedAt)))
      .returning({ id: invites.id });
    if (!claimed) throw conflict("This invite was already used.");
    await tx.insert(memberships).values({ orgId: invite.orgId, userId, role: invite.role }).onConflictDoNothing();
    await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
    await writeAudit(
      { orgId: invite.orgId, actor: { type: "user", id: userId, label: invite.email, userId, scopes: [] } },
      "member.join",
      invite.email,
      { role: invite.role, invite_id: invite.id },
      tx,
    );
  });

  const sid = randomId(32);
  await putSession(sid, { userId, orgId: invite.orgId, createdAt: new Date().toISOString() });
  return { sid, orgId: invite.orgId, userId };
}
