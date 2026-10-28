import "server-only";
import { and, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import type { OrgCtx } from "../context";
import { db } from "../db";
import { auditLog, githubDecisions, githubRepositories } from "../db/schema";

// Read-only queries for the oversight home. They read what the GitHub worker and the
// rollout engine already stored; nothing here evaluates or changes anything.

/** Pull request gate numbers since `since`: PRs evaluated, auto-merged, and sent to a person. */
export async function gateImpact(ctx: OrgCtx, since: Date, until: Date): Promise<{ connected: boolean; evaluated: number; merged: number; routed: number }> {
  const [[repos], [evaluated], [routed], [merged]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(githubRepositories).where(eq(githubRepositories.orgId, ctx.orgId)),
    db
      .select({ n: sql<number>`count(distinct (${githubDecisions.repositoryId}, ${githubDecisions.pullNumber}))::int` })
      .from(githubDecisions)
      .where(and(eq(githubDecisions.orgId, ctx.orgId), gte(githubDecisions.updatedAt, since), lt(githubDecisions.updatedAt, until))),
    // Routed to a person: the gate required review while enforcing (observe mode only reports).
    db
      .select({ n: sql<number>`count(distinct (${githubDecisions.repositoryId}, ${githubDecisions.pullNumber}))::int` })
      .from(githubDecisions)
      .where(
        and(
          eq(githubDecisions.orgId, ctx.orgId),
          eq(githubDecisions.outcome, "review_required"),
          ne(githubDecisions.mode, "observe"),
          gte(githubDecisions.updatedAt, since),
          lt(githubDecisions.updatedAt, until),
        ),
      ),
    // Auto-merged: the worker audits every merge it performs.
    db
      .select({ n: sql<number>`count(distinct ${auditLog.target})::int` })
      .from(auditLog)
      .where(and(eq(auditLog.orgId, ctx.orgId), eq(auditLog.action, "github.pull_merged"), gte(auditLog.at, since), lt(auditLog.at, until))),
  ]);
  return { connected: (repos?.n ?? 0) > 0, evaluated: evaluated?.n ?? 0, merged: merged?.n ?? 0, routed: routed?.n ?? 0 };
}

/** Deployment ids a person asked to roll back through the job queue (audit "deployment.rollback"). */
export async function manualRollbackIds(ctx: OrgCtx, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ target: auditLog.target })
    .from(auditLog)
    .where(and(eq(auditLog.orgId, ctx.orgId), eq(auditLog.action, "deployment.rollback"), inArray(auditLog.target, ids.slice(0, 1000))));
  return new Set(rows.map((r) => r.target));
}
