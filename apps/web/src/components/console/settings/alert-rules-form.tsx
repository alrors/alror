"use client";

import { useActionState, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { saveAlertRules } from "@/app/app/settings/integrations/actions";
import { FormField, FormStatus, buttonClass, inputClass } from "@/components/console/primitives";
import type { ActionResult } from "@/lib/console/action-types";
import { cn } from "@/lib/site";

type Rules = { auto_rollback: boolean; threshold: number; max_age_minutes: number; window_minutes: number };

/** Automatic rollback switch and its thresholds. Off by default. */
export function AlertRulesForm({ initial }: { initial: Rules }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(saveAlertRules, undefined);
  const [on, setOn] = useState(initial.auto_rollback);
  return (
    <form action={action} className="space-y-5">
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" name="auto_rollback" checked={on} onChange={(e) => setOn(e.target.checked)} className="peer sr-only" />
        <span
          aria-hidden
          className={cn(
            "relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors duration-150 peer-focus-visible:ring-2 peer-focus-visible:ring-con-line-hover",
            on ? "border-con-warn/60 bg-con-warn/80" : "border-con-line-hover bg-con-row",
          )}
        >
          <span className={cn("absolute top-0.5 h-3.5 w-3.5 rounded-full bg-con-fg transition-transform duration-150", on ? "translate-x-[18px]" : "translate-x-0.5")} />
        </span>
        <span>
          <span className="block text-[14px] text-con-fg">Roll back automatically</span>
          <span className="block text-[12.5px] text-con-fg3">
            Only when every rule below passes and no other change is within 15 points. Otherwise Alror suggests and you decide.
          </span>
        </span>
      </label>

      <div className={cn("grid gap-4 sm:grid-cols-3 transition-opacity duration-150", !on && "opacity-60")}>
        <FormField label="Confidence at least" htmlFor="ar-threshold" hint="Top candidate score, 50 to 100.">
          <input id="ar-threshold" name="threshold" type="number" min={50} max={100} defaultValue={initial.threshold} required className={inputClass} />
        </FormField>
        <FormField label="Deployed within (minutes)" htmlFor="ar-age" hint="Before the alert started.">
          <input id="ar-age" name="max_age_minutes" type="number" min={1} max={240} defaultValue={initial.max_age_minutes} required className={inputClass} />
        </FormField>
        <FormField label="Look-back window (minutes)" htmlFor="ar-window" hint="Deployments ranked per alert.">
          <input id="ar-window" name="window_minutes" type="number" min={5} max={1440} defaultValue={initial.window_minutes} required className={inputClass} />
        </FormField>
      </div>
      <p className="text-[12px] text-con-fg3">The service must also match the alert exactly. Each automatic rollback is queued as a job for alror runner and written to the audit log with its evidence.</p>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={buttonClass.primary}>
          {pending && <LoaderCircle size={14} className="animate-spin" />}
          Save rules
        </button>
        <FormStatus error={state?.error} message={state?.message} />
      </div>
    </form>
  );
}
