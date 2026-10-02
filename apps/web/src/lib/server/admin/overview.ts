import "server-only";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { LEASE_SECONDS } from "../data/jobs";
import { assertAdmin, type AdminCtx } from "./access";
import { isoTime as iso, num as n } from "./util";

/** Instance-wide numbers for /admin. Everything is computed from the tables on each request. */

export type AdminKpis = {
  orgs: number;
  users: number;
  active_keys: number;
  deploys_24h: number;
  deploys_7d: number;
  deploys_30d: number;
  /** rolled_back / finished deployments in the last 30 days, 0..1 */
  rollback_rate_30d: number;
  finished_30d: number;
  jobs_queued: number;
  jobs_claimed: number;
  jobs_stalled: number;
  jobs_failed_7d: number;
  runners_5m: number;
};

/** A claimed job whose last heartbeat (or claim) is older than the lease. */
export const STALLED_SQL = sql.raw(`(status = 'claimed' and coalesce(heartbeat_at, claimed_at) < now() - interval '${LEASE_SECONDS} seconds')`);
/** When a runner last showed signs of life on a job. */
export const SEEN_SQL = sql.raw(`greatest(heartbeat_at, claimed_at, case when claimed_by is not null then finished_at end)`);

export async function adminKpis(admin: AdminCtx): Promise<AdminKpis> {
  assertAdmin(admin);
  const [r] = await db.execute<Record<string, unknown>>(sql`
    select
      (select count(*) from orgs) as orgs,
      (select count(*) from users) as users,
      (select count(*) from api_keys where revoked_at is null) as active_keys,
      (select count(*) from deployments where created_at > now() - interval '24 hours') as d24,
      (select count(*) from deployments where created_at > now() - interval '7 days') as d7,
      (select count(*) from deployments where created_at > now() - interval '30 days') as d30,
      (select count(*) from deployments where created_at > now() - interval '30 days' and status = 'rolled_back') as rb30,
      (select count(*) from deployments where created_at > now() - interval '30 days' and status in ('promoted','rolled_back','failed')) as fin30,
      (select count(*) from jobs where status = 'queued') as queued,
      (select count(*) from jobs where status = 'claimed') as claimed,
      (select count(*) from jobs where ${STALLED_SQL}) as stalled,
      (select count(*) from jobs where status = 'failed' and coalesce(finished_at, created_at) > now() - interval '7 days') as failed7,
      (select count(distinct claimed_by) from jobs where claimed_by is not null and ${SEEN_SQL} > now() - interval '5 minutes') as runners
  `);
  const fin = n(r.fin30);
  return {
    orgs: n(r.orgs),
    users: n(r.users),
    active_keys: n(r.active_keys),
    deploys_24h: n(r.d24),
    deploys_7d: n(r.d7),
    deploys_30d: n(r.d30),
    rollback_rate_30d: fin ? n(r.rb30) / fin : 0,
    finished_30d: fin,
    jobs_queued: n(r.queued),
    jobs_claimed: n(r.claimed),
    jobs_stalled: n(r.stalled),
    jobs_failed_7d: n(r.failed7),
    runners_5m: n(r.runners),
  };
}

export type DayCount = { day: string; total: number; promoted: number; bad: number; other: number };

/** Deployments per UTC day across every org, oldest first, with empty days filled in. */
export async function instanceActivity(admin: AdminCtx, days = 30): Promise<DayCount[]> {
  assertAdmin(admin);
  const rows = await db.execute<{ day: string; total: number; promoted: number; bad: number }>(sql`
    select to_char(d.day, 'YYYY-MM-DD') as day,
      count(x.id)::int as total,
      count(x.id) filter (where x.status = 'promoted')::int as promoted,
      count(x.id) filter (where x.status in ('rolled_back','failed'))::int as bad
    from generate_series(date_trunc('day', now() at time zone 'utc') - make_interval(days => ${days - 1}),
                         date_trunc('day', now() at time zone 'utc'), interval '1 day') as d(day)
    left join deployments x on (x.created_at at time zone 'utc') >= d.day and (x.created_at at time zone 'utc') < d.day + interval '1 day'
    group by d.day order by d.day`);
  return rows.map((r) => ({ day: r.day, total: r.total, promoted: r.promoted, bad: r.bad, other: r.total - r.promoted - r.bad }));
}

