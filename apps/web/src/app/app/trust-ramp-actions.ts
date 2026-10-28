"use server";

import { revalidatePath } from "next/cache";
import { actionError, type ActionResult } from "@/lib/console/action-result";
import { isValidId } from "@/lib/console/data";
import { rampSettings, SHADOW_FEEDBACK, validateRampSettings, type RollbackMode, type ShadowFeedback, type TrustRampSettings } from "@/lib/console/trust-ramp";
import { requireCtx } from "@/lib/server/auth/session";
import { requireAdmin } from "@/lib/server/context";
import { getPolicy, updatePolicy } from "@/lib/server/data/policy";
import { recordShadowFeedback, setRollbackMode, syncTrustRampQuietly } from "@/lib/server/data/trust-ramp";

// Trust ramp actions: human feedback on shadow recommendations, the per-service
// rollback switch and the ramp settings. Every write is audited by the data layer.

/** "correct" / "false_alarm" on a release's shadow recommendation; "clear" removes the answer. */
export async function judgeRecommendation(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await requireCtx();
  const id = String(formData.get("id") ?? "");
  const raw = String(formData.get("verdict") ?? "");
  if (!isValidId(id)) return { error: "Invalid deployment id." };
  const verdict: ShadowFeedback | null = raw === "clear" ? null : SHADOW_FEEDBACK.includes(raw as ShadowFeedback) ? (raw as ShadowFeedback) : null;
  if (raw !== "clear" && !verdict) return { error: "Unknown answer." };
  try {
    await recordShadowFeedback(ctx, id, verdict);
  } catch (e) {
    return actionError(e, "Could not save your answer.");
  }
  revalidatePath("/app", "layout");
  return { ok: true, message: verdict === "correct" ? "Marked correct" : verdict === "false_alarm" ? "Marked as a false alarm" : "Answer cleared" };
}

/** The Policies switch: shadow ⇄ automatic for one service. */
export async function switchRollbackMode(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await requireCtx();
  const service = String(formData.get("service") ?? "");
  const mode = String(formData.get("mode") ?? "") as RollbackMode;
  if (mode !== "auto" && mode !== "shadow") return { error: "Unknown rollback mode." };
  try {
    await setRollbackMode(ctx, service, mode);
  } catch (e) {
    return actionError(e, "Could not change the rollback mode.");
  }
  revalidatePath("/app", "layout");
  return {
    ok: true,
    message: mode === "auto" ? `${service} now rolls back automatically` : `${service} is back in shadow mode; its ramp starts over.`,
  };
}

/**
 * Undo for the switch's toast: puts the service's previous override back
 * (`null` = follow the org default) without restarting its ramp.
 */
export async function undoRollbackMode(service: string, previous: RollbackMode | null): Promise<ActionResult> {
  const ctx = await requireCtx();
  if (previous !== null && previous !== "auto" && previous !== "shadow") return { error: "Unknown rollback mode." };
  try {
    await setRollbackMode(ctx, String(service), previous, { undo: true });
  } catch (e) {
    return actionError(e, "Could not undo the rollback mode change.");
  }
  revalidatePath("/app", "layout");
  return { ok: true };
}

export type RampSettingsResult = (ActionResult & { errors?: Partial<Record<keyof TrustRampSettings, string>> }) | undefined;

/** Thresholds and propose-only vs auto-graduate. Saved on the org policy (policy.update audit with changes). */
export async function saveRampSettings(_prev: RampSettingsResult, formData: FormData): Promise<RampSettingsResult> {
  const ctx = await requireCtx();
  try {
    requireAdmin(ctx);
  } catch (e) {
    return actionError(e, "Only owners and admins can change the trust ramp.");
  }
  const input = {
    auto_graduate: formData.get("auto_graduate") === "on",
    required_confirmed: Number(formData.get("required_confirmed")),
    false_alarm_days: Number(formData.get("false_alarm_days")),
    window_hours: Number(formData.get("window_hours")),
  };
  const errors = validateRampSettings(input);
  if (Object.keys(errors).length) return { error: "Fix the highlighted fields.", errors };
  const next = rampSettings(input);
  try {
    const before = (await getPolicy(ctx)).trust_ramp;
    const changes = Object.fromEntries(
      (Object.keys(next) as (keyof TrustRampSettings)[]).filter((k) => before[k] !== next[k]).map((k) => [`trust_ramp.${k}`, { from: before[k], to: next[k] }]),
    );
    if (!Object.keys(changes).length) return { ok: true, message: "No changes to save." };
    await updatePolicy(ctx, { trust_ramp: next }, { auditMeta: { source: "console", changes } });
    await syncTrustRampQuietly(ctx);
  } catch (e) {
    return actionError(e, "Could not save the trust ramp settings.");
  }
  revalidatePath("/app", "layout");
  return { ok: true, message: next.auto_graduate ? "Saved. Eligible services now switch to automatic rollback on their own." : "Saved. Eligible services are proposed in Needs you." };
}
