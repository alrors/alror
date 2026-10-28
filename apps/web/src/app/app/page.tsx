import type { Metadata } from "next";
import Link from "next/link";
import { Activity, ArrowRight } from "lucide-react";
import { DeployButton } from "@/components/console/deploy-dialog";
import { OverviewChecklist, type ChecklistStep } from "@/components/console/overview/checklist";
import { WhatAlrorDid } from "@/components/console/oversight/did-feed";
import { WeeklyImpact } from "@/components/console/oversight/impact";
import { NeedsYou } from "@/components/console/oversight/inbox";
import { hrefWith } from "@/components/console/pagination";
import { NewServiceButton } from "@/components/console/service-form";
import { anchorNow, DAY } from "@/lib/console/analytics";
import { requireSession } from "@/lib/console/auth";
import { eventsFor, listDeployments } from "@/lib/console/data";
import { environments, selectedEnvironment } from "@/lib/console/environments";
import { dayLabel, requestTime } from "@/lib/console/format";
import {
  auditDid,
  DID_AUDIT_ACTIONS,
  impact as computeImpact,
  incidentInbox,
  tuningInbox,
  INBOX_HORIZON_MS,
  isAutomaticOutcome,
  isManualRollback,
  jobInbox,
  latestPerPull,
  pullInbox,
  rampInbox,
  releaseDid,
  releaseInbox,
  sortInbox,
  windowLabel,
  type DidItem,
} from "@/lib/console/oversight";
import { readProjectConfig } from "@/lib/console/policy";
import type { Deployment } from "@/lib/console/types";
import { ctxFor } from "@/lib/server/auth/accounts";
import { listApiKeys } from "@/lib/server/auth/api-keys";
import { isAdminRole } from "@/lib/server/context";
import { listAuditActions } from "@/lib/server/data/audit";
import { listJobs } from "@/lib/server/data/jobs";
import { gateImpact, manualRollbackIds, openIncidents, tuningProposalsReady } from "@/lib/server/data/oversight";
import { enabledTargets } from "@/lib/server/data/plugins";
import { getPolicy } from "@/lib/server/data/policy";
import { loadTrustRamp, shadowFeedbackFor } from "@/lib/server/data/trust-ramp";
import { listDecisions, listRepositories } from "@/lib/server/github/data";

export const metadata: Metadata = { title: "Oversight" };

/** Feed items per page, and how deep the feed pages. */
const FEED_PER = 12;
const FEED_MAX_PAGES = 30;
const IMPACT_DAYS = 7;

const isLive = (d: Deployment) => d.status === "rolling" || d.status === "pending";
const isFinished = (d: Deployment) => d.status === "promoted" || d.status === "rolled_back" || d.status === "failed";

