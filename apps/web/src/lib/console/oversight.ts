// Oversight home and explanation pages: what needs a person, what Alror did on
// its own, and why. Pure functions over stored data, no I/O: safe on server and client.

import { DAY, median, restoreMs } from "./analytics";
import { metricLabel, metricUnitValue, span, weekdayLabel } from "./format";
import { jobPhase, jobTarget, type JobLike } from "./jobs";
import { SEVERITY_RANK, type Severity } from "./overview";
import type { DeployEvent, Deployment, MetricResult } from "./types";
import { decisionPath } from "../server/github/report";
import type { DecisionView } from "../server/github/types";

export const HOUR = 3_600_000;
/** A gate that has been waiting on checks this long probably needs someone to look. */
export const WAITING_TOO_LONG_MS = 30 * 60_000;
/** A queued job nobody has picked up for this long (no runner online?). */
export const QUEUED_TOO_LONG_MS = 10 * 60_000;
/** A passing metric that used this share of its regression allowance is borderline. */
export const BORDERLINE_SHARE = 0.75;
/** Release problems older than this stop asking for attention. */
export const INBOX_HORIZON_MS = 7 * DAY;

/* ------------------------------------ Gate ------------------------------------ */

export const GATE_OUTCOME: Record<string, string> = {
  eligible: "Policy checks passed",
  review_required: "Review required",
  waiting: "Waiting for checks",
  closed: "Closed",
  merged: "Merged",
  observed: "Observed",
  error: "Evaluation error",
};

export const GATE_MODE: Record<string, string> = { observe: "Observe", review: "Require review", auto_merge: "Auto-merge" };

export const pullKey = (d: { repositoryId: string; pullNumber: number }) => `${d.repositoryId}#${d.pullNumber}`;

/** Explanation page for a pull request decision (the same link the GitHub check and comment use). */
export function pullHref(repositoryId: string, pullNumber: number): string {
  return decisionPath(repositoryId, pullNumber);
}

/** The pull request on GitHub, only ever a github.com URL. */
export function githubPullUrl(d: { url: string; repository: string; pullNumber: number }): string {
  return d.url.startsWith("https://github.com/") ? d.url : `https://github.com/${d.repository}/pull/${d.pullNumber}`;
}

/** The newest decision per pull request, plus since when its current outcome has held. Input is newest first. */
export function latestPerPull(decisions: DecisionView[]): { latest: DecisionView; since: string }[] {
  const by = new Map<string, DecisionView[]>();
  for (const d of decisions) {
    const k = pullKey(d);
    by.set(k, [...(by.get(k) ?? []), d]);
  }
  return [...by.values()].map((rows) => {
    const latest = rows[0];
    let since = latest.updatedAt;
    for (const r of rows) {
      if (r.outcome !== latest.outcome) break;
      since = r.updatedAt;
    }
    return { latest, since };
  });
}

export type GateFindings = {
  /** Files the gate listed as protected (the gate records at most five). */
  protectedFiles: string[];
  protectedTruncated: boolean;
  /** Files outside the automatic-merge allowlist (at most five recorded). */
  outsideFiles: string[];
  /** Required checks still pending, by name. */
  waitingChecks: string[];
  /** Required checks that completed without success: name and conclusion. */
  failedChecks: { name: string; conclusion: string }[];
  /** Everything else, verbatim. */
  other: string[];
};

const listOf = (s: string) =>
  s
    .replace(/\.$/, "")
    .split(", ")
    .map((x) => x.trim())
    .filter((x) => x && x !== "…");

/** Structure the stored reasons of a gate decision (see evaluatePolicy in server/github/policy.ts). */
export function gateFindings(reasons: string[]): GateFindings {
  const out: GateFindings = { protectedFiles: [], protectedTruncated: false, outsideFiles: [], waitingChecks: [], failedChecks: [], other: [] };
  for (const r of reasons) {
    let m: RegExpMatchArray | null;
    if ((m = r.match(/^Protected changes need review: (.*)$/))) {
      out.protectedFiles.push(...listOf(m[1]));
      out.protectedTruncated ||= m[1].includes("…");
    } else if ((m = r.match(/^Changes outside the automatic-merge allowlist: (.*)$/))) {
      out.outsideFiles.push(...listOf(m[1]));
    } else if ((m = r.match(/^Waiting for (.+) from GitHub App \d+\.$/))) {
      out.waitingChecks.push(m[1]);
    } else if ((m = r.match(/^Required check (.+) did not pass \((.*)\)\.$/))) {
      out.failedChecks.push({ name: m[1], conclusion: m[2] });
    } else out.other.push(r);
  }
  return out;
}

