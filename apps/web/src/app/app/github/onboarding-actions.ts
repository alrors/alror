"use server";

import { actionError } from "@/lib/console/action-result";
import { requireCtx } from "@/lib/server/auth/session";
import { requireAdmin } from "@/lib/server/context";
import { detectServices, openSetupPullRequest } from "@/lib/server/onboarding/service";
import type { Proposal, ServiceEdit, SetupPullResult } from "@/lib/server/onboarding/types";

export type DetectResult = { proposal?: Proposal; error?: string };
export type SetupPullActionResult = { pull?: SetupPullResult; error?: string };

/** Owner/admin only: reads the repository through the GitHub App and proposes services. */
export async function detectRepositoryServices(repositoryId: string): Promise<DetectResult> {
  const ctx = await requireCtx();
  try {
    requireAdmin(ctx);
    return { proposal: await detectServices(ctx, String(repositoryId)) };
  } catch (error) {
    return { error: actionError(error, "Could not read the repository through the GitHub App.").error };
  }
}

/** Owner/admin only: opens or updates the alror/setup pull request with the edited services. */
export async function openRepositorySetupPull(repositoryId: string, edits: ServiceEdit[]): Promise<SetupPullActionResult> {
  const ctx = await requireCtx();
  try {
    requireAdmin(ctx);
    if (!Array.isArray(edits)) return { error: "No services were submitted." };
    return { pull: await openSetupPullRequest(ctx, String(repositoryId), edits) };
  } catch (error) {
    return { error: actionError(error, "Could not open the setup pull request.").error };
  }
}
