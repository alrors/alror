import { ChevronRight } from "lucide-react";
import { COLORS, LegendItem, LineChart } from "@/components/console/charts";
import { changeWords, limitWords, pValueWords } from "@/components/console/release-story";
import { hm, metricLabel, metricUnitValue, pValue, signedPct } from "@/lib/console/format";
import type { DeployEvent, MetricResult } from "@/lib/console/types";
import { cn } from "@/lib/site";

/** Small deterministic PRNG so the illustrative series is stable between renders. */
function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function series(median: number, seed: string, n = 24, spread = 0.06): number[] {
  const r = rng(seed);
  let drift = 0;
  return Array.from({ length: n }, () => {
    drift = drift * 0.6 + (r() - 0.5) * spread;
    return median * (1 + drift + (r() - 0.5) * spread * 0.6);
  });
}

function MetricChart({ r, seed, limit }: { r: MetricResult; seed: string; limit?: number }) {
  const n = 24;
  const spread = r.metric.includes("error") ? 0.12 : 0.05;
  const color = r.pass ? COLORS.good : COLORS.bad;
  const fmt = (v: number) => (r.metric.includes("latency") ? `${Math.round(v)}` : v.toFixed(2));
  return (
    <LineChart
      height={130}
      series={[
        { name: "baseline", values: series(r.baseline, `${seed}:b`, n, spread), color: "#737373", dashed: true },
        { name: "canary", values: series(r.canary, `${seed}:c`, n, spread), color, area: true },
      ]}
      threshold={limit !== undefined ? { value: r.baseline * (1 + limit), label: `limit +${Math.round(limit * 100)}%` } : undefined}
      yFormat={fmt}
      xLabels={[
        { pos: 0, label: "0" },
        { pos: 1, label: "end of bake" },
      ]}
      title={`${r.metric}: canary ${metricUnitValue(r.metric, r.canary)} vs baseline ${metricUnitValue(r.metric, r.baseline)}`}
      legend={
        <>
          <LegendItem color={color} label="Canary" value={metricUnitValue(r.metric, r.canary)} />
          <LegendItem color="#737373" dashed label="Baseline" value={metricUnitValue(r.metric, r.baseline)} />
        </>
      }
    />
  );
}

