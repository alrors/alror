"use client";

import { useId, useState } from "react";
import { metricLabel } from "@/lib/console/format";
import type { PolicyForm } from "@/lib/console/policy-rules";
import type { Level } from "@/lib/console/types";
import { cn } from "@/lib/site";

/** Mirrors LevelFor in the CLI's risk scorer: 70+ high, 35+ medium, else low. */
export function levelFor(score: number): Level {
  return score >= 70 ? "high" : score >= 35 ? "medium" : "low";
}

const LEVEL_TEXT: Record<Level, string> = { low: "text-con-good", medium: "text-con-warn", high: "text-con-bad" };
const LEVEL_BG: Record<Level, string> = { low: "bg-con-good", medium: "bg-con-warn", high: "bg-con-bad" };

/** Minutes (possibly fractional) to a short label: "45s", "7m 30s", "1h 15m". */
export function minutesLabel(min: number): string {
  if (!Number.isFinite(min)) return "?";
  const s = Math.round(min * 60);
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  return r ? `${m}m ${r}s` : `${m}m`;
}

/**
 * "What happens" simulator: pick a risk score and see the plan Alror would choose with
 * the policy as currently edited (unsaved changes included), bake times scaled by
 * bake_scale, and the rollback rule in one sentence.
 */
export function PolicySimulator({ form }: { form: PolicyForm }) {
  const [score, setScore] = useState(52);
  const id = useId();
  const level = levelFor(score);
  const steps = form.plans[level] ?? [];
  const scale = Number.isFinite(form.bake_scale) && form.bake_scale > 0 ? form.bake_scale : 1;
  const canary = steps.slice(0, -1);
  const total = canary.reduce((t, s) => t + (Number.isFinite(s.bakeMin) ? s.bakeMin : 0) * scale, 0);
  const metrics = form.thresholds.filter((t) => t.metric);
  const alpha = Number.isFinite(form.alpha) ? form.alpha : 0.05;

  const rule =
    metrics.length === 0
      ? "No metric thresholds are set, so no stage can fail verification."
      : `At every stage, Alror compares the canary with stable. If ${metrics
          .map((t) => `${metricLabel(t.metric).toLowerCase()} is more than ${Number.isFinite(t.pct) ? t.pct : "?"}% worse`)
          .join(
            " or ",
          )}, and the difference is significant (p below ${alpha}, so at most a ${(alpha * 100).toFixed(alpha < 0.01 ? 1 : 0)}% chance it is noise), the stage fails ${
          form.auto_rollback
            ? "and all traffic goes straight back to stable. The release is marked rolled back."
            : "but, in shadow mode, Alror only records the failure as a recommendation and keeps rolling out."
        }`;

  return (
    <section className="rounded-lg border border-con-line bg-con-panel" aria-labelledby={`${id}-t`}>
      <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div>
          <h2 id={`${id}-t`} className="text-[15px] font-semibold">
            What happens
          </h2>
          <p className="mt-0.5 text-[13px] text-con-fg2">Pick a risk score to see the rollout this policy produces. It reflects your unsaved edits.</p>
        </div>
      </header>
      <div className="space-y-5 px-5 pb-5 pt-4">
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={`${id}-s`} className="text-[13px] text-con-fg2">
              Risk score of the change
            </label>
            <span className="text-[13px]">
              <span className="font-mono text-[20px] font-semibold tabular-nums">{score}</span>
              <span className="text-con-fg3"> / 100 · </span>
              <span className={cn("font-medium capitalize", LEVEL_TEXT[level])}>{level} risk</span>
            </span>
          </div>
          <input
            id={`${id}-s`}
            type="range"
            min={0}
            max={100}
            step={1}
            value={score}
            onChange={(e) => setScore(Number(e.target.value))}
            className="mt-2 w-full accent-[#a1a1a1]"
          />
          <div className="relative mt-1 h-1 overflow-hidden rounded-full" aria-hidden>
            <span className="absolute inset-y-0 left-0 w-[35%] bg-con-good/40" />
            <span className="absolute inset-y-0 left-[35%] w-[35%] bg-con-warn/40" />
            <span className="absolute inset-y-0 left-[70%] right-0 bg-con-bad/40" />
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-con-fg3">
            <span>0 low</span>
            <span>35 medium</span>
            <span>70 high</span>
            <span>100</span>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-baseline justify-between text-[13px]">
            <span className="text-con-fg2">
              The <span className="capitalize">{level}</span>-risk plan: {steps.length} stage{steps.length === 1 ? "" : "s"}
            </span>
            <span className="text-con-fg3">
              about <span className="font-mono tabular-nums text-con-fg">{minutesLabel(total)}</span> of baking
              {scale !== 1 && <> (bake scale × {scale})</>}
            </span>
          </div>
          <ol className="space-y-1.5">
            {steps.map((s, i) => {
              const last = i === steps.length - 1;
              const bake = (Number.isFinite(s.bakeMin) ? s.bakeMin : 0) * scale;
              return (
                <li
                  key={`${level}-${i}`}
                  className="con-fade-up grid grid-cols-[64px_minmax(0,1fr)_96px] items-center gap-3 text-[12px]"
                  style={{ animationDelay: `${i * 40}ms` }}
                >
                  <span className="text-con-fg3">Stage {i + 1}</span>
                  <span className="relative h-5 overflow-hidden rounded bg-con-row">
                    <span
                      className={cn("con-ease absolute inset-y-0 left-0 rounded", last ? "bg-con-fg2" : LEVEL_BG[level], !last && "opacity-60")}
                      style={{ width: `${Math.max(2, Math.min(100, Number.isFinite(s.weight) ? s.weight : 0))}%` }}
                    />
                    <span className="absolute inset-y-0 left-2 flex items-center font-mono tabular-nums text-con-fg">
                      {Number.isFinite(s.weight) ? s.weight : "?"}% of traffic
                    </span>
                  </span>
                  <span className="text-right text-con-fg2">{last ? "promote" : `bake ${minutesLabel(bake)}`}</span>
                </li>
              );
            })}
          </ol>
        </div>

        <p className="rounded-md border border-con-line bg-con-bg px-3 py-2.5 text-[13px] leading-relaxed text-con-fg2">{rule}</p>
      </div>
    </section>
  );
}
