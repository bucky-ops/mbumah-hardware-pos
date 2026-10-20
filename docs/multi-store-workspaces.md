# Multi-store workspaces

Workspaces are addressed per branch (see [Subdomain workspaces](subdomain-workspaces.md) for the routing and security model). This document covers the surfaces that sit above the individual branch: the organization console, the branch selector, the workspace UI inside a branch, and how multi-store users are assigned.

## Organization console (/org/dashboard)

The root-domain console for `SUPER_ADMIN` and `STORE_OWNER` (full view) and `ACCOUNTANT` (financial read-only view). Data comes from `GET /api/org/summary`, which is restricted to those three roles - branch-only roles must never see organization-wide data.

What it shows:

- Six combined organization totals for today: revenue, transactions, low stock items, overdue rentals, debt outstanding, pending M-Pesa payments.
- A 7-day trend strip on the Revenue and Transactions cards (v2.173.0): the week's per-day sparkline (oldest → newest, gross `totalAmount` — the same semantics as the "Revenue today" headline it decorates), the week-vs-prior-week variance badge, and a "7d … · prior …" microcopy line. The variance badge renders only when the prior week has data — with no prior week there is NO comparison, never a fabricated "+0%". The trend rides the same response (`data.trend`) and degrades to the plain cards when absent.
- A top-mover sub-line on the same strip (v2.174.0): `Top mover <branch> <signed delta>` names the branch whose week-vs-prior delta is the largest in absolute terms — a branch that fell hardest is named as readily as one that jumped, and a branch that came alive from a zero week shows its jump without a percentage (a zero prior week has none, never an invented ∞). Computed server-side by the same pure lib (`topMover`); honest silences apply — no prior data anywhere, an exactly flat week, or a single-store org name nobody, and the line renders nothing.
- A per-branch table with the same KPIs per store (revenue today, transactions, low stock, overdue rentals, debt, pending M-Pesa), the branch code and location, and an inactive marker for stores that are not `ACTIVE`.
- The ten most recent audit events, org-wide.
- A Global Chat button (see [Global chat](global-chat.md)).

Every "Open branch workspace" action opens the branch in a **new tab** (`target="_blank" rel="noopener noreferrer"`), so the console tab stays available. The link is an absolute subdomain URL when every safety check passes on the current origin, otherwise `/stores/{slug}/dashboard`; on localhost, 127.0.0.1 and raw IPs the path form is always used. When no safe URL can be built (missing slug, inactive store) a calm inline message replaces the button. See [Branch workspaces](branch-workspaces.md) and [Store context resolution](store-context-resolution.md).

KPI definitions (from the summary route):

| KPI | Definition |
|-----|-----------|
| Revenue today | Sum of `SALE` transactions created today with payment status `COMPLETED` or `PARTIAL` |
| Transactions today | Count of those transactions |
| Trend · Revenue spark | v2.173.0 — per-day gross `totalAmount` over the last 7 days (today inclusive), oldest → newest; the window math is the pure lib `src/lib/org/summary-trend.ts` |
| Trend · variance badge | v2.173.0 — `((week − prior) / prior) × 100` rounded to 2 dp, vs the prior 7-day window; hidden when the prior window total is 0. Note: the expert console's KPI row (`/api/org/kpi-summary`) computes its revenue NET of tax — a pre-existing cross-surface divergence between the two "Revenue" labels, recorded in v2.173.0 |
| Trend · top mover | v2.174.0 — the branch whose week-vs-prior delta is largest in absolute terms (revenue gross, transactions counted), signed; null (line hidden) when the prior window has no data anywhere, every branch is exactly flat, or the org has fewer than two active stores; ties break alphabetically |
| Low stock | Active products at or below their reorder level |
| Overdue rentals | Rentals `ACTIVE` or `OVERDUE` whose expected return date has passed |
| Debt outstanding | Sum of balances on debt ledgers `OUTSTANDING`, `PARTIAL` or `OVERDUE` |
| Pending M-Pesa | M-Pesa transactions still `PENDING` |

## Branch selector (/branches/select)

The landing page for users assigned to **multiple** stores - typically the `WAREHOUSE_MANAGER` (post-login routing sends them here; see below).

- Shows only the caller's assigned, active stores (membership list from `/api/me/store-context` joined with `/api/stores?status=ACTIVE`), never the whole organization.
- "Open workspace" opens the branch in a new tab; the selector tab stays available so a manager can jump between branches.
- A single-store member is redirected straight to their workspace (no extra click).
- Zero assignments show a calm empty state with a link back.

## Post-login routing

`postLoginRedirect` (`src/lib/workspace/links.ts`) decides where a fresh login goes:

