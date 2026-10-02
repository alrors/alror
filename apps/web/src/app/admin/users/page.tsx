import type { Metadata } from "next";
import Link from "next/link";
import { AdminHeader, one, SearchBox, shortDate, tableCell, tableHead } from "@/components/admin/kit";
import { Pagination } from "@/components/console/pagination";
import { Card, EmptyState, Pill } from "@/components/console/primitives";
import { Selector } from "@/components/console/selector";
import { ago, requestTime } from "@/lib/console/format";
import { pageMeta, parsePage, parsePer } from "@/lib/console/paginate";
import { isPlatformAdmin } from "@/lib/server/admin/access";
import { requirePlatformAdmin } from "@/lib/server/admin/guard";
import { orgOptions } from "@/lib/server/admin/orgs";
import { listUsersAdmin, sessionCounts } from "@/lib/server/admin/users";
import { cn } from "@/lib/site";

export const metadata: Metadata = { title: "Users" };

export default async function AdminUsers({ searchParams }: PageProps<"/admin/users">) {
  const admin = await requirePlatformAdmin();
  const sp = await searchParams;
  const q = one(sp.q).slice(0, 100);
  const org = one(sp.org);
  const per = parsePer(sp.per);
  let page = parsePage(sp.page);
  const [first, orgs, sessions] = await Promise.all([listUsersAdmin(admin, { q, orgId: org, page, per }), orgOptions(admin), sessionCounts(admin)]);
  let r = first;
  const pages = Math.max(1, Math.ceil(r.total / per));
  if (page > pages) {
    page = pages;
    r = await listUsersAdmin(admin, { q, orgId: org, page, per });
  }
  const meta = pageMeta(r.items, r.total, page, per);
  const now = requestTime();
  const orgValid = orgs.some((o) => o.id === org);

  return (
    <div className="con-fade-up">
      <AdminHeader title="Users" description="Every account on the instance, with their organizations and roles. Open a user to sign them out, reset their password or remove a membership." />
      <Card flush>
        <SearchBox action="/admin/users" q={q} placeholder="Search by email or name" keep={{ per: sp.per ? String(per) : undefined }}>
          <Selector
            name="org"
            aria-label="Organization"
            prefix="Org"
            className="w-56"
            submitOnChange
            defaultValue={orgValid ? org : ""}
            options={[{ value: "", label: "All" }, ...orgs.map((o) => ({ value: o.id, label: o.slug, description: o.name }))]}
          />
        </SearchBox>
        {meta.items.length === 0 ? (
          <EmptyState title="No users match">Try another search or organization.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-[13px]">
              <thead>
                <tr className="border-b border-con-line">
                  <th className={tableHead}>Email</th>
                  <th className={tableHead}>Name</th>
                  <th className={tableHead}>Organizations and roles</th>
                  <th className={cn(tableHead, "text-right")}>Sessions</th>
                  <th className={tableHead}>Created</th>
                  <th className={tableHead}>Last sign-in</th>
                </tr>
              </thead>
              <tbody className="con-stagger">
                {meta.items.map((u) => (
                  <tr key={u.id} className="con-ease border-b border-con-line last:border-0 hover:bg-con-hover">
                    <td className={tableCell}>
                      <Link href={`/admin/users/${u.id}`} className="font-medium text-con-fg hover:underline">
                        {u.email}
                      </Link>
                      {isPlatformAdmin(u.email) && <Pill className="ml-2">Platform admin</Pill>}
                    </td>
                    <td className={cn(tableCell, "text-con-fg2")}>{u.name || "–"}</td>
                    <td className={tableCell}>
                      {u.memberships.length === 0 ? (
                        <span className="text-con-fg3">No organization</span>
                      ) : (
                        <span className="flex flex-wrap gap-1.5">
                          {u.memberships.map((m) => (
                            <Link key={m.org_id} href={`/admin/orgs/${m.org_id}`} className="con-ease rounded-full hover:opacity-80">
                              <Pill>
                                {m.slug}
                                <span className="text-con-fg3">{m.role}</span>
                              </Pill>
                            </Link>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className={cn(tableCell, "text-right tabular-nums text-con-fg2")}>{sessions[u.id] ?? 0}</td>
                    <td className={cn(tableCell, "whitespace-nowrap text-con-fg2")}>{shortDate(u.created_at)}</td>
                    <td className={cn(tableCell, "whitespace-nowrap text-con-fg2")}>{u.last_login_at ? ago(u.last_login_at, now) : "never"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination meta={meta} noun="users" base="/admin/users" params={{ q: q || undefined, org: orgValid ? org : undefined }} />
      </Card>
    </div>
  );
}
