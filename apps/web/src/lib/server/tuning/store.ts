import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { requireAdmin, systemActor, type OrgCtx } from "../context";
import { db, type Tx } from "../db";
import { deploymentEvents, deployments, services, tuningProposals, tuningSettings, type TuningKind, type TuningStatus } from "../db/schema";
import { conflict, invalid, notFound } from "../errors";
import { writeAudit } from "../data/audit";
import { getPolicy } from "../data/policy";
import { cleanWeights } from "../decision/context";
import { factorKeyFor, type FactorKey, type RiskWeights } from "../decision/score";
import { DAY_MS, resolveBounds, type TuningBounds } from "./bounds";
import { cloneOverride, effectivePolicy, tuneService, type ReleaseObs, type ResultObs, type ServiceOverride, type ServiceTuning } from "./thresholds";
import { tuneWeights, type OutcomeObs, type WeightTuning } from "./weights";

// Tuning proposals: analysis runs in the portal over stored verdicts and release outcomes; it only
// writes proposals. Values change when an admin accepts one (or automatically when the org opted in),
// and every change is audit-logged. Go never tunes: it honours services[].policy and risk.weights
// from GET /api/v1/config.

/** How often a page view may re-run the analysis. */
export const TUNING_REFRESH_MS = 6 * 3_600_000;

export type TuningSettings = { auto_apply: boolean; bounds: TuningBounds; custom_bounds: boolean; risk_weights: RiskWeights; last_run_at: string | null };

export type Proposal = {
  id: string;
  kind: TuningKind;
  service: string | null;
  status: TuningStatus;
  summary: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  evidence: Record<string, unknown>;
  auto_applied: boolean;
  created_at: string;
  decided_at: string | null;
  decided_label: string | null;
};

export type TuningAnalysis = { at: string; bounds: TuningBounds; services: ServiceTuning[]; weights: WeightTuning };

const toProposal = (r: typeof tuningProposals.$inferSelect): Proposal => ({
  id: r.id, kind: r.kind, service: r.service, status: r.status, summary: r.summary, before: r.before, after: r.after, evidence: r.evidence,
  auto_applied: r.autoApplied, created_at: r.createdAt.toISOString(), decided_at: r.decidedAt?.toISOString() ?? null, decided_label: r.decidedLabel,
});

export async function getTuningSettings(ctx: OrgCtx, tx: Tx = db): Promise<TuningSettings> {
  const [r] = await tx.select().from(tuningSettings).where(eq(tuningSettings.orgId, ctx.orgId)).limit(1);
  return {
    auto_apply: r?.autoApply ?? false,
    bounds: resolveBounds(r?.bounds),
    custom_bounds: Boolean(r?.bounds),
    risk_weights: cleanWeights(r?.riskWeights),
    last_run_at: r?.lastRunAt?.toISOString() ?? null,
  };
}

async function upsertSettings(ctx: OrgCtx, set: Partial<typeof tuningSettings.$inferInsert>, tx: Tx = db) {
  await tx.insert(tuningSettings).values({ orgId: ctx.orgId, ...set }).onConflictDoUpdate({ target: tuningSettings.orgId, set });
}

/** Admin: turn auto-apply on or off, or change the floors and ceilings (null = defaults). */
export async function updateTuningSettings(ctx: OrgCtx, patch: { auto_apply?: boolean; bounds?: Record<string, unknown> | null }): Promise<void> {
  requireAdmin(ctx);
  const before = await getTuningSettings(ctx);
  await db.transaction(async (tx) => {
    await upsertSettings(ctx, {
      ...(patch.auto_apply !== undefined && { autoApply: patch.auto_apply }),
      ...(patch.bounds !== undefined && { bounds: patch.bounds === null ? null : (resolveBounds(patch.bounds) as unknown as Record<string, unknown>) }),
      updatedAt: new Date(),
      updatedBy: ctx.actor.userId ?? null,
    }, tx);
    await writeAudit(ctx, "tuning.settings", "tuning", {
      ...(patch.auto_apply !== undefined && { auto_apply: { from: before.auto_apply, to: patch.auto_apply } }),
      ...(patch.bounds !== undefined && { bounds: patch.bounds === null ? "default" : "custom" }),
    }, tx);
  });
}

/* ------------------------------------ Analysis ------------------------------------ */

type VerdictJSON = { pass?: boolean; evidence?: string; results?: ResultObs[] | null };

