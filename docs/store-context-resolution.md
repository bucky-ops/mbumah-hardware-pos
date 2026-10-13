# Store context resolution

How the server decides "which workspace is this request in, and may this user use it?" for every workspace origin (root domain, path workspace, branch subdomain). The implementation lives in `src/lib/workspace/server.ts` (`resolveStoreContext`) and is exposed by `GET /api/me/store-context`; the client gateway in `src/components/workspace/workspace-gateway.tsx` renders one calm message per cause.

## Modes

The resolution result is one of three workspace modes (plus two negative modes):

| Mode | Meaning |
|------|---------|
| `organization` | Root-domain request: the organization console, no branch resolved |
| `subdomain` | The host is `{branch}.{root domain}` (or the proxy rewrote it) and the branch resolved |
| `path` | The branch was resolved from the `/stores/{slug}/...` path |
| `denied` | A branch resolved but the user may not use it |
| `not-found` | No branch could be resolved at that address |

## The reasonCode vocabulary

Alongside the internal audit-facing `reason`, the resolver returns a stable, client-safe `reasonCode` (added in v2.18.0.0). It flows through `buildStoreContextPayload` into the API payload (`data.reasonCode`) and the gateway maps it to one of six messages:

| reasonCode | Internal reason | Gateway message |
|------------|-----------------|-----------------|
| `store-not-found` | `STORE_NOT_FOUND` | Branch not found - "Branch workspace not found. Check the store slug or open the workspace from the organization console." |
| `store-inactive` | `STORE_INACTIVE` | "This branch is currently inactive. Contact the store owner or system administrator." |
| `user-not-allowed` | `NO_MEMBERSHIP` / `ROLE_NOT_PERMITTED` | "You do not have access to this branch." (the attempt is audit-logged) |
| `unauthenticated` | `UNAUTHENTICATED` | The same-origin login screen renders; after login the gateway re-resolves into the branch |
| `missing-slug` | `MISSING_SLUG` | "Branch workspace unavailable. Store slug is not configured." (no database call is made) |
| `schema-drift` | `SCHEMA_DRIFT` | "The local database needs a schema update. Contact the administrator or run the safe repair process." (Prisma known request error such as P2022; the error text is never leaked) |

The gateway additionally accepts `subdomain-unavailable` ("Subdomain workspace is not available on this host. Use the path-based branch workspace.") for payloads that report a subdomain request the current host cannot serve. Unknown codes fall back to the plain branch-not-found message, so older payloads keep rendering correctly.

## Detection order

1. A slug that is present but empty/whitespace short-circuits to `missing-slug` without touching the database.
2. The branch is resolved from the host subdomain first, then the explicit slug (the proxy rewrites `{sub}.root/x` to `/stores/{sub}/x`, so both point at the same store). A database query failing with a Prisma known request error is answered as `schema-drift`; other errors re-throw to the route's error boundary.
3. An unauthenticated request returns the branch summary with `allowed: false` so the login screen can render on the same origin.
4. Inactive stores are denied for everyone except SUPER_ADMIN (diagnostic view).
5. Authorization: SUPER_ADMIN and STORE_OWNER reach every active store; ACCOUNTANT gets a read-only view; a matching `User.storeId` passes; everyone else needs an ACTIVE `StoreMembership` row.

## Security properties

- **Re-derived server-side, never from client input.** The store is resolved from the Host header (host allowlist applies) or the URL slug. The `x-store-id` / `x-store-slug` headers set by the proxy are advisory hints only; client-supplied storeIds are never used for resolution here.
- **Forwarded host is opt-in.** `x-forwarded-host` is honored only when `TRUST_X_FORWARDED_HOST` is truthy, and then only behind a proxy that overwrites the header on every request (see `src/lib/workspace/config.ts`).
- **Authorization on every call.** Role rules and active memberships are checked inside the resolver, not in the UI.
- **Audit logging.** Denied attempts are written to the `SecurityEvent` feed with the internal reason, attempted subdomain/slug, role and email, plus the request host, pathname and request id for correlation (added in v2.18.0.0). Audit failures never change the access decision.
- **Calm failures.** Schema drift and missing slugs answer as ordinary not-found results without leaking error text or stack traces.

## Related

- [Branch workspaces](branch-workspaces.md) - hosting modes, the safe link builder, local/online setup
- [Subdomain workspaces](subdomain-workspaces.md) - the master routing reference
- [Troubleshooting and FAQ](troubleshooting-and-faq.md) - user-facing causes and fixes
