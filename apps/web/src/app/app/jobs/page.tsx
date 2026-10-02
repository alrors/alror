import type { Metadata } from "next";
import Link from "next/link";
import { CopyButton } from "@/components/console/copy-button";
import { CountUp } from "@/components/console/count-up";
import { JobsTable } from "@/components/console/jobs-table";
import { Pagination, hrefWith } from "@/components/console/pagination";
import { Card, EmptyState, PageHeader } from "@/components/console/primitives";
import { Selector } from "@/components/console/selector";
import { requireCtx } from "@/lib/console/auth";
import { requestTime } from "@/lib/console/format";
import { pageMeta, parsePage, parsePer } from "@/lib/console/paginate";
import type { JobStatus } from "@/lib/server/db/schema";
import { LEASE_SECONDS, pageJobs } from "@/lib/server/data/jobs";
import { cn } from "@/lib/site";

export const metadata: Metadata = { title: "Jobs" };

const TABS: { value: JobStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "queued", label: "Queued" },
  { value: "claimed", label: "Running" },
  { value: "done", label: "Done" },
  { value: "failed", label: "Failed" },
  { value: "canceled", label: "Canceled" },
];

const BOARD: { value: JobStatus; label: string; hint: string; bar: string }[] = [
  { value: "queued", label: "Queued", hint: "waiting for a runner", bar: "bg-con-fg3" },
  { value: "claimed", label: "Claimed", hint: "a runner is working on it", bar: "bg-con-info" },
  { value: "done", label: "Done", hint: "finished successfully", bar: "bg-con-fg2" },
  { value: "failed", label: "Failed", hint: "the runner reported an error", bar: "bg-con-bad" },
  { value: "canceled", label: "Canceled", hint: "stopped before a runner took it", bar: "bg-con-line-hover" },
];

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function JobsPage({ searchParams }: PageProps<"/app/jobs">) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const status = TABS.some((t) => t.value === one(sp.status)) ? (one(sp.status) as JobStatus | "all") : "all";
  const per = parsePer(sp.per);
  let page = parsePage(sp.page);
  const filter = status === "all" ? undefined : status;
  let r = await pageJobs(ctx, { status: filter, page, per });
  const pages = Math.max(1, Math.ceil(r.total / per));
  if (page > pages) {
    page = pages;
    r = await pageJobs(ctx, { status: filter, page, per });
  }
  const meta = pageMeta(r.items, r.total, page, per);
  const params = { status: status === "all" ? undefined : status };
  const now = requestTime();
  const finished = r.counts.done + r.counts.failed;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Jobs"
        description="Deploys and rollbacks queued from the console and the API. An alror runner claims each job, sends a heartbeat while it works and reports the result."
      />

      {/* Board */}
      <section aria-label="Jobs by status" className="space-y-3">
        <div className="con-stagger grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {BOARD.map((b) => {
            const on = status === b.value;
            return (
              <Link
                key={b.value}
                href={hrefWith("/app/jobs", {}, { status: on ? undefined : b.value })}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "con-lift block rounded-lg border bg-con-panel px-4 py-3.5",
                  on ? "border-con-line-hover" : "border-con-line hover:border-con-line-hover",
                )}
              >
                <div className="flex items-center gap-2 text-[12px] text-con-fg2">
                  <span className={cn("h-1.5 w-1.5 rounded-full", b.bar)} aria-hidden />
                  {b.label}
                </div>
                <div className="mt-1 text-[24px] font-semibold leading-none tracking-[-0.02em]">
                  <CountUp value={r.counts[b.value]} />
                </div>
                <div className="mt-1.5 truncate text-[12px] text-con-fg3">{b.hint}</div>
              </Link>
            );
          })}
        </div>
        {r.counts.all > 0 && (
          <div className="flex items-center gap-3">
            <div className="flex h-1.5 flex-1 gap-[2px] overflow-hidden rounded-full" role="img" aria-label={BOARD.map((b) => `${r.counts[b.value]} ${b.label.toLowerCase()}`).join(", ")}>
              {BOARD.filter((b) => r.counts[b.value] > 0).map((b, i) => (
                <span key={b.value} className={cn("con-grow-x h-full", b.bar)} style={{ flex: r.counts[b.value], animationDelay: `${i * 60}ms` }} />
              ))}
            </div>
            <span className="shrink-0 text-[12px] text-con-fg3">
              {finished ? `${Math.round((r.counts.done / finished) * 100)}% of finished jobs succeeded` : "no finished jobs yet"}
            </span>
          </div>
        )}
      </section>

      {/* How runners work */}
      <details className="group rounded-lg border border-con-line bg-con-panel" open={r.counts.all === 0}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3.5 [&::-webkit-details-marker]:hidden">
          <span className="text-[14px] font-medium text-con-fg">How runners work</span>
          <span className="text-[12px] text-con-fg3 group-open:hidden">Show</span>
          <span className="hidden text-[12px] text-con-fg3 group-open:inline">Hide</span>
        </summary>
        <div className="con-fade border-t border-con-line px-5 py-4">
          <ol className="grid gap-4 text-[13px] sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["1. Queued", "Deploy or Roll back in the console (or the API) adds a job here. Nothing runs yet."],
              ["2. Claimed", "An alror runner in your infrastructure picks up the oldest queued job. Only one runner can hold a job."],
              [
                "3. Heartbeat",
                `While it works the runner checks in. If it goes quiet for ${LEASE_SECONDS}s the job shows as stalled and another runner may take it over; attempts counts each take-over.`,
              ],
              ["4. Done or failed", "The runner reports the result. A deploy job links to the deployment it created. Failed and canceled jobs can be retried."],
            ].map(([t, body]) => (
              <li key={t}>
                <div className="font-medium text-con-fg">{t}</div>
                <p className="mt-1 leading-relaxed text-con-fg2">{body}</p>
              </li>
            ))}
          </ol>
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-con-row pt-4 text-[13px] text-con-fg2">
            <span>Start a runner with an API key that has the jobs:run scope:</span>
            <code className="rounded bg-con-row px-1.5 py-0.5 font-mono text-[12px] text-con-fg">alror runner</code>
            <CopyButton text="alror runner" iconOnly />
          </div>
        </div>
      </details>

      <Card flush>
        <form action="/app/jobs" method="get" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-con-line px-5 py-2.5">
          {sp.per && <input type="hidden" name="per" value={String(per)} />}
          <Selector
            name="status"
            aria-label="Job status"
            submitOnChange
            className="w-52"
            prefix="Status"
            defaultValue={status === "all" ? "" : status}
            options={TABS.map((t) => ({
              value: t.value === "all" ? "" : t.value,
              label: t.label,
              icon: t.value === "all" ? undefined : <span className={cn("h-1.5 w-1.5 rounded-full", BOARD.find((b) => b.value === t.value)?.bar)} />,
              description: BOARD.find((b) => b.value === t.value)?.hint,
              meta: r.counts[t.value],
            }))}
          />
          <noscript>
            <button type="submit" className="h-8 rounded-md border border-con-line px-2 text-[13px] text-con-fg2">
              Apply
            </button>
          </noscript>
          {meta.total > 0 && (
            <p className="min-w-0 flex-1 text-[12px] text-con-fg3">Open a row for its payload, timings and runner. Queued jobs can be canceled; failed and canceled ones retried.</p>
          )}
        </form>
        {meta.total === 0 ? (
          <EmptyState title={status === "all" ? "No jobs yet" : "No jobs with this status"}>
            Use Deploy on a service, or Roll back on a deployment, to queue one. Start a runner with <code className="font-mono text-con-fg">alror runner</code>.
          </EmptyState>
        ) : (
          <>
            <JobsTable jobs={meta.items} now={now} />
          </>
        )}
        <Pagination meta={meta} noun="jobs" base="/app/jobs" params={params} />
      </Card>
    </div>
  );
}