export type CheckState = "passed" | "pending" | "failed" | "not_evaluated";

/** State of each required check as recorded with a decision. A required check the gate did not mention had passed. */
export function requiredCheckStates(
  required: { name: string; appId: number }[],
  decision: { outcome: string; reasons: string[] },
): { name: string; appId: number; state: CheckState; detail?: string }[] {
  const f = gateFindings(decision.reasons);
  const evaluated = decision.outcome !== "closed" && decision.outcome !== "error";
  return required.map((c) => {
    const failed = f.failedChecks.find((x) => x.name === c.name);
    if (failed) return { ...c, state: "failed", detail: failed.conclusion || "unknown" };
    if (f.waitingChecks.includes(c.name)) return { ...c, state: "pending" };
    if (decision.outcome === "merged") return { ...c, state: "passed" };
    return { ...c, state: evaluated ? "passed" : "not_evaluated" };
  });
}

/** Decisions grouped by evaluated head commit, newest commit first. Input is newest first. */
export function byHeadSha<T extends { headSha: string }>(decisions: T[]): { sha: string; items: T[] }[] {
  const groups: { sha: string; items: T[] }[] = [];
  for (const d of decisions) {
    const g = groups.find((x) => x.sha === d.headSha);
    if (g) g.items.push(d);
    else groups.push({ sha: d.headSha, items: [d] });
  }
  return groups;
}

/** One sentence: why the gate decided what it decided. */
export function gateWhy(d: { outcome: string; mode: string; reasons: string[] }): string {
  const f = gateFindings(d.reasons);
  const n = d.reasons.length;
  switch (d.outcome) {
    case "merged":
      return d.reasons[0] ?? "Alror merged this pull request after the configured checks and GitHub protections passed.";
    case "eligible":
      return d.mode === "auto_merge"
        ? "Every rule passed for this commit; Alror merges it once GitHub protections allow."
        : d.mode === "review"
          ? "Every rule passed for this commit. This repository merges by hand, so a person merges it."
          : "Every rule passed for this commit. Observe mode only reports; nothing is merged automatically.";
    case "review_required": {
      const why = f.protectedFiles.length
        ? `it touches protected paths (${f.protectedFiles.slice(0, 2).join(", ")}${f.protectedFiles.length > 2 || f.protectedTruncated ? ", …" : ""})`
        : f.failedChecks.length
          ? `required check ${f.failedChecks[0].name} did not pass`
          : (d.reasons[0] ?? "a rule was not met").replace(/\.$/, "").replace(/^./, (c) => c.toLowerCase());
      return `${d.mode === "observe" ? "Flagged for review (observe mode, nothing was blocked)" : "Routed to human review"} because ${why}${n > 1 ? `, plus ${n - 1} more finding${n > 2 ? "s" : ""}` : ""}.`;
    }
    case "waiting":
      return f.waitingChecks.length
        ? `Waiting for ${f.waitingChecks.join(", ")} before deciding.`
        : (d.reasons[0] ?? "Waiting for GitHub before deciding.");
    case "closed":
      return d.reasons[0] ?? "The pull request is closed.";
    default:
      return d.reasons[0] ?? "No reason was recorded.";
  }
}

/* ------------------------------------ Inbox ------------------------------------ */

export type InboxKind =
  | "pull_review"
  | "pull_waiting"
  | "pull_error"
  | "failing"
  | "rollback_unconfirmed"
  | "rollback_job_failed"
  | "insufficient_data"
  | "recommendation"
  | "borderline"
  | "stalled"
  | "queued";

export type InboxLink = { label: string; href: string; external?: boolean };

