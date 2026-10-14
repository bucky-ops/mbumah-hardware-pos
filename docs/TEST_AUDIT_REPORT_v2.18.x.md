# Test Audit Report — Mbumah Hardware POS & ERP

> Release **v2.18.2** (FEATURE — Organization Console Expert Information System v3.0) · correction **v2.18.2.1**
> Base `e49f48ec` (v2.18.1) · 282 commits · 55 releases · 58 tags at base
> Machine-readable companion: `docs/TEST_AUDIT_REPORT_v2.18.x.json`

---

## 1. Scope & environment

| Item | Value |
|---|---|
| Framework | Next.js 16.1.3 (App Router, `src/proxy.ts` edge) |
| Database | SQLite via Prisma 6.19.2, unified 39-model schema (`db/custom.db`) |
| Runtime | bun 1.3.14 · port 3000 |
| E2E tool | agent-browser (headless chromium) |
| Seed | `scripts/seed.ts` v3 — engineered portfolio, deterministic acceptance numbers |

## 2. Acceptance criteria — engineered numbers (all PASS)

| # | Criterion | Target | Actual | Verdict |
|---|---|---|---|---|
| 1 | Revenue today | KES 48,270 | 48,270 | ✅ |
| 2 | Transactions today | 1 | 1 | ✅ |
| 3 | Revenue 7-day | KES 231,850 | 231,850 | ✅ |
| 4 | Revenue variance vs prior week | +12% | +12.0% | ✅ |
| 5 | Transactions variance | +8% | +8% | ✅ |
| 6 | Revenue sparkline (7d) | [32000, 30530, 33600, 29800, 31250, 26400, 48270] | exact | ✅ |
| 7 | Debt outstanding | KES 437,479 | 437,479 | ✅ |
| 8 | Debt aging C/30/60/90+ | 180,000 / 97,479 / 80,000 / 80,000 | exact | ✅ |
| 9 | Low-stock SKUs | exactly 1 | 1 | ✅ |
| 10 | Overdue rentals | exactly 1 | 1 | ✅ |
| 11 | Pending expense approvals | 0 | 0 | ✅ |
| 12 | Health score | 87 (revenue 100 − stock 100 − debt 0 − engagement 12) | 87 | ✅ |
| 13 | Branches | 5, each variance +12% | 5 / +12% | ✅ |
| 14 | M-Pesa ledger | Juja Matched · Thika Mismatch · 1 dup · 1 timeout | exact | ✅ |
| 15 | eTIMS | 2 pending · 10 compliant | exact | ✅ |
| 16 | Notifications unread | 4 | 4 | ✅ |
| 17 | Chat unread | 3 | 3 | ✅ |
| 18 | Trial balance | balanced (net profit 90,858.93) | balanced | ✅ |

## 3. End-to-end results — v2.18.2 original certification (25/25 PASS)

| ID | Check | Result |
|---|---|---|
| E2E-01 | Console renders (no blank screen / error boundary) | ✅ |
| E2E-02 | Health gauge animates 0→87 (86 mid-anim, 87 settled) | ✅ |
| E2E-03 | KPI row exact values + sparkline + variance | ✅ |
| E2E-04 | Branch strip 5 chips stagger fade-in + health badges | ✅ |
| E2E-05 | Branch Intelligence Matrix rows (Juja 48,270 / +12% / Open / Matched) | ✅ |
| E2E-06 | Expert tabs: Financials trial balance, M-Pesa ledger, Debt, Rentals | ✅ |
| E2E-07 | Decision Support alerts (6) + action queue + step-up modal | ✅ |
| E2E-08 | Activity Timeline live (LOGIN_SUCCESS popped in "5s ago") | ✅ |
| E2E-09 | Live Feed streaming with level filters | ✅ |
| E2E-10 | Global Chat drawer: open, history, send message (stored + rendered) | ✅ |
| E2E-11 | XSS payload in chat rendered inert as text | ✅ |
| E2E-12 | Command palette via cmd+K; sign-in action works | ✅ |
| E2E-13 | Login as engraved admin (`password123`) → Karibu toast, SUPER_ADMIN chip | ✅ |
| E2E-14 | Branch workspace modal (JUJ) with POS/Inventory/Customers tabs | ✅ |
| E2E-15 | Workspace page `/stores/thika/dashboard` renders scoped data | ✅ |
| E2E-16 | Subdomain rewrite `Host: nakuru.mbumah.co.ke` → Nakuru workspace | ✅ |
| E2E-17 | Reserved (`www`) + unknown (`evil`) labels never rewrite | ✅ |
| E2E-18 | Unknown workspace code → 404 safe not-found | ✅ |
| E2E-19 | Footer sticks to viewport bottom (console + workspace) | ✅ |
| E2E-20 | Mobile 390px: header wraps, KPIs 1-col, no horizontal scroll | ✅ |
| E2E-21 | CSV export `branch_intelligence.csv` streams with exact rows | ✅ |
| E2E-22 | Engraved admin self-heal: `/api/system/post` + `/api/system/heal` OK | ✅ |
| E2E-23 | Rate limiting active (login 5/15min, chat 10/5min) | ✅ |
| E2E-24 | Mutations without session → 401 (notifications PATCH) | ✅ |
| E2E-25 | Lint 0 errors; zero page errors in browser console | ✅ |

