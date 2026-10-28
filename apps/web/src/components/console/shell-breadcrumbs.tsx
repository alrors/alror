"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

const SECTIONS: Record<string, string> = {
  services: "Services",
  live: "Live",
  github: "GitHub",
  deployments: "Deployments",
  jobs: "Jobs",
  incidents: "Incidents",
  insights: "Insights",
  policies: "Policies",
  settings: "Settings",
  onboarding: "Get started",
  orgs: "Organizations",
  marketplace: "Marketplace",
};

const SETTINGS: Record<string, string> = {
  members: "Members",
  invites: "Invites",
  "api-keys": "API keys",
  integrations: "Integrations",
  audit: "Audit log",
  feedback: "Feedback",
};

type Crumb = { label: string; href?: string; mono?: boolean };

function crumbsFor(pathname: string, depService: Record<string, string>): Crumb[] {
  const parts = pathname.replace(/^\/app\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const out: Crumb[] = [{ label: "Console", href: "/app" }];
  if (parts.length === 0) return [{ label: "Console", href: "/app" }, { label: "Oversight" }];
  const [section, id, sub] = parts;
  const label = SECTIONS[section] ?? section;
  if (section === "services") {
    out.push(id ? { label: "Services", href: "/app/services" } : { label: "Services" });
    if (id) out.push({ label: id, mono: true });
    return out;
  }
  if (section === "deployments" && id) {
    out.push({ label: "Deployments", href: "/app/deployments" });
    const svc = depService[id];
    if (svc) out.push({ label: svc, href: `/app/services/${encodeURIComponent(svc)}`, mono: true });
    out.push({ label: id, mono: true });
    return out;
  }
  if (section === "github") {
    const pull = parts[0] === "github" && id === "repositories" && parts[3] === "pulls" ? parts[4] : undefined;
    out.push(pull ? { label: "GitHub", href: "/app/github" } : { label: "GitHub" });
    if (pull) out.push({ label: `Pull request #${pull}` });
    return out;
  }
  if (section === "incidents") {
    out.push(id ? { label: "Incidents", href: "/app/incidents" } : { label: "Incidents" });
    if (id) out.push({ label: id.slice(0, 8), mono: true });
    return out;
  }
  if (section === "marketplace") {
    out.push(id ? { label: "Marketplace", href: "/app/marketplace" } : { label: "Marketplace" });
    if (id) out.push({ label: id, mono: true });
    return out;
  }
  if (section === "settings") {
    out.push(id ? { label: "Settings", href: "/app/settings" } : { label: "Settings" });
    if (id) out.push({ label: SETTINGS[id] ?? id });
    if (sub) out.push({ label: sub });
    return out;
  }
  out.push({ label });
  return out;
}

/** Where am I: a quiet trail above each console page. */
export function ShellBreadcrumbs({ depService }: { depService: Record<string, string> }) {
  const pathname = usePathname();
  const crumbs = crumbsFor(pathname, depService);
  return (
    <nav aria-label="Breadcrumb" className="mb-4 min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-[12.5px] text-con-fg3">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={`${i}:${c.label}`} className="flex min-w-0 items-center gap-1">
              {i > 0 && <ChevronRight size={12} className="shrink-0 text-con-line-hover" aria-hidden />}
              {c.href && !last ? (
                <Link href={c.href} className={`truncate transition-colors duration-150 hover:text-con-fg ${c.mono ? "font-mono text-[12px]" : ""}`}>
                  {c.label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className={`truncate ${last ? "text-con-fg2" : ""} ${c.mono ? "font-mono text-[12px]" : ""}`}>
                  {c.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
