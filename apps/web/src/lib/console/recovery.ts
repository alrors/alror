// What a deployment's recorded rollback result lets the console claim about
// traffic. Pure, safe on server and client. Only a simulated target can say
// traffic is back on stable; a real driver can only say its command succeeded.

import type { Deployment, Recovery } from "./types";

/**
 * A reported Recovery, or "unreported" when no rollback result was recorded
 * (older clients, or no rollback attempted). Without evidence the console
 * claims nothing about traffic.
 */
export type RecoveryState = Recovery | "unreported";

export function recoveryState(d: Pick<Deployment, "recovery">): RecoveryState {
  return d.recovery ?? "unreported";
}

/** The sentence about traffic after a rollback; empty when nothing can be claimed. */
export const RECOVERY_SENTENCE: Record<RecoveryState, string> = {
  rollback_simulated: "Traffic went back to the stable version (simulated).",
  rollback_requested: "Rollback requested; traffic split not confirmed.",
  rollback_failed: "Rollback failed; production state unknown. Check the target now.",
  unreported: "",
};

export function recoverySentence(d: Pick<Deployment, "recovery">): string {
  return RECOVERY_SENTENCE[recoveryState(d)];
}

/** True when the console must not show a traffic percentage as fact. */
export function trafficUnconfirmed(d: Pick<Deployment, "status" | "recovery">): boolean {
  if (d.recovery === "rollback_requested" || d.recovery === "rollback_failed") return true;
  return d.status === "failed" && d.recovery !== "rollback_simulated";
}
