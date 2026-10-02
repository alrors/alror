import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { ArrowUpRight, BookOpen, KeyRound, Package, ShieldCheck, Terminal } from "lucide-react";
import { DeployButton } from "@/components/console/deploy-dialog";
import { ActivityFeed } from "@/components/console/overview/activity";
import { NeedsAttention } from "@/components/console/overview/attention";
import { OverviewChecklist, type ChecklistStep } from "@/components/console/overview/checklist";
import { CustomizeMenu, OverviewFrame } from "@/components/console/overview/frame";
import { LiveLanes } from "@/components/console/overview/lanes";
import { DeliveryHealth, ReleasePulse } from "@/components/console/overview/pulse";
import { ServicesGrid } from "@/components/console/overview/services-grid";
import { RiskMixWidget, RunnersWidget, UsageWidget } from "@/components/console/overview/side";
import { GHOST_BUTTON, SMALL_BUTTON } from "@/components/console/overview/ui";
import { hrefWith } from "@/components/console/pagination";
import { SegmentedSelector } from "@/components/console/selector";
import { NewServiceButton } from "@/components/console/service-form";
import { anchorNow, DAY, isBad, serviceRows } from "@/lib/console/analytics";
import { requireSession } from "@/lib/console/auth";
import { DOCS_URL as LOCAL_DOCS_URL } from "@/lib/console/config";
import { eventsFor, listDeployments } from "@/lib/console/data";
import { environments, selectedEnvironment } from "@/lib/console/environments";
import { ago, metricLabel, requestTime } from "@/lib/console/format";
import { jobPhase, jobTarget, PHASE } from "@/lib/console/jobs";
import {
  DEFAULT_RANGE,
  kpis as computeKpis,
  lane,
  OVERVIEW_RANGES,
  parseOverviewRange,
  RANGE_SPEC,
  rangeWindow,
  riskMix,
  runnersFrom,
  serviceTiles,
  sortAttention,
  type ActivityItem,
  type AttentionItem,
} from "@/lib/console/overview";
import { readProjectConfig } from "@/lib/console/policy";
import { OVERVIEW_DENSITY_COOKIE } from "@/lib/console/prefs";
import type { Deployment } from "@/lib/console/types";
import { ctxFor } from "@/lib/server/auth/accounts";
import { listApiKeys } from "@/lib/server/auth/api-keys";
import { isAdminRole } from "@/lib/server/context";
import { usage as usageFor } from "@/lib/server/data/analytics";
import { listAuditActions, type AuditEntry } from "@/lib/server/data/audit";
import { listJobs, pageJobs } from "@/lib/server/data/jobs";
import { enabledTargets } from "@/lib/server/data/plugins";
import { getPolicy } from "@/lib/server/data/policy";
import { listServices } from "@/lib/server/data/services";
import { cn } from "@/lib/site";

export const metadata: Metadata = { title: "Overview" };

// Same docs link the shell uses: NEXT_PUBLIC_ALROR_DOCS_URL when set, else the local docs server.
const DOCS_URL = process.env.NEXT_PUBLIC_ALROR_DOCS_URL || LOCAL_DOCS_URL;

/** A queued job nobody has picked up for this long is worth a look (no runner online?). */
const QUEUED_TOO_LONG_MS = 10 * 60_000;
/** Activity items per page: comfortable and compact density. */
const ACTIVITY_PER = { comfortable: 8, compact: 10 } as const;
const ACTIVITY_MAX_PAGES = 40;
/** Audit actions the activity feed shows (org changes that affect releases). */
const AUDIT_ACTIONS = [
  "policy.update",
  "plugin.install",
  "plugin.configure",
  "plugin.enable",
  "plugin.disable",
  "plugin.uninstall",
  "service.create",
  "service.archive",
  "service.unarchive",
  "environment.create",
  "environment.update",
];

