import Link from "next/link";
import { ArrowRight, Lock } from "lucide-react";
import { buttonClass, Pill } from "@/components/console/primitives";
import { MemberAvatar } from "@/components/console/settings/member-avatar";
import { requireSession } from "@/lib/console/auth";
import { ctxFor } from "@/lib/server/auth/accounts";
import { listMembers, type Member } from "@/lib/server/auth/members";

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member" };

/** Presentational part, also used by the /dev/errors preview with sample data. */
export function AccessDeniedView({
  what,
  role,
  org,
  admins,
  showMembersLink = true,
}: {
  /** "API keys", "the audit log"; omitted for a whole page. */
  what?: string;
  role: string;
  org: string;
  admins: Pick<Member, "user_id" | "name" | "email" | "role">[];
  showMembersLink?: boolean;
}) {
  const subject = what ?? "this page";
  return (
    <section className="con-fade-up rounded-lg border border-con-line bg-con-panel">
      <div className="px-5 py-6 sm:px-7 sm:py-8">
        <span className="grid h-9 w-9 place-items-center rounded-lg border border-con-line text-con-fg2" aria-hidden>
          <Lock size={16} />
        </span>
        <h2 className="mt-5 text-[20px] font-semibold tracking-[-0.02em] text-con-fg">You don&apos;t have access</h2>
        <p className="mt-1.5 max-w-xl text-[14px] leading-relaxed text-con-fg2">
          Only owners and admins of {org} can manage {subject}. You&apos;re signed in as{" "}
          {role === "admin" || role === "owner" ? "an" : "a"} <span className="text-con-fg">{ROLE_LABEL[role] ?? role}</span>. Nothing is wrong with your account; this
          part of the console needs a higher role.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          {showMembersLink && (
            <Link href="/app/settings/members" className={buttonClass.secondary}>
              Settings › Members
            </Link>
          )}
          <Link href="/app" className={buttonClass.secondary}>
            Back to overview
            <ArrowRight size={13} />
          </Link>
        </div>
      </div>
      <div className="border-t border-con-line px-5 py-5 sm:px-7">
        <h3 className="text-[13px] font-medium text-con-fg">Who can grant access</h3>
        <p className="mt-0.5 text-[13px] text-con-fg3">Ask one of them to change your role in Settings › Members.</p>
        {admins.length > 0 ? (
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {admins.map((a) => (
              <li key={a.user_id} className="flex min-w-0 items-center gap-3 rounded-md border border-con-line px-3 py-2.5">
                <MemberAvatar name={a.name} email={a.email} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-con-fg">{a.name || a.email}</span>
                  {a.name && <span className="block truncate text-[12px] text-con-fg3">{a.email}</span>}
                </span>
                <Pill className="text-con-fg2">{ROLE_LABEL[a.role] ?? a.role}</Pill>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-[13px] text-con-fg2">An owner of {org}.</p>
        )}
      </div>
    </section>
  );
}

/**
 * Shown in place of an owner/admin-only page or section: your role, who can
 * grant access, and where roles are managed. Server component.
 */
export async function AccessDenied({ what }: { what?: string }) {
  const session = await requireSession();
  const members = await listMembers(ctxFor(session)).catch(() => [] as Member[]);
  const rank = (r: string) => (r === "owner" ? 0 : 1);
  const admins = members
    .filter((m) => m.role === "owner" || m.role === "admin")
    .sort((a, b) => rank(a.role) - rank(b.role))
    .slice(0, 4);
  return <AccessDeniedView what={what} role={session.role} org={session.org.name} admins={admins} showMembersLink={what !== "members"} />;
}
