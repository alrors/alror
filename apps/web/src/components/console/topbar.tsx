"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowUpRight, Bell, BookOpen, Check, ChevronsUpDown, CircleAlert, CircleHelp, Keyboard, LogOut, Rocket, RotateCcw, Search, Settings, TerminalSquare } from "lucide-react";
import { LogoMark } from "@/components/navbar";
import { logout, markNotificationsRead, sendFeedback, setEnvironment, switchOrg, type FeedbackState } from "@/app/app/actions";
import { CommandPalette } from "@/components/console/command-palette";
import { DeployButton, type DeployDefaults } from "@/components/console/deploy-dialog";
import { SyncIndicator } from "@/components/console/live-updates";
import { buttonClass } from "@/components/console/primitives";
import { MobileNav } from "@/components/console/sidebar";
import { Selector } from "@/components/console/selector";
import { Spinner } from "@/components/console/loader";
import { SHELL_EVENTS, shellEmit, shellOn, useModKey } from "@/components/console/shell-events";
import { startNavigationProgress } from "@/components/console/shell-progress";
import { ago } from "@/lib/console/format";
import { cn } from "@/lib/site";

/* --------------------------------- Dropdown --------------------------------- */

function Dropdown({
  trigger,
  children,
  align = "left",
  className,
  label,
  triggerClassName,
  onOpen,
}: {
  trigger: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: "left" | "right";
  className?: string;
  label: string;
  triggerClassName?: string;
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => {
          if (!open) onOpen?.();
          setOpen((o) => !o);
        }}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open && (
        <div
          className={cn(
            "con-scale-in absolute top-full z-50 mt-2 rounded-lg border border-con-line bg-con-panel p-1 shadow-[0_16px_40px_-12px_rgb(0_0_0/0.7)]",
            align === "right" ? "right-0 origin-top-right" : "left-0 origin-top-left",
            className,
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

const menuItem =
  "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-con-fg2 transition-colors duration-150 hover:bg-con-row hover:text-con-fg";
const menuLabel = "px-2 pb-1 pt-2 text-[12px] text-con-fg3";
const switcher =
  "flex h-8 items-center gap-1.5 rounded-md px-1.5 text-[14px] text-con-fg transition-colors duration-150 hover:bg-con-hover";

function Slash() {
  return (
    <svg width="16" height="20" viewBox="0 0 16 20" aria-hidden className="shrink-0 text-con-line-hover">
      <path d="M11 2 5 18" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

/* -------------------------------- Breadcrumbs -------------------------------- */

export type TopbarNotification = { id: string; title: string; body: string; href: string | null; created_at: string; read: boolean; kind: string };

export type TopbarProps = {
  org: { id: string; slug: string; name: string; plan: string };
  orgs: { id: string; slug: string; name: string; role: string }[];
  user: string;
  role: string;
  services: string[];
  /** deployment id -> service, so a deployment page can show its service in the breadcrumb */
  depService: Record<string, string>;
  environments: { name: string; protected: boolean }[];
  /** selected environment name, or null for all */
  environment: string | null;
  rolling: number;
  notifications: TopbarNotification[];
  unread: number;
  deploy: DeployDefaults;
};

function currentService(pathname: string, depService: Record<string, string>): string | null {
  const svc = pathname.match(/^\/app\/services\/([^/]+)/);
  if (svc) return decodeURIComponent(svc[1]);
  const dep = pathname.match(/^\/app\/deployments\/([^/]+)/);
  if (dep) return depService[dep[1]] ?? null;
  return null;
}

function OrgSwitcher({ org, orgs }: Pick<TopbarProps, "org" | "orgs">) {
  return (
    <Dropdown
      label="Switch organization"
      triggerClassName={switcher}
      className="w-64"
      trigger={
        <>
          <span className="max-w-[160px] truncate font-medium">{org.slug}</span>
          <span className="hidden rounded border border-con-line px-1.5 py-px text-[10px] font-medium uppercase tracking-[0.06em] text-con-fg2 sm:inline">
            {org.plan}
          </span>
          <ChevronsUpDown size={14} className="text-con-fg3" />
        </>
      }
    >
      {(close) => (
        <>
          <div className={menuLabel}>Organizations</div>
          <div className="max-h-72 overflow-y-auto">
            {orgs.map((o) =>
              o.id === org.id ? (
                <Link key={o.id} href="/app" onClick={close} className={menuItem}>
                  <OrgInitial slug={o.slug} />
                  <span className="min-w-0 flex-1 truncate text-con-fg">{o.slug}</span>
                  <Check size={14} className="text-con-fg" />
                </Link>
              ) : (
                <form key={o.id} action={switchOrg}>
                  <input type="hidden" name="org" value={o.id} />
                  <button type="submit" className={menuItem}>
                    <OrgInitial slug={o.slug} />
                    <span className="min-w-0 flex-1 truncate">{o.slug}</span>
                    <span className="text-[11px] capitalize text-con-fg3">{o.role}</span>
                  </button>
                </form>
              ),
            )}
          </div>
          <div className="my-1 h-px bg-con-line" />
          <Link href="/app/orgs" onClick={close} className={menuItem}>
            All organizations
          </Link>
          <Link href="/app/settings" onClick={close} className={menuItem}>
            Organization settings
          </Link>
        </>
      )}
    </Dropdown>
  );
}

function OrgInitial({ slug }: { slug: string }) {
  return <span className="grid h-5 w-5 shrink-0 place-items-center rounded border border-con-line text-[11px] text-con-fg">{slug[0]?.toUpperCase()}</span>;
}

function EnvSwitcher({ environments, environment }: Pick<TopbarProps, "environments" | "environment">) {
  const [pending, start] = useTransition();
  const current = environments.find((e) => e.name === environment);
  return (
    <Selector
      variant="ghost"
      aria-label="Switch environment"
      className="[&>button]:text-[14px]"
      minWidth={240}
      searchable={environments.length > 7}
      value={current?.name ?? ""}
      onValueChange={(name) => start(() => setEnvironment(name))}
      options={[
        { value: "", label: "All environments", group: "Environments" },
        ...environments.map((e) => ({ value: e.name, label: e.name, group: "Environments", meta: e.protected ? "protected" : undefined })),
      ]}
      footer="Filters deployments and releases across the console."
      renderValue={() => (
        <>
          <span className={cn("truncate", !current && "text-con-fg2")}>{current ? current.name : "All environments"}</span>
          {current?.protected && (
            <span className="hidden rounded border border-con-warn/40 bg-con-warn/10 px-1.5 py-px text-[10px] font-medium uppercase tracking-[0.06em] text-con-warn lg:inline">
              Protected
            </span>
          )}
          {pending && <Spinner size={13} className="text-con-fg3" />}
        </>
      )}
    />
  );
}

function ServiceSwitcher({ services, service }: { services: string[]; service: string | null }) {
  const router = useRouter();
  const go = (href: string) => {
    startNavigationProgress(href);
    router.push(href);
  };
  return (
    <Selector
      variant="ghost"
      aria-label="Switch service"
      className="[&>button]:text-[14px]"
      minWidth={256}
      value={service ?? ""}
      onValueChange={(s) => go(s ? `/app/services/${encodeURIComponent(s)}` : "/app/services")}
      searchPlaceholder="Find a service…"
      options={[{ value: "", label: "All services" }, ...services.map((s) => ({ value: s, label: s, group: "Services" }))]}
      renderValue={() => <span className={cn("max-w-[180px] truncate", !service && "text-con-fg2")}>{service ?? "All services"}</span>}
    />
  );
}

function Breadcrumbs({ org, orgs, services, depService, environments, environment }: Pick<TopbarProps, "org" | "orgs" | "services" | "depService" | "environments" | "environment">) {
  const pathname = usePathname();
  const service = currentService(pathname, depService);
  return (
    <div className="flex min-w-0 items-center">
      <Link href="/app" className="mr-1 shrink-0" aria-label="Alror console home">
        <LogoMark className="h-7 w-7" />
      </Link>
      <Slash />
      <OrgSwitcher org={org} orgs={orgs} />
      <span className="hidden items-center md:flex">
        <Slash />
        <ServiceSwitcher services={services} service={service} />
        <Slash />
        <EnvSwitcher environments={environments} environment={environment} />
      </span>
    </div>
  );
}

/* ---------------------------------- Pieces ---------------------------------- */

const iconBtn =
  "relative grid h-8 w-8 place-items-center rounded-full border border-con-line text-con-fg2 transition-colors duration-150 hover:border-con-line-hover hover:text-con-fg";

function Notifications({ items, unread }: { items: TopbarNotification[]; unread: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // Optimistic read state, reset whenever the server sends a fresh list.
  const [readIds, setReadIds] = useState<{ src: TopbarNotification[]; ids: Set<string> }>({ src: items, ids: new Set() });
  const ids = readIds.src === items ? readIds.ids : new Set<string>();
  const isRead = (n: TopbarNotification) => n.read || ids.has(n.id);
  const count = Math.max(0, unread - items.filter((n) => !n.read && ids.has(n.id)).length);

  const markAll = () => {
    setReadIds({ src: items, ids: new Set(items.map((n) => n.id)) });
    start(() => markNotificationsRead());
  };
  const open = (n: TopbarNotification, close: () => void) => {
    close();
    if (!isRead(n)) {
      setReadIds({ src: items, ids: new Set([...ids, n.id]) });
      start(() => markNotificationsRead([n.id]));
    }
    if (n.href) {
      startNavigationProgress(n.href);
      router.push(n.href);
    }
  };

  return (
    <Dropdown
      label={`Notifications (${count} unread)`}
      align="right"
      className="w-[min(400px,calc(100vw-2rem))] p-0"
      triggerClassName={iconBtn}
      trigger={
        <>
          <Bell size={15} />
          {count > 0 && (
            <span className="absolute -right-1.5 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-con-fg px-1 text-[10px] font-semibold tabular-nums text-black ring-2 ring-con-bg">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </>
      }
    >
      {(close) => (
        <>
          <div className="flex items-center justify-between border-b border-con-line px-4 py-3">
            <span className="text-[14px] font-medium text-con-fg">
              Notifications{count > 0 && <span className="ml-2 text-[12px] font-normal text-con-fg3">{count} unread</span>}
            </span>
            <button type="button" disabled={count === 0 || pending} onClick={markAll} className="text-[12px] text-con-fg2 hover:text-con-fg disabled:opacity-50">
              Mark all read
            </button>
          </div>
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <Bell size={18} className="mx-auto text-con-fg3" />
              <p className="mt-2 text-[13px] text-con-fg2">No notifications yet.</p>
              <p className="mt-0.5 text-[12px] text-con-fg3">Failed releases and rollbacks show up here.</p>
            </div>
          ) : (
            <div className="max-h-[420px] overflow-y-auto">
              {groupByDay(items).map((g) => (
                <section key={g.label}>
                  <h3 className="sticky top-0 z-[1] border-b border-con-line bg-con-panel px-4 py-1.5 text-[11px] font-medium uppercase tracking-[0.04em] text-con-fg3">
                    {g.label}
                  </h3>
                  <ul className="divide-y divide-con-line">
                    {g.items.map((n) => {
                      const read = isRead(n);
                      const k = kindOf(n.kind);
                      return (
                        <li key={n.id}>
                          <button type="button" onClick={() => open(n, close)} className="flex w-full gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-con-hover">
                            <span className={cn("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md border border-con-line", k.tone)} aria-hidden>
                              <k.icon size={13} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center justify-between gap-3">
                                <span className={cn("min-w-0 truncate text-[13px]", read ? "text-con-fg2" : "font-medium text-con-fg")}>{n.title}</span>
                                <span className="flex shrink-0 items-center gap-2 text-[12px] text-con-fg3">
                                  {ago(n.created_at)}
                                  {!read && <span className="h-1.5 w-1.5 rounded-full bg-con-fg" aria-label="Unread" />}
                                </span>
                              </span>
                              {n.body && <span className="mt-1 line-clamp-2 block font-mono text-[12px] text-con-fg3">{n.body}</span>}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
          <div className="border-t border-con-line px-4 py-2 text-[12px]">
            <Link href="/app/deployments" onClick={close} className="text-con-fg2 transition-colors duration-150 hover:text-con-fg">
              View all deployments
            </Link>
          </div>
        </>
      )}
    </Dropdown>
  );
}

function kindOf(kind: string) {
  if (kind.endsWith("failed")) return { icon: CircleAlert, tone: "text-con-bad" };
  if (kind.endsWith("rolled_back")) return { icon: RotateCcw, tone: "text-con-warn" };
  if (kind.startsWith("deployment")) return { icon: Rocket, tone: "text-con-fg2" };
  return { icon: Bell, tone: "text-con-fg2" };
}

/** Today / Yesterday / Earlier, in the viewer's local time. */
function groupByDay(items: TopbarNotification[]) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const today = start.getTime();
  const yesterday = today - 86_400_000;
  const groups: { label: string; items: TopbarNotification[] }[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Earlier", items: [] },
  ];
  for (const n of items) {
    const t = new Date(n.created_at).getTime();
    groups[t >= today ? 0 : t >= yesterday ? 1 : 2].items.push(n);
  }
  return groups.filter((g) => g.items.length > 0);
}

/* ----------------------------------- Help ----------------------------------- */

function HelpMenu({ docsUrl }: { docsUrl: string }) {
  const mod = useModKey();
  return (
    <Dropdown label="Help" align="right" className="w-64" triggerClassName={cn(iconBtn, "hidden sm:grid")} trigger={<CircleHelp size={15} />}>
      {(close) => (
        <>
          <div className={menuLabel}>Help</div>
          <a href={docsUrl} target="_blank" rel="noreferrer" onClick={close} className={menuItem}>
            <BookOpen size={14} />
            <span className="flex-1">Documentation</span>
            <ArrowUpRight size={13} className="text-con-fg3" />
          </a>
          <button
            type="button"
            onClick={() => {
              close();
              shellEmit(SHELL_EVENTS.openShortcuts);
            }}
            className={menuItem}
          >
            <Keyboard size={14} />
            <span className="flex-1">Keyboard shortcuts</span>
            <kbd className="rounded border border-con-line px-1 font-sans text-[11px] text-con-fg3">?</kbd>
          </button>
          <button
            type="button"
            onClick={() => {
              close();
              shellEmit(SHELL_EVENTS.openPalette);
            }}
            className={menuItem}
          >
            <Search size={14} />
            <span className="flex-1">Command palette</span>
            <kbd className="rounded border border-con-line px-1 font-sans text-[11px] text-con-fg3">{mod} K</kbd>
          </button>
          <Link href="/app/onboarding" onClick={close} className={menuItem}>
            <TerminalSquare size={14} />
            <span className="flex-1">Setup checklist</span>
          </Link>
        </>
      )}
    </Dropdown>
  );
}

function Feedback() {
  const pathname = usePathname();
  const [state, action, pending] = useActionState<FeedbackState, FormData>(sendFeedback, undefined);
  // After a successful send the menu shows a thank-you until it is opened again.
  const [seen, setSeen] = useState<FeedbackState>(undefined);
  const thanks = Boolean(state?.ok) && state !== seen;
  return (
    <Dropdown
      label="Send feedback"
      align="right"
      className="w-[min(360px,calc(100vw-2rem))] p-0"
      triggerClassName="hidden h-8 items-center rounded-md border border-con-line px-3 text-[13px] text-con-fg2 transition-colors duration-150 hover:border-con-line-hover hover:text-con-fg xl:inline-flex"
      trigger="Feedback"
      onOpen={() => setSeen(state)}
    >
      {() =>
        thanks ? (
          <div className="p-4 text-[13px] text-con-fg2">Thanks. Your feedback is saved for the admins of this organization.</div>
        ) : (
          <form action={action} className="space-y-3 p-4">
            <input type="hidden" name="page" value={pathname} />
            <label htmlFor="feedback-message" className="block text-[14px] font-medium text-con-fg">
              Feedback
            </label>
            <textarea
              id="feedback-message"
              name="message"
              rows={4}
              required
              minLength={3}
              maxLength={4000}
              placeholder="What could be better on this page?"
              className="w-full resize-y rounded-md border border-con-line bg-con-bg px-2.5 py-2 text-[13px] text-con-fg outline-none placeholder:text-con-fg3 focus-visible:border-con-line-hover"
            />
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] text-con-bad">{state?.error}</span>
              <button type="submit" disabled={pending} className={buttonClass.primary}>
                {pending && <Spinner />}
                Send
              </button>
            </div>
          </form>
        )
      }
    </Dropdown>
  );
}

function UserMenu({ user, org, role }: { user: string; org: string; role: string }) {
  return (
    <Dropdown
      label="Account"
      align="right"
      className="w-60"
      triggerClassName="grid h-8 w-8 place-items-center rounded-full bg-con-row text-[13px] font-medium text-con-fg ring-1 ring-con-line transition-colors duration-150 hover:ring-con-line-hover"
      trigger={user.slice(0, 1).toUpperCase()}
    >
      {(close) => (
        <>
          <div className="border-b border-con-line px-2 pb-2.5 pt-1.5">
            <div className="truncate text-[14px] text-con-fg">{user}</div>
            <div className="text-[12px] text-con-fg3">
              {role.charAt(0).toUpperCase() + role.slice(1)} · {org}
            </div>
          </div>
          <div className="mt-1">
            <Link href="/app/settings" onClick={close} className={menuItem}>
              <Settings size={14} />
              Settings
            </Link>
            <Link href="/app/onboarding" onClick={close} className={menuItem}>
              <TerminalSquare size={14} />
              Connect the CLI
            </Link>
          </div>
          <div className="my-1 h-px bg-con-line" />
          <form action={logout}>
            <button type="submit" className={menuItem}>
              <LogOut size={14} />
              Sign out
            </button>
          </form>
        </>
      )}
    </Dropdown>
  );
}

function SearchButton({ onOpen, className }: { onOpen: () => void; className?: string }) {
  const mod = useModKey();
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex h-8 w-56 items-center gap-2 rounded-full border border-con-line bg-con-bg px-3 text-left text-con-fg3 transition-colors duration-150 hover:border-con-line-hover xl:w-64",
        className,
      )}
    >
      <Search size={14} className="shrink-0" />
      <span className="flex-1 text-[13px]">Search...</span>
      <kbd className="shrink-0 rounded border border-con-line px-1 font-sans text-[11px] text-con-fg3">{mod} K</kbd>
    </button>
  );
}

/* ---------------------------------- Top bar ---------------------------------- */

export function Topbar(props: TopbarProps & { docsUrl: string }) {
  const { org, orgs, user, role, services, depService, environments, environment, rolling, notifications, unread, deploy, docsUrl } = props;
  const [paletteOpen, setPaletteOpen] = useState(false);
  const deployRef = useRef<HTMLSpanElement>(null);
  const isAdmin = role === "owner" || role === "admin";
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    const offPalette = shellOn(SHELL_EVENTS.openPalette, () => setPaletteOpen(true));
    // The palette's "Deploy…" action opens the same dialog as the top bar button.
    const offDeploy = shellOn(SHELL_EVENTS.openDeploy, () => deployRef.current?.querySelector("button")?.click());
    return () => {
      window.removeEventListener("keydown", onKey);
      offPalette();
      offDeploy();
    };
  }, []);

  return (
    <header className="relative z-30 flex h-14 shrink-0 items-center gap-2 border-b border-con-line bg-con-bg px-3 sm:px-4">
      <MobileNav docsUrl={docsUrl} rolling={rolling} />
      <Breadcrumbs org={org} orgs={orgs} services={services} depService={depService} environments={environments} environment={environment} />
      {deploy.services.length > 0 && (
        <span ref={deployRef} className="contents">
          <DeployButton defaults={deploy} variant="topbar" />
        </span>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <SyncIndicator />
        {rolling > 0 && (
          <Link
            href="/app/deployments?status=rolling"
            className="hidden h-8 items-center gap-2 rounded-full border border-con-line px-3 text-[13px] text-con-fg2 transition-colors duration-150 hover:border-con-line-hover hover:text-con-fg 2xl:inline-flex"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-con-info" aria-hidden />
            {rolling} rollout{rolling === 1 ? "" : "s"} in progress
          </Link>
        )}
        <Feedback />
        <SearchButton onOpen={() => setPaletteOpen(true)} className="hidden lg:flex" />
        <button type="button" onClick={() => setPaletteOpen(true)} className={cn(iconBtn, "lg:hidden")} aria-label="Search">
          <Search size={15} />
        </button>
        <HelpMenu docsUrl={docsUrl} />
        <Notifications items={notifications} unread={unread} />
        <UserMenu user={user} org={org.slug} role={role} />
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} isAdmin={isAdmin} canDeploy={deploy.services.length > 0} />
    </header>
  );
}
