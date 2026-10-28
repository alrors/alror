"use server";

import { revalidatePath } from "next/cache";
import { actionError, field, type ActionResult } from "@/lib/console/action-result";
import { requireCtx } from "@/lib/server/auth/session";
import { revokeAlertSecret, rotateAlertSecret, updateAlertSettings } from "@/lib/server/data/alert-settings";

// Alert integration actions (owners and admins; the data layer enforces requireAdmin).

export type SecretResult = (ActionResult & { token?: string; prefix?: string }) | undefined;

/** Creates or rotates the alert webhook secret; the token is returned once. */
export async function rotateSecret(): Promise<SecretResult> {
  const ctx = await requireCtx();
  try {
    const { token, prefix } = await rotateAlertSecret(ctx);
    revalidatePath("/app/settings/integrations");
    return { ok: true, token, prefix };
  } catch (e) {
    return actionError(e, "Could not create the alert secret.");
  }
}

export async function revokeSecret(): Promise<ActionResult> {
  const ctx = await requireCtx();
  try {
    await revokeAlertSecret(ctx);
  } catch (e) {
    return actionError(e, "Could not revoke the alert secret.");
  }
  revalidatePath("/app/settings/integrations");
  return { ok: true, message: "Alert secret revoked." };
}

export async function saveAlertRules(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await requireCtx();
  const num = (k: string) => {
    const v = field(formData, k);
    return v === "" ? undefined : Number(v);
  };
  try {
    await updateAlertSettings(ctx, {
      auto_rollback: formData.get("auto_rollback") === "on",
      threshold: num("threshold"),
      max_age_minutes: num("max_age_minutes"),
      window_minutes: num("window_minutes"),
    });
  } catch (e) {
    return actionError(e, "Could not save the rules.");
  }
  revalidatePath("/app/settings/integrations");
  revalidatePath("/app/incidents");
  return { ok: true, message: "Saved." };
}
