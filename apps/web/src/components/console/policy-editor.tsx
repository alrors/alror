"use client";

import { useActionState, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Plus, RotateCcw, X } from "lucide-react";
import { Spinner } from "@/components/console/loader";
import { savePolicy, type PolicyResult } from "@/app/app/policies/actions";
import { InfoTip } from "@/components/console/overview/float";
import { policyDiff } from "@/components/console/policy-diff";
import { PolicySimulator, minutesLabel } from "@/components/console/policy-simulator";
import { Card, FormStatus, buttonClass, inputClass, tableCell, tableHead } from "@/components/console/primitives";
import { toast, undoToast } from "@/components/console/shell-toast";
import { metricLabel } from "@/lib/console/format";
import { DEFAULT_PLANS, LEVELS, LIMITS, validatePolicy, type PlanStep, type PolicyErrors, type PolicyForm, type Plans } from "@/lib/console/policy-rules";
import type { Level } from "@/lib/console/types";
import { cn } from "@/lib/site";

type StepState = { weight: string; bake: string };
type State = {
  auto: boolean;
  alpha: string;
  bakeScale: string;
  thresholds: { metric: string; pct: string }[];
  plans: Record<Level, StepState[]>;
};

export type PolicyInitial = {
  autoRollback: boolean;
  alpha: number;
  bakeScale: number;
  maxRegression: Record<string, number>;
  plans: Plans;
};

const LEVEL_RANGE: Record<Level, string> = { low: "score 0 to 34", medium: "score 35 to 69", high: "score 70 to 100" };
const LEVEL_WHY: Record<Level, string> = {
  low: "Small, well-tested changes. Few stages, short bakes.",
  medium: "Typical changes. A small first slice, then steady steps.",
  high: "Critical services, big or untested changes. Start tiny and bake longest.",
};
const LEVEL_DOT: Record<Level, string> = { low: "bg-con-good", medium: "bg-con-warn", high: "bg-con-bad" };

const toSteps = (p: Plans): Record<Level, StepState[]> =>
  Object.fromEntries(LEVELS.map((l) => [l, p[l].map((s) => ({ weight: String(s.weight), bake: String(s.bakeMin) }))])) as Record<Level, StepState[]>;

const pctOf = (fraction: number) => Math.round(fraction * 1000) / 10;

function initialState(i: PolicyInitial): State {
  return {
    auto: i.autoRollback,
    alpha: String(i.alpha),
    bakeScale: String(i.bakeScale),
    thresholds: Object.entries(i.maxRegression).map(([metric, v]) => ({ metric, pct: String(pctOf(v)) })),
    plans: toSteps(i.plans),
  };
}

const num = (s: string) => (s.trim() === "" ? NaN : Number(s));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function toForm(s: State): PolicyForm {
  return {
    auto_rollback: s.auto,
    alpha: num(s.alpha),
    bake_scale: num(s.bakeScale),
    thresholds: s.thresholds.map((t) => ({ metric: t.metric.trim(), pct: num(t.pct) })),
    plans: Object.fromEntries(
      LEVELS.map((l) => [l, s.plans[l].map((st, i, a) => ({ weight: num(st.weight), bakeMin: i === a.length - 1 ? 0 : num(st.bake) }))]),
    ) as Plans,
  };
}

function fromForm(f: PolicyForm): State {
  return {
    auto: f.auto_rollback,
    alpha: String(f.alpha),
    bakeScale: String(f.bake_scale),
    thresholds: f.thresholds.map((t) => ({ metric: t.metric, pct: String(t.pct) })),
    plans: toSteps(f.plans),
  };
}

const planText = (steps: PlanStep[]) => steps.map((s, i) => (i === steps.length - 1 ? `${s.weight}%` : `${s.weight}% ${s.bakeMin}m`)).join(" → ");

/** "Fails if error rate rises more than 25%." */
function thresholdSentence(metric: string, pct: number) {
  return `Fails if ${metricLabel(metric || "metric").toLowerCase()} rises more than ${Number.isFinite(pct) ? `${pct}%` : "?"}`;
}

