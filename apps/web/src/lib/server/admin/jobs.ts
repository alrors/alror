import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { jobs, JOB_KINDS, orgs, type JobKind, type JobStatus } from "../db/schema";
import { conflict, notFound } from "../errors";
import { LEASE_SECONDS, toJob } from "../data/jobs";
import { publish, signalJob } from "../redis";
import { assertAdmin, type AdminCtx } from "./access";
import { recordAdminAction } from "./log";
import { isoTime, num, str, strOrNull, UUID_RE } from "./util";

/** Filter values for the system-wide queue; "stalled" is claimed with an expired lease. */
export const JOB_FILTERS = ["all", "queued", "claimed", "stalled", "done", "failed", "canceled"] as const;
export type JobFilter = (typeof JOB_FILTERS)[number];

const STALLED = sql.raw(`(j.status = 'claimed' and coalesce(j.heartbeat_at, j.claimed_at) < now() - interval '${LEASE_SECONDS} seconds')`);

export type AdminJobRow = {
  id: string;
  org_id: string;
  org: string;
  kind: JobKind;
  status: JobStatus;
  stalled: boolean;
  claimed_by: string | null;
  attempts: number;
  error: string | null;
  deployment_id: string | null;
  target: string;
  requested_by: string | null;
  created_at: string;
  claimed_at: string | null;
  heartbeat_at: string | null;
  finished_at: string | null;
};

