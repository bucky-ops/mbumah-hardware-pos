# System Audit, Testing & Debugging — Remediation Report

**Repository:** `bucky-ops/mbumah-hardware-pos` · **Branch:** `fix/audit-remediation-patches` · **Baseline:** `e343cbc` (post PR #12/#13 financial remediations)
**Scope:** All 8 functional modules (POS, Quotations, Inventory, Purchasing, Debtors, Cash Drawer, Analytics, RBAC/Security) + hardware/environment fault tolerance, audited code-level against the live codebase, then remediated on this branch.

---

## 1. Executive Summary

| Category | Count |
|---|---|
| Critical bugs found & **fixed** | 8 |
| Major issues found & **fixed** | 10 |
| Minor issues found & **fixed** | 5 |
| Checklist items verified **already passing** (PR #12/#13 wave) | 11 |
| Gaps **documented, not implemented** (need product/schema decisions) | 8 |

Every fix is surgical, commented with `// AUDIT FIX:`, and leaves unrelated behaviour untouched. The whole protocol was executed in waves with strict file ownership: parallel audit (2-a/2-b) → parallel implementation (3-a…3-f) → integration + full verification.

### Verification suite (all gates green)

| Gate | Baseline (`e343cbc`) | After remediation |
|---|---|---|
| `npm test` (vitest) | 344/344 ✅ | **344/344 ✅** |
| `npm run lint` | 0 errors / 386 warnings | **0 errors / 387 warnings** *(+1 pre-existing-class warning; new error introduced by wrap fixed in-integration)* |
| `npx tsc --noEmit --strict` | 659 pre-existing errors (advisory, issue #8) | **643** (−16; zero new errors introduced — verified per-file by each agent) |
| `npm run build` (`SKIP_ENV_VALIDATION=1`) | pass | **pass** (full route manifest emitted) |

---

## 2. Phase 1 — Module-by-Module Checklist Matrix

Legend: ✅ verified passing · 🔧 fixed in this patch · ⚠️ documented gap

### Module 1 — POS & Checkout Terminal
| Checklist item | Status | Evidence / fix |
|---|---|---|
| Fractional quantity math, no float drift | 🔧 | `quantity` is Decimal & `z.coerce.number().positive()`; but line totals used raw float. `calculateLineTotal` now routes through `KES()` HALF_EVEN 2dp and the checkout accumulators re-round (`src/lib/helpers.ts:111-148`, `transactions/route.ts:405-419`). Header total = Σ rounded lines; the ±0.01 JE backstop can no longer trip. |
| Cart manipulation, item/cart discounts, VAT recalibration | ✅ | Server-authoritative pricing from PR #12 re-verified: item discountPercent clamped 0-100, cart discountAmount capped ≤ total, tax from `product.taxRate` server-side (`transactions/route.ts:354-396`). |
| Multi-tender split ($ cash + $ mobile + $ store credit) | 🔧 | Split legs already recorded Payment rows, but (a) Σ legs was only implicitly enforced, (b) a DEBT leg bypassed credit limit **and** the debtor ledger, (c) the cash leg never hit the drawer. Fixed: explicit Σ==total 400 (`:421-448`); DEBT leg = in-tx conditional credit check + DebtLedger charge + balance increment + AR JE parity (`:949-1011`); split-cash drawer SALE row (`:713-754`). |
| Cart hold & retrieve, out-of-order resume | 🔧 | Hold existed (localStorage) but resume was a blind LIFO `pop()`. New `HeldCartsDialog` lists held carts (timestamp, count, total, customer) with per-row Resume/Delete (`src/components/pos/held-carts-dialog.tsx`, `pos-tab.tsx:741-838`). Stock is never reserved while held, so nothing to release (commented). |
| Offline queue syncs without duplicates | ✅ | PR #12 SYS-10 re-verified end-to-end: queue stamps `idempotencyKey`, sends `Authorization`, 409/`idempotentReplay` treated as success (`offline-sync.ts:171-279`, server pre-check + P2002 catch `transactions/route.ts:159-174,482-501`, `receiptNumber @unique`). |

### Module 2 — Quotation & Contractor Invoicing
| Checklist item | Status | Evidence / fix |
|---|---|---|
| Quote lifecycle; stock decrements only on conversion | 🔧 | Quotes are Invoice rows (`invoiceType QUOTATION/PROFORMA`); creation never touches stock ✅. But expiry was unenforced and quotes could be converted twice. Fixed server-side (see below); conversion payload compatibility preserved byte-for-byte. |
| Expiry enforcement | 🔧 | `POST /api/invoices` now 409s `QUOTE_EXPIRED` when the source quote's `dueDate` < start-of-today or status `EXPIRED`, plus lazy auto-expiry of stale quotes on GET/POST (`invoices/route.ts:213-294`). Client pre-flight guard + toast added (`invoices-tab.tsx:287-303,495-513`). |
| Delivery note hides cost & margins | ✅ | DN print payload contains only productName/quantity/unitType/notes (`delivery-notes-tab.tsx:401-409`); routes now also session-guarded (3-d). |

### Module 3 — Stock & Inventory Management
| Checklist item | Status | Evidence / fix |
|---|---|---|
| Multi-unit case↔unit breakdown | ⚠️ | No `conversionFactor`/`unitsPerCase` anywhere; `ProductVariant` is a parallel SKU, not a conversion. Requires schema + migration + UI — documented as a recommended feature, not safe to bolt on in a remediation pass. |
| Low-stock alerts → dashboard/reorder list | ✅ | `reorderLevel` + `products/low-stock` endpoint (deficit-sorted, on-order lookup) + dashboard widget re-verified (`products/low-stock/route.ts:215`). |
| Write-offs require admin reason + audit trail | 🔧 | Was: optional reason, actor taken from request **body**, no JE. Now: session-only identity, mandatory reason ≥3 chars for negatives, `DAMAGED/STOLEN/EXPIRED` classification persisted in movement notes + systemLog metadata, and a **balanced in-tx JE (Dr 5000 / Cr 1300)** at WAC cost (`stock-movements/route.ts:318-500`). |
| Race conditions: no negative stock | 🔧 | Full mutation-site census: 3 blind decrement sites remained. All 10 sites are now conditional-safe — see §3 CRIT-3/4/5. POS sale guard (PR #12 R1) re-verified. |

### Module 4 — Purchasing & Suppliers
| Checklist item | Status | Evidence / fix |
|---|---|---|
| PO → partial GRN → open quantity preserved | ✅ | PR #12 wave re-verified: per-receipt CAS on PO item qty, derived status machine, receipt-guarded delete/cancel, atomic WAC blend + `recordGoodsReceiptEntry` (Dr Inventory+VAT / Cr AP) in-tx (`purchase-orders/[id]/route.ts:249-280`). |
| COGS via Moving Average Cost | ✅ | Atomic in-tx WAC blend re-verified (`wac.test.ts` 14/14). |

### Module 5 — Customer & Debtor Management
| Checklist item | Status | Evidence / fix |
|---|---|---|
| Credit limit breach blocked | 🔧 | Pure-DEBT check existed but the SPLIT-DEBT leg bypassed it entirely and the in-tx increment was unconditional (TOCTOU). Now conditional inside the tx for both paths + friendly pre-check retained (§3 CRIT-1/2). Hard block per protocol ("blocked **or** manager approval"). |
| Partial settlement → ledger/aging/open credit | 🔧 | Verified passing (atomic claim, aging recalculation, balance decrement, JE, drawer CASH_IN in one tx) — plus fixed the audit row `ReferenceError` that silently skipped audit logging (`debt/route.ts:343-348`). |

### Module 6 — Cash Drawer & Shift Control
| Checklist item | Status | Evidence / fix |
|---|---|---|
| Float + sales + payouts → shortage flagged | 🔧 | `shift.totalSales` was **never written** — expected cash was always `startingCash`, making every `cashDifference` fiction. Shift end now derives expected cash from the `CashDrawerLog` signed-sum within the shift window and persists the full breakdown (`shifts/[id]/end/route.ts:45-160`). |
| X-read (non-resetting) vs Z-read (resetting+lock) | 🔧 | New `GET /api/shifts/[id]/xread` — pure inquiry, zero mutation. Z = shift end with snapshot breakdown. Drawer CLOSE/CASH_OUT now manager-or-above. Global "no sales without open shift" enforcement is a documented gap (§6). |

### Module 7 — Analytics & Financial Reporting
| Checklist item | Status | Evidence / fix |
|---|---|---|
| Revenue − COGS − Discounts = Net Profit consistency | 🔧 | Three conflicting formulas unified behind `src/lib/profit.ts` (VAT-exclusive, HALF_EVEN): `sales-summary`, `daily`, `revenue-trend` rewired; response keys preserved. Bonus: fixed a real corruption bug in `revenue-trend` (`0 + Decimal` string-concatenation into `byMethod` JSON). Profit/margin fields redacted for below-manager callers (`sales-summary`, `daily`, `transactions/[id]`, `receipts/[id]`). |
| VAT ledger: exempt = 0 tax; inclusive/exclusive toggle | 🔧/⚠️ | Exempt items yield 0 tax (per-line `taxRate`) ✅. `tax/filings` no longer trusts client-declared totals — server recompute is authoritative with an additive `discrepancy` block (`tax/filings/route.ts`). A platform-wide inclusive/exclusive pricing toggle remains a documented gap (KRA eTIMS assumes tax-inclusive while POS math is tax-exclusive — needs a KRA-aligned product decision). |

### Module 8 — User Management, RBAC & Security
| Checklist item | Status | Evidence / fix |
|---|---|---|
| Cashier denied: price edit / profit / invoice delete / user admin | 🔧 | `PERMISSION_MATRIX` was defined but enforced **nowhere** server-side; ~34 route files had no in-file guard beyond proxy Bearer-presence. `auth.ts` now supports `roles` on `withSessionAuth`/`requireStoreAccess`, plus `assertPermission`/`hasPermissionOr403`; 33 route files wrapped per the matrix (products PUT/DELETE → manager+; users SoD from PR #12; reports exports → manager+; whatsapp → manager+; stores/branches writes → owner+; invoices have no DELETE by design — immutability). Cashier customer intake intentionally kept open (core POS walk-in flow) — commented. |
| SQL injection | ✅ | All 10 raw usages re-verified parameterized (tagged templates or `?/$1` placeholders + fixed table allowlist in `sequence.ts`). |
| XSS | ✅ | Single sink = shadcn `ChartStyle` CSS vars from developer-defined config (not user input). No `eval`/`new Function`/`javascript:` hrefs. |

---

## 3. Detailed Findings — Root Cause & Fix Strategy

### Critical (data corruption, financial miscalculation, security bypass)

| ID | Finding | Root cause | Fix (file:line after) |
|---|---|---|---|
| CRIT-1 | **Split-DEBT tender bypassed credit limit AND debtor ledger** — a COMPLETED Payment was recorded with no DebtLedger row, no balance increment, no AR treatment | The split-tender loop treated every leg as settled tender; only the pure-DEBT path had ledger logic | DEBT added to split enum (+ customerId required via `superRefine`); per-leg in-tx conditional credit check + DebtLedger charge + increment + JE parity — `validations.ts:71-99`, `transactions/route.ts:642-648, 949-1011, 1071-1078` |
| CRIT-2 | **Credit-limit TOCTOU** — pre-tx check + unconditional `increment` let concurrent checkouts overspend | Read-then-write on customer balance | Conditional `updateMany({ where: { id, currentDebtBalance: { lte: limit − charge } } })`; count 0 → `CreditLimitExceededError` → 400 + `CREDIT_LIMIT_EXCEEDED` log — `transactions/route.ts:811-839, 990-1009, 44-49` |
| CRIT-3 | **Blind stock decrement in manual movements** — pre-check outside tx, blind decrement → negative stock under concurrent POS sales | TOCTOU | Conditional `updateMany gte abs(qty)` **first** in tx; 409 on count 0 (claim-before-create ordering documented) — `stock-movements/route.ts:376-384, 477-485` |
| CRIT-4 | **Blind decrement on transfer ship** — status claim stopped double-ship but not overship vs concurrent sales | Same class | Conditional `inventory.updateMany gte shippedQty`; failure throws → whole tx rolls back → 409 — `store-transfers/[id]/route.ts:190-197, 44-49` |
| CRIT-5 | **Blind decrement + body-borne actor on rental create** | Pre-check outside tx; identity from request body | Conditional `gte 1` in tx → 409; session-derived identity on movement, drawer, JE, logs — `rentals/route.ts:204-210, 243, 258, 285, 314-320` |
| CRIT-6 | **~34 route files with no server-side auth** (proxy validates Bearer *presence* only) — a CASHIER (or, pre-PR#12, a junk token) could reach product price edits, exports, eTIMS settings, whatsapp sends | Enforcement existed only at the proxy edge and client-side | `auth.ts` gains `roles` option + `assertPermission` + `hasPermissionOr403`; 33 files wrapped per `PERMISSION_MATRIX` (see §2 Module 8) — `lib/auth.ts`, e.g. `products/[id]/route.ts` |
| CRIT-7 | **Cost/profit data leak to unprivileged callers** — `receipts/[id]` returned per-line `costPrice`; `transactions/[id]` returned `grossProfit`/`profitMargin` | Response building had no role awareness | Fields stripped unless `SUPER_ADMIN/STORE_OWNER/BRANCH_MANAGER` — `transactions/[id]/route.ts:78-81`, `receipts/[id]/route.ts:166-196` |
| CRIT-8 | **Write-off governance failure** — actor from body, reason optional, no journal entry → untraceable shrinkage with unbalanced books | Route predates the financial-compliance wave | Session identity, mandatory reason, DAMAGED/STOLEN/EXPIRED classification, balanced Dr 5000 (COGS/loss) / Cr 1300 (Inventory) JE at WAC inside the tx — `stock-movements/route.ts:318-500` (account codes verified against `prisma/seed.ts:1000,1010`) |

### Major

| ID | Finding | Root cause | Fix |
|---|---|---|---|
| MAJ-1 | `cashDifference` on shift close was fiction (`totalSales` never written) | No writer existed; expected cash = startingCash | Expected cash from `CashDrawerLog` signed-sum within `[startedAt, now]`; breakdown persisted in `Shift.notes` marker + response — `shifts/[id]/end/route.ts:45-160` |
| MAJ-2 | No X/Z read separation | Only a store-global GET existed | New `shifts/[id]/xread/route.ts` (non-resetting, shift-scoped); end route documents Z semantics |
| MAJ-3 | Quotes convertible after expiry, and convertible repeatedly | No server validation; client re-POST trusted | 409 `QUOTE_EXPIRED`; atomic `CONVERTED` claim (`updateMany where status != CONVERTED`) + notes-fingerprint back-compat + lazy auto-expiry — `invoices/route.ts:213-360, 390-422` |
| MAJ-4 | Split-CASH leg never reached the cash drawer (drawer vs GL drift) | Drawer row written only for whole-sale CASH | Drawer SALE row for the cash portion via aggregate-then-insert — `transactions/route.ts:713-754` |
| MAJ-5 | Checkout money math raw float while `money.ts` (HALF_EVEN) existed unused on checkout paths | Legacy accumulation | `calculateLineTotal` → KES HALF_EVEN 2dp; route accumulators re-rounded — `lib/helpers.ts:111-148` |
| MAJ-6 | Drawer lost-update race ×5 (cash-drawer GET+POST, shift open, expenses, installment pay, rental deposit) | `findFirst(latest).balance` snapshot under concurrency | All converted to `aggregate({_sum: amount})` — incl. `rentals/route.ts:247-256` (integration) |
| MAJ-7 | `PERMISSION_MATRIX` dead server-side | Only client `use-permissions` consumed it | `roles` gates + `assertPermission` exported and applied (33 files) — `lib/auth.ts` |
| MAJ-8 | Σsplits == total only enforced implicitly (deep JE ±0.01 throw) | No input validation | Explicit per-leg >0 + Σ within 0.005 → clean 400 — `transactions/route.ts:421-448` |
| MAJ-9 | Three divergent profit formulas + `revenue-trend` `0 + Decimal` string-concat corruption | No canonical definition | `src/lib/profit.ts` (VAT-exclusive chain, HALF_EVEN, versioned) wired into sales-summary/daily/revenue-trend; keys preserved |
| MAJ-10 | Tax filings trusted client-declared totals | No server verification | Server aggregate over the period is authoritative; declared-vs-computed `discrepancy` block (flag, not fail); cross-store filings 403 — `tax/filings/route.ts` |

### Minor

| ID | Finding | Fix |
|---|---|---|
| MIN-1 | Debt settlement audit row never written (`newBalance` out of scope, empty catch) | Uses `result.balance`; catch logs — `debt/route.ts:343-348` |
| MIN-2 | Barcode scans could concatenate/lost during grid re-render | Enter-to-add exact barcode/SKU match + 200 ms debounced query — `pos-tab.tsx:79-86, 698-739, 1204-1211` |
| MIN-3 | Held carts resumable only LIFO | `HeldCartsDialog` list-and-pick with metadata (timestamp/count/total/customer), per-row Resume/Delete — `components/pos/held-carts-dialog.tsx` |
| MIN-4 | Expired-quote conversion allowed silently in UI | Client pre-flight + 409 toasts (server authoritative) — `invoices-tab.tsx:287-303, 495-513` |
| MIN-5 | New lint error from etims settings wrap | Unused arg renamed `_args` — `etims/settings/route.ts:9` |

---

## 4. Phase 2 — Hardware & Environment (code-level fault tolerance)

| Test | Result | Detail |
|---|---|---|
| Thermal receipt printer offline mid-print | ✅ **SAFE (verified)** | Printing is browser `window.print()` fired **after** sale commit (`pos-tab.tsx:403`, offline synthetic receipt `:341-403`); a print failure cannot corrupt transaction state. No ESC/POS SDK in the stack. |
| Barcode scanner speed (20 scans / 5 s) | 🔧 **FIXED** | Enter-terminated scan now resolves deterministically (exact barcode/SKU → cart → clear), 200 ms debounce prevents render thrash; nothing concatenates. Server-side barcode exact lookup for >100-product catalogs remains a documented enhancement. |
| Cash drawer RJ12 pulse on cash, not on account/quote | ⚠️ **NOT_IMPLEMENTED** | No hardware control layer exists (grep: no ESC/POS/drawer-kick/pulse code), so the trigger rule is moot until a printer/drawer SDK is integrated. Documented as a feature requirement. |

---

## 5. Documented Gaps (deliberately not remediated here)

1. **Multi-unit case↔unit conversion** — needs schema (`conversionFactor`), migration, receiving + POS UI. Recommended next feature.
2. **Cash drawer / ESC-POS hardware layer** — browser-print only today; RJ12 pulse requires a printer SDK/integration decision.
3. **"No sales without an open shift" hard gate** — Z-read snapshot implemented; a global POS lock risks breaking existing workflows and seed data; recommend a store-level setting.
4. **Tax-inclusive vs tax-exclusive pricing toggle** — eTIMS mapping assumes tax-inclusive prices while POS math is tax-exclusive; changing mapping without a KRA-aligned spec risks misfiling. Decision required.
5. **Low-stock auto-PO creation** — alerts + reorder list exist; auto-drafting POs is a workflow feature.
6. **Offline barcode exact-match against full server catalog** (client currently matches the loaded page, limit 100).
7. **`api.ts` error envelope drops the 409 `code` field** — server messages carry the semantics today.
8. **ACCOUNTANT excluded from report profit visibility** — literal matrix reading; revisit if accountants should see margins.

---

## 6. Cross-Reference — Prior Remediation Wave Re-Verified Holding

The following PR #12/#13 remediations were re-audited and confirmed intact: R1 POS oversell guard · R2/R3 gift-card double-spend protection (both paths) · SYS-10 offline idempotency · CSRF exact-host origin check · DB-backed login lockout · SUPER_ADMIN-only role assignment & self-approval blocks · journal void/period guards · audit-log hash chain · eTIMS mock hard-fail in production · parameterized raw SQL · crypto document numbers · 7-year audit retention with sanctioned purge.

---

## 7. Phase 4 — Git Protocol Record

- Branch: `fix/audit-remediation-patches` (from `main` @ `e343cbc`)
- Commits: conventional, grouped by subsystem (POS / inventory / shifts / quotes / security / analytics / POS UI / docs)
- Verification before push: 344/344 tests · 0 lint errors · build pass · tsc debt −16 (zero introduced)
- PR: `Audit & Debug Remediation Fixes` → `main`, squash-merge after required checks (CI Pass + Build) are green
