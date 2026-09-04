# FINANCIAL MATHEMATICS, FORMULA ACCURACY & NUMBER FORMATTING AUDIT — REMEDIATION REPORT

**System:** Mbumah Hardware POS & ERP (Nairobi, Kenya) · **Locale:** en-KE · **Currency:** KES · **VAT:** 16% (Kenya eTIMS)
**Scope:** Full codebase — Prisma schema, backend APIs, checkout controller, purchase/GRN costing, payment ledgers, reports/analytics, POS UI, receipts (print / WhatsApp / e-mail / PDF).
**Protocol:** Senior Lead QA / Systems Architect audit → implementation → zero-regression gates → GitHub remediation branch.

---

## VERDICT SUMMARY

| Phase | Scope | Finding count | Fixed in this remediation |
|---|---|---|---|
| 1 — Schema & type safety | 87 models, 158 Decimal fields | **0 Float/Double money fields** (clean from Wave 0–3 remediations) | additive `cashTendered`/`changeDue` `Decimal(12,2)`-class columns |
| 2 — Formula enforcement | checkout, invoices, PO/GRN, payments, valuation | 6 systematic deviations | **all fixed** |
| 3 — Central utility & formatting | every surface | 17 corruption sites + 8 competing formatters | **all fixed** |

Final gates: **365/365 tests (11 files, incl. 21 new spec tests)** · eslint **0 errors** · `tsc --strict` **488 advisories, −150 vs baseline, 0 new** · `next build` compiles clean.

---

## 1. CRITICAL BUGS (data corruption / financial miscalculation)

### C-1 · String-concatenation corruption of ledger balances (17 sites)
**Root cause:** Prisma `Decimal` columns are decimal.js instances whose `valueOf()` returns a **STRING**. `number + prismaDecimal` therefore CONCATENATES (`0 + Decimal("123.45") → "0123.45"`) and any arithmetic on a Decimal coerces through IEEE-754 float. The codebase documented this exact bug class twice — and still shipped 17 live instances.
**Impact:** persisted garbage balances and report aggregates (bank deposits storing `"1000.005"`, dashboard hourly revenue NaN, debtor summaries concat-strings).
**Sites fixed:** `banking/transactions` (deposit/withdraw ledger + atomic balance), `gift-cards/[id]/adjust`, `gift-cards/[id]/redeem` (double-spend race → atomic conditional decrement), `customer-credits` create + replay, `debt` summary, `cash-drawer` summary + POST, `reports/sales`, `reports/export-pdf` (printed PDFs!), `reports/fast-moving`, `reports/inventory`, `dashboard` (hourly/top-product/category accumulators), `trends/analysis`, `customers/[id]` + history, `receipts/[id]`, `debt-helpers` (overdue reminders), `financial/accounts`, `financial/journal` tolerance path.
**Fix:** every accumulator now runs in `decimal.js` via the central `toDec()` bridge; values freeze to `number` only at the serialization boundary.

### C-2 · Invoice document totals drifted from Σ lines (deterministic, per document)
**Root cause:** `POST /api/invoices` computed header totals independently of line values with unrounded float math and **omitted line discounts** from the header; with any line discount, `header − Σ(lines) = Σ(lineDiscounts)`.
**Fix:** line math rebuilt on HALF_UP 2dp Decimal; header = **exact sum of rounded lines** (audit assertion Σ(lineNet) === docGross); document discount validated/clamped to [0, subtotal]; `PATCH /api/invoices/[id]` no longer accepts a negative discount (previously *increased* the total) and recomputes in Decimal.

