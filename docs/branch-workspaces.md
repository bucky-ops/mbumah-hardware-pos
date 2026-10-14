# Branch workspaces

Every branch of Mbumah Hardware can be opened as its own workspace website while the whole organization runs on one shared database and one application. This document explains how the "Open branch workspace" link is built safely, what the automatic path fallback does, and how to set up each hosting mode. For the routing and security model see [Subdomain workspaces](subdomain-workspaces.md) and [Store context resolution](store-context-resolution.md).

## Path mode vs subdomain mode

| Style | Address | Needs |
|-------|---------|-------|
| Subdomain mode | `https://juja-main.mbumah.co.ke/dashboard` | A root domain with wildcard DNS (or hosts entries) |
| Path mode | `/stores/juja-main/dashboard` on the current host | Nothing - works on every host, including localhost and raw IPs |

Both styles serve the same SPA shell and the same branch data, pinned to the branch by the server.

## One shared database

There is one deployment and one database. Every `Store` row is a workspace. The branch is resolved server-side from the request (Host header or `/stores/{slug}/...` path), never from client-supplied input, and every request is authorized against the signed-in user's role and store memberships.

## Automatic path fallback on local hosts

Even when subdomains are enabled (`NEXT_PUBLIC_USE_SUBDOMAINS=true` plus a configured root domain), the app automatically falls back to path mode on:

- `localhost` and `*.localhost`
- `127.0.0.1` and `::1`
- every raw IP address (IPv4 dotted quads such as `192.168.1.20`, and bare IPv6 literals)

A subdomain URL like `https://juja-main.mbumah.co.ke` cannot resolve from those hosts, so branch workspace links built there are always `/stores/{slug}/dashboard`. The safe link builder lives in `src/lib/branch-workspace.ts` (`getBranchWorkspaceHref`); it is unit-tested for every one of these cases.

## The "Open branch workspace" button (organization console)

The organization console opens each branch in a **new tab** (`target="_blank" rel="noopener noreferrer"`), so the console tab stays available.

- The link is built by `getBranchWorkspaceHref` from the store record and the current origin: a subdomain URL only when every safety check passes, otherwise the path workspace.
- If no safe URL can be built (the store has no slug configured, or the store is inactive), no tab is opened. The button is replaced by a calm inline message: "Branch workspace unavailable" (hover the text for the exact cause).
- Inactive stores can never be opened from the console; the workspace gateway also blocks them server-side.

A **missing store slug is a configuration error**, not a crash: fix the store's slug (organization settings or the database seed) and the button comes back. On a local SQLite database whose stores table predates the workspace columns, `node scripts/repair-branch-workspace-store-schema.mjs` repairs the missing `slug` / `subdomain` / `status` columns additively and idempotently (backup first, raw SQL only, duplicates stop the repair instead of being forced); `node scripts/verify-branch-workspace.mjs` checks the same columns read-only. See [Store context resolution](store-context-resolution.md).

## Subdomain requirements

To open `https://{branch}.{root}` URLs you need all of:

1. `NEXT_PUBLIC_ROOT_DOMAIN` set to your domain (for example `mbumah.co.ke` or `mbumah.test`).
2. DNS (or hosts-file entries) that resolves the root domain AND every branch subdomain to your server.
3. `ALLOWED_HOSTS` (or the built-in defaults) accepting the root domain and its wildcard.
4. Store rows with a valid, non-reserved `slug`/`subdomain` (RFC 1123 labels; reserved labels such as `admin`, `api`, `www` never become branch subdomains - they fall back to path mode).

## Safe local setup (path mode, no hosts entries)

`cp .env.example .env` already gives you the safe defaults:

```env
NEXT_PUBLIC_USE_SUBDOMAINS=false
NEXT_PUBLIC_STORE_WORKSPACE_MODE=path
NEXT_PUBLIC_ROOT_DOMAIN=localhost
NEXTAUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXTAUTH_COOKIE_DOMAIN=
NEXTAUTH_COOKIE_SECURE=false
NEXTAUTH_COOKIE_SAME_SITE=lax
ALLOWED_HOSTS=localhost,127.0.0.1
TRUST_X_FORWARDED_HOST=false
```

Open the console at `http://localhost:3000/org/dashboard` and every branch opens as `http://localhost:3000/stores/{slug}/dashboard`. No hosts entries, no DNS, no TLS.

## Local subdomain setup (mbumah.test)

To rehearse subdomain mode on one machine, use the offline template and the hosts helper:

```bash
cp .env.local-offline.example .env   # then fill secrets
node scripts/domains/print-hosts.mjs # prints hosts entries; apply them yourself
bun run dev
```

The printed block covers `mbumah.test` and every branch subdomain (`juja-main.mbumah.test`, `thika.mbumah.test`, `ruiru.mbumah.test`, `nairobi-cbd.mbumah.test`, `nakuru.mbumah.test`). Set `LOCAL_LAN_IP` to also print a LAN block for the same entries. Path mode keeps working with or without the entries. Full walkthrough: [Local offline setup](local-offline-setup.md).

## Online setup (Cloudflare Tunnel)

For a public deployment, copy `.env.online.example`, point `NEXT_PUBLIC_ROOT_DOMAIN` at your public domain, enable secure shared cookies, and route `app.{domain}` plus `*.{domain}` through Cloudflare Tunnel (or Caddy). Enable `TRUST_X_FORWARDED_HOST=true` ONLY behind a proxy that overwrites the forwarded header on every request. Full walkthrough: [Online hosting](online-hosting.md).

## Access rules (enforced server-side)

- Inactive stores are blocked with a clear message ("This branch is currently inactive. Contact the store owner or system administrator.").
- A user without an assignment to the branch is denied ("You do not have access to this branch."), and the attempt is written to the SecurityEvent audit feed.
- Cashiers and branch managers stay pinned to their own store; warehouse managers need an ACTIVE StoreMembership; SUPER_ADMIN and STORE_OWNER see every active store; ACCOUNTANT gets a read-only view.

Demo credentials shipped in the seed are for LOCAL/OFFLINE use only - never reuse them on an internet-facing deployment.

## Related

- [Store context resolution](store-context-resolution.md) - the resolver, the reasonCode vocabulary and the security properties
- [Subdomain workspaces](subdomain-workspaces.md) - the master routing reference
- [Multi-store workspaces](multi-store-workspaces.md) - the org console and branch selector surfaces
- [Troubleshooting and FAQ](troubleshooting-and-faq.md) - the "branch workspace does not exist" entry
