// What a deployment's recorded rollback result lets the console claim about
// traffic. Pure, safe on server and client. Only a simulated target can say
// traffic is back on stable; a real driver can only say its command succeeded.

import type { Deployment, Recovery } from "./types";

/**
 * Deployments created before the workspace stored `recovery` came from clients
 * whose result was dropped, so they keep the older wording. Anything newer
 * without a recovery reported no rollback result, and the console claims none.
 */
export const RECOVERY_REPORTED_SINCE = Date.parse("2026-10-29T00:00:00Z");

/** A reported Recovery, "legacy" (an older row, result unknown) or "unreported" (no rollback result). */
export type RecoveryState = Recovery | "legacy" | "unreported";

export function recoveryState(d: Pick<Deployment, "recovery" | "created_at">): RecoveryState {
  if (d.recovery) return d.recovery;
  const created = Date.parse(d.created_at);
  return Number.isFinite(created) && created < RECOVERY_REPORTED_SINCE ? "legacy" : "unreported";
}

/** The sentence about traffic after a rollback; empty when nothing can be claimed. */
export const RECOVERY_SENTENCE: Record<RecoveryState, string> = {
  rollback_simulated: "Traffic went back to the stable version (simulated).",
  rollback_requested: "Rollback requested; traffic split not confirmed.",
  rollback_failed: "Rollback failed; production state unknown. Check the target now.",
  legacy: "Traffic went back to the stable version.",
  unreported: "",
};

export function recoverySentence(d: Pick<Deployment, "recovery" | "created_at">): string {
  return RECOVERY_SENTENCE[recoveryState(d)];
}

/** True when the console must not show a traffic percentage as fact. */
export function trafficUnconfirmed(d: Pick<Deployment, "status" | "recovery">): boolean {
  if (d.recovery === "rollback_requested" || d.recovery === "rollback_failed") return true;
  return d.status === "failed" && d.recovery !== "rollback_simulated";
}