export type InboxItem = {
  /** Stable per occurrence: a dismissed item comes back when something new happens. */
  key: string;
  severity: Severity;
  kind: InboxKind;
  /** One line: why this needs a person. */
  reason: string;
  /** What it is about: "payments-api v1.4.2", "acme/web #42". */
  subject: string;
  /** Owner: service (and environment) or repository. */
  owner: string;
  /** Since when it has needed attention. */
  at: string;
  primary: InboxLink;
  secondary?: InboxLink;
  /** Offer a rollback through the job queue. */
  rollback?: { id: string; service: string };
};

export function sortInbox(items: InboxItem[]): InboxItem[] {
  return [...items].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || Date.parse(a.at) - Date.parse(b.at) || a.key.localeCompare(b.key));
}

/** Pull requests the gate sent to a person, waiting too long, or failed to evaluate. */
export function pullInbox(decisions: DecisionView[], now: number): InboxItem[] {
  const out: InboxItem[] = [];
  for (const { latest: d, since } of latestPerPull(decisions)) {
    const subject = `#${d.pullNumber}${d.title ? ` ${d.title.length > 80 ? `${d.title.slice(0, 79)}…` : d.title}` : ""}`;
    const base = {
      subject,
      owner: d.repository,
      at: since,
      primary: { label: "Review on GitHub", href: githubPullUrl(d), external: true },
      secondary: { label: "Why", href: pullHref(d.repositoryId, d.pullNumber) },
    };
    const key = `pr-${pullKey(d)}-${d.headSha}-${d.outcome}`;
    if (d.outcome === "review_required") {
      out.push({ ...base, key, kind: "pull_review", severity: d.mode === "observe" ? "medium" : "high", reason: gateWhy(d) });
    } else if (d.outcome === "waiting" && now - Date.parse(since) > WAITING_TOO_LONG_MS) {
      out.push({ ...base, key, kind: "pull_waiting", severity: "medium", reason: `Gate waiting for ${span(now - Date.parse(since))}: ${gateWhy(d).replace(/^./, (c) => c.toLowerCase())}` });
    } else if (d.outcome === "error") {
      out.push({ ...base, key, kind: "pull_error", severity: "high", reason: d.reasons[0] ? `Evaluation failed: ${d.reasons[0]}` : "The gate could not evaluate this pull request." });
    }
  }
  return out;
}

const insufficient = (r: MetricResult) => /^insufficient data/i.test(r.reason ?? "");

/** Latest result per metric across a release's verdicts. */
function latestResults(events: DeployEvent[]): { r: MetricResult; e: DeployEvent }[] {
  const by = new Map<string, { r: MetricResult; e: DeployEvent }>();
  for (const e of events) if (e.kind === "verdict" && e.verdict) for (const r of e.verdict.results ?? []) by.set(r.metric, { r, e });
  return [...by.values()];
}

/** Passing results that used most of their regression allowance. */
export function borderlineResults(events: DeployEvent[], limits: Record<string, number>): { r: MetricResult; e: DeployEvent; limit: number }[] {
  const out: { r: MetricResult; e: DeployEvent; limit: number }[] = [];
  for (const { r, e } of latestResults(events)) {
    const limit = limits[r.metric];
    if (!r.pass || insufficient(r) || limit === undefined || limit <= 0) continue;
    if (r.delta >= limit * BORDERLINE_SHARE) out.push({ r, e, limit });
  }
  return out;
}

/** Verdict events without a verdict: shadow mode logged a recommendation and kept going. */
const recommendations = (events: DeployEvent[]) => events.filter((e) => e.kind === "verdict" && !e.verdict);

const pctOf = (x: number) => `${Math.round(x * 100)}%`;
const releaseName = (d: Deployment) => `${d.service}${d.ref ? ` ${d.ref}` : ""}`;
const ownerOf = (d: Deployment) => `${d.service} · ${d.environment ?? "production"}`;

/** True when a person asked for this rollback (CLI, console or API), not the verifier. */
export function isManualRollback(events: DeployEvent[]): boolean {
  return events.some((e) => e.kind === "rolled_back" && /^Manual rollback/i.test(e.message));
}

