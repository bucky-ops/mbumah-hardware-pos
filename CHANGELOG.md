# Changelog — Mbumah Hardware POS & ERP

All notable changes. Format: [Version] — Type (FEATURE three-segment / CORRECTION four-segment hotfix).

## [2.18.2] — 2026-10-14 — FEATURE: Organization Console Expert Information System v3.0

### Added
- **Official logo system** (`docs/BRAND.md`): navy gear + orange house + silver trowel + rebar pillars; `public/logo.svg` (vector master), `logo.png` 512, `logo.webp` 200, `src/app/icon.svg` mark, `favicon.ico` 32; rendered 200px / 48x48 white `rounded-xl` on dark `#0f172a`.
- **Organization Console** (`src/app/page.tsx` + `src/components/org/*`): dark glassmorphism header (48px logo tile, v2.18.x-dev badge, Connected pulse, Health gauge 87/100 animating 0→87 in 1.5s, branch selector, Live pulse, cmd+K palette, notifications 4, Global chat 3 unread, Cart 7, SUPER_ADMIN chip, date, shortcuts, Online/Offline + Queue + Retry).
- **KPI Command Row**: Revenue 48,270 (emerald, orange left border, pulse dot, 7d sparkline, variance +12%, count-up 0→48,270 in 1s, 7d/30d/90d trend modal), Transactions 1 (+8%), Low stock 1 (orange pulse), Overdue 1 (red pulse), Debt 437,479 (red shake >400k, aging Current/30/60/90+), Pending 0.
- **Branch Intelligence Matrix**: sticky header, drag-resizable columns, column visibility, CSV (`branch_intelligence.csv`) + PDF (print) export, per-row actions (Open Workspace modal with POS/Inventory/Customers tabs, View Inventory/Debt, Start/Close Shift, View Reports), JUJ/THI/… chips hover scale 1.05.
- **Mini Kenya map heatmap** with drop-pulse branch dots colored by revenue.
- **9 Domain Expert Modules**: Inventory (stock health, stockout risk, 7d demand forecast, categories, reorder), Debt/Mkopo (aging, credit limits, available credit, plans, loyalty, reminders), Rentals (overdue, utilization, revenue, deposits/damage fees — hidden from public, authorized roles), Financials (double-entry journal, trial balance, P&L, VAT 16% / zero-rated / exempt, cash flow), Suppliers (performance scores, delayed flags, POs), M-Pesa (Daraja STK ledger: matched/mismatch/duplicate/timeout, retry, no secrets), eTIMS (pending/compliant, sequential numbering), Audit (live CREATE pop-in, 4h window, detail modal), System (health breakdown, DB queue, offline devices, env templates).
- **Decision Support Action Center**: severity alerts (low-stock block, overdue rental, debt >400k shake, M-Pesa mismatch, eTIMS pending, supplier delay, cash-flow watch) with action buttons; action queue; manager step-up modal (audit-logged).
- **Recent Activity Timeline**: live pop-in (15s poll), emerald 3s fade on new rows, filters (branch/role/action), detail modal (Timestamp/User/Role/Action/Resource/Result/Branch/IP).
- **Global Chat drawer** (org + per-branch scopes, 8s poll, rate-limited POST) and **Live Feed** (system logs, level filters, green 3s highlight).
- **API surface (canonical)**: `/api/dashboard` aggregate, `/api/stores`, `/api/chat`, `/api/notifications`, `/api/audit-logs`, `/api/system-logs`, `/api/system-config`, `/api/system/post`, `/api/system/heal`, `/api/categories`, `/api/products/bundles`, `/api/transactions(+[id])`, `/api/receipts(+[id])`, `/api/gift-cards(+redeem/adjust)`, `/api/rentals(+[id]/return)`, `/api/debt`, `/api/stock-movements`, `/api/purchase-orders`, `/api/suppliers`, `/api/expenses`, `/api/reports/sales|inventory|export`.
- **Multi-branch workspaces**: `src/app/stores/[storeCode]/dashboard` (branch-scoped tiles, team, workspace links) + host-header allowlisting in `src/proxy.ts` (`{code}.mbumah.co.ke` → rewrite; reserved labels blocked; localhost subdomains supported for dev).
- **Engraved admin self-healing** (`src/lib/engraved-admin.ts`): `admin@mbumahhardware.co.ke` SUPER_ADMIN `isEngraved`/`isSystem`, upsert on every seed, `/api/system/post` + `/api/system/heal` + fire-and-forget from `/api/auth/me`; DB/users deleted → auto-recreated at boot.
- **Seed v3** (`scripts/seed.ts`): engineered demo portfolio — revenue today exactly 48,270 (1 txn), 7d 231,850 (+12% vs prior 207,008.93; txns +8%), debt outstanding exactly 437,479 (aging 180,000/97,479/80,000/80,000), exactly 1 low-stock SKU, 1 overdue rental, 0 pending expenses, 5 branches, 696 SKUs, M-Pesa match/mismatch/dup/timeout set, balanced trial balance, chat/notifications/system-logs/audit fixtures.
- Env templates: `.env.example`, `.env.lan.example`, `.env.local-offline.example`, `.env.online.example`. Docs: `BRAND.md`, `ORGANIZATION_CONSOLE_EXPERT_DESIGN.md`, `CURRENT_RELEASE_CHECK_v2.18.x.md`, `TEST_AUDIT_REPORT_v2.18.x.md`.