/** One metric explained: side-by-side values, change against the limit, and the statistics in words. */
function MetricCard({ r, limit, alpha, seed, delay }: { r: MetricResult; limit?: number; alpha: number; seed: string; delay: number }) {
  const max = Math.max(r.canary, r.baseline) || 1;
  // Change vs limit: the scale runs to 1.5x the limit (or the change, if bigger).
  const scale = Math.max(limit ?? 0.25, Math.abs(r.delta), 0.01) * 1.5;
  const deltaW = Math.min(100, (Math.max(0, r.delta) / scale) * 100);
  const limitX = limit !== undefined ? (limit / scale) * 100 : null;
  return (
    <div className={cn("rounded-md border p-4", r.pass ? "border-con-line" : "border-con-bad/40")}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[14px] font-medium text-con-fg">{metricLabel(r.metric)}</span>
        <span className={cn("inline-flex items-center gap-1.5 text-[12px] font-medium", r.pass ? "text-con-fg2" : "text-con-bad")}>
          <span className={cn("h-1.5 w-1.5 rounded-full", r.pass ? "bg-con-good" : "bg-con-bad")} aria-hidden />
          {r.pass ? "Within limit" : "Over limit"}
        </span>
      </div>

      <dl className="mt-3 space-y-2 text-[12px]">
        {(
          [
            ["Canary", r.canary, r.pass ? "bg-con-fg2" : "bg-con-bad"],
            ["Baseline", r.baseline, "bg-con-fg3"],
          ] as const
        ).map(([label, v, cls], i) => (
          <div key={label} className="grid grid-cols-[64px_minmax(0,1fr)_72px] items-center gap-2">
            <dt className="text-con-fg2">{label}</dt>
            <dd className="h-1.5 overflow-hidden rounded-full bg-con-row">
              <div className={cn("con-grow-x h-full rounded-full", cls)} style={{ width: `${(v / max) * 100}%`, animationDelay: `${delay + i * 60}ms` }} />
            </dd>
            <dd className="text-right font-mono tabular-nums text-con-fg">{metricUnitValue(r.metric, v)}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-3">
        <div className="flex items-baseline justify-between text-[12px]">
          <span className="text-con-fg2">Change</span>
          <span className={cn("font-mono tabular-nums", r.pass ? "text-con-fg" : "text-con-bad")}>
            {signedPct(r.delta)}
            {limit !== undefined && <span className="text-con-fg3"> / limit +{Math.round(limit * 100)}%</span>}
          </span>
        </div>
        <div className="relative mt-1.5 h-1.5 rounded-full bg-con-row">
          <div className={cn("con-grow-x absolute inset-y-0 left-0 rounded-full", r.pass ? "bg-con-fg3" : "bg-con-bad")} style={{ width: `${deltaW}%`, animationDelay: `${delay + 120}ms` }} />
          {limitX !== null && <span aria-hidden className="absolute -top-1 h-3.5 w-px bg-con-fg2" style={{ left: `${limitX}%` }} title="limit" />}
        </div>
      </div>

      <ul className="mt-3.5 space-y-1.5 text-[12.5px] leading-relaxed text-con-fg2">
        <li>{changeWords(r)}</li>
        <li>{limitWords(r, limit)}</li>
        <li>
          <span className="font-mono text-con-fg3">p={pValue(r.p_value)}</span> · {pValueWords(r.p_value, alpha)}
        </li>
        {!r.pass && r.reason && <li className="text-con-bad">{r.reason}</li>}
      </ul>

      <details className="group/chart mt-3">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[12px] text-con-fg3 hover:text-con-fg [&::-webkit-details-marker]:hidden">
          <ChevronRight size={12} className="transition-transform duration-150 group-open/chart:rotate-90" />
          Illustrative chart
        </summary>
        <div className="con-fade mt-2">
          <MetricChart r={r} seed={seed} limit={limit} />
          <p className="mt-1 text-[11px] text-con-fg3">The CLI records one median per window; this series is synthesised around those medians.</p>
        </div>
      </details>
    </div>
  );
}

export function ReleaseVerdicts({ verdicts, seed, limits, alpha }: { verdicts: DeployEvent[]; seed: string; limits: Record<string, number>; alpha: number }) {
  if (verdicts.length === 0) return <p className="py-6 text-center text-[13px] text-con-fg3">No verdicts recorded yet.</p>;
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-con-fg2">
        After each bake, alror compares the canary (new version) with the baseline (stable version) on every metric. A stage passes when every
        metric stays within its limit, or the difference is too small to be more than noise (p above {alpha}).
      </p>
      {verdicts.map((e, i) => {
        const v = e.verdict!;
        const results = v.results ?? [];
        return (
          <div key={i} className="con-fade-up rounded-lg border border-con-line" style={{ animationDelay: `${i * 60}ms` }}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-con-line px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-[22px] items-center gap-1.5 rounded-full bg-con-row px-2 text-[12px] font-medium">
                  <span className={cn("h-1.5 w-1.5 rounded-full", v.pass ? "bg-con-good" : "bg-con-bad")} aria-hidden />
                  {v.pass ? "Pass" : "Fail"}
                </span>
                <span className="text-[14px] font-medium">At {e.weight ?? 0}% traffic</span>
              </div>
              <span className="font-mono text-[12px] text-con-fg3">{hm(e.at)} UTC</span>
            </div>
            <div className="space-y-3 p-4">
              {v.summary && <p className="font-mono text-[12.5px] text-con-fg2">{v.summary}</p>}
              <div className="grid gap-3 xl:grid-cols-2">
                {results.map((r, j) => (
                  <MetricCard key={r.metric} r={r} limit={limits[r.metric]} alpha={alpha} seed={`${seed}:${e.weight}:${r.metric}`} delay={i * 60 + j * 80} />
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
