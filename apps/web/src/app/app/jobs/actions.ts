"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/console/auth";
import { requireScope } from "@/lib/server/context";
import { enqueueJob, getJob, type DeployPayload } from "@/lib/server/data/jobs";
import { ApiError } from "@/lib/server/errors";

export type RetryState = { ok?: boolean; error?: string; jobId?: string } | undefined;

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/** Queues a fresh copy of a failed or canceled job (same kind and payload). The original stays as history. */
export async function retryJob(_prev: RetryState, formData: FormData): Promise<RetryState> {
  const ctx = await requireCtx();
  try {
    requireScope(ctx, "deploy:write");
    const job = await getJob(ctx, String(formData.get("id") ?? ""));
    if (!job) return { error: "Job not found." };
    if (job.status !== "failed" && job.status !== "canceled") return { error: `Only failed or canceled jobs can be retried; this one is ${job.status}.` };
    const p = job.payload;
    let next;
    if (job.kind === "deploy") {
      const service = str(p.service);
      const image = str(p.image);
      if (!service || !image) return { error: "This job's payload has no service or image to retry." };
      const payload: DeployPayload = {
        service,
        image,
        ...(str(p.ref) ? { ref: str(p.ref) } : {}),
        ...(str(p.environment) ? { environment: str(p.environment) } : {}),
        ...(p.shadow === true ? { shadow: true } : {}),
        ...(typeof p.risk_override === "string" || typeof p.risk_override === "number" ? { risk_override: p.risk_override } : {}),
      };
      next = await enqueueJob(ctx, { kind: "deploy", payload });
    } else {
      const deploymentId = str(p.deployment_id) ?? job.deployment_id;
      if (!deploymentId) return { error: "This job's payload has no deployment to roll back." };
      next = await enqueueJob(ctx, { kind: "rollback", payload: { deployment_id: deploymentId, reason: str(p.reason) ?? "retried from console" } });
    }
    revalidatePath("/app", "layout");
    return { ok: true, jobId: next.id };
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    console.error("[alror console] retry failed:", (e as Error).message);
    return { error: "Could not queue the retry. Try again." };
  }
}
