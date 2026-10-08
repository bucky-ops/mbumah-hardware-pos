# Changelog

All notable changes to Mbumah Hardware POS are documented in this file (Keep a Changelog format; versions follow package.json).

## [2.13.0] — Feature release: RBAC & Audit

The v2.12.1 → v2.13.0 ladder completes the RBAC roadmap. This release's headline is already live since v2.12.5–v2.12.8; v2.13.0 adds the release polish and ships the full ladder together.

### The ladder (v2.12.1 → v2.12.8)
- **v2.12.2–v2.12.5 — RBAC core**: 16-key dotted feature-permission matrix (`src/lib/permissions.ts`) with a 5-role system (SUPER_ADMIN, STORE_OWNER, BRANCH_MANAGER, CASHIER, INVENTORY_MANAGER), backend `403 PERMISSION_DENIED` enforcement, role-filtered sidebar with lock affordances, LockedCard + access requests, cashier limited dashboard, manager step-up authorization at the counter (`POST /api/auth/manager-authorize`) for >5% discounts and high-risk debt (KES 150k+).
- **v2.12.6–v2.12.8 — Audit & abuse**: consolidated Audit Trail page with CSV export, discount-spam abuse detection (>3 denials/1h → SecurityEvent + manager notifications), privilege-abuse lockout (5 denials/10 min → 15-minute lock + Super Admin alerts), Security tab in the notification center, inventory price guard for INVENTORY_MANAGER.
- **v2.12.1 — POS hotfix**: per-unit fallback ("per " bug), product-card badge overlap, FAB overlap on checkout, category scrollbar, VAT "(incl.)" labels, stock counter units, duplicate-image cleanup script.

### Added (v2.13.0)
- **What's New dialog**: on first launch after an update, a "Karibu! What's New in Mbumah POS" modal summarizes the release (latest version highlighted, previous entries below) with a direct link to this changelog on GitHub. Shown once per version via `localStorage.mbt_seen_version` — SSR-safe, no nagging when storage is unavailable.
- **Footer status chip**: the Connected dot is now a live online indicator (mirrors `navigator.onLine` via online/offline events) — green pulsing dot when connected, red "Offline" when the connection drops. Hidden on xs screens.
- **Footer Shortcuts button**: opens the existing Keyboard Shortcuts help dialog (previously reachable only via the `?` shortcut).

### Deprecated
- **Versions prior to v2.13.0 are deprecated for support purposes; self-hosted stores should update via the in-app updater (v2.9.0+) or the Remote Access Kit flow.**

## [2.12.8] — Audit Trail page

### Added
- **Audit Trail view in the Security tab**: a second view ("Security Dashboard | Audit Trail" toggle, dashboard stays default) rendering a consolidated table of permission denials, manager overrides and manager authorizations — timestamp (with time-ago), user (name + truncated email), role, color-coded action badge (red denial / amber override / green authorized), resource + reason, result (DENIED / SUCCESS), branch, IP address.
- **Filters**: role select, user search (name/email), date range (from/to), "Denied only" switch, free search (permission/resource/reason), Prev/Next pagination with totals, and **Export CSV** (`mbumah-audit-trail-YYYYMMDD.csv`) honouring the active filters.
- Loading skeletons, error state and an explicit empty state ("No audit events match your filters"); long tables scroll inside a `scrollbar-thin` container.

## [2.12.7] — Abuse detection & security alerts

### Added
- **Discount-spam pattern alert**: a cashier (or any role) denied `pos.discount.gt5` more than 3 times in 1 hour now writes a `PRIVILEGE_ABUSE_PATTERN` SecurityEvent and notifies every active BRANCH_MANAGER and SUPER_ADMIN of the org (WARNING / SECURITY notification, e.g. "Grace Wanjiku (Cashier) attempted 4x discount >5% in 1h — 14:32"). In-memory sliding window per instance (same best-effort posture as the lockout engine); the SecurityEvent feed is the durable record.
- **Inventory price guard**: an INVENTORY_MANAGER whose product-price update deviates more than ±20% from the cost basis (or from the old price when cost is null) gets `403 MANAGER_APPROVAL_REQUIRED` + a `HIGH_RISK_ATTEMPT` security record. The same `managerOverride` credential object used at checkout lets a Branch Manager+ approve inline (writes a MANAGER_OVERRIDE audit row with `PRODUCT_PRICE_GUARD` context); 3 wrong approvals in 5 minutes trip the existing brute-force window.
- **Security tab in the Alerts panel**: role-gated (SUPER_ADMIN / STORE_OWNER / BRANCH_MANAGER) red-shield filter tab listing SECURITY-category notifications, with the 10 most recent abuse-set SecurityEvents (permission denials, high-risk attempts, brute force, lockouts, abuse patterns) merged below as read-only, red-tinted entries. The bell badge now reflects security alerts too — `/api/notifications` previously surfaced none of the durable SECURITY notification rows.

