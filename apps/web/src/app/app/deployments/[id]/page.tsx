import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { JobStatus } from "@/components/console/jobs-table";
import { ReleaseActions } from "@/components/console/release-actions";
import { ReleaseEvents } from "@/components/console/release-events";
import { ReleaseProgress } from "@/components/console/release-progress";
import { ReleaseRisk, ReleaseRiskGauge } from "@/components/console/release-risk";
import { headline } from "@/components/console/release-story";
import { ReleaseVerdicts } from "@/components/console/release-verdicts";
import { RolloutTreeView } from "@/components/console/rollout-tree";
import { AiBadge, Card, Field, LevelBadge, StatusBadge } from "@/components/console/primitives";
import { cn } from "@/lib/site";
import { anchorNow } from "@/lib/console/analytics";
import { getDeployment, getEvents, listDeployments } from "@/lib/console/data";
import { ago, requestTime, dateTime, duration, elapsed, hm } from "@/lib/console/format";
import { requireCtx } from "@/lib/console/auth";
import { jobTarget } from "@/lib/console/jobs";
import { readProjectConfig } from "@/lib/console/policy";
import { jobsForDeployment, type JobView } from "@/lib/server/data/jobs";
import { buildRolloutTree } from "@/lib/console/rollout-tree";
import type { Deployment } from "@/lib/console/types";

export async function generateMetadata({ params }: PageProps<"/app/deployments/[id]">): Promise<Metadata> {
  const { id } = await params;
  const d = await getDeployment(id);
  return { title: d ? `${d.service} ${d.ref ?? ""}`.trim() : "Deployment" };
}

export default async function DeploymentPage({ params }: PageProps<"/app/deployments/[id]">) {
  const { id } = await params;
  const [d, events, all, config] = await Promise.all([getDeployment(id), getEvents(id), listDeployments(), readProjectConfig()]);
  if (!d) notFound();
  const jobs = await jobsForDeployment(await requireCtx(), d.id);

  const now = anchorNow(all);
  const tree = buildRolloutTree(d, events, now);
  const verdicts = events.filter((e) => e.kind === "verdict" && e.verdict);
  const canRollBack = d.status !== "rolled_back" && d.status !== "failed";
  const steps = d.plan?.steps ?? [];
  const verificationStages = tree.stages.filter((s) => s.weight < 100);
  const passed = verificationStages.filter((s) => s.state === "pass").length;
  const story = headline(d, events, tree, config.policy.maxRegression, now);
  const bad = d.status === "rolled_back" || d.status === "failed";
  const passCount = verdicts.filter((e) => e.verdict?.pass).length;

  return (
    <div className="space-y-6">
      <Link
        href={`/app/deployments?service=${encodeURIComponent(d.service)}`}
        className="inline-flex items-center gap-1.5 text-[13px] text-con-fg2 transition-colors duration-150 hover:text-con-fg"
      >
        <ArrowLeft size={14} /> {d.service} deployments
      </Link>

      <div className="con-fade-up flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={d.status} />
          <LevelBadge level={d.risk?.level} />
          {d.risk?.ai_authored && <AiBadge />}
          <span className="text-[12px] text-con-fg3">
            {d.environment ?? "production"} · from {d.source ?? "cli"} · {ago(d.created_at, now)}
          </span>
        </div>
        <h1 className="flex flex-wrap items-baseline gap-x-3 text-[28px] font-semibold leading-tight tracking-[-0.025em]">
          <Link href={`/app/services/${encodeURIComponent(d.service)}`} className="hover:underline hover:decoration-con-line-hover hover:underline-offset-4">
            {d.service}
          </Link>
          {d.ref && <span className="font-mono text-[20px] font-normal tracking-normal text-con-fg2">{d.ref}</span>}
        </h1>
        <p className="break-all font-mono text-[13px] text-con-fg2">{d.image}</p>
      </div>

      {/* The story in one sentence. */}
      <section
        aria-label="What happened"
        className={cn(
          "con-fade-up rounded-lg border bg-con-panel px-5 py-4",
          bad ? "border-con-bad/30" : d.status === "rolling" ? "border-con-info/30" : "border-con-line",
        )}
        style={{ animationDelay: "60ms" }}
      >
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-[15px] leading-relaxed text-con-fg">{story}</p>
            {d.reason && <p className="mt-1.5 break-words font-mono text-[12px] text-con-fg3">{d.reason}</p>}
            <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[12.5px]">
              <div className="flex gap-1.5">
                <dt className="text-con-fg3">Verification stages passed</dt>
                <dd className="font-mono tabular-nums text-con-fg">
                  {passed} / {verificationStages.length}
                </dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="text-con-fg3">Duration</dt>
                <dd className="font-mono tabular-nums text-con-fg">
                  {elapsed(d.created_at, d.status === "rolling" ? new Date(now).toISOString() : d.updated_at)}
                </dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="text-con-fg3">Risk</dt>
                <dd className="font-mono tabular-nums text-con-fg">
                  {d.risk?.score ?? 0} ({d.risk?.level ?? "unknown"})
                </dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="text-con-fg3">Verdicts</dt>
                <dd className="font-mono tabular-nums text-con-fg">
                  {passCount} pass · {verdicts.length - passCount} fail
                </dd>
              </div>
            </dl>
          </div>
          <div className="self-center sm:border-l sm:border-con-row sm:pl-6">
            <ReleaseRiskGauge d={d} />
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <Card
            title="Rollout"
            description={d.status === "failed" ? "Rollout stopped; current traffic is unconfirmed" : `${steps.length} stages - ${tree.liveWeight}% on this release`}
          >
            <ReleaseProgress d={d} tree={tree} now={now} />
            <div className="mt-6 border-t border-con-row pt-5">
              <div className="mb-3 text-[13px] font-medium text-con-fg">Release graph</div>
              <RolloutTreeView
                tree={tree}
                animate
                root={
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="min-w-0 text-[14px]">
                      <span className="font-medium text-con-fg">release {d.ref || d.id}</span>
                      <span className="text-con-fg3"> · </span>
                      <span className="text-con-fg2">{d.service}</span>
                    </span>
                    <span className="font-mono text-[12.5px] tabular-nums text-con-fg3">
                      risk {d.risk?.score ?? 0} · {d.risk?.level} · {hm(d.created_at)}
                    </span>
                  </div>
                }
              />
            </div>
          </Card>

          <Card title="Verdicts" description="Canary compared with baseline after each bake period.">
            <ReleaseVerdicts verdicts={verdicts} seed={d.id} limits={config.policy.maxRegression} alpha={config.policy.alpha} />
          </Card>

          <Card title="Event log" description={`${events.length} events · UTC`} flush>
            <ReleaseEvents events={events} />
          </Card>
        </div>

        <aside className="min-w-0 space-y-6">
          <Card title="Actions">
            <ReleaseActions
              id={d.id}
              service={d.service}
              image={d.image}
              environment={d.environment ?? "production"}
              canRollBack={canRollBack}
              status={d.status}
            />
          </Card>
          <SummaryCard d={d} now={now} />
          <JobsCard jobs={jobs} />
          <ReleaseRisk d={d} />
        </aside>
      </div>
    </div>
  );
}

