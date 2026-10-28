import "server-only";
import { and, desc, eq, isNotNull, like, or } from "drizzle-orm";
import type { OrgCtx } from "../context";
import { db } from "../db";
import { githubDecisions, githubRepositories, type StoredPlan, type StoredRisk } from "../db/schema";
import { invalid, notFound } from "../errors";
import type { RiskDecision } from "./decide";

const NS_PER_SECOND = 1_000_000_000;

/** Column values for a decision, in the Go domain shapes (plan bake in nanoseconds) the CLI reads back. */
export function storedDecision(d: RiskDecision): { risk: StoredRisk; plan: StoredPlan } {
  return {
    risk: { ...d.risk, rules_version: d.rulesVersion },
    plan: { strategy: d.plan.strategy, steps: d.plan.steps.map((s) => ({ weight: s.weight, bake: s.bake_seconds * NS_PER_SECOND })) },
  };
}

/** Response of GET /api/v1/decisions/{sha} (docs/platform-contract.md). */
export type CommitDecision = {
  sha: string; head_sha: string; merge_sha: string | null; matched: "head" | "merge";
  repository: string; pull_number: number; url: string; outcome: string; mode: string;
  rules_version: number; risk: Omit<StoredRisk, "rules_version">; plan: StoredPlan; reasons: string[]; updated_at: string;
};

/**
 * The newest stored decision for a commit: the PR head SHA Alror evaluated, or the commit GitHub created when
 * that PR merged. Accepts a full SHA or an unambiguous prefix of at least 7 hex characters.
 */
export async function getCommitDecision(ctx: OrgCtx, rawSha: string): Promise<CommitDecision> {
  const sha = rawSha.trim().toLowerCase();
  if (!/^[0-9a-f]{7,64}$/.test(sha)) throw invalid("sha must be 7 to 64 hexadecimal characters.");
  const match = (column: typeof githubDecisions.headSha | typeof githubDecisions.mergeSha) => sha.length >= 40 ? eq(column, sha) : like(column, `${sha}%`);
  const rows = await db.select({ d: githubDecisions, repository: githubRepositories.fullName }).from(githubDecisions)
    .innerJoin(githubRepositories, eq(githubRepositories.id, githubDecisions.repositoryId))
    .where(and(eq(githubDecisions.orgId, ctx.orgId), isNotNull(githubDecisions.risk), or(match(githubDecisions.headSha), match(githubDecisions.mergeSha))))
    .orderBy(desc(githubDecisions.updatedAt), desc(githubDecisions.id)).limit(20);
  const commits = new Set(rows.map(({ d }) => (d.headSha.startsWith(sha) ? d.headSha : d.mergeSha)));
  if (commits.size > 1) throw invalid("sha prefix matches more than one commit; pass more characters.");
  const row = rows[0];
  if (!row?.d.risk || !row.d.plan) throw notFound("No decision is stored for this commit.");
  const { d, repository } = row;
  const { rules_version, ...risk } = d.risk!;
  return {
    sha: d.headSha.startsWith(sha) ? d.headSha : d.mergeSha!, head_sha: d.headSha, merge_sha: d.mergeSha,
    matched: d.headSha.startsWith(sha) ? "head" : "merge", repository, pull_number: d.pullNumber, url: d.url,
    outcome: d.outcome, mode: d.mode, rules_version, risk, plan: d.plan!, reasons: d.reasons, updated_at: d.updatedAt.toISOString(),
  };
}
