import Link from "next/link";
import { COLORS, LegendItem, LineChart } from "@/components/console/charts";
import { RiskValue } from "@/components/console/primitives";
import { RolloutTreeView } from "@/components/console/rollout-tree";
import { ago, metricUnitValue } from "@/lib/console/format";
import type { RolloutTree } from "@/lib/console/rollout-tree";
import type { DeployEvent, Deployment } from "@/lib/console/types";

/** Card for an in-progress rollout: compact tree plus canary vs baseline across verdicts. */
export function LiveRolloutCard({ d, events, tree, now }: { d: Deployment; events: DeployEvent[]; tree: RolloutTree; now: number }) {
  const verdicts = events.filter((e) => e.kind === "verdict" && e.verdict?.results);
  const pick = (metric: string, side: "canary" | "baseline") =>
    verdicts.map((e) => e.verdict!.results!.find((r) => r.metric === metric)?.[side] ?? null);
  const metric = "latency_p95";
  const canary = pick(metric, "canary");
  const baseline = pick(metric, "baseline");
  const lastCanary = canary.filter((v): v is number => v !== null).at(-1);

  return (
    <Link
      href={`/app/deployments/${d.id}`}
      className="group flex flex-col rounded-lg border border-con-line bg-con-panel transition-colors duration-150 hover:border-con-line-hover"
    >
      <div className="flex items-start justify-between gap-4 border-b border-con-line px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-con-info" aria-hidden />
            <span className="text-[15px] font-semibold">{d.service}</span>
            {d.ref && <span className="font-mono text-[13px] text-con-fg2">{d.ref}</span>}
          </div>
          <div className="mt-0.5 truncate font-mono text-[12px] text-con-fg3">{d.image}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[28px] font-semibold leading-none tabular-nums tracking-[-0.03em]">{tree.liveWeight}%</div>
          <div className="mt-1 text-[12px] text-con-fg3">canary traffic</div>
        </div>
      </div>
      <div className="grid flex-1 gap-5 px-5 py-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <RolloutTreeView tree={tree} compact />
        </div>
        <div className="min-w-0">
          {verdicts.length >= 1 ? (
            <LineChart
              height={110}
              series={[
                { name: "baseline", values: baseline, color: "#737373", dashed: true },
                { name: "canary", values: canary, color: COLORS.good },
              ]}
              yFormat={(v) => `${Math.round(v)}`}
              xLabels={verdicts.map((e, i) => ({ pos: verdicts.length === 1 ? 0.5 : i / (verdicts.length - 1), label: `${e.weight}%` }))}
              title="Latency p95 at each verdict, canary vs baseline"
              legend={
                <>
                  <span className="text-[12px] font-medium text-con-fg">Latency p95</span>
                  <LegendItem color={COLORS.good} label="Canary" value={lastCanary !== undefined ? metricUnitValue(metric, lastCanary) : undefined} />
                  <LegendItem color="#737373" dashed label="Baseline" />
                </>
              }
            />
          ) : (
            <p className="text-[13px] text-con-fg3">First verdict pending.</p>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-con-line px-5 py-3 text-[13px] text-con-fg2">
        <span>Started {ago(d.created_at, now)}</span>
        <RiskValue score={d.risk?.score ?? 0} />
      </div>
    </Link>
  );
}
