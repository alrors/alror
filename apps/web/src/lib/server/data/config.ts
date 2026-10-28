import "server-only";
import { isAdminRole, type OrgCtx } from "../context";
import { db } from "../db";
import type { Target } from "../db/schema";
import type { RollbackMode } from "@/lib/console/trust-ramp";
import { forbidden } from "../errors";
import { writeAudit } from "./audit";
import { getOrg } from "./orgs";
import { getPolicy, updatePolicy } from "./policy";
import { listServices, upsertServiceByName } from "./services";
import { cleanWeights } from "../decision/context";
import { cloneOverride, type ServiceOverride } from "../tuning/thresholds";
import { tuningSettings } from "../db/schema";
import { eq } from "drizzle-orm";

/** The alror.yaml shape served by GET /config (Go internal/config.Config, JSON tags). */
export type ConfigJSON = {
  project: string;
  services: {
    name: string;
    paths: string[];
    target: string;
    cluster: string;
    namespace: string;
    critical: boolean;
    /** Per-service override of policy.auto_rollback (trust ramp). Omitted when the service follows the policy. */
    rollback_mode?: RollbackMode;
    /** Per-service override from accepted tuning proposals (Go config.ServicePolicy); absent = the org policy. */
    policy?: ServiceOverride;
  }[];
  metrics: { provider: string; url?: string; queries?: Record<string, string> };
  policy: {
    max_regression: Record<string, number>;
    alpha: number;
    auto_rollback: boolean;
    bake_scale?: number;
    /** Only present when the org customised its rollout plans. */
    plans?: Record<string, { weight: number; bake: number }[]>;
  };
  notify: { slack_webhook?: string };
  /** Learned factor weights from accepted tuning proposals (Go config.Risk); absent = the shared rules unchanged. */
  risk?: { weights: Record<string, number> };
};

export type ConfigInput = {
  project?: string;
  services?: { name: string; paths?: string[]; target?: Target; cluster?: string; namespace?: string; critical?: boolean; rollback_mode?: RollbackMode }[];
  metrics?: { provider: string; url?: string; queries?: Record<string, string> };
  policy?: {
    max_regression?: Record<string, number>;
    alpha?: number;
    auto_rollback?: boolean;
    bake_scale?: number;
    plans?: Record<string, { weight: number; bake: number }[]> | null;
  };
  notify?: { slack_webhook?: string };
};

export async function getConfig(ctx: OrgCtx): Promise<ConfigJSON> {
  const [org, services, policy, tuning] = await Promise.all([
    getOrg(ctx.orgId), listServices(ctx), getPolicy(ctx),
    db.select({ weights: tuningSettings.riskWeights }).from(tuningSettings).where(eq(tuningSettings.orgId, ctx.orgId)).limit(1),
  ]);
  const weights = cleanWeights(tuning[0]?.weights);
  const metrics: ConfigJSON["metrics"] = { provider: policy.metrics.provider || "synthetic" };
  if (policy.metrics.url) metrics.url = policy.metrics.url;
  if (policy.metrics.queries && Object.keys(policy.metrics.queries).length) metrics.queries = policy.metrics.queries;
  return {
    project: org?.slug ?? "default",
    services: services.map((s) => ({
      name: s.name,
      paths: s.paths,
      target: s.target,
      cluster: s.cluster,
      namespace: s.namespace,
      critical: s.critical,
      ...(s.rollback_mode ? { rollback_mode: s.rollback_mode } : {}),
      ...servicePolicy(s.policy_override),
    })),
    metrics,
    policy: {
      max_regression: policy.max_regression,
      alpha: policy.alpha,
      auto_rollback: policy.auto_rollback,
      ...(policy.bake_scale ? { bake_scale: policy.bake_scale } : {}),
      ...(policy.plans ? { plans: policy.plans } : {}),
    },
    notify: policy.slack_webhook ? { slack_webhook: policy.slack_webhook } : {},
    ...(Object.keys(weights).length ? { risk: { weights } } : {}),
  };
}

function servicePolicy(raw: unknown): { policy?: ServiceOverride } {
  const o = cloneOverride(raw);
  return Object.keys(o).length ? { policy: o } : {};
}

/**
 * Upserts services by name and the policy (alror config push). Allowed for
 * owner/admin sessions and API keys with config:write. Services missing from
 * the input are left as they are.
 */
export async function putConfig(ctx: OrgCtx, input: ConfigInput): Promise<ConfigJSON> {
  const allowed =
    ctx.actor.type === "system" ||
    (ctx.actor.type === "user" && isAdminRole(ctx.actor.role)) ||
    (ctx.actor.type === "api_key" && ctx.actor.scopes.includes("config:write"));
  if (!allowed) throw forbidden("Updating the config needs an owner/admin session or a key with the config:write scope.");

  const created: string[] = [];
  const updated: string[] = [];
  await db.transaction(async (tx) => {
    for (const s of input.services ?? []) {
      const r = await upsertServiceByName(ctx, s, tx);
      (r.created ? created : updated).push(s.name);
    }
    const p = input.policy;
    if (p || input.metrics || input.notify) {
      await updatePolicy(
        ctx,
        {
          ...(p?.max_regression !== undefined && { max_regression: p.max_regression }),
          ...(p?.alpha !== undefined && { alpha: p.alpha }),
          ...(p?.auto_rollback !== undefined && { auto_rollback: p.auto_rollback }),
          ...(p?.bake_scale !== undefined && { bake_scale: p.bake_scale || 1 }),
          ...(p?.plans !== undefined && { plans: p.plans }),
          ...(input.metrics && { metrics: input.metrics }),
          ...(input.notify && { slack_webhook: input.notify.slack_webhook ?? null }),
        },
        { tx, authorized: true },
      );
    }
    const modes = Object.fromEntries((input.services ?? []).flatMap((s) => (s.rollback_mode ? [[s.name, s.rollback_mode]] : [])));
    await writeAudit(
      ctx,
      "config.push",
      "config",
      { services_created: created, services_updated: updated, ...(Object.keys(modes).length ? { rollback_modes: modes } : {}) },
      tx,
    );
  });
  return getConfig(ctx);
}
