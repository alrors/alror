"use server";

import { revalidatePath } from "next/cache";
import { actionError, field, type ActionResult } from "@/lib/console/action-result";
import { requireCtx } from "@/lib/server/auth/session";
import { TARGETS, type Target } from "@/lib/server/db/schema";
import type { OrgCtx } from "@/lib/server/context";
import { enabledTargets } from "@/lib/server/data/plugins";
import { archiveService, createService as newService, getService, updateService } from "@/lib/server/data/services";

// Service management (owners and admins; enforced by requireAdmin in the data layer).

export type ServiceResult = (ActionResult & { name?: string }) | undefined;

const MAX_PATHS = 50;

function readFields(formData: FormData): { error: string } | { target: Target; paths: string[]; cluster: string; namespace: string; critical: boolean } {
  const target = field(formData, "target") || "simulated";
  if (!(TARGETS as readonly string[]).includes(target)) return { error: "Target must be simulated, kubernetes or ecs." };
  const paths = [...new Set(field(formData, "paths").split(/[\n,]/).map((p) => p.trim()).filter(Boolean))];
  if (paths.length > MAX_PATHS) return { error: `At most ${MAX_PATHS} paths.` };
  if (paths.some((p) => p.length > 200)) return { error: "Paths are limited to 200 characters." };
  const cluster = field(formData, "cluster");
  const namespace = field(formData, "namespace");
  if (cluster.length > 120 || namespace.length > 120) return { error: "Cluster and namespace are limited to 120 characters." };
  if (target === "simulated" && (cluster || namespace)) return { error: "Simulated services have no cluster or namespace." };
  return { target: target as Target, paths, cluster, namespace, critical: formData.get("critical") === "on" };
}

/**
 * The console offers simulated plus the deploy targets enabled in the marketplace.
 * A service may keep the target it already has. (alror config push is not limited.)
 */
async function checkTarget(ctx: OrgCtx, target: Target, current?: Target): Promise<string | null> {
  if (target === "simulated" || target === current) return null;
  const enabled = await enabledTargets(ctx);
  if (enabled.some((t) => t.target === target)) return null;
  return `The ${target} target is not enabled. Install it from the Marketplace first.`;
}

export async function createService(_prev: ServiceResult, formData: FormData): Promise<ServiceResult> {
  const ctx = await requireCtx();
  const name = field(formData, "name");
  const f = readFields(formData);
  if ("error" in f) return f;
  const targetError = await checkTarget(ctx, f.target);
  if (targetError) return { error: targetError };
  try {
    const s = await newService(ctx, { name, ...f });
    revalidatePath("/app", "layout");
    return { ok: true, name: s.name };
  } catch (e) {
    return actionError(e, "Could not create the service.");
  }
}

export async function editService(_prev: ServiceResult, formData: FormData): Promise<ServiceResult> {
  const ctx = await requireCtx();
  const name = field(formData, "name");
  const f = readFields(formData);
  if ("error" in f) return f;
  try {
    const targetError = await checkTarget(ctx, f.target, (await getService(ctx, name))?.target);
    if (targetError) return { error: targetError };
    await updateService(ctx, name, f);
  } catch (e) {
    return actionError(e, "Could not save the service.");
  }
  revalidatePath("/app", "layout");
  return { ok: true, name, message: "Saved." };
}

export async function setArchived(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await requireCtx();
  const archived = field(formData, "archived") === "true";
  try {
    await archiveService(ctx, field(formData, "name"), archived);
  } catch (e) {
    return actionError(e, archived ? "Could not archive the service." : "Could not restore the service.");
  }
  revalidatePath("/app", "layout");
  return { ok: true, message: archived ? "Service archived." : "Service restored." };
}
