"use client";

// Interactive chart layers. Everything that arrives here is serialisable
// (labels are pre-formatted by the server-safe wrappers in ../charts.tsx), so
// these plots can be rendered from Server Components and Client Components alike.
//
// Geometry is drawn in real pixels once the plot width is known (ResizeObserver),
// so strokes stay crisp and circles stay round at any width. Axes, grid lines,
// tooltips and markers are HTML so text never distorts.

import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/site";
import { areaPath, linePath, runs, type Tick } from "./scale";

const GRID = "#242424";
const AXIS = "#3a3a3a";
const PANEL = "#171717";

/* --------------------------------- Hooks --------------------------------- */

/** Width of an element in CSS pixels, kept current with a ResizeObserver. 0 until measured. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      setWidth((prev) => (prev === w ? prev : w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Animates numeric values from what is on screen to `target` when the data
 * changes (same length). NaN marks a gap and is never interpolated.
 */
function useTween(target: number[], ms = 420): number[] {
  const key = target.join(",");
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  useEffect(() => {
    const to = key === "" ? [] : key.split(",").map(Number);
    const from = shownRef.current;
    let raf = 0;
    if (from.length !== to.length || reducedMotion()) {
      shownRef.current = to;
      raf = requestAnimationFrame(() => setShown(to));
      return () => cancelAnimationFrame(raf);
    }
    if (from.every((v, i) => Object.is(v, to[i]))) return;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - t, 3);
      const cur = to.map((v, i) => (Number.isFinite(v) && Number.isFinite(from[i]) ? from[i] + (v - from[i]) * e : v));
      shownRef.current = cur;
      setShown(cur);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [key, ms]);
  // A change of length (e.g. a new time range) is not interpolated: show the target as is.
  return shown.length === target.length ? shown : target;
}

/* --------------------------------- Pieces --------------------------------- */

export type XLabel = { pos: number; label: string };
export type LegendEntry = { name: string; label: string; color: string; dashed?: boolean };

function Swatch({ color, dashed }: { color: string; dashed?: boolean }) {
  return dashed ? (
    <svg width="14" height="4" aria-hidden className="shrink-0">
      <line x1="0" x2="14" y1="2" y2="2" stroke={color} strokeWidth="2" strokeDasharray="4 3" />
    </svg>
  ) : (
    <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: color }} />
  );
}

/** Legend whose items show and hide their series. */
function ToggleLegend({ items, hidden, onToggle }: { items: LegendEntry[]; hidden: Set<string>; onToggle: (name: string) => void }) {
  return (
    <>
      {items.map((it) => {
        const off = hidden.has(it.name);
        return (
          <button
            key={it.name}
            type="button"
            aria-pressed={!off}
            title={off ? `Show ${it.label}` : `Hide ${it.label}`}
            onClick={() => onToggle(it.name)}
            className={cn(
              "inline-flex items-center gap-2 rounded-[4px] px-1 py-0.5 -mx-1 text-[12px] transition-[color,opacity] duration-150 hover:bg-con-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-con-fg3",
              off ? "text-con-fg3 opacity-50" : "text-con-fg2 hover:text-con-fg",
            )}
          >
            <Swatch color={it.color} dashed={it.dashed} />
            <span className={cn(off && "line-through")}>{it.label}</span>
          </button>
        );
      })}
    </>
  );
}

