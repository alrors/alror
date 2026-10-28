import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, Archive, ArchiveRestore, Gauge, RotateCcw, Server, ShieldCheck, Tag } from "lucide-react";
import { ServicePaths, ServiceRiskTrend, ServiceTimeline, ServiceTopology } from "@/components/console/service-board";
import { COLORS, LegendItem, StackedBars } from "@/components/console/charts";
import { ConfirmAction } from "@/components/console/confirm-action";
import { CopyButton } from "@/components/console/copy-button";
import { DeployButton } from "@/components/console/deploy-dialog";
import { JobsTable } from "@/components/console/jobs-table";
import { EditServiceButton } from "@/components/console/service-form";
import { DeploymentTable } from "@/components/console/deployment-table";
import { Pagination } from "@/components/console/pagination";
import { Card, EmptyState, Pill } from "@/components/console/primitives";
import { requireSession } from "@/lib/console/auth";
import { environments, selectedEnvironment } from "@/lib/console/environments";
import { ctxFor } from "@/lib/server/auth/accounts";
import { isAdminRole } from "@/lib/server/context";
import { jobsForService } from "@/lib/server/data/jobs";
import { enabledTargets } from "@/lib/server/data/plugins";
import { getService } from "@/lib/server/data/services";
import { setArchived } from "../actions";
import { anchorNow, DAY, daily, dayStart, serviceRows, stageStates, type ServiceRow } from "@/lib/console/analytics";
import { getEvents, listDeployments } from "@/lib/console/data";
import { ago, dayLabel, pct, requestTime, weekdayLabel } from "@/lib/console/format";
import { paginate, parsePage, parsePer } from "@/lib/console/paginate";
import { readProjectConfig } from "@/lib/console/policy";
import { cn } from "@/lib/site";

export async function generateMetadata({ params }: PageProps<"/app/services/[name]">): Promise<Metadata> {
  const { name } = await params;
  return { title: decodeURIComponent(name) };
}

