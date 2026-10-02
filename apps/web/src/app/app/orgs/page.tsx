import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { buttonClass } from "@/components/console/primitives";
import { listDeployments } from "@/lib/console/data";
import { readProjectConfig } from "@/lib/console/policy";
import { requireSession } from "@/lib/server/auth/session";
import { listOrgsForUser } from "@/lib/server/data/orgs";
import { switchOrg } from "../actions";
import { cn } from "@/lib/site";

export const metadata: Metadata = { title: "Organizations" };

export default async function OrgsPage({ searchParams }: PageProps<"/app/orgs">) {
  const sp = await searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q ?? "").trim().toLowerCase();
  const session = await requireSession();
  const [config, deps, mine] = await Promise.all([readProjectConfig(), listDeployments(), listOrgsForUser(session.user.id)]);
  const planLabel = (p: string) => `${p.charAt(0).toUpperCase()}${p.slice(1)} plan`;
  const orgs = mine
    .map((o) => {
      const current = o.id === session.org.id;
      return {
        id: o.id,
        name: o.slug,
        plan: planLabel(o.plan),
        detail: current ? `${config.services.length} services · ${deps.length} releases` : o.name,
        role: o.role,
        href: "/app",
        current,
      };
    })
    .filter((o) => !q || o.name.includes(q));

  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <div>
        <h1 className="text-[28px] font-semibold tracking-[-0.025em]">Your organizations</h1>
        <p className="mt-1 text-[14px] text-con-fg2">
          You belong to {mine.length} organization{mine.length === 1 ? "" : "s"}. Each has its own services, releases, keys and members. Pick one to switch.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <form action="/app/orgs" method="get" role="search" className="w-full sm:w-72">
          <label className="flex h-8 items-center gap-2 rounded-md border border-con-line bg-con-bg px-2.5 text-con-fg3 focus-within:border-con-line-hover">
            <Search size={14} />
            <span className="sr-only">Search organizations</span>
            <input name="q" type="search" defaultValue={q} placeholder="Search for an organization" className="min-w-0 flex-1 bg-transparent text-[13px] text-con-fg outline-none placeholder:text-con-fg3" />
          </label>
        </form>
        <span className={cn(buttonClass.secondary, "cursor-not-allowed opacity-60 hover:bg-transparent")} title="Organizations are created at sign-up or by your Alror admin" aria-disabled="true">
          <Plus size={14} strokeWidth={2.25} />
          New organization
        </span>
      </div>
      {orgs.length === 0 && <p className="text-[14px] text-con-fg3">No organization matches “{q}”.</p>}
      <div className="con-stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {orgs.map((o) => (
          <div key={o.id}>
          <OrgCard id={o.id} current={o.current} href={o.href}>
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-con-line bg-con-bg text-[15px] font-semibold text-con-fg">
              {o.name[0].toUpperCase()}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[15px] font-medium">
                {o.name}
                {o.current && <span className="rounded border border-con-line px-1.5 py-px text-[10px] font-medium uppercase tracking-[0.06em] text-con-fg2">Current</span>}
              </div>
              <div className="truncate text-[13px] text-con-fg3">
                {o.plan} · {o.detail}
              </div>
              <div className="mt-0.5 text-[12px] capitalize text-con-fg3">Your role: {o.role}</div>
            </div>
          </OrgCard>
          </div>
        ))}
      </div>
    </div>
  );
}

const cardClass =
  "con-lift flex w-full items-center gap-4 rounded-lg border border-con-line bg-con-panel p-5 text-left hover:border-con-line-hover";

/** The current org links home; other orgs switch the session's org. */
function OrgCard({ id, current, href, children }: { id: string; current: boolean; href: string; children: React.ReactNode }) {
  if (current) {
    return (
      <Link href={href} className={cardClass}>
        {children}
      </Link>
    );
  }
  return (
    <form action={switchOrg}>
      <input type="hidden" name="org" value={id} />
      <button type="submit" className={cardClass}>
        {children}
      </button>
    </form>
  );
}
