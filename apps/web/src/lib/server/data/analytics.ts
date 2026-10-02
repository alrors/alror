import "server-only";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { OrgCtx } from "../context";
import { db } from "../db";
import { deploymentEvents, deployments, memberships, type Plan } from "../db/schema";
import { getOrg } from "./orgs";

// SQL aggregates over the org's deployments. Windows are UTC days ending today (inclusive).

const DAY = 864e5;

export type Window = { from: Date; to: Date; days: number };

/** The last `days` UTC days including today, plus the window right before it. */
export function windowFor(days: number, now = Date.now()): { current: Window; previous: Window } {
  const d = new Date(now);
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + DAY;
  const start = end - days * DAY;
  return {
    current: { from: new Date(start), to: new Date(end), days },
    previous: { from: new Date(start - days * DAY), to: new Date(start), days },
  };
}

const inWindow = (ctx: OrgCtx, w: Window) =>
  and(eq(deployments.orgId, ctx.orgId), gte(deployments.createdAt, w.from), lt(deployments.createdAt, w.to));

const bad = sql`${deployments.status} in ('rolled_back', 'failed')`;
const finished = sql`${deployments.status} in ('promoted', 'rolled_back', 'failed')`;
const score = sql`coalesce((${deployments.risk}->>'score')::int, 0)`;
const ai = sql`coalesce((${deployments.risk}->>'ai_authored')::boolean, false)`;

export type Kpis = {
  total: number;
  promoted: number;
  rolled_back: number;
  failed: number;
  in_flight: number;
  /** change failure rate over finished deployments, 0..1 */
  cfr: number;
  avg_risk: number;
  ai_share: number;
  /** median time from start to restore for bad deployments */
  mttr_ms: number | null;
  services: number;
};

async function kpisFor(ctx: OrgCtx, w: Window): Promise<Kpis> {
  const [r] = await db
    .select({
      total: sql<number>`count(*)::int`,
      promoted: sql<number>`count(*) filter (where ${deployments.status} = 'promoted')::int`,
      rolledBack: sql<number>`count(*) filter (where ${deployments.status} = 'rolled_back')::int`,
      failed: sql<number>`count(*) filter (where ${deployments.status} = 'failed')::int`,
      finished: sql<number>`count(*) filter (where ${finished})::int`,
      avgRisk: sql<number>`coalesce(avg(${score}), 0)::float8`,
      ai: sql<number>`count(*) filter (where ${ai})::int`,
      mttr: sql<number | null>`(percentile_cont(0.5) within group (order by extract(epoch from (${deployments.updatedAt} - ${deployments.createdAt})) * 1000) filter (where ${bad}))::float8`,
      services: sql<number>`count(distinct ${deployments.serviceId})::int`,
    })
    .from(deployments)
    .where(inWindow(ctx, w));
  const badN = r.rolledBack + r.failed;
  return {
    total: r.total,
    promoted: r.promoted,
    rolled_back: r.rolledBack,
    failed: r.failed,
    in_flight: r.total - r.finished,
    cfr: r.finished ? badN / r.finished : 0,
    avg_risk: Number(r.avgRisk),
    ai_share: r.total ? r.ai / r.total : 0,
    mttr_ms: r.mttr === null ? null : Number(r.mttr),
    services: r.services,
  };
}

/** KPIs for the window and the one before it, for deltas. */
export async function kpis(ctx: OrgCtx, days = 30, now = Date.now()): Promise<{ current: Kpis; previous: Kpis; window: Window }> {
  const w = windowFor(days, now);
  const [current, previous] = await Promise.all([kpisFor(ctx, w.current), kpisFor(ctx, w.previous)]);
  return { current, previous, window: w.current };
}

export type DayActivity = { day: string; total: number; promoted: number; bad: number; other: number; avg_risk: number };

/** One row per UTC day in the window (zero-filled). */
export async function dailyActivity(ctx: OrgCtx, days = 30, now = Date.now()): Promise<DayActivity[]> {
  const w = windowFor(days, now).current;
  const day = sql<string>`to_char(date_trunc('day', ${deployments.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`;
  const rows = await db
    .select({
      day,
      total: sql<number>`count(*)::int`,
      promoted: sql<number>`count(*) filter (where ${deployments.status} = 'promoted')::int`,
      bad: sql<number>`count(*) filter (where ${bad})::int`,
      avgRisk: sql<number>`coalesce(avg(${score}), 0)::float8`,
    })
    .from(deployments)
    .where(inWindow(ctx, w))
    .groupBy(day);
  const by = new Map(rows.map((r) => [r.day, r]));
  return Array.from({ length: days }, (_, i) => {
    const key = new Date(w.from.getTime() + i * DAY).toISOString().slice(0, 10);
    const r = by.get(key);
    return r
      ? { day: key, total: r.total, promoted: r.promoted, bad: r.bad, other: r.total - r.promoted - r.bad, avg_risk: Number(r.avgRisk) }
      : { day: key, total: 0, promoted: 0, bad: 0, other: 0, avg_risk: 0 };
  });
}