### Changed
- `/api/security/events` accepts BRANCH_MANAGER (store-scoped) and supports a comma-separated `eventTypes` filter.

## [2.12.6] — Audit logging consolidation

### Added
- **GET /api/admin/audit-trail** (SUPER_ADMIN / STORE_OWNER / BRANCH_MANAGER): one consolidated, paginated feed merging hash-chained AuditLog rows (`PERMISSION_DENIED`, `MANAGER_OVERRIDE`, `MANAGER_AUTHORIZED`) with SecurityEvent denial rows (`PERMISSION_DENIED` / `HIGH_RISK_ATTEMPT`) that have no AuditLog twin — every denial appears exactly once (nearest-timestamp dedup, HIGH_RISK kind carried from the twin). Branch-scoped for non-super-admin callers; `format=csv` streams the compliance export.

### Deferred
- **`pos.void` endpoint**: still does not exist (verified) — nothing was invented for it. The `requireFeaturePermission('pos.void')` gate, manager-override flow and Audit Trail visibility are ready the moment the endpoint lands. Void >2/shift manager approval ships with it.
- **Email digest option** for security notifications (daily/weekly summary) — scheduled for a later release.

## [2.12.5] — RBAC stable

Umbrella release of the v2.12.2 → v2.12.5 RBAC ladder: the role/permission system is now enforced end-to-end — backend 403s with typed denial payloads, role-filtered navigation with lock affordances, manager approval flows at the counter, and a dedicated limited view for cashiers. See the individual sections below for what shipped in each step.

### Highlights
- One permission model, two layers: the resource→action matrix (`hasPermission`) for CRUD checks plus the dotted feature keys (`hasFeaturePermission`) for business rules like discounts and dashboards.
- Manager approvals are now a first-class counter workflow: the cashier can complete a gated sale by collecting a manager's credentials, and every approval/denial is durably audited.
- Cashiers see an honest, useful workspace instead of broken analytics: own-activity KPIs, their own sales, and a clear "request access" path.

### Notes
- No database migrations required (User.role is a string column; the permission matrix is code-defined in `src/lib/permissions.ts`).

## [2.12.4] — Cashier Limited View

