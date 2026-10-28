import type { Metadata } from "next";
import Link from "next/link";
import { BarList, COLORS, DotPlot, LegendItem, LineChart, ShareBar, Sparkline, StackedBars } from "@/components/console/charts";
import { CountUp } from "@/components/console/count-up";
import { FilterForm } from "@/components/console/filter-form";
import { hrefWith, Pagination } from "@/components/console/pagination";
import { buttonClass, Card, Delta, EmptyState, PageHeader } from "@/components/console/primitives";
import { SegmentedSelector, Selector } from "@/components/console/selector";
import {
  anchorNow,
  carry,
  change,
  daily,
  DAY,
  feed,
  groupBy,
  isBad,
  median,
  outcome,
  periods,
  restoreMs,
  riskHistogram,
  rolling,
  summarize,
} from "@/lib/console/analytics";
import { eventsFor, listDeployments } from "@/lib/console/data";
import { environments, selectedEnvironment } from "@/lib/console/environments";
import { ago, dayLabel, pct, span, weekdayLabel } from "@/lib/console/format";
import { bucket, cfrOrNull, durationParts, parseInsightsRange, RANGES, rollbacksByService, rollingWindow } from "@/lib/console/insights";
import { paginate, parsePage } from "@/lib/console/paginate";
import type { Deployment, Level } from "@/lib/console/types";
import { cn } from "@/lib/site";

