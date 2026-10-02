import type { Metadata } from "next";
import Link from "next/link";
import { AdminHeader, one, SearchBox } from "@/components/admin/kit";
import { Pagination } from "@/components/console/pagination";
import { Card, EmptyState, Pill } from "@/components/console/primitives";
import { Selector } from "@/components/console/selector";
import { ago, dateTime, requestTime } from "@/lib/console/format";
import { pageMeta, parsePage, parsePer } from "@/lib/console/paginate";
import { requirePlatformAdmin } from "@/lib/server/admin/guard";
import { listFeedbackAdmin } from "@/lib/server/admin/insights";
import { orgOptions } from "@/lib/server/admin/orgs";

export const metadata: Metadata = { title: "Feedback" };

const RANGES = [
  { value: "", label: "Any time" },
  { value: "1", label: "Last 24 hours" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
];

export default async function AdminFeedback({ searchParams }: PageProps<"/admin/feedback">) {
  const admin = await requirePlatformAdmin();
  const sp = await searchParams;
  const q = one(sp.q).slice(0, 100);
  const org = one(sp.org);
  const range = RANGES.some((r) => r.value === one(sp.days)) ? one(sp.days) : "";
  const per = parsePer(sp.per);
  let page = parsePage(sp.page);
  const opts = { orgId: org, q, days: range ? Number(range) : undefined, per };
  const [first, orgs] = await Promise.all([listFeedbackAdmin(admin, { ...opts, page }), orgOptions(admin)]);
  let r = first;
  const pages = Math.max(1, Math.ceil(r.total / per));
  if (page > pages) {
    page = pages;
    r = await listFeedbackAdmin(admin, { ...opts, page });
  }
  const meta = pageMeta(r.items, r.total, page, per);
  const now = requestTime();
  const orgValid = orgs.some((o) => o.id === org);

  return (
    <div className="con-fade-up">
      <AdminHeader
        title="Feedback"
        description="Messages sent with the console's Feedback button, across every org. Stored locally and never sent anywhere. Read-only: the feedback table has no handled state."
      />
      <Card flush>
        <SearchBox action="/admin/feedback" q={q} placeholder="Search message, page or email" keep={{ per: sp.per ? String(per) : undefined }}>
          <Selector
            name="org"
            aria-label="Organization"
            prefix="Org"
            className="w-56"
            submitOnChange
            defaultValue={orgValid ? org : ""}
            options={[{ value: "", label: "All" }, ...orgs.map((o) => ({ value: o.id, label: o.slug, description: o.name }))]}
          />
          <Selector name="days" aria-label="Date range" className="w-44" submitOnChange defaultValue={range} options={RANGES} />
        </SearchBox>
        {meta.items.length === 0 ? (
          <EmptyState title={q || org || range ? "No feedback matches" : "No feedback yet"}>{q || org || range ? "Try another filter." : "Feedback shows up here when someone uses the Feedback button in the console."}</EmptyState>
        ) : (
          <ul className="con-stagger divide-y divide-con-line">
            {meta.items.map((f) => (
              <li key={f.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-con-fg3">
                  <Link href={`/admin/orgs/${f.org_id}`}>
                    <Pill>{f.org}</Pill>
                  </Link>
                  <span className="text-con-fg2">{f.user_email ?? "deleted user"}</span>
                  {f.page && <span className="font-mono">{f.page}</span>}
                  <span title={dateTime(f.created_at)} className="ml-auto whitespace-nowrap">
                    {ago(f.created_at, now)}
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-con-fg">{f.message}</p>
              </li>
            ))}
          </ul>
        )}
        <Pagination meta={meta} noun="messages" base="/admin/feedback" params={{ q: q || undefined, org: orgValid ? org : undefined, days: range || undefined }} />
      </Card>
    </div>
  );
}