/**
 * Releases that need a person: failing verdicts on live rollouts, rollouts that stopped
 * with unconfirmed traffic, verdicts made on too little data, shadow-mode rollback
 * recommendations, and passing results close to their limit. Only the newest release of
 * each service and environment counts: a newer release supersedes the problem.
 */
export function releaseInbox(deps: Deployment[], events: Map<string, DeployEvent[]>, limits: Record<string, number>, now: number): InboxItem[] {
  const out: InboxItem[] = [];
  const seen = new Set<string>();
  const sorted = [...deps].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  for (const d of sorted) {
    const lane = `${d.service}@${d.environment ?? "production"}`;
    if (seen.has(lane)) continue;
    seen.add(lane);
    const live = d.status === "rolling" || d.status === "pending";
    if (!live && now - Date.parse(d.updated_at) > INBOX_HORIZON_MS) continue;
    const ev = events.get(d.id) ?? [];
    const view = { label: "Open release", href: `/app/deployments/${d.id}` };
    const base = { subject: releaseName(d), owner: ownerOf(d), primary: view };
    const latest = latestResults(ev);

    if (d.status === "failed") {
      const err = [...ev].reverse().find((e) => e.kind === "error");
      out.push({ ...base, key: `failed-${d.id}`, kind: "rollback_unconfirmed", severity: "critical", at: d.updated_at, reason: `Rollout stopped${err?.weight ? ` at ${err.weight}%` : ""} and traffic restoration is unconfirmed: ${err?.message ?? d.reason ?? "unknown error"}` });
      continue;
    }
    if (live) {
      const failing = latest.filter((x) => !x.r.pass);
      if (failing.length) {
        out.push({
          ...base,
          key: `failing-${d.id}-${d.step_index}`,
          kind: "failing",
          severity: "critical",
          at: failing[0].e.at,
          reason: `Failing verification at ${d.weight}%: ${failing.map((x) => `${metricLabel(x.r.metric).toLowerCase()} ${x.r.reason ?? "regressed"}`).join("; ")}`,
          rollback: { id: d.id, service: d.service },
        });
        continue;
      }
    }
    const thin = latest.filter((x) => insufficient(x.r));
    if (thin.length) {
      const what = d.status === "rolled_back" ? "Rolled back on too little data, not a measured regression" : d.status === "promoted" ? "Promoted, but verification had too little data" : "Verifying with too little data";
      out.push({ ...base, key: `thin-${d.id}-${thin.length}`, kind: "insufficient_data", severity: "high", at: thin[0].e.at, reason: `${what}: ${thin.map((x) => `${metricLabel(x.r.metric).toLowerCase()} had ${x.r.reason}`).join("; ")}`, rollback: d.status === "rolled_back" ? undefined : { id: d.id, service: d.service } });
      continue;
    }
    const recs = recommendations(ev);
    if (recs.length && d.status !== "rolled_back") {
      const last = recs[recs.length - 1];
      out.push({ ...base, key: `rec-${d.id}-${recs.length}`, kind: "recommendation", severity: "high", at: last.at, reason: `Shadow mode recommended a rollback and kept going: ${last.message}`, rollback: { id: d.id, service: d.service } });
      continue;
    }
    if (d.status === "promoted" || live) {
      const close = borderlineResults(ev, limits);
      if (close.length) {
        const x = close[0];
        out.push({
          ...base,
          key: `borderline-${d.id}`,
          kind: "borderline",
          severity: "medium",
          at: x.e.at,
          reason: `Passed close to the limit: ${metricLabel(x.r.metric).toLowerCase()} +${pctOf(x.r.delta)} vs baseline (limit ${pctOf(x.limit)})${close.length > 1 ? `, and ${close.length - 1} more` : ""}`,
          rollback: { id: d.id, service: d.service },
        });
      }
    }
  }
  return out;
}

export type InboxJob = JobLike & { id: string; kind: string; error: string | null; finished_at: string | null; deployment_id: string | null; created_at: string; heartbeat_at: string | null; claimed_at: string | null; claimed_by: string | null };

