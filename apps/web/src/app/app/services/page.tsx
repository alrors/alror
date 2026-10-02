import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { ConfirmAction } from "@/components/console/confirm-action";
import { FilterForm } from "@/components/console/filter-form";
import { Pagination, hrefWith } from "@/components/console/pagination";
import { Card, EmptyState } from "@/components/console/primitives";
import { Selector } from "@/components/console/selector";
import { ServiceGrid, ServiceTable, type ServiceListRow } from "@/components/console/service-card";
import { NewServiceButton } from "@/components/console/service-form";
import { ServiceViewSwitch } from "@/components/console/service-view-switch";
import { anchorNow, serviceRows, type ServiceHealth } from "@/lib/console/analytics";
import { requireSession } from "@/lib/console/auth";
import { listDeployments } from "@/lib/console/data";
import { paginate, parsePage } from "@/lib/console/paginate";
import { readProjectConfig } from "@/lib/console/policy";
import { ctxFor } from "@/lib/server/auth/accounts";
import { isAdminRole } from "@/lib/server/context";
import { enabledTargets } from "@/lib/server/data/plugins";
import { listServices } from "@/lib/server/data/services";
import { cn } from "@/lib/site";
import { setArchived } from "./actions";

export const metadata: Metadata = { title: "Services" };

const HEALTH: { value: ServiceHealth | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "healthy", label: "Healthy" },
  { value: "rolling", label: "Rolling" },
  { value: "rolled_back", label: "Rolled back" },
  { value: "idle", label: "No releases" },
];

const SHOW = [
  { value: "active", label: "Active services" },
  { value: "critical", label: "Critical only" },
  { value: "all", label: "Active and archived" },
  { value: "archived", label: "Archived only" },
] as const;
type Show = (typeof SHOW)[number]["value"];

const SORTS = [
  { value: "name", label: "Name" },
  { value: "recent", label: "Last release" },
  { value: "deploys", label: "Most deploys" },
  { value: "rollbacks", label: "Highest rollback rate" },
  { value: "risk", label: "Highest risk" },
] as const;
type Sort = (typeof SORTS)[number]["value"];

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const PER = 24;