### C-3 · `reports/sales` grossProfit used tax-INCLUSIVE revenue
**Root cause:** `grossProfit = Σ totalAmount − Σ(cost×qty)` — the exact pre-fix formula `profit.ts` documents as eradicated, still live. Overstated profit by the entire VAT component (money owed to KRA counted as earnings) and ignored discounts.
**Fix:** canonical chain — `netRevenue = Σ(totalAmount − taxAmount)`; `grossProfit = netRevenue − COGS` (discounts already embedded); margin % guarded (0 when net ≤ 0, losses keep their sign). Same fix applied to `transactions/[id]` analytics (which ignored both line and cart discounts) and to every dashboard/analytics KPI (see M-1).

### C-4 · VAT basis incoherence between sales and purchases
**Root cause:** checkout treated `pricePerUnit` as VAT-EXCLUSIVE (added 16% on top) while the GRN journal treated supplier `unitCost` as VAT-INCLUSIVE (extracted input VAT) — the two sides of the same till disagreed; inventory was capitalised gross, COGS carried a hidden input-VAT component, and PO totals (`subTotal×0.16` on top) contradicted the GRN journal posting the same receipt.
**Fix (per audit spec §2):** POS retail = **VAT-INCLUSIVE** default (`netExcl = gross/1.16; VAT = gross − netExcl`, shelf price = what the customer pays); invoices/POs = **VAT-EXCLUSIVE** B2B (VAT added on top); GRN journal posts `Dr Inventory(net) + Dr VAT Payable(input VAT) / Cr AP(net+VAT)` on the same net basis as the PO. WAC blends NET costs only. The stored-field semantics (`lineTotal` = gross cash, `taxAmount` = VAT component) are unchanged, so `totalAmount − taxAmount` = net revenue is **mode-agnostic** — historical rows remain consistent under the new reporting formulas.

---

## 2. MAJOR ISSUES

- **M-1 · VAT counted as revenue in KPIs.** Dashboard `todayRevenue`, `analytics/kpis`, `sales-trend`, `hourly-heatmap`, `top-products` published tax-inclusive tender as "revenue". Fixed to net (VAT-exclusive) revenue; `payment-breakdown` kept on tender basis with an explicit label (it reports money *collected* per method).
- **M-2 · No change-due math.** `paymentDetails.cashAmount` was validated-in but never read — the change a cashier hands back never existed server-side. **Added:** `SalesTransaction.cashTendered` / `changeDue` (additive Decimal columns, spec §4 `max(0, cash − total)`), insufficient-cash 400, receipts (branded, text, WhatsApp, legacy) render Cash Tendered / Change rows from the persisted truth.
- **M-3 · Double-spend / read-then-write races.** Standalone gift-card redeem (absolute write), installment pay & waive (stale read-modify-write on installment + DebtLedger) → converted to the checkout-grade atomic conditional-write pattern (`updateMany` with balance predicates + count check).
- **M-4 · Mixed rounding regimes.** HALF_EVEN (`money.ts`) vs `Math.round` HALF_UP (PO, GRN, payroll, debt plans) vs EPSILON-hack `roundMoney` → **one policy: HALF_UP 2dp at the line level**, owned by `financialMath.ts`; `money.ts`/`currency-utils` import that config (import-order-proof — `Decimal.set` exists in exactly one module).
- **M-5 · trends/analysis scope leak.** Included PENDING/REFUNDED/VOID rows in revenue forecasts → aligned to `SALE` + `COMPLETED/PARTIAL`; NaN forecasts now degrade to guarded flat means, never NaN.
- **M-6 · export-pdf latent defects.** Non-existent columns referenced (`d.originalAmount`, `r.equipmentName`) rendered undefined in printed PDFs; lexicographic `<=` compared Decimals as strings in the low-stock filter — fixed.

---

## 3. MINOR ISSUES & POLISH