export default async function OversightPage({ searchParams }: PageProps<"/app">) {
  const sp = await searchParams;
  const raw = Number(Array.isArray(sp.did) ? sp.did[0] : sp.did);
  const wantPage = Number.isInteger(raw) && raw > 1 ? Math.min(raw, FEED_MAX_PAGES) : 1;
  const need = wantPage * FEED_PER;
  const session = await requireSession();
  const ctx = ctxFor(session);
  const admin = isAdminRole(session.role);
  const wall = requestTime();

  const [all, config, envs, env, openJobs, failedJobs, decisions, repos, audit, keys, policy, targets, incidents, proposals] = await Promise.all([
    listDeployments(),
    readProjectConfig(),
    environments(),
    selectedEnvironment(),
    listJobs(ctx, { status: ["queued", "claimed"], limit: 100 }),
    listJobs(ctx, { status: "failed", limit: 50 }),
    listDecisions(ctx, { limit: 200 }),
    listRepositories(ctx),
    // Policy changes name who made them: admins only, like the audit log.
    listAuditActions(ctx, admin ? [...DID_AUDIT_ACTIONS] : ["github.pull_merged", "github.review_requested"], need),
    admin ? listApiKeys(ctx) : Promise.resolve(null),
    getPolicy(ctx),
    admin ? enabledTargets(ctx) : Promise.resolve(undefined),
    openIncidents(ctx),
    admin ? tuningProposalsReady(ctx) : Promise.resolve([]),
  ]);

  const deps = env ? all.filter((d) => (d.environment ?? "production") === env) : all;
  const now = anchorNow(all, wall);
  const limits = config.policy.maxRegression;

  /* ---- which releases need their events ---- */
  // Inbox: the newest release per service and environment, live or finished within the horizon.
  const lanes = new Map<string, Deployment>();
  for (const d of deps) {
    const k = `${d.service}@${d.environment ?? "production"}`;
    const cur = lanes.get(k);
    if (!cur || Date.parse(d.created_at) > Date.parse(cur.created_at)) lanes.set(k, d);
  }
  const inboxDeps = [...lanes.values()].filter((d) => isLive(d) || now - Date.parse(d.updated_at) <= INBOX_HORIZON_MS);
  // Feed and impact: finished releases newest first; rollbacks need events to tell automatic from manual.
  const finished = deps.filter(isFinished).sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  const impactStart = now - IMPACT_DAYS * DAY;
  const candidates = finished.slice(0, need + 40);
  const rolledBack = [...new Set([...candidates, ...finished.filter((d) => Date.parse(d.updated_at) >= impactStart)].filter((d) => d.status === "rolled_back").map((d) => d.id))];

  const [events, requested, gate, judged, ramp] = await Promise.all([
    eventsFor([...new Set([...inboxDeps.map((d) => d.id), ...rolledBack])]),
    manualRollbackIds(ctx, rolledBack),
    gateImpact(ctx, new Date(impactStart), new Date(now + 1)),
    shadowFeedbackFor(ctx, inboxDeps.map((d) => d.id)),
    loadTrustRamp(ctx, wall),
  ]);
  const manual = new Set(rolledBack.filter((id) => requested.has(id) || isManualRollback(events.get(id) ?? [])));

  /* ---- Needs you ---- */
  const inbox = sortInbox([
    ...pullInbox(decisions, wall),
    ...releaseInbox(inboxDeps, events, limits, now, judged),
    ...jobInbox(openJobs, failedJobs, all, wall),
    ...tuningInbox(proposals),
    ...incidentInbox(env ? incidents.filter((i) => !i.environment || i.environment === env) : incidents),
    ...rampInbox(ramp.services),
  ]).slice(0, 40);

  /* ---- What Alror did ---- */
  const automatic = candidates.filter((d) => isAutomaticOutcome(d, manual.has(d.id))).slice(0, need);
  const repoIds = new Map(repos.map((r) => [r.fullName, r.id]));
  const latestDecision = new Map(latestPerPull(decisions).map(({ latest }) => [`${latest.repositoryId}#${latest.pullNumber}`, latest]));
  type Pending = { at: string; key: string; dep?: Deployment; item?: DidItem };
  const merged: Pending[] = [
    ...automatic.map((d) => ({ at: d.updated_at, key: `dep-${d.id}`, dep: d })),
    ...audit.items.flatMap((a) => {
      const item = auditDid(a, repoIds, latestDecision);
      return item ? [{ at: item.at, key: item.key, item }] : [];
    }),
  ].sort((x, y) => Date.parse(y.at) - Date.parse(x.at) || x.key.localeCompare(y.key));
  const automaticTotal = finished.filter((d) => isAutomaticOutcome(d, manual.has(d.id))).length;
  const feedPages = Math.max(1, Math.min(FEED_MAX_PAGES, Math.ceil((automaticTotal + audit.total) / FEED_PER)));
  const feedPage = Math.min(wantPage, feedPages);
  const pageRows = merged.slice((feedPage - 1) * FEED_PER, feedPage * FEED_PER);
  const missing = pageRows.flatMap((r) => (r.dep && !events.has(r.dep.id) ? [r.dep.id] : []));
  const more = missing.length ? await eventsFor(missing) : new Map();
  const feed: DidItem[] = pageRows.map((r) => (r.dep ? releaseDid(r.dep, events.get(r.dep.id) ?? more.get(r.dep.id) ?? []) : r.item!));
  const feedHref = (n: number) => hrefWith("/app", {}, { did: n > 1 ? String(n) : undefined });

  /* ---- Impact ---- */
  const weekly = computeImpact(deps, manual, { start: impactStart, end: now + 1 }, gate.connected ? gate : null);

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

  const serviceNames = config.services.map((s) => s.name).sort();
  const envList = envs.map((e) => ({ name: e.name, protected: e.protected }));
  const live = deps.filter(isLive).length;
  const label = windowLabel(impactStart, now, wall, dayLabel);

  return (
    <div className="group/ov dashboard space-y-6">
      <header className="dash-header !pb-0">
        <div>
          <div className="dash-workspace-label">
            <span>{session.org.name}</span>
            <span>/</span>
            <span>{env ?? "All environments"}</span>
          </div>
          <h1>
            Oversight<span>.</span>
          </h1>
          <p>What needs a person, what Alror did on its own, and why.</p>
        </div>
        <div className="dash-header-actions">
          <Link href="/app/live" className="dash-secondary">
            <Activity size={15} />
            Live
            {live > 0 && <span className="font-mono text-[11px] tabular-nums text-con-fg3">{live} rolling</span>}
          </Link>
          {serviceNames.length > 0 ? (
            <DeployButton defaults={{ services: serviceNames, environments: envList, environment: env ?? undefined }} label="New deployment" className="dash-primary" />
          ) : admin ? (
            <NewServiceButton targets={targets} className="dash-primary" />
          ) : (
            <Link href="/app/services" className="dash-primary">
              Explore services
              <ArrowRight size={15} />
            </Link>
          )}
        </div>
      </header>

      {isNew && <OverviewChecklist steps={checklist} />}

      <WeeklyImpact impact={weekly} label={label} />

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <div id="needs-you" className="min-w-0">
          <NeedsYou items={inbox} now={wall} canRollBack={admin} />
        </div>
        <div id="what-alror-did" className="min-w-0">
          <WhatAlrorDid
            items={feed}
            now={wall}
            page={feedPage}
            pages={feedPages}
            prevHref={feedPage > 1 ? feedHref(feedPage - 1) : null}
            nextHref={feedPage < feedPages ? feedHref(feedPage + 1) : null}
          />
        </div>
      </div>

      <p className="flex flex-wrap items-center gap-x-1.5 text-[12px] text-con-fg3">
        {policy.auto_rollback ? "Automatic rollback is on." : "Automatic rollback is off: Alror reports regressions but does not undo them."}
        <Link href="/app/policies" className="text-con-fg2 hover:text-con-fg">
          Rollout policy
        </Link>
        <span aria-hidden>·</span>
        <Link href="/app/live" className="text-con-fg2 hover:text-con-fg">
          Live rollouts and delivery trends
        </Link>
      </p>
    </div>
  );
}
