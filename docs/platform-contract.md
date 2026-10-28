# Alror platform contract (v1)

This is the single source of truth shared by the Alror platform (the Next.js app in `apps/web`, with the console and the platform API) and the Go CLI, runner and SDKs at the repository root.

Everything is self-hosted. **PostgreSQL 16** and **Redis 7** run in Docker; no external SaaS or third-party API keys are used.

## 1. Runtime topology

```
 developer / CI ──alror CLI──┐  Authorization: Bearer alr_live_…
                             ▼
 browser ──session cookie──▶ Next.js (apps/web): the Alror platform / workspace
                               ├─ /app, /login, /signup …     console UI (server components)
                               ├─ /api/v1/*                    platform REST API
                               └─ /api/v1/stream               SSE live updates
                                     │                 │
                                PostgreSQL 16       Redis 7
                               (system of record)  (sessions, job queue signal, pub/sub, rate limits)
                                     ▲
 alror runner (Go) ──claims jobs over /api/v1/jobs/claim──┘   runs deploy / rollback with the engine
```

- **CLI in connected mode** (when a server is configured) reads services and policy from `GET /api/v1/config`, writes deployments and events through the API, and never touches the database directly.
- **Console actions** (Deploy, Roll back) enqueue **jobs**. An `alror runner` (Go) claims and executes them with the real engine, so the console never shells out to the CLI.
- **Local mode** (no server configured) keeps working exactly as today, using `alror.yaml` and the `.alror/` file store.

## 2. Docker

`docker-compose.yml` lives in `apps/web`:

| Service | Image | Port | Credentials / data |
| --- | --- | --- | --- |
| postgres | `postgres:16-alpine` | 5432 | user `alror`, password `alror`, db `alror`; volume `pgdata` |
| redis | `redis:7-alpine` | 6379 | `--appendonly yes`; volume `redisdata` |

Environment for `apps/web` (`.env.local`, never committed; documented in `.env.example`):

```
DATABASE_URL=postgres://alror:alror@localhost:5432/alror
REDIS_URL=redis://localhost:6379
ALROR_SESSION_SECRET=<random 32+ bytes>      # signs nothing secret-bearing; used for CSRF tokens
ALROR_PUBLIC_URL=http://localhost:3000
```

## 3. Database schema (PostgreSQL, Drizzle ORM, SQL migrations committed)

All ids are `uuid` (`gen_random_uuid()`) except `deployments.id`, which is the CLI's `dep_<UTCyyyymmddTHHMMSS>_<6hex>` text id. Timestamps are `timestamptz`.