| Role | Destination |
|------|-------------|
| `SUPER_ADMIN`, `STORE_OWNER`, `ACCOUNTANT` | `/org/dashboard` |
| `WAREHOUSE_MANAGER` | `/branches/select` (it auto-redirects single-store members) |
| `CASHIER`, `BRANCH_MANAGER`, `INVENTORY_MANAGER` | The default SPA (their pinned store) |

Users who are already inside a workspace (path under `/stores/`, `/org/`, `/branches/` or `/chat`, or on a branch subdomain) stay where they are, so a branch user logging in on their branch subdomain lands in-branch.

## StoreMembership: assigning users to stores

The `store_memberships` table grants a user access to an additional store on top of their primary `User.storeId`. Columns: `userId`, `storeId` (unique together), `role` (same vocabulary as `User.role`), `status` (`ACTIVE`, `SUSPENDED`, `REVOKED`), `assignedById`, `note`. Deactivating a row blocks access immediately.

Seed stage 24 creates the demo warehouse manager and memberships:

- `warehouse@mbumahhardware.co.ke` - `WAREHOUSE_MANAGER`, active memberships in Juja Main and Thika, so the `/branches/select` flow can be exercised out of the box (demo password as documented in the root README).

Assign a user through SQL (the API surface for membership CRUD is not part of v2.16.0; assignments are managed at the data layer). PostgreSQL example:

```sql
INSERT INTO store_memberships (id, "userId", "storeId", role, status, note, "updatedAt")
VALUES ('membership_wh_ruiru', 'user_warehouse_manager', 'store_ruiru',
        'WAREHOUSE_MANAGER', 'ACTIVE', 'Kisumu road depot coverage', now())
ON CONFLICT ("userId", "storeId") DO UPDATE SET status = 'ACTIVE';
```

On the offline SQLite database the same insert uses plain SQLite syntax (no `now()`, use `CURRENT_TIMESTAMP`); the schema and column names are identical.

Revoke access by setting `status` to `SUSPENDED` or `REVOKED` (or deleting the row). Access checks (`resolveStoreContext`, `assertStoreScope`, chat accessibility) all filter on `status = 'ACTIVE'`.

## Workspace UI inside a branch

A branch workspace renders the same SPA shell as the root domain (`MainApp`), with:

- **Page title**: `{Store Name} | Mbumah Hardware POS` (set by the route's `generateMetadata` and re-applied client-side by the workspace gateway).
- **Branch accent colour**: the gateway sets the `--store-brand` CSS variable from `Store.brandingColor` (default `#B45309`), and the top-bar branch badge uses the same colour for its border and text.
- **Branch badge in the top bar**: in a pinned workspace the top bar shows the branch name and location next to the role chip.
- **Sidebar branch badge / selector**: single-branch roles (`CASHIER`, `BRANCH_MANAGER`, `INVENTORY_MANAGER`) see a static branch badge instead of a store switcher in a pinned workspace. Org-wide and multi-store roles keep the switcher; the server still validates every switch (`assertStoreScope`).
- **Calm states**: loading skeleton, same-origin login, "Branch not found", and a "You do not have access to this branch" denial screen that notes the attempt has been logged.

### Cart isolation per store

Cart state is stored per store, so switching branches never mixes trolleys:

- In subdomain mode each branch is its own browser origin, so localStorage and IndexedDB are isolated by the browser itself.
- In path mode (one shared origin) the POS persists cart snapshots keyed by `storeId` in the IndexedDB database `mbumah-offline-pos` (store `carts`, `src/hooks/use-offline-cart.ts`). On mount or branch change the hook loads the snapshot for that store and hydrates the cart; writes are debounced per store; clearing the cart clears that store's snapshot only.
- The durable zustand cart envelope (`mbt_cart_v1` in the `mbumah-pos-cart` IndexedDB database via `src/lib/cart-persist.ts`) survives logout, the 30-minute idle timeout and browser restarts.
- The offline sales queue (`mbumah-offline-pos`, store `transactions`) is likewise local to the device and replayed with the original store context (see [Offline mode](offline-mode.md)).

## Multiple branch tabs

Because every workspace is a normal URL, staff can keep several branches open at once: the org console in one tab, Juja Main in a second, Thika in a third. Each tab pins its own store (`currentStoreId`) and its own cart snapshot; data requests carry `storeId` and the server re-validates scope on every call. There is no cross-tab broadcast of cart state - tabs are independent by design.

## Related documents

- [Subdomain workspaces](subdomain-workspaces.md) - routing, authorization, security
- [Global chat](global-chat.md) - the chat architecture behind the Global Chat button
- [RBAC](rbac.md) - what each role can do inside a workspace
- [Local offline setup](local-offline-setup.md) - running the whole thing without internet