function useHidden() {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const toggle = (name: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  return [hidden, toggle] as const;
}

/** Tooltip box that sits beside the crosshair and flips sides near the right edge. */
function Tip({ x, width, children }: { x: number; width: number; children: React.ReactNode }) {
  const flip = x > width * 0.62;
  return (
    <div
      role="status"
      className="pointer-events-none absolute top-1 z-20 min-w-[148px] max-w-[260px] rounded-md border border-con-line-hover bg-con-bg/95 px-3 py-2 text-[12px] shadow-[0_6px_20px_rgba(0,0,0,0.35)] backdrop-blur-sm"
      style={{ left: x, transform: flip ? "translateX(calc(-100% - 12px))" : "translateX(12px)" }}
    >
      {children}
    </div>
  );
}

function TipRow({ color, dashed, label, value }: { color?: string; dashed?: boolean; label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-0.5">
      <span className="flex min-w-0 items-center gap-2 text-con-fg2">
        {color && <Swatch color={color} dashed={dashed} />}
        <span className="truncate">{label}</span>
      </span>
      <span className="font-mono tabular-nums text-con-fg">{value}</span>
    </div>
  );
}

/** Axes, grid and legend around a plot area. Grid lines are 1px HTML rules, so they stay crisp. */
function Frame({
  height,
  ticks,
  yMax,
  xLabels,
  legend,
  plot,
}: {
  height: number;
  ticks: Tick[];
  yMax: number;
  xLabels: XLabel[];
  legend?: React.ReactNode;
  plot: React.ReactNode;
}) {
  return (
    <div className="w-full">
      {legend && <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">{legend}</div>}
      <div className="flex">
        <div className="relative w-10 shrink-0" style={{ height }} aria-hidden>
          {ticks.map((t) => (
            <span
              key={t.value}
              className="absolute right-2 -translate-y-1/2 whitespace-nowrap text-[11px] leading-none tabular-nums text-con-fg3"
              style={{ top: `${100 - (t.value / yMax) * 100}%` }}
            >
              {t.label}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1" style={{ height }}>
          {ticks.map((t) => (
            <div
              key={t.value}
              aria-hidden
              className="pointer-events-none absolute inset-x-0 h-px"
              style={{ top: `${100 - (t.value / yMax) * 100}%`, background: t.value === 0 ? AXIS : GRID }}
            />
          ))}
          {plot}
        </div>
      </div>
      <div className="relative ml-10 mt-2 h-4" aria-hidden>
        {xLabels.map((l, i) => (
          <span
            key={i}
            className={cn(
              "absolute whitespace-nowrap text-[11px] tabular-nums text-con-fg3",
              l.pos <= 0.02 ? "" : l.pos >= 0.98 ? "-translate-x-full" : "-translate-x-1/2",
            )}
            style={{ left: `${l.pos * 100}%` }}
          >
            {l.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <span className="rounded-md bg-con-panel px-3 py-1.5 text-[13px] text-con-fg3">{label}</span>
    </div>
  );
}

/* ------------------------------- Line plot ------------------------------- */

export type PlotSeries = { name: string; label: string; values: (number | null)[]; color: string; dashed?: boolean; area?: boolean };

export function LinePlot({
  height,
  ticks,
  yMin,
  yMax,
  xLabels,
  series,
  valueLabels,
  pointLabels,
  tooltipNote,
  threshold,
  title,
  legend,
  toggle,
  emptyLabel = "No data for this period",
}: {
  height: number;
  ticks: Tick[];
  yMin: number;
  yMax: number;
  xLabels: XLabel[];
  series: PlotSeries[];
  /** Formatted value per series per point, for the tooltip. */
  valueLabels: string[][];
  /** Tooltip heading per point (e.g. a date). */
  pointLabels?: string[];
  tooltipNote?: string;
  threshold?: { value: number; label: string };
  title?: string;
  legend?: React.ReactNode;
  toggle?: boolean;
  emptyLabel?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hidden, toggleHidden] = useHidden();
  const [hover, setHover] = useState<number | null>(null);

  const n = Math.max(0, ...series.map((s) => s.values.length));
  const flat = series.flatMap((s) => Array.from({ length: n }, (_, i) => s.values[i] ?? NaN));
  const tweened = useTween(flat);
  const vals = series.map((_, si) => tweened.slice(si * n, si * n + n).map((v) => (Number.isFinite(v) ? v : null)));
  const hasData = flat.some(Number.isFinite);

  const H = height;
  const X = (i: number) => (n <= 1 ? w / 2 : (i / (n - 1)) * w);
  const Y = (v: number) => H - ((v - yMin) / yMax) * H;
  const visible = series.map((s) => !hidden.has(s.name));

  const pick = (clientX: number, el: HTMLElement) => {
    if (n === 0) return;
    const r = el.getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (clientX - r.left) / Math.max(1, r.width)));
    setHover(n <= 1 ? 0 : Math.round(fx * (n - 1)));
  };

  const legendItems: LegendEntry[] = series.map((s) => ({ name: s.name, label: s.label, color: s.color, dashed: s.dashed }));
  const legendNode =
    toggle || legend ? (
      <>
        {legend}
        {toggle && <ToggleLegend items={legendItems} hidden={hidden} onToggle={toggleHidden} />}
      </>
    ) : undefined;

  const hx = hover !== null ? X(hover) : 0;
  const tipRows = hover !== null ? series.map((s, si) => ({ s, si, v: vals[si][hover] })).filter((r) => visible[r.si] && r.v !== null) : [];

  return (
    <Frame
      height={height}
      ticks={ticks}
      yMax={yMax}
      xLabels={xLabels}
      legend={legendNode}
      plot={
        <div
          ref={ref}
          className="absolute inset-0 touch-pan-y outline-none focus-visible:ring-1 focus-visible:ring-con-fg3 focus-visible:ring-offset-4 focus-visible:ring-offset-con-panel rounded-[2px]"
          role="img"
          aria-label={title}
          tabIndex={hasData ? 0 : -1}
          onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
          onPointerDown={(e) => pick(e.clientX, e.currentTarget)}
          onPointerLeave={() => setHover(null)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
              e.preventDefault();
              const d = e.key === "ArrowRight" ? 1 : -1;
              setHover((h) => Math.min(n - 1, Math.max(0, h === null ? (d > 0 ? 0 : n - 1) : h + d)));
            } else if (e.key === "Escape") setHover(null);
          }}
        >
          {threshold && (
            <>
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 border-t border-dashed border-con-warn/70"
                style={{ top: `${100 - ((threshold.value - yMin) / yMax) * 100}%` }}
              />
              <span
                className="pointer-events-none absolute right-1 -translate-y-full pb-0.5 text-[11px] text-con-warn"
                style={{ top: `${100 - ((threshold.value - yMin) / yMax) * 100}%` }}
              >
                {threshold.label}
              </span>
            </>
          )}
          {!hasData && <Empty label={emptyLabel} />}
          {w > 0 && hasData && (
            <svg width={w} height={H} className="absolute inset-0 overflow-visible" aria-hidden>
              <defs>
                {series.map((s, si) =>
                  s.area ? (
                    <linearGradient key={si} id={`${uid}-g${si}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={s.color} stopOpacity={0.22} />
                      <stop offset="70%" stopColor={s.color} stopOpacity={0.05} />
                      <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                    </linearGradient>
                  ) : null,
                )}
              </defs>
              {series.map((s, si) =>
                s.area ? (
                  <path
                    key={`a-${s.name}-${n}`}
                    d={areaPath(vals[si], X, Y, H)}
                    fill={`url(#${uid}-g${si})`}
                    className="con-fade transition-opacity duration-200"
                    style={{ animationDuration: "0.9s", opacity: visible[si] ? 1 : 0 }}
                  />
                ) : null,
              )}
              {series.map((s, si) => (
                <g key={`l-${s.name}-${n}`} className="transition-opacity duration-200" style={{ opacity: visible[si] ? 1 : 0 }}>
                  <path
                    d={linePath(vals[si], X, Y)}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={s.dashed ? 1.5 : 2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    {...(s.dashed ? { strokeDasharray: "4 4", className: "con-fade" } : { pathLength: 1, className: "con-draw" })}
                  />
                  {/* Isolated points (no neighbours to draw a line to). */}
                  {runs(vals[si], X, Y)
                    .filter((r) => r.length === 1)
                    .map((r, k) => (
                      <circle key={k} cx={r[0][0]} cy={r[0][1]} r={3} fill={s.color} stroke={PANEL} strokeWidth={2} className="con-fade" />
                    ))}
                </g>
              ))}
            </svg>
          )}
          {hover !== null && w > 0 && hasData && (
            <>
              <div aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-con-line-hover" style={{ left: Math.round(hx) }} />
              {tipRows.map(({ s, si, v }) => (
                <span
                  key={si}
                  aria-hidden
                  className="pointer-events-none absolute h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-con-panel"
                  style={{ left: hx, top: Y(v!), background: s.color }}
                />
              ))}
              <Tip x={hx} width={w}>
                <div className="mb-1 font-medium text-con-fg">{pointLabels?.[hover] ?? `Point ${hover + 1} of ${n}`}</div>
                {tipRows.length === 0 ? (
                  <div className="text-con-fg3">No data</div>
                ) : (
                  tipRows.map(({ s, si }) => (
                    <TipRow key={si} color={s.color} dashed={s.dashed} label={s.label} value={valueLabels[si]?.[hover] ?? ""} />
                  ))
                )}
                {tooltipNote && <div className="mt-1 text-[11px] text-con-fg3">{tooltipNote}</div>}
              </Tip>
            </>
          )}
        </div>
      }
    />
  );
}

/* ------------------------------- Bar plot ------------------------------- */

export type PlotBar = {
  label: string;
  /** Tooltip heading; defaults to the label. */
  header?: string;
  /** Accessible summary of the bar. */
  title?: string;
  href?: string;
  segments: { name: string; value: number; color: string; valueLabel: string }[];
  totalLabel: string;
};

export function BarPlot({
  height,
  ticks,
  yMax,
  xLabels,
  data,
  legend,
  legendItems,
  title,
  emptyLabel = "Nothing in this period",
}: {
  height: number;
  ticks: Tick[];
  yMax: number;
  xLabels: XLabel[];
  data: PlotBar[];
  legend?: React.ReactNode;
  /** When given, a legend that shows and hides segments by name. */
  legendItems?: LegendEntry[];
  title?: string;
  emptyLabel?: string;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hidden, toggleHidden] = useHidden();
  const [hover, setHover] = useState<number | null>(null);
  const n = data.length;
  const flat = data.flatMap((d) => d.segments.map((s) => (hidden.has(s.name) ? 0 : s.value)));
  const tweened = useTween(flat);
  const hasData = data.some((d) => d.segments.some((s) => s.value > 0));

  const H = height;
  const slot = n ? w / n : 0;
  const gap = Math.min(Math.max(slot * 0.28, 1), 12);
  const bw = Math.max(1, slot - gap);

  const pick = (clientX: number, el: HTMLElement) => {
    if (!n) return;
    const r = el.getBoundingClientRect();
    const i = Math.floor(((clientX - r.left) / Math.max(1, r.width)) * n);
    setHover(Math.min(n - 1, Math.max(0, i)));
  };

  const legendNode =
    legend || legendItems ? (
      <>
        {legend}
        {legendItems && <ToggleLegend items={legendItems} hidden={hidden} onToggle={toggleHidden} />}
      </>
    ) : undefined;

  let k = 0;
  const bars = data.map((d) => {
    let acc = 0;
    return d.segments.map((s) => {
      const v = tweened[k++] ?? 0;
      const y0 = acc;
      acc += v;
      return { s, v, y0, y1: acc };
    });
  });

  const hd = hover !== null ? data[hover] : null;
  const hx = hover !== null ? (hover + 0.5) * slot : 0;

  return (
    <Frame
      height={height}
      ticks={ticks}
      yMax={yMax}
      xLabels={xLabels}
      legend={legendNode}
      plot={
        <div
          ref={ref}
          className="absolute inset-0 touch-pan-y rounded-[2px] outline-none focus-visible:ring-1 focus-visible:ring-con-fg3 focus-visible:ring-offset-4 focus-visible:ring-offset-con-panel"
          role="img"
          aria-label={title}
          tabIndex={hasData ? 0 : -1}
          onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
          onPointerDown={(e) => pick(e.clientX, e.currentTarget)}
          onPointerLeave={() => setHover(null)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
              e.preventDefault();
              const dir = e.key === "ArrowRight" ? 1 : -1;
              setHover((h) => Math.min(n - 1, Math.max(0, h === null ? (dir > 0 ? 0 : n - 1) : h + dir)));
            } else if (e.key === "Escape") setHover(null);
          }}
        >
          {hover !== null && w > 0 && (
            <div aria-hidden className="pointer-events-none absolute inset-y-0 rounded-[3px] bg-con-hover" style={{ left: hover * slot, width: slot }} />
          )}
          {!hasData && <Empty label={emptyLabel} />}
          {w > 0 && (
            <svg width={w} height={H} className="absolute inset-0 overflow-visible" aria-hidden>
              {bars.map((segs, i) => {
                const x = Math.round(i * slot + gap / 2);
                const width = Math.max(1, Math.round(bw));
                const top = segs.reduce((m, sg, j) => (sg.v > 0 ? j : m), -1);
                return (
                  <g
                    key={`${i}-${n}`}
                    className="con-grow-y"
                    style={{ animationDelay: `${Math.min(i * 14, 420)}ms`, opacity: hover === null || hover === i ? 1 : 0.55, transition: "opacity 150ms" }}
                  >
                    {data[i].title && <title>{data[i].title}</title>}
                    {segs.map((sg, j) => {
                      if (sg.v <= 0) return null;
                      const yTop = H - (sg.y1 / yMax) * H;
                      const yBot = H - (sg.y0 / yMax) * H - (sg.y0 > 0 ? 1 : 0); // 1px surface gap between stacked parts
                      const h = Math.max(0, yBot - yTop);
                      if (h <= 0) return null;
                      const r = j === top && width > 5 ? Math.min(2, h) : 0;
                      return <path key={j} d={topRounded(x, yTop, width, h, r)} fill={sg.s.color} />;
                    })}
                  </g>
                );
              })}
            </svg>
          )}
          {hd && w > 0 && (
            <Tip x={hx + slot / 2} width={w}>
              <div className="mb-1 font-medium text-con-fg">{hd.header ?? hd.label}</div>
              {hd.segments
                .filter((s) => !hidden.has(s.name))
                .map((s) => (
                  <TipRow key={s.name} color={s.color} label={s.name} value={s.valueLabel} />
                ))}
              {hd.segments.length > 1 && (
                <div className="mt-1 border-t border-con-row pt-1">
                  <TipRow label="Total" value={hd.totalLabel} />
                </div>
              )}
            </Tip>
          )}
        </div>
      }
    />
  );
}

/** Rect with only the top corners rounded. */
function topRounded(x: number, y: number, w: number, h: number, r: number): string {
  if (r <= 0) return `M${x},${y}h${w}v${h}h${-w}Z`;
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/* ------------------------------- Dot plot ------------------------------- */

export type PlotPoint = { x: number; y: number; color: string; title: string; href?: string };

export function DotsPlot({
  height,
  ticks,
  yMax,
  xLabels,
  points,
  guide,
  legend,
  title,
  emptyLabel = "Nothing in this period",
}: {
  height: number;
  ticks: Tick[];
  yMax: number;
  xLabels: XLabel[];
  points: PlotPoint[];
  guide?: { value: number; label: string };
  legend?: React.ReactNode;
  title?: string;
  emptyLabel?: string;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const hp = hover !== null ? points[hover] : null;
  return (
    <Frame
      height={height}
      ticks={ticks}
      yMax={yMax}
      xLabels={xLabels}
      legend={legend}
      plot={
        <div ref={ref} className="absolute inset-0" role="img" aria-label={title}>
          {points.length === 0 && <Empty label={emptyLabel} />}
          {guide && (
            <>
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 border-t border-dashed border-con-fg3"
                style={{ top: `${100 - (guide.value / yMax) * 100}%` }}
              />
              <span
                className="pointer-events-none absolute left-1 -translate-y-full pb-0.5 text-[11px] text-con-fg2"
                style={{ top: `${100 - (guide.value / yMax) * 100}%` }}
              >
                {guide.label}
              </span>
            </>
          )}
          {points.map((p, i) => {
            const style = {
              left: `${p.x * 100}%`,
              bottom: `${(p.y / yMax) * 100}%`,
              background: p.color,
              animationDelay: `${Math.min(i * 18, 500)}ms`,
            };
            const cls = cn(
              "con-scale-in absolute h-2.5 w-2.5 -translate-x-1/2 translate-y-1/2 rounded-full ring-2 ring-con-panel transition-[width,height] duration-150 focus-visible:outline-none focus-visible:ring-con-fg2",
              hover === i && "h-3.5 w-3.5",
            );
            const handlers = {
              onPointerEnter: () => setHover(i),
              onPointerLeave: () => setHover((h) => (h === i ? null : h)),
              onFocus: () => setHover(i),
              onBlur: () => setHover((h) => (h === i ? null : h)),
            };
            return p.href ? (
              <Link key={i} href={p.href} aria-label={p.title} className={cls} style={style} {...handlers} />
            ) : (
              <span key={i} tabIndex={0} aria-label={p.title} className={cls} style={style} {...handlers} />
            );
          })}
          {hp && w > 0 && (
            <div
              className="pointer-events-none absolute z-20 max-w-[260px] rounded-md border border-con-line-hover bg-con-bg/95 px-3 py-2 text-[12px] text-con-fg shadow-[0_6px_20px_rgba(0,0,0,0.35)] backdrop-blur-sm"
              style={{
                left: hp.x * w,
                bottom: `calc(${(hp.y / yMax) * 100}% + 12px)`,
                transform: hp.x > 0.62 ? "translateX(-100%)" : hp.x < 0.2 ? "none" : "translateX(-50%)",
              }}
            >
              {hp.title}
            </div>
          )}
        </div>
      }
    />
  );
}
