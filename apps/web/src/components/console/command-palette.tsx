"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Blocks, Keyboard, KeyRound, PanelLeft, Rocket, Search, Server, Settings2, TerminalSquare, UserPlus } from "lucide-react";
import { search } from "@/app/app/actions";
import { Spinner } from "@/components/console/loader";
import { Dot } from "@/components/console/primitives";
import { SHELL_EVENTS, shellEmit, type ShellEvent } from "@/components/console/shell-events";
import { startNavigationProgress } from "@/components/console/shell-progress";
import { ago, statusLabel, statusTone } from "@/lib/console/format";
import type { Status } from "@/lib/console/types";
import type { SearchResult } from "@/lib/server/data/search";
import { cn } from "@/lib/site";

type Item = {
  key: string;
  /** navigate here, or */
  href?: string;
  /** emit this shell event */
  event?: ShellEvent;
  group: string;
  title: React.ReactNode;
  detail?: React.ReactNode;
  icon: React.ReactNode;
  right?: React.ReactNode;
};

type Action = { title: string; detail: string; keywords: string; icon: React.ReactNode; href?: string; event?: ShellEvent; admin?: boolean; deploy?: boolean; hint?: string };

const ACTIONS: Action[] = [
  { title: "Deploy…", detail: "Queue a deploy job for alror runner", keywords: "deploy release ship rollout", icon: <Rocket size={15} />, event: SHELL_EVENTS.openDeploy, deploy: true },
  { title: "Create API key", detail: "For the CLI, CI or a runner", keywords: "api key token create new cli ci runner", icon: <KeyRound size={15} />, href: "/app/settings/api-keys?new=1", admin: true },
  { title: "Invite member", detail: "Send a single-use invite link", keywords: "invite member people team add user", icon: <UserPlus size={15} />, href: "/app/settings/invites?new=1", admin: true },
  { title: "Toggle sidebar", detail: "Collapse or expand the navigation", keywords: "sidebar collapse expand navigation toggle", icon: <PanelLeft size={15} />, event: SHELL_EVENTS.toggleSidebar, hint: "Ctrl B" },
  { title: "Keyboard shortcuts", detail: "Every shortcut in the console", keywords: "keyboard shortcuts keys help hotkeys", icon: <Keyboard size={15} />, event: SHELL_EVENTS.openShortcuts, hint: "?" },
  { title: "Connect the CLI", detail: "Setup checklist", keywords: "onboarding cli runner login get started setup", icon: <TerminalSquare size={15} />, href: "/app/onboarding" },
  {
    title: "Browse the marketplace",
    detail: "Metrics providers, deploy targets, Slack, CI and SDKs",
    keywords: "marketplace plugins integrations extensions libraries sdk prometheus datadog slack kubernetes ecs github actions install",
    icon: <Blocks size={15} />,
    href: "/app/marketplace",
  },
];

const PAGES: { title: string; href: string; keywords: string }[] = [
  { title: "Overview", href: "/app", keywords: "home overview board dashboard" },
  { title: "Services", href: "/app/services", keywords: "services list" },
  { title: "Deployments", href: "/app/deployments", keywords: "releases deployments" },
  { title: "Jobs", href: "/app/jobs", keywords: "jobs runner queue" },
  { title: "Insights", href: "/app/insights", keywords: "insights dora metrics" },
  { title: "Policies", href: "/app/policies", keywords: "policy policies thresholds plans rollback" },
  { title: "Marketplace", href: "/app/marketplace", keywords: "marketplace plugins integrations libraries sdk extend" },
  { title: "Settings", href: "/app/settings", keywords: "settings organization general" },
  { title: "Members", href: "/app/settings/members", keywords: "members people team roles" },
  { title: "API keys", href: "/app/settings/api-keys", keywords: "api keys tokens cli" },
  { title: "Audit log", href: "/app/settings/audit", keywords: "audit log history" },
  { title: "Connect the CLI", href: "/app/onboarding", keywords: "onboarding cli runner login get started" },
];

