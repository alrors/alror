import type { Metadata } from "next";
import Link from "next/link";
import { UserPlus } from "lucide-react";
import { ConfirmAction } from "@/components/console/confirm-action";
import { AccessDenied } from "@/components/console/access-denied";
import { Card, Pill, buttonClass, tableCell, tableHead } from "@/components/console/primitives";
import { MemberAvatar } from "@/components/console/settings/member-avatar";
import { RoleSelect } from "@/components/console/settings/role-select";
import { RolesMatrix } from "@/components/console/settings/roles-matrix";
import { requireSession } from "@/lib/console/auth";
import { ago, dateTime, requestTime } from "@/lib/console/format";
import { ctxFor } from "@/lib/server/auth/accounts";
import { listInvites, listMembers } from "@/lib/server/auth/members";
import { isAdminRole } from "@/lib/server/context";
import { cn } from "@/lib/site";
import { removeMember } from "../actions";

export const metadata: Metadata = { title: "Members" };

const DAY = 86_400_000;

export default async function MembersPage() {
  const session = await requireSession();
  if (!isAdminRole(session.role)) return <AccessDenied what="members" />;
  const ctx = ctxFor(session);
  const [members, invites] = await Promise.all([listMembers(ctx), listInvites(ctx, { pendingOnly: true })]);
  const isOwner = session.role === "owner";
  const counts = { owner: 0, admin: 0, member: 0 } as Record<string, number>;
  for (const m of members) counts[m.role] = (counts[m.role] ?? 0) + 1;
  const owners = counts.owner;
  const now = requestTime();
  const activeWeek = members.filter((m) => m.last_login_at && now - Date.parse(m.last_login_at) < 7 * DAY).length;

  return (
    <>
      <Card
        title="Members"
        description={`${members.length} ${members.length === 1 ? "person" : "people"} in ${session.org.name} · ${activeWeek} signed in this week`}
        aside={
          <Link href="/app/settings/invites?new=1" className={buttonClass.secondary}>
            <UserPlus size={14} />
            Invite people
          </Link>
        }
        flush
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-con-line px-5 py-2.5 text-[12px] text-con-fg2">
          {(["owner", "admin", "member"] as const).map((r) => (
            <span key={r} className="inline-flex items-center gap-1.5 rounded-full border border-con-line px-2 py-0.5">
              <span className="capitalize">{r}s</span>
              <span className="tabular-nums text-con-fg">{counts[r] ?? 0}</span>
            </span>
          ))}
          {invites.length > 0 && (
            <Link href="/app/settings/invites" className="ml-auto text-con-fg2 transition-colors duration-150 hover:text-con-fg">
              {invites.length} pending invite{invites.length === 1 ? "" : "s"}
            </Link>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-[14px]">
            <thead className="border-b border-con-line">
              <tr>
                <th className={tableHead}>Member</th>
                <th className={tableHead}>Role</th>
                <th className={tableHead}>Joined</th>
                <th className={tableHead}>Last sign-in</th>
                <th className={cn(tableHead, "text-right")}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="con-stagger">
              {members.map((m) => {
                const self = m.user_id === session.user.id;
                // Admins cannot change or remove owners; the last owner always stays.
                const editable = !self && (isOwner || m.role !== "owner");
                const lastOwner = m.role === "owner" && owners <= 1;
                const recent = m.last_login_at && now - Date.parse(m.last_login_at) < 7 * DAY;
                return (
                  <tr key={m.user_id} className="border-b border-con-row transition-colors duration-150 last:border-0 hover:bg-con-hover/60">
                    <td className={cn(tableCell, "py-2.5")}>
                      <div className="flex items-center gap-3">
                        <MemberAvatar name={m.name} email={m.email} size={30} />
                        <div className="min-w-0">
                          <div className="truncate text-con-fg">
                            {m.name || m.email}
                            {self && <span className="ml-2 rounded bg-con-row px-1.5 py-px text-[11px] text-con-fg2">You</span>}
                          </div>
                          {m.name && <div className="truncate text-[12px] text-con-fg3">{m.email}</div>}
                        </div>
                      </div>
                    </td>
                    <td className={tableCell}>
                      {editable && !lastOwner ? (
                        <RoleSelect userId={m.user_id} role={m.role} canGrantOwner={isOwner} label={m.email} />
                      ) : (
                        <Pill className="capitalize text-con-fg2" title={lastOwner ? "The last owner cannot be changed" : self ? "You cannot change your own role" : undefined}>
                          {m.role}
                        </Pill>
                      )}
                    </td>
                    <td className={cn(tableCell, "text-[13px] text-con-fg2")} title={dateTime(m.joined_at)}>
                      {ago(m.joined_at)}
                    </td>
                    <td className={cn(tableCell, "text-[13px]")} title={m.last_login_at ? dateTime(m.last_login_at) : undefined}>
                      <span className="inline-flex items-center gap-2 text-con-fg2">
                        <span className={cn("h-1.5 w-1.5 rounded-full", recent ? "bg-con-fg2" : "bg-con-line-hover")} aria-hidden />
                        {m.last_login_at ? ago(m.last_login_at) : "never"}
                      </span>
                    </td>
                    <td className={cn(tableCell, "text-right")}>
                      {editable && !lastOwner && (
                        <ConfirmAction action={removeMember} fields={{ user: m.user_id }} label="Remove" prompt={`Remove ${m.email}?`} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="Roles and permissions"
        description="Roles are per organization: someone can be an owner in one and a member in another. The column for your role is highlighted."
        flush
      >
        <RolesMatrix highlight={session.role} />
      </Card>
    </>
  );
}
