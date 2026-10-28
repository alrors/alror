"use client";

import { useTransition } from "react";
import { Spinner } from "@/components/console/loader";
import { buttonClass } from "@/components/console/primitives";
import { toastActionError, undoToast } from "@/components/console/shell-toast";
import { cn } from "@/lib/site";

type Result = { ok?: boolean; error?: string; message?: string; retryable?: boolean } | undefined;
type Action = (prev: Result, formData: FormData) => Promise<Result>;

const formOf = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

/**
 * A button for a reversible server action (archive, restore, disable): it runs
 * at once, then a toast offers Undo, which runs `undoAction` (default: the same
 * action) with `undoFields` to restore the previous state. Irreversible actions
 * use ConfirmAction instead.
 */
export function UndoableAction({
  action,
  fields,
  undoAction,
  undoFields,
  label,
  done,
  tone = "secondary",
  icon,
  className,
}: {
  action: Action;
  fields: Record<string, string>;
  undoAction?: Action;
  undoFields: Record<string, string>;
  label: string;
  /** Toast title on success; defaults to the action's message. */
  done?: string;
  tone?: "danger" | "secondary";
  icon?: React.ReactNode;
  className?: string;
}) {
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const r = await action(undefined, formOf(fields));
      if (r?.error) {
        toastActionError(r.error, { retryable: r.retryable, retry: run });
        return;
      }
      undoToast(done ?? r?.message ?? `${label}: done.`, () => (undoAction ?? action)(undefined, formOf(undoFields)));
    });
  return (
    <button type="button" disabled={pending} onClick={run} className={cn(tone === "danger" ? buttonClass.danger : buttonClass.secondary, className)}>
      {pending ? <Spinner size={14} /> : icon}
      {label}
    </button>
  );
}
