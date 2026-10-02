"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Blocks, Rocket, Search, Server, Settings2, TerminalSquare } from "lucide-react";
import { SHELL_EVENTS, shellEmit, useModKey } from "@/components/console/shell-events";
import { buttonClass } from "@/components/console/primitives";
import { ErrorView } from "@/components/errors/error-view";

/** The path that was asked for, in mono (client: not-found files get no props). */
export function RequestedPath() {
  const pathname = usePathname();
  if (!pathname || pathname === "/" || pathname.startsWith("/_")) return null;
  return (
    <p className="text-[13px] text-con-fg3">
      Requested <code className="break-all rounded border border-con-line bg-con-panel px-1.5 py-0.5 font-mono text-[12px] text-con-fg2">{pathname}</code>
    </p>
  );
}

type Subject = { what: string; id: string; where: string; detail: string; list: { href: string; label: string } } | null;

const short = (id: string) => (id.length > 40 ? `${id.slice(0, 40)}…` : id);

function subjectFor(pathname: string, org: string | null): Subject {
  const parts = pathname.split("/").filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  const [, section, id] = parts;
  const where = org ? ` in ${org}` : "";
  if (section === "deployments" && id)
    return {
      what: "deployment",
      id,
      where,
      detail: "It may belong to another organization, or the link was cut short. Search also matches a unique prefix of the id.",
      list: { href: "/app/deployments", label: "All deployments" },
    };
  if (section === "services" && id)
    return {
      what: "service",
      id,
      where,
      detail: "It may have been renamed, or it was never registered. Services are added on the Services page or with alror config push.",
      list: { href: "/app/services", label: "All services" },
    };
  if (section === "marketplace" && id)
    return {
      what: "plugin",
      id,
      where: " in the marketplace",
      detail: "It may have been renamed or retired from the catalog.",
      list: { href: "/app/marketplace", label: "Browse the marketplace" },
    };
  return null;
}

const SUGGESTIONS = [
  { href: "/app/deployments", label: "Deployments", detail: "Every release and its rollout", icon: Rocket },
  { href: "/app/services", label: "Services", detail: "What you ship and where", icon: Server },
  { href: "/app/jobs", label: "Jobs", detail: "Runner queue and history", icon: TerminalSquare },
  { href: "/app/marketplace", label: "Marketplace", detail: "Metrics, targets and notifications", icon: Blocks },
  { href: "/app/settings", label: "Settings", detail: "Organization, members and keys", icon: Settings2 },
];

/** Not-found inside the console shell, with suggestions based on what was asked for. */
export function ConsoleNotFound({ org }: { org: string | null }) {
  const pathname = usePathname() ?? "/app";
  const mod = useModKey();
  const subject = subjectFor(pathname, org);

  return (
    <ErrorView
      variant="panel"
      eyebrow="404"
      title="We couldn't find that"
      actions={
        <>
          {subject ? (
            <Link href={subject.list.href} className={buttonClass.primary}>
              {subject.list.label}
              <ArrowRight size={13} />
            </Link>
          ) : (
            <Link href="/app" className={buttonClass.primary}>
              Console overview
              <ArrowRight size={13} />
            </Link>
          )}
        </>
      }
      aside={
        <div className="space-y-6">
          <button
            type="button"
            onClick={() => shellEmit(SHELL_EVENTS.openPalette)}
            className="flex h-10 w-full items-center gap-2.5 rounded-lg border border-con-line bg-con-panel px-3.5 text-left text-con-fg3 transition-colors duration-150 hover:border-con-line-hover"
          >
            <Search size={15} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate text-[13px]">Search services, deployments and pages</span>
            <kbd className="shrink-0 rounded border border-con-line px-1.5 font-sans text-[11px]">{mod} K</kbd>
          </button>
          <nav aria-label="Suggestions">
            <h2 className="text-[12px] font-medium uppercase tracking-[0.04em] text-con-fg3">Or go to</h2>
            <ul className="mt-2 divide-y divide-con-line overflow-hidden rounded-lg border border-con-line">
              {SUGGESTIONS.map((s) => (
                <li key={s.href}>
                  <Link href={s.href} className="group flex items-center gap-3 px-4 py-2.5 transition-colors duration-150 hover:bg-con-hover">
                    <s.icon size={15} className="shrink-0 text-con-fg3" />
                    <span className="text-[13px] text-con-fg">{s.label}</span>
                    <span className="hidden min-w-0 flex-1 truncate text-[12px] text-con-fg3 sm:block">{s.detail}</span>
                    <ArrowRight size={13} className="ml-auto shrink-0 text-con-fg3 transition-transform duration-150 group-hover:translate-x-0.5" />
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      }
    >
      {subject ? (
        <>
          <p>
            No {subject.what} matches{" "}
            <code className="break-all rounded border border-con-line bg-con-panel px-1.5 py-0.5 font-mono text-[12px] text-con-fg">{short(subject.id)}</code>
            {subject.where}.
          </p>
          <p>{subject.detail}</p>
        </>
      ) : (
        <>
          <p>This console page doesn&apos;t exist. Check the address, or search for what you need.</p>
          <RequestedPath />
        </>
      )}
    </ErrorView>
  );
}