const isLive = (d: Deployment) => d.status === "rolling" || d.status === "pending";
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Audit rows worth showing in the activity feed (org changes that affect releases). */
function auditActivity(a: AuditEntry): ActivityItem | null {
  const by = a.actor_label;
  const base = { key: `audit-${a.id}`, at: a.at, detail: `by ${by}` };
  switch (a.action) {
    case "policy.update": {
      const fields = Array.isArray(a.meta.fields) ? (a.meta.fields as string[]).map((f) => f.replace(/_/g, " ")).join(", ") : "";
      return { ...base, kind: "policy", title: "Rollout policy updated", detail: fields ? `${fields} · by ${by}` : base.detail, href: "/app/policies" };
    }
    case "plugin.install":
    case "plugin.configure":
    case "plugin.enable":
    case "plugin.disable":
    case "plugin.uninstall": {
      const verb = { "plugin.install": "Installed", "plugin.configure": "Configured", "plugin.enable": "Enabled", "plugin.disable": "Disabled", "plugin.uninstall": "Uninstalled" }[a.action];
      return { ...base, kind: "plugin", title: `${verb} ${a.target}`, detail: `Marketplace · by ${by}`, href: `/app/marketplace/${encodeURIComponent(a.target)}` };
    }
    case "service.create":
    case "service.archive":
    case "service.unarchive": {
      const verb = a.action === "service.create" ? "added" : a.action === "service.archive" ? "archived" : "restored";
      return { ...base, kind: "service", title: `Service ${a.target} ${verb}`, href: `/app/services/${encodeURIComponent(a.target)}` };
    }
    case "environment.create":
      return { ...base, kind: "environment", title: `Environment ${a.target} created` };
    case "environment.update":
      return { ...base, kind: "environment", title: `Environment ${a.target} ${a.meta.protected ? "protected" : "unprotected"}` };
    default:
      return null;
  }
}

/** When a release last did something: its finish, or its start while live. */
const activityAt = (d: Deployment) => (isLive(d) ? d.created_at : d.updated_at);

function releaseActivity(d: Deployment): ActivityItem {
  const where = [d.ref, d.environment ?? "production"].filter(Boolean).join(" · ");
  const href = `/app/deployments/${d.id}`;
  if (d.status === "promoted") return { key: `dep-${d.id}`, at: d.updated_at, kind: "promoted", title: `${d.service} promoted to all traffic`, detail: where, href };
  if (d.status === "rolled_back") return { key: `dep-${d.id}`, at: d.updated_at, kind: "rolled_back", title: `${d.service} rolled back`, detail: d.reason || where, href };
  if (d.status === "failed") return { key: `dep-${d.id}`, at: d.updated_at, kind: "failed", title: `${d.service} failed`, detail: d.reason || where, href };
  return { key: `dep-${d.id}`, at: d.created_at, kind: "release", title: `${d.service} release started`, detail: `${where} · risk ${d.risk?.score ?? 0}`, href };
}

