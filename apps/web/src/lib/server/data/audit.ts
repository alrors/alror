import "server-only";
import { and, desc, eq, inArray, like, lt, sql } from "drizzle-orm";
import { requireAdmin, type Actor, type OrgCtx } from "../context";
import { db, type Tx } from "../db";
import { auditLog } from "../db/schema";

export type AuditEntry = {
  id: number;
  actor_type: Actor["type"];
  actor_id: string | null;
  actor_label: string;
  action: string;
  target: string;
  meta: Record<string, unknown>;
  at: string;
};

/** Appends one audit row for the acting user, key or system. */
export async function writeAudit(
  ctx: OrgCtx,
  action: string,
  target: string,
  meta: Record<string, unknown> = {},
  tx: Tx = db,
): Promise<void> {
  await tx.insert(auditLog).values({
    orgId: ctx.orgId,
    actorType: ctx.actor.type,
    actorId: ctx.actor.id,
    actorLabel: ctx.actor.label,
    action,
    target,
    meta,
  });
}

export async function listAudit(ctx: OrgCtx, opts: { limit?: number; before?: number; action?: string } = {}): Promise<AuditEntry[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const rows = await db
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.orgId, ctx.orgId),
        opts.before ? lt(auditLog.id, opts.before) : undefined,
        opts.action ? eq(auditLog.action, opts.action) : undefined,
      ),
    )
    .orderBy(desc(auditLog.id))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    actor_type: r.actorType,
    actor_id: r.actorId,
    actor_label: r.actorLabel,
    action: r.action,
    target: r.target,
    meta: r.meta,
    at: r.at.toISOString(),
  }));
}

const toEntry = (r: typeof auditLog.$inferSelect): AuditEntry => ({
  id: r.id,
  actor_type: r.actorType,
  actor_id: r.actorId,
  actor_label: r.actorLabel,
  action: r.action,
  target: r.target,
  meta: r.meta,
  at: r.at.toISOString(),
});

export const AUDIT_CATEGORY_RE = /^[a-z_]{1,32}$/;

/**
 * One page of the audit log, newest first (owners and admins). `category` keeps
 * actions starting with "<category>." (e.g. "member", "api_key", "deployment").
 */
export async function pageAudit(
  ctx: OrgCtx,
  opts: { page: number; per: number; category?: string },
): Promise<{ items: AuditEntry[]; total: number }> {
  requireAdmin(ctx);
  const cat = opts.category && AUDIT_CATEGORY_RE.test(opts.category) ? opts.category : undefined;
  const where = and(eq(auditLog.orgId, ctx.orgId), cat ? like(auditLog.action, `${cat}.%`) : undefined);
  const [rows, [count]] = await Promise.all([
    db
      .select()
      .from(auditLog)
      .where(where)
      .orderBy(desc(auditLog.id))
      .limit(opts.per)
      .offset((Math.max(opts.page, 1) - 1) * opts.per),
    db.select({ n: sql<number>`count(*)::int` }).from(auditLog).where(where),
  ]);
  return { items: rows.map(toEntry), total: count?.n ?? 0 };
}

/**
 * Newest audit rows whose action is one of `actions`, plus how many there are in
 * all. Used by the Overview activity feed, which pages over a merged list.
 */
export async function listAuditActions(ctx: OrgCtx, actions: string[], limit: number): Promise<{ items: AuditEntry[]; total: number }> {
  if (actions.length === 0) return { items: [], total: 0 };
  const where = and(eq(auditLog.orgId, ctx.orgId), inArray(auditLog.action, actions));
  const [rows, [count]] = await Promise.all([
    db
      .select()
      .from(auditLog)
      .where(where)
      .orderBy(desc(auditLog.id))
      .limit(Math.min(Math.max(limit, 1), 500)),
    db.select({ n: sql<number>`count(*)::int` }).from(auditLog).where(where),
  ]);
  return { items: rows.map(toEntry), total: count?.n ?? 0 };
}
