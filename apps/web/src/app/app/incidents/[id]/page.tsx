import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, X } from "lucide-react";
import { ConfirmAction } from "@/components/console/confirm-action";
import { CandidateRollback } from "@/components/console/incidents/candidate-rollback";
import { IncidentStatusPill, ScoreBar, SeverityPill, SignalList, scoreTone } from "@/components/console/incidents/incident-ui";
import { Card, EmptyState, Field, Pill, StatusBadge } from "@/components/console/primitives";
import { requireCtx } from "@/lib/console/auth";
import { ago, dateTime, requestTime } from "@/lib/console/format";
import type { Status } from "@/lib/console/types";
import { getIncident } from "@/lib/server/data/incidents";
import { getJob } from "@/lib/server/data/jobs";
import { cn } from "@/lib/site";
import { resolveIncidentAction } from "../actions";

export async function generateMetadata({ params }: PageProps<"/app/incidents/[id]">): Promise<Metadata> {
  const { id } = await params;
  const inc = await getIncident(await requireCtx(), id);
  return { title: inc ? inc.title.slice(0, 60) : "Incident" };
}

const RULE_LABEL: Record<string, string> = {
  enabled: "Enabled for the org",
  firing: "Alert is firing",
  candidate: "A candidate exists",
  confidence: "Confidence",
  recency: "Deployed recently",
  service: "Service matches exactly",
  rollbackable: "Can be rolled back",
  margin: "Clear winner",
};

function minutesLabel(m: number): string {
  if (m < 1) return "at the start";
  if (m < 90) return `${Math.round(m)} min before`;
  return `${Math.round((m / 60) * 10) / 10} h before`;
}

