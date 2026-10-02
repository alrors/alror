import type { Metadata } from "next";
import "@/components/console/overview/dashboard.css";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { ConsoleUnavailable } from "@/components/errors/console-unavailable";
import { LiveUpdates } from "@/components/console/live-updates";
import { ShellBreadcrumbs } from "@/components/console/shell-breadcrumbs";
import { ShellProgress } from "@/components/console/shell-progress";
import { ShellShortcuts } from "@/components/console/shell-shortcuts";
import { ShellToaster } from "@/components/console/shell-toast";
import { Sidebar } from "@/components/console/sidebar";
import { Topbar } from "@/components/console/topbar";
import { requireSession } from "@/lib/console/auth";
import { DOCS_URL as LOCAL_DOCS_URL } from "@/lib/console/config";
import { listDeployments } from "@/lib/console/data";
import { environments, selectedEnvironment } from "@/lib/console/environments";
import { readProjectConfig } from "@/lib/console/policy";
import { SIDEBAR_COOKIE } from "@/lib/console/prefs";
import { ctxFor } from "@/lib/server/auth/accounts";
import { listNotifications, unreadCount } from "@/lib/server/data/notifications";
import { listOrgsForUser } from "@/lib/server/data/orgs";
import { classifyError, ServiceUnavailableError } from "@/lib/server/errors";
import { isUnavailable } from "@/lib/error-kind";

export const metadata: Metadata = {
  title: { default: "Console · Alror", template: "%s · Alror console" },
  robots: { index: false },
};

// Docs link: NEXT_PUBLIC_ALROR_DOCS_URL when set, else the public documentation.
const DOCS_URL = process.env.NEXT_PUBLIC_ALROR_DOCS_URL || LOCAL_DOCS_URL;

async function loadShell() {
  // Defense in depth: the proxy only checks the cookie exists; this validates the session in Redis.
  const session = await requireSession();
  const ctx = ctxFor(session);
  const [deps, config, jar, orgs, envs, env, notifications, unread] = await Promise.all([
    listDeployments(),
    readProjectConfig(),
    cookies(),
    listOrgsForUser(session.user.id),
    environments(),
    selectedEnvironment(),
    listNotifications(ctx, { limit: 20 }),
    unreadCount(ctx),
  ]);
  return { session, deps, config, jar, orgs, envs, env, notifications, unread };
}

export default async function ConsoleLayout({ children }: LayoutProps<"/app">) {
  // A Postgres or Redis outage renders the full-page "workspace unavailable"
  // screen here, on the server, where the original error can still be inspected
  // (error.tsx would only get a digest in production). It polls /api/v1/health
  // and refreshes once the stores answer. Redirects and other errors pass through.
  let shell: Awaited<ReturnType<typeof loadShell>>;
  try {
    shell = await loadShell();
  } catch (e) {
    unstable_rethrow(e);
    const kind = e instanceof ServiceUnavailableError ? e.kind : classifyError(e);
    if (!isUnavailable(kind)) throw e;
    const digest = e instanceof ServiceUnavailableError ? e.digest : new ServiceUnavailableError(kind, e).digest;
    console.error(`[alror] console unavailable (${kind}, ${digest}):`, (e as Error).message);
    return <ConsoleUnavailable kind={kind} digest={digest} />;
  }
  const { session, deps, config, jar, orgs, envs, env, notifications, unread } = shell;
  const collapsed = jar.get(SIDEBAR_COOKIE)?.value === "collapsed";
  const rolling = deps.filter((d) => d.status === "rolling" || d.status === "pending").length;
  const services = config.services.map((s) => s.name).sort();
  const depService = Object.fromEntries(deps.map((d) => [d.id, d.service]));

  return (
    // The shell owns the viewport: the top bar is a fixed row and only <main> scrolls,
    // so page content can never sit underneath the bar.
    <div className="console-shell flex h-dvh max-h-dvh min-h-0 shrink-0 flex-col overflow-hidden bg-con-bg text-con-fg">
      <Suspense fallback={null}>
        <ShellProgress />
      </Suspense>
      <ShellShortcuts />
      <ShellToaster />
      <Topbar
        org={session.org}
        orgs={orgs.map((o) => ({ id: o.id, slug: o.slug, name: o.name, role: o.role }))}
        user={session.user.email}
        role={session.role}
        services={services}
        depService={depService}
        environments={envs.map((e) => ({ name: e.name, protected: e.protected }))}
        environment={env}
        rolling={rolling}
        notifications={notifications.map((n) => ({ id: n.id, title: n.title, body: n.body, href: n.href, created_at: n.created_at, read: n.read, kind: n.kind }))}
        unread={unread}
        deploy={{ services, environments: envs.map((e) => ({ name: e.name, protected: e.protected })), environment: env ?? undefined }}
        docsUrl={DOCS_URL}
      />
      {/* Live updates; renders the slim connection banner under the top bar when degraded. */}
      <LiveUpdates key={session.org.id} />
      <div className="flex min-h-0 flex-1">
        <Sidebar docsUrl={DOCS_URL} rolling={rolling} initialCollapsed={collapsed} />
        <main data-scroller className="con-scroll min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-8 sm:py-6">
            <ShellBreadcrumbs depService={depService} />
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
