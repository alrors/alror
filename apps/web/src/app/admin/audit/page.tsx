import type { Metadata } from "next";
import Link from "next/link";
import { AdminHeader, one, SearchBox, tableCell, tableHead } from "@/components/admin/kit";
import { hrefWith, Pagination } from "@/components/console/pagination";
import { Card, EmptyState, Pill, Segmented } from "@/components/console/primitives";
import { Selector } from "@/components/console/selector";
import { dateTime } from "@/lib/console/format";
import { pageMeta, parsePage, parsePer } from "@/lib/console/paginate";
import { requirePlatformAdmin } from "@/lib/server/admin/guard";
import { listAuditAdmin } from "@/lib/server/admin/insights";
import { readAdminLog } from "@/lib/server/admin/log";
import { orgOptions } from "@/lib/server/admin/orgs";
import { cn } from "@/lib/site";

export const metadata: Metadata = { title: "Audit" };

const CATEGORIES = [
  { value: "", label: "All" },
  { value: "admin", label: "Platform admin" },
  { value: "deployment", label: "Deployments" },
  { value: "job", label: "Jobs" },
  { value: "service", label: "Services" },
  { value: "policy", label: "Policy" },
  { value: "config", label: "Config" },
  { value: "member", label: "Members" },
  { value: "api_key", label: "API keys" },
  { value: "org", label: "Organization" },
  { value: "plugin", label: "Marketplace" },
];

function metaText(meta: Record<string, unknown>): string {
  const entries = Object.entries(meta).filter(([k]) => k !== "platform_admin");
  if (entries.length === 0) return "";
  return entries
    .slice(0, 4)
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" ")
    .slice(0, 160);
}

