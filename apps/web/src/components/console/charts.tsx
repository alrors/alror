// Console charts. These wrappers are server-safe (no hooks): they format every
// label up front and hand plain data to the interactive client plots in
// ./charts/plots.tsx, so callers can keep passing format functions from Server
// Components. Small inline charts (sparklines, gauge, share bars) are pure SVG/HTML.

import Link from "next/link";
import { cn } from "@/lib/site";
import { BarPlot, DotsPlot, LinePlot, type LegendEntry } from "./charts/plots";
import { areaPath, hashId, linePath, makeTicks, niceScale } from "./charts/scale";

export { niceScale };

export const COLORS = {
  good: "#35e08f",
  bad: "#f2555a",
  warn: "#f5a524",
  info: "#3b82f6",
  neutral: "#525252",
  neutralLight: "#a1a1a1",
  fg: "#ededed",
  grid: "#242424",
  axis: "#3a3a3a",
};

/* ---------------------------------- Sparkline ---------------------------------- */

/** Smooth trend line with a soft fill. Stretches to its box; the stroke stays 1.5px. */
export function Sparkline({
  values,
  color = COLORS.neutral,
  dot = COLORS.fg,
  className,
  label,
  area = true,
}: {
  values: number[];
  color?: string;
  /** Colour of the highlighted last point. */
  dot?: string;
  className?: string;
  label?: string;
  /** Soft gradient under the line (default on). */
  area?: boolean;
}) {
  const clean = values.map((v) => (Number.isFinite(v) ? v : 0));
  if (clean.length < 2) {
    return (
      <div className={cn("relative flex h-9 w-full items-center", className)} role="img" aria-label={label ?? "Not enough data for a trend"}>
        <span className="h-px w-full bg-con-row" />
      </div>
    );
  }
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = max - min;
  const n = clean.length;
  const X = (i: number) => (i / (n - 1)) * 100;
  // Flat series sit in the middle instead of on the floor.
  const Y = (v: number) => (span ? 27 - ((v - min) / span) * 24 : 15);
  const line = linePath(clean, X, Y);
  const id = `spk-${hashId(`${color}|${clean.join(",")}`)}`;
  const lastY = Y(clean[n - 1]);
  return (
    <div className={cn("relative h-9 w-full", className)} role="img" aria-label={label} title={label}>
      <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="con-fade absolute inset-0 h-full w-full overflow-visible" aria-hidden>
        {area && (
          <>
            <defs>
              <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.28} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <path d={areaPath(clean, X, Y, 30)} fill={`url(#${id})`} />
          </>
        )}
        <path d={line} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <span
        aria-hidden
        className="absolute h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-con-panel"
        style={{ left: "100%", top: `${(lastY / 30) * 100}%`, background: dot }}
      />
    </div>
  );
}

/* ---------------------------------- Legend ---------------------------------- */

export function LegendItem({ color, label, dashed, value }: { color: string; label: string; dashed?: boolean; value?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-[12px] text-con-fg2">
      {dashed ? (
        <svg width="16" height="4" aria-hidden>
          <line x1="0" x2="16" y1="2" y2="2" stroke={color} strokeWidth="2" strokeDasharray="4 3" />
        </svg>
      ) : (
        <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} />
      )}
      {label}
      {value !== undefined && <span className="font-mono tabular-nums text-con-fg">{value}</span>}
    </span>
  );
}

/* -------------------------------- Stacked bars -------------------------------- */

export type BarDatum = {
  label: string;
  segments: { value: number; color: string; name: string }[];
  /** Accessible summary of the bar. */
  title?: string;
  /** Tooltip heading (e.g. the full date); defaults to `label`. */
  header?: string;
};

export function StackedBars({
  data,
  height = 220,
  xEvery,
  legend,
  yFormat = (v) => String(Math.round(v)),
  tooltipFormat,
  minMax = 4,
  toggleLegend,
  title,
  emptyLabel,
}: {
  data: BarDatum[];
  height?: number;
  xEvery?: number;
  legend?: React.ReactNode;
  yFormat?: (v: number) => string;
  /** Formats values in the hover tooltip; defaults to `yFormat`. */
  tooltipFormat?: (v: number) => string;
  minMax?: number;
  /** Render a legend from the segment names whose items show and hide segments. */
  toggleLegend?: boolean;
  title?: string;
  emptyLabel?: string;
}) {
  const totals = data.map((d) => d.segments.reduce((s, x) => s + x.value, 0));
  const { max, step } = niceScale(Math.max(minMax, ...totals));
  const n = data.length;
  const every = xEvery ?? Math.max(1, Math.ceil(n / 8));
  const fmt = tooltipFormat ?? yFormat;
  const legendItems: LegendEntry[] | undefined = toggleLegend
    ? [...new Map(data.flatMap((d) => d.segments).map((s) => [s.name, { name: s.name, label: s.name, color: s.color }])).values()]
    : undefined;
  return (
    <BarPlot
      height={height}
      yMax={max}
      ticks={makeTicks(max, step, yFormat)}
      legend={legend}
      legendItems={legendItems}
      title={title}
      emptyLabel={emptyLabel}
      xLabels={data
        .map((d, i) => ({ pos: (i + 0.5) / n, label: d.label, i }))
        .filter((l) => (n - 1 - l.i) % every === 0)
        .map(({ pos, label }) => ({ pos, label }))}
      data={data.map((d, i) => ({
        label: d.label,
        header: d.header,
        title: d.title ?? `${d.label}: ${totals[i]}`,
        totalLabel: fmt(totals[i]),
        segments: d.segments.map((s) => ({ ...s, valueLabel: fmt(s.value) })),
      }))}
    />
  );
}

