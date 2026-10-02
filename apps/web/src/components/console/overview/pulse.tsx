// Hero: releases over the selected range by outcome, and the four delivery-health numbers.

import Link from "next/link";
import { COLORS, Sparkline, StackedBars } from "@/components/console/charts";
import { CountUp } from "@/components/console/count-up";
import { Delta } from "@/components/console/primitives";
import { durationParts } from "@/lib/console/insights";
import { dayLabel, hm, weekdayLabel } from "@/lib/console/format";
import { delta, HOUR, RANGE_SPEC, type Kpi, type OverviewRange, type PulseBucket } from "@/lib/console/overview";
import { cn } from "@/lib/site";
import { InfoTip, PAD_X, Panel } from "./ui";

export const OUTCOME_COLORS = { promoted: "#a3a3a3", bad: COLORS.bad, inFlight: COLORS.info };

function bucketLabels(b: PulseBucket, range: OverviewRange): { label: string; header: string } {
  const iso = new Date(b.start).toISOString();
  if (range === "24h") {
    const end = new Date(b.start + HOUR).toISOString();
    return { label: hm(iso), header: `${weekdayLabel(b.start)}, ${hm(iso)} to ${hm(end)} UTC` };
  }
  if (range === "7d") {
    const end = new Date(b.start + 6 * HOUR).toISOString();
    return { label: weekdayLabel(b.start).split(" ")[0], header: `${weekdayLabel(b.start)}, ${hm(iso)} to ${hm(end)} UTC` };
  }
  return { label: dayLabel(b.start), header: weekdayLabel(b.start) };
}

