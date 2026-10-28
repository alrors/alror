"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, CircleSlash, ShieldCheck } from "lucide-react";
import { judgeRecommendation, saveRampSettings, switchRollbackMode, type RampSettingsResult } from "@/app/app/trust-ramp-actions";
import { Spinner } from "@/components/console/loader";
import { Card, FormStatus, Pill, buttonClass, inputClass } from "@/components/console/primitives";
import { toast, toastActionError } from "@/components/console/shell-toast";
import type { ActionResult } from "@/lib/console/action-result";
import { RAMP_LIMITS, rampProgress, type RampEvaluation, type RampStatus, type ShadowFeedback, type TrustRampSettings } from "@/lib/console/trust-ramp";
import { cn } from "@/lib/site";

const STATUS: Record<RampStatus, { label: string; className: string }> = {
  automatic: { label: "Automatic", className: "text-con-good" },
  eligible: { label: "Ready", className: "text-con-info" },
  building: { label: "Shadow", className: "text-con-fg2" },
  reset: { label: "Shadow · reset", className: "text-con-warn" },
};

/** One segment per required confirmation; filled ones are confirmed. */
function Progress({ e }: { e: RampEvaluation }) {
  const filled = Math.min(e.confirmed, e.required);
  return (
    <div className="flex items-center gap-2.5">
      <span aria-hidden className="flex gap-[3px]">
        {Array.from({ length: Math.min(e.required, 12) }, (_, i) => (
          <span
            key={i}
            className={cn("h-1.5 w-4 rounded-full transition-colors duration-300", i < filled ? (e.false_alarms ? "bg-con-warn" : "bg-con-good") : "bg-con-row")}
            style={{ transitionDelay: `${i * 40}ms` }}
          />
        ))}
      </span>
      <span className="whitespace-nowrap font-mono text-[12px] tabular-nums text-con-fg2">{rampProgress(e)}</span>
    </div>
  );
}

/** Accessible on/off switch that submits the new mode. */
function ModeSwitch({ e, disabled }: { e: RampEvaluation; disabled: boolean }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(switchRollbackMode, undefined);
  useEffect(() => {
    if (state?.ok && state.message) toast.success(state.message);
    else if (state?.error) toastActionError(state.error);
  }, [state]);
  const on = e.mode === "auto";
  const next = on ? "shadow" : "auto";
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="service" value={e.service} />
      <input type="hidden" name="mode" value={next} />
      {pending && <Spinner size={12} />}
      <button
        type="submit"
        role="switch"
        aria-checked={on}
        aria-label={`Automatic rollback for ${e.service}`}
        title={disabled ? "Only owners and admins can change this" : on ? "Switch back to shadow mode (restarts the ramp)" : e.eligible ? "Graduate to automatic rollback" : "Switch to automatic rollback before the ramp completes"}
        disabled={disabled || pending}
        className={cn(
          "relative h-[18px] w-8 shrink-0 rounded-full border outline-none transition-colors duration-200 focus-visible:ring-1 focus-visible:ring-con-line-hover disabled:cursor-not-allowed disabled:opacity-50",
          on ? "border-con-good/50 bg-con-good/30" : "border-con-line bg-con-row",
        )}
      >
        <span
          aria-hidden
          className={cn("absolute top-[2px] h-3 w-3 rounded-full transition-[left,background-color] duration-200 ease-out", on ? "left-[16px] bg-con-good" : "left-[2px] bg-con-fg3")}
        />
      </button>
    </form>
  );
}

function RampRow({ e, admin }: { e: RampEvaluation; admin: boolean }) {
  const st = STATUS[e.status];
  return (
    <li className="grid gap-x-5 gap-y-1.5 px-5 py-3.5 md:grid-cols-[minmax(140px,1fr)_minmax(200px,auto)_minmax(0,2.2fr)_auto] md:items-center">
      <div className="min-w-0">
        <Link href={`/app/services/${encodeURIComponent(e.service)}`} className="text-[14px] font-medium text-con-fg hover:underline hover:underline-offset-4">
          {e.service}
        </Link>
        <p className="mt-0.5 flex items-center gap-1.5 text-[12px]">
          <span className={st.className}>{st.label}</span>
          {!e.explicit && <span className="text-con-fg3">· org default</span>}
        </p>
      </div>
      <Progress e={e} />
      <p className="min-w-0 text-[12.5px] leading-relaxed text-con-fg2">{e.why}</p>
      <div className="flex items-center justify-end">
        <ModeSwitch e={e} disabled={!admin} />
      </div>
    </li>
  );
}