/** Runs both analyses over stored data. Reads only. */
export async function analyseTuning(ctx: OrgCtx, now = Date.now()): Promise<TuningAnalysis> {
  const settings = await getTuningSettings(ctx);
  const b = settings.bounds;
  const since = new Date(now - b.windowDays * DAY_MS);
  const weightsSince = new Date(now - b.weights.windowDays * DAY_MS);

  const [policy, svcRows, deps, verdicts, outcomes] = await Promise.all([
    getPolicy(ctx),
    db.select({ id: services.id, name: services.name, override: services.policyOverride }).from(services)
      .where(and(eq(services.orgId, ctx.orgId), isNull(services.archivedAt))).orderBy(asc(services.name)),
    db.select({ id: deployments.id, service: deployments.service, status: deployments.status, at: deployments.createdAt }).from(deployments)
      .where(and(eq(deployments.orgId, ctx.orgId), gte(deployments.createdAt, since))),
    db.select({ id: deployments.id, at: deploymentEvents.at, verdict: deploymentEvents.verdict }).from(deploymentEvents)
      .innerJoin(deployments, eq(deployments.id, deploymentEvents.deploymentId))
      .where(and(eq(deployments.orgId, ctx.orgId), gte(deployments.createdAt, since), eq(deploymentEvents.kind, "verdict"))),
    db.select({ status: deployments.status, risk: deployments.risk, at: deployments.createdAt }).from(deployments)
      .where(and(eq(deployments.orgId, ctx.orgId), gte(deployments.createdAt, weightsSince), inArray(deployments.status, ["promoted", "rolled_back"]))),
  ]);

  const byDep = new Map<string, ReleaseObs["verdicts"]>();
  for (const v of verdicts) {
    const j = v.verdict as VerdictJSON | null;
    if (!j) continue;
    const list = byDep.get(v.id) ?? [];
    list.push({ at: v.at.getTime(), evidence: j.evidence, results: (j.results ?? []).filter((r) => r && typeof r.metric === "string") });
    byDep.set(v.id, list);
  }
  const releases = new Map<string, ReleaseObs[]>();
  for (const d of deps) {
    const list = releases.get(d.service) ?? [];
    list.push({ id: d.id, at: d.at.getTime(), status: d.status, verdicts: byDep.get(d.id) ?? [] });
    releases.set(d.service, list);
  }

  const serviceTuning = svcRows.map((s) => {
    const override = s.override ? cloneOverride(s.override) : null;
    return tuneService({ service: s.name, now, bounds: b, current: effectivePolicy(policy, override), override, releases: releases.get(s.name) ?? [] });
  });

  let skipped = 0;
  const obs: OutcomeObs[] = [];
  for (const o of outcomes) {
    const risk = o.risk as { score?: number; factors?: { name: string; points: number }[] } | null;
    const points: Partial<Record<FactorKey, number>> = {};
    let known = true;
    for (const f of risk?.factors ?? []) {
      const key = factorKeyFor(f.name);
      if (!key) { known = false; break; }
      points[key] = (points[key] ?? 0) + f.points;
    }
    if (!known || typeof risk?.score !== "number") { skipped++; continue; }
    obs.push({ at: o.at.getTime(), outcome: o.status as OutcomeObs["outcome"], score: risk.score, points });
  }
  const weights = tuneWeights({ now, bounds: b, current: settings.risk_weights, observations: obs, skipped });
  return { at: new Date(now).toISOString(), bounds: b, services: serviceTuning, weights };
}

/* ------------------------------------ Proposals ------------------------------------ */

export async function listProposals(ctx: OrgCtx, opts: { status?: TuningStatus[]; limit?: number } = {}): Promise<Proposal[]> {
  const rows = await db.select().from(tuningProposals)
    .where(and(eq(tuningProposals.orgId, ctx.orgId), opts.status ? inArray(tuningProposals.status, opts.status) : undefined))
    .orderBy(desc(tuningProposals.createdAt)).limit(Math.min(opts.limit ?? 50, 200));
  return rows.map(toProposal);
}

const same = (a: unknown, b: unknown) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sortKeys(x)]));
  return v;
}

type Candidate = { kind: TuningKind; serviceId: string | null; service: string | null; summary: string; before: Record<string, unknown>; after: Record<string, unknown>; evidence: Record<string, unknown> };

