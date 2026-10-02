import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight, GitPullRequest } from "lucide-react";
import { Card, PageHeader, Pill, buttonClass } from "@/components/console/primitives";
import { requireCtx } from "@/lib/server/auth/session";
import { getPullDecision } from "@/lib/server/github/data";
import { DecisionRefresh } from "./refresh";

export const metadata: Metadata = { title: "Pull request decision" };

const modes = { observe: "Observe", review: "Require review", auto_merge: "Auto-merge" };
const outcomes: Record<string, string> = { eligible: "Policy checks passed", review_required: "Review required", waiting: "Waiting for checks", closed: "Closed", merged: "Merged", observed: "Observed", error: "Evaluation error" };
const timestamp = (date: Date) => date.toISOString().replace("T", " ").slice(0, 19) + " UTC";

export default async function PullDecisionPage({ params }: { params: Promise<{ repositoryId: string; pullNumber: string }> }) {
  const { repositoryId, pullNumber: pullParam } = await params;
  if (!/^[1-9]\d*$/.test(pullParam)) notFound();
  const ctx = await requireCtx();
  const result = await getPullDecision(ctx, repositoryId, Number(pullParam));
  if (!result) notFound();
  const { repository, latest, history } = result;
  const githubURL = `https://github.com/${repository.fullName}/pull/${latest.pullNumber}`;
  const needsAttention = latest.outcome === "review_required" || latest.outcome === "error";
  const nextStep = latest.outcome === "merged" ? "This pull request has been merged."
    : latest.outcome === "closed" ? "This pull request is closed. Reopen it to request a new evaluation."
    : latest.outcome === "waiting" ? "Wait for the required checks to complete. Alror will evaluate the latest commit again."
    : needsAttention ? "Review the policy evidence below and resolve the flagged items before merging."
    : latest.mode === "observe" ? "A reviewer can merge when GitHub protections permit it. Observe mode reports results without requesting reviewers or merging."
    : latest.mode === "review" ? "Review the change on GitHub and merge when repository protections permit it."
    : "Alror can merge eligible changes after a fresh check of CI, the policy, and GitHub protections.";

  return <div className="space-y-6">
    <Link href="/app/github" className="inline-flex items-center gap-2 text-[13px] text-con-fg3 hover:text-con-fg"><ArrowLeft size={14} />GitHub repositories</Link>
    <PageHeader title={latest.title || `Pull request #${latest.pullNumber}`} description={`${repository.fullName} / Pull request #${latest.pullNumber}`} meta={<Pill><GitPullRequest size={12} />Pull request decision</Pill>} actions={<a href={githubURL} target="_blank" rel="noreferrer" className={buttonClass.secondary}>View on GitHub<ArrowUpRight size={14} /></a>} />
    <Card title={outcomes[latest.outcome] ?? latest.outcome.replaceAll("_", " ")} aside={<Pill tone={needsAttention ? "warn" : "idle"}>{modes[latest.mode]}</Pill>}>
      <div className="grid gap-5 sm:grid-cols-3">
        <div><p className="text-[12px] text-con-fg3">Rule-based risk</p><p className="mt-1 font-mono text-3xl tracking-tight">{latest.score}<span className="text-base text-con-fg3"> / 100</span></p></div>
        <div><p className="text-[12px] text-con-fg3">Evaluated commit</p><a href={`https://github.com/${repository.fullName}/commit/${latest.headSha}`} target="_blank" rel="noreferrer" className="mt-2 inline-block font-mono text-[13px] hover:underline" title={latest.headSha}>{latest.headSha.slice(0, 12)}</a><p className="mt-1 text-[12px] text-con-fg3">Policy version {latest.policyVersion}</p></div>
        <div><p className="text-[12px] text-con-fg3">Last evaluated</p><time dateTime={latest.updatedAt.toISOString()} className="mt-2 block text-[13px]">{timestamp(latest.updatedAt)}</time><DecisionRefresh /></div>
      </div>
      <div className="mt-6 border-t border-con-line pt-4"><h2 className="text-[13px] font-medium">Next step</h2><p className="mt-2 text-[13px] leading-relaxed text-con-fg2">{nextStep}</p></div>
    </Card>
    <Card title="Policy evidence" description="The reasons recorded for this commit and policy version.">
      {latest.reasons.length ? <ul className="list-disc space-y-3 pl-4 text-[13px] leading-relaxed text-con-fg2">{latest.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul> : <p className="text-[13px] text-con-fg3">No additional evidence was recorded.</p>}
      <p className="mt-5 text-[12px] leading-relaxed text-con-fg3">This assessment covers changed paths and configured CI requirements. It does not assess code correctness or replace a code review.</p>
    </Card>
    <Card title="Current repository policy" description={`Version ${repository.policyVersion}. Historical decisions retain the policy version and mode used when evaluated.`}>
      <dl className="grid gap-5 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
        <div><dt className="text-con-fg3">Mode</dt><dd className="mt-1">{modes[repository.policy.mode]}</dd></div>
        <div><dt className="text-con-fg3">Change limits</dt><dd className="mt-1">{repository.policy.maxChangedFiles} files / {repository.policy.maxChangedLines} changed lines</dd></div>
        <div><dt className="text-con-fg3">Required CI checks</dt><dd className="mt-1 break-words">{repository.policy.requiredChecks.map((check) => `${check.name} (App ${check.appId})`).join(", ") || "None configured"}</dd></div>
        <div><dt className="text-con-fg3">Allowed paths</dt><dd className="mt-1 break-words font-mono text-[12px]">{repository.policy.allowedPaths.join(", ") || "No path allowlist"}</dd></div>
        <div><dt className="text-con-fg3">Configured reviewers</dt><dd className="mt-1 break-words">{repository.policy.reviewers.join(", ") || "None configured"}</dd></div>
        <div><dt className="text-con-fg3">Code changes require tests</dt><dd className="mt-1">{repository.policy.requireTests ? "Yes" : "No"}</dd></div>
      </dl>
    </Card>
    <Card title="Earlier evaluations" description="Up to 49 earlier commit, base, and policy combinations. Re-evaluations of the same combination update its existing record.">
      {history.length === 0 ? <p className="text-[13px] text-con-fg3">This is the first recorded evaluation for this pull request.</p> : <div className="divide-y divide-con-line">{history.map((decision) => <details key={decision.id} className="py-4 first:pt-0 last:pb-0">
        <summary className="cursor-pointer text-[13px]"><span className="font-medium">{outcomes[decision.outcome] ?? decision.outcome.replaceAll("_", " ")}</span><span className="ml-3 font-mono text-con-fg3">{decision.headSha.slice(0, 12)}</span><span className="mt-1 block text-[12px] text-con-fg3">{timestamp(decision.updatedAt)} / risk {decision.score}/100 / {modes[decision.mode]} / policy {decision.policyVersion}</span></summary>
        <p className="mt-3 break-all font-mono text-[11px] text-con-fg3">Head: {decision.headSha}<br />Base: {decision.baseSha}</p>
        <ul className="mt-3 list-disc space-y-2 pl-4 text-[13px] text-con-fg2">{decision.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
      </details>)}</div>}
    </Card>
  </div>;
}
