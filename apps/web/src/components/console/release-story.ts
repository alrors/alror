// Pure helpers that turn a deployment, its events and the org policy into plain
// English for the release pages. Safe on server and client.

import { DEFAULT_PLANS, type PlanStep, type Plans } from "@/lib/console/policy-rules";
import { duration, metricLabel, metricUnitValue, span } from "@/lib/console/format";
import type { RolloutTree } from "@/lib/console/rollout-tree";
import type { DeployEvent, Deployment, Level, MetricResult } from "@/lib/console/types";

/** Mirrors alror/internal/risk/scorer.go LevelFor. */
export function levelFor(score: number): Level {
  return score >= 70 ? "high" : score >= 35 ? "medium" : "low";
}

export const LEVEL_BANDS: { level: Level; from: number; to: number; meaning: string }[] = [
  { level: "low", from: 0, to: 34, meaning: "Big first step, short bake: the change is small and well understood." },
  { level: "medium", from: 35, to: 69, meaning: "A small canary first, then wider stages, each verified before moving on." },
  { level: "high", from: 70, to: 100, meaning: "Starts at a sliver of traffic with the longest bakes, so a regression reaches as few users as possible." },
];

export function planFor(level: Level, plans: Plans = DEFAULT_PLANS): PlanStep[] {
  return plans[level] ?? DEFAULT_PLANS[level];
}

/** Total bake of a plan in minutes after bake_scale. */
export function planBakeMinutes(steps: PlanStep[], bakeScale = 1): number {
  return steps.reduce((t, s) => t + s.bakeMin, 0) * bakeScale;
}

export function minutesLabel(min: number): string {
  if (min <= 0) return "no bake";
  return duration(Math.round(min * 60e9));
}

/** Why a risk factor matters, in one sentence. Unknown factors fall back to their detail. */
export function factorWhy(name: string): string | null {
  switch (name) {
    case "Large diff":
    case "Medium diff":
    case "Small diff":
      return "More changed lines means more places a bug can hide.";
    case "Many files":
      return "Changes spread across many files are harder to review as a whole.";
    case "Blast radius":
      return "One release touching several services can break more than one thing at once.";
    case "Critical service":
      return "This service is marked critical, so a failure here costs more.";
    case "Sensitive paths":
      return "Paths like auth, payments or migrations break in costly, hard-to-undo ways.";
    case "No tests changed":
      return "Code changed without matching test changes, so less of it is covered.";
    case "Well tested":
      return "Tests changed alongside the code, which lowers the risk.";
    case "AI-authored":
      return "A coding agent wrote part of this change, so it gets a little extra caution.";
    case "Recent rollbacks":
      return "These services were rolled back recently, which suggests they are fragile right now.";
    case "Docs only":
      return "Only documentation changed, so runtime behaviour is unlikely to move.";
    case "Default score":
      return "The scorer had no git context, so it assumed a medium-risk change.";
    default:
      return null;
  }
}

/** p-value in words for someone who has not taken a statistics course. */
export function pValueWords(p: number, alpha = 0.05): string {
  if (!Number.isFinite(p)) return "No significance test was recorded.";
  if (p < alpha) {
    const odds = p < 0.001 ? "less than 1 in 1,000" : `about ${Math.max(1, Math.round(p * 100))} in 100`;
    return `A difference this large would show up by chance ${odds} times, below the ${alpha} cut-off, so it is treated as real.`;
  }
  return `A difference like this shows up by chance fairly often (p ${p.toFixed(2)} is above the ${alpha} cut-off), so it is treated as noise.`;
}

/** One-line comparison: "Error rate was 79% higher on the canary than on the baseline." */
export function changeWords(r: MetricResult): string {
  const pctv = Math.abs(r.delta * 100);
  const label = metricLabel(r.metric);
  if (pctv < 0.5) return `${label} was about the same on the canary and the baseline.`;
  const dir = r.delta > 0 ? "higher" : "lower";
  return `${label} was ${pctv.toFixed(pctv < 10 ? 1 : 0)}% ${dir} on the canary (${metricUnitValue(r.metric, r.canary)}) than on the baseline (${metricUnitValue(r.metric, r.baseline)}).`;
}