export type RiskBucket = { from: number; to: number; count: number; bad: number; level: "low" | "medium" | "high" };

/** Ten buckets of risk score (0-9 … 90-100), with the bad outcomes in each. */
export async function riskDistribution(ctx: OrgCtx, days = 30, now = Date.now()): Promise<RiskBucket[]> {
  const bucket = sql<number>`least(9, greatest(0, ${score} / 10))::int`;
  const rows = await db
    .select({ b: bucket, count: sql<number>`count(*)::int`, bad: sql<number>`count(*) filter (where ${bad})::int` })
    .from(deployments)
    .where(inWindow(ctx, windowFor(days, now).current))
    .groupBy(bucket);
  const by = new Map(rows.map((r) => [r.b, r]));
  return Array.from({ length: 10 }, (_, i) => ({
    from: i * 10,
    to: i * 10 + 9,
    count: by.get(i)?.count ?? 0,
    bad: by.get(i)?.bad ?? 0,
    level: i >= 7 ? "high" : i >= 3 ? "medium" : "low",
  }));
}

export type ServiceStat = {
  service: string;
  total: number;
  promoted: number;
  bad: number;
  in_flight: number;
  cfr: number;
  avg_risk: number;
  last_deploy_at: string | null;
  mttr_ms: number | null;
};

export async function perServiceStats(ctx: OrgCtx, days = 30, now = Date.now()): Promise<ServiceStat[]> {
  const rows = await db
    .select({
      service: deployments.service,
      total: sql<number>`count(*)::int`,
      promoted: sql<number>`count(*) filter (where ${deployments.status} = 'promoted')::int`,
      bad: sql<number>`count(*) filter (where ${bad})::int`,
      finished: sql<number>`count(*) filter (where ${finished})::int`,
      avgRisk: sql<number>`coalesce(avg(${score}), 0)::float8`,
      last: sql<Date | null>`max(${deployments.createdAt})`,
      mttr: sql<number | null>`(percentile_cont(0.5) within group (order by extract(epoch from (${deployments.updatedAt} - ${deployments.createdAt})) * 1000) filter (where ${bad}))::float8`,
    })
    .from(deployments)
    .where(inWindow(ctx, windowFor(days, now).current))
    .groupBy(deployments.service)
    .orderBy(sql`count(*) desc`);
  return rows.map((r) => ({
    service: r.service,
    total: r.total,
    promoted: r.promoted,
    bad: r.bad,
    in_flight: r.total - r.finished,
    cfr: r.finished ? r.bad / r.finished : 0,
    avg_risk: Number(r.avgRisk),
    last_deploy_at: r.last ? new Date(r.last).toISOString() : null,
    mttr_ms: r.mttr === null ? null : Number(r.mttr),
  }));
}

export type HeatCell = { dow: number; hour: number; count: number; bad: number };

/** Deploys by UTC weekday (0 = Sunday) and hour. Sparse: empty cells are omitted. */
export async function heatmap(ctx: OrgCtx, days = 30, now = Date.now()): Promise<HeatCell[]> {
  const dow = sql<number>`extract(dow from ${deployments.createdAt} at time zone 'UTC')::int`;
  const hour = sql<number>`extract(hour from ${deployments.createdAt} at time zone 'UTC')::int`;
  const rows = await db
    .select({ dow, hour, count: sql<number>`count(*)::int`, bad: sql<number>`count(*) filter (where ${bad})::int` })
    .from(deployments)
    .where(inWindow(ctx, windowFor(days, now).current))
    .groupBy(dow, hour);
  return rows;
}

export type AuthorshipStat = { ai: boolean; total: number; bad: number; cfr: number; avg_risk: number };

export async function aiVsHuman(ctx: OrgCtx, days = 30, now = Date.now()): Promise<AuthorshipStat[]> {
  const rows = await db
    .select({
      ai: sql<boolean>`${ai}`,
      total: sql<number>`count(*)::int`,
      bad: sql<number>`count(*) filter (where ${bad})::int`,
      finished: sql<number>`count(*) filter (where ${finished})::int`,
      avgRisk: sql<number>`coalesce(avg(${score}), 0)::float8`,
    })
    .from(deployments)
    .where(inWindow(ctx, windowFor(days, now).current))
    .groupBy(ai);
  return [false, true].map((flag) => {
    const r = rows.find((x) => x.ai === flag);
    return r
      ? { ai: flag, total: r.total, bad: r.bad, cfr: r.finished ? r.bad / r.finished : 0, avg_risk: Number(r.avgRisk) }
      : { ai: flag, total: 0, bad: 0, cfr: 0, avg_risk: 0 };
  });
}

