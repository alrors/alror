import type { ReactNode } from "react";
import { Check, ChevronDown, GitBranch, GitCommitHorizontal, GitMerge, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/site";
import { duration, elapsed, hm, metricUnitValue, pValue, signedPct, span } from "@/lib/console/format";
import type { Leaf, NodeState, RolloutTree, StageNode } from "@/lib/console/rollout-tree";
import styles from "./rollout-tree.module.css";

const stateLabel: Record<NodeState, string> = {
  pass: "Passed", warning: "Continued with warnings", fail: "Failed", active: "Verifying", pending: "Waiting", skipped: "Not reached",
};

function Marker({ state, merge = false }: { state: NodeState | "root"; merge?: boolean }) {
  return (
    <span className={styles.marker} data-state={state} aria-hidden="true">
      {merge ? <GitMerge size={12} /> : state === "pass" ? <Check size={12} strokeWidth={2.5} /> :
        state === "fail" ? <X size={12} strokeWidth={2.5} /> : <span className={styles.markerDot} />}
    </span>
  );
}

/** Fixed-radius curves at the top; CSS rails fill the remaining row height. */
function Rails({ first, merge, last, state }: { first?: boolean; merge?: boolean; last?: boolean; state: NodeState | "root" }) {
  return (
    <div className={styles.rails} data-state={state} aria-hidden="true">
      <span className={styles.stableRail} />
      <svg className={styles.curve} viewBox="0 0 72 40" fill="none">
        <path d={first ? "M 16 0 C 16 22 48 10 48 32 L 48 40" : merge ? "M 48 0 C 48 22 16 10 16 32 L 16 40" : "M 48 0 L 48 40"} />
      </svg>
      {!merge && !last && <span className={styles.canaryRail} />}
      <span className={cn(styles.markerPosition, merge && styles.onStable)}>
        <Marker state={state} merge={merge} />
      </span>
    </div>
  );
}

function LeafRow({ leaf }: { leaf: Leaf }) {
  if (leaf.kind === "shift") {
    return <div className={styles.leafText}>Traffic shifted <strong>{leaf.from}% &rarr; {leaf.to}%</strong><time>{hm(leaf.at)}</time></div>;
  }
  if (leaf.kind === "note") {
    return <p className={styles.note} data-tone={leaf.tone}>{leaf.text}</p>;
  }
  const r = leaf.result;
  return (
    <div className={styles.metric}>
      <div className={styles.metricName}>
        {r.pass ? <Check size={13} aria-label="Passed" /> : <X size={13} className={styles.bad} aria-label="Failed" />}
        <span>{r.metric}</span>
      </div>
      <div className={styles.metricValues}>
        <strong>{metricUnitValue(r.metric, r.canary)}</strong><span>vs {metricUnitValue(r.metric, r.baseline)}</span>
        <span className={!r.pass ? styles.bad : undefined}>{signedPct(r.delta)}</span><span>p={pValue(r.p_value)}</span>
      </div>
      {!r.pass && r.reason && <p className={styles.metricReason}>{r.reason}</p>}
    </div>
  );
}

function stageMeta(s: StageNode) {
  if (s.state === "active" && s.remainingMs !== undefined) return s.remainingMs > 0 ? "About " + span(s.remainingMs) + " remaining" : "Awaiting verdict";
  if (s.startedAt && s.endedAt && s.startedAt !== s.endedAt) return elapsed(s.startedAt, s.endedAt) + " observed";
  if (s.bakeNs) return duration(s.bakeNs) + " observation";
  return s.weight >= 100 ? "Full traffic" : "No observation window";
}

function StageCard({ s, compact }: { s: StageNode; compact?: boolean }) {
  const failedMetrics = s.children.filter((leaf) => leaf.kind === "metric" && !leaf.result.pass).length;
  const shadow = s.children.some((leaf) => leaf.kind === "note" && leaf.tone === "warn");
  const label = shadow && failedMetrics ? "Continued with warnings" : s.weight >= 100 && s.state === "pass" ? "Promoted" : stateLabel[s.state];
  const heading = (
    <>
      <div className={styles.stageHeading}>
        <span className={styles.stageTitle}>{s.weight >= 100 ? "Promote release" : s.weight + "% canary"}</span>
        <span className={styles.badge} data-state={shadow && failedMetrics ? "warning" : s.state}>{label}</span>
      </div>
      {!compact && <div className={styles.stageMeta}><span>{stageMeta(s)}</span>{s.startedAt && <time>{hm(s.startedAt)}</time>}</div>}
    </>
  );
  if (compact) return <div className={styles.compactStage}>{heading}</div>;
  if (!s.children.length) return <div className={styles.stageCard} data-state={s.state}>{heading}</div>;
  return (
    <details className={styles.stageCard} data-state={s.state} open={s.open}>
      <summary className={styles.stageSummary}>
        <div className={styles.summaryContent}>{heading}</div>
        <ChevronDown size={15} className={styles.chevron} aria-hidden="true" />
      </summary>
      <div className={styles.stageDetails}>
        <p className={styles.detailLabel}>Traffic & verification</p>
        <ul className={styles.leaves}>
          {s.children.map((leaf, i) => <li key={i} className={styles.leaf}><LeafRow leaf={leaf} /></li>)}
        </ul>
      </div>
    </details>
  );
}

export function RolloutTreeView({ tree, root, compact, animate }: { tree: RolloutTree; root?: ReactNode; compact?: boolean; animate?: boolean }) {
  const stopped = ["rolled_back", "manual_rollback", "failed"].includes(tree.outcome);
  const rows = tree.stages.filter((s) => !stopped || (s.state !== "skipped" && s.state !== "pending"));
  const unreached = tree.stages.filter((s) => !rows.includes(s));
  const returned = tree.outcome === "rolled_back" || tree.outcome === "manual_rollback";
  const promoted = tree.outcome === "promoted";
  const merged = rows.at(-1)?.weight === 100 && rows.at(-1)?.state === "pass";
  return (
    <div className={cn(styles.graph, compact && styles.compact)} aria-label="Rollout branch graph">
      {!compact && <div className={styles.legend}>
        <span><span className={styles.legendStable} />Stable</span>
        <span><GitBranch size={13} />Canary branch</span>
        <span className={styles.legendHint}>Expand a stage for details</span>
      </div>}
      <ol className={cn(styles.rows, animate && "con-stagger")}>
        <li className={styles.root}>
          <span className={styles.rootRail} aria-hidden="true" />
          <span className={styles.rootMarker}><Marker state="root" /></span>
          <div className={styles.rootContent}>
            {root ?? <span className={styles.rootLabel}><GitCommitHorizontal size={15} />Release created</span>}
            {!compact && <p>Branch from the stable release</p>}
          </div>
        </li>
        {rows.map((s, i) => {
          const merge = s.weight >= 100 && s.state === "pass";
          return (
            <li className={styles.row} key={s.index} data-state={s.state}>
              <Rails first={i === 0 && !merge} merge={merge} state={s.state} last={i === rows.length - 1 && !stopped && !promoted} />
              <div className={styles.content}><StageCard s={s} compact={compact} /></div>
            </li>
          );
        })}
        {(stopped || promoted) && <li className={cn(styles.row, styles.outcomeRow)}>
          {returned && !merged ? <Rails merge state="pass" last /> :
            <><span className={cn(styles.finalRail, !promoted && !returned && styles.finalCanary)} aria-hidden="true" />
              <span className={cn(styles.finalMarker, !promoted && !returned && styles.finalCanaryMarker)}>
                <Marker state={tree.outcome === "failed" ? "fail" : "pass"} merge={promoted} />
              </span></>}
          <div className={cn(styles.content, styles.outcome)}>
            <div className={styles.outcomeTitle}>
              {returned ? <RotateCcw size={14} /> : promoted ? <GitMerge size={14} /> : <X size={14} />}
              {returned ? "Returned to stable" : promoted ? "Release is live" : "Rollout stopped"}
            </div>
            {!compact && <p>{returned ? "Rollback completed. This release is no longer receiving traffic." : promoted ?
              "100% of traffic is on this release." : "Review the failure and confirm the current traffic state."}</p>}
          </div>
        </li>}
      </ol>
      {unreached.length > 0 && !compact && <div className={styles.unreached}>
        <span>Not reached</span>
        <div>{unreached.map((s) => <span key={s.index}>{s.weight}%{s.weight >= 100 ? " promotion" : " canary"}</span>)}</div>
      </div>}
      {rows.length === 0 && !stopped && <p className={styles.empty}>Waiting for the rollout plan.</p>}
    </div>
  );
}