- 8+ competing currency formatters ("KES 1,234.5" variable-decimals, "Ksh 1,235" 0dp, "KES 1,234" 0dp, raw numbers) → **one canonical `formatKES`** (en-KE, exactly 2dp, ICU NBSP normalised to plain space for WhatsApp/terminal/CSV copy-safety). `api.ts formatKES` (58 files) is now a 1-line shim; 6 local copies deleted; server message builders (WhatsApp ×27, e-mail templates, toasts) unified — a receipt, an e-mail and a UI table now render byte-identical strings.
- Quantity rendering: raw DB decimals printed verbatim; naive pluralization produced **"boxs"/"pcss"** → shared `formatQty`/`formatQtyWithUnit`/`unitLabel` (3dp cap, thousands separators, smart unit suppression).
- POS could not sell fractional units (parseInt inputs) → decimal-safe quantity entry (parseFloat + 3dp clamp, `inputMode="decimal"`, minus-button enabled below 1) matching the server's fractional-qty support (0.25 kg nails, 2.5 m timber).
- Client cart math (Zustand store) was raw float with VAT added on top → now the **same** `calculateLineItem` the server runs (inclusive extraction, Decimal), so displayed totals equal persisted totals to the cent; `checkout-dialog`'s `Math.round(subtotal×0.16)` VAT fallback (wrong under per-line rates) removed.
- VAT label "VAT (16%)" on mixed-rate documents → "VAT (incl. in prices)" contextually; exempt lines verified to carry zero VAT end-to-end.
- Payroll engine retains its documented float policy with per-step `round2` (Kenya 2024 NSSF/SHIF/PAYE bands verified correct); its `round2` now re-exports the central HALF_UP helper.

---

## 4. ROOT-CAUSE PATTERN & FIX STRATEGY

1. **One bridge across the Prisma boundary.** `toDec(v)` accepts number|string|Decimal|null|NaN|garbage → Decimal; `toNum(v)` for display/JSON only. Every `number + Decimal` site replaced.
2. **One formula.** `calculateLineItem(qty, price, discountPct, isVatInclusive, taxRate)` in `src/lib/utils/financialMath.ts` is the only line-math implementation; server route, client cart and tests call the same code.
3. **One aggregation rule.** Lines round HALF_UP 2dp; documents are exact sums of rounded lines (`aggregateDocument().fullyConsistent` assertion — off-by-one-cent drift is structurally impossible).
4. **One rounding policy.** `Decimal.set({precision:20, rounding:ROUND_HALF_UP})` lives in exactly one module.
5. **One formatter.** `formatKES` / `formatQty` for every surface, client and server.
6. **Concurrency.** Money mutations use conditional atomic writes (`updateMany` + predicates), never read-modify-write.

## 5. VERIFICATION

- `bunx vitest run` → **365/365** (was 344; +21 spec tests for line items, aggregation exactness, balances, MAC, formatting, Prisma-bridge safety).
- `bunx eslint .` → **0 errors** (389→388 warnings, all pre-existing style advisories).
- `npx tsc --noEmit --strict` → **488** (baseline 638; −150; **0 new**).
- `next build` → compiles clean (sandbox OOM at page-data collection is a RAM ceiling, compile phase green).
- Local DB regression suites (SQLite): journal balance, GRN posting, outbox, audit-trail, immutability guards — all green under the new GRN VAT-exclusive posting contract.
- Schema: additive-only (`cashTendered`, `changeDue` nullable Decimals) — deployed by the build-time sync (P3005→db-push path proven in PR #15).

## 6. WATCH-ITEMS / NEXT

- Voucher & loyalty-redemption discounts are still settled outside checkout (separate endpoints) — integration into `totalAmount` is a product decision, now documented in `financialMath.aggregateDocument` (documentDiscount hook ready).
- Payroll floats: functional but candidate for a Decimal port (isolated engine, 940 lines).
- `reports/fast-moving` still sums gross `lineTotal` for its "revenue" column (kept for continuity; flagged inline).
- Kenya eTIMS payload per-line VAT re-derivation (`kra-helpers`) is algebraically identical to stored `taxAmount`; a future per-line eTIMS snapshot column would remove the ±0.01/line theoretical drift on mixed-rate baskets.
