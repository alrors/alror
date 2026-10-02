import Link from "next/link";
import { FolderTree, TriangleAlert } from "lucide-react";
import { COLORS, LegendItem, LineChart } from "@/components/console/charts";
import { Card, Pill, RiskValue, StagePips, toneBg, type StageState } from "@/components/console/primitives";
import { ago, dayLabel, statusLabel, statusTone } from "@/lib/console/format";
import type { Deployment, MetricResult } from "@/lib/console/types";
import { cn } from "@/lib/site";

/* ------------------------------------ Topology ----------------------------------- */

/**
 * Stable vs canary: which image serves most traffic, which one is being tried, and how
 * traffic is split right now. Bars grow on mount and ease between live refreshes.
 */
export function ServiceTopology({
  environment,
  target,
  cluster,
  stable,
  live,
  states,
  metrics,
  verdict,
  autoRollback,
  now,
}: {
  environment: string;
  target: string;
  cluster?: string;
  stable: Deployment | null;
  live: Deployment | null;
  states: StageState[];
  metrics: MetricResult[];
  verdict: boolean | null;
  autoRollback: boolean;
  now: number;
}) {
  const canary = live && live.status === "rolling" ? live.weight : 0;
  const steps = live?.plan?.steps ?? [];
  return (
    <div className="con-dots relative flex h-full min-h-[300px] flex-col justify-center gap-3 overflow-hidden rounded-lg border border-con-line p-5 sm:p-6">
      <div className="flex items-center justify-between text-[12px] text-con-fg3">
        <span>
          {environment} · {target}
          {cluster ? ` · ${cluster}` : ""}
        </span>
        <span>{live ? "Rollout in progress" : "No rollout in progress"}</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Node
          label="Stable"
          tone="idle"
          weight={100 - canary}
          image={stable?.image ?? "no promoted release yet"}
          foot={stable ? `promoted ${ago(stable.updated_at, now)}${stable.ref ? ` · ${stable.ref}` : ""}` : "first release becomes stable once promoted"}
          href={stable ? `/app/deployments/${stable.id}` : undefined}
        />
        <Node
          label="Canary"
          tone={live ? "info" : "idle"}
          weight={canary}
          image={live?.image ?? "none"}
          foot={live ? `risk ${live.risk?.score ?? 0} · started ${ago(live.created_at, now)}` : "the next release starts here with a small share of traffic"}
          href={live ? `/app/deployments/${live.id}` : undefined}
          muted={!live}
        />
      </div>

      <div
        className="rounded-lg border border-con-line bg-con-panel px-4 py-3"
        role="img"
        aria-label={`Traffic split: stable ${100 - canary}%, canary ${canary}%`}
      >
        <div className="flex justify-between text-[12px] text-con-fg2">
          <span>stable {100 - canary}%</span>
          <span className={canary ? "text-con-info" : "text-con-fg3"}>canary {canary}%</span>
        </div>
        <div className="mt-1.5 flex h-2 gap-[2px] overflow-hidden rounded-full bg-con-row">
          <span className="con-grow-x con-ease h-full rounded-l-full bg-con-fg3" style={{ width: `${100 - canary}%` }} />
          {canary > 0 && <span className="con-ease h-full rounded-r-full bg-con-info" style={{ width: `${canary}%` }} />}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12px] text-con-fg3">
          {live && steps.length ? (
            <span className="flex items-center gap-2">
              <StagePips states={states} weights={steps.map((s) => s.weight)} />
              plan {steps.map((s) => `${s.weight}%`).join(" → ")}
            </span>
          ) : (
            <span>
              {autoRollback ? "A failed verdict sends all traffic back to stable." : "Shadow mode: failed verdicts are logged, traffic is not moved back."}
            </span>
          )}
          <span className="flex flex-wrap gap-x-3 font-mono tabular-nums">
            {metrics.slice(0, 2).map((m) => (
              <span key={m.metric}>
                {m.metric} {m.metric.includes("latency") ? `${Math.round(m.canary)}ms` : m.canary.toFixed(2)}
              </span>
            ))}
            {verdict !== null && <span className={verdict ? "text-con-fg2" : "text-con-bad"}>last verdict {verdict ? "pass" : "fail"}</span>}
          </span>
        </div>
      </div>
    </div>
  );
}

