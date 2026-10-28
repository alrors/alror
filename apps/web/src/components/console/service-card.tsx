import Link from "next/link";
import { CircleCheck, CircleDashed, Loader, RotateCcw } from "lucide-react";
import { Sparkline } from "@/components/console/charts";
import { Pill, RiskValue, tableCell, tableHead } from "@/components/console/primitives";
import type { ServiceRow } from "@/lib/console/analytics";
import { ago, pct } from "@/lib/console/format";
import { cn } from "@/lib/site";

export type ServiceListRow = ServiceRow & { archived?: boolean };

const svcHref = (name: string) => `/app/services/${encodeURIComponent(name)}`;

/** One-line health: what the service is doing now, in words. */
export function ServiceHealthLine({ r, now }: { r: ServiceRow; now: number }) {
  if (r.health === "rolling" && r.live)
    return (
      <span className="flex min-w-0 items-center gap-2 text-con-info">
        <Loader size={14} className="shrink-0" />
        <span className="truncate">
          Rolling {r.live.weight}% · {r.live.ref || "release"}
        </span>
      </span>
    );
  if (r.health === "rolled_back" && r.lastFinished)
    return (
      <span className="flex min-w-0 items-center gap-2 text-con-bad">
        <RotateCcw size={14} className="shrink-0" />
        <span className="truncate">
          {r.lastFinished.status === "failed" ? "Failed" : "Rolled back"} {ago(r.lastFinished.updated_at, now)}
        </span>
      </span>
    );
  if (r.health === "healthy" && r.lastFinished)
    return (
      <span className="flex min-w-0 items-center gap-2 text-con-fg2">
        <CircleCheck size={14} className="shrink-0 text-con-good" />
        <span className="truncate">Healthy · promoted {ago(r.lastFinished.updated_at, now)}</span>
      </span>
    );
  return (
    <span className="flex items-center gap-2 text-con-fg3">
      <CircleDashed size={14} className="shrink-0" />
      No releases yet
    </span>
  );
}

function Stat({ label, children, title }: { label: string; children: React.ReactNode; title?: string }) {
  return (
    <div className="min-w-0" title={title}>
      <div className="text-[11px] uppercase tracking-[0.04em] text-con-fg3">{label}</div>
      <div className="mt-0.5 truncate font-mono text-[13px] tabular-nums text-con-fg">{children}</div>
    </div>
  );
}

export function ServiceCard({ r, now }: { r: ServiceListRow; now: number }) {
  const bad = r.recent.filter((d) => d.status === "rolled_back" || d.status === "failed").length;
  return (
    <Link
      href={svcHref(r.name)}
      className={cn("con-lift flex flex-col rounded-lg border border-con-line bg-con-panel hover:border-con-line-hover", r.archived && "opacity-70")}
    >
      <div className="flex-1 px-5 pb-4 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold">{r.name}</div>
            <div className="mt-0.5 truncate text-[12px] text-con-fg3">
              {r.target}
              {r.cluster ? ` · ${r.cluster}` : ""} · {r.paths.length ? `${r.paths.length} path${r.paths.length === 1 ? "" : "s"}` : "no paths"}
            </div>
          </div>
          <span className="flex shrink-0 gap-1.5">
            {r.archived && <Pill className="text-con-fg3">Archived</Pill>}
            {r.critical && <Pill className="text-con-fg2">Critical</Pill>}
          </span>
        </div>
        <Sparkline
          values={r.daily}
          className="mt-4 h-8"
          label={`${r.recent.length} deploys in the last 30 days`}
          dot={r.health === "rolled_back" ? "#f2555a" : "#ededed"}
        />
        <div className="mt-3 grid grid-cols-4 gap-3">
          <Stat label="Deploys" title="Releases started in the last 30 days">
            {r.recent.length}
          </Stat>
          <Stat label="Rollback" title={`${bad} of ${r.recent.length} releases in 30 days rolled back or failed`}>
            {r.recent.length ? pct(r.cfr, r.cfr > 0 && r.cfr < 0.1 ? 1 : 0) : "n/a"}
          </Stat>
          <Stat label="Risk" title="Average risk score, 30 days">
            {r.recent.length ? Math.round(r.avgRisk) : "n/a"}
          </Stat>
          <Stat label="Last" title={r.last ? `Last release ${r.last.ref || r.last.id}` : "No releases"}>
            <span className="font-sans">{r.last ? ago(r.last.created_at, now) : "never"}</span>
          </Stat>
        </div>
      </div>
      <div className="border-t border-con-line px-5 py-3 text-[13px]">
        <ServiceHealthLine r={r} now={now} />
      </div>
    </Link>
  );
}

export function ServiceGrid({ rows, now }: { rows: ServiceListRow[]; now: number }) {
  return (
    <div className="con-stagger grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
      {rows.map((r) => (
        <ServiceCard key={r.name} r={r} now={now} />
      ))}
    </div>
  );
}

export function ServiceTable({ rows, now }: { rows: ServiceListRow[]; now: number }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-con-line bg-con-panel">
      <table className="w-full min-w-[860px] text-[14px]">
        <thead className="border-b border-con-line">
          <tr>
            <th className={tableHead}>Service</th>
            <th className={tableHead}>Status</th>
            <th className={tableHead}>Deploys (30d)</th>
            <th className={cn(tableHead, "text-right")}>Rolled back</th>
            <th className={tableHead}>Avg risk</th>
            <th className={cn(tableHead, "text-right")}>Last release</th>
          </tr>
        </thead>
        <tbody className="con-stagger">
          {rows.map((r) => (
            <tr key={r.name} className="con-ease relative border-b border-con-row last:border-0 hover:bg-con-hover">
              <td className={cn(tableCell, "py-2")}>
                <Link href={svcHref(r.name)} className="font-medium after:absolute after:inset-0">
                  {r.name}
                </Link>
                {r.critical && <Pill className="ml-2 text-con-fg2">Critical</Pill>}
                {r.archived && <Pill className="ml-2 text-con-fg3">Archived</Pill>}
                <div className="text-[12px] text-con-fg3">
                  {r.target}
                  {r.cluster ? ` · ${r.cluster}` : ""}
                </div>
              </td>
              <td className={cn(tableCell, "max-w-[240px] text-[13px]")}>
                <ServiceHealthLine r={r} now={now} />
              </td>
              <td className={tableCell}>
                <div className="flex items-center gap-3">
                  <span className="w-6 font-mono text-[13px] tabular-nums">{r.recent.length}</span>
                  <Sparkline values={r.daily} className="h-6 w-28" />
                </div>
              </td>
              <td className={cn(tableCell, "text-right font-mono text-[13px] tabular-nums", r.cfr > 0 ? "text-con-fg" : "text-con-fg3")}>
                {r.recent.length ? pct(r.cfr, 1) : "n/a"}
              </td>
              <td className={tableCell}>
                <RiskValue score={Math.round(r.avgRisk)} />
              </td>
              <td className={cn(tableCell, "text-right text-[13px] text-con-fg2")}>
                {r.last ? (
                  <>
                    <span className="font-mono text-[12px] text-con-fg3">{r.last.ref || r.last.id.slice(0, 8)}</span> · {ago(r.last.created_at, now)}
                  </>
                ) : (
                  "never"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
