import "server-only";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { deployments, services } from "../db/schema";
import type { DecisionContext } from "./decide";
import { rules } from "./score";

/** Loads the org's services (path prefixes, criticality) and rollbacks per service within the rules' window. */
export async function loadDecisionContext(orgId: string, now = Date.now()): Promise<DecisionContext> {
  const since = new Date(now - rules.factors.recent_rollbacks.window_days * 864e5);
  const [rows, rollbacks] = await Promise.all([
    db.select({ name: services.name, paths: services.paths, critical: services.critical }).from(services)
      .where(and(eq(services.orgId, orgId), isNull(services.archivedAt))).orderBy(services.createdAt, services.name),
    db.select({ service: deployments.service, n: sql<number>`count(*)::int` }).from(deployments)
      .where(and(eq(deployments.orgId, orgId), eq(deployments.status, "rolled_back"), gt(deployments.updatedAt, since)))
      .groupBy(deployments.service),
  ]);
  return { services: rows, recentRollbacks: Object.fromEntries(rollbacks.map((r) => [r.service, r.n])) };
}
