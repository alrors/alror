import "server-only";
import { desc, eq } from "drizzle-orm";
import { requireAdmin, type OrgCtx } from "../context";
import { db } from "../db";
import { feedback, users } from "../db/schema";
import { invalid } from "../errors";

export type FeedbackEntry = { id: string; message: string; page: string; from: string | null; created_at: string };

export const FEEDBACK_MAX = 4000;

/** Stores feedback from a console user in the org's own database. Nothing leaves the server. */
export async function createFeedback(ctx: OrgCtx, input: { message: string; page?: string }): Promise<string> {
  const message = input.message.trim();
  if (message.length < 3) throw invalid("Write a little more so we know what to look at.");
  if (message.length > FEEDBACK_MAX) throw invalid(`Feedback is limited to ${FEEDBACK_MAX} characters.`);
  const page = (input.page ?? "").slice(0, 300);
  const [row] = await db
    .insert(feedback)
    .values({ orgId: ctx.orgId, userId: ctx.actor.userId ?? null, message, page })
    .returning({ id: feedback.id });
  return row.id;
}

/** Recent feedback for the org (owners and admins). */
export async function listFeedback(ctx: OrgCtx, limit = 50): Promise<FeedbackEntry[]> {
  requireAdmin(ctx);
  const rows = await db
    .select({ f: feedback, from: users.email })
    .from(feedback)
    .leftJoin(users, eq(users.id, feedback.userId))
    .where(eq(feedback.orgId, ctx.orgId))
    .orderBy(desc(feedback.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));
  return rows.map(({ f, from }) => ({ id: f.id, message: f.message, page: f.page, from, created_at: f.createdAt.toISOString() }));
}
