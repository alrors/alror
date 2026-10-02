import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { githubDecisions, githubDeliveries, githubRepositories } from "../db/schema";
import { systemActor } from "../context";
import { writeAudit } from "../data/audit";
import { env } from "../env";
import { publish } from "../redis";
import { clearInstallationTokens, GitHubError, installationClient, repoPath } from "./client";
import { appConfig, configStatus } from "./config";
import { evaluatePull } from "./evaluate";
import { decisionPath } from "./report";
import { normalizePolicy } from "./policy";
import { assertLease, claimDelivery, completeDelivery, failDelivery, heartbeatDelivery, type Delivery } from "./queue";
import type { PullSnapshot } from "./types";

export async function processDelivery(delivery: Delivery): Promise<void> {
  const installationId = delivery.installationId;
  if (!installationId) return;
  if (delivery.event === "installation" && ["deleted", "suspend"].includes(String(delivery.payload.action))) {
    clearInstallationTokens(installationId);
    const rows = await db.update(githubRepositories).set({ enabled: false, updatedAt: new Date() }).where(eq(githubRepositories.installationId, installationId)).returning();
    for (const repository of rows) await writeAudit({ orgId: repository.orgId, actor: systemActor() }, "github.installation_disabled", repository.fullName, { action: delivery.payload.action });
    return;
  }
  if (delivery.event === "installation_repositories") {
    const removed = Array.isArray(delivery.payload.repositories_removed) ? delivery.payload.repositories_removed as { id: number }[] : [];
    if (removed.length) {
      clearInstallationTokens(installationId);
      const rows = await db.update(githubRepositories).set({ enabled: false, updatedAt: new Date() }).where(and(eq(githubRepositories.installationId, installationId), inArray(githubRepositories.id, removed.map((r) => String(r.id))))).returning();
      for (const repository of rows) await writeAudit({ orgId: repository.orgId, actor: systemActor() }, "github.repository_access_removed", repository.fullName);
    }
    return;
  }
  if (!delivery.repositoryId) return;
  const [repository] = await db.select().from(githubRepositories).where(and(eq(githubRepositories.id, delivery.repositoryId), eq(githubRepositories.installationId, installationId), eq(githubRepositories.enabled, true)));
  if (!repository) return;
  const { appId } = appConfig();
  const originCheck = (delivery.payload.check_run || delivery.payload.check_suite) as { app?: { id?: number } } | undefined;
  if (originCheck?.app?.id === Number(appId)) return;
  const client = await installationClient(installationId, repository.id);
  const policy = normalizePolicy(repository.policy);
  const rawNumber = delivery.event === "evaluate" ? delivery.payload.pullNumber : (delivery.payload.pull_request as { number?: number } | undefined)?.number;
  let pulls: number[];
  if (Number.isSafeInteger(rawNumber) && Number(rawNumber) > 0) pulls = [Number(rawNumber)];
  else {
    const open = await client.pages<PullSnapshot>(`${repoPath(repository.fullName)}/pulls?state=open`, undefined, 10);
    const sha = delivery.event === "status" ? delivery.payload.sha : (delivery.payload.check_run as { head_sha?: string } | undefined)?.head_sha || (delivery.payload.check_suite as { head_sha?: string } | undefined)?.head_sha;
    pulls = open.filter((p) => !sha || p.head.sha === sha).map((p) => p.number);
  }
  const ctx = { orgId: repository.orgId, actor: systemActor() };
  const beforeEffect = async () => {
    await assertLease(delivery);
    const [current] = await db.select().from(githubRepositories).where(and(eq(githubRepositories.id, repository.id), eq(githubRepositories.orgId, repository.orgId), eq(githubRepositories.installationId, installationId), eq(githubRepositories.enabled, true)));
    if (!current || current.policyVersion !== repository.policyVersion) throw new Error("Repository access or policy changed during evaluation.");
  };
  for (const pullNumber of pulls) {
    await beforeEffect();
    const evaluation = await evaluatePull(client, { repositoryId: repository.id, fullName: repository.fullName, pullNumber, policy, policyVersion: repository.policyVersion,
      appId: Number(appId), appSlug: configStatus().appSlug, detailsUrl: `${env.publicUrl().replace(/\/$/, "")}${decisionPath(repository.id, pullNumber)}` }, {
      beforeEffect,
      audit: (action, meta) => writeAudit(ctx, action, `${repository.fullName}#${pullNumber}`, meta),
      save: async ({ pull, result, checkId, commentId }) => {
        await beforeEffect();
        const values = { orgId: repository.orgId, repositoryId: repository.id, pullNumber, title: pull.title.slice(0, 500), url: pull.html_url,
          headSha: pull.head.sha, baseSha: pull.base.sha, policyVersion: repository.policyVersion, mode: policy.mode,
          outcome: pull.merged || result.reasons.some((r) => r.startsWith("Merged evaluated commit")) ? "merged" : result.outcome,
          score: result.score, reasons: result.reasons, ...(checkId ? { checkId } : {}), ...(commentId ? { commentId } : {}), updatedAt: new Date() };
        await db.insert(githubDecisions).values(values).onConflictDoUpdate({ target: [githubDecisions.repositoryId, githubDecisions.pullNumber, githubDecisions.headSha, githubDecisions.baseSha, githubDecisions.policyVersion], set: values });
        await publish(repository.orgId, { type: "github.decision.updated", repository_id: repository.id, pull_number: pullNumber });
      },
    });
    await writeAudit(ctx, "github.pull_evaluated", `${repository.fullName}#${pullNumber}`, { head_sha: evaluation.pull.head.sha, policy_version: repository.policyVersion, outcome: evaluation.result.outcome, score: evaluation.result.score });
    // GitHub mergeability settles asynchronously without a guaranteed follow-up event.
    const poll = Number(delivery.payload.poll || 0);
    if (evaluation.result.outcome === "waiting" && poll < 5) await db.insert(githubDeliveries).values({ id: `poll:${randomUUID()}`, event: "evaluate", installationId, repositoryId: repository.id, payload: { pullNumber, poll: poll + 1 }, availableAt: new Date(Date.now() + 30_000) });
  }
}

/** Process one durable delivery. Return false when idle. Errors are recorded, never expose tokens or payloads. */
export async function runWorkerOnce(): Promise<boolean> {
  const delivery = await claimDelivery();
  if (!delivery) return false;
  const timer = setInterval(() => { void heartbeatDelivery(delivery).catch(() => {}); }, 30_000);
  try { await processDelivery(delivery); await completeDelivery(delivery); }
  catch (error) {
    const message = error instanceof GitHubError ? error.message : error instanceof Error ? error.message : "GitHub evaluation failed.";
    await failDelivery(delivery, message, error instanceof GitHubError ? error.retryAfter : 0);
    console.error(`[alror:github] delivery ${delivery.id} failed: ${message}`);
  } finally { clearInterval(timer); }
  return true;
}
