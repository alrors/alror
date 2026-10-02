// The error and failure screens listed on /dev/errors (development only).

export type Preview = { href: string; title: string; detail: string; where: "Site" | "Console" };

export const PREVIEWS: { group: string; items: Preview[] }[] = [
  {
    group: "Not found",
    items: [
      { href: "/dev/errors/not-found", title: "Page not found", detail: "Site-wide 404 for unknown URLs and notFound() outside the console.", where: "Site" },
      {
        href: "/app/deployments/00000000-0000-4000-8000-000000000000",
        title: "Console: unknown deployment",
        detail: "notFound() from the deployment page, inside the console shell, with deployment-specific suggestions.",
        where: "Console",
      },
      { href: "/app/services/no-such-service", title: "Console: unknown service", detail: "The same screen for a service name that doesn't exist.", where: "Console" },
      { href: "/app/no/such/page", title: "Console: unknown page", detail: "Unknown /app paths stay inside the shell ([...missing]).", where: "Console" },
    ],
  },
  {
    group: "Errors",
    items: [
      { href: "/dev/errors/route-error", title: "Route error", detail: "src/app/error.tsx: an unexpected error outside the console.", where: "Site" },
      {
        href: "/app/dev/errors/route-error",
        title: "Console: route error",
        detail: "src/app/app/error.tsx inside the shell, with Retry, Reload and development details.",
        where: "Console",
      },
      { href: "/dev/errors/global-error", title: "Global error", detail: "The global-error.tsx body (the root layout failed); inline styles only.", where: "Site" },
    ],
  },
  {
    group: "Workspace unavailable",
    items: [
      {
        href: "/dev/errors/database-unavailable",
        title: "Database unavailable",
        detail: "Full-page screen, as the console layout renders it when Postgres can't be reached.",
        where: "Site",
      },
      { href: "/dev/errors/cache-unavailable", title: "Cache unavailable", detail: "The same screen for Redis.", where: "Site" },
      {
        href: "/app/dev/errors/database-unavailable",
        title: "Console: database unavailable",
        detail: "A page's data load hit the outage after the shell rendered (src/app/app/error.tsx).",
        where: "Console",
      },
      { href: "/app/dev/errors/cache-unavailable", title: "Console: cache unavailable", detail: "The same, for Redis.", where: "Console" },
    ],
  },
  {
    group: "Live updates, actions and access",
    items: [
      { href: "/app/deployments?preview-sync=reconnecting", title: "Reconnecting banner", detail: "Stream lost: countdown to the next attempt and Retry now.", where: "Console" },
      { href: "/app/deployments?preview-sync=offline", title: "Offline banner", detail: "navigator.onLine is false; waits for the browser to come back.", where: "Console" },
      { href: "/app/deployments?preview-sync=back", title: "Back online", detail: "Short confirmation that fades out after a visible outage.", where: "Console" },
      {
        href: "/app/dev/errors/action-toast",
        title: "Action failure toast",
        detail: "A mutation that fails: error toast with the message and Retry (re-submits the same form data).",
        where: "Console",
      },
      { href: "/app/dev/errors/access-denied", title: "Access denied", detail: "What a member sees on an owner/admin page: role, who can grant access.", where: "Console" },
    ],
  },
];
