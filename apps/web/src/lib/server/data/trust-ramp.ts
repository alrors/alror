import "server-only";
import { and, eq, gte, inArray, isNull, ne } from "drizzle-orm";
import {
  classifyRecommendation,
  DAY_MS,
  effectiveMode,
  evaluateRamp,
  rampEvidence,
  rampProgress,
  type RampEvaluation,
  type RampSignal,
  type Recommendation,
  type RollbackMode,
  type ShadowFeedback,
  type TrustRampSettings,
} from "@/lib/console/trust-ramp";
import type { Deployment } from "@/lib/console/types";
import { requireAdmin, systemActor, type OrgCtx } from "../context";
import { db } from "../db";
import { deploymentEvents, deployments, environments, incidents, services, shadowFeedback } from "../db/schema";
import { invalid, notFound } from "../errors";
import { writeAudit } from "./audit";
import { eventsFor, toDeployment } from "./deployments";
import { createNotification } from "./notifications";
import { getPolicy } from "./policy";
import { listServices } from "./services";

// Trust ramp storage and side effects. The rule itself is pure and lives in
// lib/console/trust-ramp.ts; this module loads what it needs (shadow recommendations
// reported by the CLI and runner, later releases, alerts, human feedback), applies
// graduation and demotion, and audits both with the evidence.

/** How far back shadow recommendations are read. Older ones no longer move the ramp. */
const HORIZON_DAYS = 365;

export type TrustRamp = {
  settings: TrustRampSettings;
  orgAutoRollback: boolean;
  services: RampEvaluation[];
  recommendations: Recommendation[];
};

async function feedbackMap(ctx: OrgCtx, ids?: string[]): Promise<Map<string, ShadowFeedback>> {
  const rows = await db
    .select({ id: shadowFeedback.deploymentId, verdict: shadowFeedback.verdict })
    .from(shadowFeedback)
    .where(and(eq(shadowFeedback.orgId, ctx.orgId), ids ? inArray(shadowFeedback.deploymentId, ids.length ? ids : [""]) : undefined));
  return new Map(rows.map((r) => [r.id, r.verdict]));
}

/** Incidents opened from alert webhooks (#19) for a service since `since`: the "after an alert" evidence. */
async function signalsSince(ctx: OrgCtx, since: Date): Promise<RampSignal[]> {
  const rows = await db
    .select({ service: incidents.service, environment: incidents.environment, title: incidents.title, at: incidents.startedAt })
    .from(incidents)
    .where(and(eq(incidents.orgId, ctx.orgId), gte(incidents.startedAt, since), ne(incidents.service, "")))
    .limit(5000);
  return rows.map((r) => ({ service: r.service, environment: r.environment || null, at: r.at.toISOString(), label: `incident "${r.title}"` }));
}

/** Every shadow recommendation in the horizon, classified. */
async function loadRecommendations(ctx: OrgCtx, settings: TrustRampSettings, now: number): Promise<Recommendation[]> {
  const horizon = new Date(now - HORIZON_DAYS * DAY_MS);
  // Verdict events without a verdict are shadow mode's "would roll back here".
  const ids = await db
    .selectDistinct({ id: deploymentEvents.deploymentId })
    .from(deploymentEvents)
    .innerJoin(deployments, eq(deployments.id, deploymentEvents.deploymentId))
    .where(and(eq(deployments.orgId, ctx.orgId), gte(deployments.createdAt, horizon), eq(deploymentEvents.kind, "verdict"), isNull(deploymentEvents.verdict)))
    .limit(5000);
  if (!ids.length) return [];
  const recIds = ids.map((r) => r.id);
  const rows = await db
    .select({ d: deployments, env: environments.name })
    .from(deployments)
    .leftJoin(environments, eq(environments.id, deployments.environmentId))
    .where(and(eq(deployments.orgId, ctx.orgId), inArray(deployments.id, recIds)));
  const recDeps = rows.map((r) => toDeployment(r.d, r.env));
  const firstAt = new Date(Math.min(...recDeps.map((d) => Date.parse(d.created_at))));
  const svcNames = [...new Set(recDeps.map((d) => d.service))];
  const [events, laterRows, feedback, signals] = await Promise.all([
    eventsFor(ctx, recIds),
    db
      .select({ d: deployments, env: environments.name })
      .from(deployments)
      .leftJoin(environments, eq(environments.id, deployments.environmentId))
      .where(and(eq(deployments.orgId, ctx.orgId), inArray(deployments.service, svcNames), gte(deployments.createdAt, firstAt)))
      .orderBy(deployments.createdAt)
      .limit(10_000),
    feedbackMap(ctx, recIds),
    signalsSince(ctx, firstAt),
  ]);
  const later = new Map<string, Deployment[]>();
  for (const r of laterRows) {
    const d = toDeployment(r.d, r.env);
    later.set(d.service, [...(later.get(d.service) ?? []), d]);
  }
  return recDeps.flatMap((d) => {
    const rec = classifyRecommendation(d, events.get(d.id) ?? [], {
      later: later.get(d.service) ?? [],
      signals,
      feedback: feedback.get(d.id) ?? null,
      settings,
      now,
    });
    return rec ? [rec] : [];
  });
}

/** The ramp for every active service: mode, progress and why it is or isn't eligible. */
export async function loadTrustRamp(ctx: OrgCtx, now = Date.now()): Promise<TrustRamp> {
  const [policy, svcs] = await Promise.all([getPolicy(ctx), listServices(ctx)]);
  const settings = policy.trust_ramp;
  const recommendations = await loadRecommendations(ctx, settings, now);
  return {
    settings,
    orgAutoRollback: policy.auto_rollback,
    recommendations,
    services: svcs.map((s) => evaluateRamp({ name: s.name, override: s.rollback_mode, resetAt: s.ramp_reset_at }, recommendations, policy.auto_rollback, settings, now)),
  };
}

