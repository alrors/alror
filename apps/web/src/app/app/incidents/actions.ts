"use server";

import { revalidatePath } from "next/cache";
import { actionError, field } from "@/lib/console/action-result";
import { requireCtx } from "@/lib/console/auth";
import { resolveIncident, rollbackFromIncident } from "@/lib/server/data/incidents";

export type IncidentRollbackState = { ok?: boolean; error?: string; retryable?: boolean; jobId?: string } | undefined;

/** Queues a rollback of one ranked candidate (members and above; the data layer checks deploy:write). */
export async function rollbackCandidate(_prev: IncidentRollbackState, formData: FormData): Promise<IncidentRollbackState> {
  const ctx = await requireCtx();
  const incident = field(formData, "incident");
  try {
    const job = await rollbackFromIncident(ctx, incident, field(formData, "deployment"));
    revalidatePath(`/app/incidents/${incident}`);
    revalidatePath("/app", "layout");
    return { ok: true, jobId: job.id };
  } catch (e) {
    return actionError(e, "Could not queue the rollback. Try again.");
  }
}

export type ResolveState = { ok?: boolean; error?: string; message?: string; retryable?: boolean } | undefined;

/** Marks an open incident resolved by hand. */
export async function resolveIncidentAction(_prev: ResolveState, formData: FormData): Promise<ResolveState> {
  const ctx = await requireCtx();
  const id = field(formData, "id");
  try {
    await resolveIncident(ctx, id);
  } catch (e) {
    return actionError(e, "Could not resolve the incident.");
  }
  revalidatePath(`/app/incidents/${id}`);
  revalidatePath("/app/incidents");
  return { ok: true, message: "Incident resolved." };
}
