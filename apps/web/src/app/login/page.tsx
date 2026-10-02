import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell, authLink } from "@/components/console/auth-shell";
import { LoginForm } from "@/components/console/login-form";
import { isFirstRun } from "@/lib/server/auth/accounts";
import { getSession, safeNext } from "@/lib/server/auth/session";

export const metadata: Metadata = {
  title: "Sign in · Alror console",
  robots: { index: false },
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const target = safeNext(Array.isArray(next) ? next[0] : next);
  if (await getSession()) redirect(target);
  const firstRun = await isFirstRun().catch(() => false);

  return (
    <AuthShell
      title="Sign in to Alror"
      subtitle="Deployments, verdicts and rollbacks for your organization."
      footer={
        <>
          <p>
            {firstRun ? "No accounts yet. " : "New to Alror? "}
            <Link href="/signup" className={authLink}>
              {firstRun ? "Create the first account" : "Create an account"}
            </Link>
          </p>
          {process.env.NODE_ENV !== "production" && !firstRun && (
            <p>
              Demo: <span className="font-mono text-con-fg2">admin@acme.test</span> / <span className="font-mono text-con-fg2">alror-demo</span>
            </p>
          )}
        </>
      }
    >
      <LoginForm next={target === "/app" ? undefined : target} />
    </AuthShell>
  );
}
