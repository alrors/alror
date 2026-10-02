// Side widgets: runners, risk mix and plan usage.

import Link from "next/link";
import { Server } from "lucide-react";
import { COLORS, Donut } from "@/components/console/charts";
import { Pill } from "@/components/console/primitives";
import { ago, dayLabel, span } from "@/lib/console/format";
import type { RiskMix, RunnerSeen } from "@/lib/console/overview";
import type { Usage } from "@/lib/server/data/analytics";
import { cn } from "@/lib/site";
import { Panel, PanelLink } from "./ui";

/* ---------------------------------- Runners ---------------------------------- */

export function RunnersWidget({
  runners,
  queued,
  running,
  stalled,
  oldestQueued,
  now,
}: {
  runners: RunnerSeen[];
  queued: number;
  running: number;
  stalled: number;
  /** ISO time of the oldest queued job. */
  oldestQueued: string | null;
  now: number;
}) {
  const online = runners.filter((r) => r.online);
  const stats = [
    { label: "Online", value: online.length, href: "/app/jobs", tone: "" },
    { label: "Queued", value: queued, href: "/app/jobs?status=queued", tone: queued && !online.length ? "text-con-warn" : "" },
    { label: "Stalled", value: stalled, href: "/app/jobs?status=claimed", tone: stalled ? "text-con-warn" : "" },
  ];
  return (
    <Panel
      widget="runners"
      label="Runners"
      title="Runners"
      tip="alror runner claims deploy and rollback jobs and sends heartbeats while it works. A runner counts as online when it claimed, finished or reported on a job in the last 5 minutes. A job is stalled when its runner stops sending heartbeats for 2 minutes."
      tipAlign="end"
      aside={<PanelLink href="/app/jobs">Jobs</PanelLink>}
    >
      <dl className="grid grid-cols-3 overflow-hidden rounded-md border border-con-line bg-con-line" style={{ gap: 1 }}>
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="con-ease bg-con-bg px-3 py-2.5 hover:bg-con-hover">
            <dt className="text-[11px] text-con-fg3">{s.label}</dt>
            <dd className={cn("mt-0.5 font-mono text-[18px] font-medium leading-tight tabular-nums text-con-fg", s.tone)}>{s.value}</dd>
          </Link>
        ))}
      </dl>
      {runners.length === 0 ? (
        <div className="mt-3 flex items-start gap-2.5 text-[12px] text-con-fg3">
          <Server size={14} className="mt-0.5 shrink-0" />
          <span>
            No runner has claimed a job yet. Start one with <code className="font-mono text-con-fg2">alror runner</code> so Deploy and Roll back can execute.
          </span>
        </div>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {runners.slice(0, 4).map((r) => (
            <li key={r.name} className="flex items-center gap-2 text-[12px]">
              <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", r.online ? "bg-con-good" : "bg-con-fg3/60")} />
              <span className="min-w-0 flex-1 truncate font-mono text-con-fg">{r.name}</span>
              <span className="shrink-0 text-con-fg3">{r.online ? "online" : `seen ${ago(new Date(r.lastSeen).toISOString(), now)}`}</span>
            </li>
          ))}
        </ul>
      )}
      {(running > 0 || oldestQueued) && (
        <p className="mt-3 border-t border-con-row pt-2.5 text-[12px] text-con-fg3">
          {running > 0 && `${running} job${running === 1 ? "" : "s"} running`}
          {running > 0 && oldestQueued && " · "}
          {oldestQueued && `oldest queued ${span(now - Date.parse(oldestQueued))}`}
        </p>
      )}
    </Panel>
  );
}

/* --------------------------------- Risk mix --------------------------------- */

export const LEVEL_COLORS = { low: "#8f8f8f", medium: COLORS.warn, high: COLORS.bad };

export function RiskMixWidget({ mix, rangeLabel }: { mix: RiskMix[]; rangeLabel: string }) {
  const total = mix.reduce((s, m) => s + m.total, 0);
  return (
    <Panel
      widget="risk"
      label="Risk mix"
      title="Risk mix"
      tip="Releases in the range by risk level (scored from the change: size, paths, criticality, authorship), and how often each level rolled back or failed once finished. Higher-risk releases get slower, more cautious rollout plans."
      tipAlign="end"
      aside={<span className="text-[12px] text-con-fg3">{rangeLabel}</span>}
    >
      <div className="flex items-center gap-5">
        <Donut
          size={104}
          thickness={11}
          label={`Risk mix: ${mix.map((m) => `${m.total} ${m.level}`).join(", ")}`}
          parts={mix.map((m) => ({ name: m.level, value: m.total, color: LEVEL_COLORS[m.level] }))}
          center={
            <div>
              <div className="font-mono text-[18px] font-medium leading-none tabular-nums text-con-fg">{total}</div>
              <div className="mt-1 text-[10.5px] text-con-fg3">releases</div>
            </div>
          }
        />
        <table className="w-full min-w-0 text-[12px]">
          <thead>
            <tr className="text-[11px] text-con-fg3">
              <th className="pb-1.5 text-left font-normal">Level</th>
              <th className="pb-1.5 text-right font-normal">Share</th>
              <th className="pb-1.5 text-right font-normal" title="Rolled back or failed, of finished releases">
                Rollback
              </th>
            </tr>
          </thead>
          <tbody>
            {mix.map((m) => (
              <tr key={m.level}>
                <td className="py-1">
                  <Link href={`/app/deployments?risk=${m.level}`} className="inline-flex items-center gap-2 capitalize text-con-fg2 hover:text-con-fg">
                    <span aria-hidden className="h-2 w-2 rounded-[2px]" style={{ background: LEVEL_COLORS[m.level] }} />
                    {m.level}
                  </Link>
                </td>
                <td className="py-1 text-right font-mono tabular-nums text-con-fg">{total ? `${Math.round((m.total / total) * 100)}%` : "0%"}</td>
                <td className={cn("py-1 text-right font-mono tabular-nums", m.bad ? "text-con-fg" : "text-con-fg3")}>
                  {m.finished ? `${Math.round((m.bad / m.finished) * 100)}%` : "n/a"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/* ----------------------------------- Usage ----------------------------------- */

export function UsageWidget({ usage }: { usage: Usage }) {
  const cycleEnd = new Date(Date.parse(usage.cycle_end) - 1).toISOString();
  return (
    <Panel
      widget="usage"
      label="Usage"
      title="Usage"
      tip={`Billing cycle ${dayLabel(usage.cycle_start)} to ${dayLabel(cycleEnd)} (UTC). Bars turn amber above 80% of the plan limit.`}
      tipAlign="end"
      aside={<Pill className="h-5 text-[11px] capitalize text-con-fg2">{usage.plan} plan</Pill>}
    >
      <ul className="space-y-2.5">
        {usage.items.map((u) => {
          const ratio = u.limit ? Math.min(1, u.used / u.limit) : null;
          return (
            <li key={u.key}>
              <div className="flex items-baseline justify-between gap-3 text-[12px]">
                <span className="truncate text-con-fg2">{u.label}</span>
                <span className="shrink-0 font-mono tabular-nums text-con-fg">
                  {u.used.toLocaleString("en-US")}
                  <span className="text-con-fg3">{u.limit === null ? " · no limit" : ` / ${u.limit.toLocaleString("en-US")}`}</span>
                </span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-con-row">
                {ratio !== null && ratio > 0 && (
                  <div className="con-grow-x h-full rounded-full" style={{ width: `${Math.max(ratio * 100, 2)}%`, background: ratio > 0.8 ? COLORS.warn : COLORS.neutralLight }} />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
