import "server-only";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { requireScope, type OrgCtx } from "../context";
import { db } from "../db";
import { apiKeys, jobs, users, type JobKind, type JobStatus } from "../db/schema";
import { ApiError, conflict, invalid, notFound } from "../errors";
import { blockingConnection, jobsKey, publish, signalJob } from "../redis";
import { writeAudit } from "./audit";
import { mustGetDeployment } from "./deployments";
import { getEnvironment } from "./environments";
import { getService } from "./services";

/** A claimed job whose last heartbeat is older than this can be claimed by another runner. */
export const LEASE_SECONDS = 120;

export type Job = {
  id: string;
  kind: JobKind;
  payload: Record<string, unknown>;
  status: JobStatus;
  claimed_by: string | null;
  deployment_id: string | null;
  error: string | null;
  created_at: string;
  claimed_at: string | null;
  finished_at: string | null;
  heartbeat_at: string | null;
  attempts: number;
};

type Row = typeof jobs.$inferSelect;

export function toJob(r: Row): Job {
  return {
    id: r.id,
    kind: r.kind,
    payload: r.payload,
    status: r.status,
    claimed_by: r.claimedBy,
    deployment_id: r.deploymentId,
    error: r.error,
    created_at: r.createdAt.toISOString(),
    claimed_at: r.claimedAt?.toISOString() ?? null,
    finished_at: r.finishedAt?.toISOString() ?? null,
    heartbeat_at: r.heartbeatAt?.toISOString() ?? null,
    attempts: r.attempts,
  };
}

export type DeployPayload = {
  service: string;
  image: string;
  ref?: string;
  environment?: string;
  shadow?: boolean;
  /** A level ("low" | "medium" | "high") or a 0-100 score (number or numeric string). Stored as sent. */
  risk_override?: string | number;
};
export type RollbackPayload = { deployment_id: string; reason?: string };
export type JobRequest = { kind: "deploy"; payload: DeployPayload } | { kind: "rollback"; payload: RollbackPayload };

/** Validates and queues a job, signals waiting runners and publishes job.updated. */
export async function enqueueJob(ctx: OrgCtx, req: JobRequest): Promise<Job> {
  let payload: Record<string, unknown>;
  let deploymentId: string | null = null;
  let target: string;

  if (req.kind === "deploy") {
    const p = req.payload;
    const svc = await getService(ctx, p.service);
    if (!svc || svc.archived_at) throw new ApiError(422, "unknown_service", `Unknown service "${p.service}".`);
    const environment = p.environment || "production";
    if (!(await getEnvironment(ctx, environment))) throw new ApiError(422, "unknown_environment", `Unknown environment "${environment}".`);
    const ro = p.risk_override;
    if (ro !== undefined && ro !== "") {
      const ok = ["low", "medium", "high"].includes(String(ro)) || (/^\d{1,3}$/.test(String(ro)) && Number(ro) <= 100);
      if (!ok) throw invalid('risk_override must be "low", "medium", "high" or a score from 0 to 100.');
    }
    payload = { ...p, environment };
    target = `${p.service}@${p.image}`;
  } else {
    const d = await mustGetDeployment(ctx, req.payload.deployment_id);
    if (d.status === "rolled_back" || d.status === "failed") throw conflict(`Deployment ${d.id} is already ${d.status.replace("_", " ")}.`);
    deploymentId = d.id;
    payload = { deployment_id: d.id, reason: req.payload.reason || "rolled back from console" };
    target = d.id;
  }

  const [row] = await db
    .insert(jobs)
    .values({
      orgId: ctx.orgId,
      kind: req.kind,
      payload,
      deploymentId,
      requestedByUser: ctx.actor.userId ?? null,
      requestedByKey: ctx.actor.keyId ?? null,
    })
    .returning();
  const job = toJob(row);
  await writeAudit(ctx, req.kind === "rollback" ? "deployment.rollback" : "deployment.deploy", target, { job_id: job.id, ...payload });
  await signalJob(ctx.orgId, job.id);
  await publish(ctx.orgId, { type: "job.updated", job });
  return job;
}

/**
 * One non-blocking claim attempt: the oldest job that is queued, or claimed
 * with an expired lease (no heartbeat for LEASE_SECONDS), skipping rows other
 * runners hold. Sets the lease, bumps attempts and records the claimer.
 */
