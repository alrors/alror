import type { Metadata } from "next";
import { ConfirmAction } from "@/components/console/confirm-action";
import { AccessDenied } from "@/components/console/access-denied";
import { Card, EmptyState, Pill, tableCell, tableHead } from "@/components/console/primitives";
import { InviteCreate } from "@/components/console/settings/invite-create";
import { MemberAvatar } from "@/components/console/settings/member-avatar";
import { requireSession } from "@/lib/console/auth";
import { ago, dateTime, requestTime } from "@/lib/console/format";
import { ctxFor } from "@/lib/server/auth/accounts";
import { INVITE_TTL_DAYS, listInvites } from "@/lib/server/auth/members";
import { isAdminRole } from "@/lib/server/context";
import { cn } from "@/lib/site";
import { revokeInvite } from "../actions";

export const metadata: Metadata = { title: "Invites" };

const HOUR = 3_600_000;

function expiresIn(iso: string, now: number): string {
  const ms = Date.parse(iso) - now;
  if (ms <= 0) return "Expired";
  const h = Math.floor(ms / HOUR);
  if (h < 1) return "Expires in under an hour";
  if (h < 24) return `Expires in ${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.floor(h / 24);
  return `Expires in ${d} day${d === 1 ? "" : "s"}`;
}

export default async function InvitesPage({ searchParams }: PageProps<"/app/settings/invites">) {
  const session = await requireSession();
  if (!isAdminRole(session.role)) return <AccessDenied what="invites" />;
  const sp = await searchParams;
  const invites = await listInvites(ctxFor(session), { pendingOnly: true });
  const now = requestTime();
  const ttl = INVITE_TTL_DAYS * 24 * HOUR;

  return (
    <>
      <Card title="Invite people" description="Create a link and send it however you like. Alror does not send email.">
        <InviteCreate canInviteOwner={session.role === "owner"} ttlDays={INVITE_TTL_DAYS} autoFocus={sp.new === "1"} />
        <ol className="mt-5 grid gap-3 border-t border-con-line pt-4 text-[12px] text-con-fg3 sm:grid-cols-3">
          <li>
            <span className="text-con-fg2">1. Create a link.</span> It is shown once; only a hash is stored.
          </li>
          <li>
            <span className="text-con-fg2">2. Share it.</span> It works once and is valid for {INVITE_TTL_DAYS} days.
          </li>
          <li>
            <span className="text-con-fg2">3. They join.</span> They sign in, or create an account, and get the role you picked.
          </li>
        </ol>
      </Card>

      <Card title="Pending invites" description={`${invites.length} waiting to be accepted`} flush>
        {invites.length === 0 ? (
          <EmptyState title="No pending invites">Invites you create appear here until they are accepted, revoked or expire.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[14px]">
              <thead className="border-b border-con-line">
                <tr>
                  <th className={tableHead}>Email</th>
                  <th className={tableHead}>Role</th>
                  <th className={tableHead}>Invited by</th>
                  <th className={tableHead}>Expires</th>
                  <th className={cn(tableHead, "text-right")}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="con-stagger">
                {invites.map((i) => {
                  const left = Math.max(0, Math.min(1, (Date.parse(i.expires_at) - now) / ttl));
                  const soon = left < 0.25;
                  return (
                    <tr key={i.id} className="border-b border-con-row last:border-0">
                      <td className={cn(tableCell, "py-2.5")}>
                        <div className="flex items-center gap-3">
                          <MemberAvatar email={i.email} size={26} />
                          <span className="truncate text-con-fg">{i.email}</span>
                        </div>
                      </td>
                      <td className={tableCell}>
                        <Pill className="capitalize text-con-fg2">{i.role}</Pill>
                      </td>
                      <td className={cn(tableCell, "text-[13px] text-con-fg2")} title={dateTime(i.created_at)}>
                        {i.invited_by ?? "unknown"} · {ago(i.created_at)}
                      </td>
                      <td className={cn(tableCell, "text-[13px]")} title={dateTime(i.expires_at)}>
                        <div className={soon ? "text-con-warn" : "text-con-fg2"}>{expiresIn(i.expires_at, now)}</div>
                        <div className="mt-1.5 h-1 w-28 overflow-hidden rounded-full bg-con-row" aria-hidden>
                          <div className={cn("con-grow-x h-full rounded-full", soon ? "bg-con-warn/70" : "bg-con-fg3")} style={{ width: `${Math.round(left * 100)}%` }} />
                        </div>
                      </td>
                      <td className={cn(tableCell, "text-right")}>
                        <ConfirmAction action={revokeInvite} fields={{ id: i.id }} label="Revoke" prompt="The link stops working." />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
