"use client";

import { useActionState } from "react";
import { login, type LoginState } from "@/app/login/actions";
import { Spinner } from "@/components/console/loader";

export const authInput =
  "h-9 w-full rounded-md border border-con-line bg-con-bg px-3 text-[14px] text-con-fg outline-none transition-colors duration-150 placeholder:text-con-fg3 hover:border-con-line-hover focus:border-con-fg3";

export const authButton =
  "inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-con-fg text-[14px] font-medium text-black transition-colors duration-150 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-con-fg3 disabled:opacity-70";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, undefined);

  return (
    <form action={action} className="space-y-4" noValidate>
      {next && <input type="hidden" name="next" value={next} />}

      <div className="space-y-1.5">
        <label htmlFor="email" className="block text-[13px] text-con-fg2">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          defaultValue={state?.email ?? ""}
          className={authInput}
          placeholder="you@company.com"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="block text-[13px] text-con-fg2">
          Password
        </label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className={authInput} placeholder="••••••••" />
      </div>

      <div aria-live="polite" className="min-h-5">
        {state?.error && <p className="text-[13px] text-con-bad">{state.error}</p>}
      </div>

      <button type="submit" disabled={pending} className={authButton}>
        {pending && <Spinner size={15} />}
        {pending ? "Signing in" : "Sign in"}
      </button>
    </form>
  );
}
