import { LEVELS, type PlanStep, type PolicyForm } from "@/lib/console/policy-rules";

export type PolicyChange = { label: string; from: string; to: string };

const planText = (steps: PlanStep[]) => steps.map((s, i) => (i === steps.length - 1 ? `${s.weight}%` : `${s.weight}% ${s.bakeMin}m`)).join(" → ");
const show = (v: number) => (Number.isFinite(v) ? String(v) : "?");

/** Human-readable list of what differs between two editor states. */
export function policyDiff(before: PolicyForm, after: PolicyForm): PolicyChange[] {
  const out: PolicyChange[] = [];
  if (before.auto_rollback !== after.auto_rollback)
    out.push({
      label: "Rollback mode",
      from: before.auto_rollback ? "Automatic rollback" : "Shadow mode",
      to: after.auto_rollback ? "Automatic rollback" : "Shadow mode",
    });
  if (before.alpha !== after.alpha) out.push({ label: "Significance (alpha)", from: show(before.alpha), to: show(after.alpha) });
  if (before.bake_scale !== after.bake_scale) out.push({ label: "Bake scale", from: `× ${show(before.bake_scale)}`, to: `× ${show(after.bake_scale)}` });

  const b = new Map(before.thresholds.map((t) => [t.metric, t.pct]));
  const a = new Map(after.thresholds.map((t) => [t.metric, t.pct]));
  for (const [m, pct] of a) {
    if (!b.has(m)) out.push({ label: `Threshold ${m || "(unnamed)"}`, from: "not checked", to: `+${show(pct)}%` });
    else if (b.get(m) !== pct) out.push({ label: `Threshold ${m}`, from: `+${show(b.get(m)!)}%`, to: `+${show(pct)}%` });
  }
  for (const [m, pct] of b) if (!a.has(m)) out.push({ label: `Threshold ${m}`, from: `+${show(pct)}%`, to: "removed" });

  for (const l of LEVELS) {
    const f = planText(before.plans[l]);
    const t = planText(after.plans[l]);
    if (f !== t) out.push({ label: `${l[0].toUpperCase()}${l.slice(1)}-risk plan`, from: f, to: t });
  }
  return out;
}

export function PolicyDiffList({ changes }: { changes: PolicyChange[] }) {
  if (changes.length === 0) return <p className="text-[13px] text-con-fg3">No changes.</p>;
  return (
    <ul className="divide-y divide-con-row rounded-md border border-con-line">
      {changes.map((c) => (
        <li key={c.label} className="px-3 py-2.5">
          <div className="text-[12px] text-con-fg2">{c.label}</div>
          <div className="mt-1 grid gap-1 font-mono text-[12px]">
            <span className="break-words text-con-fg3">
              <span aria-hidden className="mr-1.5 select-none text-con-bad/80">
                −
              </span>
              <span className="sr-only">Before: </span>
              {c.from}
            </span>
            <span className="break-words text-con-fg">
              <span aria-hidden className="mr-1.5 select-none text-con-good/80">
                +
              </span>
              <span className="sr-only">After: </span>
              {c.to}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