export default async function OverviewPage({ searchParams }: PageProps<"/app">) {
  const sp = await searchParams;
  const range = parseOverviewRange(sp.range);
  const jar = await cookies();
  const per = jar.get(OVERVIEW_DENSITY_COOKIE)?.value === "compact" ? ACTIVITY_PER.compact : ACTIVITY_PER.comfortable;
  const rawPage = Number(Array.isArray(sp.activity) ? sp.activity[0] : sp.activity);
  const wantPage = Number.isInteger(rawPage) && rawPage > 1 ? Math.min(rawPage, ACTIVITY_MAX_PAGES) : 1;
  // The merged feed is ordered by time, so page p needs at most p * per rows from each source.
  const need = wantPage * per;
  const session = await requireSession();
  const ctx = ctxFor(session);
  const admin = isAdminRole(session.role);

  // One deployments query serves everything (it is cached per request and shared with the layout).
  // Events for live releases start as soon as the list arrives, in parallel with the rest.
  const depsPromise = listDeployments();
  const liveEventsPromise = depsPromise.then((all) => eventsFor(all.filter(isLive).map((d) => d.id)));
  const [all, liveEvents, config, usage, allServices, envs, env, openJobs, jobPage, keys, policy, audit, targets] = await Promise.all([
    depsPromise,
    liveEventsPromise,
    readProjectConfig(),
    usageFor(ctx),
    listServices(ctx, { includeArchived: true }),
    environments(),
    selectedEnvironment(),
    listJobs(ctx, { status: ["queued", "claimed"], limit: 100 }),
    pageJobs(ctx, { page: 1, per: Math.max(40, need) }),
    admin ? listApiKeys(ctx) : Promise.resolve(null),
    getPolicy(ctx),
    admin ? listAuditActions(ctx, AUDIT_ACTIONS, need) : Promise.resolve({ items: [] as AuditEntry[], total: 0 }),
    admin ? enabledTargets(ctx) : Promise.resolve(undefined),
  ]);

  const now = anchorNow(all);
  const wall = requestTime();
  const deps = env ? all.filter((d) => (d.environment ?? "production") === env) : all;
  const archivedNames = new Set(allServices.filter((s) => s.archived_at).map((s) => s.name));
  const rows = serviceRows(config.services, deps, now).filter((r) => !archivedNames.has(r.name));

  /* ---- range: pulse, KPIs, risk mix ---- */
  const spec = RANGE_SPEC[range];
  const win = rangeWindow(range, now);
  const health = computeKpis(deps, win, spec.days);
  const mix = riskMix(health.current);

  /* ---- live lanes ---- */
  const live = deps.filter(isLive);
  const lanes = live
    .map((d) => lane(d, liveEvents.get(d.id) ?? []))
    .sort((a, b) => Number(b.failing) - Number(a.failing) || (b.dep.risk?.score ?? 0) - (a.dep.risk?.score ?? 0));

  /* ---- needs attention ---- */
  const attention: AttentionItem[] = [];
  for (const l of lanes) {
    const d = l.dep;
    const stage = `${d.weight}% canary, stage ${Math.min(d.step_index + 1, l.weights.length || 1)} of ${l.weights.length || 1}`;
    if (l.failing) {
      const bad = l.verdicts.filter((v) => !v.pass).map((v) => metricLabel(v.metric));
      attention.push({
        key: `verdict-${d.id}-${d.step_index}`,
        severity: "critical",
        kind: "verdict",
        title: `${d.service} is failing verification${d.ref ? ` (${d.ref})` : ""}`,
        detail: `${bad.join(" and ")} regressed at ${stage}.`,
        at: d.updated_at,
        action: { label: "View release", href: `/app/deployments/${d.id}` },
        rollback: { id: d.id, service: d.service },
      });
    } else if ((d.risk?.score ?? 0) >= 70) {
      attention.push({
        key: `risk-${d.id}`,
        severity: "high",
        kind: "risk",
        title: `High-risk rollout in progress: ${d.service}${d.ref ? ` ${d.ref}` : ""}`,
        detail: `Risk ${d.risk.score} of 100 at ${stage}. Watch its verdicts.`,
        at: d.created_at,
        action: { label: "View release", href: `/app/deployments/${d.id}` },
        rollback: { id: d.id, service: d.service },
      });
    }
  }
  for (const j of openJobs) {
    const phase = jobPhase(j, wall);
    const what = j.kind === "deploy" ? "Deploy" : "Rollback";
    if (phase === "stalled") {
      attention.push({
        key: `stalled-${j.id}-${j.heartbeat_at ?? ""}`,
        severity: j.kind === "rollback" ? "critical" : "high",
        kind: "stalled",
        title: `${what} job stalled on ${j.claimed_by ?? "a runner"}`,
        detail: `${jobTarget(j)}. Its runner stopped sending heartbeats; another runner can pick it up, or cancel it.`,
        at: j.heartbeat_at ?? j.claimed_at ?? j.created_at,
        action: { label: "Open job", href: "/app/jobs?status=claimed" },
      });
    } else if (phase === "queued" && wall - Date.parse(j.created_at) > QUEUED_TOO_LONG_MS) {
      attention.push({
        key: `queued-${j.id}`,
        severity: j.kind === "rollback" ? "high" : "medium",
        kind: "queued",
        title: `${what} waiting for a runner for ${ago(j.created_at, wall).replace(" ago", "")}`,
        detail: `${jobTarget(j)}. Is alror runner online?`,
        at: j.created_at,
        action: { label: "Open job", href: "/app/jobs?status=queued" },
      });
    }
  }
  const weekAgo = now - 7 * DAY;
  for (const r of rows) {
    const recent = r.deps.filter((d) => isBad(d.status) && Date.parse(d.updated_at) >= weekAgo);
    if (!recent.length || r.live) continue;
    const last = recent[0];
    const stillDown = r.health === "rolled_back";
    attention.push({
      key: `svc-${r.name}-${last.id}`,
      severity: stillDown ? "high" : "medium",
      kind: stillDown ? "rolled_back" : "recovered",
      title: stillDown
        ? `${r.name}: latest release ${last.status === "failed" ? "failed" : "rolled back"}${last.ref ? ` (${last.ref})` : ""}`
        : `${r.name} rolled back ${recent.length === 1 ? "once" : `${recent.length} times`} this week`,
      detail: stillDown ? (last.reason ?? "It is back on the previous stable version.") : `It has promoted since. ${last.reason ? `Last: ${last.reason}` : "Check what failed."}`,
      at: last.updated_at,
      action: { label: "View release", href: `/app/deployments/${last.id}` },
    });
  }
  const attentionSorted = sortAttention(attention).slice(0, 12);

  /* ---- activity (one page of releases, jobs and audit rows merged by time) ---- */
  const recentJobs = jobPage.items;
  const byActivity = [...deps].sort((x, y) => Date.parse(activityAt(y)) - Date.parse(activityAt(x)));
  const activityTotal = deps.length + jobPage.total + audit.total;
  const activityPages = Math.max(1, Math.min(ACTIVITY_MAX_PAGES, Math.ceil(activityTotal / per)));
  const activityPage = Math.min(wantPage, activityPages);
  const activity: ActivityItem[] = [
    ...byActivity.slice(0, need).map(releaseActivity),
    ...recentJobs.slice(0, need).map((j): ActivityItem => {
      const phase = jobPhase(j, wall);
      return {
        key: `job-${j.id}`,
        at: j.created_at,
        kind: "job",
        title: `${j.kind === "deploy" ? "Deploy" : "Rollback"} job ${PHASE[phase].label.toLowerCase()}`,
        detail: [jobTarget(j), j.claimed_by ?? j.requested_by].filter(Boolean).join(" · "),
        href: `/app/jobs${j.status === "queued" || j.status === "claimed" ? `?status=${j.status}` : ""}`,
      };
    }),
    ...audit.items.map(auditActivity).filter((x): x is ActivityItem => x !== null),
  ]
    .sort((x, y) => Date.parse(y.at) - Date.parse(x.at) || x.key.localeCompare(y.key))
    .slice((activityPage - 1) * per, activityPage * per);
  const activityHref = (n: number) => hrefWith("/app", { range: range === DEFAULT_RANGE ? undefined : range }, { activity: n > 1 ? String(n) : undefined });

  /* ---- runners ---- */
  const seenJobs = [...new Map([...recentJobs, ...openJobs].map((j) => [j.id, j])).values()];
  const runners = runnersFrom(seenJobs, wall);
  const phases = openJobs.map((j) => jobPhase(j, wall));
  const queuedJobs = openJobs.filter((j) => j.status === "queued");
  const oldestQueued = queuedJobs.length ? queuedJobs.reduce((m, j) => (Date.parse(j.created_at) < Date.parse(m) ? j.created_at : m), queuedJobs[0].created_at) : null;

  /* ---- getting started ---- */
  const hasKey = keys ? keys.length > 0 : true;
  const isNew = all.length === 0 || (admin && !hasKey);
  const checklist: ChecklistStep[] = [
    { title: "Add a service", body: "Services are what Alror deploys. Map file paths to each one.", done: config.services.length > 0, href: "/app/services", cta: "Services" },
    ...(admin
      ? [
          { title: "Create an API key", body: "The CLI, CI and alror runner authenticate with one.", done: hasKey, href: "/app/settings/api-keys", cta: "Create key" },
          { title: "Connect the CLI", body: "Run alror login with the key; the key shows as used.", done: Boolean(keys?.some((k) => k.last_used_at)), href: "/app/onboarding", cta: "How" },
        ]
      : []),
    { title: "Ship a first release", body: "Use Deploy here, or alror deploy from CI.", done: all.length > 0, href: "/app/onboarding", cta: "How" },
    { title: "Review the rollout policy", body: "Decide when Alror rolls back and how fast it promotes.", done: Date.parse(policy.updated_at) > 0, href: "/app/policies", cta: "Policies" },
  ];

  /* ---- header ---- */
  const serviceNames = config.services.map((s) => s.name).sort();
  const envList = envs.map((e) => ({ name: e.name, protected: e.protected }));
  const lastRelease = deps[0];
  const status = [
    live.length ? `${plural(live.length, "rollout")} live` : "No rollout live",
    attentionSorted.length ? `${attentionSorted.length} need${attentionSorted.length === 1 ? "s" : ""} attention` : "nothing needs attention",
    lastRelease ? `last release ${ago(lastRelease.created_at, now)}` : "no releases yet",
  ];
  const policyChanged = Date.parse(policy.updated_at) > 0;
  const chip = cn(SMALL_BUTTON, GHOST_BUTTON);

  return (
    <OverviewFrame className="space-y-5 data-[density=compact]:space-y-3">
      {/* Header */}
      <header className="con-fade-up flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-con-fg3">
            <span className="font-medium text-con-fg2">{session.org.name}</span>
            <span aria-hidden>/</span>
            <span title="Change it with the environment switcher in the top bar" className="inline-flex h-5 items-center rounded-full border border-con-line px-2 text-[11.5px] text-con-fg2">
              {env ?? "All environments"}
            </span>
          </div>
          <h1 className="mt-1.5 text-[26px] font-semibold leading-tight tracking-[-0.025em] text-con-fg">Overview</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-con-fg2" aria-live="polite">
            {status.map((s, i) => (
              <span key={i} className="inline-flex items-center gap-2">
                {i > 0 && (
                  <span aria-hidden className="text-con-fg3">
                    ·
                  </span>
                )}
                {i === 0 && live.length > 0 && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-con-info" />}
                {i === 1 && attentionSorted.some((a) => a.severity === "critical") && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-con-bad" />}
                {s}
              </span>
            ))}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedSelector
            aria-label="Time range"
            value={range}
            items={OVERVIEW_RANGES.map((r) => ({ value: r, label: r, title: RANGE_SPEC[r].label, href: hrefWith("/app", {}, { range: r === DEFAULT_RANGE ? undefined : r }) }))}
          />
          <CustomizeMenu />
        </div>
      </header>

      {/* Command row */}
      <nav aria-label="Quick actions" className="con-fade-up flex flex-wrap items-center gap-2" style={{ animationDelay: "40ms" }}>
        {serviceNames.length > 0 && (
          <DeployButton defaults={{ services: serviceNames, environments: envList, environment: env ?? undefined }} label="Deploy" className="h-7 gap-1.5 px-2.5 text-[12px]" />
        )}
        {admin && <NewServiceButton targets={targets} className={cn(chip, "bg-transparent")} />}
        {admin ? (
          <Link href="/app/settings/api-keys" className={chip}>
            <KeyRound size={13} />
            API key
          </Link>
        ) : (
          <Link href="/app/onboarding" className={chip}>
            <Terminal size={13} />
            Connect the CLI
          </Link>
        )}
        <Link href="/app/marketplace" className={chip}>
          <Package size={13} />
          Marketplace
        </Link>
        <a href={DOCS_URL} target="_blank" rel="noreferrer" className={chip}>
          <BookOpen size={13} />
          Docs
          <ArrowUpRight size={12} className="text-con-fg3" />
        </a>
        <Link href="/app/policies" className="ml-auto hidden items-center gap-1.5 text-[12px] text-con-fg3 hover:text-con-fg md:inline-flex">
          <ShieldCheck size={13} />
          {policy.auto_rollback ? "Automatic rollback on" : "Shadow mode: no automatic rollback"}
          {policyChanged ? ` · policy changed ${ago(policy.updated_at, wall)}` : " · default policy"}
        </Link>
      </nav>

      {isNew && <OverviewChecklist steps={checklist} />}

      {/* Hero */}
      <div className="con-fade-up flex flex-col gap-5 group-data-[density=compact]/ov:gap-3 xl:flex-row" style={{ animationDelay: "80ms" }}>
        <ReleasePulse buckets={health.buckets} range={range} total={health.current.length} />
        <DeliveryHealth kpis={health.kpis} range={range} />
      </div>

      {/* Board */}
      <div className="grid items-start gap-5 group-data-[density=compact]/ov:gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="con-fade-up min-w-0 space-y-5 group-data-[density=compact]/ov:space-y-3" style={{ animationDelay: "120ms" }}>
          <LiveLanes lanes={lanes} events={liveEvents} now={now} canRollBack={admin} />
          {/* Below xl the side column stacks last, so attention moves up next to the lanes. */}
          <div data-widget="attention" className="xl:hidden">
            <NeedsAttention items={attentionSorted} now={now} canRollBack={admin} />
          </div>
          <ServicesGrid tiles={serviceTiles(rows, now)} now={now} archived={archivedNames.size} />
          <ActivityFeed
            items={activity}
            now={wall}
            admin={admin}
            page={activityPage}
            pages={activityPages}
            per={per}
            total={activityTotal}
            prevHref={activityPage > 1 ? activityHref(activityPage - 1) : null}
            nextHref={activityPage < activityPages ? activityHref(activityPage + 1) : null}
          />
        </div>
        <aside className="con-fade-up min-w-0 space-y-5 group-data-[density=compact]/ov:space-y-3" style={{ animationDelay: "160ms" }}>
          <div data-widget="attention" className="hidden xl:block">
            <NeedsAttention items={attentionSorted} now={now} canRollBack={admin} />
          </div>
          <RunnersWidget
            runners={runners}
            queued={queuedJobs.length}
            running={phases.filter((p) => p === "running").length}
            stalled={phases.filter((p) => p === "stalled").length}
            oldestQueued={oldestQueued}
            now={wall}
          />
          <RiskMixWidget mix={mix} rangeLabel={spec.label} />
          <UsageWidget usage={usage} />
        </aside>
      </div>
    </OverviewFrame>
  );
}
