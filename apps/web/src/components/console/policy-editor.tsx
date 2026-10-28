"use client";

import { useActionState, useCallback, useId, useMemo, useState } from "react";
import { Plus, RotateCcw, X } from "lucide-react";
import { Spinner } from "@/components/console/loader";
import { savePolicy, type PolicyResult } from "@/app/app/policies/actions";
import { Dialog } from "@/components/console/dialog";
import { PolicyDiffList, policyDiff } from "@/components/console/policy-diff";
import { PolicySimulator, minutesLabel } from "@/components/console/policy-simulator";
import { Card, FormStatus, buttonClass, inputClass, tableCell, tableHead } from "@/components/console/primitives";
import { metricLabel } from "@/lib/console/format";
import { DEFAULT_PLANS, LEVELS, LIMITS, validatePolicy, type PolicyErrors, type PolicyForm, type Plans } from "@/lib/console/policy-rules";
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

function initialState(i: PolicyInitial): State {
  return {
    auto: i.autoRollback,
    alpha: String(i.alpha),
    bakeScale: String(i.bakeScale),
    thresholds: Object.entries(i.maxRegression).map(([metric, v]) => ({ metric, pct: String(Math.round(v * 1000) / 10) })),
    plans: toSteps(i.plans),
  };
}

const num = (s: string) => (s.trim() === "" ? NaN : Number(s));

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

/**
 * Editable org policy: rollback mode, verification thresholds and rollout plans.
 * Validates in the browser with the same rules the server action applies.
 */