export function ReleasePulse({ buckets, range, total }: { buckets: PulseBucket[]; range: OverviewRange; total: number }) {
  const promoted = buckets.reduce((s, b) => s + b.promoted, 0);
  const bad = buckets.reduce((s, b) => s + b.bad, 0);
  const inFlight = buckets.reduce((s, b) => s + b.inFlight, 0);
  const xEvery = range === "24h" ? 4 : range === "7d" ? 4 : 5;
  return (
    <Panel
      widget="pulse"
      label="Release pulse"
      className="min-w-0 flex-1"
      title="Release pulse"
      tip={
        <>
          Every release started in the range, by what happened to it: promoted to all traffic, rolled back or failed, or still rolling. Hover a bar, or focus the chart and use the arrow keys, for its numbers.
        </>
      }
      aside={<span className="text-[12px] text-con-fg3">{RANGE_SPEC[range].label}</span>}
    >
      <div className="mb-4 flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <div className="text-[32px] font-semibold leading-none tracking-[-0.03em] text-con-fg">
            <CountUp value={total} />
          </div>
          <div className="mt-1.5 text-[12px] text-con-fg3">releases started</div>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-2 pb-0.5 text-[12px]">
          {[
            { k: "Promoted", v: promoted, c: OUTCOME_COLORS.promoted, href: "/app/deployments?status=promoted" },
            { k: "Rolled back or failed", v: bad, c: OUTCOME_COLORS.bad, href: "/app/deployments?status=rolled_back" },
            { k: "In progress", v: inFlight, c: OUTCOME_COLORS.inFlight, href: "/app/deployments?status=rolling" },
          ].map((x) => (
            <div key={x.k}>
              <dt className="flex items-center gap-1.5 text-con-fg3">
                <span aria-hidden className="h-2 w-2 rounded-[2px]" style={{ background: x.c }} />
                {x.k}
              </dt>
              <dd className="mt-0.5">
                <Link href={x.href} className="font-mono text-[15px] tabular-nums text-con-fg hover:underline hover:underline-offset-4">
                  {x.v}
                </Link>
                {total > 0 && <span className="ml-1.5 font-mono text-[11px] tabular-nums text-con-fg3">{Math.round((x.v / total) * 100)}%</span>}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <StackedBars
        height={228}
        xEvery={xEvery}
        title={`Releases per ${range === "24h" ? "hour" : range === "7d" ? "6 hours" : "day"}, ${RANGE_SPEC[range].label.toLowerCase()}`}
        emptyLabel="No releases in this range"
        data={buckets.map((b) => {
          const l = bucketLabels(b, range);
          return {
            label: l.label,
            header: l.header,
            title: `${l.header}: ${b.deps.length} release${b.deps.length === 1 ? "" : "s"}`,
            segments: [
              { name: "Promoted", value: b.promoted, color: OUTCOME_COLORS.promoted },
              { name: "Rolled back or failed", value: b.bad, color: OUTCOME_COLORS.bad },
              { name: "In progress", value: b.inFlight, color: OUTCOME_COLORS.inFlight },
            ],
          };
        })}
      />
    </Panel>
  );
}

/* ------------------------------ Delivery health ------------------------------ */

const KPI_META: Record<Kpi["key"], { label: string; tip: string; goodWhen: "up" | "down"; href: string }> = {
  frequency: {
    label: "Deploy frequency",
    tip: "Releases started per day in the range, across every service in scope. Higher means smaller, more frequent changes.",
    goodWhen: "up",
    href: "/app/insights",
  },
  cfr: {
    label: "Change failure rate",
    tip: "Of the releases that finished, the share that rolled back or failed. Lower is better.",
    goodWhen: "down",
    href: "/app/insights",
  },
  restore: {
    label: "Time to restore",
    tip: "Median time from the start of a release that went wrong to its rollback or failure: how quickly traffic was back on the stable version.",
    goodWhen: "down",
    href: "/app/insights",
  },
  rollbacks: {
    label: "Failed or rolled back",
    tip: "Releases in the range that were rolled back (automatically or by hand) or failed.",
    goodWhen: "down",
    href: "/app/deployments?status=rolled_back",
  },
};

function KpiValue({ k }: { k: Kpi }) {
  if (k.value === null) return <span className="text-con-fg3">n/a</span>;
  if (k.key === "frequency") return <CountUp value={k.value} decimals={k.value < 10 ? 1 : 0} suffix="/day" />;
  if (k.key === "cfr") return <CountUp value={k.value * 100} decimals={1} suffix="%" />;
  if (k.key === "restore") {
    const p = durationParts(k.value);
    return p ? <CountUp value={p.value} decimals={p.decimals} suffix={p.suffix} /> : <span className="text-con-fg3">n/a</span>;
  }
  return <CountUp value={k.value} />;
}

export function DeliveryHealth({ kpis, range }: { kpis: Kpi[]; range: OverviewRange }) {
  return (
    <section
      data-widget="health"
      aria-label="Delivery health"
      className="grid min-w-0 grid-cols-1 overflow-hidden rounded-lg border border-con-line bg-con-line sm:grid-cols-2 xl:w-[340px] xl:shrink-0 xl:grid-cols-1 xl:grid-rows-4"
      style={{ gap: 1 }}
    >
      {kpis.map((k, i) => {
        const m = KPI_META[k.key];
        const d = delta(k.value, k.prev);
        const bad = k.key === "rollbacks" ? (k.value ?? 0) > 0 : k.key === "cfr" ? (k.value ?? 0) > 0.15 : false;
        return (
          <div key={k.key} className={cn("con-fade-up relative flex min-w-0 flex-col justify-center bg-con-panel py-3.5 group-data-[density=compact]/ov:py-2.5", PAD_X)} style={{ animationDelay: `${i * 50}ms` }}>
            <div className="flex items-center gap-1 text-[12px] text-con-fg2">
              <Link href={m.href} className="hover:text-con-fg">
                {m.label}
              </Link>
              <InfoTip label={m.label} align={i % 2 && i < 2 ? "end" : "start"}>
                {m.tip}
              </InfoTip>
            </div>
            <div className="mt-1 flex items-end justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[24px] font-semibold leading-none tracking-[-0.03em] text-con-fg">
                  <KpiValue k={k} />
                </div>
                <div className="mt-1.5 whitespace-nowrap [&_span]:text-[12px]">
                  <Delta value={d} goodWhen={m.goodWhen} suffix={RANGE_SPEC[range].prev} />
                </div>
              </div>
              <Sparkline
                values={k.spark}
                className="h-9 w-[104px] shrink-0"
                color={bad ? COLORS.bad : COLORS.neutralLight}
                dot={bad ? COLORS.bad : COLORS.fg}
                label={`${m.label} trend over the range`}
              />
            </div>
          </div>
        );
      })}
    </section>
  );
}
