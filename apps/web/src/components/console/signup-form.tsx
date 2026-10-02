"use client";

import { useActionState } from "react";
import { signup, type SignupState } from "@/app/login/actions";
import { authButton, authInput } from "./login-form";
import { Spinner } from "@/components/console/loader";

export function SignupForm() {
  const [state, action, pending] = useActionState<SignupState, FormData>(signup, undefined);

  return (
    <form action={action} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <label htmlFor="name" className="block text-[13px] text-con-fg2">
          Your name
        </label>
        <input id="name" name="name" type="text" autoComplete="name" defaultValue={state?.name ?? ""} className={authInput} placeholder="Ada Lovelace" />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="email" className="block text-[13px] text-con-fg2">
          Work email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          defaultValue={state?.email ?? ""}
          className={authInput}
          placeholder="you@company.com"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="org" className="block text-[13px] text-con-fg2">
          Organization
        </label>
        <input id="org" name="org" type="text" autoComplete="organization" defaultValue={state?.org ?? ""} className={authInput} placeholder="Acme" />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="block text-[13px] text-con-fg2">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          className={authInput}
          placeholder="At least 8 characters"
        />
      </div>

      <div aria-live="polite" className="min-h-5">
        {state?.error && <p className="text-[13px] text-con-bad">{state.error}</p>}
      </div>

      <button type="submit" disabled={pending} className={authButton}>
        {pending && <Spinner size={15} />}
        {pending ? "Creating account" : "Create account"}
      </button>
    </form>
  );
}
