import "server-only";
import { and, eq } from "drizzle-orm";
import { requireAdmin, type OrgCtx } from "../context";
import { db } from "../db";
import { githubRepositories } from "../db/schema";
import { writeAudit } from "../data/audit";
import { notFound } from "../errors";
import { appJwt, GitHubClient, GitHubError, installationClient } from "../github/client";
import { appConfig } from "../github/config";
import { missingPermissions, OnboardingPermissionError, openSetupPull, readRepository, setupPullBody, type Requester } from "./github";
import { inferProposal } from "./infer";
import { buildSetupFiles } from "./render";
import type { Proposal, ServiceEdit, SetupPullResult } from "./types";

async function enrolledRepository(ctx: OrgCtx, repositoryId: string) {
  if (!/^\d+$/.test(repositoryId)) throw notFound("Repository not found in this workspace.");
  const [repository] = await db.select().from(githubRepositories)
    .where(and(eq(githubRepositories.orgId, ctx.orgId), eq(githubRepositories.id, repositoryId), eq(githubRepositories.enabled, true)));
  if (!repository) throw notFound("Enabled repository not found in this workspace.");
  return repository;
}

/** Permissions granted to the installation, read with the App JWT (the installation token cannot see them). */
async function installationPermissions(installationId: string): Promise<Record<string, string>> {
  const { appId, privateKey } = appConfig();
  const app = new GitHubClient(appJwt(appId, privateKey));
  const installation = await app.request<{ permissions?: Record<string, string> }>(`/app/installations/${installationId}`);
  return installation.permissions ?? {};
}

/** GitHub answers 403/404 when a token lacks a permission; say which ones instead of "HTTP 403". */
function explain(error: unknown, repository: string, write: boolean): never {
  if (error instanceof GitHubError && (error.status === 403 || error.status === 404)) {
    throw new OnboardingPermissionError(write
      ? ["Repository contents: Read and write", "Pull requests: Read and write"]
      : ["Repository contents: Read-only (or Read and write)"], repository);
  }
  throw error;
}

async function detect(client: Requester, fullName: string): Promise<Proposal> {
  try { return inferProposal(await readRepository(client, fullName)); } catch (e) { explain(e, fullName, false); }
}

/** Owner/admin only. Reads the repository through the GitHub App and returns the proposed services. */
export async function detectServices(ctx: OrgCtx, repositoryId: string): Promise<Proposal> {
  requireAdmin(ctx);
  const repository = await enrolledRepository(ctx, repositoryId);
  const client = await installationClient(repository.installationId, repository.id);
  const proposal = await detect(client, repository.fullName);
  await writeAudit(ctx, "github.onboarding_detected", repository.fullName, {
    services: proposal.services.map((s) => s.name.value),
    unknown: proposal.services.reduce((n, s) => n + [s.name, s.paths, s.namespace, s.cluster].filter((v) => v.confidence === "unknown").length, 0),
    existingConfig: proposal.existingConfig,
  });
  return proposal;
}

/**
 * Owner/admin only. Re-detects (so reasons come from the repository, not the browser),
 * applies the edits and opens or updates the onboarding pull request.
 */
export async function openSetupPullRequest(ctx: OrgCtx, repositoryId: string, edits: ServiceEdit[]): Promise<SetupPullResult> {
  requireAdmin(ctx);
  const repository = await enrolledRepository(ctx, repositoryId);
  const missing = missingPermissions(await installationPermissions(repository.installationId));
  if (missing.length) {
    await writeAudit(ctx, "github.onboarding_blocked", repository.fullName, { missing });
    throw new OnboardingPermissionError(missing, repository.fullName);
  }
  const client = await installationClient(repository.installationId, repository.id);
  const proposal = await detect(client, repository.fullName);
  const { services, yaml, explanation, unknowns } = buildSetupFiles(proposal, edits, ctx.actor.label);
  let result: SetupPullResult;
  try {
    result = await openSetupPull(client, repository.fullName, [{ path: "alror.yaml", content: yaml }, { path: "ALROR.md", content: explanation }],
      setupPullBody(repository.fullName, services.map((s) => s.name.value), unknowns, ctx.actor.label));
  } catch (e) { explain(e, repository.fullName, true); }
  await writeAudit(ctx, result.created ? "github.onboarding_pr_opened" : "github.onboarding_pr_updated", `${repository.fullName}#${result.number}`, {
    url: result.url, changed: result.changed, services: services.map((s) => s.name.value), unknowns,
  });
  return result;
}
