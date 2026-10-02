import { RiskGauge } from "@/components/console/charts";
import { CountUp } from "@/components/console/count-up";
import { Card, toneHex } from "@/components/console/primitives";
import { LEVEL_BANDS, factorWhy, levelFor } from "@/components/console/release-story";
import { duration, riskTone } from "@/lib/console/format";
import type { Deployment } from "@/lib/console/types";
import { cn } from "@/lib/site";

const bandTone = { low: "bg-con-good", medium: "bg-con-warn", high: "bg-con-bad" } as const;

/** The semicircle risk gauge with the score and level, shown at the top of the release page. */
export function ReleaseRiskGauge({ d }: { d: Deployment }) {
  const score = d.risk?.score ?? 0;
  const level = d.risk?.level ?? levelFor(score);
  return (
    <div className="flex w-[200px] shrink-0 flex-col items-center" aria-label={`Risk ${score} of 100, ${level}`}>
      <RiskGauge score={score} color={toneHex[riskTone(score)]} />
      <div className="-mt-10 flex items-baseline gap-1">
        <CountUp value={score} className="text-[32px] font-semibold tracking-[-0.03em]" />
        <span className="text-[13px] text-con-fg3">/ 100</span>
      </div>
      <span className="mt-1 text-[13px] capitalize text-con-fg2">{level} risk</span>
    </div>
  );
}

/** What moved the risk score, and what it meant for this rollout's plan. */
export function ReleaseRisk({ d }: { d: Deployment }) {
  const score = d.risk?.score ?? 0;
  const level = d.risk?.level ?? levelFor(score);
  const factors = d.risk?.factors ?? [];
  const maxPts = Math.max(1, ...factors.map((f) => Math.abs(f.points)));
  const steps = d.plan?.steps ?? [];
  const band = LEVEL_BANDS.find((b) => b.level === level) ?? LEVEL_BANDS[0];
  const bake = steps.reduce((t, s) => t + (s.bake || 0), 0);
  const first = steps[0]?.weight;
  const raw = factors.reduce((t, f) => t + f.points, 0);

  return (
    <Card
      title="Risk"
      description={(d.risk?.services ?? []).length ? `Services: ${(d.risk?.services ?? []).join(", ")}` : "How risky the change looked before it shipped."}
    >
      {/* Where the score sits (the gauge itself is at the top of the page) */}
      <div>
        <div className="relative flex h-1.5 gap-[2px]" aria-hidden>
          {LEVEL_BANDS.map((b) => (
            <span
              key={b.level}
              className={cn("h-full rounded-full", bandTone[b.level], b.level === level ? "opacity-90" : "opacity-25")}
              style={{ flex: b.to - b.from + 1 }}
            />
          ))}
          <span className="absolute -top-1 h-3.5 w-0.5 -translate-x-1/2 rounded-full bg-con-fg" style={{ left: `${Math.min(100, Math.max(0, score))}%` }} />
        </div>
        <div className="mt-1.5 flex justify-between font-mono text-[11px] text-con-fg3">
          <span>0 low</span>
          <span>35 medium</span>
          <span>70 high</span>
        </div>
      </div>

      <div className="mt-4 rounded-md border border-con-line px-3.5 py-3">
        <div className="text-[13px] font-medium text-con-fg">What {score} meant for this rollout</div>
        <p className="mt-1 text-[13px] leading-relaxed text-con-fg2">
          {band.meaning} It ran {steps.length} stages ({steps.map((s) => `${s.weight}%`).join(" → ")})
          {first !== undefined && first < 100 ? `, starting with ${first}% of traffic` : ""}
          {bake > 0 ? ` and ${duration(bake)} of bake in total.` : "."}
        </p>
      </div>

      <div className="mt-5 border-t border-con-row pt-4">
        <div className="mb-3 flex items-baseline justify-between">
          <span className="text-[13px] font-medium text-con-fg">What raised or lowered it</span>
          {factors.length > 0 && raw !== score && <span className="text-[11px] text-con-fg3">capped to 0 to 100 (sum {raw})</span>}
        </div>
        {factors.length === 0 ? (
          <p className="text-[13px] text-con-fg3">No factors recorded.</p>
        ) : (
          <ul className="con-stagger space-y-3.5">
            {factors.map((f, i) => {
              const why = factorWhy(f.name);
              return (
                <li key={i}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[14px] text-con-fg">{f.name}</span>
                    <span className={cn("font-mono text-[13px] tabular-nums", f.points < 0 ? "text-con-good" : "text-con-fg2")}>
                      {f.points > 0 ? "+" : ""}
                      {f.points}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-con-row">
                    <div
                      className={cn("con-grow-x h-full rounded-full", f.points < 0 ? "bg-con-good" : "bg-con-fg3")}
                      style={{ width: `${(Math.abs(f.points) / maxPts) * 100}%`, animationDelay: `${120 + i * 40}ms` }}
                    />
                  </div>
                  {f.detail && <div className="mt-1 break-words text-[12px] text-con-fg2">{f.detail}</div>}
                  {why && <div className="mt-0.5 text-[12px] text-con-fg3">{why}</div>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}
