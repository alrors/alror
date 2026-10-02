"use client";

import { useActionState, useRef, useState } from "react";
import { createInvite, type InviteResult } from "@/app/app/settings/actions";
import { CopyButton } from "@/components/console/copy-button";
import { Spinner } from "@/components/console/loader";
import { FormField, FormStatus, buttonClass, inputClass } from "@/components/console/primitives";
import { Selector } from "@/components/console/selector";
import { toast } from "@/components/console/shell-toast";

const ROLE_HINT: Record<string, string> = {
  member: "Can deploy and read everything.",
  admin: "Also manages people, keys and config.",
  owner: "Full control, including other owners.",
};

/** Creates an invite and shows its link once (only the token's hash is stored). */
export function InviteCreate({ canInviteOwner, ttlDays = 7, autoFocus }: { canInviteOwner: boolean; ttlDays?: number; autoFocus?: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  const [role, setRole] = useState("member");
  const [state, action, pending] = useActionState<InviteResult, FormData>(async (prev, fd) => {
    const r = await createInvite(prev, fd);
    if (r?.ok) {
      form.current?.reset();
      setRole("member");
      toast.success("Invite link created", { description: `Copy it now and send it to ${r.email}.` });
    }
    return r;
  }, undefined);
  return (
    <div className="space-y-4">
      <form ref={form} action={action} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px_auto] sm:items-end">
        <FormField label="Email" htmlFor="invite-email">
          <input
            id="invite-email"
            name="email"
            type="email"
            required
            autoComplete="off"
            autoFocus={autoFocus}
            placeholder="teammate@company.com"
            className={inputClass}
          />
        </FormField>
        <FormField label="Role" htmlFor="invite-role">
          <Selector
            id="invite-role"
            name="role"
            aria-label="Role"
            value={role}
            onValueChange={setRole}
            minWidth={260}
            options={[
              { value: "member", label: "Member", description: ROLE_HINT.member },
              { value: "admin", label: "Admin", description: ROLE_HINT.admin },
              ...(canInviteOwner ? [{ value: "owner", label: "Owner", description: ROLE_HINT.owner }] : []),
            ]}
          />
        </FormField>
        <button type="submit" disabled={pending} className={buttonClass.primary}>
          {pending && <Spinner />}
          Create invite link
        </button>
        <p className="text-[12px] text-con-fg3 sm:col-span-3">{ROLE_HINT[role]}</p>
      </form>
      <FormStatus error={state?.error} />
      {state?.ok && state.link && (
        <div className="con-scale-in rounded-md border border-con-line bg-con-bg p-3">
          <p className="text-[13px] text-con-fg">
            Invite link for <span className="font-medium">{state.email}</span>. Copy it now: it is shown only once.
          </p>
          <div className="mt-2 flex items-start gap-2">
            <code className="min-w-0 flex-1 break-all rounded border border-con-line bg-con-panel px-2 py-1.5 font-mono text-[12px] text-con-fg">{state.link}</code>
            <CopyButton text={state.link} label="Copy link" />
          </div>
          <p className="mt-2 text-[12px] text-con-fg3">
            Single use. Expires in {ttlDays} days
            {state.expires_at && <>, on {new Date(state.expires_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</>}.
          </p>
        </div>
      )}
    </div>
  );
}
