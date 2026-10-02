import { CountUp } from "@/components/console/count-up";
import type { RolloutTree } from "@/lib/console/rollout-tree";
import type { Deployment } from "@/lib/console/types";
import { cn } from "@/lib/site";

/** One traffic summary; the branch graph below owns the individual stages. */
export function ReleaseProgress({ d, tree }: { d: Deployment; tree: RolloutTree; now: number }) {
  const live = tree.liveWeight;
  const reached = Math.max(0, ...tree.stages.filter((s) => s.state !== "pending" && s.state !== "skipped").map((s) => s.weight));
  const stopped = d.status === "rolled_back" || d.status === "failed";
  return (
    <div className="rounded-lg border border-con-line bg-con-bg px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[12px] text-con-fg2">Traffic on this release</p>
          <p className="mt-1 text-[11px] text-con-fg3">{d.status === "failed" ? "Rollout failed. Confirm live routing in your infrastructure." : stopped ? "Reached " + reached + "% before rollback" : d.status === "promoted" ? "Promotion complete" : "Increasing only after verification"}</p>
        </div>
        <span className="text-[26px] font-semibold tracking-[-0.04em] tabular-nums">
          {d.status === "failed" ? <span className="text-[15px] text-con-fg2">Unconfirmed</span> : <CountUp value={live} suffix="%" />}
        </span>
      </div>
      <div className="relative mt-3 flex h-1.5 gap-1 overflow-hidden rounded-full bg-con-row" role="img" aria-label={d.status === "failed" ? "Traffic state unconfirmed after failure" : live + "% of traffic on this release"}>
        {d.status !== "failed" && live > 0 && <span className={cn("h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none", d.status === "rolling" ? "bg-con-info" : "bg-con-fg2")} style={{ width: live + "%" }} />}
      </div>
    </div>
  );
}