export async function listJobsAdmin(
  admin: AdminCtx,
  opts: { filter?: JobFilter; orgId?: string; kind?: string; runner?: string; page: number; per: number },
): Promise<{ items: AdminJobRow[]; total: number; counts: Record<JobFilter, number> }> {
  assertAdmin(admin);
  const f = opts.filter ?? "all";
  const orgId = opts.orgId && UUID_RE.test(opts.orgId) ? opts.orgId : undefined;
  const kind = (JOB_KINDS as readonly string[]).includes(opts.kind ?? "") ? opts.kind : undefined;
  const runner = opts.runner?.trim().slice(0, 200) || undefined;
  const scope = sql`${orgId ? sql`and j.org_id = ${orgId}` : sql``} ${kind ? sql`and j.kind = ${kind}` : sql``} ${runner ? sql`and j.claimed_by = ${runner}` : sql``}`;
  const status =
    f === "all" ? sql`` : f === "stalled" ? sql`and ${STALLED}` : sql`and j.status = ${f}`;
  const offset = (Math.max(opts.page, 1) - 1) * opts.per;
  const [rows, [c]] = await Promise.all([
    db.execute<Record<string, unknown>>(sql`
      select j.*, o.slug, ${STALLED} as stalled, coalesce(u.email, k.name) as requested_by
      from jobs j
      join orgs o on o.id = j.org_id
      left join users u on u.id = j.requested_by_user
      left join api_keys k on k.id = j.requested_by_key
      where true ${scope} ${status}
      order by j.created_at desc, j.id
      limit ${opts.per} offset ${offset}`),
    db.execute<Record<string, unknown>>(sql`
      select count(*)::int as all,
        count(*) filter (where j.status = 'queued')::int as queued,
        count(*) filter (where j.status = 'claimed')::int as claimed,
        count(*) filter (where ${STALLED})::int as stalled,
        count(*) filter (where j.status = 'done')::int as done,
        count(*) filter (where j.status = 'failed')::int as failed,
        count(*) filter (where j.status = 'canceled')::int as canceled
      from jobs j where true ${scope}`),
  ]);
  const counts = Object.fromEntries(JOB_FILTERS.map((k) => [k, num(c?.[k])])) as Record<JobFilter, number>;
  return {
    counts,
    total: counts[f],
    items: rows.map((r) => {
      const payload = (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as Record<string, unknown>;
      const kindV = str(r.kind) as JobKind;
      return {
        id: str(r.id),
        org_id: str(r.org_id),
        org: str(r.slug),
        kind: kindV,
        status: str(r.status) as JobStatus,
        stalled: r.stalled === true || r.stalled === "t",
        claimed_by: strOrNull(r.claimed_by),
        attempts: num(r.attempts),
        error: strOrNull(r.error),
        deployment_id: strOrNull(r.deployment_id),
        target: kindV === "deploy" ? `${str(payload?.service)}@${str(payload?.image)}` : str(payload?.deployment_id),
        requested_by: strOrNull(r.requested_by),
        created_at: isoTime(r.created_at) ?? "",
        claimed_at: isoTime(r.claimed_at),
        heartbeat_at: isoTime(r.heartbeat_at),
        finished_at: isoTime(r.finished_at),
      };
    }),
  };
}

export type Runner = {
  name: string;
  orgs: string[];
  last_seen: string | null;
  active: number;
  stalled: number;
  done_7d: number;
  failed_7d: number;
  online: boolean;
};

/**
 * Runners as seen through job claims and heartbeats (there is no runner
 * registry): one row per `claimed_by` name active in the last 7 days.
 */
export async function listRunners(admin: AdminCtx): Promise<Runner[]> {
  assertAdmin(admin);
  const rows = await db.execute<Record<string, unknown>>(sql`
    select j.claimed_by as name,
      array_agg(distinct o.slug) as orgs,
      max(greatest(j.heartbeat_at, j.claimed_at, j.finished_at)) as last_seen,
      count(*) filter (where j.status = 'claimed' and not ${STALLED})::int as active,
      count(*) filter (where ${STALLED})::int as stalled,
      count(*) filter (where j.status = 'done' and j.finished_at > now() - interval '7 days')::int as done_7d,
      count(*) filter (where j.status = 'failed' and j.finished_at > now() - interval '7 days')::int as failed_7d,
      bool_or(greatest(j.heartbeat_at, j.claimed_at, j.finished_at) > now() - interval '5 minutes') as online
    from jobs j join orgs o on o.id = j.org_id
    where j.claimed_by is not null and greatest(j.heartbeat_at, j.claimed_at, j.finished_at) > now() - interval '7 days'
    group by j.claimed_by
    order by max(greatest(j.heartbeat_at, j.claimed_at, j.finished_at)) desc nulls last
    limit 100`);
  return rows.map((r) => ({
    name: str(r.name),
    orgs: Array.isArray(r.orgs) ? (r.orgs as string[]) : str(r.orgs).replace(/^\{|\}$/g, "").split(",").filter(Boolean),
    last_seen: isoTime(r.last_seen),
    active: num(r.active),
    stalled: num(r.stalled),
    done_7d: num(r.done_7d),
    failed_7d: num(r.failed_7d),
    online: r.online === true || r.online === "t",
  }));
}

async function mustJob(id: string) {
  if (!UUID_RE.test(id)) throw notFound("Job not found.");
  const [r] = await db.select({ j: jobs, slug: orgs.slug }).from(jobs).innerJoin(orgs, eq(orgs.id, jobs.orgId)).where(eq(jobs.id, id)).limit(1);
  if (!r) throw notFound("Job not found.");
  return r;
}

/**
 * Cancels a queued or claimed job. A runner holding a claimed job gets 409 on
 * its next heartbeat or finish and stops working on it.
 */
export async function cancelJobAdmin(admin: AdminCtx, id: string): Promise<{ id: string; org: string }> {
  assertAdmin(admin);
  const { j, slug } = await mustJob(id);
  const [row] = await db
    .update(jobs)
    .set({ status: "canceled", finishedAt: new Date() })
    .where(and(eq(jobs.id, id), sql`${jobs.status} in ('queued', 'claimed')`))
    .returning();
  if (!row) throw conflict(`Job ${id.slice(0, 8)} is ${j.status}; only queued or claimed jobs can be canceled.`);
  await recordAdminAction(admin, {
    action: "admin.job.cancel",
    target: id,
    orgs: [{ id: j.orgId, slug }],
    meta: { kind: j.kind, from: j.status, claimed_by: j.claimedBy },
  });
  await publish(j.orgId, { type: "job.updated", job: toJob(row) });
  return { id, org: slug };
}

/**
 * Puts a failed, canceled or stalled job back in the queue (claim cleared,
 * attempts kept) and wakes the org's runners.
 */
export async function requeueJobAdmin(admin: AdminCtx, id: string): Promise<{ id: string; org: string }> {
  assertAdmin(admin);
  const { j, slug } = await mustJob(id);
  const [row] = await db
    .update(jobs)
    .set({ status: "queued", claimedBy: null, claimedByKey: null, claimedAt: null, heartbeatAt: null, finishedAt: null, error: null })
    .where(
      and(
        eq(jobs.id, id),
        sql`(${jobs.status} in ('failed', 'canceled') or (${jobs.status} = 'claimed' and coalesce(${jobs.heartbeatAt}, ${jobs.claimedAt}) < now() - make_interval(secs => ${LEASE_SECONDS})))`,
      ),
    )
    .returning();
  if (!row) throw conflict(`Job ${id.slice(0, 8)} is ${j.status}; only failed, canceled or stalled jobs can be requeued.`);
  await recordAdminAction(admin, {
    action: "admin.job.requeue",
    target: id,
    orgs: [{ id: j.orgId, slug }],
    meta: { kind: j.kind, from: j.status, attempts: j.attempts, error: j.error },
  });
  await signalJob(j.orgId, id);
  await publish(j.orgId, { type: "job.updated", job: toJob(row) });
  return { id, org: slug };
}
