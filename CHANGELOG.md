# Changelog

All notable changes to Mbumah Hardware POS are documented in this file (Keep a Changelog format; versions follow package.json).

## [2.15.2] Hotfix: offline laptops self-heal database schema drift

### Fixed
- **Critical (offline incident): laptops updated to a release whose schema added unique columns kept serving Prisma P2022 errors** - "The column `equipment_rentals.idempotencyKey` does not exist in the current database" on `/api/notifications`, `/api/debt`, `/api/reminders/debt/overdue` and `/api/stock-movements`. Root cause: v2.14.0 added five nullable `idempotencyKey @unique` columns; Prisma classifies adding a unique constraint to a NON-EMPTY existing database as a data-loss warning and REFUSES `prisma db push` in non-interactive mode ("Use the --accept-data-loss flag"). Every self-hosted path (Windows installer, updater, Linux laptop scripts, docker entrypoint) ran the bare push with no fallback, so the database silently stayed behind the code while `/api/health` stayed green (row counts never touch new columns).

### Added
- **`scripts/ensure-schema.mjs` - the self-healing schema converge step** now behind `npm run db:push` everywhere (installer, updater, laptop scripts, CI prepare): plain push first (fast no-op when in sync); when refused, it backs the SQLite file up (`pos.db.pre-heal-<timestamp>.db`, newest 5 kept) and converges with `--accept-data-loss` - safe for this project's recurring additive drift (new nullable unique columns).
- **Startup self-heal**: the standalone server launcher (`deploy/nodocker/start-server.mjs`) converges the schema on EVERY boot before starting the POS (~1s no-op when in sync), so an install whose update schema step was skipped repairs itself the next time the shop opens the till. Disable with `SKIP_SCHEMA_HEAL=1` in `.env`. The docker entrypoint uses the same converge step (replacing the blind push + retry).
- **Schema-drift sentinel in `/api/health`**: when row counts succeed but the schema lags the code, `database_stats` degrades from `ok` to `warning` with a self-service fix hint. The probe uses the generated Prisma client (an ORM `findFirst` on the sentinel column) - a raw `SELECT "idempotencyKey"` probe would be blind on SQLite, which treats a double-quoted unknown identifier as a string literal instead of erroring. The start-pos and update-pos health gates key on exactly this status, so a drifted database can no longer pass the update health gate unnoticed.

### Notes
- Data safety: the converge fallback only ever runs after a plain push is refused, takes a timestamped SQLite file backup first, and the updater still takes its full pre-update backup before the rebuild. No changes to totals, VAT math, payments, debt or discount gates.
- Immediate remedy for affected laptops (works on any version): close the POS, run `npm run db:push` in the app folder, start the POS. Updating to 2.15.2+ does this automatically.

## [2.15.1] Hotfix: offline sales actually queue (mutation networkMode)

### Fixed
- **Critical: the offline sale flow never fired while offline** - TanStack Query pauses mutations when `navigator.onLine` is false under its default `networkMode: 'online'`, so `checkoutMutation.mutationFn` never ran, `saveOfflineTransaction()` was never reached and tapping "Process Payment" offline silently did nothing (queue stayed empty, no synthetic receipt). The app-wide QueryClient now sets `mutations.networkMode: 'always'`; the checkout mutationFn's own `navigator.onLine` check routes offline sales into the IndexedDB queue, and mutations without an offline path surface their network error via their normal `onError` handlers.
- Caught by the post-release browser E2E (release-process step 3): `[HANDLE-CHECKOUT]` logged while the mutation function never did; after the fix the full loop was verified live on the POS - offline sale saved locally with amber queue badge and synthetic receipt, reconnect auto-synced it to the server (real receipt number, Completed), queue drained to the green dot, and exactly one "Offline sales synced" success toast appeared (no duplicates).

### Notes
- No schema changes; no changes to totals, VAT math, payments, debt or discount gates. The offline queue engine, idempotent replay and indicator were already correct - only the mutation gating blocked them.

## [2.15.0] Release: audit corrections, realtime self-hosting wiring, offline polish

