import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { requireAdmin, type OrgCtx } from "../context";
import { db } from "../db";
import { githubDecisions, githubDeliveries, githubRepositories } from "../db/schema";
import { writeAudit } from "../data/audit";
import { invalid, notFound } from "../errors";
import { normalizePolicy } from "./policy";
import type { DecisionView, GatePolicy, RepositoryView } from "./types";

export async function listRepositories(ctx: OrgCtx): Promise<RepositoryView[]> {
  const rows = await db.select().from(githubRepositories).where(eq(githubRepositories.orgId, ctx.orgId)).orderBy(githubRepositories.fullName);
  return rows.map((r) => ({ id: r.id, fullName: r.fullName, installationId: r.installationId, enabled: r.enabled, policy: r.policy, updatedAt: r.updatedAt.toISOString() }));
}

export async function listDecisions(ctx: OrgCtx, opts: { limit?: number } = {}): Promise<DecisionView[]> {
  const rows = await db.select({ d: githubDecisions, repository: githubRepositories.fullName }).from(githubDecisions)
    .innerJoin(githubRepositories, eq(githubRepositories.id, githubDecisions.repositoryId))
    .where(eq(githubDecisions.orgId, ctx.orgId)).orderBy(desc(githubDecisions.updatedAt)).limit(Math.min(200, Math.max(1, opts.limit ?? 50)));
  return rows.map(({ d, repository }) => ({ id: d.id, repositoryId: d.repositoryId, repository, pullNumber: d.pullNumber, title: d.title, url: d.url, headSha: d.headSha, outcome: d.outcome, score: d.score, reasons: d.reasons, mode: d.mode, updatedAt: d.updatedAt.toISOString() }));
}

export async function savePolicy(ctx: OrgCtx, repositoryId: string, input: GatePolicy): Promise<void> {
  requireAdmin(ctx);
  const result = (() => { try { return normalizePolicy(input); } catch (e) { throw invalid(e instanceof Error ? e.message : "Invalid repository policy."); } })();
  await db.transaction(async (tx) => {
    const [repository] = await tx.update(githubRepositories).set({ policy: result, policyVersion: sql`${githubRepositories.policyVersion} + 1`, updatedAt: new Date() })
      .where(and(eq(githubRepositories.orgId, ctx.orgId), eq(githubRepositories.id, repositoryId))).returning();
    if (!repository) throw notFound("Repository not found in this workspace.");
    await tx.insert(githubDeliveries).values({ id: `policy:${randomUUID()}`, event: "reconcile", installationId: repository.installationId, repositoryId, payload: { reason: "policy_changed" } });
    await writeAudit(ctx, "github.policy_updated", repository.fullName, { policy: result, version: repository.policyVersion }, tx);
  });
}

export async function requeueEvaluation(ctx: OrgCtx, repositoryId: string, pullNumber: number): Promise<void> {
  requireAdmin(ctx);
  if (!Number.isSafeInteger(pullNumber) || pullNumber < 1) throw invalid("A valid pull request number is required.");
  const [repository] = await db.select().from(githubRepositories).where(and(eq(githubRepositories.orgId, ctx.orgId), eq(githubRepositories.id, repositoryId), eq(githubRepositories.enabled, true)));
  if (!repository) throw notFound("Enabled repository not found in this workspace.");
  await db.transaction(async (tx) => {
    await tx.insert(githubDeliveries).values({ id: `manual:${randomUUID()}`, event: "evaluate", installationId: repository.installationId, repositoryId, payload: { pullNumber } });
    await writeAudit(ctx, "github.evaluation_requested", `${repository.fullName}#${pullNumber}`, {}, tx);
  });
}
