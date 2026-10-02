"use client";

import { useActionState } from "react";
import { acceptInvite, type InviteState } from "@/app/login/actions";
import { authButton, authInput } from "./login-form";
import { Spinner } from "@/components/console/loader";

export function InviteForm({ token, email, existingUser }: { token: string; email: string; existingUser: boolean }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(acceptInvite, undefined);

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="token" value={token} />

      <div className="space-y-1.5">
        <label htmlFor="email" className="block text-[13px] text-con-fg2">
          Email
        </label>
        <input id="email" type="email" value={email} readOnly autoComplete="username" className={`${authInput} text-con-fg2`} />
      </div>

      {!existingUser && (
        <div className="space-y-1.5">
          <label htmlFor="name" className="block text-[13px] text-con-fg2">
            Your name
          </label>
          <input id="name" name="name" type="text" autoComplete="name" defaultValue={state?.name ?? ""} className={authInput} placeholder="Ada Lovelace" />
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor="password" className="block text-[13px] text-con-fg2">
          {existingUser ? "Your password" : "Choose a password"}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={existingUser ? "current-password" : "new-password"}
          required
          className={authInput}
          placeholder={existingUser ? "••••••••" : "At least 8 characters"}
        />
      </div>

      <div aria-live="polite" className="min-h-5">
        {state?.error && <p className="text-[13px] text-con-bad">{state.error}</p>}
      </div>

      <button type="submit" disabled={pending} className={authButton}>
        {pending && <Spinner size={15} />}
        {pending ? "Joining" : "Accept invite"}
      </button>
    </form>
  );
}
