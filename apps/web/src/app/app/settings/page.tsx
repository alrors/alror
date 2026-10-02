import type { Metadata } from "next";
import Link from "next/link";
import { Check, ChevronDown, Minus } from "lucide-react";
import { ConfirmAction } from "@/components/console/confirm-action";
import { CountUp } from "@/components/console/count-up";
import { Card, Field, Pill } from "@/components/console/primitives";
import { GeneralForm } from "@/components/console/settings/general-form";
import { RolesMatrix, permissionsFor } from "@/components/console/settings/roles-matrix";
import { requireSession } from "@/lib/console/auth";
import { listDeployments } from "@/lib/console/data";
import { ago, dateTime, requestTime } from "@/lib/console/format";
import { readProjectConfig } from "@/lib/console/policy";
import { ctxFor } from "@/lib/server/auth/accounts";
import { listApiKeys } from "@/lib/server/auth/api-keys";
import { listMembers } from "@/lib/server/auth/members";
import { isAdminRole } from "@/lib/server/context";
import { listEnvironments } from "@/lib/server/data/environments";
import { getOrg } from "@/lib/server/data/orgs";
import { cn } from "@/lib/site";
import { removeMember } from "./actions";

export const metadata: Metadata = { title: "General" };

const DAY = 86_400_000;

export default async function GeneralSettings() {
  const session = await requireSession();
  const ctx = ctxFor(session);
  const admin = isAdminRole(session.role);
  const [org, envs, members, config, deps, keys] = await Promise.all([
    getOrg(session.org.id),
    listEnvironments(ctx),
    listMembers(ctx),
    readProjectConfig(),
    listDeployments(),
    admin ? listApiKeys(ctx) : Promise.resolve(null),
  ]);
  const now = requestTime();
  const recent = deps.filter((d) => now - Date.parse(d.created_at) < 30 * DAY).length;
  const lastDeploy = deps.reduce<string | null>((m, d) => (!m || d.created_at > m ? d.created_at : m), null);
  const owners = members.filter((m) => m.role === "owner").length;
  const soleOwner = session.role === "owner" && owners <= 1;

  const stats: { label: string; value: number; detail: string; href?: string }[] = [
    { label: "Members", value: members.length, detail: `${owners} owner${owners === 1 ? "" : "s"}`, href: admin ? "/app/settings/members" : undefined },
    { label: "Services", value: config.services.length, detail: "Deployable units", href: "/app/services" },
    { label: "Releases (30 days)", value: recent, detail: lastDeploy ? `Last ${ago(lastDeploy)}` : "None yet", href: "/app/deployments" },
    { label: "Environments", value: envs.length, detail: `${envs.filter((e) => e.protected).length} protected` },
    ...(keys
      ? [{ label: "Active API keys", value: keys.length, detail: `${keys.filter((k) => k.last_used_at && now - Date.parse(k.last_used_at) < 7 * DAY).length} used this week`, href: "/app/settings/api-keys" }]
      : []),
  ];
  const perms = permissionsFor(session.role);

  return (
    <>
      <section aria-label="Organization at a glance" className="con-stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        {stats.map((s) => {
          const body = (
            <>
              <div className="text-[12px] text-con-fg3">{s.label}</div>
              <CountUp value={s.value} className="mt-1 block text-[24px] font-semibold tracking-[-0.02em] text-con-fg" />
              <div className="mt-0.5 truncate text-[12px] text-con-fg3">{s.detail}</div>
            </>
          );
          const cls = "block rounded-lg border border-con-line bg-con-panel px-4 py-3.5";
          // The wrapper takes the stagger animation so the link's hover lift still applies.
          return (
            <div key={s.label}>
              {s.href ? (
                <Link href={s.href} className={cn(cls, "con-lift h-full hover:border-con-line-hover")}>
                  {body}
                </Link>
              ) : (
                <div className={cn(cls, "h-full")}>{body}</div>
              )}
            </div>
          );
        })}
      </section>

      <Card
        title="Organization"
        description={admin ? "The name is what people see. The slug is the project name the CLI and API use." : "Only owners and admins can change these."}
      >
        <GeneralForm name={org?.name ?? session.org.name} slug={org?.slug ?? session.org.slug} canEdit={admin} />
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Details">
          <dl className="-my-2.5 divide-y divide-con-row">
            <Field label="Plan">
              <span className="capitalize">{org?.plan ?? session.org.plan}</span>
            </Field>
            <Field label="Created">{org ? `${dateTime(org.created_at)} (${ago(org.created_at)})` : "unknown"}</Field>
            <Field label="Organization ID" mono>
              {session.org.id}
            </Field>
          </dl>
        </Card>
        <Card title="Environments" description="Each deployment and deploy job targets one. Protected ones are marked in the deploy dialog." flush>
          <ul className="divide-y divide-con-row">
            {envs.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 px-5 py-3 text-[14px]">
                <span className="font-mono">{e.name}</span>
                {e.protected ? <Pill className="text-con-fg2">Protected</Pill> : <span className="text-[13px] text-con-fg3">Unprotected</span>}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card
        title="Your access"
        description={`You are ${session.role === "admin" ? "an admin" : session.role === "owner" ? "an owner" : "a member"} of ${session.org.name}. This is what that lets you do.`}
        flush
      >
        <ul className="grid gap-x-6 px-5 py-3 sm:grid-cols-2">
          {perms.map((p) => (
            <li key={p.label} className="flex items-start gap-2.5 py-1.5 text-[13px]">
              {p.allowed ? <Check size={14} className="mt-0.5 shrink-0 text-con-fg" /> : <Minus size={14} className="mt-0.5 shrink-0 text-con-fg3" />}
              <span className={p.allowed ? "text-con-fg" : "text-con-fg3"}>{p.label}</span>
            </li>
          ))}
        </ul>
        <details className="group border-t border-con-line">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3 text-[13px] text-con-fg2 transition-colors duration-150 hover:text-con-fg">
            <ChevronDown size={14} className="transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" />
            Compare all roles
          </summary>
          <div className="con-fade border-t border-con-line">
            <RolesMatrix highlight={session.role} />
          </div>
        </details>
      </Card>

      <Card title="Your membership">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="text-[14px]">
            <div className="text-con-fg">{session.user.email}</div>
            <div className="text-[13px] capitalize text-con-fg2">{session.role}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/app/onboarding" className="text-[13px] text-con-fg2 hover:text-con-fg">
              Connect the CLI
            </Link>
            {soleOwner ? (
              <span className="text-[12px] text-con-fg3" title="Make someone else an owner first">
                You are the only owner, so you cannot leave.
              </span>
            ) : (
              <ConfirmAction action={removeMember} fields={{ user: session.user.id }} label="Leave organization" confirmLabel="Leave" prompt={`Leave ${session.org.name}?`} />
            )}
          </div>
        </div>
      </Card>
    </>
  );
}
