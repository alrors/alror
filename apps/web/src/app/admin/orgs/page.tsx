import type { Metadata } from "next";
import Link from "next/link";
import { AdminHeader, one, pct, SearchBox, shortDate, tableCell, tableHead } from "@/components/admin/kit";
import { FlashToast } from "@/components/admin/org-controls";
import { Pagination } from "@/components/console/pagination";
import { Card, EmptyState, Pill } from "@/components/console/primitives";
import { Selector } from "@/components/console/selector";
import { pageMeta, parsePage, parsePer } from "@/lib/console/paginate";
import { requirePlatformAdmin } from "@/lib/server/admin/guard";
import { listOrgsAdmin, ORG_SORTS, type OrgSort } from "@/lib/server/admin/orgs";
import { PLANS, type Plan } from "@/lib/server/db/schema";
import { cn } from "@/lib/site";

export const metadata: Metadata = { title: "Organizations" };

const SORT_LABELS: Record<OrgSort, string> = {
  created: "Newest",
  name: "Name",
  deploys: "Deploys 30d",
  members: "Members",
  rollback: "Rollback rate",
};

export default async function AdminOrgs({ searchParams }: PageProps<"/admin/orgs">) {
  const admin = await requirePlatformAdmin();
  const sp = await searchParams;
  const q = one(sp.q).slice(0, 100);
  const plan = (PLANS as readonly string[]).includes(one(sp.plan)) ? (one(sp.plan) as Plan) : undefined;
  const sort = (ORG_SORTS as readonly string[]).includes(one(sp.sort)) ? (one(sp.sort) as OrgSort) : "created";
  const per = parsePer(sp.per);
  let page = parsePage(sp.page);
  let r = await listOrgsAdmin(admin, { q, plan, sort, page, per });
  const pages = Math.max(1, Math.ceil(r.total / per));
  if (page > pages) {
    page = pages;
    r = await listOrgsAdmin(admin, { q, plan, sort, page, per });
  }
  const meta = pageMeta(r.items, r.total, page, per);
  const params = { q: q || undefined, plan, sort: sort !== "created" ? sort : undefined };
  const deleted = one(sp.deleted);

  return (
    <div className="con-fade-up">
      <FlashToast message={deleted ? `Organization ${deleted} deleted.` : null} />
      <AdminHeader title="Organizations" description="Every organization on the instance with members, services and 30-day deploy activity." />
      <Card flush>
        <SearchBox action="/admin/orgs" q={q} placeholder="Search by name, slug or id" keep={{ per: sp.per ? String(per) : undefined }}>
          <Selector
            name="plan"
            aria-label="Plan"
            prefix="Plan"
            className="w-40"
            submitOnChange
            defaultValue={plan ?? ""}
            options={[{ value: "", label: "All" }, ...PLANS.map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) }))]}
          />
          <Selector
            name="sort"
            aria-label="Sort"
            prefix="Sort"
            className="w-48"
            submitOnChange
            defaultValue={sort}
            options={ORG_SORTS.map((s) => ({ value: s, label: SORT_LABELS[s] }))}
          />
        </SearchBox>
        {meta.items.length === 0 ? (
          <EmptyState title={q || plan ? "No organizations match" : "No organizations yet"}>{q || plan ? "Try another search or plan." : "Organizations appear here when people sign up."}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-[13px]">
              <thead>
                <tr className="border-b border-con-line">
                  <th className={tableHead}>Name</th>
                  <th className={tableHead}>Slug</th>
                  <th className={tableHead}>Plan</th>
                  <th className={cn(tableHead, "text-right")}>Members</th>
                  <th className={cn(tableHead, "text-right")}>Services</th>
                  <th className={cn(tableHead, "text-right")}>Deploys 30d</th>
                  <th className={cn(tableHead, "text-right")}>Rollback rate</th>
                  <th className={tableHead}>Created</th>
                </tr>
              </thead>
              <tbody className="con-stagger">
                {meta.items.map((o) => (
                  <tr key={o.id} className="con-ease border-b border-con-line last:border-0 hover:bg-con-hover">
                    <td className={tableCell}>
                      <Link href={`/admin/orgs/${o.id}`} className="font-medium text-con-fg hover:underline">
                        {o.name}
                      </Link>
                    </td>
                    <td className={cn(tableCell, "font-mono text-con-fg2")}>{o.slug}</td>
                    <td className={tableCell}>
                      <Pill className="capitalize">{o.plan}</Pill>
                    </td>
                    <td className={cn(tableCell, "text-right tabular-nums")}>{o.members}</td>
                    <td className={cn(tableCell, "text-right tabular-nums")}>{o.services}</td>
                    <td className={cn(tableCell, "text-right tabular-nums")}>{o.deploys_30d}</td>
                    <td className={cn(tableCell, "text-right tabular-nums", o.rollback_rate !== null && o.rollback_rate >= 0.2 ? "text-con-warn" : "text-con-fg2")}>
                      {pct(o.rollback_rate, 1)}
                    </td>
                    <td className={cn(tableCell, "whitespace-nowrap text-con-fg2")}>{shortDate(o.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination meta={meta} noun="organizations" base="/admin/orgs" params={params} />
      </Card>
    </div>
  );
}
