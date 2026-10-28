"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { RotateCcw } from "lucide-react";
import { rollbackCandidate, type IncidentRollbackState } from "@/app/app/incidents/actions";
import { Spinner } from "@/components/console/loader";
import { buttonClass } from "@/components/console/primitives";
import { rollbackQueuedToast } from "@/components/console/rollback-button";
import { cn } from "@/lib/site";

/** One-click "Roll back" for a ranked candidate: queues a rollback job on the first click, then offers Undo. */
export function CandidateRollback({ incident, deployment, service, primary }: { incident: string; deployment: string; service: string; score: number; primary?: boolean }) {
  const [undone, setUndone] = useState<string | null>(null);
  const [state, action, pending] = useActionState<IncidentRollbackState, FormData>(async (prev, fd) => {
    const r = await rollbackCandidate(prev, fd);
    if (r?.ok) rollbackQueuedToast(service, r.jobId, () => setUndone(r.jobId ?? null));
    return r;
  }, undefined);

  if (state?.ok && state.jobId !== undone) {
    return (
      <p className="con-fade text-[12px] text-con-fg2" aria-live="polite">
        Rollback queued.{" "}
        <Link href="/app/jobs" className="text-con-fg underline-offset-4 hover:underline">
          Track it in Jobs
        </Link>
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col items-end gap-1.5">
      <input type="hidden" name="incident" value={incident} />
      <input type="hidden" name="deployment" value={deployment} />
      <button type="submit" disabled={pending} className={cn(primary ? buttonClass.danger : buttonClass.secondary, "max-md:h-11")} aria-label={`Roll back ${service} (${deployment})`}>
        {pending ? <Spinner size={14} /> : <RotateCcw size={14} />}
        {pending ? "Queuing" : "Roll back"}
      </button>
      {state?.error && (
        <p className="max-w-[260px] text-right text-[12px] text-con-bad" aria-live="polite">
          {state.error}
        </p>
      )}
    </form>
  );
}