/** Stalled and long-queued runner jobs, and rollback jobs that failed for a release still out. */
export function jobInbox(open: InboxJob[], failed: InboxJob[], deps: Deployment[], now: number): InboxItem[] {
  const out: InboxItem[] = [];
  for (const j of open) {
    const phase = jobPhase(j, now);
    const what = j.kind === "deploy" ? "Deploy" : "Rollback";
    const primary = { label: "Open job", href: `/app/jobs?status=${j.status}` };
    if (phase === "stalled") {
      out.push({ key: `stalled-${j.id}-${j.heartbeat_at ?? ""}`, kind: "stalled", severity: j.kind === "rollback" ? "critical" : "high", subject: `${what} job`, owner: jobTarget(j), at: j.heartbeat_at ?? j.claimed_at ?? j.created_at, reason: `${what} job stalled: runner ${j.claimed_by ?? "unknown"} stopped sending heartbeats`, primary });
    } else if (phase === "queued" && now - Date.parse(j.created_at) > QUEUED_TOO_LONG_MS) {
      out.push({ key: `queued-${j.id}`, kind: "queued", severity: j.kind === "rollback" ? "high" : "medium", subject: `${what} job`, owner: jobTarget(j), at: j.created_at, reason: `${what} waiting ${span(now - Date.parse(j.created_at))} for a runner. Is alror runner online?`, primary });
    }
  }
  const byId = new Map(deps.map((d) => [d.id, d]));
  for (const j of failed) {
    if (j.kind !== "rollback" || !j.finished_at || now - Date.parse(j.finished_at) > INBOX_HORIZON_MS) continue;
    const d = j.deployment_id ? byId.get(j.deployment_id) : undefined;
    if (d && d.status === "rolled_back") continue;
    out.push({
      key: `rbfail-${j.id}`,
      kind: "rollback_job_failed",
      severity: "critical",
      subject: d ? releaseName(d) : "Rollback job",
      owner: d ? ownerOf(d) : jobTarget(j),
      at: j.finished_at,
      reason: `Rollback job failed${j.error ? `: ${j.error}` : ""}. The release may still be serving traffic.`,
      primary: d ? { label: "Open release", href: `/app/deployments/${d.id}` } : { label: "Open job", href: "/app/jobs?status=failed" },
      rollback: d ? { id: d.id, service: d.service } : undefined,
    });
  }
  return out;
}

/* ------------------------------- What Alror did ------------------------------- */

export type DidKind = "auto_merge" | "review_routed" | "promoted" | "auto_rollback" | "stopped" | "gate_policy" | "rollout_policy";

export type DidItem = {
  key: string;
  at: string;
  kind: DidKind;
  title: string;
  /** One line: why Alror did it. */
  reason: string;
  /** Its explanation page. */
  href?: string;
};

/** Releases whose outcome Alror decided on its own: promotions, automatic rollbacks, stopped rollouts. */
export function isAutomaticOutcome(d: Deployment, manual: boolean): boolean {
  return d.status === "promoted" || d.status === "failed" || (d.status === "rolled_back" && !manual);
}

/** Why a release ended as it did, in one line, from its events. */
export function releaseDid(d: Deployment, events: DeployEvent[]): DidItem {
  const href = `/app/deployments/${d.id}`;
  const name = releaseName(d);
  const verdicts = events.filter((e) => e.kind === "verdict" && e.verdict);
  if (d.status === "promoted") {
    const passed = verdicts.filter((e) => e.verdict?.pass).length;
    const recs = recommendations(events).length;
    const reason = verdicts.length
      ? `${passed} of ${verdicts.length} verification ${verdicts.length === 1 ? "check" : "checks"} passed against the baseline${recs ? `; ${recs} shadow-mode warning${recs > 1 ? "s" : ""} logged` : ""}`
      : recs
        ? `${recs} shadow-mode warning${recs > 1 ? "s" : ""} logged; no passing verdict recorded`
        : "No verification verdicts were recorded for this release";
    return { key: `dep-${d.id}`, at: d.updated_at, kind: "promoted", title: `Promoted ${name} to all traffic`, reason, href };
  }
  if (d.status === "rolled_back") {
    const fail = [...verdicts].reverse().find((e) => !e.verdict?.pass);
    const r = fail?.verdict?.results?.find((x) => !x.pass);
    const reason = r
      ? insufficient(r)
        ? `Verification had too little data at ${fail?.weight ?? d.weight}%: ${metricLabel(r.metric).toLowerCase()} had ${r.reason}`
        : `${metricLabel(r.metric)} ${r.delta >= 0 ? "rose" : "fell"} ${pctOf(Math.abs(r.delta))} vs baseline at ${fail?.weight ?? d.weight}% traffic${r.reason ? ` (${r.reason.replace(/^up \d+% vs baseline /, "").replace(/^\(|\)$/g, "")})` : ""}`
      : d.reason || "Verification failed";
    return { key: `dep-${d.id}`, at: d.updated_at, kind: "auto_rollback", title: `Rolled back ${name} automatically`, reason, href };
  }
  const err = [...events].reverse().find((e) => e.kind === "error");
  return { key: `dep-${d.id}`, at: d.updated_at, kind: "stopped", title: `Stopped the rollout of ${name}`, reason: `${err?.message ?? d.reason ?? "The rollout hit an error"}. Rollback attempted; restoration unconfirmed.`, href };
}

