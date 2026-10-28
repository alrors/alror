"use client";

import { buttonClass, FormField, FormStatus, inputClass } from "@/components/console/primitives";
import { useActionToast, useRetryableAction } from "@/components/console/shell-toast";
import { Spinner } from "@/components/console/loader";
import type { ActionResult } from "@/lib/console/action-types";

export type TuningSettingsForm = { autoApply: boolean; errFloor: number; errCeiling: number; latFloor: number; latCeiling: number; bakeFloor: number };

/** Auto-apply switch plus the floors and ceilings tuning must stay within (percentages). */
export function TuningSettings({
  action,
  initial,
  readOnly,
}: {
  action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>;
  initial: TuningSettingsForm;
  readOnly: boolean;
}) {
  const [state, formAction, pending, retry] = useRetryableAction<ActionResult>(action, undefined);
  useActionToast(state?.error && !state.retryable ? undefined : state, { success: state?.message, retry });
  const num = (name: string, value: number, label: string, hint: string, step = "1") => (
    <FormField label={label} htmlFor={name} hint={hint}>
      <input id={name} name={name} type="number" step={step} min="0" defaultValue={value} disabled={readOnly} className={inputClass} />
    </FormField>
  );
  return (
    <form action={formAction} className="space-y-4">
      <label className="flex items-start gap-2.5 text-[13px]">
        <input type="checkbox" name="auto_apply" defaultChecked={initial.autoApply} disabled={readOnly} className="mt-0.5 h-3.5 w-3.5 accent-[#ededed]" />
        <span>
          <span className="font-medium text-con-fg">Apply proposals automatically</span>
          <span className="block text-con-fg3">Off by default. When on, new proposals are applied as the system and audit-logged; they still respect the bounds below.</span>
        </span>
      </label>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {num("err_floor", initial.errFloor, "Error rate floor %", "Never tighter")}
        {num("err_ceiling", initial.errCeiling, "Error rate ceiling %", "Never looser")}
        {num("lat_floor", initial.latFloor, "Latency p95 floor %", "Never tighter")}
        {num("lat_ceiling", initial.latCeiling, "Latency p95 ceiling %", "Never looser")}
        {num("bake_floor", initial.bakeFloor, "Bake floor ×", "Shortest bake", "0.05")}
      </div>
      {!readOnly && (
        <div className="flex items-center gap-3">
          <button type="submit" disabled={pending} className={buttonClass.secondary}>
            {pending && <Spinner size={14} />}
            Save settings
          </button>
          <FormStatus error={state?.error && !state.retryable ? state.error : undefined} />
        </div>
      )}
    </form>
  );
}
