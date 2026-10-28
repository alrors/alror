import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { CountUp } from "@/components/console/count-up";
import { IncidentStatusPill, ScoreBar, SeverityPill } from "@/components/console/incidents/incident-ui";
import { Pagination } from "@/components/console/pagination";
import { Card, EmptyState, PageHeader, Segmented, buttonClass, tableCell, tableHead } from "@/components/console/primitives";
import { requireSession } from "@/lib/console/auth";
import { ago, dateTime, requestTime } from "@/lib/console/format";
import { pageMeta, parsePage, parsePer } from "@/lib/console/paginate";
import { ctxFor } from "@/lib/server/auth/accounts";
import { isAdminRole } from "@/lib/server/context";
import type { IncidentStatus } from "@/lib/server/db/schema";
import { getAlertSettings } from "@/lib/server/data/alert-settings";
import { listIncidents } from "@/lib/server/data/incidents";
import { cn } from "@/lib/site";

export const metadata: Metadata = { title: "Incidents" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function IncidentsPage({ searchParams }: PageProps<"/app/incidents">) {
  const sp = await searchParams;
  const session = await requireSession();
  const ctx = ctxFor(session);
  const status: IncidentStatus | "all" = one(sp.status) === "resolved" ? "resolved" : one(sp.status) === "all" ? "all" : "open";
  const per = parsePer(sp.per);
  const page = parsePage(sp.page);
  const filter = status === "all" ? undefined : status;
  const [r, settings] = await Promise.all([listIncidents(ctx, { status: filter, page, per }), getAlertSettings(ctx)]);
  const meta = pageMeta(r.items, r.total, page, per);
  const now = requestTime();
  const base = "/app/incidents";
  const tab = (v: string) => (v === "open" ? base : `${base}?status=${v}`);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Incidents"
        description="Alerts from Alertmanager, Datadog, Sentry or any JSON webhook, each with the recent deployments most likely to have caused it."
        actions={
          isAdminRole(session.role) ? (
            <Link href="/app/settings/integrations" className={buttonClass.secondary}>
              Alert integrations
            </Link>
          ) : undefined
        }
      />

      <section aria-label="Incidents by status" className="con-stagger grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[
          { label: "Open", value: r.counts.open, hint: "still firing", bar: "bg-con-bad" },
          { label: "Resolved", value: r.counts.resolved, hint: "closed by the source or by hand", bar: "bg-con-fg3" },
          {
            label: "Automatic rollback",
            value: null,
            hint: settings.auto_rollback ? `on · ${settings.threshold}+ score, within ${settings.max_age_minutes} min` : "off · suggestions only",
            bar: settings.auto_rollback ? "bg-con-warn" : "bg-con-line-hover",
          },
        ].map((b) => (
          <div key={b.label} className="rounded-lg border border-con-line bg-con-panel px-4 py-3.5">
            <div className="flex items-center gap-2 text-[12px] text-con-fg2">
              <span className={cn("h-1.5 w-1.5 rounded-full", b.bar)} aria-hidden />
              {b.label}
            </div>
            <div className="mt-1 text-[24px] font-semibold leading-none tracking-[-0.02em]">
              {b.value === null ? (settings.auto_rollback ? "On" : "Off") : <CountUp value={b.value} />}
            </div>
            <div className="mt-1.5 truncate text-[12px] text-con-fg3">{b.hint}</div>
          </div>
        ))}
      </section>

      <Card flush>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-con-line px-5 py-2.5">
          <Segmented
            active={status}
            items={[
              { label: `Open · ${r.counts.open}`, value: "open", href: tab("open") },
              { label: `Resolved · ${r.counts.resolved}`, value: "resolved", href: tab("resolved") },
              { label: `All · ${r.counts.all}`, value: "all", href: tab("all") },
            ]}
          />
          {!settings.secret_set && (
            <span className="text-[12px] text-con-fg3">
              No alert secret yet.{" "}
              {isAdminRole(session.role) ? (
                <Link href="/app/settings/integrations" className="text-con-fg2 underline-offset-4 hover:text-con-fg hover:underline">
                  Create one
                </Link>
              ) : (
                "Ask an owner or admin to create one."
              )}
            </span>
          )}
        </div>
        {r.items.length === 0 ? (
          <EmptyState title={status === "open" ? "No open incidents" : "No incidents"}>
            {settings.secret_set
              ? "When an alert arrives, Alror ranks the deployments that changed shortly before it and shows them here."
              : "Connect Alertmanager, Datadog or Sentry under Settings, Integrations. Alerts then show up here with the changes most likely to have caused them."}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-[14px]">
              <thead className="border-b border-con-line">
                <tr>
                  <th className={tableHead}>Alert</th>
                  <th className={tableHead}>Service</th>
                  <th className={tableHead}>Started</th>
                  <th className={tableHead}>Most likely change</th>
                  <th className={tableHead}>Status</th>
                  <th className={cn(tableHead, "w-8")}>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody className="con-stagger">
                {r.items.map((inc, i) => {
                  const top = inc.candidates.items[0];
                  return (
                    <tr key={inc.id} className="group relative border-b border-con-row transition-colors duration-150 last:border-0 hover:bg-con-hover">
                      <td className={cn(tableCell, "py-2.5")}>
                        <div className="flex items-center gap-2">
                          <SeverityPill severity={inc.severity} />
                          <Link href={`${base}/${inc.id}`} className="min-w-0 truncate font-medium text-con-fg after:absolute after:inset-0">
                            {inc.title}
                          </Link>
                        </div>
                        <div className="mt-0.5 text-[12px] text-con-fg3">
                          {inc.source}
                          {inc.event_count > 1 ? ` · ${inc.event_count} deliveries` : ""}
                          {inc.auto_action?.rollback ? " · rolled back automatically" : ""}
                        </div>
                      </td>
                      <td className={cn(tableCell, "text-[13px]")}>
                        <div className="whitespace-nowrap text-con-fg">{inc.service || <span className="text-con-fg3">unknown</span>}</div>
                        <div className="text-[12px] text-con-fg3">{inc.environment || "any environment"}</div>
                      </td>
                      <td className={cn(tableCell, "whitespace-nowrap text-[13px] text-con-fg2")} title={dateTime(inc.started_at)}>
                        {ago(inc.started_at, now)}
                      </td>
                      <td className={tableCell}>
                        {top ? (
                          <div className="flex items-center gap-3">
                            <ScoreBar score={top.score} delay={i * 25} />
                            <div className="min-w-0">
                              <div className="truncate font-mono text-[12.5px] text-con-fg">{top.service}</div>
                              <div className="truncate font-mono text-[11.5px] text-con-fg3">{top.deployment_id}</div>
                            </div>
                          </div>
                        ) : (
                          <span className="text-[13px] text-con-fg3">No deploys in the window</span>
                        )}
                      </td>
                      <td className={tableCell}>
                        <IncidentStatusPill status={inc.status} />
                      </td>
                      <td className={cn(tableCell, "text-con-fg3")}>
                        <ChevronRight size={16} className="transition-transform duration-150 group-hover:translate-x-0.5" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination meta={meta} noun="incidents" base={base} params={{ status: status === "open" ? undefined : status }} />
      </Card>
    </div>
  );
}
