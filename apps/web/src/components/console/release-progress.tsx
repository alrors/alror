import { Check, X } from "lucide-react";
import { CountUp } from "@/components/console/count-up";
import { stageDurationMs } from "@/components/console/release-story";
import { duration, span } from "@/lib/console/format";
import type { NodeState, RolloutTree } from "@/lib/console/rollout-tree";
import type { Deployment } from "@/lib/console/types";
import { cn } from "@/lib/site";

const STATE_WORD: Record<NodeState, string> = {
  pass: "passed",
  fail: "stopped here",
  active: "verifying",
  pending: "not reached",
  skipped: "skipped",
};

/**
 * Traffic bar plus a step-by-step strip of the plan's stages. The bar grows in
 * once (con-grow-x) and the steps reveal in order (con-stagger).
 */
export function ReleaseProgress({ d, tree, now }: { d: Deployment; tree: RolloutTree; now: number }) {
  const stages = tree.stages;
  const live = tree.liveWeight;
  const reached = Math.max(0, ...stages.filter((s) => s.state !== "pending" && s.state !== "skipped").map((s) => s.weight));
  const halted = d.status === "rolled_back" || d.status === "failed";
  // Tick labels, skipping ones that would collide with the previous label.
  const ticks: number[] = [];
  for (const s of stages) if (!ticks.length || s.weight - ticks[ticks.length - 1] >= 7 || s.weight === 100) ticks.push(s.weight);
  if (ticks.length > 1 && ticks[ticks.length - 1] - ticks[ticks.length - 2] < 7) ticks.splice(ticks.length - 2, 1);
  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[13px] text-con-fg2">{halted ? "Traffic on this release (reached before stopping)" : "Traffic on this release"}</span>
          <span className="text-[22px] font-semibold leading-none tracking-[-0.02em]">
            <CountUp value={live} suffix="%" />
          </span>
        </div>
        <div className="relative mt-2.5 h-2 overflow-hidden rounded-full bg-con-row" role="img" aria-label={`${live}% of traffic${halted ? `, reached ${reached}% before stopping` : ""}`}>
          {halted && reached > 0 && <div className="con-grow-x absolute inset-y-0 left-0 rounded-full bg-con-bad/25" style={{ width: `${reached}%` }} />}
          {live > 0 && (
            <div
              className={cn("con-grow-x absolute inset-y-0 left-0 rounded-full", d.status === "rolling" ? "bg-con-info" : "bg-con-fg2")}
              style={{ width: `${live}%`, animationDelay: "120ms" }}
            />
          )}
          {stages
            .filter((s) => s.weight < 100)
            .map((s) => (
              <span key={s.index} aria-hidden className="absolute inset-y-0 w-px bg-con-bg/80" style={{ left: `${s.weight}%` }} />
            ))}
        </div>
        <div className="relative mt-1 h-4 font-mono text-[11px] tabular-nums text-con-fg3">
          {ticks.map((w) => (
            <span key={w} className={cn("absolute", w >= 100 ? "-translate-x-full" : w <= 3 ? "" : "-translate-x-1/2")} style={{ left: `${w}%` }}>
              {w}%
            </span>
          ))}
        </div>
      </div>

      <ol className="con-stagger grid gap-2" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${stages.length > 4 ? 120 : 140}px, 1fr))` }}>
        {stages.map((s, i) => {
          const ms = stageDurationMs(s.startedAt, s.endedAt, s.state === "active" ? now : undefined);
          return (
            <li
              key={s.index}
              className={cn(
                "rounded-md border px-3 py-2.5",
                s.state === "fail" ? "border-con-bad/40" : s.state === "active" ? "border-con-info/40" : "border-con-line",
                (s.state === "pending" || s.state === "skipped") && "opacity-60",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-con-fg3">Step {i + 1}</span>
                {s.state === "pass" && <Check size={13} className="text-con-good" aria-hidden />}
                {s.state === "fail" && <X size={13} className="text-con-bad" aria-hidden />}
                {s.state === "active" && <span className="h-1.5 w-1.5 rounded-full bg-con-info" aria-hidden />}
              </div>
              <div className="mt-0.5 text-[14px] font-medium text-con-fg">{s.weight >= 100 ? "Promote 100%" : `${s.weight}% canary`}</div>
              <div className={cn("text-[12px]", s.state === "fail" ? "text-con-bad" : "text-con-fg2")}>{STATE_WORD[s.state]}</div>
              <div className="mt-1.5 font-mono text-[11.5px] tabular-nums text-con-fg3">
                {ms !== null ? `took ${span(ms)}` : s.bakeNs ? `bake ${duration(s.bakeNs)}` : "no bake"}
                {s.state === "active" && s.remainingMs !== undefined && s.remainingMs > 0 && ` · ${span(s.remainingMs)} left`}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
