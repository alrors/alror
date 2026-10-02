import Link from "next/link";
import { AiBadge, RiskValue, StagePips, StatusBadge, TrafficBar, tableCell, tableHead } from "@/components/console/primitives";
import { stageStates } from "@/lib/console/analytics";
import { ago, dateTime, span } from "@/lib/console/format";
import type { Deployment } from "@/lib/console/types";
import type { ColumnKey, Density } from "@/components/console/release-prefs";
import { cn } from "@/lib/site";

const SOURCE_LABEL: Record<string, string> = { cli: "CLI", ci: "CI", console: "Console", runner: "Runner" };

function durationOf(d: Deployment, now: number): string {
  const end = d.status === "rolling" || d.status === "pending" ? now : Date.parse(d.updated_at);
  return span(end - Date.parse(d.created_at));
}

/** Linear-style table: no stripes, 1px dividers, 48px rows, hover tint. */
export function DeploymentTable({
  deps,
  now,
  hideService,
  hidden = [],
  density = "comfortable",
}: {
  deps: Deployment[];
  now: number;
  /** On a service page the service column is redundant. */
  hideService?: boolean;
  /** Columns the viewer switched off (the release list's column toggle). */
  hidden?: ColumnKey[];
  density?: Density;
}) {
  const show = (k: ColumnKey) => !hidden.includes(k);
  const compact = density === "compact";
  const cell = cn(tableCell, compact && "h-9");
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-[14px]">
          <thead className="border-b border-con-line">
            <tr>
              <th className={tableHead}>{hideService ? "Release" : "Deployment"}</th>
              {show("status") && <th className={tableHead}>Status</th>}
              {show("risk") && <th className={tableHead}>Risk</th>}
              {show("stages") && <th className={cn(tableHead, "hidden xl:table-cell")}>Stages</th>}
              {show("traffic") && <th className={cn(tableHead, "hidden lg:table-cell")}>Traffic</th>}
              {show("duration") && <th className={cn(tableHead, "hidden xl:table-cell")}>Duration</th>}
              {show("source") && <th className={cn(tableHead, "hidden lg:table-cell")}>Source</th>}
              {show("created") && <th className={cn(tableHead, "text-right")}>Created</th>}
            </tr>
          </thead>
          <tbody className="con-stagger">
            {deps.map((d) => {
              const href = `/app/deployments/${d.id}`;
              const steps = d.plan?.steps ?? [];
              return (
                <tr key={d.id} className="group relative border-b border-con-row transition-colors duration-150 last:border-0 hover:bg-con-hover">
                  <td className={cn(cell, compact ? "py-1" : "py-2")}>
                    <div className="flex items-center gap-2">
                      <Link href={href} className="font-medium text-con-fg after:absolute after:inset-0" aria-label={`Open ${d.service} ${d.ref ?? d.id}`}>
                        {hideService ? d.ref || d.id : d.service}
                      </Link>
                      {!hideService && d.ref && <span className="font-mono text-[13px] text-con-fg2">{d.ref}</span>}
                      {d.risk?.ai_authored && <AiBadge compact />}
                    </div>
                    {!compact && (
                      <div className="max-w-[360px] truncate font-mono text-[12px] text-con-fg3">
                        {d.environment && <span className="text-con-fg2">{d.environment} · </span>}
                        {d.image}
                      </div>
                    )}
                  </td>
                  {show("status") && (
                    <td className={cell}>
                      <StatusBadge status={d.status} />
                    </td>
                  )}
                  {show("risk") && (
                    <td className={cell}>
                      <RiskValue score={d.risk?.score ?? 0} />
                    </td>
                  )}
                  {show("stages") && (
                    <td className={cn(cell, "hidden xl:table-cell")}>
                      <StagePips states={stageStates(d)} weights={steps.map((s) => s.weight)} />
                    </td>
                  )}
                  {show("traffic") && (
                    <td className={cn(cell, "hidden lg:table-cell")}>
                      <TrafficBar d={d} />
                    </td>
                  )}
                  {show("duration") && (
                    <td className={cn(cell, "hidden whitespace-nowrap font-mono text-[13px] tabular-nums text-con-fg2 xl:table-cell")}>
                      {durationOf(d, now)}
                    </td>
                  )}
                  {show("source") && (
                    <td className={cn(cell, "hidden whitespace-nowrap text-[13px] text-con-fg2 lg:table-cell")}>{SOURCE_LABEL[d.source ?? "cli"] ?? d.source}</td>
                  )}
                  {show("created") && (
                    <td className={cn(cell, "whitespace-nowrap text-right")}>
                      <span className="text-[13px] text-con-fg2" title={dateTime(d.created_at)}>
                        {ago(d.created_at, now)}
                      </span>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Stacked rows for phones. */}
      <ul className="divide-y divide-con-row md:hidden">
        {deps.map((d) => (
          <li key={d.id}>
            <Link href={`/app/deployments/${d.id}`} className="block px-4 py-3.5 transition-colors duration-150 hover:bg-con-hover">
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[14px] font-medium">{hideService ? d.ref || d.id : d.service}</span>
                  {!hideService && d.ref && <span className="font-mono text-[12px] text-con-fg2">{d.ref}</span>}
                </span>
                <StatusBadge status={d.status} />
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-[13px] text-con-fg3">
                  {ago(d.created_at, now)} · {durationOf(d, now)}
                </span>
                <RiskValue score={d.risk?.score ?? 0} />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