| Table | Columns |
| --- | --- |
| `users` | id, email (unique, lowercased), name, password_hash (`scrypt$N$r$p$saltB64$hashB64`), created_at, last_login_at |
| `orgs` | id, slug (unique), name, plan (`free`\|`team`\|`business`, default `team`), created_at |
| `memberships` | org_id, user_id, role (`owner`\|`admin`\|`member`), created_at; PK (org_id, user_id) |
| `invites` | id, org_id, email, role, token_hash (sha256 hex), invited_by, expires_at, accepted_at, created_at |
| `api_keys` | id, org_id, name, prefix (first 12 chars of the token, shown in the UI), key_hash (sha256 hex, unique), scopes text[] (`deploy:read`, `deploy:write`, `jobs:run` (used by `alror runner`), `config:write`), created_by, created_at, last_used_at, revoked_at |
| `environments` | id, org_id, name (`production`, `staging`, …), protected bool; unique (org_id, name) |
| `services` | id, org_id, name, paths text[], target (`simulated`\|`kubernetes`\|`ecs`), cluster, namespace, critical bool, policy_override jsonb null, created_at, archived_at null; unique (org_id, name) |
| `org_policies` | org_id PK, max_regression jsonb (default `{"error_rate":0.25,"latency_p95":0.15}`), alpha numeric (0.05), auto_rollback bool (true), bake_scale numeric (1), metrics jsonb (default `{"provider":"synthetic"}`), slack_webhook text null, plans jsonb null (custom rollout plans, see section 5), updated_at, updated_by |
| `deployments` | id text PK, org_id, service_id, environment_id, service (text, denormalised name), image, ref, status (`pending`\|`rolling`\|`promoted`\|`rolled_back`\|`failed`), step_index int, weight int, reason text, risk jsonb, plan jsonb, source (`cli`\|`console`\|`ci`\|`runner`), created_by_user null, created_by_key null, created_at, updated_at; indexes (org_id, created_at desc), (org_id, service_id, created_at desc), (org_id, status) |
| `deployment_events` | id bigserial, deployment_id, at, kind (`created`\|`step`\|`verdict`\|`promoted`\|`rolled_back`\|`error`), message, weight int null, verdict jsonb null; index (deployment_id, id) |
| `jobs` | id, org_id, kind (`deploy`\|`rollback`), payload jsonb, status (`queued`\|`claimed`\|`done`\|`failed`\|`canceled`), requested_by_user null, requested_by_key null, claimed_by text null (the runner's name), claimed_by_key null, claimed_at, heartbeat_at null, attempts int (default 0), finished_at, error text, deployment_id text null, created_at |
| `audit_log` | id bigserial, org_id, actor_type (`user`\|`api_key`\|`system`), actor_id, actor_label, action (e.g. `service.create`, `policy.update`, `api_key.create`, `deployment.rollback`, `member.invite`), target, meta jsonb, at |
| `notifications` | id, org_id, user_id null (null = everyone in the org), kind, title, body, href, created_at, read_at null (for user-specific rows; per-user read state for org-wide rows lives in `notification_reads(notification_id, user_id, read_at)`) |

| `feedback` | id, org_id, user_id null, message, page (console path), created_at; written by the console's Feedback button, never sent anywhere |
| `org_plugins` | (org_id, plugin_id) PK, enabled bool (true), config jsonb (`{}`; non-secret settings only), installed_by null, installed_at, updated_at; marketplace installs (see section 5) |
| `plugin_votes` | (org_id, plugin_id, user_id) PK, created_at; "I want this" votes for planned marketplace items |
| `org_alert_settings` | org_id PK, secret_prefix (first 14 chars of the alert webhook secret, unique, shown in the console), secret_hash (sha256 hex), secret_rotated_at, auto_rollback bool (false), threshold int (80), max_age_minutes int (30), window_minutes int (120), updated_at, updated_by |
| `incidents` | id, org_id, source (`alertmanager`\|`datadog`\|`sentry`\|`generic`), fingerprint, title, service, environment, severity (`critical`\|`error`\|`warning`\|`info`), status (`open`\|`resolved`), started_at, last_seen_at, resolved_at, event_count, raw jsonb (the alert as received, capped at 64 KB), candidates jsonb (ranked when the incident opened), auto_action jsonb null (the automatic rollback decision and its checks), rollback_job_id null, created_at, updated_at; unique (org_id, source, fingerprint) where status = 'open' |

Deleting an org cascades to everything it owns.

Usage numbers in the console are **computed** from these tables (deploying services in the cycle, deploys this month, verified rollouts, auto-rollbacks, seats = memberships), with plan limits from a constant per plan.

## 4. Auth

- **Passwords:** Node `crypto.scrypt` (N=16384, r=8, p=1, 64-byte key, 16-byte salt), compared with `timingSafeEqual`.
- **Sessions:** opaque 32-byte random id in the cookie `alror_sid` (HttpOnly, SameSite=Lax, Secure in production, Path=/). Redis key `sess:<id>` holds `{userId, orgId, createdAt}`, with a 7-day sliding TTL. Logout deletes the key. Switching org updates `orgId`.
- **Login rate limit:** Redis `rl:login:<ip>` and `rl:login:<email>`, 10 failed attempts per 15 minutes (a successful login clears the email counter).
- **First run:** when there are no users, `/signup` creates the first user, the org and default environments (production, staging), and becomes the owner. Afterwards `/signup` creates a new user plus a new org. Joining an existing org happens through an **invite** link `/invite/<token>`; the token is shown once and is valid for 7 days.
- **API keys:** the token format is `alr_live_` followed by 32 base62 characters. It is shown once at creation. The `prefix` is the first 12 characters. Lookup is `sha256(token)`. Requests send `Authorization: Bearer <token>`; `last_used_at` is updated at most once a minute.
- **Roles:** owner and admin can manage members, keys, services and policies. A member can view everything and trigger deploys and rollbacks.
- **Console sessions on the API** get the scopes `deploy:read` and `deploy:write`, plus `config:write` for owners and admins (never `jobs:run`). Cookie-authenticated writes with a cross-site `Origin` are rejected.
- `/app/*` is guarded by `src/proxy.ts` (cookie present) **and** by session validation in the layout, the data layer and every action and route.

## 5. REST API v1 (`/api/v1`, JSON)

Auth is either the session cookie (console) or a Bearer API key (CLI, CI, runner). The org is implied by the key or the session. Errors look like `{"error":{"code":"not_found","message":"…"}}` with status 400 (malformed JSON), 401, 403, 404, 409, 422 (validation; also `unknown_service`, `unknown_environment`), 429 (`rate_limited`, login only) or 503 (`unavailable`: the server can't reach Postgres or Redis; `details.reason` is `database_unavailable` or `cache_unavailable`, with `Retry-After: 10`). Clients should retry a 503 with backoff.

**Domain JSON is byte-compatible with the Go `internal/domain` structs:** snake_case keys in struct order, `bake` is integer nanoseconds, times are RFC 3339 (`RFC3339Nano` with trailing zeros trimmed, millisecond precision), `ref`, `reason`, event `weight` and `verdict` are omitted when empty.

| Method and path | Scope | Body / query | Response |
| --- | --- | --- | --- |
| `GET /health` | none | | `{status:"ok"\|"degraded", postgres:{ok,latency_ms,error?}, redis:{ok,latency_ms,error?}, version, checked_at}`; 200 when both stores answer, 503 when either doesn't. Each check (`select 1`, `PING`) times out after 1.5 s; `error` is a short reason such as `ECONNREFUSED`. `Cache-Control: no-store`. |
| `GET /whoami` | any | | `{org:{id,slug,name}, actor:{type,id,label,role?}, scopes}` |
| `GET /config` | deploy:read | | alror.yaml shape: `{project, services:[{name,paths,target,cluster,namespace,critical}], metrics:{provider,url,queries}, policy:{max_regression,alpha,auto_rollback,bake_scale,plans?}, notify:{slack_webhook}}` (`project` is the org slug; archived services are not listed) |
| `PUT /config` | admin key (scope `config:write`) or owner/admin session | same shape as GET; upserts services (by name; services not listed are left alone) and policy | 200 config |
| `GET /deployments` | deploy:read | `?limit=50` (1 to 1000) `&status=&service=&environment=&before=<deployment id or RFC3339>` | `Deployment[]`, newest first (created_at desc, id desc); `before` pages backwards and an unknown cursor id is 422 |
| `POST /deployments` | deploy:write | Deployment | 201 Deployment (upsert by id; the service must exist, or 422 `unknown_service`; an id owned by another org is 409) |
| `PUT /deployments/{id}` | deploy:write | Deployment | 200 Deployment; 404 if the id does not exist in the org (the client then POSTs) |
| `GET /deployments/{id}` | deploy:read | id or unique prefix | Deployment (404, or 409 `ambiguous`) |
| `GET /deployments/{id}/events` | deploy:read | | `Event[]` in order |
| `POST /deployments/{id}/events` | deploy:write | Event | 201 Event |
| `GET /rollbacks/recent` | deploy:read | `?since=RFC3339` (default 30 days ago) | `{"<service>": count}` of `rolled_back` deployments with server `updated_at` after `since` |
| `GET /decisions/{sha}` | deploy:read | a PR head SHA or merge commit SHA, full or a prefix of at least 7 hex characters | the newest stored PR decision for that commit (see Decisions below); 404 when none is stored, 422 for a malformed or ambiguous prefix |
| `POST /jobs` | deploy:write | `{kind:"deploy", payload:{service, image, ref, environment, shadow?, risk_override?}}` or `{kind:"rollback", payload:{deployment_id, reason}}` | 201 Job |
| `POST /jobs/claim` | jobs:run | `{worker:"<runner name>"}` (`runner` accepted as an alias); optional `wait` seconds (0 to 25); long-poll up to 25 s (Redis `BRPOP jobs:<orgId>`; Postgres row claimed with `FOR UPDATE SKIP LOCKED`) | 200 Job, or 204 |
| `POST /jobs/{id}/heartbeat` | jobs:run | `{worker:"<runner name>"}` | 200 Job; 409 when the job is no longer claimed by this runner |
| `POST /jobs/{id}/finish` | jobs:run | `{status:"done"\|"failed", error?, deployment_id?, worker?}` | 200 Job; repeating the same status is idempotent (200); 409 when not claimed by this runner |
| `GET /jobs` | deploy:read | `?status=` | `Job[]`, newest first |
| `GET /stream` | session only | | `text/event-stream` |
| `GET /plugins` | deploy:read | | `{plugins:[{id,name,category,version,stage,enabled,config,webhook_set?,installed_by,installed_at,updated_at}], metrics_provider, targets}` (see Marketplace below) |
| `POST /alerts/{source}` | alert webhook secret (not an API key) | `source` is `alertmanager`, `datadog`, `sentry` or `generic`; body is the tool's webhook JSON (see Alert intake below) | 202 `{source, received, results:[{fingerprint, status, action:"created"\|"deduplicated"\|"resolved"\|"ignored", incident_id}]}`; 401 bad secret, 404 unknown source, 400 bad JSON, 422 payload that does not fit the source, 429 rate limited |
| `GET /incidents` | deploy:read | `?status=open\|resolved&limit=50` (1 to 200) `&page=1` | `Incident[]`, newest first by started_at (no `raw`) |
| `GET /incidents/{id}` | deploy:read | | `Incident` plus `raw` |
| `POST /incidents/{id}/rollback` | deploy:write | `{deployment_id}` (must be one of the incident's candidates, else 422) | 201 Job (kind `rollback`) |
| `POST /incidents/{id}/resolve` | deploy:write | | 200 Incident; 409 when already resolved |

`Deployment` and `Event` match Go: `{id, service, image, ref, risk, plan, status, step_index, weight, reason, created_at, updated_at}` and `{at, kind, message, weight?, verdict?}`. Deployments also carry two **optional** platform fields after `updated_at`:

- `environment`: environment name. On write it defaults to `production` on insert and is left unchanged on update when absent; an unknown name is 422 `unknown_environment`.
- `source`: `cli` \| `ci` \| `console` \| `runner`. On write, if the body has no `source`, the server takes it from the `X-Alror-Source` request header the CLI sends (`cli`, `ci` or `runner`), else from the auth type (session → `console`, API key → `cli`).

**Timestamps:** the server sets `updated_at = now()` on every deployment write and ignores the client's value. `created_at` is taken from the client on the first insert (now() when missing) and never changes afterwards.

**Rollout plans (v1.2):** `policy.plans` is optional and only present when an org customised its plans (on `/app/policies` or with `PUT /config`). Shape: `{"low"|"medium"|"high": [{weight, bake}]}` with `weight` 1 to 100 strictly increasing, only the last stage at 100, and `bake` in integer nanoseconds (canary stages bake at least one minute, at most 24 hours). Levels that are absent use the built-in planner; `"plans": null` in `PUT /config` resets to it. Invalid plans are 422. Clients that do not know the field ignore it.

**Decisions (v1.4):** the GitHub App scores every open pull request with the **shared risk rules**: `internal/risk/rules.json`, embedded in the Go CLI and runner, with a byte-for-byte copy at `apps/web/src/lib/server/decision/rules.json` (`node scripts/sync-rules.mjs` copies it and the shared fixtures; CI fails on drift, and both `go test ./internal/risk` and `apps/web/tests/decision.test.ts` run the fixtures in `internal/risk/testdata/fixtures`). Inputs are the PR's changed files, commit authors and messages, the org's services (paths, critical) and `rolled_back` deployments per service in the rules' window. The risk (score, level, factors), the plan for that level and the merge gate outcome are stored per head SHA in `github_decisions` (`risk`, `plan`, `merge_sha` columns, migration 0006), and the check run and sticky comment show the score, level, plan and top factors next to the gate outcome. A high risk level requires review. If the risk decision cannot be computed, the PR is never merged automatically: the check stays `in_progress` with the reason, and evaluation is retried. Response of `GET /decisions/{sha}`:

```json
{"sha":"<the commit asked for>","head_sha":"…","merge_sha":"…"|null,"matched":"head"|"merge",
 "repository":"acme/shop","pull_number":42,"url":"https://github.com/acme/shop/pull/42",
 "outcome":"eligible"|"review_required"|"waiting"|"merged"|"closed","mode":"observe"|"review"|"auto_merge",
 "rules_version":1,"risk":{"score":38,"level":"medium","factors":[{"name","detail","points"}],"services":["…"],"ai_authored":false},
 "plan":{"strategy":"canary","steps":[{"weight":5,"bake":600000000000},…]},"reasons":["…"],"updated_at":"RFC 3339"}
```

`risk` and `plan` use the Go `domain.RiskReport` and `domain.Plan` shapes (`bake` in nanoseconds). `merge_sha` is recorded when the PR merges, so a deploy of the merge commit finds the PR's decision.

**Marketplace (v1.3):** the catalog is defined in code (`src/lib/server/marketplace/catalog.ts`); `org_plugins` records what an org installed. Owners and admins install, configure, disable and uninstall (enforced in the data layer, `src/lib/server/data/plugins.ts`); members browse and vote for planned items. Every change writes a `plugin.*` audit row (`plugin.install`, `plugin.configure`, `plugin.enable`, `plugin.disable`, `plugin.uninstall`, `plugin.vote`, `plugin.unvote`). Effects:

- Metrics providers (`prometheus`, `datadog`): installing sets `policy.metrics` to `{provider, url, queries}` (Datadog: `url` is the site), so `GET /config` and the CLI pick it up. One provider is enabled at a time; enabling one disables the others. Disabling or uninstalling an active provider sets `metrics` back to `{"provider":"synthetic"}`. Datadog keys are never stored: runners need `DD_API_KEY` and `DD_APP_KEY` in their environment.
- `slack`: installing sets `notify.slack_webhook` (stored only in `org_policies.slack_webhook`, never in `org_plugins.config`, never shown in full in the console). Disabling or uninstalling clears it.
- Deploy targets (`kubernetes`, `ecs`): the console's service form offers `simulated` plus the enabled targets (a service keeps its current target). `alror config push` and `PUT /config` are not restricted. `config` may hold `default_cluster` and `default_namespace` used to prefill new services. `ecs` is unsupported: there is no CLI driver, and `alror deploy`, `alror rollback` and `alror runner` refuse it before recording anything (see `alror capabilities`).
- Built-in (`synthetic`, `simulated`), guide (`github-actions`, `alror-cli`, `go-sdk`, `ts-sdk`) and planned items cannot be installed (409).

`GET /plugins` lists installed plugins (enabled or not) with their non-secret `config`; `webhook_set` tells whether the Slack webhook is set without returning it. `metrics_provider` is the policy's current provider and `targets` the deploy targets the console offers (always including `simulated`).

**Alert intake and incidents (v1.4):** `POST /alerts/{source}` turns an alert into an incident, ranks the org's recent deployments as likely causes ("what changed?"), notifies the org and posts to Slack. The portal owns intake and ranking; rollbacks always go through the job queue and are executed by `alror runner`.

- **Secret:** owners and admins create, rotate or revoke one alert webhook secret per org under **Settings → Integrations** (`alrwh_` + 40 base62 characters, shown once). Only its sha256 is stored; the row is found by its 14-character prefix and the hash is compared in constant time. Send it as `X-Alror-Token: alrwh_…`, `Authorization: Bearer alrwh_…`, or `?token=alrwh_…` (Alertmanager, Datadog and Sentry webhooks cannot always set headers). Audit: `alerts.secret_create`, `alerts.secret_rotate`, `alerts.secret_revoke`, `alerts.settings_update`.
- **Limits:** 120 requests per org per minute (Redis `rl:alerts:<orgId>`), 30 requests with a missing or invalid secret per client IP per minute (`rl:alerts:ip:<ip>`), 1 MB per body, 100 alerts per request. A 429 carries `Retry-After`.
- **Normalised alert:** `{source, status (firing|resolved), title, service, environment, severity, started_at, fingerprint, raw}`. Environments are lowercased and `prod`/`prd`/`live` → `production`, `stage`/`stg` → `staging`, `dev` → `development`. Severities map to `critical` (critical, page, fatal, P1), `error` (error, high, P2), `info` (info, low, P4, P5) and otherwise `warning`. Without a provider fingerprint, a sha256 of the identifying fields is used.

| Source | title | service | environment | severity | started_at | fingerprint | resolved when |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `alertmanager` (webhook v4, one incident per entry in `alerts`) | `annotations.summary`, `title`, else `labels.alertname` | label `service`, `service_name`, `app`, `application`, `app_kubernetes_io_name`, `job`, `deployment` or `container` | label `env`, `environment`, `stage`, else `namespace` | label `severity` | `startsAt` | `fingerprint`, else hash of the labels | alert `status` is `resolved` |
| `datadog` (Webhooks integration, custom payload shown in the console) | `title` without the `[Triggered]` prefix | `service`, else tag `service:` | `env`, else tag `env:` | `alert_type` (`error` → critical), else `priority` | `date` (epoch ms) | `aggregate`, else `alert_id:alert_scope` | `alert_transition` is `Recovered` or `alert_type` is `success` |
| `sentry` (internal integration issue / alert rule webhooks, legacy webhook plugin) | `data.issue.title`, `data.event.title`, `message` | event tag `service`, else the project slug | `event.environment` or tag `environment` | `level` (default error) | event `datetime`/`timestamp`, else the issue's `lastSeen`/`firstSeen` | issue id (group id) | `action` is `resolved` or the issue status is `resolved` |
| `generic` (one object or `{alerts:[…]}`) | `title` (required) | `service` or `labels.service` | `environment`/`env` | `severity` | `started_at` (RFC 3339 or epoch) | `fingerprint`, `id` or `dedup_key` | `status` is `resolved`, `ok`, `recovered` or `closed` |

- **Dedupe and resolve:** a firing alert whose (source, fingerprint) has an open incident bumps `event_count` and `last_seen_at`; otherwise it opens a new incident (also after the previous one resolved). A resolved alert closes the open incident (`incident.resolve` audit row), or is `ignored` when none is open. Members can also resolve by hand.
- **"What changed?" ranking** (`src/lib/incidents/rank.ts`, pure and unit-tested): candidates are the org's deployments created in the window before `started_at` (default 120 minutes; up to 2 minutes after, for clock skew) plus any still `rolling` or `pending`. Each scores 0 to 100 as the sum of its signals, and each signal's points and reason are stored with the candidate:

| Signal | Points |
| --- | --- |
| Service match | 40 exact (same name), 20 related (the change's `risk.services` names the alert's service, or one name extends the other: `checkout` / `checkout-worker`), 0 none |
| Recency | up to 25, falling linearly from the alert's start to the edge of the window |
| Risk | up to 15: `15 × risk.score / 100` |
| Outcome state | 10 rolling, or promoted within 15 minutes before the alert; 5 promoted earlier; 3 pending; −30 rolled back or failed before the alert started |
| Metric movement | 10 when a stored canary verdict failed; up to 6 for a passing verdict whose worst metric moved up (full at +25%); 0 without verdicts |
| Environment | −25 when both environments are known and differ, else 0 |

  The top 10 are stored on the incident (`candidates: {window_minutes, ranked_at, items:[{deployment_id, service, image, environment, status, created_at, minutes_before, service_match, score, signals:[{signal, points, max, detail}]}]}`).
- **Actions:** the console's incident page (`/app/incidents/{id}`) and `POST /incidents/{id}/rollback` queue a rollback job for a candidate (members and above; audit `incident.rollback` with the score and signals). New incidents create an org-wide notification (`incident.opened`, linking to the incident) and, when the Slack plugin is installed, post the top three candidates with their reasons and a link to the incident.
- **Automatic rollback** is off by default. An owner or admin turns it on under Settings → Integrations; then the top candidate is rolled back only if **every** rule passes: the alert is firing, its score is at least the threshold (default 80), it was deployed at most `max_age_minutes` (default 30) before the alert, its service matches the alert's exactly, it is not already rolled back or failed, and no other candidate scores within 15 points. The decision and each rule's result are stored on the incident (`auto_action`) whether or not it acts; an automatic rollback is queued as a normal rollback job (actor `system`) and writes an `incident.auto_rollback` audit row with the incident, job, score, signals, rule checks and runner-up.
- `Incident` = `{id, source, fingerprint, title, service, environment, severity, status, started_at, last_seen_at, resolved_at, event_count, candidates, auto_action, rollback_job_id, created_at, updated_at}`. `listOpenIncidents(ctx)` in `src/lib/server/data/incidents.ts` returns the open ones for console surfaces.

`Job` = `{id, kind, payload, status, claimed_by, deployment_id, error, created_at, claimed_at, finished_at, heartbeat_at, attempts}`.

**Deploy job payload:** `environment` defaults to `production` (validated, 422 `unknown_environment`); the runner copies it onto the deployment. `risk_override` is a level (`"low"`, `"medium"`, `"high"`) or a 0 to 100 score (number or numeric string), stored as sent.

**Job leases:** a claim sets `heartbeat_at = now()` and increments `attempts`. A runner sends `POST /jobs/{id}/heartbeat` while it works (every 30 s). A job still `claimed` whose `heartbeat_at` is older than **2 minutes** is claimable again (the new claim replaces `claimed_by` and increments `attempts`). The claimer is identified by the `worker` name when the request sends one, otherwise by the API key. A heartbeat or finish from a runner that lost its lease returns 409, and that runner must stop the job without finishing it.

**Side effects on writes:** every deployment upsert or event append publishes a JSON message to Redis channel `org:<orgId>:events`, with `type` one of `deployment.updated` (`{type, deployment, at}`), `deployment.event` (`{type, deployment_id, event, at}`) or `job.updated` (`{type, job, at}`; on enqueue, claim, finish and cancel). The stream relays these as SSE (`event: <type>`, `data: <the JSON message>`), with a `: ping` comment every 15 s. A terminal status (promoted / rolled_back / failed) creates a notification and an audit row.

**Health and outages:** `GET /health` is unauthenticated so load balancers, `docker compose` health checks and the console can use it. When the console can't reach Postgres or Redis it shows a "workspace unavailable" screen (instead of a generic error or a redirect to /login) that polls `/health` every 10 s and reloads once both stores answer. Session lookups that fail on a connection error are reported as an outage, not as "signed out".

**Auth helper endpoints** (JSON counterparts of the console forms, used by scripts and tests): `POST /auth/signup {email, password, name?, org?}` → 201 and sets the session cookie; `POST /auth/login {email, password}` → 200 and sets the cookie (429 when rate limited); `POST /auth/logout` → 204; `GET /auth/session` → `{user, org, role, orgs}` or 401.

## 6. CLI and runner (Go, repo `alror`)

- **Server selection:**
  - The server URL comes from `alror.yaml` `server:`, the `ALROR_SERVER` env var or `~/.config/alror/credentials.json` (on Windows `%APPDATA%\alror\credentials.json`).
  - The key comes from `ALROR_API_KEY` or the credentials file.
  - `alror login --server URL --key alr_live_…` verifies the key with `/whoami` and saves both (mode 0600). `alror logout` removes them.
- **Connected mode** (server and key present):
  - The store is `store.Remote`, which implements the existing `store.Store` over the API.
  - Config is fetched from `/config`, and `alror.yaml` becomes optional (local `services[].paths` may still be used for git path mapping if present; the server wins).
  - `alror deploy` first asks `GET /decisions/{sha}` for the commit being deployed (`--ref` when it is a SHA, else `HEAD`) and uses the stored risk and plan when there is one. Otherwise it scores locally from git with the same embedded rules (recent rollbacks come from `/rollbacks/recent`). The output says which was used (`risk: portal decision for …` / `risk: scored locally (…)`), and `--json` adds `risk_source: {source: "portal"|"local"|"override"|"assumed", commit, repository?, pull_number?, rules_version?, note?}`. `--risk` skips the lookup.
  - Every command works in connected mode, and every request sends `X-Alror-Source`.
- **`alror runner [--name host] [--once]`:** loops claim → execute (heartbeat every 30 s) → finish.
  - A deploy job builds the Deployment with risk (`risk_override`, or medium when no git context is available) and the job's `environment`, and runs the engine with the remote store.
  - A rollback job loads the deployment and calls `Engine.Rollback`.
  - It handles SIGINT by finishing the current job, stops a job whose heartbeat returns 409, logs with the CLI UI style, and backs off when the server is unreachable.
- **`alror runner --watch`** (experimental release detection) polls the Argo Rollout of each service with `detect: true` (runner-side, from the local `alror.yaml`; not part of `GET /config`) and starts one release per image change made outside Alror. It uses only existing endpoints:
  - `GET /deployments?service=&limit=` to skip a service with an active (`pending`/`rolling`) deployment or whose latest deployment already has the image.
  - `GET /decisions/{sha}` for the commit (when derivable): the stored risk and plan win, and the release names the pull request; without a decision the runner scores the commit from a local checkout, else assumes medium risk.
  - `POST /deployments` and the event endpoints to record the release, with `source: "runner"`, the commit SHA (when derivable) as `ref`, and a "Detected in cluster" risk factor. No job is created.
  - Control is marked on the Rollout, not in the API: the engine annotates `alror.dev/controlled-by` (deployment id) and `alror.dev/image` before every kubernetes image change, and the watcher claims a change with `kubectl annotate --resource-version` so concurrent runners start at most one release.
- **`alror config pull`** writes the server config to `alror.yaml`; **`alror config push`** uploads services and policy from `alror.yaml` (admin keys only, `PUT /config`).

## 7. Seed and demo

The seeded `.alror/` files stop being the console's data source. `npm run db:migrate` applies migrations; `npm run db:seed` (dev only, idempotent: it deletes and recreates the org) creates a demo org "acme" with an owner `admin@acme.test` and a member `dev@acme.test` (both `alror-demo`), 12 services, policy, environments and 30 days of history written **through the same data layer** as real writes, a few audit and notification rows, a pending invite, plus one API key (all four scopes) printed to the terminal and written to `apps/web/.alror-dev-key` (git-ignored). With an empty database, `/login` points to `/signup`, which sets up the first account and org.