### Added
- **Limited dashboard for revenue-denied roles** (CASHIER, INVENTORY_MANAGER): the dashboard API early-returns a minimal payload — `limitedView: true`, today's sales, transaction count, average order value, low-stock counts and the caller's own last 10 sales (`mySales`) — and never computes or ships revenue trends, debt exposure, top products/customers, payment-method amounts or inventory value for these roles (restricted by construction).
- **Cashier dashboard layout**: greeting hero, 4 KPI cards only (Today's Sales, Transactions, Avg Order, Low Stock), a "My Sales" feed (receipt tail, payment-method badge, amount, time-ago), an info banner ("You're viewing a limited dashboard. Revenue, debt and analytics are hidden for your role.") and a 2-column grid of LockedCards for Revenue Trend, Debt Aging, Store Health and Financial Reports — each with a "Request Access" action.
- **High-risk debt warning in POS**: selecting a customer whose outstanding balance exceeds KES 150,000 shows a red inline warning in the customer selector — amounts only for roles holding `customers.view.debt`; cashiers see the generic "Credit approval required for this customer".

## [2.12.3] — RBAC core: matrix, sidebar filtering, locked cards

### Added
- **INVENTORY_MANAGER role** (frontend surfaces): catalog, inventory, suppliers, purchase orders and transfers now grant the role; role labels and tier order shared app-wide (`ROLE_LABELS`, `requiredRoleLabelFor`).
- **Sidebar lock affordances**: tabs a role cannot open are no longer silently hidden — they render as a grayed row with a 14px Lock icon, a "Requires {role}" tooltip (e.g. "Requires Branch Manager"), `aria-disabled` non-clickable behavior, and just the lock icon when the sidebar is collapsed. Accessible tabs keep the orange active-item style.
- **Cashier navigation narrowed to spec**: exactly Dashboard, POS, Customers, Transactions (Messaging/Chat moved out of the cashier's reach).
- **LockedCard component** (`src/components/rbac/locked-card.tsx`): premium locked-section card matching the dashboard design language — lock glyph in a muted circle, "Requires {role}" title, one-line explanation from the permission copy, and a debounced "Request Access" button.
- **Access-request flow** (`POST /api/access-requests`): records a `SecurityEvent(ACCESS_REQUEST, INFO)` with the permission key, requester email and role, and creates Notification rows for every active SUPER_ADMIN and BRANCH_MANAGER of the organization (requester excluded). Grants remain a Super Admin action.
- **Top-bar role badge**: muted role chip next to the top-bar actions (hidden on very small screens); SUPER_ADMIN renders "SA · System Administrator".
- **Feature-permission hook layer**: `usePermissions()` now exposes the `feature` group (`posSell`, `posDiscountGt5`, `dashboardRevenue`, `inventoryViewCost`, …) built on `hasFeaturePermission`, plus a plain `canFeature(role, key)` helper.

### Fixed
- **Cost hiding**: where the products API strips `costPrice` to null (roles without `inventory.view.cost`), the inventory table, detail dialog, stock-value summary and CSV export now render "•••" ("Cost hidden for your role") instead of 0 / blank / NaN margins.

## [2.12.2] — Security: backend permission middleware + 403 handling

### Added
- **Feature permission matrix** (`src/lib/permissions.ts`): 16 dotted keys (`pos.sell`, `pos.void`, `pos.discount.gt5`, `pos.discount.gt10`, `pos.view.all_sales`, `dashboard.view.revenue`, `dashboard.view.profit_margin`, `dashboard.view.debt_aging`, `inventory.edit`, `inventory.view.cost`, `customers.view.debt`, `customers.create`, `debt.approve.high_risk`, `financial.view`, `settings.roles.manage`) with SUPER_ADMIN bypass and fail-closed behavior, plus shop-floor denial copy and per-key required-role labels.
- **Backend enforcement**: `requireFeaturePermission(key)` wrapper returns `403 { code: 'PERMISSION_DENIED', permission, message }`; every denial writes a hash-chained AuditLog row and a SecurityEvent, and feeds the privilege-abuse engine (5 denials / 10 min → 15-minute lockout + SUPER_ADMIN notifications).
- **Manager step-up authorization**: `POST /api/auth/manager-authorize` verifies a manager's email + password (shared bcrypt path with login), gates on manager-tier roles, records `MANAGER_AUTHORIZED` audit rows, and rate-limits to 3 failed attempts / 5 min per email+IP (`429 BRUTE_FORCE_PIN`).
- **Checkout gates**: discounts > 5% require the manager tier or a verified `managerOverride` credential object; discounts > 10% require Store Owner tier (never cashier-overridable); credit sales to customers owing more than KES 150,000 require `debt.approve.high_risk` or a verified override; every override writes a `MANAGER_OVERRIDE` audit row.
- **Products cost stripping**: list/detail/search endpoints return `costPrice: null` for roles without `inventory.view.cost`; product create/update/delete restricted to manager tier + INVENTORY_MANAGER.
- **Role management segregation**: creating users and changing roles are now Super Admin-only (`settings.roles.manage`).
- **Wire format**: `ApiRequestError` now carries the parsed error body so the frontend can branch on `code` / `permission` / `requiresManagerOverride` instead of matching message text.

## [2.12.1] — hotfix

### Fixed
- **POS "per NULL" unit bug** — products saved with a NULL `unitType` (e.g. Bamburi Cement) rendered a dangling "per " on product cards and empty/"null" unit badges in the cart, catalog, inventory and POS views. All unit render sites now share one null-safe `unitLabel()` helper (`src/lib/units.ts`), with a `UNIT` fallback. Ships with an owner-run backfill script, `scripts/fix-null-units.ts` (cement/Bamburi → `BAG`, other NULL units → `PIECE`).
- **Product card badge overlap** — the top-left badge stack (NEW / RENTAL / BUNDLE / BEST SELLER / ON SALE) is capped at 55% width with per-badge truncation, and the top-right LOW STOCK / OUT OF STOCK badge at 42% with truncation, so they can no longer collide on narrow cards (both stay z-20; NEW badge rule unchanged).
- **FAB overlap on POS** — the floating home button is now hidden while the POS tab is active (it covered the checkout area on short viewports) and remains on every other tab.
- **Category chips scrollbar** — removed the `scrollbar-none` override so the existing slim `scrollbar-thin` scrollbar (6px, rounded, muted thumb, transparent track) is always visible; scroll behavior and arrows unchanged.
- **VAT labels marked "(incl.)"** — POS cart totals, last-sale receipt, checkout dialog and the printable receipt now read "VAT (16% incl.)" — an info-only clarification that prices are VAT-inclusive (KE default; VAT = Total × 0.16 / 1.16). No tax math was changed.
- **Stock counter unit** — product-card stock labels now carry a short unit suffix ("393 kg left", "12 bags left") via a shared `unitShort()` helper.
- **Duplicate nail images** — owner-run script `scripts/fix-duplicate-images.ts` clears `imageUrl` on duplicate nail product rows (one canonical image kept per size variant) so the grid falls back to category images.

### Notes
- Shift math fix, debt-crisis logic, low-stock counts, system-activity sanitization, alert dedup, and revenue-outlier handling shipped in v2.12.0 (PR #86).
