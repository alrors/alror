"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { logout as endSession, switchOrg as switchSessionOrg } from "@/lib/server/auth/accounts";
import { clearSessionCookie, currentSid, requireCtx, requireSession } from "@/lib/server/auth/session";
import { getEnvironment } from "@/lib/server/data/environments";
import { createFeedback } from "@/lib/server/data/feedback";
import { cancelJob as cancelQueuedJob, enqueueJob } from "@/lib/server/data/jobs";
import { markRead } from "@/lib/server/data/notifications";
import { searchConsole, type SearchResult } from "@/lib/server/data/search";
import { ENV_COOKIE } from "@/lib/console/prefs";
import { ApiError } from "@/lib/server/errors";
import { actionError } from "@/lib/console/action-result";
import { getDeployment, isValidId } from "@/lib/console/data";

export async function logout(): Promise<void> {
  await endSession(await currentSid());
  await clearSessionCookie();
  redirect("/login");
}

/** Points the current session at another org the user belongs to. */
export async function switchOrg(formData: FormData): Promise<void> {
  const session = await requireSession();
  const orgId = String(formData.get("org") ?? "");
  try {
    await switchSessionOrg(session.sid, session.user.id, orgId);
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
  }
  revalidatePath("/app", "layout");
  redirect("/app");
}

export type RollbackState = { ok?: boolean; error?: string; retryable?: boolean; jobId?: string } | undefined;

/** Queues a rollback job; an `alror runner` claims and executes it with the engine. */
export async function rollback(_prev: RollbackState, formData: FormData): Promise<RollbackState> {
  const ctx = await requireCtx();

  const id = String(formData.get("id") ?? "");
  if (!isValidId(id)) return { error: "Invalid deployment id." };

  const dep = await getDeployment(id);
  if (!dep) return { error: "Deployment not found." };
  if (dep.status === "rolled_back" || dep.status === "failed") {
    return { error: `Deployment is already ${dep.status.replace("_", " ")}.` };
  }

  try {
    const job = await enqueueJob(ctx, { kind: "rollback", payload: { deployment_id: dep.id, reason: "rolled back from console" } });
    revalidatePath(`/app/deployments/${dep.id}`);
    revalidatePath("/app", "layout");
    return { ok: true, jobId: job.id };
  } catch (e) {
    return actionError(e, "Could not queue the rollback. Try again.");
  }
}

export type DeployState = { ok?: boolean; error?: string; retryable?: boolean; jobId?: string } | undefined;

/**
 * Queues a deploy job (service, image, ref, environment, optional risk_override).
 * An `alror runner` claims it and copies `environment` onto the deployment.
 */
export async function deploy(_prev: DeployState, formData: FormData): Promise<DeployState> {
  const ctx = await requireCtx();
  const get = (k: string) => String(formData.get(k) ?? "").trim();
  const service = get("service");
  const image = get("image");
  if (!service || !image) return { error: "Choose a service and an image." };
  if (image.length > 512 || get("ref").length > 256) return { error: "The image or ref is too long." };
  const risk = get("risk_override");
  try {
    const job = await enqueueJob(ctx, {
      kind: "deploy",
      payload: {
        service,
        image,
        ...(get("ref") ? { ref: get("ref") } : {}),
        environment: get("environment") || "production",
        ...(risk ? { risk_override: risk } : {}),
        ...(formData.get("shadow") ? { shadow: true } : {}),
      },
    });
    revalidatePath("/app", "layout");
    return { ok: true, jobId: job.id };
  } catch (e) {
    return actionError(e, "Could not queue the deploy. Try again.");
  }
}

/** Cancels a queued job (members and above; the data layer checks deploy:write and the org). */
export async function cancelJob(_prev: DeployState, formData: FormData): Promise<DeployState> {
  const ctx = await requireCtx();
  try {
    await cancelQueuedJob(ctx, String(formData.get("id") ?? ""));
  } catch (e) {
    return actionError(e, "Could not cancel the job.");
  }
  revalidatePath("/app", "layout");
  return { ok: true };
}

/** Marks notifications read for the signed-in user (all visible ones when no ids are given). */
export async function markNotificationsRead(ids?: string[]): Promise<void> {
  const ctx = await requireCtx();
  const clean = ids?.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 200);
  await markRead(ctx, clean);
  revalidatePath("/app", "layout");
}

export type FeedbackState = { ok?: boolean; error?: string; retryable?: boolean } | undefined;

/** Stores feedback in the org's database (the feedback table). Nothing is sent to an external service. */
export async function sendFeedback(_prev: FeedbackState, formData: FormData): Promise<FeedbackState> {
  const ctx = await requireCtx();
  try {
    await createFeedback(ctx, { message: String(formData.get("message") ?? ""), page: String(formData.get("page") ?? "") });
    return { ok: true };
  } catch (e) {
    return actionError(e, "Could not send feedback. Try again.");
  }
}

/** Command palette search, scoped to the session's org. */
export async function search(query: string): Promise<SearchResult> {
  const ctx = await requireCtx();
  if (typeof query !== "string") return { services: [], deployments: [] };
  return searchConsole(ctx, query);
}

/** Picks the environment the console filters by ("" = all environments). */
export async function setEnvironment(name: string): Promise<void> {
  const ctx = await requireCtx();
  const jar = await cookies();
  if (!name) {
    jar.delete(ENV_COOKIE);
  } else {
    if (typeof name !== "string" || !(await getEnvironment(ctx, name))) return;
    jar.set(ENV_COOKIE, name, { path: "/", sameSite: "lax", httpOnly: false, maxAge: 60 * 60 * 24 * 365 });
  }
  revalidatePath("/app", "layout");
}
