"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { RotateCcw } from "lucide-react";
import { rollback, type RollbackState } from "@/app/app/actions";
import { Spinner } from "@/components/console/loader";
import { rollbackQueuedToast } from "@/components/console/rollback-button";
import { cn } from "@/lib/site";
import { SMALL_BUTTON as small } from "./ui";

/** Compact "Roll back" for rows and lanes. Runs on the first click; success is an Undo toast, errors stay inline. */
export function LaneRollback({ id, service, className }: { id: string; service: string; className?: string }) {
  const [undone, setUndone] = useState<string | null>(null);
  const [state, action, pending] = useActionState<RollbackState, FormData>(async (prev, fd) => {
    const r = await rollback(prev, fd);
    if (r?.ok) rollbackQueuedToast(service, r.jobId, () => setUndone(r.jobId ?? null));
    return r;
  }, undefined);
  const queued = state?.ok && state.jobId !== undone;

  return (
    <form action={action} className={cn("inline-flex flex-col items-end gap-1", className)}>
      <input type="hidden" name="id" value={id} />
      {queued ? (
        <Link href="/app/jobs" className={cn(small, "border border-con-line text-con-fg2 hover:bg-con-hover hover:text-con-fg max-md:h-11")}>
          Rollback queued · Track
        </Link>
      ) : (
        <button
          type="submit"
          disabled={pending}
          aria-label={`Roll back ${service}`}
          className={cn(small, "border border-con-bad/35 text-con-bad hover:border-con-bad/70 hover:bg-con-bad/[0.06] max-md:h-11")}
        >
          {pending ? <Spinner size={12} /> : <RotateCcw size={12} />}
          {pending ? "Queueing" : "Roll back"}
        </button>
      )}
      {state?.error && <p className="max-w-[220px] text-right text-[11px] text-con-bad">{state.error}</p>}
    </form>
  );
}