function Settings({ settings, admin }: { settings: TrustRampSettings; admin: boolean }) {
  const [state, action, pending] = useActionState<RampSettingsResult, FormData>(saveRampSettings, undefined);
  const [auto, setAuto] = useState(settings.auto_graduate);
  const errors = state?.errors ?? {};
  const field = (k: keyof typeof RAMP_LIMITS, label: string, unit: string) => (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[12px] text-con-fg2">{label}</span>
      <span className="flex items-center gap-1.5">
        <input
          name={k}
          type="number"
          inputMode="numeric"
          min={RAMP_LIMITS[k].min}
          max={RAMP_LIMITS[k].max}
          step={1}
          defaultValue={settings[k]}
          disabled={!admin}
          aria-invalid={Boolean(errors[k])}
          className={cn(inputClass, "w-20 font-mono tabular-nums")}
        />
        <span className="text-[12px] text-con-fg3">{unit}</span>
      </span>
      {errors[k] && <span className="text-[11.5px] text-con-bad">{errors[k]}</span>}
    </label>
  );
  return (
    <form action={action} className="border-t border-con-line px-5 py-4">
      <fieldset disabled={!admin || pending} className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-start">
        <legend className="sr-only">Trust ramp settings</legend>
        <div className="space-y-2">
          {[
            { v: false, title: "Propose only", body: "Eligible services show up in Needs you; a person flips the switch." },
            { v: true, title: "Graduate automatically", body: "Eligible services switch to automatic rollback on their own. Every switch is audited." },
          ].map((o) => (
            <label
              key={o.title}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 transition-colors duration-150",
                auto === o.v ? "border-con-line-hover bg-con-row/50" : "border-con-line hover:border-con-line-hover",
                !admin && "cursor-default",
              )}
            >
              <input type="radio" name="graduation" checked={auto === o.v} onChange={() => setAuto(o.v)} className="mt-1 accent-[#ededed]" />
              <span>
                <span className="block text-[13px] font-medium text-con-fg">{o.title}</span>
                <span className="block text-[12px] text-con-fg2">{o.body}</span>
              </span>
            </label>
          ))}
          <input type="hidden" name="auto_graduate" value={auto ? "on" : ""} />
        </div>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-4">
            {field("required_confirmed", "Confirmed needed", "recs")}
            {field("false_alarm_days", "No false alarm in", "days")}
            {field("window_hours", "Confirmation window", "hours")}
          </div>
          <p className="text-[12px] leading-relaxed text-con-fg3">
            A recommendation is confirmed when the release is rolled back, or replaced after an alert, within the window, or when a person marks it correct. A false alarm resets the ramp.
          </p>
          {admin && (
            <div className="flex items-center gap-3">
              <button type="submit" className={buttonClass.secondary}>
                {pending && <Spinner size={12} />}
                Save ramp settings
              </button>
              <FormStatus error={state?.error} message={state?.message} />
            </div>
          )}
        </div>
      </fieldset>
    </form>
  );
}

