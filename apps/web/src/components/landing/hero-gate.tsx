"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, GitPullRequest, Pause, Play } from "lucide-react";
import { cn } from "@/lib/site";
import { GithubLogo, SlackLogo } from "./brand-logos";
import { RiskSegments } from "./segments";
import { SCENARIOS, fmtDelta, fmtP, series } from "./rollout-data";
import { useInView, useReducedMotion } from "./motion";

const run = SCENARIOS[0]; // the healthy #4821 release, from a real CLI capture
const STEPS = [5, 25, 50, 100];
const TICKS_PER_STAGE = 4; // 2 collecting, 2 verified
const FINAL_TICKS = 9;
const TICK_MS = 700;

function Chart({ progress }: { progress: number }) {
  // Three bake windows (5%, 25%, 50%) then the promoted tail. Values are the CLI medians.
  const W = 520;
  const H = 92;
  const pad = { l: 4, r: 4, t: 18, b: 6 };
  const { canary, baseline } = useMemo(() => {
    const c: number[] = [];
    const b: number[] = [];
    run.stages.forEach((s, i) => {
      const e = s.verdicts[0];
      c.push(...series(e.canary, 14, 0.09, 11 + i));
      b.push(...series(e.baseline, 14, 0.06, 97 + i));
    });
    c.push(...series(0.205, 10, 0.07, 41));
    b.push(...series(0.215, 10, 0.05, 43));
    return { canary: c, baseline: b };
  }, []);
  const max = 0.3;
  const x = (i: number, n: number) => pad.l + (i / (n - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const path = (vs: number[]) => vs.map((v, i) => `${i ? "L" : "M"}${x(i, vs.length).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const segW = (W - pad.l - pad.r) * (14 / canary.length);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[92px] w-full" role="img" aria-label="Error rate, canary versus baseline, across the rollout stages">
      <defs>
        <clipPath id="hg-clip">
          <rect x="0" y="0" height={H} width={W * progress} style={{ transition: "width 0.9s cubic-bezier(0.3,0.7,0.2,1)" }} />
        </clipPath>
      </defs>
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          {i > 0 && <line x1={pad.l + segW * i} x2={pad.l + segW * i} y1={10} y2={H} stroke="#1f1f24" />}
          <text x={pad.l + segW * i + 6} y={10} fill="#5a5a63" fontSize="9" fontFamily="var(--font-geist-mono)">
            {STEPS[i]}%
          </text>
        </g>
      ))}
      <path d={path(baseline)} fill="none" stroke="#5a5a63" strokeWidth="1.25" strokeDasharray="3 3" />
      <g clipPath="url(#hg-clip)">
        <path d={path(canary)} fill="none" stroke="#35e08f" strokeWidth="1.6" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

export function HeroGate() {
  const reduced = useReducedMotion();
  const [ref, inView] = useInView<HTMLDivElement>();
  const [paused, setPaused] = useState(false);
  const [tick, setTick] = useState(2);

  const cycle = run.stages.length * TICKS_PER_STAGE + FINAL_TICKS;
  const playing = !reduced && !paused && inView;

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setTick((t) => (t + 1) % cycle), TICK_MS);
    return () => clearInterval(id);
  }, [playing, cycle]);

  const t = reduced ? cycle - 1 : tick;
  const stage = Math.min(Math.floor(t / TICKS_PER_STAGE), run.stages.length); // 0..3 (3 = promoted)
  const promoted = stage >= run.stages.length;
  const verified = promoted || t % TICKS_PER_STAGE >= 2;
  const current = run.stages[Math.min(stage, run.stages.length - 1)];
  const weight = STEPS[stage];
  // Chart progress: fraction of the samples drawn so far.
  const totalPts = run.stages.length * 14 + 10;
  const drawn = promoted ? totalPts : stage * 14 + Math.round(((t % TICKS_PER_STAGE) + 1) * 3.5);
  const progress = drawn / totalPts;
  const stagesVerified = promoted ? run.stages.length : stage + (verified ? 1 : 0);

  return (
    <div ref={ref} className="relative">
      <div className="lp-grid pointer-events-none absolute -inset-x-12 -inset-y-16" aria-hidden />

      {/* Inputs */}
      <div className="relative grid gap-3 sm:grid-cols-[1.15fr_1fr]">
        <div className="lp-panel min-w-0 rounded-xl p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#6e6e78]">In · Pull request</p>
          <div className="mt-2.5 flex items-start gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#18181c]">
              <GithubLogo className="h-4 w-4 text-[#f4f4f5]" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[14px] font-medium text-fg">
                <span className="text-[#6e6e78]">#4821</span> Batch retries for payment capture
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-[#6e6e78]">
                <span className="rounded border border-[#2a2a31] px-1 text-[#a3a3ad]">AI</span>
                1 file · <span className="text-[#35e08f]">+98</span> <span className="text-[#f2555a]">−22</span>
              </p>
            </div>
          </div>
        </div>
        <div className="lp-panel hidden min-w-0 rounded-xl p-4 sm:block">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#6e6e78]">In · Change risk</p>
          <div className="mt-3 flex items-center justify-between gap-3">
            <RiskSegments score={62} size="sm" />
            <span className="font-mono text-[13px] text-[#f5a524]">62</span>
          </div>
          <p className="mt-2.5 truncate font-mono text-[11px] text-[#6e6e78]">critical +12 · rollbacks +12 · payment +10</p>
        </div>
      </div>

      <Connector />

      {/* The gate */}
      <div className="lp-panel-2 relative overflow-hidden rounded-2xl">
        <div className="flex h-11 items-center gap-3 border-b border-[#24242a] px-4">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#a3a3ad]">Gate-01 · production</span>
          <span
            className={cn(
              "ml-auto inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px] transition-colors",
              promoted ? "border-[#35e08f]/30 text-[#35e08f]" : "border-[#2a2a31] text-[#d4d4d8]",
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", promoted ? "bg-[#35e08f]" : "bg-[#d4d4d8]")} />
            {promoted ? "Promoted · 100%" : `Canary · ${weight}%`}
          </span>
          {!reduced && (
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              aria-label={paused ? "Play the rollout animation" : "Pause the rollout animation"}
              className="grid h-6 w-6 place-items-center rounded-md text-[#6e6e78] hover:bg-white/[0.06] hover:text-fg focus-visible:outline-2 focus-visible:outline-white/60"
            >
              {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>

        <div className="p-4 sm:px-5 sm:pt-4 sm:pb-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="text-[20px] font-semibold tracking-[-0.02em] text-fg sm:text-[22px]">checkout-api</p>
            <p className="font-mono text-[11px] text-[#6e6e78]">registry/checkout:1.42 · medium plan</p>
          </div>

          {/* Stage track */}
          <ol className="mt-4 grid grid-cols-4 gap-2" aria-label="Rollout stages">
            {STEPS.map((w, i) => {
              const done = i < stage || promoted;
              const active = i === stage && !promoted;
              return (
                <li key={w}>
                  <div
                    className={cn(
                      "flex h-9 items-center justify-center gap-1.5 rounded-lg border font-mono text-[12px] transition-colors duration-300",
                      done && "border-[#2c2c33] bg-[#1a1a1f] text-fg",
                      active && "border-[#35e08f]/55 bg-[#35e08f]/[0.08] text-[#35e08f]",
                      !done && !active && "border-[#202026] text-[#55555e]",
                    )}
                    aria-current={active ? "step" : undefined}
                  >
                    {done && <Check className="h-3 w-3 text-[#35e08f]" strokeWidth={2.5} aria-hidden />}
                    {w}%
                  </div>
                  <p className="mt-1.5 text-center font-mono text-[10px] text-[#55555e]">{w === 100 ? "promote" : "bake 10m"}</p>
                </li>
              );
            })}
          </ol>

          <div className="mt-4 rounded-lg border border-[#1f1f24] bg-[#0b0b0d] px-3 pt-2.5 pb-1">
            <div className="flex items-center justify-between font-mono text-[10px] text-[#6e6e78]">
              <span>error_rate</span>
              <span className="flex items-center gap-3">
                <span className="flex items-center gap-1.5"><span className="h-px w-3 bg-[#35e08f]" />canary</span>
                <span className="flex items-center gap-1.5"><span className="h-px w-3 border-t border-dashed border-[#6e6e78]" />baseline</span>
              </span>
            </div>
            <Chart progress={progress} />
          </div>

          {/* Verdict rows */}
          <div className="mt-2.5 min-h-[52px] font-mono text-[11.5px] leading-[26px]" aria-live="off">
            {promoted ? (
              <p className="lp-in flex items-center gap-2 text-fg">
                <Check className="h-3.5 w-3.5 text-[#35e08f]" strokeWidth={2.5} aria-hidden />
                Verified at every step · promoted checkout-api to 100%
              </p>
            ) : (
              current.verdicts.map((v) => (
                <div key={`${stage}-${v.metric}`} className="grid grid-cols-[14px_92px_1fr_auto] items-center gap-2 sm:grid-cols-[14px_100px_1fr_64px_64px]">
                  {verified ? (
                    <Check className="h-3.5 w-3.5 text-[#35e08f]" strokeWidth={2.5} aria-hidden />
                  ) : (
                    <span className="h-1 w-1 justify-self-center rounded-full bg-[#55555e]" aria-hidden />
                  )}
                  <span className="text-[#d4d4d8]">{v.metric}</span>
                  <span className="text-[#a3a3ad]">
                    {verified ? `${v.canary} vs ${v.baseline}` : "collecting samples…"}
                  </span>
                  <span className={cn("hidden text-right sm:block", verified ? "text-[#a3a3ad]" : "text-transparent")}>{fmtDelta(v.delta)}</span>
                  <span className={cn("text-right", verified ? "text-[#6e6e78]" : "text-transparent")}>{fmtP(v.p)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <Connector />

      {/* Outputs */}
      <div className="relative grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_0.95fr]">
        <div className="lp-panel rounded-xl p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#6e6e78]">Out · Metrics</p>
          <div className="mt-2.5 flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/integrations/datadog.svg" alt="" className="h-5 w-5" />
            <span className="text-[13px] font-medium text-fg">Datadog</span>
          </div>
          <p className="mt-2 font-mono text-[11px] text-[#a3a3ad]">
            {stagesVerified}/{run.stages.length} stages verified
          </p>
          <p className="font-mono text-[11px] text-[#6e6e78]">Mann-Whitney · α 0.05</p>
        </div>
        <div className="lp-panel rounded-xl p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#6e6e78]">Out · Notify</p>
          <div className="mt-2.5 flex items-center gap-2">
            <SlackLogo className="h-4 w-4" />
            <span className="text-[13px] font-medium text-fg">#deploys</span>
          </div>
          <p key={promoted ? "p" : stage} className="lp-in mt-2 text-[12px] leading-snug text-[#a3a3ad]">
            {promoted ? (
              <>
                <span className="text-fg">checkout-api #4821</span> promoted to 100%
              </>
            ) : (
              <>
                <span className="text-fg">checkout-api #4821</span> at {weight}%, verifying
              </>
            )}
          </p>
        </div>
        <div className="relative hidden sm:block">
          {promoted ? (
            <div className="lp-print">
              <div className="lp-paper rounded-t-md px-3.5 pt-3 pb-2.5 font-mono text-[10px] leading-[16px]">
                <p className="tracking-[0.12em] text-[#77746b]">ALROR · RECEIPT</p>
                <p className="mt-1 text-[13px] font-semibold tracking-[0.04em]">VERIFIED</p>
                <p className="text-[#55534c]">checkout-api #4821 · risk 62</p>
                <div className="my-1.5 border-t border-dashed border-[#bdb9ad]" />
                <p className="flex justify-between"><span>error_rate</span><span>0.205 / 0.215</span></p>
                <p className="flex justify-between"><span>latency_p95</span><span>177 / 181</span></p>
                <p className="mt-1 flex justify-between font-semibold"><span>Promoted</span><span>→ 100%</span></p>
              </div>
              <div className="lp-zigzag" />
            </div>
          ) : (
            <div className="flex h-full flex-col justify-between rounded-xl border border-dashed border-[#26262c] p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#55555e]">Out · Receipt</p>
              <div className="flex items-center gap-2 text-[12px] text-[#55555e]">
                <GitPullRequest className="h-3.5 w-3.5" aria-hidden />
                Printed when the release ends
              </div>
            </div>
          )}
        </div>
      </div>
      <p className="sr-only">
        Illustration: pull request #4821, risk 62 (medium), rolls out to checkout-api at 5%, 25% and 50%, each stage verified
        against the baseline in Datadog, then promoted to 100% with a release receipt and a Slack message.
      </p>
    </div>
  );
}

function Connector() {
  return (
    <div className="relative flex h-5 justify-around px-[18%]" aria-hidden>
      {[0, 1].map((i) => (
        <span key={i} className="relative w-px bg-[#26262c]">
          <span className="absolute -bottom-[3px] left-1/2 h-[5px] w-[5px] -translate-x-1/2 rounded-full border border-[#3a3a42] bg-[#0b0b0d]" />
        </span>
      ))}
    </div>
  );
}

