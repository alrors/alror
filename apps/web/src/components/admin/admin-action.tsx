"use client";

import { useState } from "react";
import { Spinner } from "@/components/console/loader";
import { buttonClass } from "@/components/console/primitives";
import { useActionToast, useRetryableAction } from "@/components/console/shell-toast";
import type { ActionResult } from "@/lib/console/action-types";
import { cn } from "@/lib/site";

type Action = (prev: ActionResult, fd: FormData) => Promise<ActionResult>;

/** Toasts the result of a server action once per new state; retryable failures get a Retry button when `retry` is given. */
export function useResultToast(state: ActionResult, retry?: () => void) {
  useActionToast(state, { retry });
}

/**
 * A button that runs an admin server action, with an optional inline
 * confirmation step. Results (success and errors) show as toasts.
 */
export function AdminAction({
  action,
  fields,
  label,
  confirm,
  confirmLabel,
  tone = "secondary",
  size = "md",
  icon,
  className,
}: {
  action: Action;
  fields: Record<string, string>;
  label: string;
  /** Ask before running; the text is shown next to the buttons. */
  confirm?: string;
  confirmLabel?: string;
  tone?: "secondary" | "danger";
  size?: "sm" | "md";
  icon?: React.ReactNode;
  className?: string;
}) {
  const [state, formAction, pending, retry] = useRetryableAction<ActionResult>(action, undefined);
  const [asking, setAsking] = useState(false);
  useResultToast(state, retry);
  const cls = cn(tone === "danger" ? buttonClass.danger : buttonClass.secondary, size === "sm" && "h-7 px-2 text-[12px]");
  return (
    <form
      action={(fd) => {
        setAsking(false);
        formAction(fd);
      }}
      className={cn("inline-flex items-center gap-2", className)}
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {asking ? (
        <span className="con-fade inline-flex items-center gap-2">
          {confirm && <span className="hidden max-w-[260px] text-[12px] text-con-fg2 sm:inline">{confirm}</span>}
          <button type="button" onClick={() => setAsking(false)} className={cn(buttonClass.secondary, size === "sm" && "h-7 px-2 text-[12px]")}>
            Cancel
          </button>
          <button type="submit" className={cls} autoFocus>
            {confirmLabel ?? label}
          </button>
        </span>
      ) : (
        <button
          type={confirm ? "button" : "submit"}
          disabled={pending}
          onClick={confirm ? () => setAsking(true) : undefined}
          className={cls}
        >
          {pending ? <Spinner size={13} /> : icon}
          {label}
        </button>
      )}
    </form>
  );
}
