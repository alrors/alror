"use client";

import { useActionState, useState } from "react";
import { KeyRound } from "lucide-react";
import { createApiKey, type KeyResult } from "@/app/app/settings/actions";
import { CopyButton } from "@/components/console/copy-button";
import { Dialog } from "@/components/console/dialog";
import { Spinner } from "@/components/console/loader";
import { FormField, FormStatus, buttonClass, inputClass } from "@/components/console/primitives";
import { MultiSelector } from "@/components/console/selector";
import { SCOPE_INFO, SCOPE_PRESETS as PRESETS } from "@/components/console/settings/scopes";
import { toast } from "@/components/console/shell-toast";

/** "Create API key" button and dialog. The full token is shown once, right after creation. */
export function ApiKeyCreate({ serverUrl, label = "Create API key", autoOpen = false }: { serverUrl: string; label?: string; autoOpen?: boolean }) {
  // autoOpen: opened from the command palette (?new=1).
  const [open, setOpen] = useState(autoOpen);
  const [round, setRound] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass.primary}>
        <KeyRound size={14} />
        {label}
      </button>
      <KeyDialog
        key={round}
        open={open}
        serverUrl={serverUrl}
        onClose={() => {
          setOpen(false);
          setRound((r) => r + 1); // forget the token once the dialog closes
          if (autoOpen && new URLSearchParams(location.search).has("new")) {
            const url = new URL(location.href);
            url.searchParams.delete("new");
            window.history.replaceState(null, "", url.pathname + url.search);
          }
        }}
      />
    </>
  );
}

function KeyDialog({ open, onClose, serverUrl }: { open: boolean; onClose: () => void; serverUrl: string }) {
  const [state, action, pending] = useActionState<KeyResult, FormData>(async (prev, fd) => {
    const r = await createApiKey(prev, fd);
    if (r?.ok) toast.success(`API key "${r.name}" created`, { description: "Copy it now. It will not be shown again." });
    return r;
  }, undefined);
  const [scopes, setScopes] = useState<string[]>(["deploy:read", "deploy:write"]);

  if (state?.ok && state.token) {
    const login = `alror login --server ${serverUrl} --key ${state.token}`;
    return (
      <Dialog open={open} onClose={onClose} title="Copy your API key" description="This is the only time the full key is shown. Store it in a secret manager.">
        <div className="space-y-4">
          <div>
            <div className="mb-1.5 text-[13px] text-con-fg2">{state.name}</div>
            <div className="flex items-start gap-2">
              <code className="min-w-0 flex-1 break-all rounded-md border border-con-line bg-con-bg px-2.5 py-2 font-mono text-[12.5px] text-con-fg" data-autofocus tabIndex={0}>
                {state.token}
              </code>
              <CopyButton text={state.token} label="Copy key" />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {state.scopes?.map((s) => (
                <span key={s} className="rounded bg-con-row px-1.5 py-0.5 font-mono text-[11px] text-con-fg2">
                  {s}
                </span>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-[13px] text-con-fg2">Connect the CLI</div>
            <div className="flex items-start gap-2 rounded-md border border-con-line bg-con-bg p-2.5">
              <code className="min-w-0 flex-1 break-all font-mono text-[12px] leading-relaxed text-con-fg">{login}</code>
              <CopyButton text={login} iconOnly />
            </div>
          </div>
          <div className="flex justify-end">
            <button type="button" onClick={onClose} className={buttonClass.primary}>
              Done
            </button>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onClose={onClose} title="Create API key" description="Keys authenticate the alror CLI, CI jobs and alror runner.">
      <form action={action} className="space-y-4">
        <FormField label="Name" htmlFor="key-name" hint="Where the key is used, e.g. ci-github or runner-prod-1.">
          <input id="key-name" name="name" required maxLength={80} autoComplete="off" placeholder="ci-github" className={inputClass} />
        </FormField>
        <fieldset className="space-y-2">
          <legend className="mb-1.5 flex w-full items-center justify-between text-[13px] text-con-fg2">
            Scopes
            <span className="flex gap-1">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setScopes(p.scopes)}
                  title={`${p.detail}: ${p.scopes.join(", ")}`}
                  className="rounded border border-con-line px-1.5 py-0.5 text-[11px] text-con-fg2 hover:border-con-line-hover hover:text-con-fg"
                >
                  {p.label}
                </button>
              ))}
            </span>
          </legend>
          <MultiSelector
            name="scopes"
            aria-label="Scopes"
            placeholder="Pick at least one scope"
            value={scopes}
            onValueChange={setScopes}
            searchable={false}
            clearable
            maxChips={4}
            options={SCOPE_INFO.map((s) => ({ value: s.scope, label: s.label, description: s.detail }))}
          />
          <ul className="space-y-1 pt-1">
            {SCOPE_INFO.filter((s) => scopes.includes(s.scope)).map((s) => (
              <li key={s.scope} className="con-fade flex gap-2 text-[12px] text-con-fg3">
                <span className="w-24 shrink-0 font-mono text-con-fg2">{s.label}</span>
                <span className="min-w-0">{s.detail}</span>
              </li>
            ))}
          </ul>
        </fieldset>
        <div className="flex items-center justify-between gap-3">
          <FormStatus error={state?.error} />
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={onClose} className={buttonClass.secondary}>
              Cancel
            </button>
            <button type="submit" disabled={pending || scopes.length === 0} className={buttonClass.primary}>
              {pending && <Spinner />}
              Create key
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
