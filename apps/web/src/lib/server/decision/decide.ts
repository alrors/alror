import type { ChangedFile } from "../github/types";
import { planFor, RULES_VERSION, scoreChange, type RiskReport, type RiskWeights, type RolloutPlan, type ServiceRule } from "./score";

/** The risk half of a PR decision; the merge-gate half is evaluatePolicy. Stored per head SHA. */
export type RiskDecision = { rulesVersion: number; risk: RiskReport; plan: RolloutPlan; weights?: RiskWeights };
/**
 * What the portal knows beyond the diff: the org's services, recent rollbacks per service and the factor
 * weights the org accepted from tuning proposals (absent or empty = the shared rules unchanged).
 */
export type DecisionContext = { services: ServiceRule[]; recentRollbacks: Record<string, number>; weights?: RiskWeights };
/** The fields Alror reads from GET /repos/{repo}/pulls/{n}/commits. */
export type PullCommit = { commit: { message: string; author: { name?: string; email?: string } | null }; author: { login: string } | null };

/** Scores a pull request's changed files, commit authors and messages with the shared rules. */
export function decidePull(files: ChangedFile[], commits: PullCommit[], context: DecisionContext): RiskDecision {
  const authors = commits.flatMap((c) => [
    ...(c.commit.author?.name || c.commit.author?.email ? [`${c.commit.author?.name ?? ""} <${c.commit.author?.email ?? ""}>`] : []),
    ...(c.author?.login ? [c.author.login] : []),
  ]);
  const risk = scoreChange(context.services, {
    files: files.map((f) => ({ path: f.filename, added: f.additions, deleted: f.deletions })),
    authors, message: commits.map((c) => c.commit.message).join("\n"), recentRollbacks: context.recentRollbacks,
  }, context.weights);
  const weighted = context.weights && Object.keys(context.weights).length > 0;
  return { rulesVersion: RULES_VERSION, risk, plan: planFor(risk.level), ...(weighted ? { weights: context.weights } : {}) };
}