export default async function ServicePage({ params, searchParams }: PageProps<"/app/services/[name]">) {
  const { name: raw } = await params;
  const sp = await searchParams;
  const name = decodeURIComponent(raw);
  const session = await requireSession();
  const ctx = ctxFor(session);
  const [deps, config, svc, envs, env, jobs, targets] = await Promise.all([
    listDeployments(),
    readProjectConfig(),
    getService(ctx, name),
    environments(),
    selectedEnvironment(sp.environment),
    jobsForService(ctx, name, 6),
    enabledTargets(ctx),
  ]);
  const now = anchorNow(deps);
  const archived = Boolean(svc?.archived_at);
  const known = svc && archived ? [...config.services, { ...svc, cluster: svc.cluster || undefined, namespace: svc.namespace || undefined }] : config.services;
  const row = serviceRows(known, deps, now).find((r) => r.name === name);
  if (!row) notFound();
  const admin = isAdminRole(session.role);

  const releases = env ? row.deps.filter((d) => (d.environment ?? "production") === env) : row.deps;
  const page = paginate(releases, parsePage(sp.page), parsePer(sp.per));
  const focus = row.live ?? row.lastFinished ?? row.last;
  const focusEvents = focus ? await getEvents(focus.id) : [];
  const lastVerdict = [...focusEvents].reverse().find((e) => e.kind === "verdict" && e.verdict?.results);
  const results = lastVerdict?.verdict?.results ?? [];

  const start = dayStart(now) + DAY - 30 * DAY;
  const days = daily(row.recent, start, 30);
  const imageRepo = (row.last?.image ?? `registry/${name}`).replace(/:[^:/]+$/, "");
  const deployCmd = `alror deploy -s ${name} -i ${imageRepo}:<tag> --ref '#<pr>'`;
  const stable = row.deps.find((d) => d.status === "promoted") ?? null;
  const liveStates = row.live ? stageStates(row.live, row.live.id === focus?.id ? focusEvents : undefined) : [];

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[28px] font-semibold tracking-[-0.025em]">{name}</h1>
            {row.critical && <Pill className="text-con-fg2">Critical</Pill>}
            {archived && <Pill className="text-con-fg2">Archived</Pill>}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="break-all font-mono text-[13px] text-con-fg2">{imageRepo}</span>
            <CopyButton text={imageRepo} iconOnly label="Copy image repository" />
          </div>
          <p className="mt-2 max-w-2xl text-[13px] text-con-fg3">
            {row.paths.length
              ? `Owns ${row.paths.length} path${row.paths.length === 1 ? "" : "s"} · ${row.recent.length} release${row.recent.length === 1 ? "" : "s"} in 30 days · ${pct(row.cfr, 0)} rolled back.`
              : "No paths mapped yet."}{" "}
            {row.health === "rolling"
              ? "A rollout is in progress right now."
              : row.health === "rolled_back"
                ? "Its latest finished release was rolled back."
                : row.health === "healthy"
                  ? "Its latest release promoted cleanly."
                  : "It has not been released yet."}
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <CopyButton text={deployCmd} label="Copy deploy command" />
          {admin && svc && (
            <EditServiceButton
              initial={{ name, target: svc.target, paths: svc.paths, cluster: svc.cluster, namespace: svc.namespace, critical: svc.critical }}
              targets={targets}
            />
          )}
          {admin && svc && (
            <ConfirmAction
              action={setArchived}
              fields={{ name, archived: archived ? "false" : "true" }}
              label={archived ? "Restore" : "Archive"}
              confirmLabel={archived ? "Restore" : "Archive"}
              prompt={archived ? undefined : "Archived services cannot be deployed."}
              tone={archived ? "secondary" : "danger"}
              icon={archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
            />
          )}
          {!archived && svc && (
            <DeployButton defaults={{ services: [name], environments: envs, service: name, imageRepo, environment: env ?? undefined }} label="Deploy" />
          )}
        </div>
      </div>

      {archived && (
        <div className="rounded-lg border border-con-line bg-con-panel px-4 py-3 text-[13px] text-con-fg2">
          This service is archived: it is hidden from the services list and from GET /config, and new deployments are rejected.
          {admin ? " Restore it to deploy again." : " An owner or admin can restore it."}
        </div>
      )}

      <div className="con-fade-up grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="con-stagger grid grid-cols-1 gap-x-6 gap-y-5 self-start sm:grid-cols-2">
          <Tile icon={<Activity size={22} strokeWidth={1.5} />} label="Status">
            <StatusValue r={row} />
          </Tile>
          <Tile icon={<Server size={22} strokeWidth={1.5} />} label="Target">
            <span className="flex items-center gap-2">
              {row.target}
              <span className="rounded border border-con-line px-1.5 font-mono text-[10px] uppercase text-con-fg2">{row.cluster ?? "local"}</span>
            </span>
          </Tile>
          <Tile icon={<Tag size={22} strokeWidth={1.5} />} label="Last release">
            {row.last ? (
              <Link href={`/app/deployments/${row.last.id}`} className="hover:underline hover:underline-offset-4">
                <span className="font-mono">{row.last.ref || row.last.id}</span>
                <span className="text-con-fg2"> · {ago(row.last.created_at, now)}</span>
              </Link>
            ) : (
              <span className="text-con-fg3">No releases yet</span>
            )}
          </Tile>
          <Tile icon={<Gauge size={22} strokeWidth={1.5} />} label="Risk (30d avg)">
            <span className="font-mono tabular-nums">{Math.round(row.avgRisk)}</span>
            <span className="text-con-fg2"> / 100 · {pct(row.cfr, 1)} rolled back</span>
          </Tile>
          <Tile icon={<ShieldCheck size={22} strokeWidth={1.5} />} label="Auto-rollback">
            {config.policy.autoRollback ? "Enabled" : <span className="text-con-warn">Shadow mode</span>}
            <span className="text-con-fg2"> · α {config.policy.alpha}</span>
          </Tile>
          <Tile icon={<RotateCcw size={22} strokeWidth={1.5} />} label="Last rollback">
            {row.lastRollback ? (
              <Link href={`/app/deployments/${row.lastRollback.id}`} className="hover:underline hover:underline-offset-4">
                {ago(row.lastRollback.updated_at, now)}
                <span className="text-con-fg2"> · {row.lastRollback.ref || "release"}</span>
              </Link>
            ) : (
              <span className="text-con-fg3">None on record</span>
            )}
          </Tile>
        </div>

        <ServiceTopology
          environment={(row.live ?? row.lastFinished)?.environment ?? "production"}
          target={row.target}
          cluster={row.cluster}
          stable={stable}
          live={row.live}
          states={liveStates}
          metrics={results}
          verdict={lastVerdict ? lastVerdict.verdict!.pass : null}
          autoRollback={config.policy.autoRollback}
          now={now}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ServiceTimeline deps={row.deps.slice(0, 8)} now={now} name={name} />
        <div className="space-y-6">
          <ServiceRiskTrend deps={row.deps} />
          <ServicePaths paths={row.paths} critical={row.critical} name={name} />
        </div>
      </div>

      <Card
        title="Deploy activity"
        description="Last 30 days"
        aside={
          <span className="flex gap-4">
            <LegendItem color={COLORS.neutral} label="Promoted" />
            <LegendItem color={COLORS.bad} label="Rolled back or failed" />
          </span>
        }
      >
        <StackedBars
          height={150}
          minMax={3}
          data={days.map((b) => ({
            label: dayLabel(b.day),
            title: `${weekdayLabel(b.day)}: ${b.promoted} promoted, ${b.bad} rolled back or failed${b.other ? `, ${b.other} in progress` : ""}`,
            segments: [
              { name: "Promoted", value: b.promoted, color: COLORS.neutral },
              { name: "In progress", value: b.other, color: COLORS.info },
              { name: "Rolled back", value: b.bad, color: COLORS.bad },
            ],
          }))}
        />
      </Card>

      <Card
        title="Jobs"
        description="Deploys and rollbacks queued for this service. Status updates live as a runner works on them."
        aside={
          <Link href="/app/jobs" className="text-[13px] text-con-fg2 hover:text-con-fg">
            All jobs
          </Link>
        }
        flush
      >
        {jobs.length === 0 ? (
          <EmptyState title="No jobs for this service">Use Deploy to queue one; alror runner picks it up.</EmptyState>
        ) : (
          <JobsTable jobs={jobs} now={requestTime()} compact />
        )}
      </Card>

      <Card
        title="Recent releases"
        description={`${releases.length} releases on record${env ? ` in ${env}` : ""}`}
        aside={
          env ? (
            <Link href={`/app/services/${encodeURIComponent(name)}?environment=all`} className="text-[13px] text-con-fg2 hover:text-con-fg">
              Show all environments
            </Link>
          ) : undefined
        }
        flush
      >
        {page.total === 0 ? <EmptyState title="No releases yet" /> : <DeploymentTable deps={page.items} now={now} hideService />}
        <Pagination
          meta={page}
          noun="releases"
          base={`/app/services/${encodeURIComponent(name)}`}
          params={{ environment: typeof sp.environment === "string" ? sp.environment : undefined }}
        />
      </Card>

      <section id="get-started" className="scroll-mt-6 space-y-3">
        <h2 className="text-[15px] font-semibold">Get connected</h2>
        <div className="con-stagger grid gap-4 md:grid-cols-3">
          <Snippet title="Ship a release" body="Scores the change, picks a plan and verifies every step." cmd={deployCmd} />
          <Snippet title="Check status" body="The CLI reads the same state this console shows." cmd={`alror status${row.last ? ` ${row.last.id}` : ""}`} />
          <Snippet title="Score before merging" body="Run the risk scorer against your branch in CI." cmd="alror risk --base origin/main" />
        </div>
      </section>
    </div>
  );
}

