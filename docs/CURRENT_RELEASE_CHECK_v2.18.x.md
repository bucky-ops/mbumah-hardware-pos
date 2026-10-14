# CURRENT RELEASE CHECK — v2.18.x (v2.18.2)

> Checked: 2026-10-14 · Base: e49f48ec8f1119d71cde324d4453f2cc8b927b0b (v2.18.1)
> Series stats at base: 282 commits · 55 releases · 58 tags · main
> This release: **v2.18.2 — FEATURE — Organization Console Expert Information System v3.0**

## 1. Release identity

| Item | Value |
|---|---|
| Version | 2.18.2 (package.json + VERSION) |
| Dev label | `v2.18.x-dev` (footer/header in development; `v2.18.2` in production) |
| Type | FEATURE (three-segment per version policy) |
| Single commit | `feat: expert information system organization console redesigned formal with official logo + functionality + style + liveliness + current release e49f48ec 282 commits 55 releases 58 tags` |
| Tag | `v2.18.2` |

## 2. Source-state checks performed

- `git log`/`git status` surveyed; worklog tail (Task 28 era, v2.18.0.3 + v2.18.1 shipped) absorbed.
- Docs read: CHANGELOG lineage, worklog baselines (lint 0 errors, typecheck advisory notes), `docs/branch-manager-users.md` credentials, canonical demo domain `mbumahhardware.co.ke` vs workspace root domain `mbumah.co.ke`.
- Sandbox reality check: `prisma/schema.prisma` was a bare template (User/Post) and `db/custom.db` empty → **full schema reconstructed** (POS core recovered byte-compatible from `db/stress.db` DDL; Credit Engine + 18 expert models added) and pushed; Prisma Client regenerated.
- Legacy `src/middleware.ts` + `src/proxy.ts` conflict detected by Next 16 → proxy.ts is canonical, middleware.ts removed (mirrored logic preserved in proxy).

## 3. What ships in v2.18.2 (summary)

- STEP 1 official logo: `public/logo.svg|png|webp`, `src/app/icon.svg`, `src/app/favicon.ico`, `docs/BRAND.md`.
- STEP 2 expert console (`/`): header (48px logo white tile, v2.18.x-dev, Connected pulse, Health 87/100 gauge 0→87/1.5s, branch selector, Live pulse, cmd+K, notifications 4, chat 3 unread, cart 7, SUPER_ADMIN, date, shortcuts, offline/queue), KPI command row (Revenue 48,270 +12% count-up + sparkline + 7d/30d/90d modal; Transactions 1 +8%; Low stock 1 orange pulse; Overdue 1 red pulse; Debt 437,479 red shake + aging; Pending 0), Branch Intelligence Matrix (sticky header, resizable columns, visibility, CSV/PDF), Kenya heatmap, 9 Domain Expert Modules, Decision Support + manager step-up, Recent Activity Timeline (live), Global Chat drawer, Live Feed, footer (version/Connected/Shortcuts/Changelog/Health/Branches/Last sync/Env).
- STEP 3 workspaces: `/stores/[storeCode]/dashboard` + `{code}.mbumah.co.ke` host-header allowlisting in `src/proxy.ts` (reserved labels blocked; unknown codes → 404).
- STEP 4 POS preserved: full legacy route set compiles against the unified schema; auth (scrypt), audit, rate limiting, BOLA, security headers intact; engraved admin self-healing (`/api/system/post`, `/api/system/heal`, `/api/auth/me`).
- New canonical APIs: dashboard/stores/chat/notifications/audit-logs/system-logs/system-config/system post+heal/categories/products.bundles/transactions(+id)/receipts(+id)/gift-cards(+redeem/adjust)/rentals(+return)/debt/stock-movements/purchase-orders/suppliers/expenses/reports sales+inventory+export.
- Env templates ×4, VERSION, CHANGELOG, package.json 2.18.2, seed v3 with exact demo numbers.

## 4. Acceptance numbers (live-verified via /api/dashboard)

| Metric | Target | Actual |
|---|---|---|
| Revenue today | 48,270 · 1 txn | 48,270 · 1 ✓ |
| 7-day revenue / variance | 231,850 · +12% | 231,850 · +12.0% ✓ |
| Transactions variance | +8% | +8% (27 vs 25) ✓ |
| Sparkline | 6-day ramp + today | [32000, 30530, 33600, 29800, 31250, 26400, 48270] ✓ |
| Debt total / aging | 437,479 · 180k/97,479/80k/80k | exact ✓ |
| Low stock / Overdue rentals / Pending | 1 / 1 / 0 | 1 / 1 / 0 ✓ |
| Health | 87/100 (Revenue 100 · Stock 100 · Debt 0 · Engagement 12) | 87/100 exact ✓ |
| Branches | 5 (juja-main thika ruiru nairobi-cbd nakuru) | 5, all +12% variance ✓ |
| M-Pesa | Juja Matched · Thika Mismatch · dup 1 · timeout 1 | exact ✓ |
| Notifications / chat unread | 4 / 3 | 4 / 3 ✓ |
| Trial balance | balanced | debit = credit ✓ |

## 5. Environment status

- `.env` — sandbox dev (SQLite `db/custom.db`).
- Templates: `.env.example`, `.env.lan.example`, `.env.local-offline.example`, `.env.online.example` — no secrets committed.
- Demo credentials (seeded): `admin@mbumahhardware.co.ke` / `password123` (engraved SUPER_ADMIN), `juja.manager@…` etc. / `password123`. Rotation recommended before production.