export default async function ServicesPage({ searchParams }: PageProps<"/app/services">) {
  const sp = await searchParams;
  const session = await requireSession();
  const ctx = ctxFor(session);
  const admin = isAdminRole(session.role);
  const [deps, config, allServices, enabled] = await Promise.all([listDeployments(), readProjectConfig(), listServices(ctx, { includeArchived: true }), enabledTargets(ctx)]);
  const now = anchorNow(deps);

  const archived = allServices.filter((s) => s.archived_at);
  const archivedNames = new Set(archived.map((s) => s.name));
  const known = [
    ...config.services,
    ...archived.map((s) => ({ name: s.name, target: s.target, paths: s.paths, critical: s.critical, cluster: s.cluster || undefined })),
  ];
  const rows: ServiceListRow[] = serviceRows(known, deps, now).map((r) => ({ ...r, archived: archivedNames.has(r.name) }));
  const activeRows = rows.filter((r) => !r.archived);

  const q = one(sp.q).trim().toLowerCase().slice(0, 80);
  const status = HEALTH.some((h) => h.value === one(sp.status)) ? (one(sp.status) as ServiceHealth | "all") : "all";
  const show: Show = SHOW.some((s) => s.value === one(sp.show)) ? (one(sp.show) as Show) : "active";
  const sort: Sort = SORTS.some((s) => s.value === one(sp.sort)) ? (one(sp.sort) as Sort) : "name";
  const targets = [...new Set(rows.map((r) => r.target))].sort();
  const target = targets.includes(one(sp.target)) ? one(sp.target) : "";
  const viewParam = one(sp.view);
  const initialView = viewParam === "list" || viewParam === "grid" ? viewParam : null;

  const inScope = rows.filter((r) =>
    show === "archived" ? r.archived : show === "all" ? true : show === "critical" ? !r.archived && r.critical : !r.archived,
  );
  const scoped = inScope.filter(
    (r) => (!target || r.target === target) && (!q || r.name.toLowerCase().includes(q) || r.paths.some((p) => p.toLowerCase().includes(q))),
  );
  const showCounts: Record<Show, number> = {
    active: rows.filter((r) => !r.archived).length,
    critical: rows.filter((r) => !r.archived && r.critical).length,
    all: rows.length,
    archived: rows.filter((r) => r.archived).length,
  };
  const filtered = scoped
    .filter((r) => status === "all" || r.health === status)
    .sort((a, b) => {
      switch (sort) {
        case "recent":
          return Date.parse(b.last?.created_at ?? "0") - Date.parse(a.last?.created_at ?? "0");
        case "deploys":
          return b.recent.length - a.recent.length || a.name.localeCompare(b.name);
        case "rollbacks":
          return b.cfr - a.cfr || b.recent.length - a.recent.length;
        case "risk":
          return b.avgRisk - a.avgRisk;
        default:
          return a.name.localeCompare(b.name);
      }
    });
  const page = paginate(filtered, parsePage(sp.page), PER);
  const params = {
    q: q || undefined,
    status: status === "all" ? undefined : status,
    show: show === "active" ? undefined : show,
    sort: sort === "name" ? undefined : sort,
    target: target || undefined,
    view: initialView ?? undefined,
  };
  const filtersOn = Boolean(q || status !== "all" || show !== "active" || target || sort !== "name");
  const counts = Object.fromEntries(HEALTH.map((h) => [h.value, h.value === "all" ? scoped.length : scoped.filter((r) => r.health === h.value).length]));

  const toolbar = (
    <FilterForm action="/app/services" className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      {params.status && <input type="hidden" name="status" value={params.status} />}
      {params.view && <input type="hidden" name="view" value={params.view} />}
      <label className="flex h-8 min-w-[200px] flex-1 items-center gap-2 rounded-md border border-con-line bg-con-bg px-2.5 text-con-fg3 focus-within:border-con-line-hover sm:max-w-xs">
        <Search size={14} />
        <span className="sr-only">Search services by name or path</span>
        <input
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Search name or path"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-con-fg outline-none placeholder:text-con-fg3"
        />
      </label>
      <Selector
        id="svc-show"
        name="show"
        aria-label="Show"
        submitOnChange
        className="w-auto"
        minWidth={220}
        defaultValue={show}
        options={SHOW.map((s) => ({ value: s.value, label: s.label, meta: showCounts[s.value] }))}
      />
      <Selector
        id="svc-target"
        name="target"
        aria-label="Target"
        submitOnChange
        className="w-auto"
        minWidth={200}
        defaultValue={target}
        options={[{ value: "", label: "Any target" }, ...targets.map((t) => ({ value: t, label: t, meta: inScope.filter((r) => r.target === t).length }))]}
      />
      <Selector
        id="svc-sort"
        name="sort"
        aria-label="Sort by"
        submitOnChange
        className="w-auto"
        prefix="Sort"
        minWidth={220}
        defaultValue={sort}
        options={SORTS.map((s) => ({ value: s.value, label: s.label }))}
      />
      <button type="submit" className="sr-only">
        Apply
      </button>
      {filtersOn && (
        <Link href="/app/services" className="px-1 text-[13px] text-con-fg2 hover:text-con-fg">
          Reset
        </Link>
      )}
    </FilterForm>
  );

  const empty =
    activeRows.length === 0 && archived.length === 0 ? (
      <Card>
        <EmptyState title="No services yet">
          {admin
            ? "Create one with New service, or push alror.yaml with alror config push. Each service lists the file paths that belong to it."
            : "An owner or admin can add services, or push them with alror config push."}
        </EmptyState>
      </Card>
    ) : page.total === 0 ? (
      <Card>
        <EmptyState title="No services match">
          Clear the search or filters to see every service.{" "}
          <Link href="/app/services" className="text-con-fg underline-offset-4 hover:underline">
            Reset filters
          </Link>
        </EmptyState>
      </Card>
    ) : null;

  return (
    <div className="space-y-6">
      <div className="con-fade-up flex flex-col gap-1">
        <h1 className="text-[28px] font-semibold tracking-[-0.025em]">Services</h1>
        <p className="text-[14px] text-con-fg2">
          {activeRows.length} active service{activeRows.length === 1 ? "" : "s"} in {config.project}
          {archived.length ? `, ${archived.length} archived` : ""}. Each card shows its health now and its last 30 days of releases.
        </p>
      </div>

      {/* Health filter with counts */}
      <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
        {HEALTH.map((h) => {
          const on = h.value === status;
          return (
            <Link
              key={h.value}
              href={hrefWith("/app/services", params, { status: h.value === "all" ? undefined : h.value, page: undefined })}
              aria-current={on ? "page" : undefined}
              scroll={false}
              className={cn(
                "con-ease inline-flex h-8 items-center gap-2 rounded-md border px-3 text-[13px]",
                on ? "border-con-line-hover bg-con-row text-con-fg" : "border-con-line text-con-fg2 hover:border-con-line-hover hover:text-con-fg",
              )}
            >
              {h.label}
              <span className="font-mono text-[12px] tabular-nums text-con-fg3">{counts[h.value]}</span>
            </Link>
          );
        })}
      </nav>

      <ServiceViewSwitch
        initial={initialView}
        toolbar={toolbar}
        actions={admin ? <NewServiceButton targets={enabled} /> : undefined}
        grid={empty ?? <ServiceGrid rows={page.items} now={now} />}
        list={empty ?? <ServiceTable rows={page.items} now={now} />}
        footer={
          page.pages > 1 ? (
            <div className="rounded-lg border border-con-line">
              <Pagination meta={page} noun="services" base="/app/services" params={params} showPer={false} className="border-t-0" />
            </div>
          ) : undefined
        }
      />

      {archived.length > 0 && show === "active" && (
        <Card title="Archived services" description="Hidden from the list above and from GET /config. New deployments are rejected until restored." flush>
          <ul className="divide-y divide-con-row">
            {archived.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                <Link href={`/app/services/${encodeURIComponent(s.name)}`} className="min-w-0 truncate text-[13px] text-con-fg2 hover:text-con-fg">
                  {s.name}
                </Link>
                {admin && <ConfirmAction action={setArchived} fields={{ name: s.name, archived: "false" }} label="Restore" tone="secondary" />}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