### Fixed
- **Duplicate sync toasts at the till**: an automatic background sync with the POS tab mounted toasted twice for the same event (POS tab's own success toast + the global OfflineIndicator's transition toast). Toast ownership is now explicit - the top-bar indicator owns the single "Offline sales synced" success per queue transition, and the POS tab surfaces only what the indicator cannot see: per-sync failure detail (which sales will retry). Manual "Sync now" and offline/online announcements are unchanged.
- **Latent self-hosted startup bug**: nginx `proxy_pass http://nextjs_app` referenced a hostname the compose file never defined (the app container had been renamed to `mbumah_app`), so `docker-compose.prod.yml` failed at nginx startup with "host not found in upstream". The app service now carries the `nextjs_app` network alias (documented in place).
- **Fresh-clone test suite**: `bun run test` failed 16 DB-dependent tests locally because the hermetic SQLite test database (`prisma/prisma/dev.db`) only existed in CI. A new `pretest` hook (`scripts/prepare-test-db.mjs`) mirrors the CI prepare step (schema push + seed against the forced URL, committed postgresql schema text restored afterwards), making the suite self-sufficient: 17 files / 447 tests green on a fresh clone (was 411/16 failed).

### Added
- **Realtime notifications ship self-hosted**: `mini-services/notification-service` now has a production Dockerfile (bun runtime, frozen lockfile) and runs as an internal-only `notification` service in `docker-compose.prod.yml` (healthcheck on `/health`, nginx `depends_on` healthy). Nginx routes same-origin `/socket.io/` traffic to it with websocket upgrade headers and 24h timeouts. Verified end-to-end: Engine.IO polling handshake 200, websocket connect, `join-store` -> `room-joined`. On Vercel the client degrades gracefully (no realtime push, everything else unchanged).
- **Offline mode documentation** (`docs/offline-mode.md`): queue flow (queue -> replay -> dedupe -> cleanup), cashier-facing surfaces, step-by-step offline testing, developer notes; indexed from `docs/README.md`.
- **Health endpoints guide** (`docs/deployment.md`): documents the `/api/health` (public, automation) vs `/api/healthy` (authenticated, in-app) split and the realtime service wiring.

### Improved
- Repository organization phase 2: client source materials consolidated under `docs/assets/`, ops runbook moved to `docs/runbooks/`, sandbox template artifacts removed, repo-wide markdown hygiene (single H1, no emoji headings, no em dashes), gitignore env-variant coverage.

### Notes
- No schema changes; no changes to totals, VAT math, payments, debt or discount gates.
- Version reads from `package.json` everywhere (API, footer badge, OpenAPI) per the release process.

## [2.14.0] Production hardening: self-test, engraved admin, offline queue UX, stock contract

### Added
- **POST self-test + engraved-admin self-heal**: `/api/system/post` runs isolated production checks (PASS/FAIL/DEGRADED); `/api/system/heal` repairs the seeded engraved super admin idempotently; engraved accounts cannot be deleted, deactivated or demoted via the users API (403 `ENGRAVED_ADMIN_PROTECTED`); Admin tab gains a System Health card and shield badge.
- **Offline queue UX**: top-bar `OfflineIndicator` (green/amber dot + Offline Queue dialog listing every queued sale) on every tab, single per-transition reconnect toast, `clearOfflineQueue()` for the confirmed dialog action; canonical import path `@/lib/offline` with the queue contract documented in `src/lib/offline/README.md`.
- **Stock shortage contract**: checkout pre-validates every sellable line and fails with one structured 400 (`INSUFFICIENT_STOCK` + per-product details) before any charge; race losers map to the same contract; the POS clamps lines to available stock and routes zero-stock lines to the existing low-stock popup.
- **Ops**: `scripts/backup.sh` (sqlite3 `.backup` -> gzip with retention), database idempotency keys on `DebtLedger`/`EquipmentRental`/`Expense`/`StockMovement`.

### Improved
- **Fullscreen sidebar autohide**: in browser fullscreen the sidebar collapses to a 64px icon rail, auto-hides after 2s idle, peeks from a left-edge sensor, and restores state on exit; icon tooltips show F2-F5 shortcut hints; user menu gains "Toggle Fullscreen".
- **Inventory reorder prefill**: at/below-reorder products show "Reorder (+N)" (row menu, detail panel and a quick-fill chip in the Adjust Stock dialog) that prefills the suggested quantity to restore the stock level.
- **Typography sweep**: repo-wide string-literal cleanup (em dashes -> hyphens, decorative emojis out of internal UI); customer-facing templates exempt.
- **Repository organization phase 1**: Windows installers under `deploy/windows/`, QA screenshots and sandbox scripts removed, `bun.lock` as the sole lockfile, governance files (CONTRIBUTING/SECURITY/CODE_OF_CONDUCT/CHANGELOG/SUPPORT) and `.github` templates in place.

