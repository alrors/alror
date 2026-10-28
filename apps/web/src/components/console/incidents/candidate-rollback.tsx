"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { RotateCcw } from "lucide-react";
import { rollbackCandidate, type IncidentRollbackState } from "@/app/app/incidents/actions";
import { Spinner } from "@/components/console/loader";
import { buttonClass } from "@/components/console/primitives";
import { cn } from "@/lib/site";

/** One-click "Roll back" for a ranked candidate, with an inline confirmation. Queues a rollback job for the runner. */
export function CandidateRollback({ incident, deployment, service, score, primary }: { incident: string; deployment: string; service: string; score: number; primary?: boolean }) {
  const [state, action, pending] = useActionState<IncidentRollbackState, FormData>(rollbackCandidate, undefined);
  const [confirming, setConfirming] = useState(false);

  if (state?.ok) {
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
      {confirming && !pending ? (
        <div className="con-fade flex items-center gap-2">
          <span className="hidden text-[12px] text-con-fg2 sm:inline">
            Roll back {service} ({score}/100)?
          </span>
          <button type="button" onClick={() => setConfirming(false)} className={buttonClass.secondary}>
            Cancel
          </button>
          <button
            type="submit"
            onClick={() => setTimeout(() => setConfirming(false), 0)}
            className="inline-flex h-8 items-center justify-center gap-2 rounded-md bg-con-bad px-3 text-[13px] font-medium text-black transition-colors duration-150 hover:bg-[#f46a6e]"
          >
            <RotateCcw size={14} />
            Confirm
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() => setConfirming(true)}
          className={cn(primary ? buttonClass.danger : buttonClass.secondary)}
          aria-label={`Roll back ${deployment}`}
        >
          {pending ? <Spinner size={14} /> : <RotateCcw size={14} />}
          {pending ? "Queuing" : "Roll back"}
        </button>
      )}
      {state?.error && (
        <p className="max-w-[260px] text-right text-[12px] text-con-bad" aria-live="polite">
          {state.error}
        </p>
      )}
    </form>
  );
}
