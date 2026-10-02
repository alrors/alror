import "server-only";
import { eq } from "drizzle-orm";
import { requireAdmin, type OrgCtx } from "../context";
import { db, type Tx } from "../db";
import { orgPolicies, users } from "../db/schema";
import { invalid } from "../errors";
import { plansFromStored, validatePlans } from "@/lib/console/policy-rules";
import { writeAudit } from "./audit";

export type MetricsConfig = { provider: string; url?: string; queries?: Record<string, string> };

export type OrgPolicy = {
  max_regression: Record<string, number>;
  alpha: number;
  auto_rollback: boolean;
  bake_scale: number;
  metrics: MetricsConfig;
  slack_webhook: string | null;
  /** Custom rollout plans ({low|medium|high: [{weight, bake ns}]}); null = the CLI's built-in planner. */
  plans: Record<string, { weight: number; bake: number }[]> | null;
  updated_at: string;
  updated_by: string | null;
};

export const DEFAULT_POLICY: Omit<OrgPolicy, "updated_at" | "updated_by"> = {
  max_regression: { error_rate: 0.25, latency_p95: 0.15 },
  alpha: 0.05,
  auto_rollback: true,
  bake_scale: 1,
  metrics: { provider: "synthetic" },
  slack_webhook: null,
  plans: null,
};

export async function getPolicy(ctx: OrgCtx, tx: Tx = db): Promise<OrgPolicy> {
  const [row] = await tx
    .select({ p: orgPolicies, by: users.email })
    .from(orgPolicies)
    .leftJoin(users, eq(users.id, orgPolicies.updatedBy))
    .where(eq(orgPolicies.orgId, ctx.orgId))
    .limit(1);
  if (!row) return { ...DEFAULT_POLICY, updated_at: new Date(0).toISOString(), updated_by: null };
  const r = row.p;
  return {
    max_regression: r.maxRegression,
    alpha: Number(r.alpha),
    auto_rollback: r.autoRollback,
    bake_scale: Number(r.bakeScale),
    metrics: r.metrics,
    slack_webhook: r.slackWebhook,
    plans: r.plans ?? null,
    updated_at: r.updatedAt.toISOString(),
    updated_by: row.by ?? null,
  };
}

export type PolicyPatch = Partial<Omit<OrgPolicy, "updated_at" | "updated_by">>;

/**
 * Upserts the org policy. Requires an owner/admin session unless the caller has
 * already authorised the write (PUT /config with a config:write key).
 */
export async function updatePolicy(
  ctx: OrgCtx,
  patch: PolicyPatch,
  opts: { tx?: Tx; authorized?: boolean; auditMeta?: Record<string, unknown> } = {},
): Promise<void> {
  if (!opts.authorized) requireAdmin(ctx);
  const tx = opts.tx ?? db;
  if (patch.plans) {
    const levels = Object.keys(patch.plans);
    if (levels.some((l) => !["low", "medium", "high"].includes(l))) throw invalid("plans: levels are low, medium and high.");
    const errs = Object.values(validatePlans(plansFromStored(patch.plans)));
    if (errs.length) throw invalid(`plans: ${errs[0]}`);
  }
  const set = {
    ...(patch.max_regression !== undefined && { maxRegression: patch.max_regression }),
    ...(patch.alpha !== undefined && { alpha: patch.alpha }),
    ...(patch.auto_rollback !== undefined && { autoRollback: patch.auto_rollback }),
    ...(patch.bake_scale !== undefined && { bakeScale: patch.bake_scale }),
    ...(patch.metrics !== undefined && { metrics: patch.metrics }),
    ...(patch.slack_webhook !== undefined && { slackWebhook: patch.slack_webhook || null }),
    ...(patch.plans !== undefined && { plans: patch.plans }),
    updatedAt: new Date(),
    updatedBy: ctx.actor.userId ?? null,
  };
  await tx
    .insert(orgPolicies)
    .values({ orgId: ctx.orgId, ...set })
    .onConflictDoUpdate({ target: orgPolicies.orgId, set });
  await writeAudit(ctx, "policy.update", "policy", { fields: Object.keys(patch), ...opts.auditMeta }, tx);
}
