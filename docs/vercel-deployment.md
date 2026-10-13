# Vercel deployment (production)

This guide covers the production Vercel setup for the multi-branch workspaces feature: root domain plus wildcard, DNS, the environment variables that turn subdomain mode on, preview behaviour, the build chain, and how releases flow. For the general Vercel walkthrough (first deploy, Neon pooling, backups of the process) see [Deployment](deployment.md).

## Domains on Vercel

Production uses the root domain with a wildcard so every branch resolves:

1. In the Vercel project, add **two** domains:
   - `mbumah.co.ke` (root domain: organization console + default SPA)
   - `*.mbumah.co.ke` (wildcard: every branch subdomain, e.g. `juja-main.mbumah.co.ke`)
2. At the DNS provider, point the domain at Vercel:
   - Apex `A` record `mbumah.co.ke` -> `76.76.21.21` (or the `A`/`ALIAS`/`CNAME` values Vercel shows in the dashboard; Vercel verifies and issues certificates automatically, including for the wildcard).
   - `CNAME` record `*.mbumah.co.ke` -> `cname.vercel-dns.com`.
3. Wait for both domains to show as valid in the Vercel dashboard. Vercel provisions a wildcard TLS certificate automatically once DNS verifies.

No per-branch configuration is needed: `juja-main.mbumah.co.ke` and any future `kisumu.mbumah.co.ke` work as soon as the store row exists (see [How to add a new store](subdomain-workspaces.md#how-to-add-a-new-store)).

## Environment variables

| Variable | Production value | Why |
|----------|------------------|-----|
| `NEXT_PUBLIC_ROOT_DOMAIN` | `mbumah.co.ke` | The proxy extracts `{sub}` from hosts ending in this domain; the client builds absolute branch links from it. |
| `NEXT_PUBLIC_USE_SUBDOMAINS` | `true` | Master switch for subdomain mode (this is the default, but set it explicitly for clarity). |
| `NEXTAUTH_URL` | `https://mbumah.co.ke` | Canonical auth URL on the root domain. |
| `NEXTAUTH_COOKIE_DOMAIN` | `.mbumah.co.ke` | Shares the `mbt_token` session cookie across the root domain and all branch subdomains (leading dot required). |
| `NEXTAUTH_COOKIE_SECURE` | `true` | HTTPS-only session cookie in production. |
| `MPESA_CALLBACK_URL` | `https://mbumah.co.ke/api/payments/mpesa/callback` | One root callback for all branches: the callback resolves the store from the transaction (by `CheckoutRequestID`), so no per-branch callback URL is needed. Register this URL in the Daraja portal. |
| `NEXT_PUBLIC_STORE_WORKSPACE_MODE` | leave unset (`auto`) | `auto` gives subdomain behaviour on branch hosts and path behaviour everywhere else. |

Required base variables are unchanged: `DATABASE_URL` (pooled Neon URL), `DIRECT_DATABASE_URL` (unpooled), `NEXTAUTH_SECRET`, `JWT_SECRET`. Scope every variable to Production, Preview and Development as needed, then redeploy (env-only changes do not trigger a deploy).

## Preview deployments default to path mode

Preview and development environments should NOT set `NEXT_PUBLIC_ROOT_DOMAIN` (and should not add the wildcard domain to preview). With no root domain configured:

- Branch links fall back to path mode: `https://<project>-<hash>.vercel.app/stores/juja-main/dashboard`.
- The built-in host allowlist already accepts `*.vercel.app`, so previews work without extra configuration.
- Session cookies stay host-only, which is correct for a single preview origin.

This is the safest default: previews can never collide with production subdomains.

## Build chain (vercel-build)

`vercel.json` pins the build to `npm run vercel-build`, which runs:

```text
SKIP_ENV_VALIDATION=1 node scripts/setup-prisma-provider.mjs
prisma generate
node scripts/sync-db-schema.mjs
node scripts/backfill-store-slugs.mjs
next build
```

The workspace-relevant step is `scripts/backfill-store-slugs.mjs`: an idempotent backfill that gives every store a `slug` (deterministic map for the five seeded branches, name-derived otherwise), defaults `subdomain` to the slug, and fills `code` / `brandingColor` when missing. It never touches rows that already carry values and soft-skips (exit 0) when the database is unreachable during a build, so a deploy can never fail on the backfill. The same script is available manually as `npm run db:backfill-slugs`.

`scripts/setup-prisma-provider.mjs` keeps the Prisma provider aligned with `DATABASE_URL` (postgresql on Vercel), so no manual schema edits are needed.

## Release flow

- **CI gates** (`.github/workflows/ci-cd.yml`) run on every push and pull request: Install, Lint, Type Check (advisory), Security & Schema, Test, Build, and the aggregate CI-Pass gate. Pull requests are only merged with CI green.
- **Release workflow** (`.github/workflows/release.yml`) runs on main: it reads the version from `package.json` (single source of truth), cuts the annotated `v<version>` tag and publishes the GitHub Release with auto-generated notes.
- Vercel deploys main to production automatically once the PR merges. After each release, verify `https://mbumah.co.ke/api/health` reports the new version, then spot-check a branch workspace (for example `https://juja-main.mbumah.co.ke/dashboard`).
- The changelog entry and the in-app "What's new" entry are separate release chores documented in [Release process](release-process.md).

## Post-release verification checklist

1. `curl https://mbumah.co.ke/api/health` -> 200 with the expected `version`.
2. Open the org console at `https://mbumah.co.ke/org/dashboard` as an owner or admin.
3. Open a branch workspace in a new tab from the console - the URL should be `https://juja-main.mbumah.co.ke/dashboard` and the title `{Store Name} | Mbumah Hardware POS`.
4. Sign in once, then open a second branch in another tab - the shared cookie should carry the session (no second login).
5. Trigger a sandbox STK push and confirm the callback lands on the root URL and settles the transaction.

## Related documents

- [Deployment](deployment.md) - general Vercel walkthrough, Neon pooling, env scoping
- [Subdomain workspaces](subdomain-workspaces.md) - routing and security model behind the domains above
- [Release process](release-process.md) - versioning and release automation