### Notes
- Receipts gained print/PDF parity (`<receipt-number>.pdf`), amount no-wrap, unit abbreviations and a fixed totals strip.
- No changes to totals, VAT math, payments, debt or discount gates.

## [2.13.3] Feature release: functional POS + new 3D logo + smart recommendations

### Added
- **New 3D brand logo everywhere (spec PART 1)**: the official MBUMAH HARDWARE artwork (navy gear · orange house · silver trowel · "Your Building Partner in Juja") now anchors the sidebar in a white rounded-xl container with drop shadow so it sits cleanly on the dark `#0f172a` rail; the old flat green "MH" initials square is gone. A gear-only crop marks the top bar (visible even when the sidebar is collapsed) and the favicon/PWA icons are regenerated from the same artwork. Light backgrounds use the full-color logo as-is; dark surfaces get the white-container wrapper.
- **Smart Sell More recommendations (spec PART 3)**: a client-side product-affinity engine (`src/lib/product-affinities.ts`) maps what's in the cart to what the same customer very likely still needs (cement → spade + mixer + nails; mabati → timber + nails; rebar → cement + binding wire…), ranks by frequency, drops items already in the cart or out of stock, and shows the top 6 as tappable chips (+ icon, category dot, price). Works from the first cart, with no sales history needed (the server's co-occurrence engine is merged in and takes over as history accumulates). An empty cart shows best-seller chips; a cart with no mapped affinity shows the coach text plus best sellers below. The section is collapsible and the collapse state persists per device.
- **Thika branch catalog aligned to spec (PART 2)**: `scripts/seed-thika-catalog.ts` (idempotent, owner-run, StockMovement-audited) ensures the THI branch carries the 11 spec products at exact prices and stock: 4-inch Nails (Ksh 150/kg · 350), Bamburi Cement 50kg (750 · 180 bags), Dulux Weathershield 20L (8,500 · 20), Mabati 28/30-Gauge 8ft (800/650 · 200/350), Plywood 8x4ft 18mm (2,800 · 45), PVC Pipe 4-inch x 3m (800 · 90), Rebar 12mm x 12m (1,200 · 280), Simba Cement 50kg (720 · 120 bags), Spade Heavy Duty (1,200 · 40), Timber 2x4 x 12ft Cypress (800 · 60), plus the rental Concrete Mixer (Ksh 85,000, RENTAL) and Chain Link 6ft x 50m (4,500) used by the demo cart.

### Improved
- **Instant, honest cart feedback (spec PART 2)**: product tiles now show a blue "1 in cart / 2 in cart" pill the moment a line lands (optimistic, under 100ms, no network involved; pops on every re-add), add-toasts name the product and price ("Added Spade (Heavy Duty) - Ksh 1,200"), and Hold toasts say exactly what was parked ("Cart held - 7 items").
- **Faster search**: the products query debounce drops 200ms → 150ms per the functional-POS spec; the input itself stays instantly responsive and barcode-scan Enter-to-cart behaviour is unchanged.
- **Zero-sales KPI honesty (new branches)**: when a branch has no sales today, the Today's Revenue card shows a gray trend badge (never green or red at zero) with a hover tooltip "No sales yet today - start selling!" and the same coaching line as the card sub-text. Live/updated/auto-refresh-30s behavior from v2.13.0 is untouched.

### Notes
- RBAC, manager-PIN overrides, abuse detection and the audit trail (v2.12.x-v2.13.0) are unchanged and fully enforced.
- No schema changes; no changes to totals, VAT math, payments, debt or discount gates.

## [2.13.2] Hotfix: checkout 500 regression + limited-dashboard money card

