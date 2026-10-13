# Self-hosting

Run the full POS stack on your own server. The reference setup is `docker-compose.prod.yml`; machines that must run without Docker use the `deploy/nodocker` or `deploy/laptop` installers. For the deep-dive (SSL variants, backups, troubleshooting) see the self-hosting guide inside [Deployment](deployment.md).

## Docker Compose production stack

`docker-compose.prod.yml` runs four services on one internal bridge network (`mbumah-internal`); only nginx exposes ports to the host:

| Service | Image / build | Internal port | Notes |
|---------|---------------|---------------|-------|
| `postgres` | `postgres:15-alpine` | 5432 | Persistent volume, `pg_trgm`, health-checked; never exposed to the host |
| `app` | repo `Dockerfile` (standalone Next.js) | 3000 | Network alias `nextjs_app` (nginx proxy target); healthcheck `GET /api/health`; `MPESA_*` and `DATABASE_URL` come from `.env` |
| `notification` | `mini-services/notification-service` (bun) | 3003 | Socket.io realtime service, internal-only; healthcheck `/health`; powers live receipts and POS notifications via nginx websocket upgrades |
| `nginx` | `nginx:1.27-alpine` | 80 / 443 | SSL termination, security headers, static caching, `/socket.io/` upgrade to the notification service |

Quick start:

```bash
cp .env.example .env         # set POSTGRES_PASSWORD, NEXTAUTH_SECRET, JWT_SECRET, NEXTAUTH_URL
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml exec app npx prisma db seed   # first run only
```

## Subdomain wiring with nginx

The shipped config (`nginx/conf.d/mbumah-pos.conf`) uses `server_name _` - a catch-all that forwards **any** Host header to the app. That is exactly what subdomain workspaces need: nginx does not enumerate branches, it passes the original host through (`proxy_set_header Host $host;`), and the Next.js proxy (`src/proxy.ts`) validates the host against the allowlist and resolves the branch workspace.

To activate subdomains on a self-hosted install:

1. **DNS or hosts entries**: make every branch hostname resolve to the server. Options:
   - Public DNS: `A` record for the root plus a `*.mbumah.example.com` wildcard.
   - LAN DNS (dnsmasq/Pi-hole/router): one `address=/mbumah.test/192.168.1.20` line covers root and all subdomains.
   - Per-device hosts files for small installs: `npm run domains:print` generates the block.
2. **Environment**: set the workspace variables from the `SUBDOMAIN WORKSPACES` section of `.env.example` (`NEXT_PUBLIC_ROOT_DOMAIN`, `NEXTAUTH_COOKIE_DOMAIN=.mbumah.test`, `ALLOWED_HOSTS` including your domains), and add those hosts to `ALLOWED_HOSTS` explicitly (the defaults only cover localhost and `*.vercel.app`).
3. **TLS**: the wildcard hostnames need a wildcard certificate (`*.mbumah.test`) or per-host certificates. Certbot webroot is wired into the compose file; self-signed certs live in `nginx/ssl/`.
4. **Verify** against the running stack:

   ```bash
   npm run domains:verify -- --base https://192.168.1.20 --root mbumah.test
   ```

## Caddy alternative

If you prefer Caddy over nginx, drop the nginx service from the compose file, publish the app port, and put Caddy in front. Caddy's `tls internal` issues a local CA certificate for the whole wildcard and renews internally:

```text
mbumah.test, *.mbumah.test {
    reverse_proxy 127.0.0.1:3000
    tls internal
}
```

Run `caddy trust` (or accept the first-run prompt) so devices trust the local CA, then point DNS/hosts at the server as above. Caddy passes the original Host header through by default, so the workspace pipeline sees real branch hostnames.

## Nodocker and laptop installs (no Docker)

For a single shop machine that must not depend on the internet or on Docker:

- `deploy/nodocker/` - install, start, update, rollback and backup scripts that run Node directly against a local SQLite file database (`install-nodocker.ps1|.sh`, `start-pos.ps1|.sh`, `update-pos.ps1|.sh`, `rollback-*`, `backup-*`). The start script converges the database schema on every boot (self-healing, see the v2.15.2 changelog notes).
- `deploy/laptop/` - the same shape for Windows/Linux laptops with shortcut creation and an offline-first profile.

The subdomain variables work identically there: set the `SUBDOMAIN WORKSPACES` block in `.env`, apply the hosts entries from `npm run domains:print`, and run `npm run domains:verify` after starting the server. Offline mode (SQLite, mock M-Pesa, local HTTPS) is covered step by step in [Local offline setup](local-offline-setup.md).

## Health endpoints: /api/health vs /api/healthy

There are two health surfaces with different audiences:

| Endpoint | Auth | Use |
|----------|------|-----|
| `GET /api/health` | public | Liveness + readiness for automation: Docker healthchecks (the `app` service healthchecks it), uptime monitors, CI smoke tests. Returns status, version, database connectivity and security checks without any session. |
| `GET /api/healthy` | auth-gated | The richer in-app health card variant documented in [Deployment](deployment.md). Like every non-public `/api` route it requires a signed-in session (401 for anonymous callers) - automation must always target `/api/health`. |

Public health paths (`/api/health` and `/api/health/*`) are passed through by the proxy before the auth layer; everything else under `/api` needs the Bearer token or the session cookie.

## Related documents

- [Deployment](deployment.md) - the full self-hosting procedure: SSL options, backups, troubleshooting, architecture diagram
- [Subdomain workspaces](subdomain-workspaces.md) - what the host header does once it reaches the app
- [LAN deployment](lan-deployment.md) - one shop server for many devices on the local network
- [Local offline setup](local-offline-setup.md) - offline env vars, local DNS methods, mock M-Pesa
