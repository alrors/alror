"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { RotateCcw } from "lucide-react";
import { rollback, undoRollback, type RollbackState } from "@/app/app/actions";
import { buttonClass } from "@/components/console/primitives";
import { undoToast } from "@/components/console/shell-toast";
import { cn } from "@/lib/site";
import { Spinner } from "@/components/console/loader";

/**
 * "Rolling back <service>" with Undo. Undo cancels the queued rollback job while it
 * is still queued; once a runner has claimed it, the follow-up toast says so.
 */
export function rollbackQueuedToast(service: string, jobId: string | undefined, onUndone?: () => void) {
  if (!jobId) return;
  undoToast(`Rolling back ${service}`, async () => {
    const r = await undoRollback(jobId);
    if (r?.ok) onUndone?.();
    return r;
  }, { description: "Traffic returns to the stable version." });
}

/** Rollback is a safety action: it queues on the first click, then offers Undo. */
export function RollbackButton({ id, service, className }: { id: string; service: string; className?: string }) {
  const [undone, setUndone] = useState<string | null>(null);
  const [state, action, pending] = useActionState<RollbackState, FormData>(async (prev, fd) => {
    const r = await rollback(prev, fd);
    if (r?.ok) rollbackQueuedToast(service, r.jobId, () => setUndone(r.jobId ?? null));
    return r;
  }, undefined);
  const queued = state?.ok && state.jobId !== undone;

  return (
    <form action={action} className={cn("flex flex-col gap-2", className)}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending || queued} className={cn(buttonClass.danger, "w-full max-md:h-11")} aria-label={`Roll back ${service}`}>
        {pending ? <Spinner size={14} /> : <RotateCcw size={14} />}
        {pending ? "Rolling back" : queued ? "Rollback queued" : "Roll back"}
      </button>
      <div aria-live="polite">
        {state?.error && <p className="text-[12px] text-con-bad">{state.error}</p>}
        {queued && (
          <p className="text-[12px] text-con-fg2">
            An alror runner rolls it back shortly. Track it in{" "}
            <Link href="/app/jobs" className="text-con-fg underline-offset-4 hover:underline">
              Jobs
            </Link>
            .
          </p>
        )}
      </div>
    </form>
  );
}
