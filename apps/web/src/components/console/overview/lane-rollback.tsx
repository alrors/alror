"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { rollback, type RollbackState } from "@/app/app/actions";
import { Spinner } from "@/components/console/loader";
import { toast } from "@/components/console/shell-toast";
import { cn } from "@/lib/site";
import { SMALL_BUTTON as small } from "./ui";


/** Compact "Roll back" with an inline confirm, for rows and lanes. Success is a toast; errors stay inline. */
export function LaneRollback({ id, service, className }: { id: string; service: string; className?: string }) {
  const [state, action, pending] = useActionState<RollbackState, FormData>(async (prev, fd) => {
    const r = await rollback(prev, fd);
    if (r?.ok) toast.success(`Rollback queued for ${service}`, { description: "A runner sends traffic back to the stable version shortly." });
    return r;
  }, undefined);
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  return (
    <form
      action={(fd) => {
        setConfirming(false);
        action(fd);
      }}
      className={cn("inline-flex flex-col items-end gap-1", className)}
    >
      <input type="hidden" name="id" value={id} />
      {confirming ? (
        <span className="con-fade inline-flex items-center gap-1.5" onKeyDown={(e) => e.key === "Escape" && setConfirming(false)}>
          <button type="button" onClick={() => setConfirming(false)} className={cn(small, "border border-con-line text-con-fg2 hover:bg-con-hover hover:text-con-fg")}>
            Cancel
          </button>
          <button ref={confirmRef} type="submit" className={cn(small, "bg-con-bad text-black hover:bg-[#f46a6e]")} aria-label={`Confirm rollback of ${service}`}>
            <RotateCcw size={12} />
            Confirm
          </button>
        </span>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() => setConfirming(true)}
          aria-label={`Roll back ${service}`}
          className={cn(small, "border border-con-bad/35 text-con-bad hover:border-con-bad/70 hover:bg-con-bad/[0.06]")}
        >
          {pending ? <Spinner size={12} /> : <RotateCcw size={12} />}
          {pending ? "Queueing" : "Roll back"}
        </button>
      )}
      {state?.error && <p className="max-w-[220px] text-right text-[11px] text-con-bad">{state.error}</p>}
    </form>
  );
}
