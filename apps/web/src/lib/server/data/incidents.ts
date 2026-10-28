import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Deployment } from "@/lib/console/types";
import { decideAutoRollback, rankCandidates, SKEW_MINUTES, type CandidateInput, type MetricMovement, type RankedCandidate } from "@/lib/incidents/rank";
import type { AlertSource, NormalizedAlert } from "@/lib/incidents/normalize";
import { slackIncidentMessage } from "@/lib/incidents/slack";
import { ALL_SCOPES, requireScope, type OrgCtx } from "../context";
import { db } from "../db";
import { incidents, type IncidentAutoAction, type IncidentCandidates, type IncidentStatus } from "../db/schema";
import { conflict, invalid, notFound } from "../errors";
import { env } from "../env";
import { writeAudit } from "./audit";
import { eventsFor, listDeployments } from "./deployments";
import { enqueueJob, type Job } from "./jobs";
import { createNotification } from "./notifications";
import { getPolicy } from "./policy";
import { getAlertSettings } from "./alert-settings";

// Incidents: alerts from POST /api/v1/alerts/{source}, deduplicated by fingerprint,
// ranked against recent deployments ("what changed?"), posted to Slack and, when
// the org enabled it and every safety rule passes, rolled back automatically
// through the job queue (an alror runner executes the rollback).
//
// Exported API:
//   ingestAlerts(orgId, source, alerts) -> IngestResult[]   used by the intake route
//   listIncidents(ctx, {status, page, per}) / getIncident(ctx, id) / listOpenIncidents(ctx)
//   rollbackFromIncident(ctx, incidentId, deploymentId) -> Job   members and above (deploy:write)
//   resolveIncident(ctx, id)                                       members and above (deploy:write)

export type Incident = {
  id: string;
  source: string;
  fingerprint: string;
  title: string;
  service: string;
  environment: string;
  severity: string;
  status: IncidentStatus;
  started_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  event_count: number;
  candidates: IncidentCandidates;
  auto_action: IncidentAutoAction | null;
  rollback_job_id: string | null;
  created_at: string;
  updated_at: string;
};

export type IncidentDetail = Incident & { raw: unknown };

type Row = typeof incidents.$inferSelect;

