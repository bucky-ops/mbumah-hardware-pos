# Subdomain workspaces

Since v2.16.0 every branch of Mbumah Hardware can be reached as its own workspace website while the whole organization still runs on one shared database and one application. A branch workspace can be addressed in two ways:

- **Subdomain mode**: `https://juja-main.mbumah.co.ke/dashboard` (each branch looks like its own site)
- **Path mode**: `https://mbumah.co.ke/stores/juja-main/dashboard` (works everywhere, no wildcard DNS needed)

Both addresses serve the same SPA shell, the same tab system and the same data, pinned to the branch. This document is the master reference; deployment-specific guides are linked at the end.

## One shared database, one app

There are no separate deployments per branch. Every `Store` row in the database is a workspace; the store is resolved from the request (Host header or URL path), never from client-supplied input. Stock, customers, transactions and users stay tenant-scoped exactly as before (see [RBAC](rbac.md) and [Multi-tenant architecture](multi-tenant-architecture.md)).

## Workspace modes

`NEXT_PUBLIC_STORE_WORKSPACE_MODE` controls how requests map to workspaces (`src/lib/workspace/config.ts`):

| Mode | Behaviour |
|------|-----------|
| `auto` (default) | Subdomains when the host is a valid branch subdomain; path mode on localhost, raw IPs and tunnels without wildcards |
| `subdomain` | Force subdomain behaviour |
| `path` | Force path mode (for example until wildcard DNS is configured) |
| `off` | Disable workspace routing (root console + root SPA only) |

The resolution result is one of three host modes: `subdomain`, `path` or `organization`. Path mode and subdomain mode are both workspace addressing styles; `organization` means "root domain request" (the [organization console](multi-store-workspaces.md)).

### Subdomain mode vs path mode

| Aspect | Subdomain mode | Path mode |
|--------|----------------|-----------|
| Address | `{subdomain}.{NEXT_PUBLIC_ROOT_DOMAIN}/...` | `/stores/{slug}/...` |
| Requires | Wildcard DNS (`*.mbumah.co.ke`) or local hosts/dnsmasq entries | Nothing |
| Session | Shared `mbt_token` cookie across the root domain and branch subdomains | Same origin as the root app |
| Browser storage | Isolated per origin (per branch) | Shared origin, carts are stored per `storeId` |
| Typical use | Production (`mbumah.co.ke`), offline LAN with local DNS | Vercel previews, localhost, LAN IPs, tunnels without wildcards |

The client picks the link style automatically (`src/lib/workspace/links.ts`): when the current origin itself resolves to subdomain mode, branch links are absolute subdomain URLs; otherwise they are relative `/stores/{slug}/...` paths. Server rendering falls back to path links.

## Domain configuration

| Variable | Default | Meaning |
|----------|---------|---------|
| `NEXT_PUBLIC_ROOT_DOMAIN` | (empty) | Root domain for branch workspaces, e.g. `mbumah.test` (offline) or `mbumah.co.ke` (production). Empty keeps path mode only. |
| `NEXT_PUBLIC_USE_SUBDOMAINS` | `true` | Master switch. `false` forces path mode. |
| `NEXT_PUBLIC_STORE_WORKSPACE_MODE` | `auto` | `auto` / `subdomain` / `path` / `off` as above. |
| `ALLOWED_HOSTS` | built-in defaults | Comma-separated host patterns; `*.` suffix wildcards allowed. |
| `NEXTAUTH_COOKIE_DOMAIN` | host-only cookie | Shared cookie domain, e.g. `.mbumah.test`; must start with a dot to be shared across subdomains. |
| `NEXTAUTH_COOKIE_SECURE` | `true` on Vercel production | Set `false` for local offline HTTP. |
| `NEXTAUTH_COOKIE_SAME_SITE` | `lax` | Cross-subdomain top-level navigation keeps the session. |

When `ALLOWED_HOSTS` is unset the built-in allowlist is `localhost`, `*.localhost`, `127.0.0.1`, `::1`, `*.vercel.app`, plus the configured root domain and its wildcard. Anything else is rejected with `403` (host header attacks).

### Reserved subdomains

These labels are never treated as branch workspaces (`RESERVED_SUBDOMAINS` in `src/lib/workspace/config.ts`):

`www`, `api`, `auth`, `admin`, `app`, `mail`, `status`, `assets`, `static`, `_next`, `favicon`, `robots`, `sitemap`, `login`, `logout`, `chat`, `org`, `stores`, `branches`

A store subdomain must match the RFC 1123 label pattern `/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/` (lowercase letters, digits, inner hyphens, max 63 chars).

## The middleware pipeline (src/proxy.ts)

The Edge proxy (`src/proxy.ts`, Next.js 16 proxy convention) runs two pipelines.