### Fixed
- **Critical: checkout 500 on every sale (v2.13.1 regression)**: the new VAT-ledger line chained `.mul()` on the `Money` wrapper (which exposes `multiply()`/`taxComponent()`, not `mul()`), throwing `TypeError: KES(...).mul is not a function` and failing **every** `POST /api/transactions` with a 500. Replaced with the vetted helper `KES(finalTotal).taxComponent(rate).toNumber()`, the exact intended formula (`total × rate/(100+rate)`), Decimal-safe, 2dp HALF_UP. Caught by the post-deploy prod E2E (network log captured the 500 body) within minutes of rollout.
- **Cashier dashboard "Today's Sales" showed a count as money**: the limited payload's `todaySales` carried the transaction COUNT, so one sale rendered as "Ksh 1.00" while the real net revenue only surfaced via Avg Order. Now returns net revenue (same semantic as the full dashboard), keeping "Transactions" as the count card.

## [2.13.1] Fixed: VAT alignment & cashier KPI scoping

Closes the two acceptance nuances documented at the v2.13.0 E2E verification. No schema changes; no changes to totals, payments, debt or discount-gate math.

### Fixed
- **VAT figure is now receipt-true (spec formula)**: the info-only "VAT (x% incl.)" line on the POS cart, checkout summary and printed receipt shows the VAT component **inside the amount the customer actually pays**: `Total × rate / (100 + rate)`. Previously it showed the pre-discount per-line VAT component, so a Ksh 220 cart with a Ksh 50 discount (Total 170) displayed VAT 30.34 instead of 23.45.
- **Server VAT ledger aligned (Kenya VAT Act)**: `SalesTransaction.taxAmount`, the journal `VAT_PAYABLE` credit, the eTIMS payload `vatTotal` and the receipt's taxable-amount derivation now all use the post-discount consideration, since a discount given at the time of supply reduces the taxable value. Net revenue (`totalAmount − taxAmount`) therefore increases by the discount's VAT component on discounted sales, which is correct under IFRS 15 (revenue at transaction price).
- **Journal entry restructure**: the cart-level discount is no longer booked to the `SALES_DISCOUNTS` contra-revenue account (it is already netted inside the transaction-price revenue; booking both would unbalance the entry by exactly the discount). The discount remains recorded on the transaction row (`discountAmount`) for analytics. Entries created before v2.13.1 are untouched and remain balanced.
- **Cashier dashboard KPIs strictly own-scoped**: the limited dashboard's "Today's Sales", "Transactions" and "Avg Order" aggregates now filter on `cashierId = session.userId` and are captioned "your sales", matching the RBAC spec ("My Sales", not the branch total). Low Stock remains a store-level signal (no revenue leakage; previously true by construction).

### Notes
- Historical transactions keep their stored figures (documents are immutable history); only sales created on/after v2.13.1 use the aligned VAT derivation.
- Info-only guarantee still holds: Totals, Subtotals, Discounts, payments, debt, gift-card redemptions and the discount permission gates are byte-identical to v2.13.0 behavior.

## [2.13.0] Feature release: RBAC & Audit

The v2.12.1 → v2.13.0 ladder completes the RBAC roadmap. This release's headline is already live since v2.12.5-v2.12.8; v2.13.0 adds the release polish and ships the full ladder together.

### The ladder (v2.12.1 v2.12.8)
- **v2.12.2-v2.12.5, RBAC core**: 16-key dotted feature-permission matrix (`src/lib/permissions.ts`) with a 5-role system (SUPER_ADMIN, STORE_OWNER, BRANCH_MANAGER, CASHIER, INVENTORY_MANAGER), backend `403 PERMISSION_DENIED` enforcement, role-filtered sidebar with lock affordances, LockedCard + access requests, cashier limited dashboard, manager step-up authorization at the counter (`POST /api/auth/manager-authorize`) for >5% discounts and high-risk debt (KES 150k+).
- **v2.12.6-v2.12.8, Audit & abuse**: consolidated Audit Trail page with CSV export, discount-spam abuse detection (>3 denials/1h → SecurityEvent + manager notifications), privilege-abuse lockout (5 denials/10 min → 15-minute lock + Super Admin alerts), Security tab in the notification center, inventory price guard for INVENTORY_MANAGER.
- **v2.12.1, POS hotfix**: per-unit fallback ("per " bug), product-card badge overlap, FAB overlap on checkout, category scrollbar, VAT "(incl.)" labels, stock counter units, duplicate-image cleanup script.

