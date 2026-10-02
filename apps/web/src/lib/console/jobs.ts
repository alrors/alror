// Pure helpers for showing jobs (safe on server and client).

import type { Tone } from "./format";

export type JobLike = {
  kind: string;
  status: string;
  payload: Record<string, unknown>;
  heartbeat_at: string | null;
  claimed_at: string | null;
};

/** Matches LEASE_SECONDS in src/lib/server/data/jobs.ts. */
export const JOB_LEASE_MS = 120_000;

export type JobPhase = "queued" | "running" | "stalled" | "done" | "failed" | "canceled";

/** A claimed job with a fresh heartbeat is running; one whose lease expired is stalled (another runner may re-claim it). */
export function jobPhase(j: JobLike, now = Date.now()): JobPhase {
  if (j.status === "claimed") {
    const beat = Date.parse(j.heartbeat_at ?? j.claimed_at ?? "");
    return Number.isFinite(beat) && now - beat > JOB_LEASE_MS ? "stalled" : "running";
  }
  return j.status as JobPhase;
}

export const PHASE: Record<JobPhase, { label: string; tone: Tone }> = {
  queued: { label: "Queued", tone: "idle" },
  running: { label: "Running", tone: "info" },
  stalled: { label: "Stalled", tone: "warn" },
  done: { label: "Done", tone: "good" },
  failed: { label: "Failed", tone: "bad" },
  canceled: { label: "Canceled", tone: "idle" },
};

/** One-line description of what the job does. */
export function jobTarget(j: JobLike): string {
  const p = j.payload ?? {};
  if (j.kind === "deploy") {
    const env = typeof p.environment === "string" ? p.environment : "production";
    return `${String(p.image ?? "")} → ${env}`;
  }
  return String(p.deployment_id ?? "");
}
