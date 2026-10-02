"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, CornerDownRight, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/site";
import { ALPHA, LIMITS, SCENARIOS, type MetricVerdict, type Scenario, fmtDelta, fmtP, fmtValue, series } from "./rollout-data";
import { useInView, useReducedMotion } from "./motion";

const PLAN = [5, 25, 50, 100];
const PTS = 16;
const STEP_MS = 1500;

export function RolloutDemo() {
  const [which, setWhich] = useState<Scenario["id"]>("healthy");
  const [step, setStep] = useState(0);
  const [ref, inView] = useInView<HTMLDivElement>({ once: true, margin: "0px 0px -15% 0px" });
  const reduced = useReducedMotion();
  const sc = SCENARIOS.find((s) => s.id === which)!;
  const last = sc.stages.length + 1; // stages, then the outcome

  useEffect(() => {
    if (!inView || reduced || step >= last) return;
    const id = setTimeout(() => setStep((s) => s + 1), step === 0 ? 500 : STEP_MS);
    return () => clearTimeout(id);
  }, [inView, reduced, step, last]);

  const shown = reduced ? last : step; // number of revealed stages (+1 = outcome)
  const done = shown >= last;
  const rolledBack = sc.outcome.kind === "rolled_back";

  const select = (id: Scenario["id"]) => {
    setWhich(id);
    setStep(0);
  };

  return (
    <div ref={ref} className="lp-panel mt-14 overflow-hidden rounded-2xl" data-reveal>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-[#1d1d22] px-4 py-3 sm:px-5">
        <div role="radiogroup" aria-label="Scenario" className="flex rounded-lg border border-[#24242a] bg-[#0b0b0d] p-0.5">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={s.id === which}
              onClick={() => select(s.id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-[12.5px] transition-colors focus-visible:outline-2 focus-visible:outline-white/60",
                s.id === which ? "bg-[#1c1c21] text-fg" : "text-[#6e6e78] hover:text-[#a3a3ad]",
              )}
            >
              {s.label} <span className="font-mono text-[11px] text-[#6e6e78]">{s.ref}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setStep(0)}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] text-[#a3a3ad] hover:bg-white/[0.05] hover:text-fg focus-visible:outline-2 focus-visible:outline-white/60"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Replay
        </button>
        <p className="ml-auto hidden font-mono text-[11px] text-[#6e6e78] md:block">
          checkout-api · {sc.image} · risk 62 · medium plan
        </p>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 p-4 sm:p-6">
          <Timeline sc={sc} shown={shown} />

          <div className="mt-6 grid gap-3 md:grid-cols-2">
            <MetricChart sc={sc} metric="error_rate" shown={shown} />
            <MetricChart sc={sc} metric="latency_p95" shown={shown} />
          </div>

          <div className="lp-scroll mt-5 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left font-mono text-[12px]">
              <caption className="sr-only">Verdicts per stage</caption>
              <thead>
                <tr className="border-b border-[#1d1d22] text-[10.5px] uppercase tracking-[0.12em] text-[#55555e]">
                  {["Stage", "Metric", "Canary", "Baseline", "Δ", "p", "Result"].map((h) => (
                    <th key={h} scope="col" className="pb-2 font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sc.stages.flatMap((st, i) =>
                  st.verdicts.map((v, j) => (
                    <tr
                      key={`${which}-${i}-${v.metric}`}
                      className={cn(
                        "border-b border-[#16161a] transition-opacity duration-500",
                        i < shown ? "opacity-100" : "opacity-0",
                      )}
                      aria-hidden={i >= shown}
                    >
                      <td className="py-2 text-[#6e6e78]">{j === 0 ? `${st.weight}%` : ""}</td>
                      <td className="py-2 text-fg">{v.metric}</td>
                      <td className={cn("py-2 tabular-nums", v.pass ? "text-[#d4d4d8]" : "text-[#f2555a]")}>{fmtValue(v.metric, v.canary)}</td>
                      <td className="py-2 tabular-nums text-[#a3a3ad]">{fmtValue(v.metric, v.baseline)}</td>
                      <td className={cn("py-2 tabular-nums", v.pass ? "text-[#a3a3ad]" : "text-[#f2555a]")}>{fmtDelta(v.delta)}</td>
                      <td className="py-2 tabular-nums text-[#6e6e78]">{fmtP(v.p)}</td>
                      <td className="py-2">
                        {v.pass ? (
                          <span className="inline-flex items-center gap-1 text-[#35e08f]">
                            <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden /> pass
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[#f2555a]">
                            <X className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden /> fail
                          </span>
                        )}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Outcome */}
        <aside className="flex flex-col gap-4 border-t border-[#1d1d22] p-4 sm:p-6 lg:border-t-0 lg:border-l">
          <div>
            <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#6e6e78]">The rule</p>
            <p className="mt-2.5 text-[13px] leading-relaxed text-[#a3a3ad]">
              A metric fails only when the canary is worse than its limit <span className="text-fg">and</span> the one-sided
              Mann-Whitney U test gives p below α. Both must agree, so noise alone never rolls you back.
            </p>
            <dl className="mt-4 divide-y divide-[#1d1d22] rounded-lg border border-[#1d1d22] bg-[#0b0b0d] font-mono text-[11.5px]">
              <Def k="α" v={ALPHA.toFixed(2)} />
              <Def k="error_rate limit" v={`+${LIMITS.error_rate * 100}%`} />
              <Def k="latency_p95 limit" v={`+${LIMITS.latency_p95 * 100}%`} />
            </dl>
          </div>

          <div className="mt-auto min-h-[196px]" aria-live="polite">
            {done ? (
              <div key={which} className="lp-print">
                <div className="lp-paper rounded-t-md px-4 pt-3.5 pb-3 font-mono text-[11px] leading-[18px]">
                  <p className="tracking-[0.12em] text-[#77746b]">ALROR · RELEASE RECEIPT</p>
                  <p className="mt-1.5 text-[14px] font-semibold tracking-[0.04em]">{rolledBack ? "ROLLED BACK" : "VERIFIED"}</p>
                  <p className="text-[#55534c]">checkout-api {sc.ref} · risk 62</p>
                  <div className="my-2 border-t border-dashed border-[#bdb9ad]" />
                  {lastVerdicts(sc).map((v) => (
                    <p key={v.metric} className="flex justify-between">
                      <span>{v.metric}</span>
                      <span>
                        {v.canary} / {v.baseline}
                      </span>
                    </p>
                  ))}
                  <div className="my-2 border-t border-dashed border-[#bdb9ad]" />
                  <p className="flex justify-between font-semibold">
                    <span>{rolledBack ? "Reverted at" : "Promoted"}</span>
                    <span>{rolledBack ? `${sc.outcome.at}%` : "→ 100%"}</span>
                  </p>
                  <p className="flex justify-between text-[#77746b]">
                    <span className="truncate">{sc.depId}</span>
                  </p>
                </div>
                <div className="lp-zigzag" />
                <p className="mt-3 text-[12px] leading-relaxed text-[#a3a3ad]">
                  {rolledBack ? (
                    <>
                      <span className="text-[#f2555a]">{sc.outcome.reason}.</span> Traffic returned to stable; the run exits
                      with code 2 so CI can tell.
                    </>
                  ) : (
                    <>{sc.outcome.reason}.</>
                  )}
                </p>
              </div>
            ) : (
              <div className="flex h-full min-h-[196px] items-center justify-center rounded-lg border border-dashed border-[#24242a] text-[12px] text-[#55555e]">
                {shown === 0 ? "Waiting to start" : `Verifying at ${sc.stages[Math.min(shown, sc.stages.length) - 1]?.weight ?? 5}%…`}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Def({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <dt className="text-[#6e6e78]">{k}</dt>
      <dd className="text-fg">{v}</dd>
    </div>
  );
}

function lastVerdicts(sc: Scenario): MetricVerdict[] {
  return sc.stages[sc.stages.length - 1].verdicts;
}

function Timeline({ sc, shown }: { sc: Scenario; shown: number }) {
  const rolledBack = sc.outcome.kind === "rolled_back";
  const failedAt = rolledBack ? sc.stages.length - 1 : -1;
  return (
    <div>
      <ol className="relative grid grid-cols-4" aria-label="Rollout stages">
        {PLAN.map((w, i) => {
          const isFinal = i === PLAN.length - 1;
          const reached = isFinal ? shown > sc.stages.length && !rolledBack : i < Math.min(shown, sc.stages.length) && i !== failedAt;
          const failed = i === failedAt && i < shown;
          const skipped = rolledBack && i > failedAt && shown > sc.stages.length;
          const active = !reached && !failed && !skipped && i === shown && shown <= sc.stages.length && !(rolledBack && i > failedAt);
          return (
            <li key={w} className="relative flex flex-col items-start">
              {i > 0 && (
                <span className="absolute top-[13px] left-[calc(-100%+36px)] h-px w-[calc(100%-44px)] bg-[#24242a]" aria-hidden>
                  <span
                    className="block h-px origin-left bg-[#a3a3ad] transition-transform duration-700"
                    style={{ transform: `scaleX(${reached || failed ? 1 : 0})` }}
                  />
                </span>
              )}
              <span
                className={cn(
                  "relative z-10 grid h-7 w-7 place-items-center rounded-full border text-[11px] transition-colors duration-300",
                  reached && "border-[#35e08f]/50 bg-[#0f1a14] text-[#35e08f]",
                  failed && "border-[#f2555a]/60 bg-[#1f1012] text-[#f2555a]",
                  active && "border-[#a3a3ad] bg-[#0b0b0d] text-fg",
                  !reached && !failed && !active && "border-[#24242a] bg-[#0b0b0d] text-[#3a3a42]",
                )}
                aria-hidden
              >
                {reached ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : failed ? <X className="h-3.5 w-3.5" strokeWidth={2.5} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
              </span>
              <span className={cn("mt-2 font-mono text-[13px]", skipped ? "text-[#3a3a42] line-through" : "text-fg")}>{w}%</span>
              <span className="font-mono text-[10.5px] text-[#55555e]">
                {skipped ? "skipped" : failed ? "regression" : isFinal ? "promote" : "bake 10m"}
              </span>
              <span className="sr-only">
                {reached ? "passed" : failed ? "failed" : skipped ? "skipped" : active ? "in progress" : "pending"}
              </span>
            </li>
          );
        })}
      </ol>
      {rolledBack && (
        <p
          className={cn(
            "mt-3 flex items-center gap-2 font-mono text-[12px] text-[#f2555a] transition-opacity duration-500",
            shown > sc.stages.length ? "opacity-100" : "opacity-0",
          )}
        >
          <CornerDownRight className="h-3.5 w-3.5" aria-hidden />
          Rolled back at 5% traffic · returned to stable
        </p>
      )}
    </div>
  );
}

function MetricChart({ sc, metric, shown }: { sc: Scenario; metric: MetricVerdict["metric"]; shown: number }) {
  const W = 420;
  const H = 150;
  const pad = { l: 34, r: 8, t: 14, b: 18 };
  const windows = PLAN.length - 1; // three bake windows
  const data = useMemo(() => {
    const isErr = metric === "error_rate";
    return sc.stages.map((st, i) => {
      const v = st.verdicts.find((x) => x.metric === metric)!;
      return {
        v,
        canary: series(v.canary, PTS, isErr ? 0.1 : 0.03, (isErr ? 7 : 19) + i * 3 + (sc.id === "regression" ? 50 : 0)),
        baseline: series(v.baseline, PTS, isErr ? 0.06 : 0.02, (isErr ? 101 : 131) + i * 5),
      };
    });
  }, [sc, metric]);
  const ref = data[0].v.baseline;
  const limit = ref * (1 + LIMITS[metric]);
  const max = metric === "error_rate" ? 0.45 : 240;
  const innerW = W - pad.l - pad.r;
  const winW = innerW / windows;
  const x = (w: number, i: number) => pad.l + w * winW + (i / (PTS - 1)) * winW;
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const line = (vals: number[], w: number) => vals.map((v, i) => `${i ? "L" : "M"}${x(w, i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const failed = data.some((d) => !d.v.pass);
  const ticks = metric === "error_rate" ? [0, 0.2, 0.4] : [0, 100, 200];

  return (
    <figure className="rounded-xl border border-[#1d1d22] bg-[#0b0b0d] p-3">
      <figcaption className="flex items-center justify-between font-mono text-[11px]">
        <span className="text-fg">{metric}</span>
        <span className="flex items-center gap-3 text-[#6e6e78]">
          <span className="flex items-center gap-1.5">
            <span className={cn("h-0.5 w-3", failed && shown > 0 ? "bg-[#f2555a]" : "bg-[#35e08f]")} />
            canary
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 border-t border-dashed border-[#6e6e78]" />
            baseline
          </span>
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-auto w-full" role="img" aria-label={`${metric}: canary versus baseline per stage, with the +${LIMITS[metric] * 100}% limit`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#17171b" />
            <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fill="#4a4a52" fontSize="9" fontFamily="var(--font-geist-mono)">
              {t}
            </text>
          </g>
        ))}
        {Array.from({ length: windows }, (_, w) => (
          <g key={w}>
            {w > 0 && <line x1={pad.l + w * winW} x2={pad.l + w * winW} y1={pad.t - 6} y2={H - pad.b} stroke="#1d1d22" />}
            <text x={pad.l + w * winW + winW / 2} y={H - 4} textAnchor="middle" fill="#4a4a52" fontSize="9" fontFamily="var(--font-geist-mono)">
              {PLAN[w]}%
            </text>
            {w >= data.length && (
              <rect x={pad.l + w * winW + 1} y={pad.t} width={winW - 2} height={H - pad.t - pad.b} fill="url(#lp-hatch)" opacity={shown > data.length ? 1 : 0} style={{ transition: "opacity .5s" }} />
            )}
          </g>
        ))}
        <defs>
          <pattern id="lp-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="#18181c" strokeWidth="2" />
          </pattern>
        </defs>
        {/* limit */}
        <line x1={pad.l} x2={W - pad.r} y1={y(limit)} y2={y(limit)} stroke="#f5a524" strokeOpacity="0.55" strokeDasharray="2 3" />
        <text x={W - pad.r} y={y(limit) - 4} textAnchor="end" fill="#f5a524" fillOpacity="0.8" fontSize="9" fontFamily="var(--font-geist-mono)">
          limit +{LIMITS[metric] * 100}%
        </text>
        {data.map((d, w) =>
          w < shown ? (
            <g key={`${sc.id}-${w}`}>
              <path d={line(d.baseline, w)} fill="none" stroke="#6e6e78" strokeWidth="1.2" strokeDasharray="3 3" />
              <path
                d={line(d.canary, w)}
                pathLength={1}
                className="lp-draw"
                fill="none"
                stroke={d.v.pass ? "#35e08f" : "#f2555a"}
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            </g>
          ) : null,
        )}
      </svg>
    </figure>
  );
}