export function limitWords(r: MetricResult, limit: number | undefined): string {
  if (limit === undefined) return "No regression limit is set for this metric, so it is reported but never blocks.";
  const lim = Math.round(limit * 100);
  const used = r.delta > 0 ? Math.round((r.delta / limit) * 100) : 0;
  if (r.pass && r.delta > limit) return `The limit is +${lim}%. The change went past it, but the test could not tell it apart from noise, so it did not count as a regression.`;
  if (r.pass) return `The limit is +${lim}%. This change used ${used}% of that allowance.`;
  return `The limit is +${lim}%. This change went ${Math.round((r.delta - limit) * 100)} points past it.`;
}

/** The failing verdict result that stopped a rollout, if any. */
export function failingResult(events: DeployEvent[]): { e: DeployEvent; r: MetricResult } | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind === "verdict" && e.verdict && !e.verdict.pass) {
      const r = e.verdict.results?.find((x) => !x.pass);
      if (r) return { e, r };
    }
  }
  return null;
}

/** Plain-English headline for the deployment page. */
export function headline(d: Deployment, events: DeployEvent[], tree: RolloutTree, limits: Record<string, number>, now: number): string {
  const stages = tree.stages;
  const passed = stages.filter((s) => s.state === "pass").length;
  const took = span((d.status === "rolling" || d.status === "pending" ? now : Date.parse(d.updated_at)) - Date.parse(d.created_at));
  switch (d.status) {
    case "promoted":
      return `Promoted to 100% of traffic after ${passed} of ${stages.length} stages passed verification, ${took} after it started.`;
    case "rolling": {
      const active = stages.find((s) => s.state === "active");
      const idx = active ? active.index + 1 : d.step_index + 1;
      const left = active?.remainingMs !== undefined ? (active.remainingMs > 0 ? ` Next verdict in about ${span(active.remainingMs)}.` : " Waiting for the verdict.") : "";
      return `Rolling out: the canary serves ${tree.liveWeight}% of traffic at stage ${idx} of ${stages.length}.${left}`;
    }
    case "rolled_back": {
      const f = failingResult(events);
      if (f && tree.outcome !== "manual_rollback") {
        const lim = limits[f.r.metric];
        const dir = f.r.delta >= 0 ? "rose" : "fell";
        return `Rolled back at ${f.e.weight ?? d.weight}% because ${metricLabel(f.r.metric).toLowerCase()} ${dir} ${Math.abs(Math.round(f.r.delta * 100))}% vs baseline${lim !== undefined ? ` (limit ${Math.round(lim * 100)}%)` : ""}. Traffic went back to the stable version.`;
      }
      const rb = [...events].reverse().find((e) => e.kind === "rolled_back");
      return `Rolled back manually${rb?.weight ? ` at ${rb.weight}%` : ""}${d.reason ? `: ${d.reason}` : ""}. Traffic went back to the stable version.`;
    }
    case "failed": {
      const err = [...events].reverse().find((e) => e.kind === "error");
      return `Failed${err?.weight ? ` at ${err.weight}%` : ""}: ${err?.message ?? d.reason ?? "the rollout stopped with an error"}. Traffic went back to the stable version.`;
    }
    default:
      return "Waiting to start: the rollout has not shifted any traffic yet.";
  }
}

/** Duration of a stage, from its traffic shift to its verdict. */
export function stageDurationMs(startedAt?: string, endedAt?: string, now?: number): number | null {
  if (!startedAt) return null;
  const end = endedAt ? Date.parse(endedAt) : now;
  if (end === undefined) return null;
  return Math.max(0, end - Date.parse(startedAt));
}
