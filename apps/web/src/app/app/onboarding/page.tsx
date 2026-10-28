import type { Metadata } from "next";
import Link from "next/link";
import { CopyButton } from "@/components/console/copy-button";
import { AddSimulatedService } from "@/components/console/onboarding/add-simulated-service";
import { SetupSnippets, type Snippet } from "@/components/console/onboarding/setup-snippets";
import { InfoTip } from "@/components/console/overview/float";
import { buttonClass } from "@/components/console/primitives";
import { ApiKeyCreate } from "@/components/console/settings/api-key-create";
import { ShellChecklist, type ChecklistItem } from "@/components/console/shell-checklist";
import { requireSession } from "@/lib/console/auth";
import { listDeployments } from "@/lib/console/data";
import { readProjectConfig } from "@/lib/console/policy";
import { ctxFor } from "@/lib/server/auth/accounts";
import { listApiKeys } from "@/lib/server/auth/api-keys";
import { isAdminRole } from "@/lib/server/context";
import { enabledTargets } from "@/lib/server/data/plugins";
import { listJobs } from "@/lib/server/data/jobs";
import { env } from "@/lib/server/env";

export const metadata: Metadata = { title: "Get started" };

const TRY_SERVICE = "checkout-api";

/** alror.yaml for each target, pre-filled with the first service name. */
function yamlSnippets(service: string): Snippet[] {
  return [
    { id: "kubernetes", label: "Kubernetes", code: `project: my-app\nservices:\n  - name: ${service}\n    paths: [services/${service}/]\n    target: kubernetes\n    cluster: prod\n    namespace: ${service}` },
    { id: "ecs", label: "Amazon ECS", code: `project: my-app\nservices:\n  - name: ${service}\n    paths: [services/${service}/]\n    target: ecs\n    cluster: prod` },
    { id: "simulated", label: "Simulated", code: `project: my-app\nservices:\n  - name: ${service}\n    paths: [services/${service}/]\n    target: simulated` },
  ];
}

export default async function OnboardingPage({ searchParams }: PageProps<"/app/onboarding">) {
  const sp = await searchParams;
  const session = await requireSession();
  const ctx = ctxFor(session);
  const admin = isAdminRole(session.role);
  const server = env.publicUrl();
  const [keys, config, deps, jobs, targets] = await Promise.all([
    admin ? listApiKeys(ctx) : Promise.resolve([]),
    readProjectConfig(),
    listDeployments(),
    listJobs(ctx, { limit: 50 }),
    enabledTargets(ctx),
  ]);
  const welcome = sp.welcome === "1";
  const service = config.services[0]?.name ?? TRY_SERVICE;
  const simulated = config.services.find((s) => s.target === "simulated")?.name;
  const real = config.services.find((s) => s.target === "kubernetes" || s.target === "ecs")?.target;
  // Inferred tab: a target already in use, else an enabled target plugin, else simulated.
  const inferred = real ?? targets.find((t) => t.target !== "simulated")?.target ?? "simulated";
  const rolledBack = deps.some((d) => d.status === "rolled_back");

  const steps: ChecklistItem[] = [
    {
      title: "Create an API key",
      summary: "For the CLI, CI and runners.",
      done: keys.length > 0,
      body: admin ? (
        <div className="flex flex-wrap items-center gap-3">
          <ApiKeyCreate serverUrl={server} />
          <InfoTip label="API keys">
            The CLI, CI and runners sign in with a key. Pick the Runner preset for a runner; it adds jobs:run. The full key is shown once.
          </InfoTip>
          <Link href="/app/settings/api-keys" className="text-[13px] text-con-fg2 hover:text-con-fg">
            Manage keys
          </Link>
        </div>
      ) : (
        <p>Ask an owner or admin of {session.org.name} for a key.</p>
      ),
    },
    {
      title: "Connect",
      summary: "Log in from the CLI, or install the GitHub App.",
      done: keys.some((k) => k.last_used_at),
      body: (
        <div className="space-y-3">
          <Command cmd={`alror login --server ${server} --key alr_live_…`} copy={`alror login --server ${server} --key `} />
          <p className="flex items-center gap-1.5">
            Or{" "}
            <Link href="/app/github" className="text-con-fg underline-offset-2 hover:underline">
              install the GitHub App
            </Link>{" "}
            to score every pull request.
            <InfoTip label="GitHub App">
              The app checks each pull request and can open a setup pull request with an alror.yaml it detects from your Dockerfiles and manifests.
            </InfoTip>
          </p>
        </div>
      ),
    },
    {
      title: "Add a service",
      summary: "Push alror.yaml, or try one on the simulated target.",
      done: config.services.length > 0,
      body: (
        <div className="space-y-3">
          <SetupSnippets name="alror.yaml" snippets={yamlSnippets(service)} initial={inferred} />
          <Command cmd="alror config push" />
          {admin && !simulated && (
            <div className="flex flex-wrap items-center gap-2">
              <AddSimulatedService name={TRY_SERVICE} />
              <InfoTip label="Simulated target">
                A real service whose releases run on Alror&apos;s simulator with synthetic metrics. Nothing touches your infrastructure. Archive it from
                Services when you are done.
              </InfoTip>
            </div>
          )}
        </div>
      ),
    },
    {
      title: "Start a runner",
      summary: "Runs deploys queued from the console.",
      done: jobs.some((j) => j.claimed_by),
      body: (
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <Command cmd="alror runner --name $(hostname)" />
          </div>
          <InfoTip label="Runner">Keep it running next to your cluster. Deploys from the CLI or CI run without one.</InfoTip>
        </div>
      ),
    },
    {
      title: "Ship a release",
      summary: rolledBack ? "Done. You have seen a promotion and a rollback." : "Release once, then watch one roll back.",
      done: deps.length > 0,
      body: (
        <div className="space-y-3">
          <Command cmd={`alror deploy -s ${simulated ?? service} -i registry/${simulated ?? service}:1.0.0${simulated ? " --fast" : ""}`} />
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <Command cmd={`alror deploy -s ${simulated ?? service} -i registry/${simulated ?? service}:1.1.0 --fast --regress error_rate=1.8`} />
            </div>
            <InfoTip label="Watch a rollback">
              On a simulated service, --regress makes the canary&apos;s error rate 1.8× the baseline; Alror catches it, rolls back and exits with code 2. --fast shortens bakes to seconds (simulated only).
            </InfoTip>
          </div>
        </div>
      ),
    },
  ];
  const done = steps.filter((s) => s.done).length;

  return (
    <div className="mx-auto max-w-[860px] space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-[28px] font-semibold tracking-[-0.025em]">
          {welcome ? `Welcome to ${session.org.name}` : "Get started"}
          <InfoTip label="setup">Steps tick off on their own as Alror sees each one happen. Open a step for its command.</InfoTip>
        </h1>
        {done === steps.length && <p className="mt-1 text-[14px] text-con-fg2">All set. Releases now roll out as verified canaries.</p>}
      </div>

      <ShellChecklist steps={steps} />

      <div className="flex flex-wrap gap-2">
        <Link href="/app?tour=console" className={buttonClass.secondary}>
          Take the console tour
        </Link>
        <Link href="/app" className={buttonClass.secondary}>
          Go to Oversight
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