export default async function IncidentPage({ params }: PageProps<"/app/incidents/[id]">) {
  const { id } = await params;
  const ctx = await requireCtx();
  const inc = await getIncident(ctx, id);
  if (!inc) notFound();
  const job = inc.rollback_job_id ? await getJob(ctx, inc.rollback_job_id) : null;
  const now = requestTime();
  const items = inc.candidates.items;
  const top = items[0];
  const auto = inc.auto_action;
  const open = inc.status === "open";

  return (
    <div className="space-y-6">
      <Link href="/app/incidents" className="inline-flex items-center gap-1.5 text-[13px] text-con-fg2 transition-colors duration-150 hover:text-con-fg">
        <ArrowLeft size={14} /> Incidents
      </Link>

      <div className="con-fade-up flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <IncidentStatusPill status={inc.status} />
            <SeverityPill severity={inc.severity} />
            <span className="text-[12px] text-con-fg3">
              from {inc.source} · started {ago(inc.started_at, now)}
              {inc.environment ? ` · ${inc.environment}` : ""}
            </span>
          </div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em] text-con-fg">{inc.title}</h1>
          {inc.service && (
            <p className="mt-1 text-[14px] text-con-fg2">
              Service{" "}
              <Link href={`/app/services/${encodeURIComponent(inc.service)}`} className="font-mono text-con-fg hover:underline hover:underline-offset-4">
                {inc.service}
              </Link>
            </p>
          )}
        </div>
        {open && (
          <ConfirmAction
            action={resolveIncidentAction}
            fields={{ id: inc.id }}
            label="Mark resolved"
            confirmLabel="Resolve"
            prompt="The source can still reopen it with a new alert."
            tone="secondary"
            icon={<Check size={14} />}
          />
        )}
      </div>

      {/* The answer in one sentence. */}
      <section
        aria-label="Most likely change"
        className={cn("con-fade-up rounded-lg border bg-con-panel px-5 py-4", top && top.score >= 80 ? "border-con-bad/30" : "border-con-line")}
        style={{ animationDelay: "60ms" }}
      >
        {top ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-[15px] leading-relaxed text-con-fg">
                Most likely change:{" "}
                <Link href={`/app/deployments/${top.deployment_id}`} className="font-mono hover:underline hover:underline-offset-4">
                  {top.service}
                </Link>{" "}
                <span className="font-mono text-[13px] text-con-fg2">{top.image}</span>, deployed {minutesLabel(top.minutes_before)} the alert.
              </p>
              <p className="mt-1 text-[13px] text-con-fg2">
                {auto?.rollback
                  ? auto.job_id
                    ? "Alror queued an automatic rollback because every safety rule passed."
                    : `Automatic rollback was allowed but could not be queued${auto.error ? `: ${auto.error}` : "."}`
                  : items.length > 1
                    ? `${items.length} deployments ranked from the ${inc.candidates.window_minutes} minutes before the alert.`
                    : `The only deployment in the ${inc.candidates.window_minutes} minutes before the alert.`}
                {job && (
                  <>
                    {" "}
                    Rollback job{" "}
                    <Link href="/app/jobs" className="font-mono text-con-fg hover:underline hover:underline-offset-4">
                      {job.id.slice(0, 8)}
                    </Link>{" "}
                    is {job.status === "claimed" ? "running" : job.status}.
                  </>
                )}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-4 sm:border-l sm:border-con-row sm:pl-6">
              <ScoreBar score={top.score} wide />
              <CandidateRollback incident={inc.id} deployment={top.deployment_id} service={top.service} score={top.score} primary />
            </div>
          </div>
        ) : (
          <p className="text-[15px] text-con-fg2">No deployments in the {inc.candidates.window_minutes} minutes before this alert, so the cause is probably not a release.</p>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <Card title="What changed?" description="Each score adds up the signals listed under it: service match, timing, risk, rollout state and the canary's metric movement." flush>
            {items.length === 0 ? (
              <EmptyState title="No candidates">Nothing was deployed in the look-back window.</EmptyState>
            ) : (
              <ol className="con-stagger divide-y divide-con-row">
                {items.map((c, i) => (
                  <li key={c.deployment_id} className="px-5 py-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <span
                          className={cn(
                            "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[12px]",
                            i === 0 ? "bg-con-row text-con-fg" : "text-con-fg3",
                          )}
                        >
                          {i + 1}
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link href={`/app/deployments/${c.deployment_id}`} className="font-medium text-con-fg hover:underline hover:underline-offset-4">
                              {c.service}
                            </Link>
                            <StatusBadge status={c.status as Status} />
                            {c.service_match === "exact" && <Pill className="text-con-fg2">same service</Pill>}
                            {c.service_match === "related" && <Pill className="text-con-fg2">related</Pill>}
                          </div>
                          <div className="mt-0.5 truncate font-mono text-[12px] text-con-fg3" title={c.image}>
                            {c.deployment_id} · {c.image} · {c.environment || "?"} · {minutesLabel(c.minutes_before)}
                          </div>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-4 pl-9 sm:pl-0">
                        <ScoreBar score={c.score} delay={i * 40} />
                        {c.status !== "rolled_back" && c.status !== "failed" && (
                          <CandidateRollback incident={inc.id} deployment={c.deployment_id} service={c.service} score={c.score} primary={i === 0 && scoreTone(c.score) === "bad"} />
                        )}
                      </div>
                    </div>
                    <div className="mt-3 pl-9">
                      <SignalList signals={c.signals} />
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card title="Raw alert" description="The payload as received (one alert of a batch).">
            <details className="group">
              <summary className="cursor-pointer list-none text-[13px] text-con-fg2 hover:text-con-fg [&::-webkit-details-marker]:hidden">
                <span className="group-open:hidden">Show payload</span>
                <span className="hidden group-open:inline">Hide payload</span>
              </summary>
              <pre className="con-fade mt-3 max-h-[420px] overflow-auto rounded-md border border-con-line bg-con-bg p-3 font-mono text-[12px] leading-relaxed text-con-fg2">
                {JSON.stringify(inc.raw, null, 2)}
              </pre>
            </details>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card title="Alert">
            <dl className="divide-y divide-con-row">
              <Field label="Source">{inc.source}</Field>
              <Field label="Service">{inc.service || "not named"}</Field>
              <Field label="Environment">{inc.environment || "not named"}</Field>
              <Field label="Severity">
                <span className="capitalize">{inc.severity}</span>
              </Field>
              <Field label="Started">
                <span title={dateTime(inc.started_at)}>{dateTime(inc.started_at)}</span>
              </Field>
              <Field label="Last seen">{ago(inc.last_seen_at, now)}</Field>
              {inc.resolved_at && <Field label="Resolved">{dateTime(inc.resolved_at)}</Field>}
              <Field label="Deliveries">{inc.event_count}</Field>
              <Field label="Fingerprint" mono>
                {inc.fingerprint}
              </Field>
            </dl>
          </Card>

          <Card
            title="Automatic rollback"
            description={auto?.checks.some((c) => c.rule === "enabled" && c.pass) ? "Rules checked when the incident opened." : "Off for this org. This is what the rules would have decided."}
          >
            {auto ? (
              <ul className="space-y-2.5">
                {auto.checks.map((c) => (
                  <li key={c.rule} className="flex gap-2.5 text-[13px]">
                    <span className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full", c.pass ? "bg-con-row text-con-fg" : "bg-con-bad/15 text-con-bad")}>
                      {c.pass ? <Check size={11} strokeWidth={2.5} /> : <X size={11} strokeWidth={2.5} />}
                    </span>
                    <span className="min-w-0">
                      <span className="text-con-fg">{RULE_LABEL[c.rule] ?? c.rule}</span>
                      <span className="block text-[12px] text-con-fg3">{c.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-con-fg3">Not evaluated.</p>
            )}
            <p className="mt-4 border-t border-con-row pt-3 text-[12px] text-con-fg3">
              Owners and admins set these rules under{" "}
              <Link href="/app/settings/integrations" className="text-con-fg2 hover:text-con-fg hover:underline hover:underline-offset-4">
                Settings, Integrations
              </Link>
              . Ranked {ago(inc.candidates.ranked_at, now)}.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