/**
 * Editable org policy. The default view is the rollback mode and what makes a
 * check fail, in plain words; significance, bake scale, per-metric limits and
 * rollout plans sit under Advanced with their defaults. Saving is immediate with
 * Undo; only turning automatic rollback off asks first. Validates in the browser
 * with the same rules the server action applies.
 */
export function PolicyEditor({
  initial,
  defaults,
  readOnly,
  updatedLabel,
}: {
  initial: PolicyInitial;
  /** The built-in policy, for "Reset to defaults" and the "Default: …" hints. */
  defaults: PolicyInitial;
  readOnly: boolean;
  updatedLabel?: string;
}) {
  const [base, setBase] = useState(() => initialState(initial));
  const baseRef = useRef(base);
  const [s, setS] = useState(base);
  const [shown, setShown] = useState<PolicyErrors>({});
  const [advanced, setAdvanced] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const confirmed = useRef(false);
  const formId = useId();

  const commitBase = (next: State) => {
    baseRef.current = next;
    setBase(next);
  };

  const [state, action, pending] = useActionState<PolicyResult, FormData>(async (prev, fd) => {
    const before = baseRef.current;
    const r = await savePolicy(prev, fd);
    if (r?.ok && r.message === "No changes to save.") toast.info(r.message);
    else if (r?.ok) {
      const savedForm = JSON.parse(String(fd.get("policy"))) as PolicyForm;
      const saved = fromForm(savedForm);
      const diff = policyDiff(toForm(before), savedForm);
      commitBase(saved);
      setS(saved);
      undoToast(
        "Policy saved",
        async () => {
          const undo = new FormData();
          undo.set("policy", JSON.stringify(toForm(before)));
          const u = await savePolicy(undefined, undo);
          if (!u?.ok) return { error: u?.error ?? "Could not restore the previous policy." };
          commitBase(before);
          // Keep anything typed since the save; otherwise show the restored policy.
          setS((cur) => (same(cur, saved) ? before : cur));
          return { ok: true };
        },
        { description: diff.length ? `${diff.map((c) => c.label).slice(0, 3).join(", ")}${diff.length > 3 ? ` and ${diff.length - 3} more` : ""}. Runners pick it up on their next run.` : undefined },
      );
    }
    if (r?.errors) {
      setShown(r.errors);
      setAdvanced(true);
    }
    return r;
  }, undefined);

  const form = useMemo(() => toForm(s), [s]);
  const baseForm = useMemo(() => toForm(base), [base]);
  const live = useMemo(() => validatePolicy(form), [form]);
  const dirty = !same(s, base);
  const changes = useMemo(() => (dirty ? policyDiff(baseForm, form) : []), [dirty, baseForm, form]);
  const defaultState = useMemo(() => initialState(defaults), [defaults]);
  const atDefaults = same(s, defaultState);
  const errors: PolicyErrors = Object.keys(shown).length ? live : {};
  const turningOff = base.auto && !s.auto;
  const ro = readOnly;

  const set = (patch: Partial<State>) => {
    setConfirmOff(false);
    setS((cur) => ({ ...cur, ...patch }));
  };
  const setStep = (l: Level, i: number, patch: Partial<StepState>) =>
    setS((cur) => ({ ...cur, plans: { ...cur.plans, [l]: cur.plans[l].map((st, j) => (j === i ? { ...st, ...patch } : st)) } }));
  const addStep = (l: Level) =>
    setS((cur) => {
      const steps = cur.plans[l];
      if (steps.length >= LIMITS.steps) return cur;
      const last = steps[steps.length - 1];
      const prev = steps[steps.length - 2];
      const w = Math.min(99, Math.max(1, Math.round(((Number(prev?.weight) || 0) + 100) / 2)));
      return { ...cur, plans: { ...cur.plans, [l]: [...steps.slice(0, -1), { weight: String(w), bake: prev?.bake || "10" }, last] } };
    });
  const removeStep = (l: Level, i: number) => setS((cur) => ({ ...cur, plans: { ...cur.plans, [l]: cur.plans[l].filter((_, j) => j !== i) } }));
  const resetPlan = (l: Level) => setS((cur) => ({ ...cur, plans: { ...cur.plans, [l]: toSteps(DEFAULT_PLANS)[l] } }));

  const alphaShown = Number.isFinite(form.alpha) ? form.alpha : "α";
  const defaultPct = (metric: string) => (metric in defaults.maxRegression ? pctOf(defaults.maxRegression[metric]) : null);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start">
      <form
        id={formId}
        action={action}
        onSubmit={(e) => {
          if (Object.keys(live).length) {
            e.preventDefault();
            setShown(live);
            setAdvanced(true);
            return;
          }
          // Turning automatic rollback off is the one change that asks first.
          if (turningOff && !confirmed.current) {
            e.preventDefault();
            setConfirmOff(true);
            return;
          }
          confirmed.current = false;
          setConfirmOff(false);
        }}
        className="min-w-0 space-y-6"
      >
        <input type="hidden" name="policy" value={JSON.stringify(form)} />

        <Card
          title={
            <h2 className="flex items-center gap-1.5 text-[15px] font-semibold text-con-fg">
              Rollback and checks
              <InfoTip label="rollback and checks" align="start">
                What Alror does when a release step fails, and what counts as a failure. Each stage compares the canary with stable; a metric fails only when it is worse
                by more than its limit and the difference is significant.
              </InfoTip>
            </h2>
          }
        >
          <fieldset disabled={ro} className="grid gap-2 sm:grid-cols-2">
            <legend className="sr-only">Rollback mode</legend>
            {[
              { v: true, title: "Automatic rollback", body: "A failed check moves traffic back to stable at once." },
              { v: false, title: "Shadow mode", body: "Failed checks are logged; the rollout continues." },
            ].map((o) => (
              <label
                key={o.title}
                className={cn(
                  "flex min-h-11 cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors duration-150",
                  s.auto === o.v ? "border-con-line-hover bg-con-row/50" : "border-con-line hover:border-con-line-hover",
                  ro && "cursor-default",
                )}
              >
                <input type="radio" name="mode" checked={s.auto === o.v} onChange={() => set({ auto: o.v })} className="mt-1 accent-[#ededed]" />
                <span>
                  <span className="block text-[14px] font-medium text-con-fg">{o.title}</span>
                  <span className="block text-[12px] text-con-fg2">{o.body}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <ul className="mt-4 space-y-1.5 border-t border-con-row pt-4 text-[13px]">
            {form.thresholds.length === 0 ? (
              <li className="text-con-warn">No metrics are checked. Add one under Advanced.</li>
            ) : (
              form.thresholds.map((t, i) => (
                <li key={i} className="flex items-center gap-1.5 text-con-fg">
                  <span>{thresholdSentence(t.metric, t.pct)}</span>
                  {Number.isFinite(t.pct) && (
                    <InfoTip label={`${metricLabel(t.metric || "metric")} check`} align="start">
                      Fails when canary &gt; stable × {(1 + t.pct / 100).toFixed(2)} and the difference is significant (p &lt; {alphaShown}).
                    </InfoTip>
                  )}
                </li>
              ))
            )}
          </ul>
        </Card>

        <details
          open={advanced}
          onToggle={(e) => setAdvanced((e.currentTarget as HTMLDetailsElement).open)}
          className="group rounded-lg border border-con-line bg-con-panel"
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 px-5 py-3 outline-none transition-colors duration-150 hover:bg-con-hover focus-visible:bg-con-hover [&::-webkit-details-marker]:hidden">
            <span className="min-w-0">
              <span className="text-[14px] font-medium text-con-fg">Advanced</span>
              <span className="ml-2 text-[12.5px] text-con-fg3">Significance, bake time, limits, rollout plans</span>
            </span>
            <ChevronDown size={14} className="shrink-0 text-con-fg3 transition-transform duration-200 group-open:rotate-180" />
          </summary>

          <div className="divide-y divide-con-line border-t border-con-line">
            <dl className="grid gap-5 px-5 py-4 text-[13px] sm:grid-cols-2">
              <NumberRow
                label="Significance (alpha)"
                info={
                  Number.isFinite(form.alpha)
                    ? `How sure Alror must be before it calls a regression real. At ${form.alpha}, a flagged regression has at most a ${(form.alpha * 100).toFixed(form.alpha < 0.01 ? 1 : 0)}% chance of being noise. Lower means fewer false rollbacks, but small regressions take longer to catch.`
                    : "How sure Alror must be before it calls a regression real."
                }
                hint={`Default: ${defaults.alpha} · ${LIMITS.alpha.min} to ${LIMITS.alpha.max}`}
                value={s.alpha}
                onChange={(v) => set({ alpha: v })}
                step="0.001"
                error={errors.alpha}
                disabled={ro}
              />
              <NumberRow
                label="Bake scale"
                info={
                  Number.isFinite(form.bake_scale)
                    ? form.bake_scale === 1
                      ? "Multiplies every bake time in the plans below. At 1, a 10 minute bake waits 10 minutes."
                      : `Multiplies every bake time in the plans below. At ${form.bake_scale}, a 10 minute bake waits ${minutesLabel(10 * form.bake_scale)}. ${form.bake_scale < 1 ? "Faster rollouts, less evidence per stage." : "Slower rollouts, more evidence per stage."}`
                    : "Multiplies every bake time in the plans below."
                }
                hint={`Default: ×${defaults.bakeScale} · ${LIMITS.bakeScale.min} to ${LIMITS.bakeScale.max}`}
                value={s.bakeScale}
                onChange={(v) => set({ bakeScale: v })}
                step="0.01"
                error={errors.bake_scale}
                disabled={ro}
              />
            </dl>

            <section aria-label="Limits per metric">
              <h3 className="flex items-center gap-1.5 px-5 pt-4 text-[13px] font-medium text-con-fg">
                Limits per metric
                <InfoTip label="limits per metric" align="start">
                  How much worse than stable the canary may get, per metric, before its check fails.
                </InfoTip>
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-[14px]">
                  <thead className="border-b border-con-line">
                    <tr>
                      <th className={tableHead}>Metric</th>
                      <th className={cn(tableHead, "w-36 text-right")}>Max rise</th>
                      {!ro && <th className={cn(tableHead, "w-12")} />}
                    </tr>
                  </thead>
                  <tbody>
                    {s.thresholds.map((t, i) => {
                      const err = errors[`thresholds.${i}`];
                      const d = defaultPct(t.metric.trim());
                      return (
                        <tr key={i} className="border-b border-con-row align-top last:border-0">
                          <td className={cn(tableCell, "py-2")}>
                            <input
                              aria-label="Metric name"
                              value={t.metric}
                              disabled={ro}
                              onChange={(e) => set({ thresholds: s.thresholds.map((x, j) => (j === i ? { ...x, metric: e.target.value } : x)) })}
                              aria-invalid={Boolean(err)}
                              spellCheck={false}
                              className={cn(inputClass, "font-mono")}
                            />
                            <div className="mt-1 text-[12px] text-con-fg3">
                              {err ? <span className="text-con-bad">{err}</span> : d != null ? `Default: +${d}%` : "Not in the defaults"}
                            </div>
                          </td>
                          <td className={cn(tableCell, "py-2")}>
                            <span className="flex items-center justify-end gap-1.5">
                              <span className="text-con-fg3">+</span>
                              <input
                                aria-label={`Max rise for ${t.metric}`}
                                type="number"
                                inputMode="decimal"
                                min={LIMITS.pct.min}
                                max={LIMITS.pct.max}
                                step="0.1"
                                value={t.pct}
                                disabled={ro}
                                onChange={(e) => set({ thresholds: s.thresholds.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)) })}
                                aria-invalid={Boolean(err)}
                                className={cn(inputClass, "w-20 text-right font-mono tabular-nums")}
                              />
                              <span className="text-con-fg3">%</span>
                            </span>
                          </td>
                          {!ro && (
                            <td className={cn(tableCell, "py-2 text-right")}>
                              <button
                                type="button"
                                aria-label={`Remove ${t.metric || "metric"}`}
                                onClick={() => set({ thresholds: s.thresholds.filter((_, j) => j !== i) })}
                                className="grid h-11 w-11 place-items-center rounded-md text-con-fg3 hover:bg-con-hover hover:text-con-fg sm:h-8 sm:w-8"
                              >
                                <X size={14} />
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {(!ro || errors.thresholds) && (
                <div className="flex items-center justify-between gap-3 border-t border-con-row px-5 py-3">
                  {errors.thresholds ? <span className="text-[12px] text-con-bad">{errors.thresholds}</span> : <span />}
                  {!ro && (
                    <button
                      type="button"
                      disabled={s.thresholds.length >= LIMITS.metrics}
                      onClick={() => set({ thresholds: [...s.thresholds, { metric: "", pct: "20" }] })}
                      className={buttonClass.secondary}
                    >
                      <Plus size={14} />
                      Add metric
                    </button>
                  )}
                </div>
              )}
            </section>

            <section aria-label="Rollout plans">
              <h3 className="flex items-center gap-1.5 px-5 pt-4 text-[13px] font-medium text-con-fg">
                Rollout plans
                <InfoTip label="rollout plans" align="start">
                  Alror picks one plan from the change&apos;s risk score. Each stage sends a share of traffic to the canary and bakes while it compares metrics with stable;
                  it moves on only if the checks pass. The last stage promotes to 100%.
                </InfoTip>
              </h3>
              <div className="divide-y divide-con-row">
                {LEVELS.map((lvl) => {
                  const steps = s.plans[lvl];
                  const total = steps.slice(0, -1).reduce((t, x) => t + (num(x.bake) || 0), 0);
                  const scaled = total * (Number.isFinite(form.bake_scale) ? form.bake_scale : 1);
                  const err = errors[`plans.${lvl}`];
                  const isDefault = same(steps, toSteps(DEFAULT_PLANS)[lvl]);
                  return (
                    <div key={lvl} className="grid gap-4 px-5 py-5 md:grid-cols-[170px_minmax(0,1fr)_120px] md:items-start">
                      <div>
                        <div className="flex items-center gap-2 text-[14px] font-medium capitalize">
                          <span className={cn("h-1.5 w-1.5 rounded-full", LEVEL_DOT[lvl])} aria-hidden />
                          {lvl} risk
                          <InfoTip label={`${lvl} risk plan`} align="start">
                            {LEVEL_WHY[lvl]}
                          </InfoTip>
                        </div>
                        <div className="mt-0.5 text-[13px] text-con-fg3">{LEVEL_RANGE[lvl]}</div>
                        {!isDefault && <div className="mt-1 text-[12px] text-con-fg2">Customised</div>}
                      </div>
                      <div className="min-w-0">
                        <ol className="flex flex-wrap items-center gap-2">
                          {steps.map((st, i) => {
                            const last = i === steps.length - 1;
                            return (
                              <li key={i} className="flex items-center gap-2">
                                <span className="flex items-center gap-1.5 rounded-md border border-con-line bg-con-bg px-2 py-1.5">
                                  <input
                                    aria-label={`${lvl} stage ${i + 1} traffic percent`}
                                    type="number"
                                    min={1}
                                    max={100}
                                    step={1}
                                    value={st.weight}
                                    disabled={ro || last}
                                    onChange={(e) => setStep(lvl, i, { weight: e.target.value })}
                                    className="w-11 bg-transparent text-right font-mono text-[13px] tabular-nums text-con-fg outline-none disabled:text-con-fg"
                                  />
                                  <span className="text-[12px] text-con-fg3">%</span>
                                  {last ? (
                                    <span className="ml-1 text-[12px] text-con-fg3">promote</span>
                                  ) : (
                                    <>
                                      <input
                                        aria-label={`${lvl} stage ${i + 1} bake minutes`}
                                        type="number"
                                        min={1}
                                        max={LIMITS.bakeMin}
                                        step={1}
                                        value={st.bake}
                                        disabled={ro}
                                        onChange={(e) => setStep(lvl, i, { bake: e.target.value })}
                                        className="ml-1 w-10 bg-transparent text-right font-mono text-[12px] tabular-nums text-con-fg2 outline-none"
                                      />
                                      <span className="text-[12px] text-con-fg3">m bake</span>
                                      {!ro && steps.length > 1 && (
                                        <button
                                          type="button"
                                          aria-label={`Remove ${lvl} stage ${i + 1}`}
                                          onClick={() => removeStep(lvl, i)}
                                          className="ml-0.5 grid h-5 w-5 place-items-center rounded text-con-fg3 hover:text-con-fg"
                                        >
                                          <X size={12} />
                                        </button>
                                      )}
                                    </>
                                  )}
                                </span>
                                {!last && (
                                  <span className="text-con-fg3" aria-hidden>
                                    →
                                  </span>
                                )}
                              </li>
                            );
                          })}
                        </ol>
                        {err ? (
                          <p className="mt-2 text-[12px] text-con-bad">{err}</p>
                        ) : (
                          <p className="mt-2 font-mono text-[11.5px] text-con-fg3">Default: {planText(DEFAULT_PLANS[lvl])}</p>
                        )}
                        {!ro && (
                          <div className="mt-2 flex gap-3 text-[12px]">
                            <button
                              type="button"
                              disabled={steps.length >= LIMITS.steps}
                              onClick={() => addStep(lvl)}
                              className="inline-flex min-h-8 items-center gap-1 text-con-fg2 hover:text-con-fg disabled:opacity-50"
                            >
                              <Plus size={12} /> Add stage
                            </button>
                            {!isDefault && (
                              <button type="button" onClick={() => resetPlan(lvl)} className="inline-flex min-h-8 items-center gap-1 text-con-fg2 hover:text-con-fg">
                                <RotateCcw size={12} /> Reset to default
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="text-[13px] text-con-fg2 md:text-right">
                        <span className="font-mono tabular-nums text-con-fg">{Math.round(total)}m</span> total bake
                        <div className="text-[12px] text-con-fg3">{steps.length} stages</div>
                        {Number.isFinite(form.bake_scale) && form.bake_scale !== 1 && (
                          <div className="text-[12px] text-con-fg3">
                            about {minutesLabel(scaled)} at × {form.bake_scale}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        </details>

        {!ro && (
          <div className="sticky bottom-0 z-10 -mx-1 rounded-lg border border-con-line bg-con-panel px-4 py-3">
            {confirmOff && turningOff ? (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-3">
                <p className="min-w-0 flex-1 basis-64 text-[13px] text-con-fg">
                  Turn off automatic rollback? Services that follow the org default will keep rolling out after a failed check; it is only logged.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setConfirmOff(false)} className={buttonClass.secondary}>
                    Cancel
                  </button>
                  <button type="submit" disabled={pending} onClick={() => (confirmed.current = true)} className={buttonClass.danger}>
                    {pending && <Spinner />}
                    Turn off and save
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 text-[13px]">
                  {state?.error && !dirty ? (
                    <FormStatus error={state.error} />
                  ) : (
                    <span className="text-con-fg3">
                      {state?.error ? <span className="text-con-bad">{state.error}</span> : dirty ? `${changes.length} unsaved change${changes.length === 1 ? "" : "s"}.` : (updatedLabel ?? "No changes.")}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={atDefaults || pending}
                    onClick={() => {
                      set(defaultState);
                      setShown({});
                    }}
                    title="Load the built-in policy into the editor. Nothing is saved until you save."
                    className={buttonClass.secondary}
                  >
                    <RotateCcw size={13} />
                    Reset to defaults
                  </button>
                  <button
                    type="button"
                    disabled={!dirty || pending}
                    onClick={() => {
                      set(base);
                      setShown({});
                    }}
                    className={buttonClass.secondary}
                  >
                    Discard
                  </button>
                  <button type="submit" disabled={!dirty || pending} className={buttonClass.primary}>
                    {pending && <Spinner />}
                    Save
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </form>

      <aside className="min-w-0 xl:sticky xl:top-0">
        <PolicySimulator form={form} />
      </aside>
    </div>
  );
}

function NumberRow({
  label,
  info,
  hint,
  value,
  onChange,
  step,
  error,
  disabled,
}: {
  label: string;
  info: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  step: string;
  error?: string;
  disabled: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <dt className="flex items-center gap-1.5 text-con-fg2">
          {label}
          <InfoTip label={label} align="start">
            {info}
          </InfoTip>
        </dt>
        <dd>
          <input
            aria-label={label}
            type="number"
            inputMode="decimal"
            step={step}
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={Boolean(error)}
            className={cn(inputClass, "w-24 text-right font-mono tabular-nums")}
          />
        </dd>
      </div>
      <p className={cn("mt-1 text-right text-[12px]", error ? "text-con-bad" : "text-con-fg3")}>{error ?? hint}</p>
    </div>
  );
}
