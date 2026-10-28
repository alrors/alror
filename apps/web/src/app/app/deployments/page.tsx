import type { Metadata } from "next";
import Link from "next/link";
import { Bot, Search } from "lucide-react";
import { CountUp } from "@/components/console/count-up";
import { DeployButton } from "@/components/console/deploy-dialog";
import { FilterForm } from "@/components/console/filter-form";
import { Pagination, hrefWith } from "@/components/console/pagination";
import { Card, Dot, EmptyState, PageHeader, buttonClass } from "@/components/console/primitives";
import { Selector } from "@/components/console/selector";
import { ReleaseTable } from "@/components/console/release-table";
import { ReleaseToolbar } from "@/components/console/release-toolbar";
import { anchorNow } from "@/lib/console/analytics";
import { listDeployments } from "@/lib/console/data";
import { environments, selectedEnvironment } from "@/lib/console/environments";
import { readProjectConfig } from "@/lib/console/policy";
import { paginate, parsePage, parsePer } from "@/lib/console/paginate";
import { levelTone } from "@/lib/console/format";
import { cn } from "@/lib/site";
import { LEVELS, SORTS, SOURCES, STATUSES, applyBase, filterParams, isActive, matchesStatus, parseFilters, sortDeployments } from "./filters";

export const metadata: Metadata = { title: "Deployments" };

const SOURCE_LABEL: Record<string, string> = { cli: "CLI", ci: "CI", console: "Console", runner: "Runner" };
const SOURCE_HINT: Record<string, string> = {
  cli: "alror deploy from a terminal",
  ci: "A CI pipeline (GitHub Actions)",
  console: "Queued from this console",
  runner: "Run by alror runner",
};