### Changed
- `prisma/schema.prisma` rebuilt as the unified model set (POS core recovered byte-compatible from the stress DB + Credit Engine + 18 new expert-module models; `Branch` gains slug/subdomain/town/brandColor/sizeSqm; `User` gains isEngraved/isSystem/phone/lastLoginAt, nullable passwordHash; `MpesaTransaction` gains branchId; `Transaction` gains idempotencyKey @unique; soft deletes via Product.deletedAt).
- `src/proxy.ts` (Next 16 edge proxy): public READ allowlist for console demo surfaces (mutations stay authed), org-level roles (SUPER_ADMIN/STORE_OWNER) bypass BOLA branch fence, branch-subdomain rewrites, security headers retained; legacy `src/middleware.ts` removed (Next 16 accepts proxy.ts only).
- `src/lib/types.ts`: Role union widened (SUPER_ADMIN, STORE_OWNER, BRANCH_MANAGER, ACCOUNTANT, INVENTORY_MANAGER) with consistent RANK ordering.
- `/api/health` now reports release identity (version/label/commit/channel/org). `/api/auth/me` returns branch workspace hints (slug/subdomain/code) and fire-and-forget heals the engraved admin.

### Notes
- Console GET surfaces are public read (PII masked: phones ****, cost prices stripped from supplier/cashier views); every mutation requires a session and re-verifies role per-route.
- Demo credentials: `admin@mbumahhardware.co.ke` / `password123` (engraved), `juja.manager@mbumahhardware.co.ke` etc. / `password123`; login rate-limited 5/15min.

## [2.18.1] — 2026-10-08 — FEATURE: Branch manager user-store binding
- Every branch bound to exactly one BRANCH_MANAGER (seed upsert by email, never touching names/phones/passwords); managers land in their own workspace on login; cross-branch blocked server-side; org console shows "Open branch workspace" for all five branches; repair + verification scripts (`db:repair-branch-managers`, `verify:branch-manager-users`).

## [2.18.0.3] — 2026-10-08 — CORRECTION: workspace path fallback
- Path-mode workspaces on hosts without subdomain DNS; safe not-found for unknown store codes; calm copy for unassigned managers.

## [2.18.0] — 2026-10-01 — FEATURE: Multi-branch workspaces
- Subdomain workspaces on `*.mbumah.co.ke` (prod) with path fallback; one shared DB; SSO session cookie; host-header allowlisting; audit-logged authorization; branch selector on the org console.