### Added (v2.13.0)
- **What's New dialog**: on first launch after an update, a "Karibu! What's New in Mbumah POS" modal summarizes the release (latest version highlighted, previous entries below) with a direct link to this changelog on GitHub. Shown once per version via `localStorage.mbt_seen_version`; SSR-safe, and it does not repeat when storage is unavailable.
- **Footer status chip**: the Connected dot is now a live online indicator (mirrors `navigator.onLine` via online/offline events): green pulsing dot when connected, red "Offline" when the connection drops. Hidden on xs screens.
- **Footer Shortcuts button**: opens the existing Keyboard Shortcuts help dialog (previously reachable only via the `?` shortcut).

### Deprecated
- **Versions prior to v2.13.0 are deprecated for support purposes; self-hosted stores should update via the in-app updater (v2.9.0+) or the Remote Access Kit flow.**

## [2.12.8] Audit Trail page

### Added
- **Audit Trail view in the Security tab**: a second view ("Security Dashboard | Audit Trail" toggle, dashboard stays default) rendering a consolidated table of permission denials, manager overrides and manager authorizations: timestamp (with time-ago), user (name + truncated email), role, color-coded action badge (red denial / amber override / green authorized), resource + reason, result (DENIED / SUCCESS), branch, IP address.
- **Filters**: role select, user search (name/email), date range (from/to), "Denied only" switch, free search (permission/resource/reason), Prev/Next pagination with totals, and **Export CSV** (`mbumah-audit-trail-YYYYMMDD.csv`) honoring the active filters.
- Loading skeletons, error state and an explicit empty state ("No audit events match your filters"); long tables scroll inside a `scrollbar-thin` container.

## [2.12.7] Abuse detection & security alerts

### Added
- **Discount-spam pattern alert**: a cashier (or any role) denied `pos.discount.gt5` more than 3 times in 1 hour now writes a `PRIVILEGE_ABUSE_PATTERN` SecurityEvent and notifies every active BRANCH_MANAGER and SUPER_ADMIN of the org (WARNING / SECURITY notification, e.g. "Grace Wanjiku (Cashier) attempted 4x discount >5% in 1h, 14:32"). In-memory sliding window per instance (same best-effort posture as the lockout engine); the SecurityEvent feed is the durable record.
- **Inventory price guard**: an INVENTORY_MANAGER whose product-price update deviates more than ±20% from the cost basis (or from the old price when cost is null) gets `403 MANAGER_APPROVAL_REQUIRED` + a `HIGH_RISK_ATTEMPT` security record. The same `managerOverride` credential object used at checkout lets a Branch Manager+ approve inline (writes a MANAGER_OVERRIDE audit row with `PRODUCT_PRICE_GUARD` context); 3 wrong approvals in 5 minutes trip the existing brute-force window.
- **Security tab in the Alerts panel**: role-gated (SUPER_ADMIN / STORE_OWNER / BRANCH_MANAGER) red-shield filter tab listing SECURITY-category notifications, with the 10 most recent abuse-set SecurityEvents (permission denials, high-risk attempts, brute force, lockouts, abuse patterns) merged below as read-only, red-tinted entries. The bell badge now reflects security alerts too; `/api/notifications` previously surfaced none of the durable SECURITY notification rows.

### Changed
- `/api/security/events` accepts BRANCH_MANAGER (store-scoped) and supports a comma-separated `eventTypes` filter.

## [2.12.6] Audit logging consolidation

### Added
- **GET /api/admin/audit-trail** (SUPER_ADMIN / STORE_OWNER / BRANCH_MANAGER): one consolidated, paginated feed merging hash-chained AuditLog rows (`PERMISSION_DENIED`, `MANAGER_OVERRIDE`, `MANAGER_AUTHORIZED`) with SecurityEvent denial rows (`PERMISSION_DENIED` / `HIGH_RISK_ATTEMPT`) that have no AuditLog twin, so every denial appears exactly once (nearest-timestamp dedup, HIGH_RISK kind carried from the twin). Branch-scoped for non-super-admin callers; `format=csv` streams the compliance export.