export default async function DeploymentsPage({ searchParams }: PageProps<"/app/deployments">) {
  const sp = await searchParams;
  const [deps, envs, env, config] = await Promise.all([listDeployments(), environments(), selectedEnvironment(sp.environment), readProjectConfig()]);
  const now = anchorNow(deps);

  const services = [...new Set(deps.map((d) => d.service))].sort();
  const perService: Record<string, number> = {};
  for (const d of deps) if (!env || (d.environment ?? "production") === env) perService[d.service] = (perService[d.service] ?? 0) + 1;
  const f = parseFilters(sp, services, env);
  const base = applyBase(deps, f);
  const counts = Object.fromEntries(STATUSES.map((s) => [s.value, base.filter((d) => matchesStatus(d, s.value)).length]));
  const filtered = sortDeployments(
    base.filter((d) => matchesStatus(d, f.status)),
    f.sort,
    now,
  );
  const page = paginate(filtered, parsePage(sp.page), parsePer(sp.per));
  const params = filterParams(f);
  const active = isActive(f);

  // Board for the current view.
  const finished = filtered.filter((d) => d.status === "promoted" || d.status === "rolled_back" || d.status === "failed");
  const promoted = finished.filter((d) => d.status === "promoted").length;
  const stopped = finished.length - promoted;
  const avgRisk = filtered.length ? filtered.reduce((t, d) => t + (d.risk?.score ?? 0), 0) / filtered.length : 0;
  const aiCount = filtered.filter((d) => d.risk?.ai_authored).length;

  // Quick filters toggle one param on or off, keeping the rest.
  const quick: { label: string; key: string; value: string; on: boolean }[] = [
    { label: "Live now", key: "status", value: "rolling", on: f.status === "rolling" },
    { label: "Rolled back", key: "status", value: "rolled_back", on: f.status === "rolled_back" },
    { label: "High risk", key: "risk", value: "high", on: f.risk === "high" },
    { label: "AI-authored", key: "ai", value: "1", on: f.ai },
    ...SOURCES.map((s) => ({ label: `From ${SOURCE_LABEL[s]}`, key: "source", value: s, on: f.source === s })),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Deployments"
        description="Every release across your services: risk, rollout progress and verdicts."
        actions={<DeployButton defaults={{ services: config.services.map((s) => s.name), environments: envs, environment: env ?? undefined }} />}
      />

      <div className="con-stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        <BoardTile label="In this view" hint={active ? "matching your filters" : "all deployments"}>
          <CountUp value={filtered.length} />
        </BoardTile>
        <BoardTile label="Promoted" hint={finished.length ? `of ${finished.length} finished` : "none finished yet"}>
          <CountUp value={finished.length ? (promoted / finished.length) * 100 : 0} suffix="%" />
        </BoardTile>
        <BoardTile label="Stopped" hint="rolled back or failed">
          <CountUp value={stopped} />
        </BoardTile>
        <BoardTile label="Average risk" hint={aiCount ? `${aiCount} AI-authored` : "0 is safest, 100 riskiest"}>
          <CountUp value={avgRisk} />
        </BoardTile>
      </div>

      <Card flush>
        {/* Status tabs */}
        <div className="flex gap-1 overflow-x-auto border-b border-con-line px-3 pt-2">
          {STATUSES.map((s) => {
            const on = s.value === f.status;
            return (
              <Link
                key={s.value}
                href={hrefWith("/app/deployments", params, { status: s.value === "all" ? undefined : s.value })}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "relative -mb-px flex h-10 shrink-0 items-center gap-2 border-b-2 px-3 text-[14px] transition-colors duration-150",
                  on ? "border-con-fg text-con-fg" : "border-transparent text-con-fg2 hover:text-con-fg",
                )}
              >
                {s.label}
                <span className={cn("rounded-full px-1.5 text-[12px] tabular-nums", on ? "bg-con-row text-con-fg" : "text-con-fg3")}>{counts[s.value]}</span>
              </Link>
            );
          })}
        </div>

        {/* Quick filters */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-con-line px-5 py-2.5">
          <span className="mr-1 text-[12px] text-con-fg3">Quick filters</span>
          {quick.map((q) => (
            <Link
              key={`${q.key}:${q.value}`}
              href={hrefWith("/app/deployments", params, { [q.key]: q.on ? undefined : q.value })}
              aria-pressed={q.on}
              className={cn(
                "con-ease inline-flex h-7 items-center rounded-full border px-2.5 text-[12px]",
                q.on ? "border-con-line-hover bg-con-row text-con-fg" : "border-con-line text-con-fg2 hover:border-con-line-hover hover:text-con-fg",
              )}
            >
              {q.label}
            </Link>
          ))}
        </div>

        {/* Filters */}
        <FilterForm action="/app/deployments" className="flex flex-col gap-2 border-b border-con-line px-5 py-3 md:flex-row md:items-center">
          {f.status !== "all" && <input type="hidden" name="status" value={f.status} />}
          {f.sort !== "newest" && <input type="hidden" name="sort" value={f.sort} />}
          {sp.per && <input type="hidden" name="per" value={String(page.per)} />}
          <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-con-line bg-con-bg px-2.5 text-con-fg3 focus-within:border-con-line-hover md:max-w-sm">
            <Search size={14} className="shrink-0" />
            <span className="sr-only">Search</span>
            <input
              name="q"
              type="search"
              defaultValue={f.q}
              placeholder="Search service, ref, image or ID"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-con-fg outline-none placeholder:text-con-fg3"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Selector
              name="environment"
              aria-label="Environment"
              submitOnChange
              className="md:w-40"
              defaultValue={env ?? "all"}
              options={[{ value: "all", label: "All environments" }, ...envs.map((e) => ({ value: e.name, label: e.name, meta: e.protected ? "protected" : undefined }))]}
            />
            <Selector
              name="service"
              aria-label="Service"
              submitOnChange
              className="min-w-0 flex-1 md:w-44 md:flex-none"
              defaultValue={f.service}
              minWidth={240}
              searchPlaceholder="Find a service…"
              options={[{ value: "", label: "All services" }, ...services.map((s) => ({ value: s, label: s, meta: perService[s] ?? 0 }))]}
            />
            <Selector
              name="risk"
              aria-label="Risk level"
              submitOnChange
              className="md:w-36"
              defaultValue={f.risk}
              options={[
                { value: "", label: "Any risk" },
                ...LEVELS.map((l) => ({ value: l, label: `${l[0].toUpperCase() + l.slice(1)} risk`, icon: <Dot tone={levelTone(l)} /> })),
              ]}
            />
            <Selector
              name="source"
              aria-label="Source"
              submitOnChange
              className="md:w-36"
              defaultValue={f.source}
              options={[{ value: "", label: "Any source" }, ...SOURCES.map((s) => ({ value: s, label: SOURCE_LABEL[s], description: SOURCE_HINT[s] }))]}
              minWidth={220}
            />
            <Selector
              name="ai"
              aria-label="Author"
              submitOnChange
              className="md:w-40"
              defaultValue={f.ai ? "1" : ""}
              options={[
                { value: "", label: "Any author" },
                { value: "1", label: "AI-authored only", icon: <Bot size={13} /> },
              ]}
            />
            <button type="submit" className={buttonClass.secondary}>
              Apply
            </button>
          </div>
          {active && (
            <Link href="/app/deployments" className="text-[13px] text-con-fg2 hover:text-con-fg md:ml-auto">
              Clear filters
            </Link>
          )}
        </FilterForm>

        <ReleaseToolbar params={params} sorts={SORTS} sort={f.sort} total={page.total} />

        {page.total === 0 ? (
          <EmptyState title="No deployments match">Try a different status, environment, service, source or search term.</EmptyState>
        ) : (
          <ReleaseTable deps={page.items} now={now} />
        )}
        <Pagination meta={page} noun="deployments" base="/app/deployments" params={params} />
      </Card>
    </div>
  );
}

function BoardTile({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-con-line bg-con-panel px-4 py-3.5">
      <div className="text-[12px] text-con-fg2">{label}</div>
      <div className="mt-1 text-[24px] font-semibold leading-none tracking-[-0.02em]">{children}</div>
      <div className="mt-1.5 truncate text-[12px] text-con-fg3">{hint}</div>
    </div>
  );
}
