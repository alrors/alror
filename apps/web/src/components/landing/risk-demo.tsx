"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Bot, FlaskConical } from "lucide-react";
import { cn } from "@/lib/site";
import { LEVEL_COLOR, PLANS, SAMPLES, formatBake, score, withTests } from "./risk-model";
import { RiskSegments } from "./segments";
import { useCountTo, useInView } from "./motion";

export function RiskDemo() {
  const [pick, setPick] = useState(1);
  const [ai, setAi] = useState<boolean | null>(null);
  const [tests, setTests] = useState(false);
  const [ref, inView] = useInView<HTMLDivElement>({ once: true });

  const base = SAMPLES[pick];
  const pr = useMemo(() => {
    let p = { ...base, ai: ai ?? base.ai };
    if (tests) p = withTests(p);
    return p;
  }, [base, ai, tests]);
  const report = useMemo(() => score(pr), [pr]);
  const shown = useCountTo(report.score, inView, 700);
  const plan = PLANS[report.level];
  const color = LEVEL_COLOR[report.level];
  const added = pr.files.reduce((s, f) => s + f.added, 0);
  const deleted = pr.files.reduce((s, f) => s + f.deleted, 0);
  const key = `${pick}-${ai}-${tests}`;

  const choose = (i: number) => {
    setPick(i);
    setAi(null);
    setTests(false);
  };

  return (
    <div ref={ref} className="lp-panel mt-14 grid overflow-hidden rounded-2xl lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]" data-reveal>
      {/* Inputs */}
      <div className="border-b border-[#1d1d22] p-5 sm:p-6 lg:border-r lg:border-b-0">
        <fieldset>
          <legend className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#6e6e78]">Pick a pull request</legend>
          <div className="mt-3 space-y-2">
            {SAMPLES.map((s, i) => {
              const r = score(s);
              const on = i === pick;
              return (
                <label
                  key={s.number}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-white/60",
                    on ? "border-[#34343c] bg-[#16161a]" : "border-[#1d1d22] hover:border-[#2a2a31] hover:bg-[#121215]",
                  )}
                >
                  <input type="radio" name="risk-sample" className="sr-only" checked={on} onChange={() => choose(i)} />
                  <span
                    className={cn("mt-1 h-3.5 w-3.5 shrink-0 rounded-full border", on ? "border-[5px] border-fg" : "border-[#3a3a42]")}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-fg">
                      <span className="text-[#6e6e78]">#{s.number}</span> {s.title}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 font-mono text-[11px] text-[#6e6e78]">
                      {r.services.join(", ")} · {s.author}
                      {s.ai && <span className="rounded border border-[#2a2a31] px-1 text-[#a3a3ad]">AI</span>}
                    </span>
                  </span>
                  <span className="font-mono text-[12px] tabular-nums" style={{ color: LEVEL_COLOR[r.level] }}>
                    {r.score}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <p className="mt-6 font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#6e6e78]">What if</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Toggle pressed={pr.ai} onClick={() => setAi(!pr.ai)} icon={<Bot className="h-3.5 w-3.5" aria-hidden />}>
            Written by an agent
          </Toggle>
          <Toggle pressed={tests} onClick={() => setTests((t) => !t)} icon={<FlaskConical className="h-3.5 w-3.5" aria-hidden />}>
            Tests included
          </Toggle>
        </div>

        <div className="mt-6 rounded-xl border border-[#1d1d22] bg-[#0b0b0d] p-3">
          <p className="flex justify-between font-mono text-[10.5px] text-[#6e6e78]">
            <span>{pr.files.length} files</span>
            <span>
              <span className="text-[#35e08f]">+{added}</span> <span className="text-[#f2555a]">−{deleted}</span>
            </span>
          </p>
          <ul className="mt-2 space-y-1 font-mono text-[11px] leading-5">
            {pr.files.map((f) => (
              <li key={f.path} className="flex justify-between gap-3">
                <span className="truncate text-[#a3a3ad]">{f.path}</span>
                <span className="shrink-0 tabular-nums text-[#55555e]">
                  +{f.added} −{f.deleted}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Result */}
      <div className="flex flex-col p-5 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-[11px] text-[#a3a3ad]">
            <span className="text-fg">Alror / change-risk</span> · check run on #{pr.number}
          </p>
          <p className="font-mono text-[11px] text-[#6e6e78]">{report.services.join(", ")}</p>
        </div>

        <div className="mt-6 flex flex-wrap items-end gap-x-6 gap-y-4" aria-live="polite">
          <p className="flex items-baseline gap-1.5">
            <span className="text-[72px] font-semibold leading-[0.85] tracking-[-0.05em] tabular-nums" style={{ color }}>
              {Math.round(shown)}
            </span>
            <span className="text-[18px] text-[#55555e]">/100</span>
            <span className="sr-only">
              Risk score {report.score} out of 100, {report.level} risk.
            </span>
          </p>
          <div className="pb-1.5">
            <p className="font-mono text-[12px] uppercase tracking-[0.14em]" style={{ color }}>
              {report.level} risk
            </p>
            <RiskSegments score={report.score} className="mt-2" />
          </div>
        </div>

        <table className="mt-7 w-full text-left font-mono text-[12px]">
          <caption className="sr-only">Risk factors</caption>
          <thead>
            <tr className="border-b border-[#1d1d22] text-[10.5px] uppercase tracking-[0.12em] text-[#55555e]">
              <th scope="col" className="w-14 pb-2 font-normal">Pts</th>
              <th scope="col" className="pb-2 font-normal">Factor</th>
              <th scope="col" className="hidden pb-2 font-normal sm:table-cell">Detail</th>
            </tr>
          </thead>
          <tbody key={key}>
            {report.factors.map((f, i) => (
              <tr key={f.name} className="lp-in border-b border-[#16161a] last:border-0" style={{ animationDelay: `${i * 60}ms` }}>
                <td className={cn("py-2 tabular-nums", f.points < 0 ? "text-[#35e08f]" : "text-[#f5a524]")}>
                  {f.points > 0 ? `+${f.points}` : `−${-f.points}`}
                </td>
                <td className="py-2 text-fg">
                  {f.name}
                  <span className="block text-[11px] text-[#6e6e78] sm:hidden">{f.detail}</span>
                </td>
                <td className="hidden py-2 text-[#a3a3ad] sm:table-cell">{f.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-auto pt-7">
          <div className="rounded-xl border border-[#1d1d22] bg-[#0b0b0d] p-4">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#6e6e78]">Rollout plan</p>
            <ol key={report.level} className="mt-3 flex flex-wrap items-center gap-1.5" aria-label={`Canary steps: ${plan.steps.join("%, ")}%`}>
              {plan.steps.map((s, i) => (
                <li key={s} className="lp-in flex items-center gap-1.5" style={{ animationDelay: `${i * 70}ms` }}>
                  {i > 0 && <ArrowRight className="h-3 w-3 text-[#3a3a42]" aria-hidden />}
                  <span
                    className={cn(
                      "rounded-md border px-2 py-1 font-mono text-[12px] tabular-nums",
                      s === 100 ? "border-[#2a2a31] text-fg" : "border-[#24242a] text-[#a3a3ad]",
                    )}
                  >
                    {s}%
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-3 font-mono text-[11.5px] text-[#a3a3ad]">
              canary · {formatBake(report.level)}
              <span className="text-[#55555e]"> · {plan.bakeMin}m bake per step</span>
            </p>
          </div>
          <p className="mt-3 text-[12.5px] leading-relaxed text-[#6e6e78]">
            With <code className="font-mono text-[#a3a3ad]">--fail-above 85</code> the check becomes a merge gate. This change{" "}
            {report.score > 85 ? <span className="text-[#f2555a]">would be blocked</span> : <span className="text-[#a3a3ad]">passes</span>}.
          </p>
        </div>
      </div>
    </div>
  );
}

function Toggle({
  pressed,
  onClick,
  icon,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-lg border px-3 text-[12.5px] transition-colors focus-visible:outline-2 focus-visible:outline-white/60",
        pressed ? "border-[#3a3a42] bg-[#1a1a1f] text-fg" : "border-[#24242a] text-[#a3a3ad] hover:text-fg",
      )}
    >
      {icon}
      {children}
      <span
        className={cn("ml-1 h-3.5 w-6 rounded-full p-[2px] transition-colors", pressed ? "bg-[#f4f4f5]" : "bg-[#2a2a31]")}
        aria-hidden
      >
        <span className={cn("block h-2.5 w-2.5 rounded-full transition-transform", pressed ? "translate-x-2.5 bg-[#0a0a0b]" : "bg-[#6e6e78]")} />
      </span>
    </button>
  );
}