export async function claimJob(ctx: OrgCtx, runner: string): Promise<Job | null> {
  const rows = await db.execute<{ id: string }>(sql`
    update ${jobs}
    set status = 'claimed', claimed_by = ${runner}, claimed_by_key = ${ctx.actor.keyId ?? null},
        claimed_at = now(), heartbeat_at = now(), attempts = attempts + 1
    where id = (
      select id from ${jobs}
      where org_id = ${ctx.orgId}
        and (status = 'queued'
          or (status = 'claimed' and coalesce(heartbeat_at, claimed_at) < now() - make_interval(secs => ${LEASE_SECONDS})))
      order by created_at, id
      limit 1
      for update skip locked
    )
    returning id`);
  const id = rows[0]?.id;
  if (!id) return null;
  const [row] = await db.select().from(jobs).where(and(eq(jobs.orgId, ctx.orgId), eq(jobs.id, id)));
  const job = toJob(row);
  if (job.attempts > 1) await writeAudit(ctx, "job.reclaim", job.id, { runner, attempts: job.attempts });
  await publish(ctx.orgId, { type: "job.updated", job });
  return job;
}

const POLL_SLICE_SECONDS = 5;

/**
 * Long-poll claim. Tries the table, then blocks on Redis BRPOP jobs:<orgId> in
 * short slices (each slice ends with a table poll, so a lost signal or an
 * expired lease costs at most one slice). Returns null after `timeoutMs` or
 * when `signal` aborts.
 */
export async function claimJobLongPoll(ctx: OrgCtx, runner: string, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<Job | null> {
  const deadline = Date.now() + Math.min(Math.max(opts.timeoutMs ?? 25_000, 0), 60_000);
  const first = await claimJob(ctx, runner);
  if (first || Date.now() >= deadline) return first;

  const conn = blockingConnection();
  const abort = () => conn.disconnect();
  opts.signal?.addEventListener("abort", abort, { once: true });
  try {
    while (!opts.signal?.aborted) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const slice = Math.max(1, Math.min(POLL_SLICE_SECONDS, Math.ceil(remaining / 1000)));
      try {
        await conn.brpop(jobsKey(ctx.orgId), slice);
      } catch {
        // connection dropped (abort or Redis down): fall back to polling the table
        if (opts.signal?.aborted) break;
        await new Promise((r) => setTimeout(r, Math.min(1000, remaining)));
      }
      const job = await claimJob(ctx, runner);
      if (job) return job;
    }
    return null;
  } finally {
    opts.signal?.removeEventListener("abort", abort);
    conn.disconnect();
  }
}

export async function getJob(ctx: OrgCtx, id: string): Promise<Job | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db.select().from(jobs).where(and(eq(jobs.orgId, ctx.orgId), eq(jobs.id, id)));
  return row ? toJob(row) : null;
}

/**
 * Whether the caller is the current claimer: by runner name when one is sent,
 * otherwise by API key (runners sharing a key are then indistinguishable).
 */
function claimerFilter(ctx: OrgCtx, runner: string | undefined) {
  if (runner) return eq(jobs.claimedBy, runner);
  if (ctx.actor.keyId) return sql`${jobs.claimedByKey} is not distinct from ${ctx.actor.keyId}`;
  return undefined;
}

/** Extends the lease of a claimed job. 409 when it is no longer claimed by the caller. */
export async function heartbeatJob(ctx: OrgCtx, id: string, runner?: string): Promise<Job> {
  const current = await getJob(ctx, id);
  if (!current) throw notFound(`Job ${id} not found.`);
  const [row] = await db
    .update(jobs)
    .set({ heartbeatAt: sql`now()` })
    .where(and(eq(jobs.orgId, ctx.orgId), eq(jobs.id, id), eq(jobs.status, "claimed"), claimerFilter(ctx, runner)))
    .returning();
  if (!row) {
    throw new ApiError(
      409,
      "conflict",
      current.status === "claimed" ? `Job ${id} was claimed by ${current.claimed_by ?? "another runner"}; stop working on it.` : `Job ${id} is ${current.status}, not claimed.`,
    );
  }
  return toJob(row);
}

/**
 * Marks a claimed job done or failed (only by its current claimer). Repeating
 * a finish with the same status is idempotent. Publishes job.updated.
 */
export async function finishJob(
  ctx: OrgCtx,
  id: string,
  result: { status: "done" | "failed"; error?: string; deployment_id?: string; runner?: string },
): Promise<Job> {
  const current = await getJob(ctx, id);
  if (!current) throw notFound(`Job ${id} not found.`);
  if (current.finished_at && current.status === result.status) return current; // retried finish
  if (current.status !== "claimed") throw conflict(`Job ${id} is ${current.status}, not claimed.`);
  const [row] = await db
    .update(jobs)
    .set({
      status: result.status,
      finishedAt: new Date(),
      error: result.error || null,
      ...(result.deployment_id ? { deploymentId: result.deployment_id } : {}),
    })
    .where(and(eq(jobs.orgId, ctx.orgId), eq(jobs.id, id), eq(jobs.status, "claimed"), claimerFilter(ctx, result.runner)))
    .returning();
  if (!row) throw conflict(`Job ${id} is now claimed by ${current.claimed_by ?? "another runner"}; this runner's lease expired.`);
  const job = toJob(row);
  if (job.status === "failed") await writeAudit(ctx, "job.failed", job.id, { kind: job.kind, error: job.error });
  await publish(ctx.orgId, { type: "job.updated", job });
  return job;
}

