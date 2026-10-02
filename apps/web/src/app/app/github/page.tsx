import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, GitFork } from "lucide-react";
import { Card, PageHeader, Pill, buttonClass } from "@/components/console/primitives";
import { GitHubWorkspace } from "@/components/console/github/workspace";
import { requireCtx } from "@/lib/server/auth/session";
import { isAdminRole } from "@/lib/server/context";
import { configStatus } from "@/lib/server/github/config";
import { listRepositories, listDecisions } from "@/lib/server/github/data";

export const metadata: Metadata = { title: "GitHub" };

export default async function GitHubPage() {
  const ctx = await requireCtx();
  const admin = isAdminRole(ctx.actor.role);
  const status = configStatus();
  const [repositories, decisions] = await Promise.all([listRepositories(ctx), listDecisions(ctx, { limit: 50 })]);
  const installURL = `https://github.com/apps/${encodeURIComponent(status.appSlug)}/installations/new`;
  return <div className="space-y-7">
    <PageHeader title="GitHub" description="Bring Alror into your pull requests. Clear decisions, consistent policies, and a traceable path to production." meta={<Pill><GitFork size={12} />Alror Platform</Pill>} actions={admin ? <a href={installURL} target="_blank" rel="noreferrer" className={buttonClass.primary}><GitFork size={14} />Install GitHub App<ArrowUpRight size={13} /></a> : undefined} />
    <Card title="Merge Gate" description="Start by observing. Enable review requirements or automatic merging when your repository policy is ready." aside={<Pill tone={status.configured ? "idle" : "warn"}>{status.configured ? "App configured" : "Setup needed"}</Pill>}>
      <div className="grid gap-5 text-[13px] sm:grid-cols-3">{[
        ["01", "Observe", "See risk assessments and policy results without automatic merges."],
        ["02", "Require review", "Flag changes that need attention and request configured reviewers."],
        ["03", "Auto-merge", "Merge eligible changes after trusted checks and GitHub protections pass."],
      ].map(([number, title, description]) => <div key={number}><span className="font-mono text-[11px] text-con-fg3">{number}</span><h2 className="mt-2 font-medium">{title}</h2><p className="mt-1 leading-relaxed text-con-fg3">{description}</p></div>)}</div>
    </Card>
    {admin && (!status.configured || repositories.length === 0) && <details className="rounded-lg border border-con-line bg-con-panel px-5 py-4" open={!status.configured}>
      <summary className="cursor-pointer text-[13px] font-medium">Finish connecting GitHub</summary>
      <ol className="mt-4 list-decimal space-y-3 pl-4 text-[13px] leading-relaxed text-con-fg2">
        <li>Install the Alror GitHub App and select the repositories you want to connect.</li>
        <li>Ask your Alror operator to link the installation to this workspace: <code className="break-all rounded bg-con-bg px-1.5 py-0.5 text-[12px]">{ctx.orgId}</code>. Installation alone does not grant a workspace access.</li>
        <li>Configure the webhook and worker, then open or update a pull request. New repositories use Observe mode.</li>
      </ol>
      {!status.configured && <p className="mt-4 break-words text-[12px] text-con-fg3">Server configuration needed: {status.missing.join(", ")}. Your operator configures these on the server.</p>}
    </details>}
    <GitHubWorkspace repositories={repositories} decisions={decisions} admin={admin} />
    {admin && <p className="text-[12px] text-con-fg3"><Link href="/app/settings/audit" className="hover:text-con-fg">View workspace audit history →</Link></p>}
  </div>;
}