/* --------------------------------- Line chart --------------------------------- */

export type Series = {
  name: string;
  values: (number | null)[];
  color: string;
  dashed?: boolean;
  /** Soft gradient fill under the line. */
  area?: boolean;
  /** Display name for legends and tooltips; defaults to `name`. */
  label?: string;
};

export function LineChart({
  series,
  xLabels,
  height = 200,
  yFormat = (v) => String(v),
  threshold,
  yMin = 0,
  legend,
  title,
  pointLabels,
  tooltipFormat,
  tooltipNote,
  toggleLegend,
  emptyLabel,
}: {
  series: Series[];
  xLabels: { pos: number; label: string }[];
  height?: number;
  yFormat?: (v: number) => string;
  threshold?: { value: number; label: string };
  yMin?: number;
  legend?: React.ReactNode;
  title?: string;
  /** Tooltip heading per point, e.g. the date. */
  pointLabels?: string[];
  /** Formats values in the hover tooltip; defaults to `yFormat`. */
  tooltipFormat?: (v: number) => string;
  /** Small print under the tooltip values, e.g. "7-day rolling". */
  tooltipNote?: string;
  /** Render a legend from the series whose items show and hide series. */
  toggleLegend?: boolean;
  emptyLabel?: string;
}) {
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null && Number.isFinite(v)));
  const top = Math.max(...all, threshold?.value ?? 0, 0) * 1.08;
  const { max, step } = niceScale(top - yMin);
  const fmt = tooltipFormat ?? yFormat;
  return (
    <LinePlot
      height={height}
      yMin={yMin}
      yMax={max}
      ticks={makeTicks(max, step, yFormat, yMin)}
      xLabels={xLabels}
      legend={legend}
      title={title}
      threshold={threshold}
      pointLabels={pointLabels}
      tooltipNote={tooltipNote}
      toggle={toggleLegend}
      emptyLabel={emptyLabel}
      series={series.map((s) => ({ name: s.name, label: s.label ?? s.name, values: s.values, color: s.color, dashed: s.dashed, area: s.area }))}
      valueLabels={series.map((s) => s.values.map((v) => (v === null || !Number.isFinite(v) ? "" : fmt(v))))}
    />
  );
}

/* -------------------------------- Scatter plot -------------------------------- */

/** Points over time; hover a point for its details, click it when it has an `href`. */
export function DotPlot({
  points,
  xLabels,
  height = 200,
  yFormat,
  guide,
  legend,
  title,
  emptyLabel,
}: {
  points: { x: number; y: number; color: string; title: string; href?: string }[]; // x in 0..1
  xLabels: { pos: number; label: string }[];
  height?: number;
  yFormat: (v: number) => string;
  guide?: { value: number; label: string };
  legend?: React.ReactNode;
  title?: string;
  emptyLabel?: string;
}) {
  const { max, step } = niceScale(Math.max(1, ...points.map((p) => p.y), guide?.value ?? 0) * 1.1);
  return (
    <DotsPlot
      height={height}
      yMax={max}
      ticks={makeTicks(max, step, yFormat)}
      xLabels={xLabels}
      points={points}
      guide={guide}
      legend={legend}
      title={title}
      emptyLabel={emptyLabel}
    />
  );
}

/* ---------------------------------- Gauge ---------------------------------- */

export function RiskGauge({ score, color }: { score: number; color: string }) {
  const s = Math.max(0, Math.min(100, score));
  // Semicircle from 180deg to 0deg, radius 80, centre (100, 100).
  const arc = (from: number, to: number) => {
    const a0 = Math.PI * (1 - from / 100);
    const a1 = Math.PI * (1 - to / 100);
    const p = (a: number) => `${(100 + 80 * Math.cos(a)).toFixed(2)},${(100 - 80 * Math.sin(a)).toFixed(2)}`;
    return `M${p(a0)} A80,80 0 0 1 ${p(a1)}`;
  };
  return (
    <svg viewBox="0 0 200 112" className="w-full max-w-[240px]" role="img" aria-label={`Risk ${score} of 100`}>
      {/* Zones: low < 35, medium < 70, high */}
      <path d={arc(0, 34.4)} stroke="#262626" strokeWidth={14} fill="none" />
      <path d={arc(35.6, 69.4)} stroke="#262626" strokeWidth={14} fill="none" />
      <path d={arc(70.6, 100)} stroke="#262626" strokeWidth={14} fill="none" />
      {s > 0 && <path d={arc(0, s)} stroke={color} strokeWidth={14} fill="none" pathLength={1} className="con-draw" />}
      {[35, 70].map((t) => {
        const a = Math.PI * (1 - t / 100);
        return (
          <line
            key={t}
            x1={100 + 66 * Math.cos(a)}
            y1={100 - 66 * Math.sin(a)}
            x2={100 + 94 * Math.cos(a)}
            y2={100 - 94 * Math.sin(a)}
            stroke="#171717"
            strokeWidth={2.5}
          />
        );
      })}
    </svg>
  );
}