/** Cancels a queued job. */
export async function cancelJob(ctx: OrgCtx, id: string): Promise<Job> {
  requireScope(ctx, "deploy:write");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound(`Job ${id} not found.`);
  const [row] = await db
    .update(jobs)
    .set({ status: "canceled", finishedAt: new Date() })
    .where(and(eq(jobs.orgId, ctx.orgId), eq(jobs.id, id), eq(jobs.status, "queued")))
    .returning();
  if (!row) throw conflict(`Job ${id} is not queued.`);
  const job = toJob(row);
  await writeAudit(ctx, "job.cancel", job.id);
  await publish(ctx.orgId, { type: "job.updated", job });
  return job;
}

export async function listJobs(ctx: OrgCtx, opts: { status?: JobStatus | JobStatus[]; deploymentId?: string; limit?: number } = {}): Promise<Job[]> {
  const statuses = opts.status === undefined ? [] : Array.isArray(opts.status) ? opts.status : [opts.status];
  const rows = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.orgId, ctx.orgId),
        statuses.length ? inArray(jobs.status, statuses) : undefined,
        opts.deploymentId ? eq(jobs.deploymentId, opts.deploymentId) : undefined,
      ),
    )
    .orderBy(desc(jobs.createdAt))
    .limit(Math.min(Math.max(opts.limit ?? 100, 1), 500));
  return rows.map(toJob);
}

// ---------- Console views ----------

/** A job plus who asked for it (user email or key name), for the console. */
export type JobView = Job & { requested_by: string | null };

const requester = sql<string | null>`coalesce(${users.email}, ${apiKeys.name})`;

async function jobViews(where: SQL | undefined, limit: number, offset = 0): Promise<JobView[]> {
  const rows = await db
    .select({ j: jobs, by: requester })
    .from(jobs)
    .leftJoin(users, eq(users.id, jobs.requestedByUser))
    .leftJoin(apiKeys, eq(apiKeys.id, jobs.requestedByKey))
    .where(where)
    .orderBy(desc(jobs.createdAt), desc(jobs.id))
    .limit(limit)
    .offset(offset);
  return rows.map((r) => ({ ...toJob(r.j), requested_by: r.by }));
}

/** One page of the org's jobs (newest first) plus per-status counts, for /app/jobs. */
export async function pageJobs(
  ctx: OrgCtx,
  opts: { status?: JobStatus; page: number; per: number },
): Promise<{ items: JobView[]; total: number; counts: Record<JobStatus | "all", number> }> {
  const filter = and(eq(jobs.orgId, ctx.orgId), opts.status ? eq(jobs.status, opts.status) : undefined);
  const [items, countRows] = await Promise.all([
    jobViews(filter, opts.per, (Math.max(opts.page, 1) - 1) * opts.per),
    db.select({ status: jobs.status, n: sql<number>`count(*)::int` }).from(jobs).where(eq(jobs.orgId, ctx.orgId)).groupBy(jobs.status),
  ]);
  const counts: Record<JobStatus | "all", number> = { all: 0, queued: 0, claimed: 0, done: 0, failed: 0, canceled: 0 };
  for (const r of countRows) {
    counts[r.status] = r.n;
    counts.all += r.n;
  }
  return { items, total: opts.status ? counts[opts.status] : counts.all, counts };
}

/** Recent jobs for one service: deploy jobs naming it and jobs tied to its deployments. */
export async function jobsForService(ctx: OrgCtx, service: string, limit = 8): Promise<JobView[]> {
  return jobViews(
    and(
      eq(jobs.orgId, ctx.orgId),
      sql`(${jobs.payload}->>'service' = ${service} or ${jobs.deploymentId} in (select d.id from deployments d where d.org_id = ${ctx.orgId} and d.service = ${service}))`,
    ),
    limit,
  );
}

/** Jobs tied to one deployment (rollbacks, and the deploy job that created it). */
export async function jobsForDeployment(ctx: OrgCtx, deploymentId: string, limit = 20): Promise<JobView[]> {
  return jobViews(and(eq(jobs.orgId, ctx.orgId), eq(jobs.deploymentId, deploymentId)), limit);
}
