import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight, GitPullRequest } from "lucide-react";
import { Card, Dot, PageHeader, Pill, buttonClass } from "@/components/console/primitives";
import { requireCtx } from "@/lib/server/auth/session";
import { getPullDecision } from "@/lib/server/github/data";
import { byHeadSha, GATE_MODE, GATE_OUTCOME, gateFindings, gateWhy, requiredCheckStates, type CheckState } from "@/lib/console/oversight";
import type { Tone } from "@/lib/console/format";
import { rules as riskRules } from "@/lib/server/decision/score";
import { DecisionRefresh } from "./refresh";

export const metadata: Metadata = { title: "Pull request decision" };

const timestamp = (date: Date) => date.toISOString().replace("T", " ").slice(0, 19) + " UTC";
const outcomeLabel = (o: string) => GATE_OUTCOME[o] ?? o.replaceAll("_", " ");
const outcomeTone = (o: string): Tone => (o === "review_required" || o === "error" ? "warn" : o === "eligible" || o === "merged" ? "good" : o === "waiting" ? "info" : "idle");
const CHECK: Record<CheckState, { label: string; tone: Tone }> = {
  passed: { label: "Passed", tone: "good" },
  pending: { label: "Pending", tone: "info" },
  failed: { label: "Did not pass", tone: "bad" },
  not_evaluated: { label: "Not evaluated", tone: "idle" },
};

