"use client";

import { useActionState, useState } from "react";
import { KeyRound, RefreshCw } from "lucide-react";
import { rotateSecret, type SecretResult } from "@/app/app/settings/integrations/actions";
import { CopyButton } from "@/components/console/copy-button";
import { Dialog } from "@/components/console/dialog";
import { Spinner } from "@/components/console/loader";
import { FormStatus, buttonClass } from "@/components/console/primitives";
import { toast } from "@/components/console/shell-toast";

const SOURCES = [
  { id: "alertmanager", label: "Alertmanager" },
  { id: "datadog", label: "Datadog" },
  { id: "sentry", label: "Sentry" },
  { id: "generic", label: "Generic JSON" },
];

/** "Create secret" / "Rotate secret" button and dialog. The secret is shown once, with ready-to-paste webhook URLs. */
export function AlertSecret({ baseUrl, exists }: { baseUrl: string; exists: boolean }) {
  const [open, setOpen] = useState(false);
  const [round, setRound] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={exists ? buttonClass.secondary : buttonClass.primary}>
        {exists ? <RefreshCw size={14} /> : <KeyRound size={14} />}
        {exists ? "Rotate secret" : "Create secret"}
      </button>
      <SecretDialog
        key={round}
        open={open}
        exists={exists}
        baseUrl={baseUrl}
        onClose={() => {
          setOpen(false);
          setRound((r) => r + 1); // forget the secret once the dialog closes
        }}
      />
    </>
  );
}

function SecretDialog({ open, onClose, exists, baseUrl }: { open: boolean; onClose: () => void; exists: boolean; baseUrl: string }) {
  const [state, action, pending] = useActionState<SecretResult, FormData>(async () => {
    const r = await rotateSecret();
    if (r?.ok) toast.success(exists ? "Alert secret rotated" : "Alert secret created", { description: "Copy it now. It will not be shown again." });
    return r;
  }, undefined);

  if (state?.ok && state.token) {
    const token = state.token;
    return (
      <Dialog open={open} onClose={onClose} title="Copy your alert secret" description="This is the only time the full secret is shown. Paste a URL into your alerting tool.">
        <div className="space-y-4">
          <div className="flex items-start gap-2">
            <code className="min-w-0 flex-1 break-all rounded-md border border-con-line bg-con-bg px-2.5 py-2 font-mono text-[12.5px] text-con-fg" data-autofocus tabIndex={0}>
              {token}
            </code>
            <CopyButton text={token} label="Copy secret" />
          </div>
          <div className="space-y-2">
            <div className="text-[13px] text-con-fg2">Webhook URLs with the secret in the query (for tools that cannot set headers)</div>
            {SOURCES.map((s) => {
              const url = `${baseUrl}/api/v1/alerts/${s.id}?token=${token}`;
              return (
                <div key={s.id} className="flex items-center gap-2 rounded-md border border-con-line bg-con-bg p-2">
                  <span className="w-24 shrink-0 text-[12px] text-con-fg3">{s.label}</span>
                  <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-con-fg">{url}</code>
                  <CopyButton text={url} iconOnly label={`Copy ${s.label} URL`} />
                </div>
              );
            })}
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
    <Dialog
      open={open}
      onClose={onClose}
      title={exists ? "Rotate the alert secret?" : "Create an alert secret"}
      description={
        exists
          ? "The current secret stops working immediately. Update every alerting tool that uses it."
          : "Alertmanager, Datadog, Sentry and other tools send alerts to Alror with this secret. Only a hash is stored."
      }
    >
      <form action={action} className="flex items-center justify-between gap-3">
        <FormStatus error={state?.error} />
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={onClose} className={buttonClass.secondary}>
            Cancel
          </button>
          <button type="submit" disabled={pending} className={exists ? buttonClass.danger : buttonClass.primary}>
            {pending && <Spinner />}
            {exists ? "Rotate secret" : "Create secret"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
