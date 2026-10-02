"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Check, Link2, Repeat2, Terminal } from "lucide-react";
import { redeploy, type RedeployState } from "@/app/app/deployments/actions";
import { buttonClass } from "@/components/console/primitives";
import { RollbackButton } from "@/components/console/rollback-button";
import { cn } from "@/lib/site";
import { Spinner } from "@/components/console/loader";

function useCopied(): [string | null, (key: string, text: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (key: string, text: string) => {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(key);
        setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
      },
      () => {},
    );
  };
  return [copied, copy];
}

/** Everything you can do with a release: copy commands and links, re-deploy, roll back. */
export function ReleaseActions({
  id,
  service,
  image,
  environment,
  canRollBack,
  status,
}: {
  id: string;
  service: string;
  image: string;
  environment: string;
  canRollBack: boolean;
  status: string;
}) {
  const [copied, copy] = useCopied();
  const [state, action, pending] = useActionState<RedeployState, FormData>(redeploy, undefined);
  const [confirming, setConfirming] = useState(false);
  const cli = `alror status ${id}`;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2 rounded-md border border-con-line bg-con-bg px-2.5 py-1.5">
          <Terminal size={13} className="shrink-0 text-con-fg3" />
          <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-con-fg">{cli}</code>
          <button
            type="button"
            onClick={() => copy("cli", cli)}
            className="con-ease inline-flex h-6 items-center gap-1 rounded px-1.5 text-[12px] text-con-fg2 hover:bg-con-hover hover:text-con-fg"
            aria-label="Copy CLI command"
          >
            {copied === "cli" ? <Check size={12} /> : null}
            {copied === "cli" ? "Copied" : "Copy"}
          </button>
        </div>
        <button type="button" onClick={() => copy("link", `${window.location.origin}/app/deployments/${id}`)} className={cn(buttonClass.secondary, "w-full")}>
          {copied === "link" ? <Check size={14} /> : <Link2 size={14} />}
          {copied === "link" ? "Link copied" : "Copy link"}
        </button>
      </div>

      <form action={action} className="space-y-2 border-t border-con-row pt-4">
        <input type="hidden" name="id" value={id} />
        {confirming && !pending ? (
          <div className="con-scale-in rounded-md border border-con-line-hover p-3">
            <p className="text-[13px] text-con-fg">
              Queue a new deploy of <span className="font-medium">{service}</span> to <span className="font-medium">{environment}</span>?
            </p>
            <p className="mt-1 break-all font-mono text-[11.5px] text-con-fg3">{image}</p>
            <p className="mt-1 text-[12px] text-con-fg3">It is scored again and gets its own rollout plan.</p>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => setConfirming(false)} className={cn(buttonClass.secondary, "flex-1")}>
                Cancel
              </button>
              <button type="submit" onClick={() => setTimeout(() => setConfirming(false), 0)} className={cn(buttonClass.primary, "flex-1")}>
                <Repeat2 size={14} />
                Queue deploy
              </button>
            </div>
          </div>
        ) : (
          <button type="button" disabled={pending} onClick={() => setConfirming(true)} className={cn(buttonClass.secondary, "w-full")}>
            {pending ? <Spinner size={14} /> : <Repeat2 size={14} />}
            {pending ? "Queueing" : "Re-deploy same image"}
          </button>
        )}
        <div aria-live="polite">
          {state?.error && <p className="text-[12px] text-con-bad">{state.error}</p>}
          {state?.ok && (
            <p className="con-fade text-[12px] text-con-fg2">
              Deploy queued as job <span className="font-mono text-con-fg">{state.jobId?.slice(0, 8)}</span>. Follow it in{" "}
              <Link href="/app/jobs" className="text-con-fg underline-offset-4 hover:underline">
                Jobs
              </Link>
              .
            </p>
          )}
        </div>
      </form>

      <div className="border-t border-con-row pt-4">
        {canRollBack ? (
          <RollbackButton id={id} service={service} />
        ) : (
          <span className={cn(buttonClass.secondary, "w-full cursor-not-allowed text-con-fg3")}>Already {status === "failed" ? "failed" : "rolled back"}</span>
        )}
        <p className="mt-2 text-[12px] text-con-fg3">Rollback and deploy both queue a job; an alror runner executes it and records it in the event log.</p>
      </div>
    </div>
  );
}