export function PolicyEditor({
  initial,
  defaults,
  readOnly,
  updatedLabel,
}: {
  initial: PolicyInitial;
  /** The built-in policy, for "Reset to defaults". */
  defaults: PolicyInitial;
  readOnly: boolean;
  updatedLabel?: string;
}) {
  const [base, setBase] = useState(() => initialState(initial));
  const [s, setS] = useState(base);
  const [shown, setShown] = useState<PolicyErrors>({});
  const [review, setReview] = useState(false);
  const formId = useId();
  const closeReview = useCallback(() => setReview(false), []);
  const [state, action, pending] = useActionState<PolicyResult, FormData>(async (prev, fd) => {
    const r = await savePolicy(prev, fd);
    if (r?.ok) {
      const saved = fromForm(JSON.parse(String(fd.get("policy"))) as PolicyForm);
      setBase(saved);
      setS(saved);
    }
    setReview(false);
    if (r?.errors) setShown(r.errors);
    return r;
  }, undefined);

  const form = useMemo(() => toForm(s), [s]);
  const baseForm = useMemo(() => toForm(base), [base]);
  const live = useMemo(() => validatePolicy(form), [form]);
  const dirty = JSON.stringify(s) !== JSON.stringify(base);
  const changes = useMemo(() => (dirty ? policyDiff(baseForm, form) : []), [dirty, baseForm, form]);
  const defaultState = useMemo(() => initialState(defaults), [defaults]);
  const atDefaults = JSON.stringify(s) === JSON.stringify(defaultState);
  const errors: PolicyErrors = Object.keys(shown).length ? live : {};
  const ro = readOnly;

  const set = (patch: Partial<State>) => setS((cur) => ({ ...cur, ...patch }));
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

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start">
      <form
        id={formId}
        action={action}
        onSubmit={(e) => {
          if (Object.keys(live).length) {
            e.preventDefault();
            setShown(live);
            setReview(false);
          }
        }}
        className="min-w-0 space-y-6"
      >
        <input type="hidden" name="policy" value={JSON.stringify(form)} />

        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Rollback and timing" description="What Alror does when a stage fails, how strict verification is, and how long stages bake.">
            <fieldset disabled={ro} className="space-y-2">
              <legend className="sr-only">Rollback mode</legend>
              {[
                { v: true, title: "Automatic rollback", body: "A failed verdict shifts traffic back to stable immediately, without waiting for a human." },
                { v: false, title: "Shadow mode", body: "Failed verdicts are logged as recommendations; the rollout continues." },
              ].map((o) => (
                <label
                  key={o.title}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors duration-150",
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
            <dl className="mt-4 space-y-3 border-t border-con-row pt-4 text-[13px]">
              <NumberRow
                label="Significance (alpha)"
                hint={`${LIMITS.alpha.min} to ${LIMITS.alpha.max}`}
                explain={
                  Number.isFinite(form.alpha)
                    ? `How sure Alror must be before it calls a regression real. At ${form.alpha}, a flagged regression has at most a ${(form.alpha * 100).toFixed(form.alpha < 0.01 ? 1 : 0)}% chance of being noise. Lower means fewer false rollbacks, but small regressions take longer to catch.`
                    : "How sure Alror must be before it calls a regression real."
                }
                value={s.alpha}
                onChange={(v) => set({ alpha: v })}
                step="0.001"
                error={errors.alpha}
                disabled={ro}
              />
              <NumberRow
                label="Bake scale"
                hint={`${LIMITS.bakeScale.min} to ${LIMITS.bakeScale.max}`}
                explain={
                  Number.isFinite(form.bake_scale)
                    ? form.bake_scale === 1
                      ? "Multiplies every bake time in the plans below. At 1, a 10 minute bake waits 10 minutes."
                      : `Multiplies every bake time in the plans below. At ${form.bake_scale}, a 10 minute bake waits ${minutesLabel(10 * form.bake_scale)}. ${form.bake_scale < 1 ? "Faster rollouts, less evidence per stage." : "Slower rollouts, more evidence per stage."}`
                    : "Multiplies every bake time in the plans below."
                }
                value={s.bakeScale}
                onChange={(v) => set({ bakeScale: v })}
                step="0.01"
                error={errors.bake_scale}
                disabled={ro}
              />
            </dl>
          </Card>

          <Card
            title="Verification thresholds"
            description="How much worse than stable the canary may get, per metric. A metric fails only when it regresses beyond its limit and the difference is significant."
            flush
          >
            <table className="w-full text-[14px]">
              <thead className="border-b border-con-line">
                <tr>
                  <th className={tableHead}>Metric</th>
                  <th className={cn(tableHead, "w-36 text-right")}>Max regression</th>
                  {!ro && <th className={cn(tableHead, "w-10")} />}
                </tr>
              </thead>
              <tbody>
                {s.thresholds.map((t, i) => {
                  const err = errors[`thresholds.${i}`];
                  const pct = num(t.pct);
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
                          {err ? (
                            <span className="text-con-bad">{err}</span>
                          ) : (
                            <>
                              Fails if the canary&apos;s {metricLabel(t.metric || "metric").toLowerCase()} is more than {Number.isFinite(pct) ? `${pct}%` : "?"}{" "}
                              above stable&apos;s{Number.isFinite(pct) ? ` (canary > stable × ${(1 + pct / 100).toFixed(2)}, p < ${alphaShown})` : ""}.
                            </>
                          )}
                        </div>
                      </td>
                      <td className={cn(tableCell, "py-2")}>
                        <span className="flex items-center justify-end gap-1.5">
                          <span className="text-con-fg3">+</span>
                          <input
                            aria-label={`Max regression for ${t.metric}`}
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
                            className="grid h-8 w-8 place-items-center rounded-md text-con-fg3 hover:bg-con-hover hover:text-con-fg"
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
            {(!ro || errors.thresholds) && (
              <div className="flex items-center justify-between gap-3 border-t border-con-line px-5 py-3">
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
          </Card>
        </div>

        <Card
          title="Rollout plans"
          description="Alror picks one plan from the change's risk score. Each stage sends a share of traffic to the canary and waits (bakes) while it compares metrics with stable; it moves on only if verification passes. The last stage promotes to 100%."
          flush
        >
          <div className="divide-y divide-con-row">
            {LEVELS.map((lvl) => {
              const steps = s.plans[lvl];
              const total = steps.slice(0, -1).reduce((t, x) => t + (num(x.bake) || 0), 0);
              const scaled = total * (Number.isFinite(form.bake_scale) ? form.bake_scale : 1);
              const err = errors[`plans.${lvl}`];
              const isDefault = JSON.stringify(steps) === JSON.stringify(toSteps(DEFAULT_PLANS)[lvl]);
              return (
                <div key={lvl} className="grid gap-4 px-5 py-5 md:grid-cols-[170px_minmax(0,1fr)_120px] md:items-start">
                  <div>
                    <div className="flex items-center gap-2 text-[14px] font-medium capitalize">
                      <span className={cn("h-1.5 w-1.5 rounded-full", LEVEL_DOT[lvl])} aria-hidden />
                      {lvl} risk
                    </div>
                    <div className="mt-0.5 text-[13px] text-con-fg3">{LEVEL_RANGE[lvl]}</div>
                    <div className="mt-1 text-[12px] leading-relaxed text-con-fg3">{LEVEL_WHY[lvl]}</div>
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
                    {err && <p className="mt-2 text-[12px] text-con-bad">{err}</p>}
                    {!ro && (
                      <div className="mt-2 flex gap-3 text-[12px]">
                        <button
                          type="button"
                          disabled={steps.length >= LIMITS.steps}
                          onClick={() => addStep(lvl)}
                          className="inline-flex items-center gap-1 text-con-fg2 hover:text-con-fg disabled:opacity-50"
                        >
                          <Plus size={12} /> Add stage
                        </button>
                        {!isDefault && (
                          <button type="button" onClick={() => resetPlan(lvl)} className="inline-flex items-center gap-1 text-con-fg2 hover:text-con-fg">
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
        </Card>

        {!ro && (
          <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-con-line bg-con-panel px-4 py-3">
            <div className="min-w-0 text-[13px]">
              {state?.error || state?.message ? (
                <FormStatus error={state.error} message={!dirty ? state.message : undefined} />
              ) : (
                <span className="text-con-fg3">
                  {dirty ? `${changes.length} unsaved change${changes.length === 1 ? "" : "s"}.` : (updatedLabel ?? "No changes.")}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={atDefaults || pending}
                onClick={() => {
                  setS(defaultState);
                  setShown({});
                }}
                title="Load the built-in policy into the editor. Nothing is saved until you review and save."
                className={buttonClass.secondary}
              >
                <RotateCcw size={13} />
                Reset to defaults
              </button>
              <button
                type="button"
                disabled={!dirty || pending}
                onClick={() => {
                  setS(base);
                  setShown({});
                }}
                className={buttonClass.secondary}
              >
                Discard
              </button>
              <button
                type="button"
                disabled={!dirty || pending}
                onClick={() => {
                  if (Object.keys(live).length) setShown(live);
                  else setReview(true);
                }}
                className={buttonClass.primary}
              >
                Review and save
              </button>
            </div>
          </div>
        )}
      </form>

      <aside className="min-w-0 xl:sticky xl:top-0">
        <PolicySimulator form={form} />
      </aside>

      {review && (
        <Dialog
          open
          onClose={closeReview}
          title="Review policy changes"
          description="CLIs and runners pick up the new policy on their next run. The change is written to the audit log."
          className="max-w-[560px]"
        >
          <PolicyDiffList changes={changes} />
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={closeReview} className={buttonClass.secondary}>
              Keep editing
            </button>
            <button type="submit" form={formId} disabled={pending || changes.length === 0} className={buttonClass.primary} data-autofocus>
              {pending && <Spinner />}
              Save {changes.length} change{changes.length === 1 ? "" : "s"}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function NumberRow({
  label,
  hint,
  explain,
  value,
  onChange,
  step,
  error,
  disabled,
}: {
  label: string;
  hint: string;
  explain?: string;
  value: string;
  onChange: (v: string) => void;
  step: string;
  error?: string;
  disabled: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <dt className="text-con-fg2">{label}</dt>
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
      {explain && <p className="mt-1 text-[12px] leading-relaxed text-con-fg2">{explain}</p>}
    </div>
  );
}
