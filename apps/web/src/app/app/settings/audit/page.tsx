import type { Metadata } from "next";
import { Pagination } from "@/components/console/pagination";
import { AccessDenied } from "@/components/console/access-denied";
import { Card, EmptyState } from "@/components/console/primitives";
import { Selector } from "@/components/console/selector";
import { AuditList, type AuditRow } from "@/components/console/settings/audit-list";
import { requireSession } from "@/lib/console/auth";
import { dateTime, requestTime } from "@/lib/console/format";
import { pageMeta, parsePage, parsePer } from "@/lib/console/paginate";
import { ctxFor } from "@/lib/server/auth/accounts";
import { isAdminRole } from "@/lib/server/context";
import { pageAudit } from "@/lib/server/data/audit";

export const metadata: Metadata = { title: "Audit log" };

const CATEGORIES: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "deployment", label: "Deployments" },
  { value: "job", label: "Jobs" },
  { value: "service", label: "Services" },
  { value: "policy", label: "Policy" },
  { value: "config", label: "Config" },
  { value: "environment", label: "Environments" },
  { value: "member", label: "Members" },
  { value: "api_key", label: "API keys" },
  { value: "org", label: "Organization" },
  { value: "plugin", label: "Marketplace" },
];

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "UTC" });

export default async function AuditPage({ searchParams }: PageProps<"/app/settings/audit">) {
  const session = await requireSession();
  if (!isAdminRole(session.role)) return <AccessDenied what="the audit log" />;
  const sp = await searchParams;
  const ctx = ctxFor(session);
  const category = CATEGORIES.some((c) => c.value === one(sp.category)) ? one(sp.category) : "";
  const per = parsePer(sp.per);
  let page = parsePage(sp.page);
  let r = await pageAudit(ctx, { page, per, category: category || undefined });
  const pages = Math.max(1, Math.ceil(r.total / per));
  if (page > pages) {
    page = pages;
    r = await pageAudit(ctx, { page, per, category: category || undefined });
  }
  const meta = pageMeta(r.items, r.total, page, per);
  const params = { category: category || undefined };

  // Group by UTC day (the log's time zone), labelled Today / Yesterday / a date.
  const nowMs = requestTime();
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const yesterday = new Date(nowMs - 86_400_000).toISOString().slice(0, 10);
  const rows: AuditRow[] = meta.items.map((e) => {
    const d = new Date(e.at);
    const day = e.at.slice(0, 10);
    return {
      ...e,
      day,
      dayLabel: day === today ? "Today" : day === yesterday ? "Yesterday" : dayFmt.format(d),
      time: timeFmt.format(d),
      full: dateTime(e.at),
    };
  });

  return (
    <Card
      title="Audit log"
      description="Every change made in this organization, by people, API keys and the system. Entries cannot be edited or deleted. Times are UTC."
      flush
    >
      <form action="/app/settings/audit" method="get" className="flex flex-wrap items-center gap-3 border-b border-con-line px-5 py-2.5">
        {sp.per && <input type="hidden" name="per" value={String(per)} />}
        <Selector
          name="category"
          aria-label="Category"
          submitOnChange
          className="w-60"
          prefix="Category"
          minWidth={240}
          searchable={false}
          defaultValue={category}
          options={CATEGORIES.map((c) => ({ value: c.value, label: c.label, description: c.value ? `${c.value}.* actions` : "Every entry" }))}
        />
        <noscript>
          <button type="submit" className="h-8 rounded-md border border-con-line px-2 text-[13px] text-con-fg2">
            Apply
          </button>
        </noscript>
        <span className="text-[12px] text-con-fg3">
          {meta.total} entr{meta.total === 1 ? "y" : "ies"}
          {category ? ` in ${CATEGORIES.find((c) => c.value === category)?.label}` : ""}
        </span>
      </form>
      {meta.total === 0 ? (
        <EmptyState title="No audit entries">{category ? "Nothing in this category yet. Try All." : "Changes will be recorded here as people use the console, CLI and API."}</EmptyState>
      ) : (
        <AuditList key={`${category}:${page}`} rows={rows} />
      )}
      <Pagination meta={meta} noun="entries" base="/app/settings/audit" params={params} />
    </Card>
  );
}