function JobsCard({ jobs }: { jobs: JobView[] }) {
  const now = requestTime();
  return (
    <Card
      title="Jobs"
      description={jobs.length ? "Deploy and rollback jobs for this release." : undefined}
      aside={
        <Link href="/app/jobs" className="text-[13px] text-con-fg2 hover:text-con-fg">
          All jobs
        </Link>
      }
    >
      {jobs.length === 0 ? (
        <p className="text-[13px] text-con-fg3">No jobs for this release. It was recorded by the CLI or CI.</p>
      ) : (
        <ul className="-my-2 divide-y divide-con-row">
          {jobs.map((j) => (
            <li key={j.id} className="py-2.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] font-medium capitalize text-con-fg">{j.kind}</span>
                <JobStatus job={j} now={now} />
              </div>
              <div className="mt-1 text-[12px] text-con-fg3">
                {j.claimed_by ? `runner ${j.claimed_by}` : "waiting for a runner"} · attempt {j.attempts}
                {j.heartbeat_at && j.status === "claimed" && <> · heartbeat {ago(j.heartbeat_at, now)}</>}
              </div>
              {j.kind === "deploy" && <div className="mt-0.5 truncate font-mono text-[12px] text-con-fg3">{jobTarget(j)}</div>}
              {j.error && <div className="mt-1 break-words text-[12px] text-con-bad">{j.error}</div>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function SummaryCard({ d, now }: { d: Deployment; now: number }) {
  const steps = d.plan?.steps ?? [];
  const end = d.status === "rolling" ? new Date(now).toISOString() : d.updated_at;
  return (
    <Card title="Summary">
      <dl className="-my-2.5 divide-y divide-con-row">
        <Field label="Status">
          <StatusBadge status={d.status} />
        </Field>
        <Field label="Traffic">
          <span className="font-mono tabular-nums">{d.status === "failed" ? "Unconfirmed" : (d.status === "promoted" ? 100 : d.status === "rolling" ? d.weight : 0) + "%"}</span>
        </Field>
        <Field label="Plan">
          <span className="font-mono text-[13px] tabular-nums">
            {d.plan?.strategy ?? "canary"} · {steps.map((s) => `${s.weight}`).join(" → ")}
          </span>
        </Field>
        <Field label="Total bake">
          <span className="font-mono tabular-nums">{duration(steps.reduce((t, s) => t + (s.bake || 0), 0))}</span>
        </Field>
        <Field label="Image" mono>
          {d.image}
        </Field>
        <Field label="Ref" mono>
          {d.ref || "none"}
        </Field>
        <Field label="Environment">{d.environment ?? "production"}</Field>
        <Field label="Source">{d.source ?? "cli"}</Field>
        <Field label="Author">{d.risk?.ai_authored ? <AiBadge /> : <span className="text-con-fg2">Human</span>}</Field>
        <Field label="Started">{dateTime(d.created_at)}</Field>
        <Field label="Updated">{dateTime(d.updated_at)}</Field>
        <Field label="Duration">
          <span className="font-mono tabular-nums">{elapsed(d.created_at, end)}</span>
        </Field>
        <Field label="ID" mono>
          {d.id}
        </Field>
      </dl>
    </Card>
  );
}
