import "server-only";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { OrgCtx } from "../context";
import { db, type Tx } from "../db";
import { notificationReads, notifications } from "../db/schema";

export type Notification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
  created_at: string;
  read: boolean;
  /** true when addressed to the whole org rather than one user */
  org_wide: boolean;
};

export type NewNotification = { userId?: string | null; kind: string; title: string; body?: string; href?: string | null };

/** Creates a notification for one user, or for everyone in the org when userId is null. */
export async function createNotification(orgId: string, n: NewNotification, tx: Tx = db): Promise<string> {
  const [row] = await tx
    .insert(notifications)
    .values({ orgId, userId: n.userId ?? null, kind: n.kind, title: n.title, body: n.body ?? "", href: n.href ?? null })
    .returning({ id: notifications.id });
  return row.id;
}

function userId(ctx: OrgCtx): string {
  if (!ctx.actor.userId) throw new Error("notifications need a user actor");
  return ctx.actor.userId;
}

const visibleTo = (ctx: OrgCtx, uid: string) =>
  and(eq(notifications.orgId, ctx.orgId), or(isNull(notifications.userId), eq(notifications.userId, uid)));

/** Org-wide and personal notifications for the acting user, newest first, with per-user read state. */
export async function listNotifications(ctx: OrgCtx, opts: { limit?: number; unreadOnly?: boolean } = {}): Promise<Notification[]> {
  const uid = userId(ctx);
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 200);
  const readAt = sql<Date | null>`coalesce(${notifications.readAt}, ${notificationReads.readAt})`;
  const rows = await db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      title: notifications.title,
      body: notifications.body,
      href: notifications.href,
      createdAt: notifications.createdAt,
      userId: notifications.userId,
      readAt,
    })
    .from(notifications)
    .leftJoin(notificationReads, and(eq(notificationReads.notificationId, notifications.id), eq(notificationReads.userId, uid)))
    .where(and(visibleTo(ctx, uid), opts.unreadOnly ? sql`${readAt} is null` : undefined))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    href: r.href,
    created_at: r.createdAt.toISOString(),
    read: r.readAt !== null,
    org_wide: r.userId === null,
  }));
}

export async function unreadCount(ctx: OrgCtx): Promise<number> {
  const uid = userId(ctx);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .leftJoin(notificationReads, and(eq(notificationReads.notificationId, notifications.id), eq(notificationReads.userId, uid)))
    .where(and(visibleTo(ctx, uid), isNull(notifications.readAt), isNull(notificationReads.readAt)));
  return row?.n ?? 0;
}

/** Marks the given notifications (or all visible ones) as read for the acting user. */
export async function markRead(ctx: OrgCtx, ids?: string[]): Promise<void> {
  const uid = userId(ctx);
  if (ids && ids.length === 0) return;
  const scope = and(visibleTo(ctx, uid), ids ? inArray(notifications.id, ids) : undefined);
  await db.transaction(async (tx) => {
    await tx
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(scope, eq(notifications.userId, uid), isNull(notifications.readAt)));
    const orgWide = await tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(scope, isNull(notifications.userId)));
    if (orgWide.length) {
      await tx
        .insert(notificationReads)
        .values(orgWide.map((n) => ({ notificationId: n.id, userId: uid })))
        .onConflictDoNothing();
    }
  });
}