export type StalledJob = { id: string; org_id: string; org: string; kind: string; claimed_by: string | null; heartbeat_at: string | null; attempts: number };
export type RiskyOrg = { id: string; slug: string; name: string; finished: number; rolled_back: number; rate: number };
export type FailedJob = { id: string; org_id: string; org: string; kind: string; error: string | null; finished_at: string | null };

/** Things an operator should look at: stalled jobs, orgs rolling back a lot, recent failed jobs. */
export async function needsAttention(admin: AdminCtx): Promise<{ stalled: StalledJob[]; risky: RiskyOrg[]; failed: FailedJob[] }> {
  assertAdmin(admin);
  const [stalled, risky, failed] = await Promise.all([
    db.execute<Record<string, unknown>>(sql`
      select j.id, j.org_id, o.slug, j.kind, j.claimed_by, coalesce(j.heartbeat_at, j.claimed_at) as hb, j.attempts
      from jobs j join orgs o on o.id = j.org_id
      where ${sql.raw("j.status = 'claimed' and coalesce(j.heartbeat_at, j.claimed_at) < now() - interval '" + LEASE_SECONDS + " seconds'")}
      order by hb asc limit 8`),
    db.execute<Record<string, unknown>>(sql`
      select o.id, o.slug, o.name,
        count(*) filter (where d.status in ('promoted','rolled_back','failed'))::int as finished,
        count(*) filter (where d.status = 'rolled_back')::int as rolled_back
      from deployments d join orgs o on o.id = d.org_id
      where d.created_at > now() - interval '30 days'
      group by o.id
      having count(*) filter (where d.status in ('promoted','rolled_back','failed')) >= 5
        and count(*) filter (where d.status = 'rolled_back')::float / nullif(count(*) filter (where d.status in ('promoted','rolled_back','failed')), 0) >= 0.2
      order by count(*) filter (where d.status = 'rolled_back')::float / nullif(count(*) filter (where d.status in ('promoted','rolled_back','failed')), 0) desc
      limit 8`),
    db.execute<Record<string, unknown>>(sql`
      select j.id, j.org_id, o.slug, j.kind, j.error, j.finished_at
      from jobs j join orgs o on o.id = j.org_id
      where j.status = 'failed' and coalesce(j.finished_at, j.created_at) > now() - interval '7 days'
      order by coalesce(j.finished_at, j.created_at) desc limit 8`),
  ]);
  return {
    stalled: stalled.map((r) => ({
      id: String(r.id),
      org_id: String(r.org_id),
      org: String(r.slug),
      kind: String(r.kind),
      claimed_by: (r.claimed_by as string | null) ?? null,
      heartbeat_at: iso(r.hb),
      attempts: n(r.attempts),
    })),
    risky: risky.map((r) => ({
      id: String(r.id),
      slug: String(r.slug),
      name: String(r.name),
      finished: n(r.finished),
      rolled_back: n(r.rolled_back),
      rate: n(r.finished) ? n(r.rolled_back) / n(r.finished) : 0,
    })),
    failed: failed.map((r) => ({
      id: String(r.id),
      org_id: String(r.org_id),
      org: String(r.slug),
      kind: String(r.kind),
      error: (r.error as string | null) ?? null,
      finished_at: iso(r.finished_at),
    })),
  };
}

/** Stalled job count for the sidebar badge. */
export async function stalledCount(admin: AdminCtx): Promise<number> {
  assertAdmin(admin);
  const [r] = await db.execute<{ n: number }>(sql`select count(*)::int as n from jobs where ${STALLED_SQL}`);
  return n(r?.n);
}
