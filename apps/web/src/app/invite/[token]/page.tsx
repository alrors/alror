import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell, authLink } from "@/components/console/auth-shell";
import { InviteForm } from "@/components/console/invite-form";
import { previewInvite } from "@/lib/server/auth/members";

export const metadata: Metadata = {
  title: "Join an organization · Alror console",
  robots: { index: false },
};

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const invite = await previewInvite(token).catch(() => null);

  if (!invite) {
    return (
      <AuthShell
        title="Invite not found"
        subtitle="This invite link is invalid, was already used or has expired. Ask an admin of the organization for a new one."
        footer={
          <p>
            <Link href="/login" className={authLink}>
              Sign in
            </Link>
          </p>
        }
      >
        <Link href="/login" className="inline-flex h-9 w-full items-center justify-center rounded-md border border-con-line text-[14px] text-con-fg hover:border-con-line-hover">
          Go to sign in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={`Join ${invite.org.name}`}
      subtitle={
        invite.existingUser
          ? `Confirm your password to join as ${invite.role}.`
          : `Create your account to join as ${invite.role}.`
      }
    >
      <InviteForm token={token} email={invite.email} existingUser={invite.existingUser} />
    </AuthShell>
  );
}