function Node({
  label,
  tone,
  weight,
  image,
  foot,
  href,
  muted,
}: {
  label: string;
  tone: "idle" | "info";
  weight: number;
  image: string;
  foot: string;
  href?: string;
  muted?: boolean;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[13px] font-medium">
          <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", toneBg[tone])} />
          {label}
        </span>
        <span className={cn("font-mono text-[18px] font-semibold tabular-nums tracking-[-0.02em]", muted && "text-con-fg3")}>{weight}%</span>
      </div>
      <div className={cn("mt-2 truncate font-mono text-[12px]", muted ? "text-con-fg3" : "text-con-fg2")} title={image}>
        {image}
      </div>
      <div className="mt-1 truncate text-[12px] text-con-fg3">{foot}</div>
    </>
  );
  const cls = "block rounded-lg border border-con-line bg-con-panel px-4 py-3";
  return href ? (
    <Link href={href} className={cn(cls, "con-lift hover:border-con-line-hover")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/* ------------------------------------ Timeline ----------------------------------- */

export function ServiceTimeline({ deps, now, name }: { deps: Deployment[]; now: number; name: string }) {
  return (
    <Card
      title="Release timeline"
      description="Newest first. Each dot is one release and how it ended."
      aside={
        <Link href={`/app/deployments?service=${encodeURIComponent(name)}`} className="text-[13px] text-con-fg2 hover:text-con-fg">
          All releases
        </Link>
      }
    >
      {deps.length === 0 ? (
        <p className="text-[13px] text-con-fg3">No releases yet.</p>
      ) : (
        <ol className="con-stagger relative">
          {deps.map((d, i) => (
            <li key={d.id} className="relative flex gap-3 pb-3 last:pb-0">
              {i < deps.length - 1 && <span aria-hidden className="absolute left-[3px] top-3 h-full w-px bg-con-row" />}
              <span aria-hidden className={cn("relative mt-1.5 h-[7px] w-[7px] shrink-0 rounded-full ring-2 ring-con-panel", toneBg[statusTone(d.status)])} />
              <Link
                href={`/app/deployments/${d.id}`}
                className="con-ease -mx-2 -my-1 flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-1 hover:bg-con-hover"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px]">
                    <span className="font-mono text-con-fg">{d.ref || d.id.slice(0, 8)}</span>
                    <span className="text-con-fg3"> · {statusLabel[d.status] ?? d.status}</span>
                  </span>
                  <span className="block truncate text-[12px] text-con-fg3">
                    {d.environment ?? "production"}
                    {d.reason ? ` · ${d.reason}` : ""}
                  </span>
                </span>
                <RiskValue score={d.risk?.score ?? 0} className="hidden sm:inline-flex" />
                <span className="w-14 shrink-0 text-right text-[12px] text-con-fg3">{ago(d.created_at, now)}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

/* ----------------------------------- Risk trend ---------------------------------- */

export function ServiceRiskTrend({ deps }: { deps: Deployment[] }) {
  // Oldest first, last 20 releases.
  const xs = [...deps].slice(0, 20).reverse();
  const scores = xs.map((d) => d.risk?.score ?? 0);
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const lastHalf = scores.slice(Math.floor(scores.length / 2));
  const firstHalf = scores.slice(0, Math.floor(scores.length / 2));
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const drift = firstHalf.length ? mean(lastHalf) - mean(firstHalf) : 0;
  const trend = Math.abs(drift) < 5 ? "steady" : drift > 0 ? "rising" : "falling";
  return (
    <Card
      title="Risk trend"
      description={
        xs.length >= 2
          ? `Risk score of the last ${xs.length} releases. Average ${Math.round(avg)}, ${trend}${trend === "steady" ? "" : ` by about ${Math.round(Math.abs(drift))} points`}.`
          : "Needs at least two releases to show a trend."
      }
    >
      {xs.length >= 2 ? (
        <LineChart
          height={150}
          series={[{ name: "risk", values: scores, color: COLORS.neutralLight, area: true }]}
          threshold={{ value: 70, label: "high risk" }}
          yFormat={(v) => String(Math.round(v))}
          xLabels={[
            { pos: 0, label: dayLabel(xs[0].created_at) },
            { pos: 1, label: dayLabel(xs[xs.length - 1].created_at) },
          ]}
          title="Risk score per release, oldest to newest"
          legend={
            <>
              <LegendItem color={COLORS.neutralLight} label="Risk score (0 to 100)" />
              <span className="text-[12px] text-con-fg3">35+ medium, 70+ high: higher scores get slower, smaller rollouts.</span>
            </>
          }
        />
      ) : (
        <p className="text-[13px] text-con-fg3">Ship a couple of releases and the trend appears here.</p>
      )}
    </Card>
  );
}

/* ------------------------------------- Paths ------------------------------------- */

/**
 * The CLI maps a changed file to a service when the file's path starts with one of the
 * service's paths (a plain prefix match, see ServicesForPath in the CLI).
 */
export function ServicePaths({ paths, critical, name }: { paths: string[]; critical: boolean; name: string }) {
  return (
    <Card
      title="How files map to this service"
      description="When alror risk or alror deploy looks at a change, every changed file whose path starts with one of these prefixes counts as touching this service."
    >
      {paths.length === 0 ? (
        <div className="flex items-start gap-2 text-[13px] text-con-fg2">
          <TriangleAlert size={15} className="mt-0.5 shrink-0 text-con-warn" />
          <span>
            No paths yet, so no change is ever attributed to {name} and its risk is never raised by what changed. Edit the service to add one, such as services/
            {name}/.
          </span>
        </div>
      ) : (
        <ul className="con-stagger space-y-2">
          {paths.map((p) => {
            const glob = /[*?[\]]/.test(p);
            const folder = p.endsWith("/");
            return (
              <li key={p} className="flex items-start gap-3 rounded-md border border-con-line bg-con-bg px-3 py-2">
                <FolderTree size={14} className="mt-0.5 shrink-0 text-con-fg3" />
                <span className="min-w-0 flex-1">
                  <code className="break-all font-mono text-[12px] text-con-fg">{p}</code>
                  <span className={cn("block text-[12px]", glob ? "text-con-warn" : "text-con-fg3")}>
                    {glob
                      ? "Contains a wildcard character, which is matched literally: paths are prefixes, not globs. Use the folder instead, e.g. " +
                        (p.split(/[*?[]/)[0] || "services/") +
                        "."
                      : folder
                        ? `Matches every file inside ${p}, at any depth.`
                        : `Matches ${p} itself and any path that starts with it (for example ${p}/… or ${p}.ts). Add a trailing slash to match only the folder.`}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-[12px] text-con-fg3">
        {critical ? (
          <>
            <Pill className="mr-1.5 text-con-fg2">Critical</Pill>
            Changes touching this service add 12 points to the risk score, so they get a slower plan.
          </>
        ) : (
          "Not marked critical. Marking it critical adds 12 points to the risk score of any change that touches it."
        )}
      </p>
    </Card>
  );
}