/** The shadow recommendation of one release with its outcome, or null when it has none. */
export async function recommendationFor(ctx: OrgCtx, deploymentId: string, now = Date.now()): Promise<{ rec: Recommendation; settings: TrustRampSettings } | null> {
  const policy = await getPolicy(ctx);
  const recs = await loadRecommendations(ctx, policy.trust_ramp, now);
  const rec = recs.find((r) => r.id === deploymentId);
  return rec ? { rec, settings: policy.trust_ramp } : null;
}

/**
 * Switches a service's rollback mode (the Policies switch, or auto-graduation).
 * Moving to automatic is a graduation, back to shadow a demotion that restarts the
 * ramp. Both are audited with the ramp's evidence at that moment.
 *
 * `mode: null` makes the service follow the org default again. `undo` restores the
 * state just before a console switch (the Undo on its toast): the override is put
 * back as it was and the ramp is not restarted, since no evidence was lost.
 */
export async function setRollbackMode(
  ctx: OrgCtx,
  name: string,
  mode: RollbackMode | null,
  opts: { automatic?: boolean; undo?: boolean; ramp?: TrustRamp; now?: number } = {},
): Promise<RampEvaluation> {
  if (!opts.automatic) requireAdmin(ctx);
  const now = opts.now ?? Date.now();
  const ramp = opts.ramp ?? (await loadTrustRamp(ctx, now));
  const before = ramp.services.find((s) => s.service === name);
  if (!before) throw notFound(`Service ${name} not found.`);
  const target = effectiveMode(mode, ramp.orgAutoRollback);
  const [row] = await db
    .update(services)
    .set({ rollbackMode: mode, ...(target === "shadow" && before.mode === "auto" && !opts.undo ? { rampResetAt: new Date(now) } : {}) })
    .where(and(eq(services.orgId, ctx.orgId), eq(services.name, name), isNull(services.archivedAt)))
    .returning({ id: services.id });
  if (!row) throw notFound(`Service ${name} not found.`);

  const action = target === "auto" ? "trust_ramp.graduate" : "trust_ramp.demote";
  await writeAudit(ctx, action, name, {
    source: opts.automatic ? "auto_graduate" : opts.undo ? "console_undo" : "console",
    from: before.mode,
    to: target,
    ...(mode === null ? { follows_org_default: true } : {}),
    eligible: before.eligible,
    progress: rampProgress(before),
    ...rampEvidence(before, ramp.settings),
  });
  if (opts.automatic || (target === "auto" && !opts.undo)) {
    await createNotification(ctx.orgId, {
      kind: action,
      title: target === "auto" ? `${name} now rolls back automatically` : `${name} is back in shadow mode`,
      body: `${opts.automatic ? "Graduated by the trust ramp: " : ""}${rampProgress(before)}.`,
      href: "/app/policies#trust-ramp",
    });
  }
  return before;
}

/**
 * Graduates every eligible service when the org opted into automatic graduation.
 * Called after anything that can move the ramp: feedback, deployment writes and
 * settings changes. Returns the services it graduated.
 */
export async function syncTrustRamp(orgCtx: OrgCtx, now = Date.now()): Promise<string[]> {
  const ctx: OrgCtx = { orgId: orgCtx.orgId, actor: systemActor() };
  const policy = await getPolicy(ctx);
  if (!policy.trust_ramp.auto_graduate) return [];
  const ramp = await loadTrustRamp(ctx, now);
  const done: string[] = [];
  for (const s of ramp.services.filter((x) => x.eligible)) {
    await setRollbackMode(ctx, s.service, "auto", { automatic: true, ramp, now });
    done.push(s.service);
  }
  return done;
}

/** Best effort: a ramp failure must never fail the write that triggered it. */
export async function syncTrustRampQuietly(ctx: OrgCtx): Promise<void> {
  try {
    await syncTrustRamp(ctx);
  } catch (e) {
    console.error("trust ramp sync failed", e);
  }
}

/** Records a person's verdict on a release's shadow recommendation (latest answer wins). */
export async function recordShadowFeedback(ctx: OrgCtx, deploymentId: string, verdict: ShadowFeedback | null): Promise<void> {
  requireAdmin(ctx);
  const found = await recommendationFor(ctx, deploymentId);
  if (!found) throw invalid("This release has no shadow-mode rollback recommendation to judge.");
  const previous = found.rec.feedback;
  if (verdict === null) {
    await db.delete(shadowFeedback).where(and(eq(shadowFeedback.orgId, ctx.orgId), eq(shadowFeedback.deploymentId, deploymentId)));
  } else {
    const now = new Date();
    await db
      .insert(shadowFeedback)
      .values({ deploymentId, orgId: ctx.orgId, service: found.rec.service, verdict, userId: ctx.actor.userId ?? null, updatedAt: now })
      .onConflictDoUpdate({ target: shadowFeedback.deploymentId, set: { verdict, userId: ctx.actor.userId ?? null, updatedAt: now } });
  }
  await writeAudit(ctx, "trust_ramp.feedback", deploymentId, { service: found.rec.service, verdict: verdict ?? "cleared", previous, recommended_at: found.rec.at });
  await syncTrustRampQuietly(ctx);
}

/** Feedback per release for the given ids (release page, inbox). */
export async function shadowFeedbackFor(ctx: OrgCtx, ids: string[]): Promise<Map<string, ShadowFeedback>> {
  return ids.length ? feedbackMap(ctx, ids.slice(0, 1000)) : new Map();
}
