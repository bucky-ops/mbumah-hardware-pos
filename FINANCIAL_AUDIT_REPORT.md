# Financial & DML Audit Report

**Repo:** bucky-ops/mbumah-hardware-pos · **PR:** #27 · **Auditor:** expert software audit (2026-09-10)
**Scope:** P&L incident (Ksh 3.8e+89), all financial calculation paths, system-wide DML (SELECT / INSERT / UPDATE / DELETE) consistency, follow-up on the earlier receipt-printing + employee CRUD audit (PR #24, already live).

---

## 1. Executive Summary (plain English)

The Profit & Loss card showed a **"Net Loss" of Ksh 3,800,130,011,202,040,000,000,000…** — a number with ~90 digits. The real books were never that wrong: the **database is fine**. The bug happened **in the browser**, when the front-end added money values that arrived as *text* instead of *numbers*. In JavaScript, `+` on text **glues the digits together** instead of adding:

```
0 + "3800"   →  "03800"        (string)
"03800" + "120"  →  "03800120" (digits glued — should be 3920)
```

Every sale posts a "Cost of Goods Sold" journal line. After ~20 sales the glued string was over 100 digits long. The browser then rounded that string into a giant number — the exact digits `380013001120204` from the incident screenshot appear inside the glued string. **We reproduced the bug bit-for-bit against live production data before fixing it.**

All issues found were fixed in PR #27 (this PR). Employee CRUD and the blank-receipt bug were already fixed and deployed in PR #24.

---

## 2. Root Causes of the Astronomical P&L (Tier 1 — fixed)

### Finding F1 — Money values traveled as strings (CRITICAL)
- **Where:** `GET /api/financial/journal` (and `GET /api/expenses`).
- **What:** Prisma `Decimal` fields passed straight into `Response.json()` are serialized by decimal.js' `toJSON()` as **strings** (`"3800"`), even though `src/lib/api.ts` documents them as `number`. Any client-side `+` then concatenated digits.
- **Fix:** both routes now convert every monetary field with an explicit `Number(...)` guard (entry totals, line debit/credit, tax fields, expense amounts, summary totals). The API now honors its documented contract.

### Finding F2 — Front-end reduced without numeric guards (CRITICAL)
- **Where:** `src/app/tabs/financial-tab.tsx` — P&L totals, revenue breakdown, COGS, operating-expense grouping, expense chart, trial-balance memo, journal totals, account-group balances, expenses total, journal-form validation.
- **What:** reduce chains like `s + line.debit` concatenated strings; the worst offender was `opExpCategories[name] = (acc || 0) + line.debit`, which glued every COGS line of the same account into one giant digit-string (→ `Math.round` → 1e+115 float).
- **Fix:** a module-scope `toNum()` guard (converts to finite number, else 0) is now applied to **every** monetary operand before arithmetic; the journal form validator now uses `parseFloat` explicitly; a sanity warning logs when expenses exceed revenue by >100×.

### Finding F3 — subType never returned, so every breakdown was dead (HIGH)
- **Where:** journal API `account: { select: … }` omitted `subType`; the seeded chart uses subTypes `OPERATING_REVENUE / OTHER_REVENUE / OPERATING_EXPENSE`, but the front-end filtered for `SALES / RENTAL / LATE_FEE / COGS`.
- **Effect:** Sales, Rental and Late Fee revenue **always showed 0.00**; everything landed in "Other Revenue"; COGS always 0.00 — exactly as seen in the incident screenshot.
- **Fix:** the API now returns `subType`; the front-end keys the breakdown on the **canonical account codes** (4000 Sales, 4100 Rental, 4200 Late Fee, 5000 COGS) with subType fallbacks for custom charts.

### Finding F4 — P&L and Balance Sheet sign conventions were inverted (HIGH)
- **Where:** `src/app/tabs/financial/ReportsPanel.tsx`.
- **What:** the trial balance reports `netBalance = debits − credits` for every account. Revenue accounts are **credit-normal**, so healthy revenue arrived **negative** → Total Revenue displayed negative and *Net Profit = revenue − expenses was always a loss*. The Balance Sheet had the same problem for liabilities and equity (the accounting equation could never balance).
- **Fix:** credit-normal accounts are flipped for display (`revenueAmount`, `creditNormalAmount`); expenses/assets stay as-is. CSV exports updated to match.

### Finding F5 — already-healthy areas verified, left alone
- `src/lib/money.ts` (Money primitive) and `src/lib/profit.ts` (canonical profit formulas) are correct — arbitrary-precision Decimal, banker's rounding, NaN guards.
- `/api/financial/trial-balance` already serializes with `.toNumber()` — correct.
- `/api/financial/revenue-trend` and `/api/reports/sales-summary` were already fixed in earlier PRs (they use `KES(...).toNumber()`).

---

## 3. Employee CRUD + Receipt Audit — status (PR #24, live)

Verified on `main` and confirmed deployed to both Vercel projects (commit `84459fc`):

- **Employees:** full SELECT/INSERT/UPDATE/DELETE — `/api/employees` + `/api/employees/[id]` (GET/PATCH/DELETE with soft-termination, Decimal-safe pay fields, per-store email uniqueness) and `/api/users` + `/api/users/[id]` (GET/PATCH/DELETE with role guards, no self-deactivation, last-active-SUPER_ADMIN protection, audit logging).
- **Receipt blank-print root cause:** the generic `request()` wrapper auto-unwrapped any payload containing an `items` array — the checkout response *is* a full transaction with items, so the receipt received the line-item array instead of the transaction (→ "Invalid Date", "No line items recorded", Ksh 0.00). Fixed by unwrapping only envelopes, never entities, plus a duplicate `#receipt-content` DOM id fix.

---

## 4. System-wide DML Consistency (28-module matrix spot check)

| Module | SELECT | INSERT | UPDATE | DELETE | Notes |
|---|---|---|---|---|---|
| users / employees | ✅ | ✅ | ✅ | ✅ | PR #24; role-guarded, audit-logged |
| products | ✅ | ✅ | ✅ | ✅ | soft-delete |
| **categories** | ✅ | ✅ | ❌ → ✅ | ❌ → ✅ | **was create-only — fixed in this PR** |
| customers | ✅ | ✅ | ✅ (PUT) | ⚠️ no DELETE | recommend `isActive` archive flag (follow-up) |
| gift-cards / vouchers | ✅ | ✅ | ✅ | ✅ | |
| debt plans | ✅ | ✅ | ✅ (approve/pay/pause/cancel) | ✅ | segregation of duties enforced |
| rentals / suppliers / purchase-orders / expenses | ✅ | ✅ | ✅ | ✅ | |
| invoices / delivery notes | ✅ | ✅ | ✅ (PUT) | ⚠️ immutable | correct for financial documents |
| **transactions** | ✅ | ✅ | ⚠️ none | ⚠️ none | immutable by design, but **no VOID/refund endpoint exists** — recommend a reversing-entry VOID (follow-up) |
| journal entries | ✅ | ✅ | ✅ | ✅ void | reversing-entry model — correct |
| shifts | ✅ | ✅ | ✅ (close via `/end`) | n/a | correct |

**Fixed in this PR:** categories got `/api/categories/[id]` (GET / PUT / DELETE) plus Manage-categories UI (inline edit + delete chips in Inventory). DELETE refuses (409) while products still reference the category, protecting referential integrity.

---

## 5. DML Best Practices for the Team (plain English)

1. **Numbers in, numbers out.** Convert money to a number (or `Money`) at the API boundary — never trust a JSON money field's type. One bad `+` can glue digits silently.
2. **One helper, everywhere.** Use `toNum()` (front-end) or `KES()/Money` (anywhere) for money math. No raw `s + value` on fields that might be strings.
3. **Sign conventions:** assets & expenses are debit-normal (debits add), liabilities / equity / revenue are credit-normal (credits add). Flip credit-normal accounts before display.
4. **Everything addable is editable and removable** (or explicitly marked immutable, like journal entries — with a reversing entry instead of a delete).
5. **Guard deletes with referential checks** — answer "N products still use this" instead of orphaning data.
6. **Write the audit trail** — every UPDATE/DELETE logs who changed what (`systemLog`).
7. **Contract tests matter:** the api.ts type said `number` while the API sent strings — types don't fix runtime. Verify with real payloads.

---

## 6. Verification

- `bun run lint`: **0 errors** (352 pre-existing warnings unchanged).
- `tsc --noEmit`: **0 new errors** vs `main` baseline (same 4 pre-existing in untouched paths).
- Pre-fix reproduction: live production journal data → glued string `010035000959568091440380013001120204…` → `1.0035e+115` (matches incident digits `380013001120204`).
- Post-fix simulation: all aggregates numeric; Sales/Rental/LateFee/COGS breakdowns resolve; P&L/Balance-Sheet signs correct.
- Post-deploy: browser + API verification on the live site (see PR comments / worklog).

## 7. Recommended Follow-ups (priority order)

1. **Transactions VOID endpoint** with reversing journal entries (audit-safe cancellations).
2. **Customers archive flag** (`isActive`) surfaced in UI (soft-delete instead of hard delete).
3. Align the seeded chart-of-accounts subTypes with a documented taxonomy (`SALES` vs `OPERATING_REVENUE`) — or drop subType filters in favor of canonical codes everywhere (this PR starts that).
4. Add automated regression tests that assert API money fields are JSON numbers, not strings (CI currently has no such check — that is how F1 survived).
5. Consider server-side P&L aggregation (single source of truth) instead of client-side reduce chains.
