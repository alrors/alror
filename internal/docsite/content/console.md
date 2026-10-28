# Web console

The console is the web half of Alror and your **Alror workspace**: a login-protected dashboard that the CLI connects to in [connected mode](/connected). Deploys and rollbacks started from the console are executed by [`alror runner`](/connected#runner).

## Run it

The workspace runs on Next.js with PostgreSQL 16 and Redis 7 in Docker. Copy `.env.example` to `.env.local` first (`DATABASE_URL`, `REDIS_URL`, `ALROR_SESSION_SECRET`, `ALROR_PUBLIC_URL`).

```bash
cd apps/web
docker compose up -d     # PostgreSQL and Redis
npm run db:migrate       # apply the SQL migrations
npm run db:seed          # dev only: demo org "acme", 12 services, 30 days of history and an API key
npm run dev
```

Then open `http://localhost:3000`. Sign in with the seeded owner, or sign up to create your own user and org (on an empty database, the first sign-up starts the onboarding flow):

| Field | Value |
| --- | --- |
| Email | `admin@acme.test` |
| Password | `alror-demo` |

## Connect the CLI

Create an API key under **Settings → API keys** (it is shown once), then:

```bash
alror login --server http://localhost:3000 --key alr_live_…
alror runner        # executes Deploy and Roll back actions from the console
```

See [Connected mode](/connected) for scopes, CI setup and the runner.

## Pages

| Page | Shows |
| --- | --- |
| Deployments | Every release with risk, status and traffic |
| Deployment detail | Rollout stages, verdicts per metric, the full event log |
| Services | Per-service deploy counts, last release and rollback rate |
| Insights | Deploy frequency, change failure rate, AI-assisted vs human |
| Incidents | Alerts from Alertmanager, Datadog, Sentry or any JSON webhook, each with the deployments most likely to have caused it and a one-click Roll back |

## Incidents: what changed?

Point your alerting at the workspace and every alert becomes an incident with a ranked list of the deployments that changed shortly before it.

1. Under **Settings → Integrations**, create the alert secret (an owner or admin; it is shown once).
2. Add a webhook in your tool. The secret can go in the `X-Alror-Token` header or in the URL:

```yaml
# alertmanager.yml
receivers:
  - name: alror
    webhook_configs:
      - url: http://localhost:3000/api/v1/alerts/alertmanager?token=alrwh_…
        send_resolved: true
```

Datadog (`/api/v1/alerts/datadog`), Sentry (`/api/v1/alerts/sentry`) and a generic JSON shape (`/api/v1/alerts/generic`, `{"title", "service", "environment", "severity"}`) work the same way.

Each candidate scores 0 to 100 from the service match, how close to the alert it was deployed, its risk score, whether it is still rolling or was just promoted, and the metric movement its canary verdicts recorded. The incident page lists every signal's contribution, so you can see why a deployment ranks where it does, and **Roll back** queues a rollback that `alror runner` executes. New incidents also show in the notification inbox and, with the Slack plugin installed, in your channel.

Automatic rollback is off by default. When an admin turns it on, Alror rolls back only when the top candidate scores at least 80, was deployed within the last 30 minutes, is the same service as the alert, and no other change is within 15 points. Every automatic rollback is written to the audit log with its evidence.