function candidates(a: TuningAnalysis, ids: Map<string, string>): Candidate[] {
  const out: Candidate[] = [];
  for (const s of a.services) {
    if (!s.proposal) continue;
    out.push({
      kind: "service_policy", serviceId: ids.get(s.service) ?? null, service: s.service, summary: s.proposal.summary,
      before: { override: s.proposal.before }, after: { override: s.proposal.after },
      evidence: { window: s.window, releases: s.releases, healthy_releases: s.healthyReleases, synthetic_checks_ignored: s.syntheticChecksIgnored, metrics: s.metrics, bake: s.bake },
    });
  }
  const w = a.weights;
  if (w.proposal) {
    out.push({
      kind: "risk_weights", serviceId: null, service: null, summary: w.proposal.summary,
      before: { weights: w.proposal.before }, after: { weights: w.proposal.after },
      evidence: { window: w.window, releases: w.releases, rollbacks: w.rollbacks, skipped: w.skipped, factors: w.factors, effect: w.proposal.effect },
    });
  }
  return out;
}

/**
 * Re-runs the analysis and syncs proposals: a new or changed proposal supersedes the open one for the same
 * target, an open proposal the data no longer supports is superseded, and values a person dismissed in the
 * last 30 days are not proposed again. With auto-apply on, new proposals are applied as the system.
 * Throttled to TUNING_REFRESH_MS unless forced.
 */
export async function refreshTuning(ctx: OrgCtx, opts: { force?: boolean; now?: number } = {}): Promise<{ ran: boolean; created: number; applied: number }> {
  const now = opts.now ?? Date.now();
  const settings = await getTuningSettings(ctx);
  if (!opts.force && settings.last_run_at && now - Date.parse(settings.last_run_at) < TUNING_REFRESH_MS) return { ran: false, created: 0, applied: 0 };
  const sys: OrgCtx = { orgId: ctx.orgId, actor: systemActor() };
  const analysis = await analyseTuning(ctx, now);
  const ids = new Map((await db.select({ id: services.id, name: services.name }).from(services).where(eq(services.orgId, ctx.orgId))).map((r) => [r.name, r.id]));
  const fresh = candidates(analysis, ids);
  const created: string[] = [];
  await db.transaction(async (tx) => {
    const open = await tx.select().from(tuningProposals).where(and(eq(tuningProposals.orgId, ctx.orgId), eq(tuningProposals.status, "open")));
    const dismissed = await tx.select().from(tuningProposals).where(and(eq(tuningProposals.orgId, ctx.orgId), eq(tuningProposals.status, "dismissed"), gte(tuningProposals.decidedAt, new Date(now - 30 * DAY_MS))));
    const target = (p: { kind: string; service: string | null }) => `${p.kind}:${p.service ?? ""}`;
    const keep = new Set<string>();
    for (const c of fresh) {
      const cur = open.find((o) => target(o) === target(c));
      if (cur && same(cur.after, c.after) && same(cur.before, c.before)) {
        keep.add(cur.id);
        await tx.update(tuningProposals).set({ evidence: c.evidence, summary: c.summary }).where(eq(tuningProposals.id, cur.id));
        continue;
      }
      if (dismissed.some((d) => target(d) === target(c) && same(d.after, c.after))) continue;
      const [row] = await tx.insert(tuningProposals).values({ orgId: ctx.orgId, ...c, evidence: { ...c.evidence, analysed_at: analysis.at } }).returning({ id: tuningProposals.id });
      created.push(row.id);
    }
    const stale = open.filter((o) => !keep.has(o.id)).map((o) => o.id);
    if (stale.length) await tx.update(tuningProposals).set({ status: "superseded", decidedAt: new Date(now), decidedLabel: "system" }).where(inArray(tuningProposals.id, stale));
    await upsertSettings(ctx, { lastRunAt: new Date(now) }, tx);
  });
  let applied = 0;
  if (settings.auto_apply) {
    for (const id of created) {
      try {
        await applyProposal(sys, id, { auto: true });
        applied++;
      } catch (e) {
        console.error("[alror tuning] auto-apply failed", id, e);
      }
    }
  }
  return { ran: true, created: created.length, applied };
}

/** Admin: accept an open proposal. */
export async function acceptProposal(ctx: OrgCtx, id: string): Promise<Proposal> {
  requireAdmin(ctx);
  return applyProposal(ctx, id, { auto: false });
}