/** Ctrl/Cmd+K command palette over services, deployments and console pages. */
export function CommandPalette({ open, onClose, isAdmin = false, canDeploy = true }: { open: boolean; onClose: () => void; isAdmin?: boolean; canDeploy?: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [res, setRes] = useState<SearchResult>({ services: [], deployments: [] });
  const [active, setActive] = useState(0);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    const query = q.trim();
    if (!query) return;
    const id = ++seq.current;
    const t = setTimeout(() => {
      start(async () => {
        const r = await search(query);
        if (id === seq.current) {
          setRes(r);
          setActive(0);
        }
      });
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  const items = useMemo<Item[]>(() => {
    const query = q.trim().toLowerCase();
    const pages = PAGES.filter((p) => !query || p.title.toLowerCase().includes(query) || p.keywords.includes(query)).slice(0, query ? 4 : 10);
    const out: Item[] = [];
    const actions = ACTIONS.filter(
      (a) => (!a.admin || isAdmin) && (!a.deploy || canDeploy) && (!query || a.title.toLowerCase().includes(query) || a.keywords.includes(query)),
    ).slice(0, query ? 3 : 6);
    for (const a of actions)
      out.push({
        key: `a:${a.title}`,
        href: a.href,
        event: a.event,
        group: "Actions",
        title: a.title,
        detail: a.detail,
        icon: a.icon,
        right: a.hint ? <kbd className="shrink-0 rounded border border-con-line px-1 font-sans text-[11px] text-con-fg3">{a.hint}</kbd> : undefined,
      });
    if (query) {
      for (const s of res.services)
        out.push({
          key: `s:${s.name}`,
          href: `/app/services/${encodeURIComponent(s.name)}`,
          group: "Services",
          title: s.name,
          detail: s.archived ? `${s.target} · archived` : s.target,
          icon: <Server size={15} />,
        });
      for (const d of res.deployments)
        out.push({
          key: `d:${d.id}`,
          href: `/app/deployments/${d.id}`,
          group: "Deployments",
          title: (
            <>
              {d.service} {d.ref && <span className="font-mono text-con-fg2">{d.ref}</span>}
            </>
          ),
          detail: <span className="font-mono">{d.id}</span>,
          icon: <Rocket size={15} />,
          right: (
            <span className="flex items-center gap-1.5 whitespace-nowrap text-[12px] text-con-fg3">
              <Dot tone={statusTone(d.status as Status)} />
              {statusLabel[d.status as Status] ?? d.status} · {ago(d.created_at)}
            </span>
          ),
        });
    }
    for (const p of pages) out.push({ key: `p:${p.href}`, href: p.href, group: "Pages", title: p.title, icon: <Settings2 size={15} /> });
    return out;
  }, [q, res, isAdmin, canDeploy]);

  if (!open) return null;

  const go = (it: Item | undefined) => {
    if (!it) return;
    onClose();
    setQ("");
    if (it.event) {
      const ev = it.event;
      // Let the palette unmount (and return focus) before the next dialog opens.
      setTimeout(() => shellEmit(ev), 0);
    } else if (it.href) {
      startNavigationProgress(it.href);
      router.push(it.href);
    }
  };
  const current = Math.min(active, Math.max(items.length - 1, 0));

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Search">
      <button type="button" aria-label="Close search" tabIndex={-1} className="con-fade fixed inset-0 cursor-default bg-black/70" onClick={onClose} />
      <div className="con-scale-in relative w-full max-w-[600px] overflow-hidden rounded-lg border border-con-line bg-con-panel shadow-[0_24px_60px_-20px_rgb(0_0_0/0.8)]">
        <div className="flex items-center gap-3 border-b border-con-line px-4">
          {pending ? <Spinner size={16} className="text-con-fg3" /> : <Search size={16} className="shrink-0 text-con-fg3" />}
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, items.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                go(items[current]);
              } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
            placeholder="Search services, deployments, pages and actions"
            aria-label="Search"
            spellCheck={false}
            autoComplete="off"
            className="h-12 min-w-0 flex-1 bg-transparent text-[14px] text-con-fg outline-none placeholder:text-con-fg3"
          />
          <kbd className="shrink-0 rounded border border-con-line px-1.5 font-sans text-[11px] text-con-fg3">Esc</kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-1" role="listbox">
          {items.length === 0 && <li className="px-3 py-8 text-center text-[13px] text-con-fg3">{pending ? "Searching" : "No matches."}</li>}
          {items.map((it, i) => (
            <li key={it.key} role="option" aria-selected={i === current}>
              {(i === 0 || items[i - 1].group !== it.group) && <div className="px-3 pb-1 pt-2.5 text-[12px] text-con-fg3">{it.group}</div>}
              <button
                type="button"
                onMouseMove={() => setActive(i)}
                onClick={() => go(it)}
                className={cn("flex w-full items-center gap-3 rounded-md px-3 py-2 text-left", i === current ? "bg-con-row" : "hover:bg-con-hover")}
              >
                <span className="shrink-0 text-con-fg3">{it.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-con-fg">{it.title}</span>
                  {it.detail && <span className="block truncate text-[12px] text-con-fg3">{it.detail}</span>}
                </span>
                {it.right}
                {i === current && <CornerDownLeft size={13} className="shrink-0 text-con-fg3" />}
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-4 border-t border-con-line px-4 py-2 text-[11px] text-con-fg3">
          <span className="flex items-center gap-1.5">
            <kbd className="rounded border border-con-line px-1 font-sans">↑</kbd>
            <kbd className="rounded border border-con-line px-1 font-sans">↓</kbd>
            move
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="rounded border border-con-line px-1 font-sans">↵</kbd>
            open
          </span>
          <span className="ml-auto hidden sm:inline">Tip: press G then D to jump to deployments</span>
        </div>
      </div>
    </div>
  );
}
