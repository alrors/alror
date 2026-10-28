import { Pill, toneBg, toneText } from "@/components/console/primitives";
import type { Tone } from "@/lib/console/format";
import { cn } from "@/lib/site";

// Small presentational pieces shared by /app/incidents and /app/incidents/[id].

export function severityTone(s: string): Tone {
  return s === "critical" ? "bad" : s === "error" ? "bad" : s === "warning" ? "warn" : "info";
}

export function SeverityPill({ severity }: { severity: string }) {
  return (
    <Pill tone={severityTone(severity)} className="capitalize">
      {severity}
    </Pill>
  );
}

export function IncidentStatusPill({ status }: { status: string }) {
  return status === "open" ? <Pill tone="bad">Open</Pill> : <Pill tone="idle">Resolved</Pill>;
}

/** Confidence tone: 80+ strong, 50+ plausible, below that weak. */
export function scoreTone(score: number): Tone {
  return score >= 80 ? "bad" : score >= 50 ? "warn" : "idle";
}

/** Score as a number plus a bar that grows in on mount. */
export function ScoreBar({ score, wide, delay = 0 }: { score: number; wide?: boolean; delay?: number }) {
  const s = Math.max(0, Math.min(100, score));
  return (
    <span className="inline-flex items-center gap-2.5" aria-label={`Score ${score} of 100`}>
      <span className={cn("text-right font-mono tabular-nums", wide ? "w-8 text-[18px] font-semibold text-con-fg" : "w-6 text-[13px] text-con-fg")}>{score}</span>
      <span className={cn("relative overflow-hidden rounded-full bg-con-row", wide ? "h-1.5 w-28" : "h-1 w-12")}>
        <span className={cn("con-grow-x absolute inset-y-0 left-0 rounded-full", toneBg[scoreTone(score)])} style={{ width: `${s}%`, animationDelay: `${delay}ms` }} />
      </span>
    </span>
  );
}

const SIGNAL_LABEL: Record<string, string> = {
  service: "Service",
  recency: "Timing",
  risk: "Risk",
  state: "State",
  metrics: "Metrics",
  environment: "Environment",
};

/** Each signal's contribution: label, points out of its maximum and the reason. */
export function SignalList({ signals }: { signals: { signal: string; points: number; max: number; detail: string }[] }) {
  return (
    <ul className="space-y-1.5">
      {signals.map((s) => {
        const neg = s.points < 0;
        const share = s.max > 0 ? Math.max(0, s.points) / s.max : 0;
        return (
          <li key={s.signal} className="grid grid-cols-[92px_64px_minmax(0,1fr)] items-center gap-3 text-[12.5px]">
            <span className="text-con-fg3">{SIGNAL_LABEL[s.signal] ?? s.signal}</span>
            <span className="flex items-center gap-1.5">
              <span className={cn("w-9 text-right font-mono tabular-nums", neg ? toneText.bad : s.points > 0 ? "text-con-fg" : "text-con-fg3")}>
                {neg ? "" : "+"}
                {s.points}
              </span>
              {s.max > 0 && (
                <span className="relative h-1 w-5 overflow-hidden rounded-full bg-con-row" aria-hidden>
                  <span className="absolute inset-y-0 left-0 rounded-full bg-con-fg2" style={{ width: `${share * 100}%` }} />
                </span>
              )}
            </span>
            <span className={cn("min-w-0", neg ? "text-con-fg" : "text-con-fg2")}>{s.detail}</span>
          </li>
        );
      })}
    </ul>
  );
}
