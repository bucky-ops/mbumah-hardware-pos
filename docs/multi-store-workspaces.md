# Multi-store workspaces

Workspaces are addressed per branch (see [Subdomain workspaces](subdomain-workspaces.md) for the routing and security model). This document covers the surfaces that sit above the individual branch: the organization console, the branch selector, the workspace UI inside a branch, and how multi-store users are assigned.

## Organization console (/org/dashboard)

The root-domain console for `SUPER_ADMIN` and `STORE_OWNER` (full view) and `ACCOUNTANT` (financial read-only view). Data comes from `GET /api/org/summary`, which is restricted to those three roles - branch-only roles must never see organization-wide data.

What it shows:

- Six combined organization totals for today: revenue, transactions, low stock items, overdue rentals, debt outstanding, pending M-Pesa payments.
- A 7-day trend strip on the Revenue and Transactions cards (v2.173.0): the week's per-day sparkline (oldest → newest, gross `totalAmount` — the same semantics as the "Revenue today" headline it decorates), the week-vs-prior-week variance badge, and a "7d … · prior …" microcopy line. The variance badge renders only when the prior week has data — with no prior week there is NO comparison, never a fabricated "+0%". The trend rides the same response (`data.trend`) and degrades to the plain cards when absent.
- A top-mover sub-line on the same strip (v2.174.0): `Top mover <branch> <signed delta>` names the branch whose week-vs-prior delta is the largest in absolute terms — a branch that fell hardest is named as readily as one that jumped, and a branch that came alive from a zero week shows its jump without a percentage (a zero prior week has none, never an invented ∞). Computed server-side by the same pure lib (`topMover`); honest silences apply — no prior data anywhere, an exactly flat week, or a single-store org name nobody, and the line renders nothing.
- The mover's name is a door (v2.175.0): when the same safe resolver the branches table speaks can build a workspace URL from the winner's `slug`/`subdomain`/`isActive`, the name renders as a new-tab anchor (underline, hover, focus-visible ring, a tiny external-tab arrow, and an sr-only "opens in a new tab" clause); when no safe URL exists (missing slug, inactive branch, workspace mode off) the name stays plain text — the safe-builder contract verbatim: no safe URL, no link, calm fallback.
- A per-branch table with the same KPIs per store (revenue today, transactions, low stock, overdue rentals, debt, pending M-Pesa), the branch code and location, and an inactive marker for stores that are not `ACTIVE`. v2.175.0 adds a **7d trend** column beside "Revenue today": one muted slate sparkline per branch (the same `Sparkline` primitive the header cards speak, 72×20 so a table full of them never out-screams the cards), drawn from the same week-row set the header sparks bucket (the route's `findMany` gained `storeId` in its select — no second query); the week total rides the cell's title tooltip and an sr-only clause, and a branch with an empty week draws the honest flat line (zeros, never a gap). The payload rides `data.perStoreTrend` keyed by `storeId`; an older cached response without it degrades to a muted "—" per row.
- The ten most recent audit events, org-wide.
- The expert console (`/console`) speaks the same week (v2.176.0): the store strip draws each branch's muted slate spark (72×20, the dashboard table's exact vocabulary) from the same `perStoreTrend` block the page already polls — no second fetch, the week total on hover plus an sr-only clause, and an honest dash row when the block is absent; the Revenue card's drill-down lists "The week by branch" underneath the org line (loudest week first, joined by `storeId`, branch names as visible text), labeled so both vocabularies stay honest — branch shapes are gross, the org line is net of VAT. A branch manager without matrix access (or an older cached answer) sees the org-wide story only.
- Every branch's week learns its own verdict (v2.177.0): a small week-over-week delta chip stacks under each branch's spark on ALL THREE trend surfaces — the dashboard's branches table, the expert console's store strip, and the drill-down's week-by-branch rows. One classifier (`weekDelta` in the pure lib), one visible vocabulary (up `emerald-700`, down `red-700`, flat calm `muted-foreground` — the header badge's contrast family), one accessible phrasing (`weekDeltaWords` — "Up 12.4% vs prior week" as a second sr-only sentence; the v2.175.0 base clause keeps its exact shape). A branch with NO prior week draws no chip and speaks no words — no comparison, never a fabricated "+0%". The payload rides the SAME `perStoreTrend` entries (each gains `priorWeekTotal` from the top-mover math's already-computed prior slices — still zero new queries); an older cached response degrades to no chip, never a crash.
- The export carries the week (v2.178.0): the branches CSV grows a fourth section — "The week by branch (7d)", the drill-down's own rows loudest week first, each branch's gross week total, prior week, and a signed Change % from the SAME `weekDelta` classifier (chip and file can never disagree); no prior week leaves the Change cell empty. The block rides the summary payload (no second fetch), an absent block ends the file at the v2.177.0 shape, and the export note counts the sections it actually wrote.
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
| Trend · mover link | v2.175.0 — the top-mover's name deep-links to the branch workspace through `resolveBranchWorkspace` with the winner's `slug`/`subdomain`/`isActive` (new tab, `rel="noopener noreferrer"`); null href (missing slug / inactive / mode off) renders the name as plain text |
| Trend · per-branch 7d spark | v2.175.0 — `data.perStoreTrend` keyed by `storeId`: the branch's own 7-bucket gross revenue spark from the same week rows as the header sparks (`storeSparks` in the pure lib), plus `weekTotal` for the tooltip; empty week → honest zeros (flat line), absent payload → muted "—" |
| Trend · expert strip spark | v2.176.0 — the expert console's store strip draws the same `perStoreTrend` spark per branch (muted slate 72×20, title tooltip + sr-only carry the gross week total); absent block or missing entry → a calm dash row at spark height, the card's workspace link untouched |
| Trend · expert drill-down by branch | v2.176.0 — the KPI row's Revenue drill-down lists every branch's spark + gross week total, joined by `storeId`, sorted loudest week first, under an explicit net-vs-gross note; built only when both the trend block and the branch names arrived, otherwise the modal keeps its org-wide story only |
| Trend · per-branch delta chip | v2.177.0 — each `perStoreTrend` entry gains `priorWeekTotal` (from the v2.174.0 top-mover prior slices — zero new queries); `weekDelta` classifies up/down/flat (null when the prior week is 0 — no comparison, never "+0%"), `WeekDeltaChip` draws it on all three surfaces (up emerald-700 / down red-700 / flat muted, aria-hidden), `weekDeltaWords` speaks it as a second sr-only sentence; the 7d tooltips gain `· prior KES Y` exactly when a prior exists |
| Export · week by branch | v2.178.0 — the branches CSV's fourth section: the week rows loudest first (the drill-down's sort), gross week total + prior week + signed Change % computed by the SAME `weekDelta` the chips speak; missing/non-positive prior → empty Change cell; absent block → the file ends at the v2.177.0 shape; the export note counts the sections written |
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
