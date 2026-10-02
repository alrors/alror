import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, KeyRound } from "lucide-react";
import { revokeAllKeysAction, revokeKeyAction } from "@/app/admin/actions";
import { AdminAction } from "@/components/admin/admin-action";
import { AdminHeader, shortDate, tableCell, tableHead } from "@/components/admin/kit";
import { DeleteOrgDialog, PlanSelect } from "@/components/admin/org-controls";
import { Card, EmptyState, Pill, RiskValue, StatusBadge } from "@/components/console/primitives";
import { ago, requestTime } from "@/lib/console/format";
import { listApiKeys } from "@/lib/server/auth/api-keys";
import { listMembers } from "@/lib/server/auth/members";
import { orgCtxFor } from "@/lib/server/admin/access";
import { requirePlatformAdmin } from "@/lib/server/admin/guard";
import { getOrgAdmin } from "@/lib/server/admin/orgs";
import { usage } from "@/lib/server/data/analytics";
import { listDeployments } from "@/lib/server/data/deployments";
import { listServices } from "@/lib/server/data/services";
import { cn } from "@/lib/site";

export const metadata: Metadata = { title: "Organization" };

export default async function AdminOrgDetail({ params }: PageProps<"/admin/orgs/[id]">) {
  const admin = await requirePlatformAdmin();
  const { id } = await params;
  const org = await getOrgAdmin(admin, id);
  if (!org) notFound();
  const ctx = orgCtxFor(admin, org.id);
  const [members, keys, services, deps, use] = await Promise.all([
    listMembers(ctx),
    listApiKeys(ctx, { includeRevoked: true }),
    listServices(ctx, { includeArchived: true }),
    listDeployments(ctx, {}, { limit: 12 }),
    usage(ctx),
  ]);
  const now = requestTime();
  const activeKeys = keys.filter((k) => !k.revoked_at);
  const liveServices = services.filter((s) => !s.archived_at);

  return (
    <div className="con-fade-up space-y-4">
      <Link href="/admin/orgs" className="inline-flex items-center gap-1.5 text-[12px] text-con-fg3 hover:text-con-fg">
        <ArrowLeft size={13} />
        Organizations
      </Link>
      <AdminHeader
        title={org.name}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono">{org.slug}</span>
            <span className="text-con-fg3">created {shortDate(org.createdAt.toISOString())}</span>
            <span className="font-mono text-[12px] text-con-fg3">{org.id}</span>
          </span>
        }
        actions={<PlanSelect orgId={org.id} plan={org.plan} />}
      />

      <Card title="Usage this cycle" description={`Plan ${use.plan}, ${shortDate(use.cycle_start)} to ${shortDate(use.cycle_end)} (UTC). Limits from PLAN_LIMITS.`}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {use.items.map((u) => {
            const share = u.limit ? Math.min(1, u.used / u.limit) : 0;
            const over = u.limit !== null && u.used > u.limit;
            return (
              <div key={u.key} className="rounded-md border border-con-line px-3 py-2.5">
                <p className="text-[12px] text-con-fg3">{u.label}</p>
                <p className="mt-1 text-[18px] font-semibold tabular-nums text-con-fg">
                  {u.used}
                  <span className="ml-1 text-[12px] font-normal text-con-fg3">/ {u.limit ?? "unlimited"}</span>
                </p>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-con-row">
                  <div
                    className={cn("con-grow-x h-full rounded-full", over ? "bg-con-bad" : share >= 0.8 ? "bg-con-warn" : "bg-con-fg3")}
                    style={{ width: `${u.limit ? Math.max(2, share * 100) : 0}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Members" description={`${members.length} member${members.length === 1 ? "" : "s"}`} flush>
          {members.length === 0 ? (
            <EmptyState title="No members" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-con-line">
                    <th className={tableHead}>User</th>
                    <th className={tableHead}>Role</th>
                    <th className={tableHead}>Last sign-in</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.user_id} className="border-b border-con-line last:border-0">
                      <td className={tableCell}>
                        <Link href={`/admin/users/${m.user_id}`} className="text-con-fg hover:underline">
                          {m.email}
                        </Link>
                        {m.name && <span className="ml-2 text-con-fg3">{m.name}</span>}
                      </td>
                      <td className={tableCell}>
                        <Pill className="capitalize">{m.role}</Pill>
                      </td>
                      <td className={cn(tableCell, "text-con-fg2")}>{m.last_login_at ? ago(m.last_login_at, now) : "never"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card
          title="API keys"
          description={`${activeKeys.length} active, ${keys.length - activeKeys.length} revoked`}
          flush
          aside={
            activeKeys.length > 0 && (
              <AdminAction
                action={revokeAllKeysAction}
                fields={{ org: org.id }}
                label="Revoke all"
                confirm={`Revoke ${activeKeys.length} key${activeKeys.length === 1 ? "" : "s"}? CLIs and runners using them stop working.`}
                tone="danger"
                icon={<KeyRound size={13} />}
              />
            )
          }
        >
          {keys.length === 0 ? (
            <EmptyState title="No API keys" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-[13px]">
                <thead>
                  <tr className="border-b border-con-line">
                    <th className={tableHead}>Key</th>
                    <th className={tableHead}>Scopes</th>
                    <th className={tableHead}>Last used</th>
                    <th className={cn(tableHead, "text-right")}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map((k) => (
                    <tr key={k.id} className={cn("border-b border-con-line last:border-0", k.revoked_at && "text-con-fg3")}>
                      <td className={tableCell}>
                        <span className="font-mono">{k.prefix}…</span>
                        <span className="ml-2 text-con-fg3">{k.name}</span>
                      </td>
                      <td className={cn(tableCell, "text-[12px] text-con-fg2")}>{k.scopes.join(", ")}</td>
                      <td className={cn(tableCell, "whitespace-nowrap text-con-fg2")}>{k.last_used_at ? ago(k.last_used_at, now) : "never"}</td>
                      <td className={cn(tableCell, "text-right")}>
                        {k.revoked_at ? (
                          <Pill>Revoked</Pill>
                        ) : (
                          <AdminAction action={revokeKeyAction} fields={{ org: org.id, key: k.id }} label="Revoke" confirm="Revoke this key?" tone="danger" size="sm" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card title="Services" description={`${liveServices.length} active, ${services.length - liveServices.length} archived`} flush>
          {services.length === 0 ? (
            <EmptyState title="No services" />
          ) : (
            <ul className="divide-y divide-con-line">
              {services.map((s) => (
                <li key={s.id} className={cn("flex items-center gap-3 px-5 py-2.5 text-[13px]", s.archived_at && "text-con-fg3")}>
                  <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                  {s.critical && <Pill tone="warn">Critical</Pill>}
                  <Pill>{s.target}</Pill>
                  {s.archived_at && <Pill>Archived</Pill>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Recent deployments" description="Newest first" flush>
          {deps.length === 0 ? (
            <EmptyState title="No deployments yet" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-[13px]">
                <thead>
                  <tr className="border-b border-con-line">
                    <th className={tableHead}>Service</th>
                    <th className={tableHead}>Status</th>
                    <th className={tableHead}>Risk</th>
                    <th className={tableHead}>Environment</th>
                    <th className={tableHead}>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {deps.map((d) => (
                    <tr key={d.id} className="border-b border-con-line last:border-0">
                      <td className={tableCell}>
                        <span className="font-medium text-con-fg">{d.service}</span>
                        <span className="ml-2 font-mono text-[12px] text-con-fg3">{d.id.slice(-6)}</span>
                      </td>
                      <td className={tableCell}>
                        <StatusBadge status={d.status} />
                      </td>
                      <td className={tableCell}>
                        <RiskValue score={Number(d.risk?.score ?? 0)} />
                      </td>
                      <td className={cn(tableCell, "text-con-fg2")}>{d.environment ?? "production"}</td>
                      <td className={cn(tableCell, "whitespace-nowrap text-con-fg2")}>{ago(d.created_at, now)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Card title="Danger zone" description="Deleting removes members, services, deployments, jobs, keys, audit rows and settings. The deletion itself is kept in the instance log.">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-con-fg2">
            Not reversible. {members.length} member{members.length === 1 ? "" : "s"} lose access to this org.
          </p>
          <DeleteOrgDialog
            orgId={org.id}
            slug={org.slug}
            name={org.name}
            counts={`${members.length} members, ${services.length} services, ${activeKeys.length} active API keys and all deployment history will be deleted.`}
          />
        </div>
      </Card>
    </div>
  );
}
