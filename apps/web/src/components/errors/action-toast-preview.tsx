"use client";

import { previewFailingAction } from "@/app/app/dev/errors/actions";
import { Spinner } from "@/components/console/loader";
import { buttonClass, Card } from "@/components/console/primitives";
import { useActionToast, useRetryableAction } from "@/components/console/shell-toast";
import type { ActionResult } from "@/lib/console/action-types";

function FailingForm({ mode, label, detail }: { mode: "outage" | "unexpected"; label: string; detail: string }) {
  const [state, submit, pending, retry] = useRetryableAction<ActionResult>(previewFailingAction, undefined);
  useActionToast(state, { retry });
  return (
    <form action={submit} className="flex flex-wrap items-center justify-between gap-4 py-3">
      <input type="hidden" name="mode" value={mode} />
      <div className="min-w-0">
        <p className="text-[14px] text-con-fg">{label}</p>
        <p className="text-[13px] text-con-fg2">{detail}</p>
      </div>
      <button type="submit" disabled={pending} className={buttonClass.secondary}>
        {pending && <Spinner size={13} />}
        Run action
      </button>
    </form>
  );
}

/** /dev/errors: mutation failures as toasts with Retry (the shared useRetryableAction + useActionToast path). */
export function ActionToastPreview() {
  return (
    <Card title="Action failure toasts" description="Each button runs a development-only server action that fails. Nothing is written." className="mx-auto max-w-3xl">
      <div className="divide-y divide-con-line">
        <FailingForm mode="outage" label="Database outage" detail="The action throws a classified outage before its own error handling." />
        <FailingForm mode="unexpected" label="Unexpected error" detail="The action catches an unexpected error and returns it through actionError." />
      </div>
    </Card>
  );
}