### Deferred
- **`pos.void` endpoint**: still does not exist (verified); nothing was invented for it. The `requireFeaturePermission('pos.void')` gate, manager-override flow and Audit Trail visibility are ready the moment the endpoint lands. Void >2/shift manager approval ships with it.
- **Email digest option** for security notifications (daily/weekly summary), scheduled for a later release.

## [2.12.5] RBAC stable

Umbrella release of the v2.12.2 → v2.12.5 RBAC ladder: the role/permission system is now enforced end-to-end: backend 403s with typed denial payloads, role-filtered navigation with lock affordances, manager approval flows at the counter, and a dedicated limited view for cashiers. See the individual sections below for what shipped in each step.

### Highlights
- One permission model, two layers: the resource→action matrix (`hasPermission`) for CRUD checks plus the dotted feature keys (`hasFeaturePermission`) for business rules like discounts and dashboards.
- Manager approvals are now a first-class counter workflow: the cashier can complete a gated sale by collecting a manager's credentials, and every approval/denial is durably audited.
- Cashiers see an honest, useful workspace instead of broken analytics: own-activity KPIs, their own sales, and a clear "request access" path.

### Notes
- No database migrations required (User.role is a string column; the permission matrix is code-defined in `src/lib/permissions.ts`).

## [2.12.4] Cashier Limited View