/* ------------------------------ Horizontal share ------------------------------ */

/** A 100% bar split into parts, with a 2px gap between parts. */
export function ShareBar({ parts, className }: { parts: { value: number; color: string; name: string }[]; className?: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const shown = parts.filter((p) => p.value > 0);
  return (
    <div className={cn("con-grow-x flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full", shown.length === 0 && "bg-con-row", className)}>
      {shown.map((p) => (
        <span
          key={p.name}
          title={`${p.name}: ${p.value} (${Math.round((p.value / total) * 100)}%)`}
          className="con-ease h-full first:rounded-l-full last:rounded-r-full"
          style={{ width: `${(p.value / total) * 100}%`, background: p.color }}
        />
      ))}
    </div>
  );
}

/* --------------------------------- Bar list --------------------------------- */

export type BarListItem = {
  key?: string;
  label: React.ReactNode;
  /** Bar length, relative to the largest value (or `max`). */
  value: number;
  /** Text shown at the end of the row; defaults to the value. */
  display?: React.ReactNode;
  /** Secondary text under the label. */
  sub?: React.ReactNode;
  color?: string;
  href?: string;
  title?: string;
};

/** Ranked horizontal bars: one row per item, label, bar and value. */
export function BarList({ items, max, className, emptyLabel = "Nothing to show" }: { items: BarListItem[]; max?: number; className?: string; emptyLabel?: string }) {
  if (items.length === 0) return <p className="py-6 text-center text-[13px] text-con-fg3">{emptyLabel}</p>;
  const top = max ?? Math.max(...items.map((i) => i.value), 0);
  return (
    <ul className={cn("space-y-3", className)}>
      {items.map((it, i) => {
        const w = top > 0 ? Math.max(0, Math.min(1, it.value / top)) : 0;
        const label = it.href ? (
          <Link href={it.href} className="truncate text-con-fg hover:underline hover:underline-offset-4">
            {it.label}
          </Link>
        ) : (
          <span className="truncate text-con-fg">{it.label}</span>
        );
        return (
          <li key={it.key ?? i} title={it.title}>
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="flex min-w-0 items-baseline gap-2">
                {label}
                {it.sub && <span className="shrink-0 text-[12px] text-con-fg3">{it.sub}</span>}
              </span>
              <span className="shrink-0 font-mono text-[12px] tabular-nums text-con-fg2">{it.display ?? it.value}</span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-con-row">
              {w > 0 && (
                <div
                  className="con-grow-x con-ease h-full rounded-full"
                  style={{ width: `${w * 100}%`, background: it.color ?? COLORS.neutralLight, animationDelay: `${Math.min(i * 40, 400)}ms` }}
                />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------------------------- Donut ---------------------------------- */

/**
 * Ring split into parts with a small gap between them; `center` sits in the hole.
 * Each arc draws in once on mount (static under reduced motion).
 */
export function Donut({
  parts,
  size = 112,
  thickness = 12,
  label,
  center,
  className,
}: {
  parts: { name: string; value: number; color: string }[];
  size?: number;
  thickness?: number;
  /** Accessible summary. */
  label?: string;
  center?: React.ReactNode;
  className?: string;
}) {
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0);
  const r = 50 - thickness / 2;
  const shown = parts.filter((p) => p.value > 0);
  const gap = shown.length > 1 ? 1.2 : 0; // in % of the circumference
  let acc = 0;
  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" stroke="#242424" strokeWidth={thickness} />
        {total > 0 &&
          shown.map((p) => {
            const len = (p.value / total) * 100;
            const start = acc;
            acc += len;
            const visible = Math.max(0.01, len - gap);
            return (
              <circle
                key={p.name}
                cx="50"
                cy="50"
                r={r}
                fill="none"
                stroke={p.color}
                strokeWidth={thickness}
                pathLength={100}
                strokeDasharray={`${visible} ${100 - visible}`}
                strokeDashoffset={-start - gap / 2}
                className="con-fade"
                style={{ animationDelay: `${Math.round(start * 4)}ms` }}
              >
                <title>{`${p.name}: ${p.value} (${Math.round((p.value / total) * 100)}%)`}</title>
              </circle>
            );
          })}
      </svg>
      {center && <div className="absolute inset-0 grid place-items-center text-center">{center}</div>}
    </div>
  );
}
