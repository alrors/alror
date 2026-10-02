# GitHub

Alror posts a risk check and a sticky comment on pull requests. Deployments from Actions write a detailed release receipt to the job summary and, when a pull request is available, update a separate deployment comment.

## Risk check on pull requests

```yaml
jobs:
  risk:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      checks: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: alrors/alror/actions/check@main
        with:
          comment: "true"
          fail-above: "0"
```

The PR shows an **Alror / change-risk** check with a clear advisory, passed-gate or failed-gate outcome. The report includes the commit, comparison branch, changed-file count, affected services, contributing factors, traffic stages, observation times and a link to the workflow logs. It ends with a suggested next step. One risk comment is updated on each push.

| Input | Default | Meaning |
| --- | --- | --- |
| `comment` | `true` | Keep a sticky PR comment |
| `fail-above` | `0` | Fail the check above this score; `0` keeps it advisory |
| `working-directory` | `.` | Folder with `alror.yaml` |
| `version` | `latest` | Alror version to install |

| Conclusion | When |
| --- | --- |
| `success` | Low risk |
| `neutral` | Medium or high risk (advisory) |
| `failure` | Score above `fail-above` |

Outputs: `score`, `level`, `plan` (e.g. `5,25,50,100`) and `conclusion`.

## Deploy from Actions

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      # Build and push the image before this step.
      - uses: alrors/alror/actions/deploy@main
        id: alror
        with:
          service: checkout-api
          image: registry.example.com/checkout-api:${{ github.sha }}
          comment: "true"
```

The receipt leads with **promoted**, **rolled back** or **failed**, then shows release identity, environment (when recorded), elapsed time, risk, deployment driver, metrics provider and rollout plan. Expand the verification section to inspect each recorded stage's canary and baseline values, relative changes, p-values and failure reasons. Shadow mode is labeled explicitly; promotion after a failed verdict is reported as **promoted with failed verification**. The workflow link and next step help you investigate without searching through logs.

The action keeps one deployment comment per service and recorded environment, separate from the risk comment. PR runs use the event's PR number. For a push or manual workflow, supply `pull-request` explicitly to update that PR; otherwise only the job summary is written. Set `comment: "false"` to disable comments. Direct CLI deployments opt in with `ALROR_GITHUB_COMMENT=true` and may set `ALROR_GITHUB_PR` to a positive PR number.

| Reporting input | Default | Meaning |
| --- | --- | --- |
| `comment` | `true` | Update a deployment receipt on an available PR |
| `pull-request` | Event PR | Explicit PR number for push or manual runs |
| `token` | `github.token` | Token with permission to comment |

| Output | Meaning |
| --- | --- |
| `deployment-id` | Release identifier |
| `status` | `promoted`, `rolled_back` or `failed` |
| `weight` | Last rollout stage reached, **not** current traffic after rollback |
| `risk` | Risk score, 0–100 |
| `reason` | Rollback or failure reason, when available |
| `duration` | Elapsed rollout time, such as `2m15s` |

A rollback still exits with code `2`, which fails the job. Reporting errors produce warnings and preserve the deployment outcome. Receipts are emitted after the rollout engine returns; installation/configuration errors before a deployment starts, or a forcibly terminated runner, may only have workflow logs.

When testing unreleased action changes, set `version` to the matching CLI commit or branch. The default `latest` installs the latest released CLI, which may not include new report features yet.

## Run it yourself

The actions are thin wrappers around the CLI:

```bash
alror github check --comment          # inside Actions: posts the check and comment
alror github check --dry-run          # anywhere: prints the Markdown it would post
alror github check --fail-above 85    # exits 3 when the score is above 85
```

Alror reads `GITHUB_TOKEN` (or `ALROR_GITHUB_TOKEN`), `GITHUB_REPOSITORY`, the PR number and head commit from the event payload, and `GITHUB_API_URL`, so GitHub Enterprise Server works too.

## Permissions

| Permission | Why |
| --- | --- |
| `checks: write` | Create the check run |
| `pull-requests: write` | Create or update the sticky comment |
| `contents: read` | Read the diff |

If a permission is missing, Alror prints a warning and carries on. It never fails your build because it couldn't post.
