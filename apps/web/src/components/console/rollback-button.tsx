"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { RotateCcw } from "lucide-react";
import { rollback, type RollbackState } from "@/app/app/actions";
import { buttonClass } from "@/components/console/primitives";
import { cn } from "@/lib/site";
import { Spinner } from "@/components/console/loader";

export function RollbackButton({ id, service }: { id: string; service: string }) {
  const [state, action, pending] = useActionState<RollbackState, FormData>(rollback, undefined);
  const [confirming, setConfirming] = useState(false);

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      {confirming && !pending ? (
        <div className="rounded-md border border-con-bad/30 p-3">
          <p className="text-[13px] text-con-fg">
            Roll back <span className="font-medium">{service}</span>? Traffic returns to the stable version.
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => setConfirming(false)} className={cn(buttonClass.secondary, "flex-1")}>
              Cancel
            </button>
            <button
              type="submit"
              onClick={() => setTimeout(() => setConfirming(false), 0)}
              className="inline-flex h-8 flex-1 items-center justify-center gap-2 rounded-md bg-con-bad px-3 text-[13px] font-medium text-black transition-colors duration-150 hover:bg-[#f46a6e]"
            >
              <RotateCcw size={14} />
              Confirm
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() => setConfirming(true)}
          className={cn(buttonClass.danger, "w-full")}
          aria-label={`Roll back ${service}`}
        >
          {pending ? <Spinner size={14} /> : <RotateCcw size={14} />}
          {pending ? "Rolling back" : "Roll back"}
        </button>
      )}
      <div aria-live="polite">
        {state?.error && <p className="text-[12px] text-con-bad">{state.error}</p>}
        {state?.ok && (
          <p className="text-[12px] text-con-fg2">
            Rollback queued. An alror runner will roll it back shortly; track it under{" "}
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