export type AuditLite = { id: number; action: string; target: string; actor_label: string; meta: Record<string, unknown>; at: string };

/** GitHub and policy audit rows Alror's oversight feed shows. */
export const DID_AUDIT_ACTIONS = ["github.pull_merged", "github.review_requested", "github.policy_updated", "policy.update"] as const;

/** One audit row as a feed item. `repos` maps a repository full name to its id; `decisions` gives the latest reason per pull. */
export function auditDid(a: AuditLite, repos: Map<string, string>, decisions: Map<string, DecisionView>): DidItem | null {
  const [repo, num] = a.target.split("#");
  const repoId = repos.get(repo);
  const pull = Number(num);
  const href = repoId && Number.isSafeInteger(pull) && pull > 0 ? pullHref(repoId, pull) : undefined;
  const base = { key: `audit-${a.id}`, at: a.at, href };
  switch (a.action) {
    case "github.pull_merged": {
      const sha = typeof a.meta.head_sha === "string" ? a.meta.head_sha.slice(0, 12) : "";
      const title = repoId ? decisions.get(`${repoId}#${pull}`)?.title : undefined;
      return { ...base, kind: "auto_merge", title: `Auto-merged ${a.target}${title ? `: ${title}` : ""}`, reason: `Evaluated commit ${sha || "head"} passed the merge policy, required CI and GitHub protections` };
    }
    case "github.review_requested": {
      const reviewers = Array.isArray(a.meta.reviewers) ? (a.meta.reviewers as unknown[]).filter((x): x is string => typeof x === "string") : [];
      const d = repoId ? decisions.get(`${repoId}#${pull}`) : undefined;
      const why = d ? gateWhy(d).replace(/^Routed to human review because /, "").replace(/\.$/, "") : "";
      return { ...base, kind: "review_routed", title: `Routed ${a.target} to review${reviewers.length ? ` (${reviewers.join(", ")})` : ""}`, reason: why ? `Because ${why}` : "The merge gate found changes a person must review" };
    }
    case "github.policy_updated": {
      const version = typeof a.meta.version === "number" ? ` v${a.meta.version}` : "";
      const mode = (a.meta.policy as { mode?: string } | undefined)?.mode;
      return { key: base.key, at: a.at, href: "/app/github", kind: "gate_policy", title: `Merge policy for ${a.target} updated${version}`, reason: `${mode ? `Mode ${GATE_MODE[mode] ?? mode} · ` : ""}changed by ${a.actor_label || "an admin"}; open pull requests re-evaluated` };
    }
    case "policy.update": {
      const fields = Array.isArray(a.meta.fields) ? (a.meta.fields as unknown[]).filter((x): x is string => typeof x === "string").map((f) => f.replace(/_/g, " ")) : [];
      return { key: base.key, at: a.at, href: "/app/policies", kind: "rollout_policy", title: "Rollout policy updated", reason: `${fields.length ? `${fields.join(", ")} · ` : ""}changed by ${a.actor_label || "an admin"}` };
    }
    default:
      return null;
  }
}

