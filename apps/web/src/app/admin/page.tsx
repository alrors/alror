import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Kpi, AdminHeader, pct } from "@/components/admin/kit";
import { COLORS, LegendItem, StackedBars } from "@/components/console/charts";
import { Card, EmptyState, Pill } from "@/components/console/primitives";
import { ago, dayLabel, weekdayLabel, requestTime } from "@/lib/console/format";
import { requirePlatformAdmin } from "@/lib/server/admin/guard";
import { adminKpis, instanceActivity, needsAttention } from "@/lib/server/admin/overview";

export const metadata: Metadata = { title: "Overview" };

export default async function AdminOverview() {
  const admin = await requirePlatformAdmin();
  const [k, days, attention] = await Promise.all([adminKpis(admin), instanceActivity(admin, 30), needsAttention(admin)]);
  const now = requestTime();
  const attentionCount = attention.stalled.length + attention.risky.length + attention.failed.length;

  return (
    <div className="con-fade-up">
      <AdminHeader title="Overview" description="Every organization on this Alror instance. Numbers are computed live from the database." />

      <div className="con-stagger grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Kpi label="Organizations" value={k.orgs} href="/admin/orgs" />
        <Kpi label="Users" value={k.users} href="/admin/users" />
        <Kpi label="Active API keys" value={k.active_keys} />
        <Kpi label="Deploys 24h" value={k.deploys_24h} />
        <Kpi label="Deploys 7d" value={k.deploys_7d} />
        <Kpi label="Deploys 30d" value={k.deploys_30d} />
        <Kpi
          label="Rollback rate 30d"
          value={k.rollback_rate_30d * 100}
          decimals={1}
          suffix="%"
          hint={`of ${k.finished_30d} finished deploys`}
          tone={k.rollback_rate_30d >= 0.2 ? "warn" : undefined}
        />
        <Kpi label="Queued jobs" value={k.jobs_queued} href="/admin/jobs?status=queued" />
        <Kpi label="Claimed jobs" value={k.jobs_claimed} href="/admin/jobs?status=claimed" />
        <Kpi label="Stalled jobs" value={k.jobs_stalled} hint="no heartbeat for 2 min" tone={k.jobs_stalled > 0 ? "warn" : undefined} href="/admin/jobs?status=stalled" />
        <Kpi label="Failed jobs 7d" value={k.jobs_failed_7d} href="/admin/jobs?status=failed" />
        <Kpi label="Runners seen 5m" value={k.runners_5m} hint="from claims and heartbeats" href="/admin/jobs#runners" />
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card
          title="Deploy activity"
          description="Deployments per day across all organizations, last 30 days (UTC)."
          aside={
            <span className="flex flex-wrap gap-3">
              <LegendItem color={COLORS.neutralLight} label="Promoted" />
              <LegendItem color={COLORS.bad} label="Rolled back or failed" />
              <LegendItem color={COLORS.info} label="In flight" />
            </span>
          }
        >
          <StackedBars
            height={240}
            title="Deployments per day"
            emptyLabel="No deployments in the last 30 days"
            data={days.map((d) => ({
              label: dayLabel(d.day),
              header: weekdayLabel(d.day),
              segments: [
                { name: "Promoted", value: d.promoted, color: COLORS.neutralLight },
                { name: "Rolled back or failed", value: d.bad, color: COLORS.bad },
                { name: "In flight", value: d.other, color: COLORS.info },
              ],
            }))}
          />
        </Card>

        <Card
          title="Needs attention"
          description={attentionCount ? `${attentionCount} item${attentionCount === 1 ? "" : "s"} to look at` : "Nothing needs attention right now."}
          flush
          className="xl:max-h-[360px]"
          bodyClassName="con-scroll overflow-y-auto"
        >
          {attentionCount === 0 ? (
            <EmptyState title="All clear">No stalled jobs, no failed jobs in the last 7 days, and no org rolls back 20% or more of its deploys.</EmptyState>
          ) : (
            <ul className="divide-y divide-con-line">
              {attention.stalled.map((j) => (
                <li key={j.id} className="flex items-center gap-3 px-5 py-2.5">
                  <Pill tone="warn">Stalled</Pill>
                  <div className="min-w-0 flex-1 text-[13px]">
                    <p className="truncate text-con-fg">
                      {j.kind} job <span className="font-mono text-con-fg2">{j.id.slice(0, 8)}</span> in {j.org}
                    </p>
                    <p className="truncate text-[12px] text-con-fg3">
                      {j.claimed_by ?? "unknown runner"}, last heartbeat {j.heartbeat_at ? ago(j.heartbeat_at, now) : "never"}
                    </p>
                  </div>
                  <Link href={`/admin/jobs?status=stalled&org=${j.org_id}`} className="text-con-fg3 hover:text-con-fg" aria-label="Open in jobs">
                    <ArrowRight size={14} />
                  </Link>
                </li>
              ))}
              {attention.risky.map((o) => (
                <li key={o.id} className="flex items-center gap-3 px-5 py-2.5">
                  <Pill tone="warn">{pct(o.rate)}</Pill>
                  <div className="min-w-0 flex-1 text-[13px]">
                    <p className="truncate text-con-fg">{o.name} rolls back often</p>
                    <p className="truncate text-[12px] text-con-fg3">
                      {o.rolled_back} of {o.finished} finished deploys rolled back in 30 days
                    </p>
                  </div>
                  <Link href={`/admin/orgs/${o.id}`} className="text-con-fg3 hover:text-con-fg" aria-label={`Open ${o.slug}`}>
                    <ArrowRight size={14} />
                  </Link>
                </li>
              ))}
              {attention.failed.map((j) => (
                <li key={j.id} className="flex items-center gap-3 px-5 py-2.5">
                  <Pill tone="bad">Failed</Pill>
                  <div className="min-w-0 flex-1 text-[13px]">
                    <p className="truncate text-con-fg">
                      {j.kind} job <span className="font-mono text-con-fg2">{j.id.slice(0, 8)}</span> in {j.org}
                    </p>
                    <p className="truncate text-[12px] text-con-fg3" title={j.error ?? undefined}>
                      {j.error || "no error message"}
                      {j.finished_at ? `, ${ago(j.finished_at, now)}` : ""}
                    </p>
                  </div>
                  <Link href={`/admin/jobs?status=failed&org=${j.org_id}`} className="text-con-fg3 hover:text-con-fg" aria-label="Open in jobs">
                    <ArrowRight size={14} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
