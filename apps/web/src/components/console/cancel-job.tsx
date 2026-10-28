"use client";

import { useActionState } from "react";
import { cancelJob, type DeployState } from "@/app/app/actions";
import { retryJob } from "@/app/app/jobs/actions";
import { Spinner } from "@/components/console/loader";
import { undoToast } from "@/components/console/shell-toast";

/** Cancels a queued job. Undo queues an equivalent job again (same kind and payload) via retryJob. */
export function CancelJobButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState<DeployState, FormData>(async (prev, fd) => {
    const r = await cancelJob(prev, fd);
    if (r?.ok) {
      undoToast("Job canceled", () => {
        const again = new FormData();
        again.set("id", id);
        return retryJob(undefined, again);
      });
    }
    return r;
  }, undefined);
  return (
    <form action={action} className="inline-flex flex-col items-end">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-con-line px-2 text-[12px] text-con-fg2 hover:border-con-line-hover hover:text-con-fg disabled:opacity-60 max-md:h-11"
      >
        {pending && <Spinner size={12} />}
        Cancel
      </button>
      {state?.error && <span className="mt-1 max-w-[200px] text-right text-[11px] text-con-bad">{state.error}</span>}
    </form>
  );
}
