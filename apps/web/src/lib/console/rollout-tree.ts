// Builds the rollout tree shown on deployment pages from a deployment and its
// event log. Pure and deterministic (pass `now`), so it is easy to test.

import type { DeployEvent, Deployment, MetricResult } from "./types";

export type NodeState = "pass" | "fail" | "active" | "pending" | "skipped";

export type Leaf =
  | { kind: "shift"; from: number; to: number; at: string }
  | { kind: "metric"; result: MetricResult; at: string }
  | { kind: "note"; tone: "warn" | "bad" | "good" | "info" | "muted"; text: string; at?: string };

export type StageNode = {
  index: number;
  weight: number;
  label: string; // "5% canary" | "100% promote"
  state: NodeState;
  bakeNs: number;
  startedAt?: string;
  endedAt?: string;
  /** Milliseconds of bake left, for the active stage. */
  remainingMs?: number;
  children: Leaf[];
  /** Finished passing stages start collapsed; active and failed ones open. */
  open: boolean;
};

export type RolloutTree = {
  stages: StageNode[];
  outcome: "promoted" | "rolled_back" | "manual_rollback" | "failed" | "rolling" | "pending";
  liveWeight: number;
};

export function buildRolloutTree(d: Deployment, events: DeployEvent[], now = Date.now()): RolloutTree {
  const steps = d.plan?.steps ?? [];
  const stages: StageNode[] = steps.map((s, i) => ({
    index: i,
    weight: s.weight,
    label: s.weight >= 100 ? "100% promote" : `${s.weight}% canary`,
    state: "pending",
    bakeNs: s.bake,
    children: [],
    open: false,
  }));
  const byWeight = new Map(stages.map((s) => [s.weight, s]));
  const at = (w: number | undefined) => (w !== undefined ? byWeight.get(w) : undefined);
  let current: StageNode | undefined;
  let lastWeight = 0;
  let outcome: RolloutTree["outcome"] = d.status === "rolling" ? "rolling" : "pending";

  for (const e of events) {
    switch (e.kind) {
      case "step": {
        const s = at(e.weight);
        if (!s) break;
        current = s;
        s.startedAt = e.at;
        s.state = "active";
        s.children.push({ kind: "shift", from: lastWeight, to: s.weight, at: e.at });
        lastWeight = s.weight;
        break;
      }
      case "verdict": {
        const s = at(e.weight) ?? current;
        if (!s) break;
        if (e.verdict) {
          s.endedAt = e.at;
          for (const r of e.verdict.results ?? []) s.children.push({ kind: "metric", result: r, at: e.at });
          s.state = e.verdict.pass ? "pass" : "fail";
        } else {
          // Shadow mode: the engine logs a recommendation and keeps going.
          s.children.push({ kind: "note", tone: "warn", text: e.message, at: e.at });
          s.state = "pass";
        }
        break;
      }
      case "promoted": {
        const s = at(100) ?? stages[stages.length - 1];
        if (!s) break;
        s.startedAt = s.endedAt = e.at;
        s.state = "pass";
        s.children.push({ kind: "shift", from: lastWeight, to: 100, at: e.at });
        s.children.push({ kind: "note", tone: "good", text: "promoted to 100%", at: e.at });
        lastWeight = 100;
        outcome = "promoted";
        break;
      }
      case "rolled_back": {
        if (outcome === "promoted" || !e.weight) {
          // Manual rollback, possibly after promotion: hang it off the last reached stage.
          const s = outcome === "promoted" ? stages[stages.length - 1] : current ?? stages[0];
          if (s) {
            s.children.push({ kind: "note", tone: "bad", text: `rolled back · ${e.message.replace(/^Manual rollback · /, "manual: ")}`, at: e.at });
            if (outcome !== "promoted") s.state = "fail";
          }
          outcome = "manual_rollback";
        } else {
          const s = at(e.weight) ?? current;
          if (s) {
            s.state = "fail";
            s.children.push({ kind: "note", tone: "bad", text: "rolled back · traffic returned to stable", at: e.at });
          }
          outcome = "rolled_back";
        }
        lastWeight = 0;
        break;
      }
      case "error": {
        const s = at(e.weight) ?? current ?? stages[d.step_index] ?? stages[0];
        if (s) {
          s.state = "fail";
          s.startedAt ??= e.at;
          s.endedAt = e.at;
          s.children.push({ kind: "note", tone: "bad", text: e.message, at: e.at });
          s.children.push({ kind: "note", tone: "bad", text: "aborted · traffic returned to stable", at: e.at });
        }
        outcome = "failed";
        break;
      }
    }
  }

  const halted = outcome === "rolled_back" || outcome === "failed" || (outcome === "manual_rollback" && d.status !== "promoted" && !stages.every((s) => s.state === "pass"));
  const failedAt = stages.findIndex((s) => s.state === "fail");
  for (const s of stages) {
    if (halted && failedAt >= 0 && s.index > failedAt) s.state = "skipped";
    if (s.state === "active") {
      if (d.status === "rolling") {
        const elapsed = s.startedAt ? now - Date.parse(s.startedAt) : 0;
        s.remainingMs = Math.max(0, s.bakeNs / 1e6 - elapsed);
        s.children.push({ kind: "note", tone: "info", text: "verifying canary against baseline" });
      } else {
        s.state = "pending"; // interrupted without a verdict
      }
    }
    s.open = s.state === "fail" || s.state === "active" || s.children.some((c) => c.kind === "note" && c.tone === "bad");
  }

  const liveWeight = d.status === "promoted" ? 100 : d.status === "rolling" ? d.weight : 0;
  return { stages, outcome, liveWeight };
}
