"use client";

import { useActionState } from "react";
import Link from "next/link";
import { RotateCw } from "lucide-react";
import { retryJob, type RetryState } from "@/app/app/jobs/actions";
import { Spinner } from "@/components/console/loader";

/** Queues a fresh copy of a failed or canceled job. */
export function RetryJobButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState<RetryState, FormData>(retryJob, undefined);
  return (
    <form action={action} className="inline-flex flex-col items-end">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending || state?.ok}
        className="con-ease inline-flex h-7 items-center gap-1.5 rounded-md border border-con-line px-2 text-[12px] text-con-fg2 hover:border-con-line-hover hover:text-con-fg disabled:opacity-60"
      >
        {pending ? <Spinner size={12} /> : <RotateCw size={12} />}
        {state?.ok ? "Queued" : "Retry"}
      </button>
      <span aria-live="polite">
        {state?.error && <span className="mt-1 block max-w-[220px] text-right text-[11px] text-con-bad">{state.error}</span>}
        {state?.ok && (
          <Link href="/app/jobs?status=queued" className="con-fade mt-1 block text-right text-[11px] text-con-fg2 hover:text-con-fg">
            New job {state.jobId?.slice(0, 8)}
          </Link>
        )}
      </span>
    </form>
  );
}
