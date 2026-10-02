import type { Metadata } from "next";
import Link from "next/link";
import { CopyButton } from "@/components/console/copy-button";
import { buttonClass } from "@/components/console/primitives";
import { ApiKeyCreate } from "@/components/console/settings/api-key-create";
import { ShellChecklist, type ChecklistItem } from "@/components/console/shell-checklist";
import { requireSession } from "@/lib/console/auth";
import { listDeployments } from "@/lib/console/data";
import { readProjectConfig } from "@/lib/console/policy";
import { ctxFor } from "@/lib/server/auth/accounts";
import { listApiKeys } from "@/lib/server/auth/api-keys";
import { isAdminRole } from "@/lib/server/context";
import { listJobs } from "@/lib/server/data/jobs";
import { env } from "@/lib/server/env";

export const metadata: Metadata = { title: "Get started" };

export default async function OnboardingPage({ searchParams }: PageProps<"/app/onboarding">) {
  const sp = await searchParams;
  const session = await requireSession();
  const ctx = ctxFor(session);
  const admin = isAdminRole(session.role);
  const server = env.publicUrl();
  const [keys, config, deps, jobs] = await Promise.all([
    admin ? listApiKeys(ctx) : Promise.resolve([]),
    readProjectConfig(),
    listDeployments(),
    listJobs(ctx, { limit: 50 }),
  ]);
  const welcome = sp.welcome === "1";
  const firstService = config.services[0]?.name ?? "my-service";

  const steps: ChecklistItem[] = [
    {
      title: "Create an API key",
      summary: "Keys let the CLI, CI and runners talk to this workspace.",
      done: keys.length > 0,
      body: admin ? (
        <div className="space-y-3">
          <p>
            The CLI, CI and <code className="font-mono text-con-fg">alror runner</code> authenticate with API keys. For a runner, pick the Runner preset
            (it adds <code className="font-mono text-con-fg">jobs:run</code>). The full key is shown once.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <ApiKeyCreate serverUrl={server} />
            <Link href="/app/settings/api-keys" className="text-[13px] text-con-fg2 hover:text-con-fg">
              Manage keys
            </Link>
          </div>
        </div>
      ) : (
        <p>Ask an owner or admin of {session.org.name} for an API key. Keys are created under Settings, API keys.</p>
      ),
    },
    {
      title: "Connect the CLI",
      summary: "Run alror login with your key.",
      done: keys.some((k) => k.last_used_at),
      body: (
        <div className="space-y-3">
          <p>Point the CLI at this workspace. It verifies the key and stores both in your user config.</p>
          <Command cmd={`alror login --server ${server} --key alr_live_…`} copy={`alror login --server ${server} --key `} />
        </div>
      ),
    },
    {
      title: "Add your services",
      summary: "Push alror.yaml or create services in the console.",
      done: config.services.length > 0,
      body: (
        <div className="space-y-3">
          <p>
            Push the services and policy from an existing <code className="font-mono text-con-fg">alror.yaml</code> (needs config:write), or create them on the
            Services page.
          </p>
          <Command cmd="alror config push" />
        </div>
      ),
    },
    {
      title: "Start a runner",
      summary: "The runner executes deploys queued from the console.",
      done: jobs.some((j) => j.claimed_by),
      body: (
        <div className="space-y-3">
          <p>The runner claims the deploy and rollback jobs queued from this console and runs them with the engine. Keep it running next to your cluster.</p>
          <Command cmd="alror runner --name $(hostname)" />
        </div>
      ),
    },
    {
      title: "Ship a release",
      summary: "Deploy from the console, the CLI or CI.",
      done: deps.length > 0,
      body: (
        <div className="space-y-3">
          <p>Deploy from the console with the Deploy button, or from the CLI and CI:</p>
          <Command cmd={`alror deploy -s ${firstService} -i registry/${firstService}:1.0.0 --ref '#1'`} />
        </div>
      ),
    },
  ];
  const done = steps.filter((s) => s.done).length;

  return (
    <div className="mx-auto max-w-[860px] space-y-8">
      <div>
        <h1 className="text-[28px] font-semibold tracking-[-0.025em]">{welcome ? `Welcome to ${session.org.name}` : "Connect the CLI"}</h1>
        <p className="mt-1 text-[14px] text-con-fg2">
          {done === steps.length
            ? "Everything is connected. Releases now roll out as verified canaries."
            : "Five steps from an empty workspace to a verified rollout. Steps tick off by themselves as Alror sees them happen."}
        </p>
      </div>

      <ShellChecklist steps={steps} />

      <div className="flex flex-wrap gap-2">
        <Link href="/app" className={buttonClass.primary}>
          Go to overview
        </Link>
        <Link href="/app/jobs" className={buttonClass.secondary}>
          View jobs
        </Link>
      </div>
    </div>
  );
}

function Command({ cmd, copy }: { cmd: string; copy?: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-con-line bg-con-bg p-3">
      <code className="min-w-0 flex-1 break-all font-mono text-[12.5px] leading-relaxed text-con-fg">{cmd}</code>
      <CopyButton text={copy ?? cmd} iconOnly />
    </div>
  );
}
