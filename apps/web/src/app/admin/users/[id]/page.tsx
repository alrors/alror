import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, LogOut } from "lucide-react";
import { removeFromOrgAction, signOutUserAction } from "@/app/admin/actions";
import { AdminAction } from "@/components/admin/admin-action";
import { AdminHeader, shortDate, tableCell, tableHead } from "@/components/admin/kit";
import { ResetPassword } from "@/components/admin/org-controls";
import { Card, EmptyState, Field, Pill } from "@/components/console/primitives";
import { ago, dateTime, requestTime } from "@/lib/console/format";
import { isPlatformAdmin } from "@/lib/server/admin/access";
import { requirePlatformAdmin } from "@/lib/server/admin/guard";
import { getUserAdmin, sessionCounts } from "@/lib/server/admin/users";
import { cn } from "@/lib/site";

export const metadata: Metadata = { title: "User" };

export default async function AdminUserDetail({ params }: PageProps<"/admin/users/[id]">) {
  const admin = await requirePlatformAdmin();
  const { id } = await params;
  const [user, sessions] = await Promise.all([getUserAdmin(admin, id), sessionCounts(admin)]);
  if (!user) notFound();
  const now = requestTime();
  const self = user.id === admin.userId;

  return (
    <div className="con-fade-up space-y-4">
      <Link href="/admin/users" className="inline-flex items-center gap-1.5 text-[12px] text-con-fg3 hover:text-con-fg">
        <ArrowLeft size={13} />
        Users
      </Link>
      <AdminHeader
        title={user.email}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {user.name && <span>{user.name}</span>}
            {isPlatformAdmin(user.email) && <Pill>Platform admin</Pill>}
            {self && <Pill>You</Pill>}
          </span>
        }
        actions={
          <>
            <AdminAction
              action={signOutUserAction}
              fields={{ user: user.id }}
              label="Sign out everywhere"
              confirm={self ? "This also ends your own session." : "Ends every session of this user."}
              icon={<LogOut size={14} />}
            />
            <ResetPassword userId={user.id} email={user.email} />
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card title="Account">
          <dl className="divide-y divide-con-line">
            <Field label="User id" mono>
              {user.id}
            </Field>
            <Field label="Created">{dateTime(user.created_at)}</Field>
            <Field label="Last sign-in">{user.last_login_at ? `${ago(user.last_login_at, now)}` : "never"}</Field>
            <Field label="Active sessions">{sessions[user.id] ?? 0}</Field>
          </dl>
        </Card>

        <Card title="Memberships" description="Removing a membership takes effect on the user's next request. The last owner of an org cannot be removed." flush>
          {user.memberships.length === 0 ? (
            <EmptyState title="No organizations">This user cannot sign in to the console until they join or create one.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-[13px]">
                <thead>
                  <tr className="border-b border-con-line">
                    <th className={tableHead}>Organization</th>
                    <th className={tableHead}>Role</th>
                    <th className={tableHead}>Joined</th>
                    <th className={cn(tableHead, "text-right")}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {user.memberships.map((m) => (
                    <tr key={m.org_id} className="border-b border-con-line last:border-0">
                      <td className={tableCell}>
                        <Link href={`/admin/orgs/${m.org_id}`} className="font-medium text-con-fg hover:underline">
                          {m.name}
                        </Link>
                        <span className="ml-2 font-mono text-[12px] text-con-fg3">{m.slug}</span>
                      </td>
                      <td className={tableCell}>
                        <Pill className="capitalize">{m.role}</Pill>
                      </td>
                      <td className={cn(tableCell, "whitespace-nowrap text-con-fg2")}>{shortDate(m.joined_at)}</td>
                      <td className={cn(tableCell, "text-right")}>
                        <AdminAction
                          action={removeFromOrgAction}
                          fields={{ user: user.id, org: m.org_id }}
                          label="Remove"
                          confirm={`Remove from ${m.slug}?`}
                          tone="danger"
                          size="sm"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