export const metadata: Metadata = { title: "Insights" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function InsightsPage({ searchParams }: PageProps<"/app/insights">) {
  const sp = await searchParams;
  const range = parseInsightsRange(sp.range);
  const [all, envs, env] = await Promise.all([listDeployments(), environments(), selectedEnvironment(sp.environment)]);
  const now = anchorNow(all);

  const inEnv = env ? all.filter((d) => (d.environment ?? "production") === env) : all;
  const services = [...new Set(inEnv.map((d) => d.service))].sort();
  const service = services.includes(one(sp.service)) ? one(sp.service) : "";
  const deps = service ? inEnv.filter((d) => d.service === service) : inEnv;

  // Explicit ?environment= (including "all") overrides the top bar's switcher; keep it in links.
  const envParam = typeof sp.environment === "string" ? sp.environment : undefined;
  const params = { range: range === 30 ? undefined : String(range), service: service || undefined, environment: envParam };
  const filtered = Boolean(service || envParam);
  const scopeLabel = [service || `${new Set(deps.map((d) => d.service)).size} services`, env ?? "all environments"].join(" · ");

  const header = (
    <>
      <PageHeader
        title="Insights"
        description={`How fast and how safely you ship (the four DORA metrics), for ${scopeLabel}.`}
        actions={
          <SegmentedSelector
            aria-label="Range"
            value={String(range)}
            items={RANGES.map((r) => ({ label: `${r}d`, value: String(r), title: `Last ${r} days`, href: hrefWith("/app/insights", params, { range: r === 30 ? undefined : String(r) }) }))}
          />
        }
      />
      <FilterForm action="/app/insights" className="flex flex-wrap items-center gap-2">
        {range !== 30 && <input type="hidden" name="range" value={range} />}
        <Selector
          name="environment"
          aria-label="Environment"
          submitOnChange
          className="w-44"
          defaultValue={env ?? "all"}
          options={[{ value: "all", label: "All environments" }, ...envs.map((e) => ({ value: e.name, label: e.name, meta: e.protected ? "protected" : undefined }))]}
        />
        <Selector
          name="service"
          aria-label="Service"
          submitOnChange
          className="w-48"
          minWidth={240}
          defaultValue={service}
          searchPlaceholder="Find a service…"
          options={[{ value: "", label: "All services" }, ...services.map((s) => ({ value: s, label: s, meta: inEnv.filter((d) => d.service === s).length }))]}
        />
        <noscript>
          <button type="submit" className={buttonClass.secondary}>
            Apply
          </button>
        </noscript>
        {filtered && (
          <Link href={hrefWith("/app/insights", { range: params.range }, {})} className="px-2 text-[13px] text-con-fg2 hover:text-con-fg">
            Clear filters
          </Link>
        )}
      </FilterForm>
    </>
  );

  if (deps.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <Card>
          {all.length === 0 ? (
            <EmptyState title="No deployments yet">Run alror deploy to start collecting history. Charts fill in as releases finish.</EmptyState>
          ) : (
            <EmptyState title="No releases match these filters">Try another environment or service, or clear the filters.</EmptyState>
          )}
        </Card>
      </div>
    );
  }

  const { start, current, previous } = periods(deps, range, now);
  const cur = summarize(current);
  // Deltas compare equal windows. When there is no history before the range, compare
  // the range's two halves instead and say so.
  const half = periods(deps, Math.floor(range / 2), now);
  const usePrev = previous.length > 0;
  const deltaNow = usePrev ? cur : summarize(half.current);
  const deltaPrev = summarize(usePrev ? previous : half.previous);
  const deltaLabel = usePrev ? `vs prior ${range}d` : `vs prior ${Math.floor(range / 2)}d`;

  const days = daily(current, start, range);
  const prevDays = daily(previous, start - range * DAY, range);
  const win = rollingWindow(range);
  const pointLabels = days.map((d) => weekdayLabel(d.day));
  const xEvery = range === 7 ? 1 : range === 30 ? 5 : 15;
  const xLabels = days
    .map((d, i) => ({ pos: i / (range - 1), label: dayLabel(d.day), i }))
    .filter((l) => (range - 1 - l.i) % xEvery === 0)
    .map(({ pos, label }) => ({ pos, label }));

  // KPI sparklines: daily values, rolling where a single day is too sparse to read.
  const sparks = {
    perDay: days.map((d) => d.deps.length),
    cfr: carry(rolling(days, win, (l) => summarize(l).cfr)),
    mttr: carry(rolling(days, win, (l) => summarize(l).mttrMs)),
    risk: carry(rolling(days, win, (l) => summarize(l).avgRisk)),
    ai: carry(rolling(days, win, (l) => summarize(l).aiShare)),
  };
  const mttr = durationParts(cur.mttrMs);
  const aiCount = current.filter((d) => d.risk?.ai_authored).length;

  const kpis: {
    label: string;
    help: string;
    value: React.ReactNode;
    delta: number | null;
    good: "up" | "down" | "neutral";
    spark: number[];
    foot: string;
  }[] = [
    {
      label: "Deploys per day",
      help: "DORA deployment frequency",
      value: <CountUp value={cur.total / range} decimals={1} />,
      delta: change(deltaNow.total, deltaPrev.total),
      good: "up",
      spark: sparks.perDay,
      foot: `${cur.total} releases in ${range} days`,
    },
    {
      label: "Change failure rate",
      help: "DORA: share of releases that rolled back or failed",
      value: <CountUp value={cur.cfr * 100} decimals={1} suffix="%" />,
      delta: change(deltaNow.cfr, deltaPrev.cfr),
      good: "down",
      spark: sparks.cfr,
      foot: `${cur.rolledBack + cur.failed} of ${cur.finished} finished`,
    },
    {
      label: "Time to restore",
      help: "DORA: median time from release start to rollback",
      value: mttr ? <CountUp value={mttr.value} decimals={mttr.decimals} suffix={mttr.suffix} /> : <span className="text-con-fg3">n/a</span>,
      delta: change(deltaNow.mttrMs, deltaPrev.mttrMs),
      good: "down",
      spark: sparks.mttr,
      foot: mttr ? "Median, release start to rollback" : "No rollbacks in this period",
    },
    {
      label: "Average risk",
      help: "Mean risk score assigned before each release",
      value: <CountUp value={cur.avgRisk} />,
      delta: change(deltaNow.avgRisk, deltaPrev.avgRisk),
      good: "down",
      spark: sparks.risk,
      foot: "Score out of 100",
    },
    {
      label: "AI-assisted share",
      help: "Releases whose change was authored with AI help",
      value: <CountUp value={cur.aiShare * 100} suffix="%" />,
      delta: change(deltaNow.aiShare, deltaPrev.aiShare),
      good: "neutral",
      spark: sparks.ai,
      foot: `${aiCount} AI-assisted releases`,
    },
  ];

  // Deployment frequency: daily bars, weekly for the 90-day view.
  const bucketSize = range === 90 ? 7 : 1;
  const freq = bucket(days, bucketSize);
  const busiest = freq.reduce((m, b) => (b.deps.length > m.deps.length ? b : m), freq[0]);
  const activeDays = days.filter((d) => d.deps.length > 0).length;

  // Change failure rate, rolling, against the previous period when there is one.
  const cfrSeries = rolling(days, win, (l) => cfrOrNull(l)).map((v) => (v === null ? null : v * 100));
  const cfrPrev = rolling(prevDays, win, (l) => cfrOrNull(l)).map((v) => (v === null ? null : v * 100));
  const hasPrevCfr = cfrPrev.some((v) => v !== null);
  const prevCfr = summarize(previous);

  // Time to restore, one dot per incident.
  const restorePoints = current
    .filter((d) => restoreMs(d) !== null)
    .map((d) => ({
      x: Math.min(1, Math.max(0, (Date.parse(d.created_at) - start) / (range * DAY))),
      y: restoreMs(d)! / 60000,
      color: d.status === "failed" ? COLORS.bad : d.reason?.startsWith("Regression") ? COLORS.neutralLight : COLORS.warn,
      title: `${d.service} ${d.ref ?? ""} · ${weekdayLabel(d.created_at)} · restored in ${span(restoreMs(d))}`,
      href: `/app/deployments/${d.id}`,
    }));
  const restoreMedian = median(restorePoints.map((p) => p.y));
  const slowest = restorePoints.reduce((m, p) => Math.max(m, p.y), 0);

  // Risk vs outcome.
  const levels: Level[] = ["low", "medium", "high"];
  const byLevel = levels.map((l) => outcome(l, current.filter((d) => d.risk?.level === l)));
  const lowO = byLevel[0];
  const highO = byLevel[2];

  // AI-assisted vs human.
  const isAi = (d: Deployment) => Boolean(d.risk?.ai_authored);
  const ai = outcome("AI-assisted", current.filter(isAi));
  const human = outcome("Human", current.filter((d) => !isAi(d)));
  const aiCfr = rolling(days, win, (l) => cfrOrNull(l.filter(isAi))).map((v) => (v === null ? null : v * 100));
  const humanCfr = rolling(days, win, (l) => cfrOrNull(l.filter((d) => !isAi(d)))).map((v) => (v === null ? null : v * 100));

  // Rollbacks by service.
  const perService = rollbacksByService(current);
  const worstService = perService.find((s) => s.bad > 0);

  // Service health heatmap: last N deploys per service.
  const N = 20;
  const byService = [...groupBy(deps, (d) => d.service).entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const rollbacks = current.filter((d) => isBad(d.status)).slice(0, 6);

  const feedEvents = await eventsFor(current.slice(0, 120).map((d) => d.id));
  const feedPage = paginate(feed(current, feedEvents, 200), parsePage(sp.feed), 10);

  const pctTip = (v: number) => `${v.toFixed(1)}%`;

  return (
    <div className="space-y-8">
      <div className="space-y-4">{header}</div>

      {/* KPI strip */}
      <div className="con-stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {kpis.map((k) => (
          <div key={k.label} className="flex flex-col rounded-lg border border-con-line bg-con-panel p-5">
            <div className="text-[13px] text-con-fg2" title={k.help}>
              {k.label}
            </div>
            <div className="mt-2 text-[28px] font-semibold leading-none tracking-[-0.02em]">{k.value}</div>
            <div className="mt-2">
              <Delta value={k.delta} goodWhen={k.good} suffix={deltaLabel} />
            </div>
            <Sparkline values={k.spark} className="mt-4 h-9" label={`${k.label} trend, last ${range} days`} />
            <div className="mt-2 text-[12px] text-con-fg3">{k.foot}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card
          title="Deployment frequency"
          description={bucketSize === 7 ? `Releases per week, last ${range} days` : `Releases per day, last ${range} days`}
        >
          <StackedBars
            height={220}
            xEvery={bucketSize === 7 ? 2 : xEvery}
            toggleLegend
            title={`Releases per ${bucketSize === 7 ? "week" : "day"}`}
            emptyLabel="No releases in this period"
            data={freq.map((b) => ({
              label: dayLabel(b.day),
              header: bucketSize === 7 ? `Week of ${dayLabel(b.day)}` : weekdayLabel(b.day),
              title: `${bucketSize === 7 ? `Week of ${dayLabel(b.day)}` : weekdayLabel(b.day)}: ${b.deps.length} releases`,
              segments: [
                { name: "Promoted", value: b.promoted, color: COLORS.neutral },
                { name: "In progress", value: b.other, color: COLORS.info },
                { name: "Rolled back or failed", value: b.bad, color: COLORS.bad },
              ],
            }))}
          />
          <Note>
            You shipped <b>{cur.total}</b> releases on <b>{activeDays}</b> of {range} days
            {busiest && busiest.deps.length > 0 && (
              <>
                , busiest {bucketSize === 7 ? "week starting" : "on"} {weekdayLabel(busiest.day)} with <b>{busiest.deps.length}</b>
              </>
            )}
            . Shipping often in small batches usually makes each release easier to verify and to undo. Red marks the part that rolled back or failed.
          </Note>
        </Card>

        <Card title="Change failure rate" description={`${win}-day rolling share of finished releases that rolled back or failed`}>
          <LineChart
            height={220}
            toggleLegend
            series={[
              { name: "cfr", label: `Last ${range} days`, values: cfrSeries, color: COLORS.neutralLight, area: true },
              ...(hasPrevCfr ? [{ name: "prev", label: `Previous ${range} days`, values: cfrPrev, color: "#737373", dashed: true }] : []),
            ]}
            threshold={{ value: 15, label: "15% guide" }}
            yFormat={(v) => `${Math.round(v)}%`}
            tooltipFormat={pctTip}
            tooltipNote={`${win}-day rolling window`}
            pointLabels={pointLabels}
            xLabels={xLabels}
            title="Change failure rate trend"
            emptyLabel="No finished releases yet"
          />
          <Note>
            <b>{cur.rolledBack + cur.failed}</b> of <b>{cur.finished}</b> finished releases rolled back or failed (<b>{pct(cur.cfr, 1)}</b>
            {usePrev && prevCfr.finished > 0 && <> against {pct(prevCfr.cfr, 1)} the period before</>}). This is the DORA change failure rate:
            lower is better, and many teams aim to stay under 15%. A rollback here usually means Alror caught a regression in the canary
            before it reached all users.
          </Note>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Time to restore" description="Minutes from release start to rollback, one dot per incident">
          <DotPlot
            height={220}
            points={restorePoints}
            xLabels={xLabels}
            yFormat={(v) => `${Math.round(v)}m`}
            title="Time to restore per incident"
            emptyLabel="No rollbacks in this period"
            guide={restoreMedian !== null ? { value: restoreMedian, label: `median ${span(restoreMedian * 60000)}` } : undefined}
            legend={
              <>
                <LegendItem color={COLORS.neutralLight} label="Auto rollback" />
                <LegendItem color={COLORS.warn} label="Manual rollback" />
                <LegendItem color={COLORS.bad} label="Failed" />
              </>
            }
          />
          <Note>
            {restoreMedian === null ? (
              <>Nothing needed restoring in this period. When a release goes wrong, this shows how long users were exposed before the previous version was back.</>
            ) : (
              <>
                Across <b>{restorePoints.length}</b> incidents the previous version was back in a median of <b>{span(restoreMedian * 60000)}</b>
                {restorePoints.length > 1 && <> (slowest {span(slowest * 60000)})</>}. This is DORA time to restore: shorter is better. Automatic
                rollbacks are usually the fastest; click a dot to open that release.
              </>
            )}
          </Note>
        </Card>

        <Card title="Risk vs outcome" description="Releases by risk score, with the share that rolled back">
          <StackedBars
            height={150}
            xEvery={1}
            toggleLegend
            title="Releases by risk score"
            emptyLabel="No releases in this period"
            data={riskHistogram(current).map((b) => ({
              label: `${b.from}`,
              header: `Risk ${b.from} to ${b.to}`,
              title: `Risk ${b.from} to ${b.to}: ${b.count} releases, ${b.bad} rolled back or failed`,
              segments: [
                { name: "Promoted", value: b.count - b.bad, color: COLORS.neutral },
                { name: "Rolled back or failed", value: b.bad, color: COLORS.bad },
              ],
            }))}
          />
          <div className="mt-5 border-t border-con-row pt-4">
            <div className="mb-3 text-[12px] font-medium uppercase text-con-fg3">Rollback rate by risk level</div>
            <BarList
              max={Math.max(0.0001, ...byLevel.map((o) => o.cfr))}
              items={byLevel.map((o) => ({
                key: o.label,
                label: <span className="capitalize">{o.label}</span>,
                href: `/app/deployments?risk=${o.label}`,
                sub: `${o.total} releases`,
                value: o.cfr,
                display: `${pct(o.cfr, 1)}`,
                color: COLORS.bad,
                title: `${o.bad} of ${o.total} ${o.label}-risk releases rolled back or failed`,
              }))}
            />
          </div>
          <Note>
            {highO.total > 0 && lowO.total > 0 ? (
              <>
                High-risk releases rolled back <b>{pct(highO.cfr, 0)}</b> of the time, low-risk ones <b>{pct(lowO.cfr, 0)}</b>.{" "}
                {highO.cfr > lowO.cfr
                  ? "The risk score is separating safe changes from risky ones, which is why risky releases get smaller, slower canaries."
                  : "Risky releases are not failing more often than safe ones right now, so the extra canary caution is paying off or the score needs tuning."}
              </>
            ) : (
              <>Each release gets a risk score before it ships. Higher scores get smaller, slower canaries; over time, high-risk releases should be the ones that roll back.</>
            )}
          </Note>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="AI-assisted vs human" description={`${win}-day rolling rollback rate, same risk scorer and verification for both`}>
          <LineChart
            height={180}
            toggleLegend
            series={[
              { name: "ai", label: "AI-assisted", values: aiCfr, color: COLORS.info },
              { name: "human", label: "Human", values: humanCfr, color: COLORS.neutralLight },
            ]}
            yFormat={(v) => `${Math.round(v)}%`}
            tooltipFormat={pctTip}
            tooltipNote={`${win}-day rolling window`}
            pointLabels={pointLabels}
            xLabels={xLabels}
            title="Rollback rate, AI-assisted vs human changes"
            emptyLabel="No finished releases yet"
          />
          <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-con-row pt-4">
            {[ai, human].map((o) => (
              <div key={o.label} className="min-w-0">
                <dt className="flex items-center gap-2 text-[13px] text-con-fg2">
                  <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: o === ai ? COLORS.info : COLORS.neutralLight }} />
                  {o.label}
                </dt>
                <dd className="mt-2 space-y-2">
                  <div className="flex items-baseline justify-between gap-2 text-[13px]">
                    <span className="text-con-fg3">Releases</span>
                    <span className="font-mono tabular-nums">{o.total}</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2 text-[13px]">
                    <span className="text-con-fg3">Avg risk</span>
                    <span className="font-mono tabular-nums">{o.avgRisk.toFixed(0)}</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2 text-[13px]">
                    <span className="text-con-fg3">Rolled back</span>
                    <span className="font-mono tabular-nums">{pct(o.cfr, 1)}</span>
                  </div>
                  <ShareBar parts={[{ name: "Promoted", value: o.promoted, color: COLORS.neutral }, { name: "Rolled back or failed", value: o.bad, color: COLORS.bad }]} />
                </dd>
              </div>
            ))}
          </dl>
          <Note>
            {ai.total === 0 ? (
              <>No AI-assisted releases in this period. When there are, this compares how often they roll back against human-written ones.</>
            ) : (
              <>
                <b>{pct(cur.aiShare)}</b> of releases were AI-assisted. They rolled back <b>{pct(ai.cfr, 1)}</b> of the time against{" "}
                <b>{pct(human.cfr, 1)}</b> for human changes. Both go through the same risk score and canary checks, so a gap here reflects the
                changes themselves.
              </>
            )}
          </Note>
        </Card>

        <Card title="Rollbacks by service" description={`Releases that rolled back or failed, last ${range} days`}>
          <BarList
            emptyLabel="No releases in this period"
            items={perService.slice(0, 8).map((s) => ({
              key: s.service,
              label: s.service,
              href: `/app/services/${encodeURIComponent(s.service)}`,
              sub: `${s.total} releases`,
              value: s.bad,
              display: s.bad ? `${s.bad} · ${pct(s.cfr, 0)}` : "0",
              color: COLORS.bad,
              title: `${s.bad} of ${s.finished} finished releases rolled back or failed`,
            }))}
          />
          <Note>
            {worstService ? (
              <>
                <b>{worstService.service}</b> had the most rollbacks ({worstService.bad} of {worstService.finished} finished). A service that keeps
                rolling back is a good place to look for flaky tests, missing checks or oversized changes.
              </>
            ) : (
              <>No service rolled back in this period. Every finished release was promoted.</>
            )}
          </Note>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card
          title="Service health"
          description={`Last ${N} releases per service, oldest to newest`}
          aside={
            <span className="hidden flex-wrap gap-4 sm:flex">
              <LegendItem color={COLORS.neutral} label="Promoted" />
              <LegendItem color={COLORS.info} label="Rolling" />
              <LegendItem color={COLORS.warn} label="Manual rollback" />
              <LegendItem color={COLORS.bad} label="Auto rollback or failed" />
            </span>
          }
        >
          <div className="space-y-2">
            {byService.map(([svc, list]) => {
              const lastN = list.slice(0, N).reverse();
              const s = summarize(list.slice(0, N));
              return (
                <div key={svc} className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)_56px] items-center gap-3">
                  <Link href={`/app/services/${encodeURIComponent(svc)}`} className="truncate text-[13px] text-con-fg2 hover:text-con-fg">
                    {svc}
                  </Link>
                  <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${N}, minmax(0, 1fr))` }}>
                    {Array.from({ length: N - lastN.length }, (_, i) => (
                      <span key={`e${i}`} className="aspect-square max-h-4 rounded-[3px] bg-con-hover" />
                    ))}
                    {lastN.map((d) => (
                      <Link
                        key={d.id}
                        href={`/app/deployments/${d.id}`}
                        title={`${d.ref ?? d.id} · ${d.status.replace("_", " ")} · risk ${d.risk?.score ?? 0} · ${dayLabel(d.created_at)}`}
                        className="aspect-square max-h-4 rounded-[3px] transition-opacity duration-150 hover:opacity-70"
                        style={{ background: cellColor(d) }}
                      />
                    ))}
                  </div>
                  <span className={cn("text-right font-mono text-[12px] tabular-nums", s.cfr > 0.15 ? "text-con-bad" : "text-con-fg3")}>{pct(s.cfr)}</span>
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="Latest rollbacks" description={`${cur.rolledBack + cur.failed} in the last ${range} days`} flush>
          {rollbacks.length === 0 ? (
            <EmptyState title="No rollbacks">Every release in this period was promoted.</EmptyState>
          ) : (
            <ul className="divide-y divide-con-row">
              {rollbacks.map((d) => (
                <li key={d.id}>
                  <Link href={`/app/deployments/${d.id}`} className="block px-5 py-3 transition-colors duration-150 hover:bg-con-hover">
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", d.status === "failed" ? "bg-con-bad" : d.reason?.startsWith("Regression") ? "bg-con-bad" : "bg-con-warn")} aria-hidden />
                        <span className="truncate text-[14px] font-medium">{d.service}</span>
                        <span className="font-mono text-[12px] text-con-fg2">{d.ref}</span>
                      </span>
                      <span className="shrink-0 text-[12px] text-con-fg3">{ago(d.updated_at, now)}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 font-mono text-[12px] text-con-fg2">{d.reason}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Activity" description={service ? `Latest events for ${service}` : "Latest events across all services"} flush>
        {feedPage.total === 0 ? (
          <EmptyState title="No activity" />
        ) : (
          <ul className="divide-y divide-con-row">
            {feedPage.items.map((f, i) => (
              <li key={i}>
                <Link href={`/app/deployments/${f.dep.id}`} className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-baseline gap-3 px-5 py-3 transition-colors duration-150 hover:bg-con-hover sm:grid-cols-[10px_170px_minmax(0,1fr)_auto]">
                  <span className={cn("h-1.5 w-1.5 rounded-full", feedDot(f.kind, f.pass))} aria-hidden />
                  <span className="hidden truncate text-[14px] font-medium sm:block">
                    {f.dep.service} <span className="font-mono text-[12px] font-normal text-con-fg3">{f.dep.ref}</span>
                  </span>
                  <span className="min-w-0 truncate text-[13px] text-con-fg2">
                    <span className="text-con-fg sm:hidden">{f.dep.service} · </span>
                    {f.message}
                  </span>
                  <span className="text-[12px] text-con-fg3">{ago(f.at, now)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Pagination meta={feedPage} noun="events" base="/app/insights" params={params} pageKey="feed" showPer={false} />
      </Card>
    </div>
  );
}

/** "What this means": a plain-English reading of the chart above it. */
function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-5 border-t border-con-row pt-3 text-[13px] leading-relaxed text-con-fg2 [&_b]:font-medium [&_b]:text-con-fg">
      <span className="mr-1.5 text-[11px] font-medium uppercase tracking-wide text-con-fg3">What this means</span>
      {children}
    </p>
  );
}

function cellColor(d: Deployment): string {
  if (d.status === "rolling" || d.status === "pending") return COLORS.info;
  if (d.status === "failed") return COLORS.bad;
  if (d.status === "rolled_back") return d.reason?.startsWith("Regression") ? COLORS.bad : COLORS.warn;
  return COLORS.neutral;
}

function feedDot(kind: string, pass?: boolean): string {
  if (kind === "verdict") return pass === false ? "bg-con-bad" : "bg-con-fg3";
  if (kind === "promoted") return "bg-con-good";
  if (kind === "rolled_back") return "bg-con-warn";
  if (kind === "error") return "bg-con-bad";
  return "bg-con-fg3";
}
