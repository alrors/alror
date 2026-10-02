"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { CancelJobButton } from "@/components/console/cancel-job";
import { RetryJobButton } from "@/components/console/job-retry";
import { Pill, tableCell, tableHead } from "@/components/console/primitives";
import { ago, dateTime, elapsed } from "@/lib/console/format";
import { JOB_LEASE_MS, PHASE, jobPhase, jobTarget } from "@/lib/console/jobs";
import type { JobView } from "@/lib/server/data/jobs";
import { cn } from "@/lib/site";

export function JobStatus({ job, now }: { job: JobView; now: number }) {
  const phase = PHASE[jobPhase(job, now)];
  return (
    <Pill tone={phase.tone} title={job.error ?? undefined}>
      {phase.label}
    </Pill>
  );
}

function Detail({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-[0.04em] text-con-fg3">{label}</dt>
      <dd className={cn("mt-0.5 break-words text-[13px] text-con-fg", mono && "font-mono text-[12px]")}>{children}</dd>
    </div>
  );
}

/** Expanded row: payload, timings, lease and runner. */
function JobDetails({ j, now }: { j: JobView; now: number }) {
  const phase = jobPhase(j, now);
  const beat = j.heartbeat_at ?? j.claimed_at;
  const beatAge = beat ? now - Date.parse(beat) : null;
  const leaseLeft = phase === "running" && beatAge !== null ? Math.max(0, JOB_LEASE_MS - beatAge) : null;
  return (
    <div className="con-fade-up grid gap-5 px-5 pb-4 pt-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Detail label="Job ID" mono>
          {j.id}
        </Detail>
        <Detail label="Runner" mono>
          {j.claimed_by ?? "not claimed yet"}
        </Detail>
        <Detail label="Attempts">
          {j.attempts}
          {j.attempts > 1 && <span className="text-con-fg3"> (re-claimed after a lost lease)</span>}
        </Detail>
        <Detail label="Requested">
          {dateTime(j.created_at)}
          <div className="text-[12px] text-con-fg3">by {j.requested_by ?? "system"}</div>
        </Detail>
        <Detail label="Waited in queue">{j.claimed_at ? elapsed(j.created_at, j.claimed_at) : phase === "queued" ? `${elapsed(j.created_at, new Date(now).toISOString())} so far` : "never claimed"}</Detail>
        <Detail label="Ran for">
          {j.claimed_at && j.finished_at ? elapsed(j.claimed_at, j.finished_at) : j.claimed_at && !j.finished_at ? `${elapsed(j.claimed_at, new Date(now).toISOString())} so far` : "not started"}
        </Detail>
        <Detail label="Last heartbeat">
          {beat ? `${ago(beat, now)}` : "none"}
          {leaseLeft !== null && <div className="text-[12px] text-con-fg3">lease expires in {Math.round(leaseLeft / 1000)}s without a new beat</div>}
          {phase === "stalled" && <div className="text-[12px] text-con-warn">lease expired; another runner can claim it</div>}
        </Detail>
        <Detail label="Finished">{j.finished_at ? dateTime(j.finished_at) : "not yet"}</Detail>
        {j.deployment_id && (
          <Detail label="Deployment" mono>
            <Link href={`/app/deployments/${j.deployment_id}`} className="hover:underline hover:underline-offset-4">
              {j.deployment_id}
            </Link>
          </Detail>
        )}
        {j.error && (
          <div className="col-span-full">
            <Detail label="Error">
              <span className="text-con-bad">{j.error}</span>
            </Detail>
          </div>
        )}
      </dl>
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-[0.04em] text-con-fg3">Payload</div>
        <pre className="mt-1 max-h-56 overflow-auto rounded-md border border-con-line bg-con-bg p-3 font-mono text-[12px] leading-relaxed text-con-fg2">
          {JSON.stringify(j.payload, null, 2)}
        </pre>
      </div>
    </div>
  );
}

