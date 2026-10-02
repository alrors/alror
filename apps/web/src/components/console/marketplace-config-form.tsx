"use client";

import { KeyRound } from "lucide-react";
import { savePlugin, type PluginResult } from "@/app/app/marketplace/actions";
import { CopyButton } from "@/components/console/copy-button";
import { Spinner } from "@/components/console/loader";
import { buttonClass, FormField, FormStatus, hintClass, inputClass } from "@/components/console/primitives";
import { Selector } from "@/components/console/selector";
import { useActionToast, useRetryableAction } from "@/components/console/shell-toast";
import type { ConfigField } from "@/lib/server/marketplace/catalog";
import { cn } from "@/lib/site";

/** A runner-side secret: never entered here, only explained. */
function EnvField({ field }: { field: ConfigField }) {
  return (
    <div className="rounded-md border border-con-line bg-con-bg px-3 py-2.5">
      <div className="flex items-start gap-2.5">
        <KeyRound size={14} className="mt-0.5 shrink-0 text-con-fg3" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-con-fg">
            {field.label}
            {field.required && <span className="text-con-fg3"> (required)</span>}
          </p>
          <p className="mt-0.5 text-[12px] leading-[1.55] text-con-fg2">
            Not stored in Alror. Set <code className="rounded bg-con-row px-1 py-px font-mono text-[12px] text-con-fg">{field.env}</code> in the
            environment of every machine that runs <span className="font-mono text-[12px]">alror deploy</span> or{" "}
            <span className="font-mono text-[12px]">alror runner</span>.
          </p>
        </div>
        {field.env && <CopyButton text={field.env} label="Copy variable name" iconOnly className="h-7 w-7 shrink-0" />}
      </div>
    </div>
  );
}

/**
 * The configuration form generated from a plugin's schema. Submitting installs the
 * plugin, saves its settings, or re-enables it. Members see the values read-only.
 */
export function MarketplaceConfigForm({
  id,
  name,
  fields,
  values,
  state,
  canEdit,
  secretMask,
  replaces,
}: {
  id: string;
  name: string;
  fields: ConfigField[];
  /** Stored non-secret values (or the catalog defaults before install). */
  values: Record<string, string>;
  state: "available" | "installed" | "disabled";
  canEdit: boolean;
  /** Masked form of a stored policy secret (Slack webhook), when one is set. */
  secretMask?: string | null;
  /** For metrics providers: the provider this install would replace. */
  replaces?: string;
}) {
  const [result, action, pending, retry] = useRetryableAction<PluginResult>(savePlugin, undefined);
  useActionToast(result, { retry });

  const submitLabel = state === "available" ? `Install ${name}` : state === "disabled" ? "Save and enable" : "Save configuration";
  const editable = fields.filter((f) => f.storage !== "env");
  const envFields = fields.filter((f) => f.storage === "env");

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="state" value={state} />
      <fieldset disabled={!canEdit || pending} className="space-y-4">
        <legend className="sr-only">{name} settings</legend>
        {editable.map((f) => {
          const fid = `pl-${id}-${f.key}`;
          const label = (
            <>
              {f.label}
              {!f.required && <span className="text-con-fg3"> (optional)</span>}
            </>
          );
          if (f.type === "select") {
            return (
              <FormField key={f.key} label={label} htmlFor={fid} hint={f.help}>
                <Selector
                  id={fid}
                  name={f.key}
                  defaultValue={values[f.key] ?? f.default ?? f.options?.[0]?.value}
                  disabled={!canEdit || pending}
                  required={f.required}
                  options={(f.options ?? []).map((o) => ({ value: o.value, label: o.label, description: o.description, hint: o.description }))}
                />
              </FormField>
            );
          }
          if (f.type === "secret") {
            const hint = secretMask ? (
              <>
                Current: <span className="font-mono">{secretMask}</span>. Leave empty to keep it.
              </>
            ) : (
              f.help
            );
            return (
              <FormField key={f.key} label={label} htmlFor={fid} hint={hint}>
                <input
                  id={fid}
                  name={f.key}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  required={f.required && !secretMask}
                  placeholder={secretMask ? "••••••••  (unchanged)" : f.placeholder}
                  className={cn(inputClass, "font-mono")}
                />
              </FormField>
            );
          }
          if (f.mono) {
            return (
              <FormField key={f.key} label={label} htmlFor={fid} hint={f.help}>
                <textarea
                  id={fid}
                  name={f.key}
                  rows={3}
                  spellCheck={false}
                  required={f.required}
                  defaultValue={values[f.key] ?? f.default ?? ""}
                  placeholder={f.placeholder}
                  className={cn(inputClass, "h-auto resize-y py-2 font-mono text-[12.5px] leading-[1.55]")}
                />
              </FormField>
            );
          }
          return (
            <FormField key={f.key} label={label} htmlFor={fid} hint={f.help}>
              <input
                id={fid}
                name={f.key}
                type={f.type === "url" ? "url" : f.type === "number" ? "number" : "text"}
                inputMode={f.type === "number" ? "decimal" : undefined}
                spellCheck={false}
                required={f.required}
                defaultValue={values[f.key] ?? f.default ?? ""}
                placeholder={f.placeholder}
                className={cn(inputClass, f.type === "url" && "font-mono")}
              />
            </FormField>
          );
        })}
      </fieldset>

      {envFields.length > 0 && (
        <div className="space-y-2">
          <p className="text-[13px] text-con-fg2">Secrets on the runner</p>
          {envFields.map((f) => (
            <EnvField key={f.key} field={f} />
          ))}
        </div>
      )}

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-con-line pt-4">
          <button type="submit" disabled={pending} className={buttonClass.primary}>
            {pending && <Spinner size={14} />}
            {submitLabel}
          </button>
          {replaces && state !== "installed" && <span className={hintClass}>Switches the metrics provider from {replaces} to {name}.</span>}
          <FormStatus error={result?.error} className="w-full" />
        </div>
      ) : (
        <p className="border-t border-con-line pt-4 text-[13px] text-con-fg2">Owners and admins can install and configure plugins. Ask one to change these settings.</p>
      )}
    </form>
  );
}