export default async function PullDecisionPage({ params }: PageProps<"/app/github/repositories/[repositoryId]/pulls/[pullNumber]">) {
  const { repositoryId, pullNumber: pullParam } = await params;
  if (!/^[1-9]\d*$/.test(pullParam)) notFound();
  const ctx = await requireCtx();
  const result = await getPullDecision(ctx, repositoryId, Number(pullParam));
  if (!result) notFound();
  const { repository, latest, history } = result;
  const githubURL = `https://github.com/${repository.fullName}/pull/${latest.pullNumber}`;
  const needsAttention = latest.outcome === "review_required" || latest.outcome === "error";
  const findings = gateFindings(latest.reasons);
  const samePolicy = latest.policyVersion === repository.policyVersion;
  const checks = samePolicy ? requiredCheckStates(repository.policy.requiredChecks, latest) : null;
  const commits = byHeadSha([latest, ...history]);
  const nextStep =
    latest.outcome === "merged"
      ? "Nothing to do: Alror merged this pull request."
      : latest.outcome === "closed"
        ? "This pull request is closed. Reopen it to request a new evaluation."
        : latest.outcome === "waiting"
          ? "Wait for the required checks to complete. Alror evaluates the latest commit again when GitHub reports results."
          : needsAttention
            ? "Review the flagged items below on GitHub, then push a fix or complete the review."
            : latest.mode === "observe"
              ? "A reviewer can merge when GitHub protections permit it. Observe mode reports results without requesting reviewers or merging."
              : latest.mode === "review"
                ? "Review the change on GitHub and merge when repository protections permit it."
                : "Alror merges eligible changes after a fresh check of CI, the policy and GitHub protections.";

  return (
    <div className="space-y-6">
      <Link href="/app/github" className="inline-flex items-center gap-2 text-[13px] text-con-fg3 hover:text-con-fg">
        <ArrowLeft size={14} />
        GitHub repositories
      </Link>
      <PageHeader
        title={latest.title || `Pull request #${latest.pullNumber}`}
        description={`${repository.fullName} / Pull request #${latest.pullNumber}`}
        meta={
          <Pill>
            <GitPullRequest size={12} />
            Pull request decision
          </Pill>
        }
        actions={
          <a href={githubURL} target="_blank" rel="noreferrer" className={buttonClass.secondary}>
            View on GitHub
            <ArrowUpRight size={14} />
          </a>
        }
      />

      <section aria-labelledby="gate-why" className={`con-fade-up rounded-lg border bg-con-panel px-5 py-4 ${needsAttention ? "border-con-warn/35" : "border-con-line"}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="gate-why" className="text-[12px] font-medium uppercase tracking-wide text-con-fg3">
            Why this outcome
          </h2>
          <div className="flex flex-wrap gap-2">
            <Pill tone={outcomeTone(latest.outcome)}>{outcomeLabel(latest.outcome)}</Pill>
            <Pill>{GATE_MODE[latest.mode] ?? latest.mode}</Pill>
          </div>
        </div>
        <p className="mt-1.5 text-[15px] font-medium leading-relaxed text-con-fg">{gateWhy(latest)}</p>
        <div className="mt-4 grid gap-5 border-t border-con-row pt-4 sm:grid-cols-3">
          <div>
            <p className="text-[12px] text-con-fg3">Rule-based risk</p>
            <p className="mt-1 font-mono text-3xl tracking-tight">
              {latest.score}
              <span className="text-base text-con-fg3"> / 100{latest.risk ? ` · ${latest.risk.level}` : ""}</span>
            </p>
          </div>
          <div>
            <p className="text-[12px] text-con-fg3">Evaluated commit</p>
            <a href={`https://github.com/${repository.fullName}/commit/${latest.headSha}`} target="_blank" rel="noreferrer" className="mt-2 inline-block font-mono text-[13px] hover:underline" title={latest.headSha}>
              {latest.headSha.slice(0, 12)}
            </a>
            <p className="mt-1 text-[12px] text-con-fg3">Policy version {latest.policyVersion}</p>
          </div>
          <div>
            <p className="text-[12px] text-con-fg3">Last evaluated</p>
            <time dateTime={latest.updatedAt.toISOString()} className="mt-2 block text-[13px]">
              {timestamp(latest.updatedAt)}
            </time>
            <DecisionRefresh />
          </div>
        </div>
        <div className="mt-4 border-t border-con-row pt-4">
          <h3 className="text-[13px] font-medium">Next step</h3>
          <p className="mt-1.5 text-[13px] leading-relaxed text-con-fg2">{nextStep}</p>
        </div>
      </section>

      {latest.risk ? (
        <Card
          title="Risk factors"
          description={`Scored with shared risk rules v${latest.risk.rules_version}, the same rules the Alror CLI uses.${latest.plan ? ` Rollout plan: ${latest.plan.strategy} ${latest.plan.steps.map((s) => `${s.weight}%`).join(" → ")}.` : ""}`}
        >
          {latest.risk.factors.length ? (
            <ul className="space-y-2 text-[13px]">
              {latest.risk.factors.map((factor, index) => (
                <li key={index} className="flex gap-3">
                  <span className="w-10 shrink-0 text-right font-mono text-con-fg3">
                    {factor.points > 0 ? "+" : ""}
                    {factor.points}
                  </span>
                  <span className="min-w-0 break-words">
                    <span className="font-medium">{factor.name}</span>
                    <span className="text-con-fg3"> · {factor.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-con-fg3">No risk factors found.</p>
          )}
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Every reason" description="Recorded for this commit and policy version, in the order the gate reported them.">
          {latest.reasons.length ? (
            <ul className="space-y-2.5">
              {latest.reasons.map((reason, index) => (
                <li key={index} className="flex items-start gap-2.5 text-[13px] leading-relaxed text-con-fg2">
                  <Dot tone={/^(Waiting|GitHub is still)/.test(reason) ? "info" : latest.outcome === "eligible" || latest.outcome === "merged" ? "good" : "warn"} className="mt-[7px]" />
                  <span className="min-w-0 break-words">{reason}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-con-fg3">No reasons were recorded.</p>
          )}
          <p className="mt-5 text-[12px] leading-relaxed text-con-fg3">The gate checks changed paths, change size, tests and configured CI. It does not judge code correctness or replace a code review.</p>
        </Card>

        <Card title="Protected and out-of-policy files" description="Files that sent this change to review, as the gate recorded them.">
          {findings.protectedFiles.length === 0 && findings.outsideFiles.length === 0 ? (
            <p className="text-[13px] text-con-fg3">No protected paths or files outside the automatic-merge allowlist were recorded for this commit.</p>
          ) : (
            <div className="space-y-4">
              {findings.protectedFiles.length > 0 && (
                <div>
                  <h3 className="text-[12px] font-medium text-con-fg2">Protected paths</h3>
                  <ul className="mt-1.5 space-y-1">
                    {findings.protectedFiles.map((f) => (
                      <li key={f} className="break-all font-mono text-[12.5px] text-con-fg">
                        {f}
                      </li>
                    ))}
                  </ul>
                  {findings.protectedTruncated && <p className="mt-1.5 text-[12px] text-con-fg3">The gate records the first five; see the full diff on GitHub.</p>}
                </div>
              )}
              {findings.outsideFiles.length > 0 && (
                <div>
                  <h3 className="text-[12px] font-medium text-con-fg2">Outside the automatic-merge allowlist</h3>
                  <ul className="mt-1.5 space-y-1">
                    {findings.outsideFiles.map((f) => (
                      <li key={f} className="break-all font-mono text-[12.5px] text-con-fg">
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          <p className="mt-5 break-words text-[12px] leading-relaxed text-con-fg3">
            Protected patterns: <span className="font-mono">{repository.policy.protectedPaths.join(", ") || "none"}</span>, plus the shared sensitive areas ({riskRules.sensitive_paths.map((a) => a.name).join(", ")}).
          </p>
        </Card>
      </div>

      <Card title="Required checks" description={checks ? "State recorded when this commit was evaluated." : `The policy changed since this evaluation (now version ${repository.policyVersion}); only the checks the gate reported are shown.`} flush>
        {checks ? (
          checks.length === 0 ? (
            <p className="px-5 py-4 text-[13px] text-con-fg3">No CI checks are required by this policy.</p>
          ) : (
            <ul className="divide-y divide-con-row">
              {checks.map((c) => (
                <li key={`${c.appId}:${c.name}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-[13px]">
                  <span className="min-w-0 break-words">
                    {c.name}
                    <span className="ml-2 text-[12px] text-con-fg3">GitHub App {c.appId}</span>
                  </span>
                  <Pill tone={CHECK[c.state].tone}>
                    {CHECK[c.state].label}
                    {c.detail ? ` (${c.detail})` : ""}
                  </Pill>
                </li>
              ))}
            </ul>
          )
        ) : findings.waitingChecks.length + findings.failedChecks.length === 0 ? (
          <p className="px-5 py-4 text-[13px] text-con-fg3">No pending or failed required checks were recorded.</p>
        ) : (
          <ul className="divide-y divide-con-row">
            {findings.failedChecks.map((c) => (
              <li key={`f-${c.name}`} className="flex items-center justify-between gap-2 px-5 py-3 text-[13px]">
                {c.name}
                <Pill tone="bad">Did not pass ({c.conclusion || "unknown"})</Pill>
              </li>
            ))}
            {findings.waitingChecks.map((name) => (
              <li key={`w-${name}`} className="flex items-center justify-between gap-2 px-5 py-3 text-[13px]">
                {name}
                <Pill tone="info">Pending</Pill>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Evaluation history" description="Every recorded evaluation, grouped by head commit, newest first. Re-evaluating the same commit, base and policy updates its record in place.">
        <ol className="space-y-5">
          {commits.map((g) => (
            <li key={g.sha}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <a href={`https://github.com/${repository.fullName}/commit/${g.sha}`} target="_blank" rel="noreferrer" className="font-mono text-[13px] text-con-fg hover:underline" title={g.sha}>
                  {g.sha.slice(0, 12)}
                </a>
                <span className="text-[12px] text-con-fg3">
                  {g.items.length} evaluation{g.items.length === 1 ? "" : "s"}
                  {g.sha === latest.headSha ? " · current head" : ""}
                </span>
              </div>
              <ul className="mt-2 divide-y divide-con-row rounded-md border border-con-row">
                {g.items.map((d) => (
                  <li key={d.id}>
                    <details className="group px-4 py-2.5">
                      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                        <Dot tone={outcomeTone(d.outcome)} />
                        <span className="font-medium">{outcomeLabel(d.outcome)}</span>
                        <span className="text-[12px] text-con-fg3">
                          {timestamp(d.updatedAt)} · risk {d.score}/100 · {GATE_MODE[d.mode] ?? d.mode} · policy v{d.policyVersion}
                        </span>
                      </summary>
                      <p className="mt-2 break-all font-mono text-[11px] text-con-fg3">Base {d.baseSha}</p>
                      <ul className="mt-2 list-disc space-y-1.5 pl-4 text-[13px] text-con-fg2">
                        {d.reasons.map((reason, index) => (
                          <li key={index}>{reason}</li>
                        ))}
                      </ul>
                    </details>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </Card>

      <Card title="Current repository policy" description={`Version ${repository.policyVersion}. Historical decisions keep the policy version and mode used when evaluated.`}>
        <dl className="grid gap-5 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-con-fg3">Mode</dt>
            <dd className="mt-1">{GATE_MODE[repository.policy.mode]}</dd>
          </div>
          <div>
            <dt className="text-con-fg3">Change limits</dt>
            <dd className="mt-1">
              {repository.policy.maxChangedFiles} files / {repository.policy.maxChangedLines} changed lines
            </dd>
          </div>
          <div>
            <dt className="text-con-fg3">Required CI checks</dt>
            <dd className="mt-1 break-words">{repository.policy.requiredChecks.map((check) => `${check.name} (App ${check.appId})`).join(", ") || "None configured"}</dd>
          </div>
          <div>
            <dt className="text-con-fg3">Allowed paths</dt>
            <dd className="mt-1 break-words font-mono text-[12px]">{repository.policy.allowedPaths.join(", ") || "No path allowlist"}</dd>
          </div>
          <div>
            <dt className="text-con-fg3">Configured reviewers</dt>
            <dd className="mt-1 break-words">{repository.policy.reviewers.join(", ") || "None configured"}</dd>
          </div>
          <div>
            <dt className="text-con-fg3">Code changes require tests</dt>
            <dd className="mt-1">{repository.policy.requireTests ? "Yes" : "No"}</dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