/** Jobs with runner, attempts and heartbeat; each row expands to show details. `compact` drops the requester column for side cards. */
export function JobsTable({ jobs, now, compact, canCancel = true }: { jobs: JobView[]; now: number; compact?: boolean; canCancel?: boolean }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const cols = 5 + (compact ? 0 : 1) + (canCancel ? 1 : 0);
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full text-[14px]", compact ? "min-w-[640px]" : "min-w-[980px]")}>
        <thead className="border-b border-con-line">
          <tr>
            <th className={tableHead}>Job</th>
            <th className={tableHead}>Status</th>
            <th className={tableHead}>Runner</th>
            <th className={cn(tableHead, "text-right")}>Attempts</th>
            <th className={tableHead}>Heartbeat</th>
            {!compact && <th className={tableHead}>Requested</th>}
            {canCancel && (
              <th className={cn(tableHead, "text-right")}>
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody className="con-stagger">
          {jobs.map((j) => {
            const service = typeof j.payload.service === "string" ? j.payload.service : null;
            const isOpen = open.has(j.id);
            return (
              <Fragment key={j.id}>
                <tr className={cn("border-b align-top transition-colors duration-150 hover:bg-con-hover", isOpen ? "border-transparent bg-con-hover" : "border-con-row last:border-0")}>
                  <td className={cn(tableCell, "py-2.5")}>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggle(j.id)}
                        aria-expanded={isOpen}
                        aria-label={isOpen ? "Hide job details" : "Show job details"}
                        className="-ml-1 grid h-5 w-5 place-items-center rounded text-con-fg3 hover:text-con-fg"
                      >
                        <ChevronRight size={14} className={cn("transition-transform duration-150", isOpen && "rotate-90")} />
                      </button>
                      <span className="rounded bg-con-row px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.04em] text-con-fg2">{j.kind}</span>
                      {service ? (
                        <Link href={`/app/services/${encodeURIComponent(service)}`} className="text-con-fg hover:underline hover:underline-offset-4">
                          {service}
                        </Link>
                      ) : j.deployment_id ? (
                        <Link href={`/app/deployments/${j.deployment_id}`} className="font-mono text-[12.5px] text-con-fg hover:underline hover:underline-offset-4">
                          {j.deployment_id}
                        </Link>
                      ) : null}
                    </div>
                    <div className="mt-1 max-w-[380px] truncate pl-6 font-mono text-[12px] text-con-fg3" title={jobTarget(j)}>
                      {j.kind === "deploy" ? jobTarget(j) : String(j.payload.reason ?? "")}
                    </div>
                    {j.kind === "deploy" && j.deployment_id && (
                      <Link href={`/app/deployments/${j.deployment_id}`} className="mt-0.5 block pl-6 font-mono text-[12px] text-con-fg2 hover:text-con-fg">
                        {j.deployment_id}
                      </Link>
                    )}
                    {j.error && !isOpen && <div className="mt-1 max-w-[380px] truncate pl-6 text-[12px] text-con-bad">{j.error}</div>}
                  </td>
                  <td className={cn(tableCell, "py-2.5")}>
                    <JobStatus job={j} now={now} />
                  </td>
                  <td className={cn(tableCell, "py-2.5 font-mono text-[12.5px]", j.claimed_by ? "text-con-fg" : "text-con-fg3")}>{j.claimed_by ?? "none"}</td>
                  <td className={cn(tableCell, "py-2.5 text-right font-mono text-[13px] tabular-nums text-con-fg2")}>{j.attempts}</td>
                  <td className={cn(tableCell, "py-2.5 text-[13px] text-con-fg2")} title={j.heartbeat_at ? dateTime(j.heartbeat_at) : undefined}>
                    {j.status === "claimed" && j.heartbeat_at ? ago(j.heartbeat_at, now) : j.finished_at ? `finished ${ago(j.finished_at, now)}` : "none"}
                  </td>
                  {!compact && (
                    <td className={cn(tableCell, "py-2.5 text-[13px] text-con-fg2")} title={dateTime(j.created_at)}>
                      {ago(j.created_at, now)}
                      <div className="max-w-[200px] truncate text-[12px] text-con-fg3">{j.requested_by ?? "system"}</div>
                    </td>
                  )}
                  {canCancel && (
                    <td className={cn(tableCell, "py-2.5 text-right")}>
                      {j.status === "queued" && <CancelJobButton id={j.id} />}
                      {(j.status === "failed" || j.status === "canceled") && <RetryJobButton id={j.id} />}
                    </td>
                  )}
                </tr>
                {isOpen && (
                  <tr className="border-b border-con-row bg-con-hover last:border-0">
                    <td colSpan={cols} className="p-0">
                      <JobDetails j={j} now={now} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
