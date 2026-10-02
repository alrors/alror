"use client";

import { useState } from "react";
import { buttonClass } from "@/components/console/primitives";
import { useActionToast, useRetryableAction } from "@/components/console/shell-toast";
import { cn } from "@/lib/site";
import { Spinner } from "@/components/console/loader";

type Result = { ok?: boolean; error?: string; message?: string; retryable?: boolean } | undefined;

/**
 * A small button that runs a server action after an inline confirmation
 * (revoke, remove, archive). Hidden fields carry the ids.
 */
export function ConfirmAction({
  action,
  fields,
  label,
  confirmLabel,
  prompt,
  tone = "danger",
  className,
  icon,
}: {
  action: (prev: Result, formData: FormData) => Promise<Result>;
  fields: Record<string, string>;
  label: string;
  confirmLabel?: string;
  prompt?: string;
  tone?: "danger" | "secondary";
  className?: string;
  icon?: React.ReactNode;
}) {
  // Success shows a toast. Errors the user can act on (validation, permissions) stay
  // next to the button; retryable failures (an outage, an unexpected error) toast with Retry.
  const [state, formAction, pending, retry] = useRetryableAction<Result>(action, undefined);
  const inlineError = state?.error && !state.retryable ? state.error : null;
  useActionToast(inlineError ? undefined : state, { success: `${label}: done.`, retry });
  const [confirming, setConfirming] = useState(false);
  return (
    <form
      action={(fd) => {
        setConfirming(false);
        formAction(fd);
      }}
      className={cn("inline-flex flex-col items-end gap-1", className)}
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {confirming ? (
        <span className="con-fade inline-flex items-center gap-2">
          {prompt && <span className="hidden text-[12px] text-con-fg2 sm:inline">{prompt}</span>}
          <button type="button" onClick={() => setConfirming(false)} className={buttonClass.secondary}>
            Cancel
          </button>
          <button type="submit" className={tone === "danger" ? buttonClass.danger : buttonClass.secondary}>
            {confirmLabel ?? label}
          </button>
        </span>
      ) : (
        <button type="button" disabled={pending} onClick={() => setConfirming(true)} className={tone === "danger" ? buttonClass.danger : buttonClass.secondary}>
          {pending ? <Spinner size={14} /> : icon}
          {label}
        </button>
      )}
      {inlineError && <p className="max-w-[260px] text-right text-[12px] text-con-bad">{inlineError}</p>}
    </form>
  );
}
