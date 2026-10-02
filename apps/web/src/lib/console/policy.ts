import "server-only";
import { cache } from "react";
import { getConfig } from "@/lib/server/data/config";
import { requireCtx } from "./auth";

export type ServiceConfig = { name: string; paths: string[]; target: string; critical: boolean; cluster?: string; namespace?: string };

export type ProjectConfig = {
  path: string;
  project: string;
  services: ServiceConfig[];
  metrics: { provider: string; names: string[] };
  policy: {
    maxRegression: Record<string, number>;
    alpha: number;
    autoRollback: boolean;
    bakeScale: number;
  };
  notify: { slack: boolean };
  error?: string;
};

/** The built-in rollout plans live in ./policy-rules (DEFAULT_PLANS); orgs can override them on /app/policies. */
export { DEFAULT_PLANS as PLANS } from "./policy-rules";

/** The org's services and policy (stored in Postgres; `alror config push` updates them). */
export const readProjectConfig = cache(async (): Promise<ProjectConfig> => {
  const ctx = await requireCtx();
  const c = await getConfig(ctx);
  const maxRegression = { ...c.policy.max_regression };
  return {
    path: "alror.yaml",
    project: c.project,
    services: c.services.map((s) => ({
      name: s.name,
      paths: s.paths,
      target: s.target,
      critical: s.critical,
      cluster: s.cluster || undefined,
      namespace: s.namespace || undefined,
    })),
    metrics: { provider: c.metrics.provider, names: Object.keys(maxRegression).sort() },
    policy: {
      maxRegression,
      alpha: c.policy.alpha || 0.05,
      autoRollback: c.policy.auto_rollback,
      bakeScale: c.policy.bake_scale || 1,
    },
    notify: { slack: Boolean(c.notify.slack_webhook) },
  };
});