### Added
- **Limited dashboard for revenue-denied roles** (CASHIER, INVENTORY_MANAGER): the dashboard API early-returns a minimal payload (`limitedView: true`, today's sales, transaction count, average order value, low-stock counts and the caller's own last 10 sales (`mySales`)) and never computes or ships revenue trends, debt exposure, top products/customers, payment-method amounts or inventory value for these roles (restricted by construction).
- **Cashier dashboard layout**: greeting hero, 4 KPI cards only (Today's Sales, Transactions, Avg Order, Low Stock), a "My Sales" feed (receipt tail, payment-method badge, amount, time-ago), an info banner ("You're viewing a limited dashboard. Revenue, debt and analytics are hidden for your role.") and a 2-column grid of LockedCards for Revenue Trend, Debt Aging, Store Health and Financial Reports, each with a "Request Access" action.
- **High-risk debt warning in POS**: selecting a customer whose outstanding balance exceeds KES 150,000 shows a red inline warning in the customer selector; amounts appear only for roles holding `customers.view.debt`; cashiers see the generic "Credit approval required for this customer".

## [2.12.3] RBAC core: matrix, sidebar filtering, locked cards

### Added
- **INVENTORY_MANAGER role** (frontend surfaces): catalog, inventory, suppliers, purchase orders and transfers now grant the role; role labels and tier order shared app-wide (`ROLE_LABELS`, `requiredRoleLabelFor`).
- **Sidebar lock affordances**: tabs a role cannot open are no longer silently hidden; they render as a grayed row with a 14px Lock icon, a "Requires {role}" tooltip (e.g. "Requires Branch Manager"), `aria-disabled` non-clickable behavior, and just the lock icon when the sidebar is collapsed. Accessible tabs keep the orange active-item style.
- **Cashier navigation narrowed to spec**: exactly Dashboard, POS, Customers, Transactions (Messaging/Chat moved out of the cashier's reach).
- **LockedCard component** (`src/components/rbac/locked-card.tsx`): premium locked-section card matching the dashboard design language: lock glyph in a muted circle, "Requires {role}" title, one-line explanation from the permission copy, and a debounced "Request Access" button.
- **Access-request flow** (`POST /api/access-requests`): records a `SecurityEvent(ACCESS_REQUEST, INFO)` with the permission key, requester email and role, and creates Notification rows for every active SUPER_ADMIN and BRANCH_MANAGER of the organization (requester excluded). Grants remain a Super Admin action.
- **Top-bar role badge**: muted role chip next to the top-bar actions (hidden on very small screens); SUPER_ADMIN renders "SA · System Administrator".
- **Feature-permission hook layer**: `usePermissions()` now exposes the `feature` group (`posSell`, `posDiscountGt5`, `dashboardRevenue`, `inventoryViewCost`, …) built on `hasFeaturePermission`, plus a plain `canFeature(role, key)` helper.

### Fixed
- **Cost hiding**: where the products API strips `costPrice` to null (roles without `inventory.view.cost`), the inventory table, detail dialog, stock-value summary and CSV export now render "•••" ("Cost hidden for your role") instead of 0 / blank / NaN margins.

## [2.12.2] Security: backend permission middleware + 403 handling

### Added
- **Feature permission matrix** (`src/lib/permissions.ts`): 16 dotted keys (`pos.sell`, `pos.void`, `pos.discount.gt5`, `pos.discount.gt10`, `pos.view.all_sales`, `dashboard.view.revenue`, `dashboard.view.profit_margin`, `dashboard.view.debt_aging`, `inventory.edit`, `inventory.view.cost`, `customers.view.debt`, `customers.create`, `debt.approve.high_risk`, `financial.view`, `settings.roles.manage`) with SUPER_ADMIN bypass and fail-closed behavior, plus shop-floor denial copy and per-key required-role labels.
- **Backend enforcement**: `requireFeaturePermission(key)` wrapper returns `403 { code: 'PERMISSION_DENIED', permission, message }`; every denial writes a hash-chained AuditLog row and a SecurityEvent, and feeds the privilege-abuse engine (5 denials / 10 min → 15-minute lockout + SUPER_ADMIN notifications).
- **Manager step-up authorization**: `POST /api/auth/manager-authorize` verifies a manager's email + password (shared bcrypt path with login), gates on manager-tier roles, records `MANAGER_AUTHORIZED` audit rows, and rate-limits to 3 failed attempts / 5 min per email+IP (`429 BRUTE_FORCE_PIN`).
- **Checkout gates**: discounts > 5% require the manager tier or a verified `managerOverride` credential object; discounts > 10% require Store Owner tier (never cashier-overridable); credit sales to customers owing more than KES 150,000 require `debt.approve.high_risk` or a verified override; every override writes a `MANAGER_OVERRIDE` audit row.
- **Products cost stripping**: list/detail/search endpoints return `costPrice: null` for roles without `inventory.view.cost`; product create/update/delete restricted to manager tier + INVENTORY_MANAGER.
- **Role management segregation**: creating users and changing roles are now Super Admin-only (`settings.roles.manage`).
- **Wire format**: `ApiRequestError` now carries the parsed error body so the frontend can branch on `code` / `permission` / `requiresManagerOverride` instead of matching message text.

## [2.12.1] Hotfix

### Fixed
- **POS "per NULL" unit bug**: products saved with a NULL `unitType` (e.g. Bamburi Cement) rendered a dangling "per " on product cards and empty/"null" unit badges in the cart, catalog, inventory and POS views. All unit render sites now share one null-safe `unitLabel()` helper (`src/lib/units.ts`), with a `UNIT` fallback. Ships with an owner-run backfill script, `scripts/fix-null-units.ts` (cement/Bamburi → `BAG`, other NULL units → `PIECE`).
- **Product card badge overlap**: the top-left badge stack (NEW / RENTAL / BUNDLE / BEST SELLER / ON SALE) is capped at 55% width with per-badge truncation, and the top-right LOW STOCK / OUT OF STOCK badge at 42% with truncation, so they can no longer collide on narrow cards (both stay z-20; NEW badge rule unchanged).
- **FAB overlap on POS**: the floating home button is now hidden while the POS tab is active (it covered the checkout area on short viewports) and remains on every other tab.
- **Category chips scrollbar**: removed the `scrollbar-none` override so the existing slim `scrollbar-thin` scrollbar (6px, rounded, muted thumb, transparent track) is always visible; scroll behavior and arrows unchanged.
- **VAT labels marked "(incl.)"**: POS cart totals, last-sale receipt, checkout dialog and the printable receipt now read "VAT (16% incl.)", an info-only clarification that prices are VAT-inclusive (KE default; VAT = Total × 0.16 / 1.16). No tax math was changed.
- **Stock counter unit**: product-card stock labels now carry a short unit suffix ("393 kg left", "12 bags left") via a shared `unitShort()` helper.
- **Duplicate nail images**: owner-run script `scripts/fix-duplicate-images.ts` clears `imageUrl` on duplicate nail product rows (one canonical image kept per size variant) so the grid falls back to category images.

### Notes
- Shift math fix, debt-crisis logic, low-stock counts, system-activity sanitization, alert dedup, and revenue-outlier handling shipped in v2.12.0 (PR #86).
