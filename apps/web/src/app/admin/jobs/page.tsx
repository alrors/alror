import type { Metadata } from "next";
import Link from "next/link";
import { RotateCcw, X } from "lucide-react";
import { cancelJobAction, requeueJobAction } from "@/app/admin/actions";
import { AdminAction } from "@/components/admin/admin-action";
import { AdminHeader, one, tableCell, tableHead } from "@/components/admin/kit";
import { hrefWith, Pagination } from "@/components/console/pagination";
import { Card, EmptyState, Pill } from "@/components/console/primitives";
import { Selector } from "@/components/console/selector";
import { ago, requestTime, type Tone } from "@/lib/console/format";
import { pageMeta, parsePage, parsePer } from "@/lib/console/paginate";
import { requirePlatformAdmin } from "@/lib/server/admin/guard";
import { JOB_FILTERS, listJobsAdmin, listRunners, type AdminJobRow, type JobFilter } from "@/lib/server/admin/jobs";
import { orgOptions } from "@/lib/server/admin/orgs";
import { cn } from "@/lib/site";

export const metadata: Metadata = { title: "Jobs & runners" };

const FILTER_LABEL: Record<JobFilter, string> = {
  all: "All",
  queued: "Queued",
  claimed: "Claimed",
  stalled: "Stalled",
  done: "Done",
  failed: "Failed",
  canceled: "Canceled",
};

function statusOf(j: AdminJobRow): { label: string; tone: Tone } {
  if (j.stalled) return { label: "Stalled", tone: "warn" };
  switch (j.status) {
    case "queued":
      return { label: "Queued", tone: "idle" };
    case "claimed":
      return { label: "Running", tone: "info" };
    case "done":
      return { label: "Done", tone: "good" };
    case "failed":
      return { label: "Failed", tone: "bad" };
    default:
      return { label: "Canceled", tone: "idle" };
  }
}

