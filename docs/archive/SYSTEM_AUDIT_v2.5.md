# SYSTEM AUDIT v2.5 — Mbumah Hardware POS & ERP

**Audited version:** v2.4.1 (production) → this release v2.5.0
**Environment:** Production — https://mbumah-hardware-pos-one.vercel.app/
**Audit date:** 12 September 2026
**Auditor:** QA / engineering engagement (evidence-based: live API probes, browser sessions, code review)

---

## 1. Executive summary

The system is **functionally healthy and shipping at pace**: 5 releases in the
current line (v2.0.1 → v2.5.0), 427 automated tests green, CI/CD to Vercel
fully automated, multi-branch data isolated at the ORM layer, and every
previously reported user-facing incident (blank receipts, 3.8e+90 P&L,
18-digit salaries, broken debt payments, cross-tenant reads) root-caused and
fixed with regression tests.

This audit rounds out the requested reviews (cart UX, QR receipts, alert
popups, decimal-string concatenation) and lists the **next highest-value
work** in priority order.

---

## 2. Requested items — findings & what shipped in v2.5.0

### 2.1 Cart scrollbar (fits any window size) — ✅ shipped
**Plan that was followed:**
1. Size the cart against the real viewport — `100vh` → `100dvh` (dynamic viewport height), so browser chrome collapse/expand can't clip it.
2. Make the scrollbar **always discoverable** — new `.cart-scrollbar` style (10px amber thumb, faint persistent track, 32px minimum thumb) used by both the desktop cart panel and the mobile cart sheet.
3. **Auto-scroll new items into view** — each cart row carries `data-cart-item`; a `useEffect` on the "just added" id performs a smooth `scrollIntoView` so adding to a long, scrolled cart is never silently invisible.

### 2.2 Decimal-string concatenation — ✅ audited + fixed 4 endpoints
**The disease:** Prisma `Decimal` fields serialize as **JSON strings** through `Response.json` (decimal.js `toJSON`). Any client `+` arithmetic then string-concatenates — the class of bug behind the 3.8e+90 P&L, the 18-digit salaries and the blank-receipt-adjacent money bugs.

**Audit method:** live probe of production endpoints; flag every money-named field arriving as a `string`.

| Endpoint | Status before v2.5.0 | Fix |
|---|---|---|
| `/api/financial/journal` | ✓ numbers (fixed v2.3.0) | — |
| `/api/expenses` | ✓ numbers (fixed v2.3.0) | — |
| `/api/debt` | ✓ numbers (fixed v2.4.0) | — |
| `/api/customers/top` | ✓ numbers (fixed v2.4.0) | — |
| `/api/payroll/*`, `/api/employees` | ✓ numbers (fixed v2.4.0) | — |
| **`/api/transactions`** | ❌ strings (subtotal, taxAmount, discountAmount, totalAmount, cashTendered, changeDue + item lines) | ✅ serialized |
| **`/api/products`** | ❌ strings (pricePerUnit, costPrice, taxRate + bundle children) | ✅ serialized |
| **`/api/rentals`** | ❌ strings (charges, deposits, late fees + summary aggregates) | ✅ serialized |
| **`/api/gift-cards`** | ❌ strings (initialBalance, currentBalance) | ✅ serialized |

**Standing rule (documented in code):** convert at the API boundary; never trust the client to `Number()` anything.

### 2.3 QR code on receipts → colored digital receipt — ✅ shipped
1. New **public page `/r/<receiptNumber>`** — server-rendered, branded, colored, mobile-first receipt (items, VAT, totals, payment method, change, KRA eTIMS number where present). Public-safe fields only — **cost price / profit are never selected**. `noindex` metadata. The receipt number acts as an unguessable capability token; there is no enumeration endpoint.
2. `buildReceiptQrPayload()` now encodes `<origin>/r/<receiptNumber>` — scanning the QR with any phone camera opens the digital copy (legacy text payload retained as SSR fallback).
3. Receipt caption updated to "Scan for your digital receipt".