function Tile({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <span className="grid h-[72px] w-[72px] shrink-0 place-items-center rounded-lg border border-con-line bg-con-panel text-con-fg2">{icon}</span>
      <div className="min-w-0">
        <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-con-fg3">{label}</div>
        <div className="mt-1 text-[14px] text-con-fg">{children}</div>
      </div>
    </div>
  );
}

function StatusValue({ r }: { r: ServiceRow }) {
  const cfg =
    r.health === "rolling"
      ? { text: `Rolling ${r.live?.weight ?? 0}%`, dot: "bg-con-info" }
      : r.health === "rolled_back"
        ? { text: "Rolled back", dot: "bg-con-bad" }
        : r.health === "healthy"
          ? { text: "Healthy", dot: "bg-con-good" }
          : { text: "No releases", dot: "bg-con-fg3" };
  return (
    <span className="flex items-center gap-2">
      {cfg.text}
      <span className="flex gap-[3px]" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)} />
        ))}
      </span>
    </span>
  );
}

function Snippet({ title, body, cmd }: { title: string; body: string; cmd: string }) {
  return (
    <div className="flex flex-col rounded-lg border border-con-line bg-con-panel p-5">
      <div className="text-[14px] font-medium">{title}</div>
      <p className="mt-1 text-[13px] text-con-fg2">{body}</p>
      <div className="mt-4 flex items-start gap-2 rounded-md border border-con-line bg-con-bg p-3">
        <code className="min-w-0 flex-1 break-all font-mono text-[12px] leading-relaxed text-con-fg">{cmd}</code>
        <CopyButton text={cmd} iconOnly />
      </div>
    </div>
  );
}
