"use client";

import { useEffect, useId, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { cn } from "@/lib/site";
import { useInView, useReducedMotion } from "./motion";

// Output transcribed from real `alror` captures (public/generated/cli-*.webp).
type Seg = [string, string?];
type Line = Seg[];

const G = "text-[#35e08f]";
const A = "text-[#f5a524]";
const R = "text-[#f2555a]";
const D = "text-[#6e6e78]";
const W = "text-[#f4f4f5] font-semibold";

const bar = (score: number): Seg[] => {
  const n = Math.round(score / 5);
  const g = Math.min(n, 7);
  const a = Math.max(0, Math.min(n, 14) - 7);
  return [["▮".repeat(g), G], ["▮".repeat(a), A], ["▮".repeat(20 - n), "text-[#2a2a31]"]];
};

const stageTrack = (active: number, color: string, done = -1): Seg[] =>
  [5, 25, 50, 100].flatMap((w, i): Seg[] => {
    const sep: Seg[] = i ? [[" ── ", D]] : [];
    const label = `${w}%`;
    if (i === active) return [...sep, [` ${label} `, color]];
    return [...sep, [label, i <= done ? G : D]];
  });

const verdict = (ok: boolean, m: string, a: string, b: string, d: string, p: string, extra = ""): Line => [
  ["          "],
  [ok ? "✓ " : "✗ ", ok ? G : R],
  [m.padEnd(14), ok ? undefined : R],
  [`${a} vs ${b}`.padEnd(17), ok ? undefined : R],
  [d.padEnd(8), ok ? D : R],
  [p, ok ? D : R],
  [extra ? `  ${extra}` : "", D],
];

const SESSIONS: { id: string; label: string; cmd: string; out: Line[] }[] = [
  {
    id: "risk",
    label: "alror risk",
    cmd: "alror risk",
    out: [
      [],
      [["● ", G], ["CHANGE RISK", D]],
      [],
      [["62 ", A], ...bar(62), ["  MEDIUM RISK", A]],
      [],
      [["PTS  FACTOR             DETAIL", D]],
      [["+12  ", A], ["Critical service   "], ["checkout-api is marked critical", D]],
      [["+12  ", A], ["Recent rollbacks   "], ["2 rollbacks on these services in 30 days", D]],
      [["+10  ", A], ["Sensitive paths    "], ["changes in payment", D]],
      [["+10  ", A], ["No tests changed   "], ["1 code files, 0 test files", D]],
      [["+10  ", A], ["AI-authored        "], ["commit authors or trailers indicate a coding agent", D]],
      [["+8   ", A], ["Small diff         "], ["120 lines changed", D]],
      [],
      [["1 files · services: checkout-api · AI-authored", D]],
      [],
      [["● ", G], ["ROLLOUT PLAN", D]],
      [["5% ── 25% ── 50% ── 100%", D]],
      [["canary · 4 steps · 30m0s of bake time"]],
    ],
  },
  {
    id: "deploy",
    label: "alror deploy",
    cmd: 'alror deploy -s checkout-api -i registry/checkout:1.42 --ref "#4821"',
    out: [
      [],
      [["● ", G], ["RELEASE", D]],
      [["checkout-api", W], ["  registry/checkout:1.42  #4821"]],
      [["dep_20261001T192019_9d55eb", D]],
      [["62 ", A], ...bar(62), ["  medium risk", A]],
      [["target simulated · metrics synthetic · ", D], ["auto-rollback on", G]],
      [],
      [["00:50:19  ", D], ...stageTrack(0, "bg-[#35e08f] text-[#08080a]")],
      verdict(true, "error_rate", "0.208", "0.22", "−5.3%", "p=0.988"),
      verdict(true, "latency_p95", "177", "182", "−2.6%", "p=0.963"),
      [["00:50:21  ", D], ...stageTrack(1, "bg-[#35e08f] text-[#08080a]", 0)],
      verdict(true, "error_rate", "0.197", "0.21", "−6.2%", "p=0.910"),
      verdict(true, "latency_p95", "176", "179", "−1.7%", "p=0.915"),
      [["00:50:23  ", D], ...stageTrack(2, "bg-[#35e08f] text-[#08080a]", 1)],
      verdict(true, "error_rate", "0.205", "0.215", "−4.7%", "p=0.935"),
      verdict(true, "latency_p95", "177", "181", "−2.2%", "p=0.964"),
      [["00:50:25  ", D], ...stageTrack(-1, "", 3)],
      [["          "], ["✓ ", G], ["Verified at every step · promoted checkout-api to 100%", W]],
      [],
      [["→ ", D], ["alror status dep_20261001T192019_9d55eb", G], ["  full event log", D]],
    ],
  },
  {
    id: "rollback",
    label: "a regression",
    cmd: 'alror deploy -s checkout-api -i registry/checkout:1.43 --ref "#4822"',
    out: [
      [],
      [["● ", G], ["RELEASE", D]],
      [["checkout-api", W], ["  registry/checkout:1.43  #4822"]],
      [["dep_20261001T192025_844fe3", D]],
      [["62 ", A], ...bar(62), ["  medium risk", A]],
      [["target simulated · metrics synthetic · ", D], ["auto-rollback on", G]],
      [],
      [["00:50:25  ", D], ...stageTrack(0, "bg-[#35e08f] text-[#08080a]")],
      verdict(false, "error_rate", "0.362", "0.213", "+69.9%", "p=0.000", "up 70% vs baseline (limit 25%, p=0.000)"),
      verdict(true, "latency_p95", "178", "180", "−0.8%", "p=0.899"),
      [["00:50:27  ", D], ...stageTrack(0, "bg-[#f2555a] text-[#08080a]")],
      [["          "], ["✗ ", R], ["Rolled back at 5% traffic · Regression: error_rate up 70% vs baseline (limit 25%, p=0.000)", W]],
      [],
      [["→ ", D], ["alror status dep_20261001T192025_844fe3", G], ["  full event log", D]],
      [],
      [["$ ", G], ["echo $?"]],
      [["2", R], ["   # rolled back: the CI job fails, so the bad release is visible", D]],
    ],
  },
];

export function Terminal() {
  const [active, setActive] = useState(0);
  const [typed, setTyped] = useState(0);
  const [lines, setLines] = useState(0);
  const [ref, inView] = useInView<HTMLDivElement>({ once: true });
  const reduced = useReducedMotion();
  const body = useRef<HTMLDivElement>(null);
  const base = useId();
  const s = SESSIONS[active];
  const fullCmd = s.cmd.length;

  useEffect(() => {
    if (!inView || reduced) return;
    if (typed < fullCmd) {
      const id = setTimeout(() => setTyped((t) => t + 1), typed === 0 ? 400 : 24);
      return () => clearTimeout(id);
    }
    if (lines < s.out.length) {
      const id = setTimeout(() => setLines((l) => l + 1), lines === 0 ? 350 : 55);
      return () => clearTimeout(id);
    }
  }, [inView, reduced, typed, lines, fullCmd, s.out.length]);

  useEffect(() => {
    const el = body.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const shownCmd = reduced ? fullCmd : typed;
  const shownLines = reduced ? s.out.length : lines;
  const typing = shownCmd < fullCmd;

  const pick = (i: number) => {
    setActive(i);
    setTyped(0);
    setLines(0);
  };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = (i + (e.key === "ArrowRight" ? 1 : SESSIONS.length - 1)) % SESSIONS.length;
    pick(next);
    document.getElementById(`${base}-t${next}`)?.focus();
  };

  return (
    <div ref={ref} className="lp-panel overflow-hidden rounded-2xl bg-[#09090b]" data-reveal>
      <div className="flex items-center gap-3 border-b border-[#1d1d22] px-3">
        <div role="tablist" aria-label="Terminal sessions" className="flex min-w-0 gap-1 overflow-x-auto pt-2">
          {SESSIONS.map((x, i) => (
            <button
              key={x.id}
              id={`${base}-t${i}`}
              role="tab"
              type="button"
              aria-selected={i === active}
              aria-controls={`${base}-panel`}
              tabIndex={i === active ? 0 : -1}
              onClick={() => pick(i)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn(
                "-mb-px shrink-0 border-b px-2.5 pb-2 font-mono text-[12px] transition-colors focus-visible:outline-2 focus-visible:outline-white/60",
                i === active ? "border-[#f4f4f5] text-fg" : "border-transparent text-[#6e6e78] hover:text-[#a3a3ad]",
              )}
            >
              {x.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => pick(active)}
          aria-label="Replay this session"
          className="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-md text-[#6e6e78] hover:bg-white/[0.06] hover:text-fg focus-visible:outline-2 focus-visible:outline-white/60"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>
      <div
        id={`${base}-panel`}
        role="tabpanel"
        aria-labelledby={`${base}-t${active}`}
        ref={body}
        tabIndex={0}
        className="lp-scroll h-[468px] overflow-auto px-4 py-4 font-mono text-[11.5px] leading-[19px] text-[#d4d4d8] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white/40 sm:px-5 sm:text-[12.5px] sm:leading-[20px]"
      >
        <p className="whitespace-pre">
          <span className={G}>$ </span>
          {s.cmd.slice(0, shownCmd)}
          {(typing || shownLines === 0) && <span className="lp-caret" aria-hidden />}
        </p>
        <div className="whitespace-pre" aria-hidden={shownLines < s.out.length}>
          {s.out.slice(0, shownLines).map((line, i) => (
            <div key={`${s.id}-${i}`} className="min-h-[1lh]">
              {line.map(([t, c], j) => (
                <span key={j} className={c}>
                  {t}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
