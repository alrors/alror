import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell, authLink } from "@/components/console/auth-shell";
import { SignupForm } from "@/components/console/signup-form";
import { isFirstRun } from "@/lib/server/auth/accounts";
import { getSession } from "@/lib/server/auth/session";

export const metadata: Metadata = {
  title: "Create account · Alror console",
  robots: { index: false },
};

export default async function SignupPage() {
  if (await getSession()) redirect("/app");
  const firstRun = await isFirstRun().catch(() => false);

  return (
    <AuthShell
      title={firstRun ? "Set up Alror" : "Create your account"}
      subtitle={
        firstRun
          ? "Create the first account. You will own the organization, with production and staging environments ready."
          : "Start a new organization. To join an existing one, ask an admin for an invite link."
      }
      footer={
        <p>
          Already have an account?{" "}
          <Link href="/login" className={authLink}>
            Sign in
          </Link>
        </p>
      }
    >
      <SignupForm />
    </AuthShell>
  );
}
