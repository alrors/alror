// Live rollouts as traffic lanes: one row per release in progress.

import Link from "next/link";
import { ArrowRight, Check, Radio, X } from "lucide-react";
import { CountUp } from "@/components/console/count-up";
import { RiskValue } from "@/components/console/primitives";
import { stageStates } from "@/lib/console/analytics";
import { ago, metricLabel, span } from "@/lib/console/format";
import type { Lane } from "@/lib/console/overview";
import type { DeployEvent } from "@/lib/console/types";
import { cn } from "@/lib/site";
import { LaneRollback } from "./lane-rollback";
import { Count, GHOST_BUTTON, PAD_X, Panel, PanelLink, SMALL_BUTTON } from "./ui";

/** Stage track: every planned stage as a segment. Done stages are filled, the current one fills with its bake time. */
function StageTrack({ lane, states, now }: { lane: Lane; states: ReturnType<typeof stageStates>; now: number }) {
  const d = lane.dep;
  const inStage = Math.max(0, now - Date.parse(lane.stageSince));
  const progress = d.status === "pending" ? 0 : lane.bakeMs > 0 ? Math.min(1, inStage / lane.bakeMs) : 1;
  return (
    <div className="min-w-0">
      <div className="flex gap-1" role="img" aria-label={`Stage ${Math.min(d.step_index + 1, lane.weights.length)} of ${lane.weights.length}, canary at ${d.weight}%`}>
        {lane.weights.map((w, i) => {
          const s = states[i] ?? "pending";
          const fill = s === "pass" ? 1 : s === "active" ? Math.max(0.06, progress) : s === "fail" ? 1 : 0;
          return (
            <div key={i} className="min-w-0 flex-1" title={`${w}% · ${s === "active" ? "current stage" : s === "pass" ? "done" : s === "fail" ? "failed" : "upcoming"}`}>
              <div className="relative h-1.5 overflow-hidden rounded-full bg-con-row">
                {fill > 0 && (
                  <span
                    className={cn(
                      "con-grow-x absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-[cubic-bezier(0.2,0.7,0.2,1)] motion-reduce:transition-none",
                      s === "pass" && "bg-con-fg3",
                      s === "active" && "bg-con-info",
                      s === "fail" && "bg-con-bad",
                    )}
                    style={{ width: `${fill * 100}%`, animationDelay: `${i * 60}ms` }}
                  />
                )}
              </div>
              <div
                className={cn(
                  "mt-1 font-mono text-[10.5px] tabular-nums",
                  s === "active" ? "text-con-fg" : s === "pass" ? "text-con-fg3" : s === "fail" ? "text-con-bad" : "text-con-fg3/70",
                )}
              >
                {w}%
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VerdictChips({ lane }: { lane: Lane }) {
  if (lane.verdicts.length === 0) return <span className="text-[12px] text-con-fg3">No verdict yet</span>;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Latest verdict per metric">
      {lane.verdicts.map((v) => (
        <li
          key={v.metric}
          title={v.reason ? `${metricLabel(v.metric)}: ${v.reason}` : `${metricLabel(v.metric)}: ${v.pass ? "no regression" : "regression"}`}
          className={cn(
            "inline-flex h-[22px] items-center gap-1 rounded-full border px-2 text-[11.5px]",
            v.pass ? "border-con-line text-con-fg2" : "border-con-bad/40 bg-con-bad/[0.07] text-con-bad",
          )}
        >
          {v.pass ? <Check size={11} strokeWidth={2.5} className="text-con-fg3" /> : <X size={11} strokeWidth={2.5} />}
          {metricLabel(v.metric)}
        </li>
      ))}
    </ul>
  );
}

function LaneRow({ lane, events, now, canRollBack }: { lane: Lane; events: DeployEvent[]; now: number; canRollBack: boolean }) {
  const d = lane.dep;
  const states = stageStates(d, events);
  const inStage = Math.max(0, now - Date.parse(lane.stageSince));
  const stage = Math.min(d.step_index + 1, lane.weights.length || 1);
  const over = lane.bakeMs > 0 && inStage > lane.bakeMs;
  return (
    <li className={cn("con-ease grid gap-x-6 gap-y-3 py-4 hover:bg-con-hover/60 group-data-[density=compact]/ov:py-3 @3xl:grid-cols-[minmax(180px,1fr)_minmax(220px,1.7fr)_auto]", PAD_X)}>
      {/* Who and what */}
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <Link href={`/app/deployments/${d.id}`} className="truncate text-[14px] font-semibold text-con-fg hover:underline hover:underline-offset-4">
            {d.service}
          </Link>
          {d.ref && <span className="shrink-0 font-mono text-[12px] text-con-fg2">{d.ref}</span>}
          <RiskValue score={d.risk?.score ?? 0} className="ml-auto shrink-0 @3xl:hidden [&>span:first-child]:w-auto [&>span:first-child]:text-[12px]" />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-con-fg3">
          <span>{d.environment ?? "production"}</span>
          <span aria-hidden>·</span>
          <span>started {ago(d.created_at, now)}</span>
          <span aria-hidden className="hidden @3xl:inline">·</span>
          <RiskValue score={d.risk?.score ?? 0} className="hidden @3xl:inline-flex [&>span:first-child]:w-auto [&>span:first-child]:text-[12px]" />
        </div>
      </div>

      {/* Stage track */}
      <div className="min-w-0">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate text-[12px] text-con-fg2">
            {d.status === "pending" ? "Waiting to start" : `Stage ${stage} of ${lane.weights.length || 1}`}
            <span
              className="text-con-fg3"
              title={over ? "Bake time is over; the next verdict decides whether traffic moves on." : "Time in the current stage, of its bake time"}
            >
              {" · "}
              {span(inStage)}
              {lane.bakeMs > 0 ? ` / ${span(lane.bakeMs)} bake` : " in stage"}
            </span>
          </span>
          <span className="shrink-0 text-[18px] font-semibold leading-none tracking-[-0.02em] text-con-fg">
            <CountUp value={d.status === "pending" ? 0 : d.weight} suffix="%" />
          </span>
        </div>
        <StageTrack lane={lane} states={states} now={now} />
      </div>

      {/* Verdicts and actions */}
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 @3xl:flex-col @3xl:items-end @3xl:justify-center">
        <VerdictChips lane={lane} />
        <div className="flex items-start gap-1.5">
          <Link href={`/app/deployments/${d.id}`} className={cn(SMALL_BUTTON, GHOST_BUTTON)}>
            View
            <ArrowRight size={12} />
          </Link>
          {canRollBack && <LaneRollback id={d.id} service={d.service} />}
        </div>
      </div>
    </li>
  );
}

export function LiveLanes({ lanes, events, now, canRollBack }: { lanes: Lane[]; events: Map<string, DeployEvent[]>; now: number; canRollBack: boolean }) {
  return (
    <Panel
      widget="lanes"
      label="Live rollouts"
      flush
      title={
        <h2 className="flex items-center gap-2 text-[14px] font-semibold tracking-[-0.01em] text-con-fg">
          Live rollouts
          <Count className={lanes.length ? "bg-con-info/15 text-con-info" : undefined}>{lanes.length}</Count>
        </h2>
      }
      tip="Releases taking a share of traffic right now. Each stage bakes, then the canary is compared with the stable version per metric before more traffic moves. Updates live."
      aside={<PanelLink href="/app/deployments?status=rolling">View all</PanelLink>}
    >
      {lanes.length === 0 ? (
        <div className={cn("flex items-center gap-4 border-t border-con-row py-6", PAD_X)}>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-con-line text-con-fg3">
            <Radio size={16} />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-con-fg">No rollout in progress</p>
            <p className="mt-0.5 text-[12px] text-con-fg3">When a release starts, its stages, canary traffic and verdicts stream in here.</p>
          </div>
        </div>
      ) : (
        <ul className="con-stagger @container divide-y divide-con-row border-t border-con-row">
          {lanes.map((l) => (
            <LaneRow key={l.dep.id} lane={l} events={events.get(l.dep.id) ?? []} now={now} canRollBack={canRollBack} />
          ))}
        </ul>
      )}
    </Panel>
  );
}
