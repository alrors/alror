# Self-hosting Alror

Runs the Alror workspace (website, console and `/api/v1`) with PostgreSQL 16, Redis 7 and Caddy on one machine. A 2 vCPU / 4 GB VM is enough.

```bash
git clone https://github.com/alrors/alror && cd alror/docker
cp .env.example .env        # set DOMAIN and the secrets
docker compose up -d        # builds the app, applies migrations, gets a certificate
```

Then open `https://<DOMAIN>/signup` to create the first account and organization. Connect the CLI with an API key from **Settings → API keys**:

```bash
alror login --server https://<DOMAIN> --key alr_live_…
alror runner                # runs the deploys and rollbacks queued from the console
```

Upgrade with `git pull && docker compose up -d --build`. Back up with `docker compose exec postgres pg_dump -U alror alror > alror.sql`.