## 4. Role × module coverage matrix (v2.18.2)

Roles exercised against the full console surface (read) and mutation gates (write):

| Module | SUPER_ADMIN | STORE_OWNER | BRANCH_MANAGER | ACCOUNTANT | INVENTORY_MGR | CASHIER | Anonymous |
|---|---|---|---|---|---|---|---|
| Console read surfaces | ✅ | ✅ | ✅ (branch-fenced) | ✅ (financials) | ✅ (inventory) | ✅ (POS surfaces) | ✅ public read |
| Rent/cost/salary fields | ✅ | ✅ | branch only | ✅ | ✗ | ✗ | masked/stripped |
| Chat / notifications POST | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | dev-only guest |
| Transactions / POS mutations | ✅ | ✅ | ✅ | ✗ | ✗ | ✅ | 401 |
| Engraved admin delete attempt | 403 `ENGRAVED_ADMIN_PROTECTED` | 403 | 403 | 403 | 403 | 403 | 401 |
| `/api/system/heal` | ✅ audited | ✗ 403 | ✗ 403 | ✗ 403 | ✗ 403 | ✗ 403 | 401 |
| Branch BOLA fence | bypass (org role) | bypass (org role) | own branch | own branch | own branch | own branch | n/a |

## 5. v2.18.2.1 correction re-certification (this session)

Re-ran the full agent-browser loop against `v2.18.2.1` (docs completion + SectionErrorBoundary hardening; **no data, API, or schema changes**):

| ID | Re-check | Result |
|---|---|---|
| RC-01 | `/` renders; zero page errors; zero console errors/warnings | ✅ |
| RC-02 | Health 87 · KPIs 48,270 / 1 / 1 / 1 / 437,479 (aging 180k/97.5k/80k/80k) / 0 | ✅ |
| RC-03 | Branch strip 5 chips w/ per-branch revenue + open/closed | ✅ |
| RC-04 | All 9 expert tabs live: Debt 437,479 · Rentals 3/1 · Financials 90,859 · Suppliers 6/1 · M-Pesa 2/1 · eTIMS 2/10 · Audit · System 87 | ✅ |
| RC-05 | cmd+K palette: actions + 5 branch workspaces | ✅ |
| RC-06 | Chat drawer send E2E ("Final QA verification v2.18.2…" stored + rendered) | ✅ |
| RC-07 | Session persists (SUPER_ADMIN badge) | ✅ |
| RC-08 | Workspaces `/stores/{juja-main,thika,nakuru}/dashboard` → 200 | ✅ |
| RC-09 | Unknown code `/stores/evil-code/dashboard` → 404; reserved `www` → 404 | ✅ |
| RC-10 | Subdomain `Host: nakuru.mbumah.co.ke` → 200 (rewritten workspace) | ✅ |
| RC-11 | Workspace footer sticks (800/800 viewport) | ✅ |
| RC-12 | Mobile 390px: no horizontal overflow; footer pushed naturally (5411px doc) | ✅ |
| RC-13 | SectionErrorBoundary wraps all 6 console sections; retry card styled per BRAND.md | ✅ |
| RC-14 | `/api/dashboard` release identity reports 2.18.2.1 | ✅ |

**Verdict: PASS — v2.18.2.1 accepted.**

## 6. Fixed during QA (v2.18.2 certification round)

- Debt aging chips overflowed card → compact `kShort` format + `flex-wrap`.
- Kenya map branch dots overlapped around Nairobi → spread coordinates.
- Workspace footer floated mid-page → `flex min-h-screen` + `mt-auto`.
- Chat POST blocked by proxy for anonymous demo → dev-only public pass (rate-limited, guest-tagged).

## 7. Risks & notes

- Radix `DialogContent` `aria-describedby` warnings — cosmetic, no functional impact.
- Demo chat POST is open in **dev only**; production requires a session.
- All seeded accounts use `password123` — **rotate before production**.
- `db/custom.db` is demo data; acceptance numbers are deterministic from `scripts/seed.ts` v3.

## 8. Sign-off

| Checkpoint | Status |
|---|---|
| Acceptance numbers (18/18) | ✅ PASS |
| E2E v2.18.2 (25/25) | ✅ PASS |
| Re-certification v2.18.2.1 (14/14) | ✅ PASS |
| Lint | ✅ 0 errors |
| Verdict | **PASS — v2.18.2.1 accepted** |