export default async function AdminAudit({ searchParams }: PageProps<"/admin/audit">) {
  const admin = await requirePlatformAdmin();
  const sp = await searchParams;
  const view = one(sp.view) === "admin" ? "admin" : "orgs";
  const per = parsePer(sp.per);
  const page = parsePage(sp.page);

  const tabs = (
    <Segmented
      active={view}
      items={[
        { value: "orgs", label: "Org audit logs", href: "/admin/audit" },
        { value: "admin", label: "Admin actions", href: "/admin/audit?view=admin" },
      ]}
    />
  );

  if (view === "admin") {
    let p = page;
    let r = await readAdminLog(p, per);
    const pages = Math.max(1, Math.ceil(r.total / per));
    if (p > pages) {
      p = pages;
      r = await readAdminLog(p, per);
    }
    const meta = pageMeta(r.items, r.total, p, per);
    return (
      <div className="con-fade-up">
        <AdminHeader
          title="Audit"
          description="Every action taken in this admin area, including ones whose org was later deleted (kept in Redis, newest 1000)."
          actions={tabs}
        />
        <Card flush>
          {meta.items.length === 0 ? (
            <EmptyState title="No admin actions yet" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-[13px]">
                <thead>
                  <tr className="border-b border-con-line">
                    <th className={tableHead}>Time (UTC)</th>
                    <th className={tableHead}>Admin</th>
                    <th className={tableHead}>Action</th>
                    <th className={tableHead}>Target</th>
                    <th className={tableHead}>Org</th>
                    <th className={tableHead}>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {meta.items.map((e, i) => (
                    <tr key={`${e.at}-${i}`} className="border-b border-con-line last:border-0">
                      <td className={cn(tableCell, "whitespace-nowrap text-con-fg2")}>{dateTime(e.at)}</td>
                      <td className={cn(tableCell, "text-con-fg2")}>{e.actor}</td>
                      <td className={cn(tableCell, "font-mono text-[12px] text-con-fg")}>{e.action}</td>
                      <td className={cn(tableCell, "max-w-[200px] truncate font-mono text-[12px] text-con-fg2")} title={e.target}>
                        {e.target}
                      </td>
                      <td className={cn(tableCell, "text-con-fg2")}>{e.org ?? "–"}</td>
                      <td className={cn(tableCell, "max-w-[280px] truncate font-mono text-[12px] text-con-fg3")} title={metaText(e.meta)}>
                        {metaText(e.meta)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination meta={meta} noun="entries" base="/admin/audit" params={{ view: "admin" }} />
        </Card>
      </div>
    );
  }

  const org = one(sp.org);
  const category = CATEGORIES.some((c) => c.value === one(sp.category)) ? one(sp.category) : "";
  const q = one(sp.q).slice(0, 100);
  const orgs = await orgOptions(admin);
  const orgValid = orgs.some((o) => o.id === org);
  const opts = { orgId: orgValid ? org : undefined, category: category || undefined, q, per };
  let p = page;
  let r = await listAuditAdmin(admin, { ...opts, page: p });
  const pages = Math.max(1, Math.ceil(r.total / per));
  if (p > pages) {
    p = pages;
    r = await listAuditAdmin(admin, { ...opts, page: p });
  }
  const meta = pageMeta(r.items, r.total, p, per);
  const params = { org: orgValid ? org : undefined, category: category || undefined, q: q || undefined };

  return (
    <div className="con-fade-up">
      <AdminHeader title="Audit" description="The audit log of every organization, newest first. Entries cannot be edited or deleted." actions={tabs} />
      <Card flush>
        <SearchBox action="/admin/audit" q={q} placeholder="Search actor, target or action" keep={{ per: sp.per ? String(per) : undefined }}>
          <Selector
            name="org"
            aria-label="Organization"
            prefix="Org"
            className="w-56"
            submitOnChange
            defaultValue={orgValid ? org : ""}
            options={[{ value: "", label: "All" }, ...orgs.map((o) => ({ value: o.id, label: o.slug, description: o.name }))]}
          />
          <Selector name="category" aria-label="Category" prefix="Category" className="w-56" submitOnChange defaultValue={category} options={CATEGORIES} />
        </SearchBox>
        {meta.items.length === 0 ? (
          <EmptyState title="No entries match">Try another filter.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-[13px]">
              <thead>
                <tr className="border-b border-con-line">
                  <th className={tableHead}>Time (UTC)</th>
                  <th className={tableHead}>Org</th>
                  <th className={tableHead}>Actor</th>
                  <th className={tableHead}>Action</th>
                  <th className={tableHead}>Target</th>
                  <th className={tableHead}>Details</th>
                </tr>
              </thead>
              <tbody>
                {meta.items.map((e) => (
                  <tr key={e.id} className="border-b border-con-line last:border-0">
                    <td className={cn(tableCell, "whitespace-nowrap text-con-fg2")}>{dateTime(e.at)}</td>
                    <td className={tableCell}>
                      <Link href={hrefWith("/admin/audit", params, { org: e.org_id, page: undefined })} className="text-con-fg2 hover:text-con-fg">
                        {e.org}
                      </Link>
                    </td>
                    <td className={cn(tableCell, "max-w-[220px] truncate text-con-fg2")} title={e.actor_label}>
                      {e.actor_type !== "user" && <Pill className="mr-1.5">{e.actor_type === "api_key" ? "key" : e.actor_type}</Pill>}
                      {e.actor_label}
                    </td>
                    <td className={cn(tableCell, "font-mono text-[12px]", e.action.startsWith("admin.") ? "text-con-warn" : "text-con-fg")}>{e.action}</td>
                    <td className={cn(tableCell, "max-w-[200px] truncate font-mono text-[12px] text-con-fg2")} title={e.target}>
                      {e.target}
                    </td>
                    <td className={cn(tableCell, "max-w-[260px] truncate font-mono text-[12px] text-con-fg3")} title={metaText(e.meta)}>
                      {metaText(e.meta)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination meta={meta} noun="entries" base="/admin/audit" params={params} />
      </Card>
    </div>
  );
}