/** Policies → Trust ramp: services with mode, progress, why, and the switch. */
export function TrustRampCard({
  services,
  settings,
  orgAutoRollback,
  admin,
}: {
  services: RampEvaluation[];
  settings: TrustRampSettings;
  orgAutoRollback: boolean;
  admin: boolean;
}) {
  const ready = services.filter((s) => s.eligible).length;
  const order: Record<RampStatus, number> = { eligible: 0, reset: 1, building: 2, automatic: 3 };
  const sorted = [...services].sort((a, b) => order[a.status] - order[b.status] || b.confirmed - a.confirmed || a.service.localeCompare(b.service));
  // Shadow services with nothing on record yet share one line instead of a row each.
  const quiet = sorted.filter((s) => s.status === "building" && s.recommendations === 0);
  const rows = sorted.filter((s) => !quiet.includes(s));
  return (
    <div id="trust-ramp" className="scroll-mt-20">
      <Card
        title={
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-con-fg">
            <ShieldCheck size={15} className="text-con-fg3" />
            Trust ramp
            {ready > 0 && <Pill className="text-con-info">{ready} ready</Pill>}
          </h2>
        }
        description={`Services earn automatic rollback after ${settings.required_confirmed} confirmed shadow ${settings.required_confirmed === 1 ? "recommendation" : "recommendations"} and no false alarms in ${settings.false_alarm_days} days. ${
          settings.auto_graduate ? "Eligible services graduate automatically." : "Graduation is proposed; a person decides."
        } New services follow the organization default (${orgAutoRollback ? "automatic" : "shadow"}).`}
        flush
      >
        {sorted.length === 0 ? (
          <p className="px-5 py-5 text-[13px] text-con-fg3">No services yet.</p>
        ) : (
          <>
            {rows.length > 0 && (
              <ul className="con-stagger divide-y divide-con-row">
                {rows.map((e) => (
                  <RampRow key={e.service} e={e} admin={admin} />
                ))}
              </ul>
            )}
            {quiet.length > 0 && (
              <details className={cn("group", rows.length > 0 && "border-t border-con-row")}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-3 text-[12.5px] text-con-fg2 outline-none transition-colors duration-150 hover:bg-con-hover focus-visible:bg-con-hover [&::-webkit-details-marker]:hidden">
                  <span className="min-w-0">
                    <span className="text-con-fg">{quiet.length} shadow {quiet.length === 1 ? "service has" : "services have"} no recommendations yet</span>
                    <span className="text-con-fg3"> · {quiet.slice(0, 4).map((s) => s.service).join(", ")}{quiet.length > 4 ? ", …" : ""}</span>
                  </span>
                  <ChevronDown size={14} className="shrink-0 text-con-fg3 transition-transform duration-200 group-open:rotate-180" />
                </summary>
                <ul className="con-fade divide-y divide-con-row border-t border-con-row">
                  {quiet.map((e) => (
                    <RampRow key={e.service} e={e} admin={admin} />
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
        <Settings settings={settings} admin={admin} />
      </Card>
    </div>
  );
}

const SMALL = "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium outline-none transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-con-line-hover disabled:opacity-60";

/** "Correct" / "False alarm" on a shadow recommendation. Pressing the active answer clears it. */
export function RecommendationFeedback({ id, current, className }: { id: string; current: ShadowFeedback | null; className?: string }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(judgeRecommendation, undefined);
  useEffect(() => {
    if (state?.ok && state.message) toast.success(state.message, { description: "The trust ramp counts it from now on." });
    else if (state?.error) toastActionError(state.error);
  }, [state]);
  const btn = (verdict: ShadowFeedback, label: string, Icon: typeof Check) => {
    const active = current === verdict;
    return (
      <button
        type="submit"
        name="verdict"
        value={active ? "clear" : verdict}
        disabled={pending}
        aria-pressed={active}
        title={active ? "Clear this answer" : verdict === "correct" ? "The rollback recommendation was right" : "Nothing was wrong: the recommendation was a false alarm"}
        className={cn(
          SMALL,
          active
            ? verdict === "correct"
              ? "border-con-good/50 bg-con-good/10 text-con-good"
              : "border-con-warn/50 bg-con-warn/10 text-con-warn"
            : "border-con-line text-con-fg2 hover:border-con-line-hover hover:bg-con-hover hover:text-con-fg",
        )}
      >
        <Icon size={12} />
        {label}
      </button>
    );
  };
  return (
    <form action={action} className={cn("inline-flex items-center gap-1.5", className)}>
      <input type="hidden" name="id" value={id} />
      {btn("correct", "Correct", Check)}
      {btn("false_alarm", "False alarm", CircleSlash)}
      {pending && <Spinner size={12} />}
    </form>
  );
}