/** "Today", "Yesterday", else "Tue 14 Oct" (UTC days). */
export function dayHeading(at: string, now: number): string {
  const day = (t: number) => Math.floor(t / DAY);
  const diff = day(now) - day(Date.parse(at));
  return diff <= 0 ? "Today" : diff === 1 ? "Yesterday" : weekdayLabel(at);
}

export function groupByDay<T extends { at: string }>(items: T[], now: number): { day: string; items: T[] }[] {
  const out: { day: string; items: T[] }[] = [];
  for (const it of items) {
    const day = dayHeading(it.at, now);
    const last = out[out.length - 1];
    if (last && last.day === day) last.items.push(it);
    else out.push({ day, items: [it] });
  }
  return out;
}

/* ------------------------------------ Impact ------------------------------------ */

export type Impact = {
  /** Window start and end (ms). */
  start: number;
  end: number;
  /** Releases that finished in the window. */
  finished: number;
  /** Rolled back automatically by verification. */
  stopped: number;
  /** All rollbacks and failed rollouts in the window. */
  rollbacks: number;
  /** Median time from release start to rollback for rollbacks in the window. */
  restoreMs: number | null;
  /** Pull requests evaluated by the gate in the window; null when GitHub is not connected. */
  prsEvaluated: number | null;
  prsAutoMerged: number | null;
  prsRouted: number | null;
};

/** Weekly impact from stored outcomes. `manual` holds ids of rollbacks a person asked for. */
export function impact(
  deps: Deployment[],
  manual: Set<string>,
  window: { start: number; end: number },
  github: { evaluated: number; merged: number; routed: number } | null,
): Impact {
  const inWin = deps.filter((d) => {
    const t = Date.parse(d.updated_at);
    return t >= window.start && t < window.end && (d.status === "promoted" || d.status === "rolled_back" || d.status === "failed");
  });
  const bad = inWin.filter((d) => d.status === "rolled_back" || d.status === "failed");
  return {
    ...window,
    finished: inWin.length,
    stopped: inWin.filter((d) => d.status === "rolled_back" && !manual.has(d.id)).length,
    rollbacks: bad.length,
    restoreMs: median(bad.filter((d) => d.status === "rolled_back").map(restoreMs).filter((x): x is number => x !== null)),
    prsEvaluated: github ? github.evaluated : null,
    prsAutoMerged: github ? github.merged : null,
    prsRouted: github ? github.routed : null,
  };
}

/* ------------------------------ Release explanation ------------------------------ */

export type WhyPoint = { tone: "good" | "warn" | "bad" | "info" | "idle"; text: string };
export type ReleaseWhy = { tone: WhyPoint["tone"]; title: string; points: WhyPoint[] };

function resultLine(r: MetricResult, limit: number | undefined): string {
  const dir = r.delta >= 0 ? "+" : "−";
  const delta = `${dir}${Math.abs(r.delta * 100).toFixed(Math.abs(r.delta) < 0.1 ? 1 : 0)}%`;
  const vs = `${metricUnitValue(r.metric, r.canary)} vs ${metricUnitValue(r.metric, r.baseline)} baseline`;
  return `${metricLabel(r.metric)} ${delta} (${vs}${limit !== undefined ? `, limit +${Math.round(limit * 100)}%` : ""}${Number.isFinite(r.p_value) && r.p_value < 1 ? `, p=${r.p_value.toFixed(3)}` : ""})`;
}

/**
 * Why a release ended where it did, derived only from its stored events and verdicts:
 * the deciding verdict, every stage's result, data gaps and near misses.
 */