### 2.4 Alert popups (45 seconds, closeable) — ✅ shipped
1. `src/lib/alert-bus.ts` — app-wide alert store (`showAlert()` callable from any client module).
2. `AlertPopupHost` (mounted in `providers.tsx`) — popups stay on screen **45 seconds** with a draining countdown bar, **pause on hover**, and an always-available **Close (✕)** button; stack capped at 4, bottom-left.
3. Automatic triggers: the host polls the notifications API (60s) and pops **new** critical/warning notifications exactly once (localStorage memory) — out-of-stock, overdue rentals and large-debt events now surface without watching the bell menu.

### 2.5 System audit — see §3 and §4.

### 2.6 Version verification — ✅
- The latest GitHub release is **v2.4.1** (a security patch released *after* v2.4.0), and production was already running it — the system **was not behind**.
- This release train ships **v2.5.0** (MINOR bump: new user-facing features, backward-compatible, per the project's semantic-versioning rationale in the v2.3.0 release notes).

---

## 3. What is working well (evidence-based)

1. **Automated safety net** — 427 tests across financial math, debt helpers, compliance, payroll, WAC, tenant scoping and error normalisation; CI enforces Build + Test + Lint + Security & Schema on every PR.
2. **Defense-in-depth tenancy** (post v2.4.1/v2.5.0) — ORM always-narrow injection + route-level `assertStoreScope` (explicit 403) + security-feed logging of probes.
3. **Financial integrity** — every sale/payment posts a balanced journal (D = C enforced at 2dp), immutability guards block journal edits/deletes, and the health endpoint continuously reports ledger balance.
4. **Operational guardrails** — checkout idempotency keys, CSRF trio on mutations, Bearer-only sessions with DB-backed validation, audit trail on money actions.
5. **Release discipline** — tags + GitHub Releases published per version; both Vercel projects deploy on merge; production health reports the true version.

## 4. Recommended roadmap (priority order)

| # | Recommendation | Why | Effort |
|---|---|---|---|
| 1 | **Rotate all `password123` credentials** before real trading | Every populated account shares it; zero real security | 1h |
| 2 | **Block / notify on advisory Type Check** (issue #8, ~522 pre-existing strict errors) | It already masked real bugs (storeId omission); reduce count in bulk, then flip to blocking | phased |
| 3 | **VOID / REFUND endpoint for sales** | Reversing-entry model exists in the ledger; a blocked-sale correction path is missing — staff must ask admins to fix mistakes via DB | 2-3d |
| 4 | **Customer archive flag** (`isActive`) + filter | Customers have no DELETE; typo/duplicate entries accumulate forever | 0.5d |
| 5 | **Period-close workflow** (close P&L into Retained Earnings) | Balance Sheet currently shows Δ = net profit until someone books it | 1-2d |
| 6 | **Customer statements + debt reconciliation view** (R5) | Debt balances are audited but there is no per-customer statement to hand over | 1d |
| 7 | **Sentry / error reporting** (health check warns it's unconfigured) | Client `console.error` ring buffer exists; production crashes are invisible | 0.5d |
| 8 | **Sweep remaining bare `fetch()` calls** (R3) | Two incidents (TrialBalance, loyalty) came from unauthenticated bare fetches | 0.5d |
| 9 | **Rate-limit public endpoints** (`/r/<receipt>`, `/api/health`, openapi) | Cheap in-memory limiter; receipt page is DB-read-per-scan | 0.5d |
| 10 | **PWA offline receipts polish** (offline-indicator exists) | Hardware-store connectivity is patchy; extend offline queue UX | 2d |

## 5. Verification snapshot (v2.5.0 pre-merge)

- 427/427 tests · lint 0 errors · `tsc` 522 errors (= pre-existing baseline, none added)
- Production probes: all four re-serialized endpoints return **numbers**
- `/api/health` = healthy, version-accurate
- Branch codes (JUJ/THI/RUI/NAI/NAK), staff numbers, coded SKUs: live and verified

*Audit produced by the engineering engagement of 12 Sept 2026.*
