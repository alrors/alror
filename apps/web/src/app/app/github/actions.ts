"use server";

import { revalidatePath } from "next/cache";
import { actionError, field, type ActionResult } from "@/lib/console/action-result";
import { requireCtx } from "@/lib/server/auth/session";
import { requireAdmin } from "@/lib/server/context";
import { savePolicy, requeueEvaluation } from "@/lib/server/github/data";
import type { GatePolicy } from "@/lib/server/github/types";

const lines = (value: string) => value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

export async function saveRepositoryPolicy(_previous: ActionResult, form: FormData): Promise<ActionResult> {
  const ctx = await requireCtx();
  try {
    requireAdmin(ctx);
    const requiredChecks = lines(field(form, "requiredChecks")).map((entry) => {
      const parts = entry.split("|").map((s) => s.trim());
      if (parts.length !== 2 || !parts[0] || !/^\d+$/.test(parts[1])) throw new Error("check_format");
      return { name: parts[0], appId: Number(parts[1]) };
    });
    await savePolicy(ctx, field(form, "repositoryId"), {
      mode: field(form, "mode") as GatePolicy["mode"],
      maxChangedLines: Number(field(form, "maxChangedLines")),
      maxChangedFiles: Number(field(form, "maxChangedFiles")),
      protectedPaths: lines(field(form, "protectedPaths")),
      allowedPaths: lines(field(form, "allowedPaths")),
      requiredChecks, reviewers: lines(field(form, "reviewers")),
      requireTests: form.get("requireTests") === "on", allowForks: form.get("allowForks") === "on",
      mergeMethod: field(form, "mergeMethod") as GatePolicy["mergeMethod"],
    });
  } catch (error) {
    if (error instanceof Error && error.message === "check_format") return { error: "Enter each required check as its exact name | numeric GitHub App ID." };
    return actionError(error, "Could not save the repository policy.");
  }
  revalidatePath("/app/github");
  return { ok: true, message: "Policy saved. Open pull requests are queued for evaluation." };
}

export async function reevaluatePull(_previous: ActionResult, form: FormData): Promise<ActionResult> {
  const ctx = await requireCtx();
  try {
    requireAdmin(ctx);
    await requeueEvaluation(ctx, field(form, "repositoryId"), Number(field(form, "pullNumber")));
  } catch (error) {
    return actionError(error, "Could not queue this pull request.");
  }
  revalidatePath("/app/github");
  return { ok: true, message: "Evaluation queued. Refresh shortly to see the result." };
}
