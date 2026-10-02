"use server";

import { revalidatePath } from "next/cache";
import { actionError, type ActionResult } from "@/lib/console/action-result";
import {
  DEFAULT_PLANS,
  normalisePlans,
  plansFromStored,
  plansToStored,
  samePlans,
  validatePolicy,
  type PolicyErrors,
  type PolicyForm,
} from "@/lib/console/policy-rules";
import { requireCtx } from "@/lib/server/auth/session";
import { requireAdmin } from "@/lib/server/context";
import { getPolicy, updatePolicy } from "@/lib/server/data/policy";

export type PolicyResult = (ActionResult & { errors?: PolicyErrors }) | undefined;

const round = (v: number, d = 6) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * Saves the org policy through the same data layer PUT /config uses
 * (updatePolicy), which upserts org_policies and writes a policy.update audit row.
 */
export async function savePolicy(_prev: PolicyResult, formData: FormData): Promise<PolicyResult> {
  const ctx = await requireCtx();
  try {
    requireAdmin(ctx);
  } catch (e) {
    return actionError(e, "Only owners and admins can change policies.");
  }

  let form: PolicyForm;
  try {
    form = JSON.parse(String(formData.get("policy") ?? "")) as PolicyForm;
  } catch {
    return { error: "The form could not be read. Reload the page and try again." };
  }
  const errors = validatePolicy(form);
  if (Object.keys(errors).length) return { error: "Fix the highlighted fields.", errors };

  const plans = normalisePlans(form.plans);
  const maxRegression = Object.fromEntries(form.thresholds.map((t) => [t.metric, round(t.pct / 100)]));
  try {
    const before = await getPolicy(ctx);
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const note = (k: string, from: unknown, to: unknown) => {
      if (JSON.stringify(from) !== JSON.stringify(to)) changes[k] = { from, to };
    };
    const custom = samePlans(plans, DEFAULT_PLANS) ? null : plansToStored(plans);
    note("auto_rollback", before.auto_rollback, form.auto_rollback);
    note("alpha", before.alpha, form.alpha);
    note("bake_scale", before.bake_scale, form.bake_scale);
    note("max_regression", before.max_regression, maxRegression);
    note("plans", before.plans ? plansFromStored(before.plans) : "default", custom ? plans : "default");
    if (Object.keys(changes).length === 0) return { ok: true, message: "No changes to save." };

    await updatePolicy(
      ctx,
      { auto_rollback: form.auto_rollback, alpha: form.alpha, bake_scale: form.bake_scale, max_regression: maxRegression, plans: custom },
      { auditMeta: { source: "console", changes } },
    );
  } catch (e) {
    return actionError(e, "Could not save the policy.");
  }
  revalidatePath("/app", "layout");
  return { ok: true, message: "Policy saved. CLIs and runners pick it up on their next run." };
}
