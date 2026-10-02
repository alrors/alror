<div align="center">

<img src="../../docs/images/logo.svg" width="72" alt="Alror logo" />

# alror · web

**The Alror website and the login-protected release console.**

Next.js 16 · React 19 · Tailwind v4 · no runtime CDNs, works offline

[Website](#website) · [Console](#console) · [Run it](#run-it) · [Scripts](#scripts) · [Core CLI repo](https://github.com/alrors/alror) · [Roadmap](https://github.com/orgs/alrors/projects/1)

<br/>

<img src="../../docs/images/landing-hero.webp" alt="Alror landing page hero: Ship every change at the speed of AI, safely, with the release workflow visual" width="100%" />

</div>

---

## Website

A dark, product-led landing page for a deployment-safety product. Every visual shows the real product: the release workflow, the actual `alror` CLI output, and the console.

<img src="../../docs/images/landing-features.webp" alt="Feature rows: a GitHub risk check with reasons, and a canary vs baseline verification chart" width="100%" />

<table>
<tr>
<td width="50%"><img src="../../docs/images/landing-problem.webp" alt="The problem section with a documentary plate and DORA statistics" /></td>
<td width="50%">

**Sections**

- Hero with the release workflow and proof points
- Integration logo grid (Simple Icons, bundled)
- The release gate: real `alror risk` and rollback output
- The console, the problem (DORA 2025), how it protects you
- Personas, how it works, comparison, security
- Published pricing, FAQ, Early Access ticket

</td>
</tr>
</table>

## Console

`/login` → `/app`. A clean, enterprise-dark console over the CLI's `.alror/` state, with a navigation flow modelled on the best developer dashboards: **organizations → services → service → release**.

<img src="../../docs/images/console-services.webp" alt="Console services home: live rollout cards with rollout trees, service cards with sparklines, usage column" width="100%" />

<table>
<tr>
<td width="50%"><img src="../../docs/images/console-deployment.webp" alt="Deployment detail: vertical rollout tree with a red rollback branch, verdict charts against policy limits, summary and risk gauge" /></td>
<td width="50%"><img src="../../docs/images/console-insights.webp" alt="Insights: DORA KPIs with sparklines, deploy activity, risk distribution, service heatmap" /></td>
</tr>
<tr>
<td align="center"><sub><b>Release detail:</b> rollout tree, verdicts, one-click rollback</sub></td>
<td align="center"><sub><b>Insights:</b> DORA trends, AI vs human, risk vs outcome</sub></td>
</tr>
<tr>
<td width="50%"><img src="../../docs/images/console-deployments.webp" alt="Deployments list with status tabs, filters and pagination" /></td>
<td width="50%"><img src="../../docs/images/console-collapsed.webp" alt="Console with the sidebar collapsed to an icon rail" /></td>
</tr>
<tr>
<td align="center"><sub><b>Deployments:</b> status tabs, filters, pagination</sub></td>
<td align="center"><sub><b>Collapsible sidebar</b> (Ctrl+B), remembered across visits</sub></td>
</tr>
</table>

| Page | What it shows |
| --- | --- |
| `/app` | Services with live rollouts, sparklines and status; **New service** (owners/admins), archived services, usage against the plan's limits |
| `/app/services/[name]` | Status tiles, traffic topology, jobs, recent releases (filtered by environment); **Deploy**, **Edit**, **Archive/Restore** |
| `/app/deployments` | Every release with status tabs, environment, service, risk and search filters, and pagination; **Deploy** |
| `/app/deployments/[id]` | Rollout tree, verdict charts, event log, jobs, **Roll back** (queues a job for `alror runner`) |
| `/app/jobs` | Deploy and rollback jobs: status (queued, running, stalled, done, failed, canceled), runner, attempts, heartbeat; cancel queued jobs |
| `/app/insights` | Deploy frequency, change failure rate, time to restore, AI vs human |
| `/app/policies` | Editable rollback mode, alpha, bake scale, verification thresholds and rollout plans (owners/admins; validated and audit-logged) |
| `/app/settings` | General: rename the org and change its slug, environments, leave the org |
| `/app/settings/members` | Members: change roles, remove people (owners/admins) |
| `/app/settings/invites` | Invite links with a role (shown once, 7 days), pending invites, revoke |
| `/app/settings/api-keys` | API keys with scopes, shown once in a copy dialog; prefix, last used, created by; revoke |
| `/app/settings/audit` | Paginated audit log with category filters |
| `/app/settings/feedback` | Feedback sent from the top bar (stored in the database) |
| `/app/onboarding` | Getting started after signup: API key, `alror login`, `alror config push`, `alror runner`, first deploy |
| `/app/orgs` | Organization switcher |

The top bar has an organization switcher, an environment switcher (filters deployments and releases), a Deploy dialog, Ctrl/Cmd+K search over services, deployments and pages, notifications with unread counts, and a Feedback form. Pages refresh live from `/api/v1/stream` when deployments or jobs change.

**Security:**

- Accounts with scrypt-hashed passwords; login is rate limited in Redis (10 failures per 15 minutes per IP and per email).
- Opaque, Redis-backed sessions in the HttpOnly `alror_sid` cookie (7-day sliding TTL).
- API keys (`alr_live_…`, stored as sha256) with scopes for the CLI, CI and `alror runner`.
- `/app/*` is guarded by the Next 16 proxy (cookie present) and the session is validated in the layout, the data layer and every action and route.
- Every query is scoped to the caller's org.

## Admin

`/admin` is the operator panel for whoever runs this Alror instance, across **all** organizations (each org's own owners and admins keep using `/app/settings`). It has its own shell: a compact sidebar, an **Admin** marker in the top bar and a link back to the console.

| Page | What it shows and does |
| --- | --- |
| `/admin` | Instance KPIs (orgs, users, active API keys, deploys 24h/7d/30d, rollback rate, queued/claimed/stalled jobs, runners seen in the last 5 minutes), deploy activity, and what needs attention (stalled jobs, failed jobs, orgs rolling back 20% or more) |
| `/admin/orgs` | Search, plan filter, sort and pagination; members, services, deploys and rollback rate per org |
| `/admin/orgs/[id]` | Usage against `PLAN_LIMITS`, members, API keys (revoke one or all), services, recent deployments; **change plan**, **delete org** (type the slug to confirm) |
| `/admin/users` · `/admin/users/[id]` | Every account with orgs, roles, active sessions and last sign-in; **sign out everywhere** (deletes their Redis sessions), **reset password** (a temporary password shown once), **remove from an org** (never the last owner) |
| `/admin/jobs` | The queue across orgs with status, org, kind and runner filters, stalled detection (no heartbeat for 2 minutes), **cancel** and **requeue**; runners derived from claims and heartbeats |
| `/admin/plugins` | Marketplace installs per plugin across orgs and votes for planned plugins |
| `/admin/feedback` | Feedback from every org, filterable by org, date and text (read-only) |
| `/admin/audit` | Every org's audit log with org, category and text filters; an **Admin actions** view of everything done here |
| `/admin/system` | Postgres version and size, migration status (journal vs applied), Redis ping, memory and sessions, app version, configuration checks, rows and size per table |

**Who is a platform admin:** the comma-separated emails in `ALROR_PLATFORM_ADMINS`. When it is unset, development defaults to `admin@acme.test` (the seed's owner) and production allows nobody. There is no database flag for it.

**Access:** anyone else, signed in or not, gets a plain **404** (never a redirect), so the route is not revealed. `src/proxy.ts` asks `/admin/api/access` for every admin page request (pages stream, so only the proxy can still set a 404 status); the admin layout, every page, every server action and every route handler check again (`src/lib/server/admin/guard.ts`), and the admin data functions refuse a non-admin context.

**Audit:** every admin mutation writes an `admin.*` row to the affected org's audit log (actor `email (platform admin)`, so the org's owners see it) and an entry in the instance log (Redis list `admin:log`, newest 1000), which also keeps org deletions after the org's own rows are gone. JSON counterparts of the actions live at `/admin/api/<action>` for scripts and the tests (`npm run test:admin`).

Org suspension is not implemented: it needs a schema column, and this area adds no migration.

## Run it

```bash
npm install
docker compose up -d            # PostgreSQL 16 + Redis 7 (docker-compose.yml)
cp .env.example .env.local      # then set ALROR_SESSION_SECRET
npm run db:migrate              # apply drizzle/*.sql
npm run db:seed                 # demo org "acme" + an API key in .alror-dev-key (dev only)
npm run dev                     # http://localhost:3000
```

| | |
| --- | --- |
| Website | http://localhost:3000 |
| Console | http://localhost:3000/login, with **admin@acme.test / alror-demo** (or dev@acme.test, a member) |
| Platform API | http://localhost:3000/api/v1 (see [docs/platform-contract.md](../../docs/platform-contract.md)) |

Connect the CLI with `alror login --server http://localhost:3000 --key "$(cat .alror-dev-key)"`, and run `alror runner` to execute the deploy and rollback jobs the console queues. With an empty database, `/signup` creates the first account and org.

Configuration lives in `.env.local` (see [.env.example](.env.example)):

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://alror:alror@localhost:5432/alror` | PostgreSQL (system of record) |
| `REDIS_URL` | `redis://localhost:6379` | Sessions, rate limits, job signal, pub/sub |
| `ALROR_SESSION_SECRET` | dev fallback (warns) | Random 32+ bytes; **required** in production |
| `ALROR_PUBLIC_URL` | `http://localhost:3000` | Base URL for invite links |
| `ALROR_COOKIE_SECURE` | on in production | Force the Secure cookie flag |
| `ALROR_PLATFORM_ADMINS` | `admin@acme.test` in development, nobody in production | Comma-separated emails allowed into `/admin` |
| `NEXT_PUBLIC_ALROR_DOCS_URL` | `http://127.0.0.1:4100` | Docs link (served by `alror docs`) |
| `GEMINI_API_KEY` | unset | Only for `scripts/gen-images.py` |

## Scripts

| Script | What it does |
| --- | --- |
| `npm run db:generate` | Generates a SQL migration in `drizzle/` from `src/lib/server/db/schema.ts` |
| `npm run db:migrate` | Applies the migrations |
| `npm run db:seed` | Dev only, idempotent: org acme, 2 users, 12 services, 30 days of history (about 225 releases, 2 live rollouts), an API key |
| `npm run test:api` | Integration tests against the running dev server and database |
| `npm run test:admin` | Admin area tests (404 for non-admins, admin actions) against the running dev server |
| `python scripts/terminal-shot.py out.ansi out.webp --cmd "…"` | Renders real `alror --color always` output as a terminal-window image |
| `python scripts/gen-images.py [name]` | Generates the documentary images with Gemini (key read from `.env.local`) |

## Structure

```
src/app/page.tsx              landing page
src/app/login, src/app/app    console routes (proxy-guarded)
src/app/admin                 instance admin panel (platform admins only, 404 for everyone else)
src/components/admin          admin UI: sidebar, action buttons, dialogs
src/lib/server/admin          admin access check, cross-org queries and actions, instance log
src/components                landing sections (hero, sections, pricing, faq…)
src/components/console        console UI: topbar, sidebar, rollout tree, charts, pagination
src/lib/console               console-facing reads (backed by src/lib/server), analytics, paginate, rollout tree
src/lib/server                db (Drizzle schema + client), redis, auth, data layer, API helpers
src/app/api/v1                platform REST API (see docs/platform-contract.md)
src/proxy.ts                  /app and /admin guard
drizzle                       committed SQL migrations
tests                         API and admin integration tests (npm run test:api, npm run test:admin)
public/generated              product images and CLI captures
scripts                       seeding and image tooling
```

---

<div align="center"><sub>Part of <b>Alror</b>: risk-scored, verified, auto-reversed releases. Track progress on the <a href="https://github.com/orgs/alrors/projects/1">Alror roadmap</a>.</sub></div>
