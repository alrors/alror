"use client";

import { useActionState, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, GitPullRequest, GitFork, RefreshCw, ShieldCheck } from "lucide-react";
import { reevaluatePull } from "@/app/app/github/actions";
import { Card, EmptyState, FormStatus, Pill, buttonClass } from "@/components/console/primitives";
import { PolicyForm, modeLabel } from "./policy-form";
import type { DecisionView, RepositoryView } from "@/lib/server/github/types";
import { cn } from "@/lib/site";

function Reevaluate({ decision }: { decision: DecisionView }) {
  const [result, action, pending] = useActionState(reevaluatePull, undefined);
  return <form action={action} className="space-y-2"><input type="hidden" name="repositoryId" value={decision.repositoryId} /><input type="hidden" name="pullNumber" value={decision.pullNumber} /><button disabled={pending} className={buttonClass.secondary}><RefreshCw size={13} className={pending ? "animate-spin motion-reduce:animate-none" : ""} />{pending ? "Queuing…" : "Re-evaluate"}</button><FormStatus error={result?.error} message={result?.message} /></form>;
}

const outcomes: Record<string, string> = { eligible: "Eligible", review_required: "Review required", waiting: "Waiting for checks", closed: "Closed", merged: "Merged", observed: "Observed", error: "Evaluation error" };

export function GitHubWorkspace({ repositories, decisions, admin }: { repositories: RepositoryView[]; decisions: DecisionView[]; admin: boolean }) {
  const [tab, setTab] = useState<"repositories" | "decisions">("repositories");
  const tabs = useRef<HTMLDivElement>(null);
  return <div className="space-y-5">
    <div ref={tabs} role="tablist" aria-label="GitHub integration" className="flex gap-5 border-b border-con-line" onKeyDown={(event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? "repositories" : event.key === "End" ? "decisions" : tab === "repositories" ? "decisions" : "repositories";
      setTab(next); tabs.current?.querySelector<HTMLButtonElement>(`#github-tab-${next}`)?.focus();
    }}>
      {(["repositories", "decisions"] as const).map((value) => <button key={value} id={`github-tab-${value}`} role="tab" aria-selected={tab === value} aria-controls={`github-panel-${value}`} tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)} className={cn("flex items-center gap-2 border-b-2 px-1 pb-3 text-[13px] transition-colors", tab === value ? "border-con-fg text-con-fg" : "border-transparent text-con-fg3 hover:text-con-fg")}>
        {value === "repositories" ? <GitFork size={15} /> : <GitPullRequest size={15} />}{value === "repositories" ? "Repositories" : "Decisions"}<span className="rounded bg-con-row px-1.5 text-[11px] tabular-nums text-con-fg2">{value === "repositories" ? repositories.length : decisions.length}</span>
      </button>)}
    </div>
    <div id="github-panel-repositories" role="tabpanel" aria-labelledby="github-tab-repositories" hidden={tab !== "repositories"} className="space-y-4">
      {repositories.length === 0 ? <Card><EmptyState title="Connect your first repository"><GitFork size={28} className="mx-auto mb-4 text-con-fg3" /><p>Install Alror on GitHub, then have your operator link the installation to this workspace. New repositories start in Observe mode.</p></EmptyState></Card> : repositories.map((repository) => <Card key={repository.id}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0"><a href={`https://github.com/${repository.fullName}`} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-2 text-[15px] font-medium hover:underline"><GitFork size={17} className="shrink-0 text-con-fg3" /><span className="break-all">{repository.fullName}</span><ArrowUpRight size={14} className="shrink-0 text-con-fg3" /></a><p className="mt-2 text-[12px] text-con-fg3">{repository.policy.maxChangedFiles} files · {repository.policy.maxChangedLines} changed lines · {repository.policy.requiredChecks.length} required checks</p></div>
          <div className="flex flex-wrap gap-2"><Pill>{modeLabel[repository.policy.mode]}</Pill><Pill tone={repository.enabled ? "idle" : "warn"}>{repository.enabled ? "Connected" : "Disabled"}</Pill></div>
        </div>
        <details className="mt-5"><summary className="mb-4 cursor-pointer text-[13px] text-con-fg2 hover:text-con-fg">{admin ? "Configure merge policy" : "View merge policy"}</summary><PolicyForm repository={repository} admin={admin} /></details>
      </Card>)}
      <div className="flex items-start gap-3 px-1 text-[12px] leading-relaxed text-con-fg3"><ShieldCheck size={16} className="mt-0.5 shrink-0" /><p>Merge Gate is Alror’s first GitHub capability. Policies apply to human and agent pull requests, and GitHub’s branch protections remain authoritative.</p></div>
    </div>
    <div id="github-panel-decisions" role="tabpanel" aria-labelledby="github-tab-decisions" hidden={tab !== "decisions"} className="space-y-4">
      {decisions.length === 0 ? <Card><EmptyState title="Every decision, explained"><p>After a connected repository receives a pull request, its risk assessment, policy checks, and next steps appear here.</p></EmptyState></Card> : <><p className="text-[12px] text-con-fg3">Latest {decisions.length} pull request decisions. Policy changes are recorded in the workspace audit log.</p>{decisions.map((decision) => <Card key={decision.id}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><p className="mb-1 text-[12px] text-con-fg3">{decision.repository} · #{decision.pullNumber}</p><a href={decision.url.startsWith("https://github.com/") ? decision.url : `https://github.com/${decision.repository}/pull/${decision.pullNumber}`} target="_blank" rel="noreferrer" className="break-words text-[15px] font-medium hover:underline">{decision.title || `Pull request #${decision.pullNumber}`} <ArrowUpRight size={13} className="inline" /></a></div><Pill tone={decision.outcome === "review_required" || decision.outcome === "error" ? "warn" : "idle"}>{outcomes[decision.outcome] ?? decision.outcome.replaceAll("_", " ")}</Pill></div>
        <div className="my-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-con-fg3"><span>Risk <span className="font-mono text-con-fg2">{decision.score}/100</span></span><span>{modeLabel[decision.mode]}</span><code title={decision.headSha}>{decision.headSha.slice(0, 8)}</code><time dateTime={decision.updatedAt}>{new Date(decision.updatedAt).toISOString().replace("T", " ").slice(0, 16)} UTC</time></div>
        <ul className="mb-4 list-disc space-y-1.5 pl-4 text-[13px] leading-relaxed text-con-fg2">{decision.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul>
        <div className="flex flex-wrap items-start gap-3"><Link href={`/app/github/repositories/${encodeURIComponent(decision.repositoryId)}/pulls/${decision.pullNumber}`} className={buttonClass.secondary}>View decision<ArrowUpRight size={13} /></Link>{admin && <Reevaluate decision={decision} />}</div>
      </Card>)}</>}
    </div>
  </div>;
}
