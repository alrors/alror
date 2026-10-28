# Alror Platform GitHub App

The integration connects explicitly enrolled repositories to one Alror workspace. Its first feature is a deterministic PR policy gate. It publishes evidence, requests configured individual reviewers, and optionally merges the exact evaluated commit. Observe mode is the default. No source code is executed and no AI-authorship inference is used.

## Server configuration

Set these server-only variables for the web service and worker:

```
ALROR_GITHUB_APP_ID=<App ID>
ALROR_GITHUB_APP_SLUG=alror-platform
ALROR_GITHUB_PRIVATE_KEY_PATH=/run/secrets/alror-github.pem
ALROR_GITHUB_WEBHOOK_SECRET=<independent random webhook secret>
ALROR_PUBLIC_URL=https://alror.com
```

Mount the private key read-only outside the repository. `ALROR_GITHUB_PRIVATE_KEY` is an alternative environment variable containing PEM text. A GitHub OAuth client secret is not the webhook secret and cannot replace the private key. Never commit credentials or expose them to the browser.

Webhook URL: `https://alror.com/api/github/webhook`. Subscribe to pull request, pull request review, check run, check suite, status, and push events. Installation lifecycle events disable removed bindings. Checks, pull requests, and contents require write access; metadata and commit statuses need read access. Never add the App to branch/ruleset bypass lists.

Apply migrations before starting services. Run the durable worker separately from Next, using the same image/source and database:

```sh
node --conditions=react-server --import tsx scripts/github-worker.ts
```

Run commands from `apps/web` (or the standalone web root). For local environment files, add `--env-file-if-exists=.env.local` after `node`. The inbox lives in Postgres; this worker does not need Redis. Multiple workers safely serialize deliveries with leases, bounded retries, and recovery of expired leases. Webhooks acknowledge only after durable insertion; delivery IDs deduplicate replays. Monitor failed rows in `github_deliveries`. Redeliver missed webhooks in GitHub after outages. Repeated delivery IDs do not reset exhausted jobs; use the console's re-evaluate action after repairing configuration.

## Repository enrollment

This MVP uses operator-assisted enrollment. No public claim-by-installation-ID endpoint exists. A setup URL's `installation_id` is untrusted; an Alror login does not prove GitHub installation authority. Self-service connection with GitHub user authorization is future work.

Verify that the requesting Alror workspace administrator has authority to connect the selected GitHub repository. Then run:

```sh
node --conditions=react-server --import tsx scripts/github-enroll.ts --org acme --installation 123456 --repository acme/service --operator operator@example.com --verified-authority
```

The command verifies App access, scopes the token to that repository, and audits enrollment. A repository bound to another workspace cannot be claimed. Only enrolled repositories are processed; other repositories from the installation are not exposed to the workspace. Re-enrollment restores access only after an operator verifies removed/suspended connections. New repositories start in observe mode. Enrollment queues evaluations and can post checks/comments once the worker runs.

## Onboarding: proposed alror.yaml

On `/app/github`, owners and admins can open **Set up alror.yaml** on an enrolled repository. **Detect services** reads the default branch through the App (recursive git tree plus a bounded set of files: workspace manifests, compose files, Kubernetes and Helm manifests, CODEOWNERS) and proposes services from Dockerfiles, docker-compose `build:` services, Deployments, StatefulSets and Argo Rollouts, Helm charts, npm/pnpm/go.work workspaces and `services/*`, `apps/*`, `web/` conventions. Critical services come from names and paths (auth, payments, billing, checkout, ledger...). Every value shows its reason and confidence; values Alror cannot infer (cluster, a namespace the manifests do not set, source folders for manifest-only workloads) are marked `unknown — set this` rather than guessed. `target: kubernetes` (which drives Argo Rollouts) is proposed only when an Argo Rollout manifest exists; otherwise `simulated`. Proposals start in shadow mode (`auto_rollback: false`) with synthetic metrics.

**Open setup PR** re-detects on the server, applies the edits, and commits `alror.yaml` and `ALROR.md` (an explanation of every value) to the `alror/setup` branch through the git data API, then opens a pull request against the default branch. The App never writes the default branch. Re-running reuses the open onboarding pull request: identical content makes no commit, changed content adds a commit on top of the branch. A stale `alror/setup` branch without an open pull request restarts from the default branch. Detection and pull request creation are audited (`github.onboarding_detected`, `github.onboarding_pr_opened`, `github.onboarding_pr_updated`, `github.onboarding_blocked`).

Onboarding needs **Repository contents: Read and write**, **Pull requests: Read and write** and **Metadata: Read-only**. When the installation lacks them, the console lists the missing permissions instead of failing; grant them in the App settings and approve the update on the installation.

## Policies and limits

Use `/app/github` to inspect decisions and configure policies:

- Observe: neutral checks and explanations; no reviewer requests or merges.
- Review: enforcing gate checks and configured reviewers for flagged changes.
- Auto-merge: eligible commits merge only after trusted CI checks pass and GitHub reports the PR clean and mergeable.

Required checks pin both name and issuing GitHub App ID. Missing, pending, failed, skipped, or ambiguously duplicated checks never authorize merging. Auto-merge requires at least one configured check. Automatic eligibility defaults to documentation-only; protected paths always require review. Policy risk points are distinct from the Go rollout scorer. Changed test filenames indicate test changes, not coverage; GitHub CI supplies execution evidence. Protected-path rules do not perform secret-content scanning.

The App never approves PRs, removes protections, or retries merges with a newer SHA. Required reviews, conflicts, checks, and merge queues can prevent merging. Keep protected branches configured to require up-to-date commits. Merge queue support, team/CODEOWNERS routing, semantic review, OAuth self-service connections, and deployment controls are outside this MVP; individual reviewer routing is explicitly configured.

Decisions record head SHA, base SHA, and policy revision. Events trigger fresh evaluation; up to five delayed polls handle asynchronous GitHub mergeability. API result limits fail closed. Network operations retry; checks reconcile by external ID and comments by marker plus App identity. Policy changes requeue open PRs.

## Verification

```sh
node --conditions=react-server --import tsx --test tests/github.test.ts
```

Tests use fake GitHub transports and generated test keys, never deployment credentials. Coverage includes HMAC, JWT, policy boundaries, review routing, sticky comments, changed-head rejection, final CI rechecks, and SHA-pinned merging. Queue recovery additionally needs migrated Postgres integration validation.
