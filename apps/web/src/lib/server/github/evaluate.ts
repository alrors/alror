import "server-only";
import type { GitHubClient } from "./client";
import { repoPath } from "./client";
import { evaluatePolicy } from "./policy";
import { CHECK_NAME, COMMENT_MARKER, decisionMarkdown } from "./report";
import type { ChangedFile, CheckEvidence, GatePolicy, GateResult, PullSnapshot } from "./types";

export type Evaluation = { pull: PullSnapshot; result: GateResult; checkId?: string; commentId?: string };
export type EvaluationHooks = {
  /** Must check the lease, repository enabled state, and current policy version. */
  beforeEffect: () => Promise<void>;
  save: (evaluation: Evaluation) => Promise<void>;
  audit: (action: string, meta: Record<string, unknown>) => Promise<void>;
};
type Review = { user: { login: string }; state: string; submitted_at: string | null; commit_id: string };
type ApiCheck = { id: number; name: string; app: { id: number }; status: string; conclusion: string | null; external_id?: string };
export function hasBlockingReview(reviews: Review[]): boolean {
  const latest = new Map<string, Review>();
  for (const review of [...reviews].sort((a, b) => (a.submitted_at || "").localeCompare(b.submitted_at || ""))) {
    if (["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state)) latest.set(review.user.login, review);
  }
  return [...latest.values()].some((review) => review.state === "CHANGES_REQUESTED");
}

export async function evaluatePull(client: GitHubClient, input: {
  repositoryId: string; fullName: string; pullNumber: number; policy: GatePolicy; policyVersion: number;
  appId: number; appSlug: string; detailsUrl: string;
}, hooks: EvaluationHooks): Promise<Evaluation> {
  const path = repoPath(input.fullName), prPath = `${path}/pulls/${input.pullNumber}`;
  const pull = await client.request<PullSnapshot>(prPath);
  if (String(pull.base.repo.id) !== input.repositoryId) throw new Error("GitHub repository identity no longer matches its workspace binding.");
  const files = pull.state === "open" ? await client.pages<ChangedFile>(`${prPath}/files`) : [];
  const checks = pull.state === "open" ? await client.pages<ApiCheck>(`${path}/commits/${pull.head.sha}/check-runs?filter=latest`, "check_runs") : [];
  const evidence: CheckEvidence[] = checks.map((c) => ({ name: c.name, appId: c.app.id, status: c.status, conclusion: c.conclusion }));
  const result = evaluatePolicy(input.policy, pull, files, evidence);
  const evaluation: Evaluation = { pull, result };
  await hooks.save(evaluation);
  if (result.outcome === "closed") return evaluation;

  const externalId = `alror:${input.repositoryId}:${pull.number}:${pull.head.sha}:${pull.base.sha}:${input.policyVersion}`;
  const existing = checks.find((c) => c.app.id === input.appId && c.external_id === externalId);
  const summary = decisionMarkdown(pull, result, input.policy, files, input.detailsUrl);
  const status = result.outcome === "waiting" && input.policy.mode !== "observe" ? "in_progress" : "completed";
  const conclusion = input.policy.mode === "observe" ? "neutral" : result.outcome === "eligible" ? "success" : "action_required";
  await hooks.beforeEffect();
  const check = await client.request<{ id: number }>(existing ? `${path}/check-runs/${existing.id}` : `${path}/check-runs`, existing ? "PATCH" : "POST", {
    name: CHECK_NAME, ...(existing ? {} : { head_sha: pull.head.sha }), external_id: externalId,
    status, ...(status === "completed" ? { conclusion } : {}), details_url: input.detailsUrl,
    output: { title: result.outcome === "eligible" ? "Policy checks passed" : result.outcome === "waiting" ? "Waiting for checks" : "Human review required", summary },
  });
  evaluation.checkId = String(check.id); await hooks.save(evaluation);

  const comments = await client.pages<{ id: number; body: string; user: { login: string; type: string } }>(`${path}/issues/${pull.number}/comments`);
  const previous = comments.find((c) => c.user.type === "Bot" && c.user.login === `${input.appSlug}[bot]` && c.body.startsWith(COMMENT_MARKER));
  await hooks.beforeEffect();
  const comment = await client.request<{ id: number }>(previous ? `${path}/issues/comments/${previous.id}` : `${path}/issues/${pull.number}/comments`, previous ? "PATCH" : "POST", { body: summary });
  evaluation.commentId = String(comment.id); await hooks.save(evaluation);

  if (result.outcome === "review_required" && input.policy.mode !== "observe") {
    const current = await client.request<{ users: { login: string }[] }>(`${prPath}/requested_reviewers`);
    const reviews = await client.pages<Review>(`${prPath}/reviews`);
    const reviewers = input.policy.reviewers.filter((login) => login !== pull.user.login && !current.users.some((u) => u.login === login) && !reviews.some((r) => r.user.login === login && r.commit_id === pull.head.sha && ["APPROVED", "CHANGES_REQUESTED"].includes(r.state)));
    if (reviewers.length) {
      await hooks.beforeEffect();
      await client.request(`${prPath}/requested_reviewers`, "POST", { reviewers });
      await hooks.audit("github.review_requested", { reviewers, head_sha: pull.head.sha });
    }
  }
  if (result.outcome !== "eligible" || input.policy.mode !== "auto_merge") return evaluation;

  // Never approve a PR or bypass GitHub's review, checks, merge queue, or branch restrictions.
  const fresh = await client.request<PullSnapshot>(prPath);
  if (fresh.head.sha !== pull.head.sha || fresh.base.sha !== pull.base.sha || fresh.state !== "open" || fresh.draft || fresh.merged) {
    throw new Error("The pull request changed during evaluation; it must be re-evaluated.");
  }
  const [latestChecks, reviews] = await Promise.all([
    client.pages<ApiCheck>(`${path}/commits/${pull.head.sha}/check-runs?filter=latest`, "check_runs"),
    client.pages<Review>(`${prPath}/reviews`),
  ]);
  const finalResult = evaluatePolicy(input.policy, fresh, files, latestChecks.map((c) => ({ name: c.name, appId: c.app.id, status: c.status, conclusion: c.conclusion })));
  if (finalResult.outcome !== "eligible" || fresh.mergeable !== true || fresh.mergeable_state !== "clean" || hasBlockingReview(reviews)) {
    evaluation.result = { ...finalResult, outcome: finalResult.outcome === "review_required" ? "review_required" : "waiting", reasons: [...finalResult.reasons, "Automatic merge is waiting for GitHub branch protections and human review requirements."] };
    await hooks.save(evaluation);
    await hooks.beforeEffect();
    await client.request(`${path}/issues/comments/${comment.id}`, "PATCH", { body: decisionMarkdown(fresh, evaluation.result, input.policy, files, input.detailsUrl) });
    if (finalResult.outcome !== "eligible") {
      await hooks.beforeEffect();
      await client.request(`${path}/check-runs/${check.id}`, "PATCH", { status: finalResult.outcome === "waiting" ? "in_progress" : "completed",
        ...(finalResult.outcome === "waiting" ? {} : { conclusion: "action_required" }),
        output: { title: "Re-evaluation required", summary: decisionMarkdown(fresh, evaluation.result, input.policy, files, input.detailsUrl) } });
    }
    return evaluation;
  }
  await hooks.beforeEffect();
  const merged = await client.request<{ merged: boolean; sha?: string }>(`${prPath}/merge`, "PUT", { sha: pull.head.sha, merge_method: input.policy.mergeMethod });
  if (!merged.merged) throw new Error("GitHub did not merge the evaluated commit.");
  evaluation.result = { ...result, outcome: "closed", reasons: [`Merged evaluated commit ${pull.head.sha.slice(0, 12)} after configured checks and GitHub protections passed.`] };
  await hooks.save(evaluation);
  await hooks.audit("github.pull_merged", { head_sha: pull.head.sha, merge_sha: merged.sha || "", method: input.policy.mergeMethod });
  await hooks.beforeEffect();
  await client.request(`${path}/issues/comments/${comment.id}`, "PATCH", { body: `${COMMENT_MARKER}\n### Alror · Merged\n\nMerged evaluated commit \`${pull.head.sha.slice(0, 12)}\` after configured checks and GitHub protections passed.\n\n[Open Alror](${input.detailsUrl})` });
  return evaluation;
}