export type RollbackLatency = {
  count: number;
  /** deployment start -> rolled_back event */
  from_start_median_ms: number | null;
  from_start_p90_ms: number | null;
  /** last verdict before the rollback -> rolled_back event (automatic rollbacks) */
  detect_to_rollback_median_ms: number | null;
  detect_to_rollback_p90_ms: number | null;
};

export async function rollbackLatency(ctx: OrgCtx, days = 30, now = Date.now()): Promise<RollbackLatency> {
  const w = windowFor(days, now).current;
  const rows = await db.execute<{
    count: number;
    s50: number | null;
    s90: number | null;
    d50: number | null;
    d90: number | null;
  }>(sql`
    with rb as (
      select d.created_at as started, e.at as rolled_at,
        (select v.at from ${deploymentEvents} v
          where v.deployment_id = e.deployment_id and v.kind = 'verdict' and v.id < e.id
          order by v.id desc limit 1) as verdict_at
      from ${deploymentEvents} e
      join ${deployments} d on d.id = e.deployment_id
      where d.org_id = ${ctx.orgId} and e.kind = 'rolled_back'
        and d.created_at >= ${w.from.toISOString()}::timestamptz and d.created_at < ${w.to.toISOString()}::timestamptz
    )
    select count(*)::int as count,
      (percentile_cont(0.5) within group (order by extract(epoch from rolled_at - started) * 1000))::float8 as s50,
      (percentile_cont(0.9) within group (order by extract(epoch from rolled_at - started) * 1000))::float8 as s90,
      (percentile_cont(0.5) within group (order by extract(epoch from rolled_at - verdict_at) * 1000))::float8 as d50,
      (percentile_cont(0.9) within group (order by extract(epoch from rolled_at - verdict_at) * 1000))::float8 as d90
    from rb`);
  const r = rows[0];
  const n = (v: number | null | undefined) => (v === null || v === undefined ? null : Number(v));
  return {
    count: r?.count ?? 0,
    from_start_median_ms: n(r?.s50),
    from_start_p90_ms: n(r?.s90),
    detect_to_rollback_median_ms: n(r?.d50),
    detect_to_rollback_p90_ms: n(r?.d90),
  };
}

// ---------- Usage vs plan ----------

export type UsageKey = "deploying_services" | "deploys" | "verified_rollouts" | "auto_rollbacks" | "seats";

/** Per-plan monthly limits (null = unlimited). */
export const PLAN_LIMITS: Record<Plan, Record<UsageKey, number | null>> = {
  free: { deploying_services: 3, deploys: 200, verified_rollouts: 200, auto_rollbacks: null, seats: 3 },
  team: { deploying_services: 25, deploys: 2_000, verified_rollouts: 2_000, auto_rollbacks: null, seats: 25 },
  business: { deploying_services: 200, deploys: 20_000, verified_rollouts: 20_000, auto_rollbacks: null, seats: 250 },
};

export const USAGE_LABELS: Record<UsageKey, string> = {
  deploying_services: "Deploying services",
  deploys: "Deploys this month",
  verified_rollouts: "Verified rollouts",
  auto_rollbacks: "Auto-rollbacks",
  seats: "Seats",
};

export type Usage = {
  plan: Plan;
  cycle_start: string;
  cycle_end: string;
  items: { key: UsageKey; label: string; used: number; limit: number | null }[];
};

/** Usage in the current calendar-month billing cycle (UTC). */
export async function usage(ctx: OrgCtx, now = Date.now()): Promise<Usage> {
  const d = new Date(now);
  const from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const to = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  const w: Window = { from, to, days: 0 };
  const autoRolledBack = sql`${deployments.status} = 'rolled_back' and exists (
    select 1 from ${deploymentEvents} v where v.deployment_id = ${deployments.id} and v.kind = 'verdict' and (v.verdict->>'pass')::boolean = false)`;
  const [org, [r], [seats]] = await Promise.all([
    getOrg(ctx.orgId),
    db
      .select({
        services: sql<number>`count(distinct ${deployments.serviceId})::int`,
        deploys: sql<number>`count(*)::int`,
        verified: sql<number>`count(*) filter (where ${deployments.status} = 'promoted')::int`,
        auto: sql<number>`count(*) filter (where ${autoRolledBack})::int`,
      })
      .from(deployments)
      .where(inWindow(ctx, w)),
    db.select({ n: sql<number>`count(*)::int` }).from(memberships).where(eq(memberships.orgId, ctx.orgId)),
  ]);
  const plan = org?.plan ?? "team";
  const limits = PLAN_LIMITS[plan];
  const used: Record<UsageKey, number> = {
    deploying_services: r.services,
    deploys: r.deploys,
    verified_rollouts: r.verified,
    auto_rollbacks: r.auto,
    seats: seats.n,
  };
  return {
    plan,
    cycle_start: from.toISOString(),
    cycle_end: to.toISOString(),
    items: (Object.keys(USAGE_LABELS) as UsageKey[]).map((key) => ({ key, label: USAGE_LABELS[key], used: used[key], limit: limits[key] })),
  };
}
