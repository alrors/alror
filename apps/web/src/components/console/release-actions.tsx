"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Link2, Repeat2, Terminal } from "lucide-react";
import { redeploy, type RedeployState } from "@/app/app/deployments/actions";
import { buttonClass } from "@/components/console/primitives";
import { RollbackButton } from "@/components/console/rollback-button";
import { toast } from "@/components/console/shell-toast";
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

/** Re-deploys the same image on the first click (it is scored again and gets its own plan); the toast links to the job. */
function RedeployButton({ id, service, environment, className }: { id: string; service: string; environment: string; className?: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<RedeployState, FormData>(async (prev, fd) => {
    const r = await redeploy(prev, fd);
    if (r?.ok) {
      toast.success(`Deploying ${service} to ${environment}`, {
        description: r.jobId ? `Queued as job ${r.jobId.slice(0, 8)}. It is scored again and gets its own rollout plan.` : undefined,
        action: { label: "View job", onClick: () => router.push("/app/jobs") },
      });
    }
    return r;
  }, undefined);

  return (
    <form action={action} className={cn("flex flex-col gap-2", className)}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} className={cn(buttonClass.secondary, "w-full max-md:h-11")}>
        {pending ? <Spinner size={14} /> : <Repeat2 size={14} />}
        {pending ? "Queueing" : "Re-deploy same image"}
      </button>
      {state?.error && (
        <p className="text-[12px] text-con-bad" aria-live="polite">
          {state.error}
        </p>
      )}
    </form>
  );
}

type ReleaseProps = { id: string; service: string; environment: string; canRollBack: boolean };

/** The one action a release needs now: Roll back while it can be rolled back, otherwise Re-deploy. */
export function ReleasePrimaryAction({ id, service, environment, canRollBack, className }: ReleaseProps & { className?: string }) {
  return canRollBack ? <RollbackButton id={id} service={service} className={className} /> : <RedeployButton id={id} service={service} environment={environment} className={className} />;
}

/**
 * Everything you can do with a release: copy commands and links, re-deploy, roll back.
 * Below lg the primary action renders in the page header instead (ReleasePrimaryAction),
 * so it is hidden here at that width.
 */
export function ReleaseActions({ id, service, environment, canRollBack, status }: ReleaseProps & { status: string }) {
  const [copied, copy] = useCopied();
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

      <RedeployButton id={id} service={service} environment={environment} className={cn("border-t border-con-row pt-4", !canRollBack && "max-lg:hidden")} />

      <div className="border-t border-con-row pt-4">
        {canRollBack ? (
          <RollbackButton id={id} service={service} className="max-lg:hidden" />
        ) : (
          <span className={cn(buttonClass.secondary, "w-full cursor-not-allowed text-con-fg3")}>Already {status === "failed" ? "failed" : "rolled back"}</span>
        )}
        <p className="mt-2 text-[12px] text-con-fg3">Rollback and deploy both queue a job; an alror runner executes it and records it in the event log.</p>
      </div>
    </div>
  );
}