async function applyProposal(ctx: OrgCtx, id: string, opts: { auto: boolean }): Promise<Proposal> {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(tuningProposals).where(and(eq(tuningProposals.orgId, ctx.orgId), eq(tuningProposals.id, id))).for("update").limit(1);
    if (!p) throw notFound("Proposal not found.");
    if (p.status !== "open") throw conflict(`This proposal is already ${p.status}.`);
    if (p.kind === "service_policy") {
      if (!p.serviceId) throw invalid("The service for this proposal no longer exists.");
      const [svc] = await tx.select().from(services).where(and(eq(services.orgId, ctx.orgId), eq(services.id, p.serviceId))).for("update").limit(1);
      if (!svc) throw invalid("The service for this proposal no longer exists.");
      const before = (p.before as { override?: ServiceOverride }).override ?? {};
      if (!same(cloneOverride(svc.policyOverride), cloneOverride(before))) throw conflict("This service's policy changed since the proposal was made. Re-run the analysis.");
      const after = cloneOverride((p.after as { override?: ServiceOverride }).override);
      await tx.update(services).set({ policyOverride: Object.keys(after).length ? after : null }).where(eq(services.id, svc.id));
    } else {
      const [s] = await tx.select().from(tuningSettings).where(eq(tuningSettings.orgId, ctx.orgId)).for("update").limit(1);
      const before = (p.before as { weights?: RiskWeights }).weights ?? {};
      if (!same(cleanWeights(s?.riskWeights), cleanWeights(before))) throw conflict("Risk weights changed since the proposal was made. Re-run the analysis.");
      const after = cleanWeights((p.after as { weights?: RiskWeights }).weights);
      await upsertSettings(ctx, { riskWeights: after, updatedAt: new Date(), updatedBy: ctx.actor.userId ?? null }, tx);
    }
    const [row] = await tx.update(tuningProposals)
      .set({ status: "accepted", autoApplied: opts.auto, decidedAt: new Date(), decidedBy: ctx.actor.userId ?? null, decidedLabel: ctx.actor.label })
      .where(eq(tuningProposals.id, id)).returning();
    await writeAudit(ctx, opts.auto ? "tuning.auto_applied" : "tuning.accepted", p.service ?? "risk weights", {
      proposal: id, kind: p.kind, summary: p.summary, before: p.before, after: p.after,
      window: (p.evidence as { window?: unknown }).window,
    }, tx);
    return toProposal(row);
  });
}

/** Admin: dismiss an open proposal. The same values are not proposed again for 30 days. */
export async function dismissProposal(ctx: OrgCtx, id: string): Promise<void> {
  requireAdmin(ctx);
  await db.transaction(async (tx) => {
    const [row] = await tx.update(tuningProposals)
      .set({ status: "dismissed", decidedAt: new Date(), decidedBy: ctx.actor.userId ?? null, decidedLabel: ctx.actor.label })
      .where(and(eq(tuningProposals.orgId, ctx.orgId), eq(tuningProposals.id, id), eq(tuningProposals.status, "open"))).returning();
    if (!row) throw conflict("Only an open proposal can be dismissed.");
    await writeAudit(ctx, "tuning.dismissed", row.service ?? "risk weights", { proposal: id, kind: row.kind, summary: row.summary }, tx);
  });
}

/** Admin: drop a service's tuned override (back to the org policy) or reset learned weights. */
export async function resetTuned(ctx: OrgCtx, what: { service: string } | { weights: true }): Promise<void> {
  requireAdmin(ctx);
  await db.transaction(async (tx) => {
    if ("service" in what) {
      const [r] = await tx.update(services).set({ policyOverride: null })
        .where(and(eq(services.orgId, ctx.orgId), eq(services.name, what.service))).returning({ before: services.id });
      if (!r) throw notFound(`Service ${what.service} not found.`);
      await writeAudit(ctx, "tuning.reset", what.service, { kind: "service_policy" }, tx);
    } else {
      await upsertSettings(ctx, { riskWeights: {}, updatedAt: new Date(), updatedBy: ctx.actor.userId ?? null }, tx);
      await writeAudit(ctx, "tuning.reset", "risk weights", { kind: "risk_weights" }, tx);
    }
  });
}

/** Open proposals for the Needs you inbox (newest first). */
export async function openProposals(ctx: OrgCtx, limit = 20): Promise<Proposal[]> {
  return listProposals(ctx, { status: ["open"], limit });
}