export default async function AdminJobs({ searchParams }: PageProps<"/admin/jobs">) {
  const admin = await requirePlatformAdmin();
  const sp = await searchParams;
  const filter = (JOB_FILTERS as readonly string[]).includes(one(sp.status)) ? (one(sp.status) as JobFilter) : "all";
  const org = one(sp.org);
  const kind = ["deploy", "rollback"].includes(one(sp.kind)) ? one(sp.kind) : "";
  const runner = one(sp.runner).slice(0, 200);
  const per = parsePer(sp.per);
  let page = parsePage(sp.page);
  const [first, runners, orgs] = await Promise.all([
    listJobsAdmin(admin, { filter, orgId: org, kind, runner, page, per }),
    listRunners(admin),
    orgOptions(admin),
  ]);
  let r = first;
  const pages = Math.max(1, Math.ceil(r.total / per));
  if (page > pages) {
    page = pages;
    r = await listJobsAdmin(admin, { filter, orgId: org, kind, runner, page, per });
  }
  const meta = pageMeta(r.items, r.total, page, per);
  const now = requestTime();
  const orgValid = orgs.some((o) => o.id === org);
  const params = { status: filter !== "all" ? filter : undefined, org: orgValid ? org : undefined, kind: kind || undefined, runner: runner || undefined };

  return (
    <div className="con-fade-up space-y-4">
      <AdminHeader
        title="Jobs & runners"
        description="The deploy and rollback queue across every org. A claimed job is stalled when its runner sent no heartbeat for 2 minutes; another runner can then claim it."
      />

      <Card flush>
        <div className="flex flex-wrap items-center gap-1 border-b border-con-line px-4 py-2" role="tablist" aria-label="Status">
          {JOB_FILTERS.map((f) => (
            <Link
              key={f}
              role="tab"
              aria-selected={f === filter}
              href={hrefWith("/admin/jobs", params, { status: f === "all" ? undefined : f, page: undefined })}
              scroll={false}
              className={cn(
                "con-ease inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px]",
                f === filter ? "bg-con-row text-con-fg" : "text-con-fg3 hover:text-con-fg",
              )}
            >
              {FILTER_LABEL[f]}
              <span className={cn("tabular-nums text-[12px]", f === "stalled" && r.counts.stalled > 0 ? "text-con-warn" : "text-con-fg3")}>{r.counts[f]}</span>
            </Link>
          ))}
        </div>
        <form action="/admin/jobs" method="get" className="flex flex-wrap items-center gap-2 border-b border-con-line px-5 py-2.5">
          {filter !== "all" && <input type="hidden" name="status" value={filter} />}
          {runner && <input type="hidden" name="runner" value={runner} />}
          <Selector
            name="org"
            aria-label="Organization"
            prefix="Org"
            className="w-56"
            submitOnChange
            defaultValue={orgValid ? org : ""}
            options={[{ value: "", label: "All" }, ...orgs.map((o) => ({ value: o.id, label: o.slug, description: o.name }))]}
          />
          <Selector
            name="kind"
            aria-label="Kind"
            prefix="Kind"
            className="w-40"
            submitOnChange
            defaultValue={kind}
            options={[
              { value: "", label: "All" },
              { value: "deploy", label: "Deploy" },
              { value: "rollback", label: "Rollback" },
            ]}
          />
          {runner && (
            <Link href={hrefWith("/admin/jobs", params, { runner: undefined, page: undefined })} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-con-line px-2.5 text-[12px] text-con-fg2 hover:text-con-fg">
              Runner {runner}
              <X size={12} />
            </Link>
          )}
        </form>
        {meta.items.length === 0 ? (
          <EmptyState title="No jobs match">{filter === "stalled" ? "No runner has lost its lease." : "Try another filter."}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-[13px]">
              <thead>
                <tr className="border-b border-con-line">
                  <th className={tableHead}>Job</th>
                  <th className={tableHead}>Org</th>
                  <th className={tableHead}>Target</th>
                  <th className={tableHead}>Status</th>
                  <th className={tableHead}>Runner</th>
                  <th className={cn(tableHead, "text-right")}>Attempts</th>
                  <th className={tableHead}>Heartbeat</th>
                  <th className={tableHead}>Created</th>
                  <th className={cn(tableHead, "text-right")}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {meta.items.map((j) => {
                  const st = statusOf(j);
                  const canCancel = j.status === "queued" || j.status === "claimed";
                  const canRequeue = j.status === "failed" || j.status === "canceled" || j.stalled;
                  return (
                    <tr key={j.id} className="con-ease border-b border-con-line align-top last:border-0 hover:bg-con-hover">
                      <td className={tableCell}>
                        <span className="font-mono text-con-fg" title={j.id}>
                          {j.id.slice(0, 8)}
                        </span>
                        <span className="ml-2 text-con-fg3">{j.kind}</span>
                      </td>
                      <td className={tableCell}>
                        <Link href={`/admin/orgs/${j.org_id}`} className="text-con-fg2 hover:text-con-fg">
                          {j.org}
                        </Link>
                      </td>
                      <td className={cn(tableCell, "max-w-[220px]")}>
                        <span className="block truncate font-mono text-[12px] text-con-fg2" title={j.target}>
                          {j.target}
                        </span>
                        {j.error && (
                          <span className="block truncate text-[12px] text-con-bad" title={j.error}>
                            {j.error}
                          </span>
                        )}
                      </td>
                      <td className={tableCell}>
                        <Pill tone={st.tone}>{st.label}</Pill>
                      </td>
                      <td className={cn(tableCell, "text-con-fg2")}>
                        {j.claimed_by ? (
                          <Link href={hrefWith("/admin/jobs", params, { runner: j.claimed_by, page: undefined })} className="hover:text-con-fg">
                            {j.claimed_by}
                          </Link>
                        ) : (
                          "–"
                        )}
                      </td>
                      <td className={cn(tableCell, "text-right tabular-nums text-con-fg2")}>{j.attempts}</td>
                      <td className={cn(tableCell, "whitespace-nowrap", j.stalled ? "text-con-warn" : "text-con-fg2")}>
                        {j.heartbeat_at ? ago(j.heartbeat_at, now) : "–"}
                      </td>
                      <td className={cn(tableCell, "whitespace-nowrap text-con-fg2")}>{ago(j.created_at, now)}</td>
                      <td className={cn(tableCell, "text-right")}>
                        <span className="inline-flex justify-end gap-1.5">
                          {canRequeue && (
                            <AdminAction action={requeueJobAction} fields={{ job: j.id }} label="Requeue" size="sm" icon={<RotateCcw size={12} />} confirm="Put it back in the queue?" />
                          )}
                          {canCancel && <AdminAction action={cancelJobAction} fields={{ job: j.id }} label="Cancel" size="sm" tone="danger" confirm={j.status === "claimed" ? "Its runner will stop on the next heartbeat." : "Cancel this job?"} />}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination meta={meta} noun="jobs" base="/admin/jobs" params={params} />
      </Card>

      <div id="runners" className="scroll-mt-4">
        <Card title="Runners" description="Derived from job claims and heartbeats in the last 7 days; there is no runner registry. Online means seen in the last 5 minutes." flush>
          {runners.length === 0 ? (
            <EmptyState title="No runners seen">Runners appear here once an `alror runner` claims a job.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-[13px]">
                <thead>
                  <tr className="border-b border-con-line">
                    <th className={tableHead}>Runner</th>
                    <th className={tableHead}>Orgs</th>
                    <th className={tableHead}>Last seen</th>
                    <th className={cn(tableHead, "text-right")}>Running</th>
                    <th className={cn(tableHead, "text-right")}>Stalled</th>
                    <th className={cn(tableHead, "text-right")}>Done 7d</th>
                    <th className={cn(tableHead, "text-right")}>Failed 7d</th>
                  </tr>
                </thead>
                <tbody>
                  {runners.map((x) => (
                    <tr key={x.name} className="border-b border-con-line last:border-0">
                      <td className={tableCell}>
                        <Link href={hrefWith("/admin/jobs", {}, { runner: x.name })} className="inline-flex items-center gap-2 font-medium text-con-fg hover:underline">
                          <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", x.online ? "bg-con-fg2" : "bg-con-line-hover")} />
                          {x.name}
                        </Link>
                        <span className="ml-2 text-[12px] text-con-fg3">{x.online ? "online" : "offline"}</span>
                      </td>
                      <td className={cn(tableCell, "text-con-fg2")}>{x.orgs.join(", ")}</td>
                      <td className={cn(tableCell, "whitespace-nowrap text-con-fg2")}>{x.last_seen ? ago(x.last_seen, now) : "–"}</td>
                      <td className={cn(tableCell, "text-right tabular-nums")}>{x.active}</td>
                      <td className={cn(tableCell, "text-right tabular-nums", x.stalled > 0 && "text-con-warn")}>{x.stalled}</td>
                      <td className={cn(tableCell, "text-right tabular-nums text-con-fg2")}>{x.done_7d}</td>
                      <td className={cn(tableCell, "text-right tabular-nums", x.failed_7d > 0 ? "text-con-bad" : "text-con-fg2")}>{x.failed_7d}</td>
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
