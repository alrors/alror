import { Check, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/site";
import { duration, elapsed, hm, metricUnitValue, pValue, signedPct, span } from "@/lib/console/format";
import type { Leaf, NodeState, RolloutTree, StageNode } from "@/lib/console/rollout-tree";

/* Markers: 16px circles on the rail. Static; no glow or blinking. */
function Marker({ state, size = 16 }: { state: NodeState | "root"; size?: number }) {
  const base = "relative z-10 grid shrink-0 place-items-center rounded-full";
  const style = { width: size, height: size };
  switch (state) {
    case "pass":
      return (
        <span className={cn(base, "bg-con-good text-black")} style={style}>
          <Check size={size * 0.62} strokeWidth={3} />
        </span>
      );
    case "fail":
      return (
        <span className={cn(base, "bg-con-bad text-black")} style={style}>
          <X size={size * 0.62} strokeWidth={3} />
        </span>
      );
    case "active":
      return (
        <span className={cn(base, "border border-con-info bg-con-bg")} style={style}>
          <span className="h-1/2 w-1/2 rounded-full bg-con-info" />
        </span>
      );
    case "root":
      return (
        <span className={cn(base, "border border-con-line-hover bg-con-row")} style={style}>
          <span className="h-[40%] w-[40%] rounded-full bg-con-fg" />
        </span>
      );
    default:
      return <span className={cn(base, "border border-dashed bg-con-bg", state === "skipped" ? "border-con-line" : "border-con-fg3")} style={style} />;
  }
}

const elbow =
  "relative pl-5 before:absolute before:left-0 before:top-0 before:h-[13px] before:w-3.5 before:rounded-bl-[4px] before:border-b before:border-l before:border-con-line-hover before:content-[''] [&:not(:last-child)]:after:absolute [&:not(:last-child)]:after:bottom-0 [&:not(:last-child)]:after:left-0 [&:not(:last-child)]:after:top-0 [&:not(:last-child)]:after:border-l [&:not(:last-child)]:after:border-con-line-hover [&:not(:last-child)]:after:content-['']";

const noteTone = {
  good: "text-con-good",
  bad: "text-con-bad",
  warn: "text-con-warn",
  info: "text-con-info",
  muted: "text-con-fg3",
};

function LeafRow({ leaf }: { leaf: Leaf }) {
  if (leaf.kind === "shift") {
    return (
      <span className="text-con-fg2">
        shifted traffic <span className="font-mono tabular-nums text-con-fg">{leaf.from}%</span> →{" "}
        <span className="font-mono tabular-nums text-con-fg">{leaf.to}%</span>
        <span className="ml-2 font-mono text-[12px] text-con-fg3">{hm(leaf.at)}</span>
      </span>
    );
  }
  if (leaf.kind === "note") {
    return (
      <span className={cn("break-words", noteTone[leaf.tone])}>
        {leaf.tone === "bad" && "↳ "}
        {leaf.tone === "warn" && "shadow · "}
        {leaf.text}
      </span>
    );
  }
  const r = leaf.result;
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[12.5px] tabular-nums">
      <span className="text-con-fg3">verify</span>
      <span className="w-[92px] text-con-fg">{r.metric}</span>
      <span className="text-con-fg2">
        {metricUnitValue(r.metric, r.canary)} <span className="text-con-fg3">vs</span> {metricUnitValue(r.metric, r.baseline)}
      </span>
      <span className={r.pass ? "text-con-fg2" : "text-con-bad"}>{signedPct(r.delta)}</span>
      <span className="text-con-fg3">p={pValue(r.p_value)}</span>
      {r.pass ? <Check size={14} className="text-con-good" aria-label="pass" /> : <X size={14} className="text-con-bad" aria-label="fail" />}
      {!r.pass && r.reason && <span className="basis-full font-sans text-[12px] text-con-bad sm:basis-auto">{r.reason}</span>}
    </span>
  );
}

function stageMeta(s: StageNode): string {
  const parts: string[] = [];
  if (s.bakeNs) parts.push(`bake ${duration(s.bakeNs)}`);
  if (s.state === "active" && s.remainingMs !== undefined) parts.push(s.remainingMs > 0 ? `${span(s.remainingMs)} left` : "awaiting verdict");
  else if (s.startedAt && s.endedAt && s.startedAt !== s.endedAt)
    parts.push(`${hm(s.startedAt)} → ${hm(s.endedAt)} (took ${elapsed(s.startedAt, s.endedAt)})`);
  else if (s.startedAt) parts.push(hm(s.startedAt));
  if (s.state === "pending") parts.push("pending");
  if (s.state === "skipped") parts.push("skipped");
  return parts.join(" · ");
}

const stateWord: Partial<Record<NodeState, { text: string; cls: string }>> = {
  active: { text: "rolling", cls: "text-con-info" },
  fail: { text: "failed", cls: "text-con-bad" },
};

function StageRow({ s, compact }: { s: StageNode; compact?: boolean }) {
  const dim = s.state === "pending" || s.state === "skipped";
  const head = (
    <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
      <span className="flex items-baseline gap-2">
        <span className={cn("text-[14px] font-medium", dim ? "text-con-fg3" : "text-con-fg", s.state === "skipped" && "line-through decoration-con-line-hover")}>
          {s.label}
        </span>
        {stateWord[s.state] && <span className={cn("text-[13px]", stateWord[s.state]!.cls)}>{stateWord[s.state]!.text}</span>}
      </span>
      <span className="font-mono text-[12.5px] tabular-nums text-con-fg3">{stageMeta(s)}</span>
    </div>
  );

  if (compact) {
    return <div className="flex min-h-5 items-start">{head}</div>;
  }
  if (s.children.length === 0) {
    return <div className="flex min-h-5 items-start pl-5">{head}</div>;
  }
  return (
    <details open={s.open} className="group/stage">
      <summary className="-ml-1 flex min-h-5 cursor-pointer list-none items-start gap-1 rounded-sm pl-1 outline-none focus-visible:ring-1 focus-visible:ring-con-line-hover">
        <ChevronRight size={14} className="mt-[3px] shrink-0 text-con-fg3 transition-transform duration-150 group-open/stage:rotate-90" />
        {head}
      </summary>
      <ul className="mb-1 mt-2 text-[13px]">
        {s.children.map((leaf, i) => (
          <li key={i} className={cn(elbow, "pb-1.5 leading-[26px] last:pb-0")}>
            <LeafRow leaf={leaf} />
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Vertical git-graph style rollout tree. The root is the release; each stage hangs
 * off one continuous rail, with its traffic shift and verdicts as children.
 */
export function RolloutTreeView({ tree, root, compact, animate }: { tree: RolloutTree; root?: React.ReactNode; compact?: boolean; animate?: boolean }) {
  const rows = tree.stages;
  return (
    <ol className={cn("relative", animate && "con-stagger")}>
      {root && (
        <li className={cn("relative flex gap-3", compact ? "pb-3" : "pb-5")}>
          <span aria-hidden className="absolute bottom-0 left-[7.5px] top-4 w-px bg-con-line-hover" />
          <Marker state="root" />
          <div className="min-w-0 flex-1 -mt-0.5">{root}</div>
        </li>
      )}
      {rows.map((s, i) => {
        const last = i === rows.length - 1;
        return (
          <li key={s.index} className={cn("relative flex gap-3", !last && (compact ? "pb-2.5" : "pb-4"))}>
            {!last && <span aria-hidden className="absolute bottom-0 left-[7.5px] top-4 w-px bg-con-line-hover" />}
            <Marker state={s.state} />
            <div className="min-w-0 flex-1">
              <StageRow s={s} compact={compact} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