### Page routes (non-`/api`)

1. **Host validation**: the request host is checked against the allowlist. An unknown host gets `403 Invalid host.`
2. **Subdomain rewrite**: on a branch subdomain host in subdomain mode, `{sub}.{root}/anything` is internally rewritten to `/stores/{sub}/anything` without changing the visible URL. The public receipt route `/r/...` is excluded from the rewrite.
3. **Workspace identity headers**: the rewrite sets `x-store-subdomain` and `x-store-slug` on the request; non-workspace page responses carry them as response headers.

Static Next.js assets (`_next/static`, `_next/image`, `favicon.ico`, `manifest.json`, `sw.js`, `offline.html`, `robots.txt`, `sitemap.xml`, icons, sounds, screenshots) bypass the workspace pipeline entirely.

### API routes (`/api`)

The existing security pipeline is unchanged: OPTIONS preflight handling, rate limiting, request size (1 MB), CSRF, content-type, Bearer presence. Workspace additions:

- **OPTIONS preflight** is answered by the proxy itself so cross-subdomain clients never hit the auth or rate-limit layers with a preflight. CORS headers (including `Access-Control-Allow-Credentials: true` and the `X-Store-Id`, `X-Store-Slug`, `X-Store-Subdomain` request headers) are only emitted for origins that pass the host allowlist, and the origin is echoed exactly - never a wildcard with credentials.
- The Bearer token may arrive as the `mbt_token` cookie fallback on a branch subdomain that has not adopted localStorage yet (see [Session sharing](#session-sharing)).

## Session sharing

The SPA authenticates API calls with a Bearer token in localStorage, which is origin-scoped: a session on the root domain is invisible to branch subdomains. To bridge that, the login route also sets a `mbt_token` cookie (`src/lib/workspace/session-cookie.ts`) with:

- `Domain` = `NEXTAUTH_COOKIE_DOMAIN` (forced to start with a dot)
- `Secure` per `NEXTAUTH_COOKIE_SECURE`
- `SameSite` per `NEXTAUTH_COOKIE_SAME_SITE` (default `Lax`)
- Not `HttpOnly` - the workspace gateway must read it to bootstrap localStorage (same posture as the existing `csrf_token` cookie; the Bearer token itself already lives in JS-readable localStorage)

The workspace gateway (`src/components/workspace/workspace-gateway.tsx`) adopts the cookie into localStorage when the origin has none and validates it through the API. The Authorization header always wins; the cookie is only a bootstrap fallback (`getSessionFromRequest` in `src/lib/auth.ts`). If the browser rejects cookie sharing, path mode still works everywhere.

## Authorization rules

Workspace authorization is enforced server-side on every request by `resolveStoreContext` (`src/lib/workspace/server.ts`). The store is resolved from the database by subdomain or slug - never from a client-supplied `storeId`. The proxy headers are advisory hints only.

| Role | Branch workspace access |
|------|------------------------|
| `SUPER_ADMIN` | Organization-wide: any store, including inactive stores (diagnostic view) |
| `STORE_OWNER` | Organization-wide: any active store |
| `ACCOUNTANT` | Any active store, read-only financial mode (`readOnly: true` in the store context) |
| `BRANCH_MANAGER` | Own store (`User.storeId`); other stores only with an active membership |
| `CASHIER` | Own store (`User.storeId`); other stores only with an active membership |
| `INVENTORY_MANAGER` | Own store (`User.storeId`); other stores only with an active membership |
| `WAREHOUSE_MANAGER` | Only stores with an active `StoreMembership`; enters through [the branch selector](multi-store-workspaces.md) |

Additional rules:

- Unauthenticated visitors get the login screen on the same origin; after login they land back in the workspace they opened.
- Non-`SUPER_ADMIN` sessions opening an inactive store are denied (`STORE_INACTIVE`).
- A forged mismatch of subdomain and slug resolves by the trusted host first (subdomain wins over an explicit slug).
- Every denial (unknown store, inactive store, role or membership failure) is audit-logged as a `SecurityEvent` (`UNAUTHORIZED_ACCESS`, severity `WARN`, with reason, subdomain/slug, role and email). Audit logging never blocks the access decision.

Beyond the workspace check, the standard API layers still apply on every request: `requireAuth` / `requireStoreAccess` session validation, `assertStoreScope` query-param validation, the permission matrix and ORM-level tenancy (see [RBAC](rbac.md)).

## API endpoints

Workspace-specific endpoints (all authenticated with the Bearer token or the shared cookie):

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/me/store-context` | GET | Bootstrap for every workspace origin. Resolves the workspace from the Host header or `?slug=`; returns mode, allowed flag, `readOnly`, store summary, memberships and the user. Unauthorized workspaces come back as `{ allowed: false }` (HTTP 200) so the UI can render a calm no-access state. |
| `/api/stores` | GET | Store list (any store role) including `slug`, `subdomain` and `brandingColor` |
| `/api/stores/{storeSlug}` | GET | Workspace bootstrap for path mode: store by slug or subdomain. Unknown slug 404; access denied 403 without leaking store data. |
| `/api/org/summary` | GET | Organization console KPIs (`SUPER_ADMIN`, `STORE_OWNER`, `ACCOUNTANT` only) |
| `/api/chat/channels` | GET, POST | Global channel + workspace store threads; create store-scoped threads |
| `/api/chat/channels/{channelId}/messages` | GET, POST | Message history and sending (see [Global chat](global-chat.md)) |
| `/api/chat/channels/{channelId}/read` | POST | Mark channel read |
| `/api/chat/unread-count` | GET | Unread badge for chat entry points |

Workspace pages: `/org/dashboard`, `/branches/select`, `/chat`, and the branch workspace route `/stores/{slug}/[[...rest]]` that serves every in-workspace page.

## Security controls

- **Host header allowlist**: unknown hosts are rejected with 403 before any routing or rendering happens (pages and APIs both).
- **No existence leak**: an unknown workspace returns 404 (API) or a calm "Branch not found" page; a known store the caller cannot use returns 403 or `{ allowed: false }` with no store data.
- **Audit logging of denials**: every denied workspace attempt writes a `SecurityEvent` row (see above), so probing is visible in the audit trail.
- **Store context validated server-side on every request**: `x-store-subdomain` / `x-store-slug` are hints; authorization always re-derives the store from the Host header or the slug parameter against the database.
- **CSRF and CORS unchanged**: exact-host Origin matching, CSRF token cookie/header pair, JSON content-type enforcement, 1 MB request cap; CORS credentials only with exact origin echo for allowlisted hosts.
- **Privilege-abuse lockout still applies**: repeated permission denials (5+ in 10 minutes) lock the account out of the API for 15 minutes.

## Data model

`prisma/schema.prisma`:

- `Store.slug` (unique, nullable): path-workspace identifier, `/stores/{slug}/...`
- `Store.subdomain` (unique, nullable): subdomain-workspace identifier; null means "derive from slug"
- `Store.brandingColor` (nullable): hex accent colour for the branch workspace badge and header
- `StoreMembership` (table `store_memberships`): grants a user access to an additional store. `userId` + `storeId` unique, `role`, `status` (`ACTIVE`, `SUSPENDED`, `REVOKED`), `assignedById`, `note`. Deactivating a row blocks access immediately.

`Store.code` (unique, e.g. `JUJ`, `THI`) predates workspaces and is used in SKUs and staff numbers; the workspace layer exposes it alongside slug and subdomain.

## How to add a new store

1. **Create the store row.** Either extend `prisma/seed.ts` (the seed creates the five demo branches with slug, subdomain and branding colour) or insert/update directly:

   ```sql
   UPDATE "Store"
   SET slug = 'kisumu', subdomain = 'kisumu', code = 'KIS', brandingColor = '#0E7490'
   WHERE name = 'MBUMAH HARDWARE - Kisumu';
   ```

2. **Backfill missing identifiers** with the idempotent, production-safe script (it derives slugs, defaults `subdomain` to the slug, and fills `code`/`brandingColor` for the five seeded branches; it never touches rows that already have values):

   ```bash
   npm run db:backfill-slugs
   ```

   The same script runs automatically in the `vercel-build` chain, so Vercel deployments converge on their own.

3. **Local DNS**: add hosts entries or dnsmasq records for the new subdomain (see [Local offline setup](local-offline-setup.md)):

   ```bash
   npm run domains:print
   ```

4. **Production DNS**: subdomains resolve automatically once the wildcard `*.mbumah.co.ke` points at Vercel (see [Vercel deployment](vercel-deployment.md)).

5. **Verify**:

   ```bash
   npm run domains:verify
   ```

## Related documents

- [Local offline setup](local-offline-setup.md) - hosts file, dnsmasq, local HTTPS, mock M-Pesa
- [Multi-store workspaces](multi-store-workspaces.md) - organization console, branch selector, workspace UI
- [Global chat](global-chat.md) - the chat architecture
- [RBAC](rbac.md) - roles, permission matrix, tenancy layers
- [Vercel deployment](vercel-deployment.md) - wildcard domains and production env vars
- [Self-hosting](self-hosting.md) - nginx/Caddy wiring for subdomains
- [LAN deployment](lan-deployment.md) - one shop server for several devices
- [Tunnel development](tunnel-development.md) - Daraja sandbox callbacks behind ngrok/Cloudflare/Tailscale
