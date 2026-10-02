"use client";

import { useActionState } from "react";
import { cancelJob, type DeployState } from "@/app/app/actions";
import { Spinner } from "@/components/console/loader";

export function CancelJobButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState<DeployState, FormData>(cancelJob, undefined);
  return (
    <form action={action} className="inline-flex flex-col items-end">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-con-line px-2 text-[12px] text-con-fg2 hover:border-con-line-hover hover:text-con-fg disabled:opacity-60"
      >
        {pending && <Spinner size={12} />}
        Cancel
      </button>
      {state?.error && <span className="mt-1 max-w-[200px] text-right text-[11px] text-con-bad">{state.error}</span>}
    </form>
  );
}