function toIncident(r: Row): Incident {
  return {
    id: r.id,
    source: r.source,
    fingerprint: r.fingerprint,
    title: r.title,
    service: r.service,
    environment: r.environment,
    severity: r.severity,
    status: r.status,
    started_at: r.startedAt.toISOString(),
    last_seen_at: r.lastSeenAt.toISOString(),
    resolved_at: r.resolvedAt?.toISOString() ?? null,
    event_count: r.eventCount,
    candidates: r.candidates,
    auto_action: r.autoAction ?? null,
    rollback_job_id: r.rollbackJobId,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_RAW_BYTES = 64 * 1024;

const incidentUrl = (id: string) => `${env.publicUrl()}/app/incidents/${id}`;
const deploymentUrl = (id: string) => `${env.publicUrl()}/app/deployments/${id}`;

function systemCtx(orgId: string, source: string): OrgCtx {
  return { orgId, actor: { type: "system", id: null, label: `alerts (${source})`, scopes: ALL_SCOPES } };
}

function capRaw(raw: unknown): unknown {
  const s = JSON.stringify(raw ?? null);
  return s.length > MAX_RAW_BYTES ? { truncated: true, bytes: s.length, head: s.slice(0, 4096) } : raw;
}

// ---------------------------------------------------------------------------
// Ranking input
// ---------------------------------------------------------------------------

/** Metric results from a deployment's stored verdict events. */
function movements(events: { verdict?: { results: { metric: string; delta: number; pass: boolean }[] | null } }[]): MetricMovement[] {
  const out: MetricMovement[] = [];
  for (const e of events) for (const r of e.verdict?.results ?? []) out.push({ metric: r.metric, delta: Number(r.delta) || 0, pass: Boolean(r.pass) });
  return out;
}

function toCandidate(d: Deployment, verdicts: MetricMovement[]): CandidateInput {
  return {
    id: d.id,
    service: d.service,
    image: d.image,
    environment: d.environment ?? "",
    status: d.status,
    created_at: d.created_at,
    updated_at: d.updated_at,
    risk_score: d.risk?.score ?? 0,
    risk_level: d.risk?.level ?? "",
    related_services: d.risk?.services ?? [],
    verdicts,
  };
}

/** Ranks the org's deployments in the window before `startedAt` (plus any still rolling) against the alert. */
export async function rankForAlert(
  ctx: OrgCtx,
  alert: { service: string; environment: string; started_at: Date },
  windowMinutes: number,
): Promise<RankedCandidate[]> {
  const start = alert.started_at.getTime();
  const until = new Date(start + SKEW_MINUTES * 60_000 + 1);
  const [inWindow, live] = await Promise.all([
    listDeployments(ctx, { since: new Date(start - windowMinutes * 60_000), until }, { limit: 300 }),
    listDeployments(ctx, { status: ["rolling", "pending"], until }, { limit: 50 }),
  ]);
  const byId = new Map<string, Deployment>();
  for (const d of [...inWindow, ...live]) byId.set(d.id, d);
  const deps = [...byId.values()];
  const events = await eventsFor(ctx, deps.map((d) => d.id));
  return rankCandidates(alert, deps.map((d) => toCandidate(d, movements(events.get(d.id) ?? []))), { windowMinutes });
}

// ---------------------------------------------------------------------------
// Intake
// ---------------------------------------------------------------------------

export type IngestResult = {
  fingerprint: string;
  status: "firing" | "resolved";
  /** created: a new incident; deduplicated: folded into the open one; resolved: closed it; ignored: resolved with nothing open. */
  action: "created" | "deduplicated" | "resolved" | "ignored";
  incident_id: string | null;
};

async function openIncident(orgId: string, source: string, fingerprint: string): Promise<Row | undefined> {
  const [row] = await db
    .select()
    .from(incidents)
    .where(and(eq(incidents.orgId, orgId), eq(incidents.source, source), eq(incidents.fingerprint, fingerprint), eq(incidents.status, "open")))
    .limit(1);
  return row;
}

async function bump(id: string): Promise<void> {
  await db
    .update(incidents)
    .set({ eventCount: sql`${incidents.eventCount} + 1`, lastSeenAt: new Date(), updatedAt: new Date() })
    .where(eq(incidents.id, id));
}

/** Never throws: Slack being slow or down must not fail the intake. */
async function postToSlack(ctx: OrgCtx, message: { text: string; blocks: unknown[] }): Promise<boolean> {
  try {
    const policy = await getPolicy(ctx);
    if (!policy.slack_webhook) return false;
    const res = await fetch(policy.slack_webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.error(`[alror] Slack incident post failed: HTTP ${res.status}`);
    return res.ok;
  } catch (e) {
    console.error("[alror] Slack incident post failed:", (e as Error).message);
    return false;
  }
}

async function createIncident(ctx: OrgCtx, a: NormalizedAlert): Promise<IngestResult> {
  const settings = await getAlertSettings(ctx);
  const ranked = await rankForAlert(ctx, a, settings.window_minutes);
  const decision = decideAutoRollback(
    { enabled: settings.auto_rollback, threshold: settings.threshold, max_age_minutes: settings.max_age_minutes },
    ranked,
    a.status === "firing",
  );
  const now = new Date();
  const candidates: IncidentCandidates = { window_minutes: settings.window_minutes, ranked_at: now.toISOString(), items: ranked };
  const autoAction: IncidentAutoAction = { rollback: decision.rollback, deployment_id: decision.deployment_id, checks: decision.checks, decided_at: now.toISOString() };

  const [row] = await db
    .insert(incidents)
    .values({
      orgId: ctx.orgId,
      source: a.source,
      fingerprint: a.fingerprint,
      title: a.title,
      service: a.service,
      environment: a.environment,
      severity: a.severity,
      startedAt: a.started_at,
      lastSeenAt: now,
      raw: capRaw(a.raw),
      candidates,
      autoAction,
    })
    .onConflictDoNothing({ target: [incidents.orgId, incidents.source, incidents.fingerprint], where: sql`status = 'open'` })
    .returning();
  if (!row) {
    // Another delivery of the same alert won the race.
    const open = await openIncident(ctx.orgId, a.source, a.fingerprint);
    if (open) await bump(open.id);
    return { fingerprint: a.fingerprint, status: "firing", action: "deduplicated", incident_id: open?.id ?? null };
  }

  const top = ranked[0];
  await writeAudit(ctx, "incident.open", row.id, {
    title: a.title,
    service: a.service,
    environment: a.environment,
    severity: a.severity,
    top_candidate: top ? { deployment_id: top.deployment_id, score: top.score } : null,
  });

  // Automatic rollback: off by default; every rule in decideAutoRollback must pass.
  if (decision.rollback && decision.deployment_id && top) {
    let jobId: string | null = null;
    let error: string | undefined;
    try {
      const job = await enqueueJob(ctx, {
        kind: "rollback",
        payload: { deployment_id: decision.deployment_id, reason: `automatic rollback for incident "${a.title}" (score ${top.score}/100)` },
      });
      jobId = job.id;
    } catch (e) {
      error = (e as Error).message;
    }
    await writeAudit(ctx, "incident.auto_rollback", decision.deployment_id, {
      incident_id: row.id,
      job_id: jobId,
      ...(error ? { error } : {}),
      score: top.score,
      signals: top.signals,
      checks: decision.checks,
      runner_up: ranked[1] ? { deployment_id: ranked[1].deployment_id, score: ranked[1].score } : null,
    });
    autoAction.job_id = jobId;
    if (error) autoAction.error = error;
    await db
      .update(incidents)
      .set({ autoAction, rollbackJobId: jobId, updatedAt: new Date() })
      .where(eq(incidents.id, row.id));
  }

  const auto = autoAction.rollback && autoAction.job_id;
  await createNotification(ctx.orgId, {
    kind: "incident.opened",
    title: `${a.severity === "critical" ? "Critical alert" : "Alert"}: ${a.title}`.slice(0, 200),
    body: auto
      ? `Alror rolled back ${top?.deployment_id} automatically (score ${top?.score}/100).`
      : top
        ? `Most likely change: ${top.service} ${top.image} (${top.score}/100).`
        : "No deployments in the look-back window.",
    href: `/app/incidents/${row.id}`,
  });

  await postToSlack(
    ctx,
    slackIncidentMessage(
      { id: row.id, title: a.title, service: a.service, environment: a.environment, severity: a.severity, source: a.source },
      ranked,
      { incident: incidentUrl(row.id), deployment: deploymentUrl },
      { ...decision, job_id: autoAction.job_id },
    ),
  );

  return { fingerprint: a.fingerprint, status: "firing", action: "created", incident_id: row.id };
}

/** Applies normalised alerts for one org: dedupe firing alerts by fingerprint, resolve on resolved events. */
export async function ingestAlerts(orgId: string, source: AlertSource, alerts: NormalizedAlert[]): Promise<IngestResult[]> {
  const ctx = systemCtx(orgId, source);
  const out: IngestResult[] = [];
  for (const a of alerts) {
    const open = await openIncident(orgId, a.source, a.fingerprint);
    if (a.status === "resolved") {
      if (!open) {
        out.push({ fingerprint: a.fingerprint, status: "resolved", action: "ignored", incident_id: null });
        continue;
      }
      const now = new Date();
      await db.update(incidents).set({ status: "resolved", resolvedAt: now, lastSeenAt: now, updatedAt: now }).where(eq(incidents.id, open.id));
      await writeAudit(ctx, "incident.resolve", open.id, { source, title: open.title });
      out.push({ fingerprint: a.fingerprint, status: "resolved", action: "resolved", incident_id: open.id });
      continue;
    }
    if (open) {
      await bump(open.id);
      out.push({ fingerprint: a.fingerprint, status: "firing", action: "deduplicated", incident_id: open.id });
      continue;
    }
    out.push(await createIncident(ctx, a));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getIncident(ctx: OrgCtx, id: string): Promise<IncidentDetail | null> {
  if (!UUID_RE.test(id)) return null;
  const [row] = await db
    .select()
    .from(incidents)
    .where(and(eq(incidents.orgId, ctx.orgId), eq(incidents.id, id)))
    .limit(1);
  return row ? { ...toIncident(row), raw: row.raw } : null;
}

/** One page of incidents, newest first, plus counts per status. */
export async function listIncidents(
  ctx: OrgCtx,
  opts: { status?: IncidentStatus; page?: number; per?: number } = {},
): Promise<{ items: Incident[]; total: number; counts: Record<IncidentStatus | "all", number> }> {
  const per = Math.min(Math.max(opts.per ?? 25, 1), 200);
  const page = Math.max(opts.page ?? 1, 1);
  const where = and(eq(incidents.orgId, ctx.orgId), opts.status ? eq(incidents.status, opts.status) : undefined);
  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(incidents)
      .where(where)
      .orderBy(desc(incidents.startedAt), desc(incidents.id))
      .limit(per)
      .offset((page - 1) * per),
    db.select({ status: incidents.status, n: sql<number>`count(*)::int` }).from(incidents).where(eq(incidents.orgId, ctx.orgId)).groupBy(incidents.status),
  ]);
  const counts = { all: 0, open: 0, resolved: 0 };
  for (const r of countRows) {
    counts[r.status] = r.n;
    counts.all += r.n;
  }
  return { items: rows.map(toIncident), total: opts.status ? counts[opts.status] : counts.all, counts };
}

/** Open incidents, newest first (for the console's "Needs you" home and inbox). */
export async function listOpenIncidents(ctx: OrgCtx, limit = 20): Promise<Incident[]> {
  const rows = await db
    .select()
    .from(incidents)
    .where(and(eq(incidents.orgId, ctx.orgId), eq(incidents.status, "open")))
    .orderBy(desc(incidents.startedAt), desc(incidents.id))
    .limit(Math.min(Math.max(limit, 1), 200));
  return rows.map(toIncident);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Queues a rollback of one of the incident's ranked candidates (the runner
 * executes it). Members and above (deploy:write). Audited with the evidence.
 */
export async function rollbackFromIncident(ctx: OrgCtx, incidentId: string, deploymentId: string): Promise<Job> {
  requireScope(ctx, "deploy:write");
  const inc = await getIncident(ctx, incidentId);
  if (!inc) throw notFound(`Incident ${incidentId} not found.`);
  const cand = inc.candidates.items.find((c) => c.deployment_id === deploymentId);
  if (!cand) throw invalid(`Deployment ${deploymentId} is not a candidate for this incident.`);
  const job = await enqueueJob(ctx, {
    kind: "rollback",
    payload: { deployment_id: deploymentId, reason: `rolled back from incident "${inc.title}" (score ${cand.score}/100)` },
  });
  await writeAudit(ctx, "incident.rollback", deploymentId, { incident_id: inc.id, job_id: job.id, score: cand.score, signals: cand.signals });
  await db.update(incidents).set({ rollbackJobId: job.id, updatedAt: new Date() }).where(and(eq(incidents.orgId, ctx.orgId), eq(incidents.id, inc.id)));
  return job;
}

/** Marks an open incident resolved by hand. Members and above (deploy:write). */
export async function resolveIncident(ctx: OrgCtx, id: string): Promise<Incident> {
  requireScope(ctx, "deploy:write");
  if (!UUID_RE.test(id)) throw notFound(`Incident ${id} not found.`);
  const now = new Date();
  const [row] = await db
    .update(incidents)
    .set({ status: "resolved", resolvedAt: now, updatedAt: now })
    .where(and(eq(incidents.orgId, ctx.orgId), eq(incidents.id, id), eq(incidents.status, "open")))
    .returning();
  if (!row) {
    const existing = await getIncident(ctx, id);
    if (!existing) throw notFound(`Incident ${id} not found.`);
    throw conflict("This incident is already resolved.");
  }
  await writeAudit(ctx, "incident.resolve", id, { manual: true, title: row.title });
  return toIncident(row);
}
