import "server-only";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { deployments, services, tuningSettings } from "../db/schema";
import type { DecisionContext } from "./decide";
import { FACTOR_KEYS, rules, type RiskWeights } from "./score";

/** Only known factor keys with finite, non-negative values; anything else scores with the shared rules. */
export function cleanWeights(raw: unknown): RiskWeights {
  const out: RiskWeights = {};
  if (!raw || typeof raw !== "object") return out;
  for (const k of FACTOR_KEYS) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v !== 1) out[k] = v;
  }
  return out;
}

/** Loads the org's services (path prefixes, criticality), rollbacks per service within the rules' window and accepted factor weights. */
export async function loadDecisionContext(orgId: string, now = Date.now()): Promise<DecisionContext> {
  const since = new Date(now - rules.factors.recent_rollbacks.window_days * 864e5);
  const [rows, rollbacks, tuning] = await Promise.all([
    db.select({ name: services.name, paths: services.paths, critical: services.critical }).from(services)
      .where(and(eq(services.orgId, orgId), isNull(services.archivedAt))).orderBy(services.createdAt, services.name),
    db.select({ service: deployments.service, n: sql<number>`count(*)::int` }).from(deployments)
      .where(and(eq(deployments.orgId, orgId), eq(deployments.status, "rolled_back"), gt(deployments.updatedAt, since)))
      .groupBy(deployments.service),
    db.select({ weights: tuningSettings.riskWeights }).from(tuningSettings).where(eq(tuningSettings.orgId, orgId)).limit(1),
  ]);
  const weights = cleanWeights(tuning[0]?.weights);
  return { services: rows, recentRollbacks: Object.fromEntries(rollbacks.map((r) => [r.service, r.n])), ...(Object.keys(weights).length ? { weights } : {}) };
}
