"use server";

import { redirect } from "next/navigation";
import { login as loginUser, signup as signupUser } from "@/lib/server/auth/accounts";
import { acceptInvite as accept } from "@/lib/server/auth/members";
import { clientIp, safeNext, setSessionCookie } from "@/lib/server/auth/session";
import { ApiError } from "@/lib/server/errors";

// Server actions for the signed-out pages: /login, /signup and /invite/<token>.

export type LoginState = { error?: string; email?: string } | undefined;
export type SignupState = { error?: string; email?: string; name?: string; org?: string } | undefined;
export type InviteState = { error?: string; name?: string } | undefined;

const str = (f: FormData, k: string) => String(f.get(k) ?? "");

function message(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.message;
  console.error("[alror] auth action failed:", e);
  return fallback;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = str(formData, "email").trim();
  const password = str(formData, "password");
  if (!email || !password) return { error: "Enter your email and password.", email };

  try {
    const r = await loginUser({ email, password, ip: await clientIp() });
    await setSessionCookie(r.sid);
  } catch (e) {
    return { error: message(e, "Sign-in is unavailable right now. Try again shortly."), email };
  }
  redirect(safeNext(formData.get("next")));
}

export async function signup(_prev: SignupState, formData: FormData): Promise<SignupState> {
  const email = str(formData, "email").trim();
  const name = str(formData, "name").trim();
  const org = str(formData, "org").trim();
  const password = str(formData, "password");
  if (!email || !password) return { error: "Enter an email and a password.", email, name, org };

  try {
    const r = await signupUser({ email, password, name, orgName: org });
    await setSessionCookie(r.sid);
  } catch (e) {
    return { error: message(e, "Could not create the account. Try again shortly."), email, name, org };
  }
  redirect("/app/onboarding?welcome=1");
}

export async function acceptInvite(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const token = str(formData, "token");
  const name = str(formData, "name").trim();
  const password = str(formData, "password");
  if (!password) return { error: "Enter a password.", name };

  try {
    const r = await accept({ token, password, name });
    await setSessionCookie(r.sid);
  } catch (e) {
    return { error: message(e, "Could not accept the invite. Try again shortly."), name };
  }
  redirect("/app");
}
