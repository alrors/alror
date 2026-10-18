# Contributing to alror

Thanks for helping make releases safer.

## Development

```bash
git clone https://github.com/alrors/alror
cd alror-cli
go build -o bin/ ./cmd/...
go test ./...
```

You need Go 1.22 or newer. Everything runs locally: the default target and metrics are simulated, so you don't need a cluster or an account.

## Pull requests

- Keep changes focused, and add or update tests for the behaviour you change.
- `gofmt`, `go vet ./...` and `go test ./...` must pass; CI checks them on Linux, macOS and Windows.
- Public API in `pkg/alror` is covered by semantic versioning. Breaking changes need a major version and a clear note in the PR.
- Risk factors and verification thresholds are product decisions. Open an issue to discuss them before sending code.

## Reporting bugs

Open an issue with the command you ran, `alror version`, your OS, and the output with `--no-anim`. Please remove any tokens or internal URLs first.

## Working on the web app (`apps/web`)

```bash
cd apps/web
npm install
docker compose up -d     # PostgreSQL + Redis for development
cp .env.example .env.local
npm run db:migrate && npm run db:seed
npm run dev              # http://localhost:3000, sign in as admin@acme.test / alror-demo
```

Before a PR: `npx next typegen && npx tsc --noEmit`, `npm run lint` and, with the dev server running, `npm run test:api`.

Production deployment runs from `.github/workflows/deploy.yml` after successful push CI on `main`. It deploys the tested commit only if it is still the current main commit and its `apps/web` source has changed. Pull-request and fork CI cannot deploy. Unchanged web source only gets a health check; there is no polling schedule. Manual deployments remain available in this repository and the private `alrors/alror-deploy` repository, and require successful main-branch CI for the selected commit. Both use restricted SSH keys and the same server lock. Production secrets and server configuration remain outside the source tree.
