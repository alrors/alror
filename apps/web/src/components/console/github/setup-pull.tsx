"use client";

import { useId, useState, useTransition } from "react";
import { ArrowUpRight, GitPullRequest, Plus, ScanSearch } from "lucide-react";
import { detectRepositoryServices, openRepositorySetupPull } from "@/app/app/github/onboarding-actions";
import { FormStatus, Pill, buttonClass, inputClass, selectClass } from "@/components/console/primitives";
import type { Confidence, Inferred, Proposal, ServiceEdit, SetupPullResult } from "@/lib/server/onboarding/types";
import { TARGETS } from "@/lib/server/onboarding/types";
import { cn } from "@/lib/site";

const confidenceTone = { high: "good", medium: "info", low: "idle", unknown: "warn" } as const;
const confidenceLabel: Record<Confidence, string> = { high: "High", medium: "Medium", low: "Low", unknown: "Unknown — set this" };

type Row = ServiceEdit & { pathsText: string };

function Why({ value }: { value: Inferred<unknown> }) {
  return <p className="mt-1 flex flex-wrap items-start gap-2 text-[12px] leading-relaxed text-con-fg3"><Pill tone={confidenceTone[value.confidence]} className="shrink-0">{confidenceLabel[value.confidence]}</Pill><span className="min-w-0 flex-1 break-words">{value.reason}</span></p>;
}

const rowsFrom = (proposal: Proposal): Row[] => proposal.services.map((s) => ({
  id: s.id, include: true, name: s.name.value, paths: s.paths.value, pathsText: s.paths.value.map((p) => p || "/").join("\n"), target: s.target.value,
  critical: s.critical.value, namespace: s.namespace.value ?? "", cluster: s.cluster.value ?? "",
}));

