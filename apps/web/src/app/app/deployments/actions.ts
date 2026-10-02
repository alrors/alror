"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/console/auth";
import { getDeployment, isValidId } from "@/lib/console/data";
import { plansFromStored, type Plans } from "@/lib/console/policy-rules";
import { requireScope } from "@/lib/server/context";
import { enqueueJob } from "@/lib/server/data/jobs";
import { getPolicy } from "@/lib/server/data/policy";
import { ApiError } from "@/lib/server/errors";

export type RedeployState = { ok?: boolean; error?: string; jobId?: string } | undefined;

/** Queues a deploy job for the same service, image, ref and environment as an existing deployment. */
export async function redeploy(_prev: RedeployState, formData: FormData): Promise<RedeployState> {
  const ctx = await requireCtx();
  const id = String(formData.get("id") ?? "");
  if (!isValidId(id)) return { error: "Invalid deployment id." };
  try {
    requireScope(ctx, "deploy:write");
    const dep = await getDeployment(id);
    if (!dep) return { error: "Deployment not found." };
    const job = await enqueueJob(ctx, {
      kind: "deploy",
      payload: {
        service: dep.service,
        image: dep.image,
        ...(dep.ref ? { ref: dep.ref } : {}),
        environment: dep.environment || "production",
      },
    });
    revalidatePath("/app", "layout");
    return { ok: true, jobId: job.id };
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    console.error("[alror console] redeploy enqueue failed:", (e as Error).message);
    return { error: "Could not queue the deploy. Try again." };
  }
}

/** The org's rollout plans (custom or built-in) and bake scale, for the deploy dialog preview. */
export async function rolloutPlans(): Promise<{ plans: Plans; bakeScale: number }> {
  const ctx = await requireCtx();
  const p = await getPolicy(ctx);
  return { plans: plansFromStored(p.plans), bakeScale: p.bake_scale || 1 };
}
