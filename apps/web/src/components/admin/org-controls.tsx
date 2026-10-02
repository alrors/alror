"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { KeyRound, Trash2 } from "lucide-react";
import { changePlanAction, deleteOrgAction, resetPasswordAction, type ResetResult } from "@/app/admin/actions";
import { CopyButton } from "@/components/console/copy-button";
import { Dialog } from "@/components/console/dialog";
import { Spinner } from "@/components/console/loader";
import { buttonClass, inputClass } from "@/components/console/primitives";
import { Selector } from "@/components/console/selector";
import { toast } from "@/components/console/shell-toast";
import type { ActionResult } from "@/lib/console/action-types";
import { useResultToast } from "./admin-action";

const PLAN_OPTIONS = [
  { value: "free", label: "Free" },
  { value: "team", label: "Team" },
  { value: "business", label: "Business" },
];

/** Plan picker that saves on change. */
export function PlanSelect({ orgId, plan }: { orgId: string; plan: string }) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(changePlanAction, undefined);
  useResultToast(state);
  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="org" value={orgId} />
      <Selector name="plan" aria-label="Plan" options={PLAN_OPTIONS} defaultValue={plan} submitOnChange disabled={pending} className="w-36" prefix="Plan" />
      {pending && <Spinner size={13} className="text-con-fg3" />}
    </form>
  );
}

/** Delete with a typed confirmation: the slug must be typed exactly. */
export function DeleteOrgDialog({ orgId, slug, name, counts }: { orgId: string; slug: string; name: string; counts: string }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(deleteOrgAction, undefined);
  useResultToast(state);
  return (
    <>
      <button type="button" className={buttonClass.danger} onClick={() => setOpen(true)}>
        <Trash2 size={14} />
        Delete organization
      </button>
      <Dialog
        open={open}
        onClose={() => {
          if (!pending) {
            setOpen(false);
            setTyped("");
          }
        }}
        title={`Delete ${name}?`}
        description="This permanently deletes the organization and everything it owns. It cannot be undone."
      >
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="org" value={orgId} />
          <p className="rounded-md border border-con-line bg-con-bg px-3 py-2 text-[13px] text-con-fg2">{counts}</p>
          <label className="block space-y-1.5">
            <span className="block text-[13px] text-con-fg2">
              Type <span className="font-mono text-con-fg">{slug}</span> to confirm
            </span>
            <input
              name="confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              data-autofocus
              className={`${inputClass} font-mono`}
            />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClass.secondary} onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </button>
            <button type="submit" className={buttonClass.danger} disabled={typed.trim() !== slug || pending}>
              {pending ? <Spinner size={13} /> : <Trash2 size={14} />}
              Delete permanently
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/** Resets a password to a random temporary one and shows it once. */
export function ResetPassword({ userId, email }: { userId: string; email: string }) {
  const [state, formAction, pending] = useActionState<ResetResult, FormData>(resetPasswordAction, undefined);
  const [asking, setAsking] = useState(false);
  const [shown, setShown] = useState<{ email: string; password: string } | null>(null);
  const seen = useRef<ResetResult>(undefined);
  useEffect(() => {
    if (!state || state === seen.current) return;
    seen.current = state;
    if (state.error) toast.error(state.error);
    else if (state.ok && state.password) {
      toast.success(state.message ?? "Password reset.");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- show the one-time secret from the action result
      setShown({ email: state.email ?? email, password: state.password });
    }
  }, [state, email]);
  return (
    <>
      <form
        action={(fd) => {
          setAsking(false);
          formAction(fd);
        }}
        className="inline-flex items-center gap-2"
      >
        <input type="hidden" name="user" value={userId} />
        {asking ? (
          <span className="con-fade inline-flex items-center gap-2">
            <span className="hidden text-[12px] text-con-fg2 sm:inline">Replaces their password and signs them out.</span>
            <button type="button" className={buttonClass.secondary} onClick={() => setAsking(false)}>
              Cancel
            </button>
            <button type="submit" className={buttonClass.danger} autoFocus>
              Reset password
            </button>
          </span>
        ) : (
          <button type="button" className={buttonClass.secondary} disabled={pending} onClick={() => setAsking(true)}>
            {pending ? <Spinner size={13} /> : <KeyRound size={14} />}
            Reset password
          </button>
        )}
      </form>
      <Dialog open={Boolean(shown)} onClose={() => setShown(null)} title="Temporary password" description={`For ${shown?.email ?? email}. It is shown once; share it over a trusted channel.`}>
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-md border border-con-line bg-con-bg px-3 py-2">
            <code className="min-w-0 flex-1 break-all font-mono text-[14px] text-con-fg">{shown?.password}</code>
            {shown && <CopyButton text={shown.password} iconOnly label="Copy password" />}
          </div>
          <p className="text-[12px] text-con-fg3">All of their sessions were ended. Their old password no longer works; they sign in with this one.</p>
          <div className="flex justify-end">
            <button type="button" className={buttonClass.primary} onClick={() => setShown(null)} data-autofocus>
              Done
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

/** Shows a toast once for a message carried in the URL (e.g. after a redirect). */
export function FlashToast({ message }: { message: string | null }) {
  const done = useRef(false);
  useEffect(() => {
    if (!message || done.current) return;
    done.current = true;
    toast.success(message);
    const url = new URL(window.location.href);
    url.searchParams.delete("deleted");
    window.history.replaceState(null, "", url.toString());
  }, [message]);
  return null;
}