/** Detect services → review and edit → open the alror/setup pull request. Owners and admins only. */
export function SetupPull({ repositoryId, fullName }: { repositoryId: string; fullName: string }) {
  const id = useId();
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string>();
  const [pull, setPull] = useState<SetupPullResult>();
  const [detecting, startDetect] = useTransition();
  const [opening, startOpen] = useTransition();
  const update = (index: number, patch: Partial<Row>) => setRows((current) => current.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const detect = () => startDetect(async () => {
    setError(undefined); setPull(undefined);
    const result = await detectRepositoryServices(repositoryId);
    if (result.error || !result.proposal) { setError(result.error ?? "Detection failed."); return; }
    setProposal(result.proposal); setRows(rowsFrom(result.proposal));
  });
  const open = () => startOpen(async () => {
    setError(undefined);
    const edits: ServiceEdit[] = rows.map((r) => ({ id: r.id, include: r.include, name: r.name.trim(), paths: r.pathsText.split(/\r?\n/).map((p) => p.trim()).filter(Boolean).map((p) => (p === "/" ? "" : p)), target: r.target, critical: r.critical, namespace: r.namespace.trim(), cluster: r.cluster.trim() }));
    const result = await openRepositorySetupPull(repositoryId, edits);
    if (result.error || !result.pull) { setError(result.error ?? "Could not open the pull request."); return; }
    setPull(result.pull);
  });

  const detected = new Map(proposal?.services.map((s) => [s.id, s]) ?? []);
  return <div className="space-y-4 border-t border-con-line pt-5">
    <p className="text-[13px] leading-relaxed text-con-fg2">Alror reads {fullName} through the GitHub App, proposes services from Dockerfiles, compose files, Kubernetes and Helm manifests, workspaces and CODEOWNERS, then opens a pull request on the <code className="font-mono text-[12px]">alror/setup</code> branch with <code className="font-mono text-[12px]">alror.yaml</code> and an <code className="font-mono text-[12px]">ALROR.md</code> explaining every value. It never pushes to your default branch.</p>
    <button type="button" onClick={detect} disabled={detecting || opening} className={buttonClass.secondary}><ScanSearch size={14} />{detecting ? "Reading repository…" : proposal ? "Detect again" : "Detect services"}</button>

    {proposal && <div className="space-y-4">
      {proposal.existingConfig && <p className="rounded-md border border-con-warn-edge bg-con-warn-soft px-3 py-2 text-[12px] text-con-fg2">This repository already has an alror.yaml. The pull request proposes a replacement for you to compare.</p>}
      <p className="text-[12px] text-con-fg3">Project <code className="font-mono text-con-fg2">{proposal.project.value}</code> · {rows.filter((r) => r.include).length} of {rows.length} services selected · metrics start as synthetic (shadow mode, no automatic rollback).</p>
      {rows.map((row, index) => {
        const d = detected.get(row.id);
        const kube = row.target !== "simulated";
        return <fieldset key={row.id} disabled={opening} className={cn("min-w-0 space-y-3 rounded-md border border-con-line p-4", !row.include && "opacity-60")}>
          <legend className="sr-only">Service {row.name}</legend>
          <label className="flex items-center gap-2 text-[13px] font-medium"><input type="checkbox" checked={row.include} onChange={(e) => update(index, { include: e.target.checked })} className="accent-white" />Include in alror.yaml</label>
          {d && d.evidence.length > 0 && <p className="break-words text-[12px] text-con-fg3">Evidence: {d.evidence.join(", ")}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="min-w-0"><label htmlFor={`${id}-${index}-name`} className="block text-[13px] text-con-fg2">Name</label><input id={`${id}-${index}-name`} value={row.name} onChange={(e) => update(index, { name: e.target.value })} className={cn(inputClass, "mt-1.5 font-mono")} spellCheck={false} />{d ? <Why value={d.name} /> : <p className="mt-1 text-[12px] text-con-fg3">Added in the console.</p>}</div>
            <div className="min-w-0"><label htmlFor={`${id}-${index}-target`} className="block text-[13px] text-con-fg2">Target</label><select id={`${id}-${index}-target`} value={row.target} onChange={(e) => update(index, { target: e.target.value as Row["target"] })} className={cn(selectClass, "mt-1.5 w-full")}>{TARGETS.map((t) => <option key={t} value={t}>{t === "kubernetes" ? "kubernetes (Argo Rollouts)" : t}</option>)}</select>{d && <Why value={d.target} />}</div>
            <div className="min-w-0 sm:col-span-2"><label htmlFor={`${id}-${index}-paths`} className="block text-[13px] text-con-fg2">Paths (one prefix per line, / for the whole repository)</label><textarea id={`${id}-${index}-paths`} rows={Math.max(2, row.pathsText.split("\n").length)} value={row.pathsText} onChange={(e) => update(index, { pathsText: e.target.value })} spellCheck={false} className={cn(inputClass, "mt-1.5 h-auto resize-y py-2 font-mono text-[12px]")} />{d && <Why value={d.paths} />}</div>
            {kube && <div className="min-w-0"><label htmlFor={`${id}-${index}-cluster`} className="block text-[13px] text-con-fg2">{row.target === "ecs" ? "ECS cluster" : "Cluster (kubectl context)"}</label><input id={`${id}-${index}-cluster`} value={row.cluster} placeholder="unknown — set this" onChange={(e) => update(index, { cluster: e.target.value })} className={cn(inputClass, "mt-1.5 font-mono")} spellCheck={false} />{d && d.target.value === row.target && <Why value={d.cluster} />}</div>}
            {row.target === "kubernetes" && <div className="min-w-0"><label htmlFor={`${id}-${index}-ns`} className="block text-[13px] text-con-fg2">Namespace</label><input id={`${id}-${index}-ns`} value={row.namespace} placeholder="unknown — set this" onChange={(e) => update(index, { namespace: e.target.value })} className={cn(inputClass, "mt-1.5 font-mono")} spellCheck={false} />{d && d.target.value === row.target && <Why value={d.namespace} />}</div>}
            <div className="min-w-0 sm:col-span-2"><label className="flex items-center gap-2 text-[13px] text-con-fg2"><input type="checkbox" checked={row.critical} onChange={(e) => update(index, { critical: e.target.checked })} className="accent-white" />Critical (raises risk whenever touched)</label>{d && <Why value={d.critical} />}</div>
            {d && <div className="min-w-0 sm:col-span-2"><p className="text-[13px] text-con-fg2">Owners <span className="text-con-fg3">(informational)</span>: <span className="font-mono text-[12px]">{d.owners.value.join(" ") || "none"}</span></p><Why value={d.owners} /></div>}
          </div>
        </fieldset>;
      })}
      <button type="button" disabled={opening} onClick={() => setRows((r) => [...r, { id: `new:${Date.now()}`, include: true, name: "", paths: [], pathsText: "", target: "simulated", critical: false, namespace: "", cluster: "" }])} className={buttonClass.secondary}><Plus size={14} />Add service</button>
      {proposal.notes.length > 0 && <details className="text-[12px] text-con-fg3"><summary className="cursor-pointer hover:text-con-fg">Not proposed ({proposal.notes.length})</summary><ul className="mt-2 list-disc space-y-1 pl-4">{proposal.notes.map((n, i) => <li key={i} className="break-words">{n}</li>)}</ul></details>}
      <div><p className="text-[13px] text-con-fg2">Metrics: <code className="font-mono text-[12px]">synthetic</code></p><Why value={proposal.metrics} /></div>
      <button type="button" onClick={open} disabled={opening || detecting || !rows.some((r) => r.include)} className={buttonClass.primary}><GitPullRequest size={14} />{opening ? "Opening pull request…" : "Open setup PR"}</button>
    </div>}
    {pull && <p className="text-[13px] text-con-fg2">{pull.created ? "Opened" : pull.changed ? "Updated" : "Already up to date:"} <a href={pull.url.startsWith("https://github.com/") ? pull.url : `https://github.com/${fullName}/pull/${pull.number}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-con-fg hover:underline">pull request #{pull.number}<ArrowUpRight size={13} /></a></p>}
    <FormStatus error={error} />
  </div>;
}