export function explainRelease(d: Deployment, events: DeployEvent[], limits: Record<string, number>): ReleaseWhy {
  const verdicts = events.filter((e) => e.kind === "verdict" && e.verdict);
  const recs = recommendations(events);
  const manual = isManualRollback(events);
  const points: WhyPoint[] = [];
  const stagePoints = verdicts.map((e): WhyPoint => {
    const results = e.verdict?.results ?? [];
    const worst = [...results].sort((a, b) => Number(a.pass) - Number(b.pass) || b.delta - a.delta)[0];
    const where = `${e.weight ?? "?"}% stage`;
    if (!worst) return { tone: e.verdict?.pass ? "good" : "bad", text: `${where}: ${e.verdict?.summary || (e.verdict?.pass ? "passed" : "failed")}` };
    if (insufficient(worst)) return { tone: "warn", text: `${where}: ${metricLabel(worst.metric)} had ${worst.reason}` };
    return { tone: e.verdict?.pass ? "good" : "bad", text: `${where} ${e.verdict?.pass ? "passed" : "failed"}: ${resultLine(worst, limits[worst.metric])}` };
  });
  for (const e of recs) points.push({ tone: "warn", text: `Shadow mode at ${e.weight ?? "?"}%: ${e.message}` });

  let title: string;
  let tone: WhyPoint["tone"];
  switch (d.status) {
    case "promoted": {
      const passed = verdicts.filter((e) => e.verdict?.pass).length;
      tone = recs.length || verdicts.length === 0 ? "warn" : "good";
      title = verdicts.length
        ? `Promoted automatically: ${passed} of ${verdicts.length} verification ${verdicts.length === 1 ? "check" : "checks"} passed against the baseline${recs.length ? `, with ${recs.length} shadow-mode warning${recs.length > 1 ? "s" : ""}` : ""}.`
        : "Promoted without any recorded verification verdict.";
      break;
    }
    case "rolled_back": {
      tone = "bad";
      if (manual) {
        const rb = [...events].reverse().find((e) => e.kind === "rolled_back");
        title = `Rolled back by a person${rb?.message ? `: ${rb.message.replace(/^Manual rollback · ?/i, "")}` : d.reason ? `: ${d.reason}` : ""}.`;
      } else {
        const fail = [...verdicts].reverse().find((e) => !e.verdict?.pass);
        const r = fail?.verdict?.results?.find((x) => !x.pass);
        title = r
          ? insufficient(r)
            ? `Rolled back automatically at ${fail?.weight ?? d.weight}% because verification had too little data (${metricLabel(r.metric).toLowerCase()}), not because of a measured regression.`
            : `Rolled back automatically at ${fail?.weight ?? d.weight}% because ${metricLabel(r.metric).toLowerCase()} ${r.delta >= 0 ? "rose" : "fell"} ${pctOf(Math.abs(r.delta))} vs baseline${limits[r.metric] !== undefined ? `, past its +${pctOf(limits[r.metric])} limit` : ""}.`
          : `Rolled back${d.reason ? `: ${d.reason}` : ""}.`;
      }
      const restoredIn = Math.max(0, Date.parse(d.updated_at) - Date.parse(d.created_at));
      points.push({ tone: "info", text: `Traffic returned to the stable version ${span(restoredIn)} after the release started.` });
      break;
    }
    case "failed": {
      tone = "bad";
      const err = [...events].reverse().find((e) => e.kind === "error");
      title = `Rollout stopped${err?.weight ? ` at ${err.weight}%` : ""} with an error; traffic restoration is unconfirmed.`;
      points.push({ tone: "bad", text: err?.message ?? d.reason ?? "No error message was recorded." });
      points.push({ tone: "warn", text: "Confirm the stable version serves all traffic, or queue a rollback from Actions." });
      break;
    }
    case "rolling":
      tone = "info";
      title = `In progress at ${d.weight}%: ${verdicts.filter((e) => e.verdict?.pass).length} of ${verdicts.length} verification ${verdicts.length === 1 ? "check" : "checks"} passed so far.`;
      break;
    default:
      tone = "idle";
      title = "Waiting to start; no traffic has shifted yet.";
  }
  for (const x of borderlineResults(events, limits)) {
    if (d.status === "rolled_back" || d.status === "failed") break;
    points.push({ tone: "warn", text: `Close to the limit: ${resultLine(x.r, x.limit)} used ${Math.round((x.r.delta / x.limit) * 100)}% of the allowance.` });
  }
  return { tone, title, points: [...stagePoints, ...points] };
}

/** Hours label for a window: "last 7 days" when it ends now, else the dates. */
export function windowLabel(start: number, end: number, now: number, fmt: (t: number) => string): string {
  const days = Math.round((end - start) / DAY);
  return Math.abs(now - end) < HOUR ? `last ${days} days` : `${days} days to ${fmt(end)}`;
}
