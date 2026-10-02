import "server-only";
import { cache } from "react";
import * as deployments from "@/lib/server/data/deployments";
import { DEPLOYMENT_ID_RE } from "@/lib/server/data/deployments";
import { ApiError } from "@/lib/server/errors";
import { requireCtx } from "./auth";
import type { DeployEvent, Deployment } from "./types";

// Console read API, backed by Postgres for the signed-in user's org.

/** Cap for the in-memory analytics the console pages run over the full history. */
const MAX_DEPLOYMENTS = 5000;

export function isValidId(id: string): boolean {
  return DEPLOYMENT_ID_RE.test(id);
}

/** All deployments of the current org, newest first. */
export const listDeployments = cache(async (): Promise<Deployment[]> => {
  const ctx = await requireCtx();
  return deployments.listDeployments(ctx, {}, { limit: MAX_DEPLOYMENTS });
});

/** A deployment by id or unique prefix; null when missing or ambiguous. */
export const getDeployment = cache(async (id: string): Promise<Deployment | null> => {
  const ctx = await requireCtx();
  try {
    return await deployments.getDeployment(ctx, id);
  } catch (e) {
    if (e instanceof ApiError && e.code === "ambiguous") return null;
    throw e;
  }
});

export const getEvents = cache(async (id: string): Promise<DeployEvent[]> => {
  const ctx = await requireCtx();
  return (await deployments.listEvents(ctx, id)) ?? [];
});

/** Events for many deployments at once, keyed by deployment id. */
export async function eventsFor(ids: string[]): Promise<Map<string, DeployEvent[]>> {
  const ctx = await requireCtx();
  return deployments.eventsFor(ctx, ids);
}
