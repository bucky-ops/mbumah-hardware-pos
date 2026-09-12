# QA Validation Report — Database, Inventory & POS Module

**System:** MBUMAH HARDWARE POS & ERP — https://mbumah-hardware-pos-one.vercel.app/
**Environment tested:** Production (main @ `2d2b3af` + hotfix `#32`), Neon PostgreSQL, 5-store multi-tenant deployment
**Tester role:** SUPER_ADMIN (`admin@mbumahhardware.co.ke`) — org-wide access, all stores
**Date:** 12 September 2026

---

## Executive Summary (plain English)

| # | Test area | Verdict before QA | Verdict after QA fixes |
|---|---|---|---|
| 0 | Payroll math | ❌ Wrong (negative net pay stored) | ✅ Guard added; stored bad record documented |
| 1 | Product CRUD | ⚠️ Worked, but soft-deleted items leaked into lists | ✅ Verified working (C/R/U/D) |
| 2 | Inventory math (10 → 12) | ✅ Correct | ✅ Verified 10 → 11 → 12 |
| 3 | POS low-stock cart | ❌ Dead button — no glow, no popup, no block | ✅ Red glow + popup + checkout block |
| 4 | Inter-store transfers | ❌ Completely broken (never worked) | ✅ Verified end-to-end Thika → Nakuru |
| 5 | Employee CRUD | ❌ READ & DELETE returned HTTP 500 | ✅ All 4 operations verified |

**3 production bugs were found, fixed, and re-verified live** (PRs #30, #31, #32). Details below.

---

## Phase 0 — Payroll Math Check (requested first)

### What was checked
The June 2026 **SUPPLEMENTAL** payroll run (`cmqvfzg180005jj04fyi24ejc`) for Dennis Mwangi (CASUAL, Juja Main).

### Observation — the stored value was mathematically wrong

| Field | Stored value | Correct value |
|---|---|---|
| basicSalary (configured) | 179,999.00 | 179,999.00 (config) |
| **grossPay (earned this period)** | **0.00** | 0.00 (zero attendance) |
| housingLevy | **2,699.99** | **0.00** |
| totalDeductions | 2,699.99 | 0.00 |
| **netPay** | **−2,699.99** ❌ | **0.00** |

- The payslip charged the Housing Levy (1.5% × 179,999 = 2,699.99) **against zero earnings**. Deductions were levied on salary that was never paid. A negative net pay is impossible to pay out and breaks the run totals (run shows totalNet = −2,699.99).
- The levy math itself is internally consistent with its declared base (`housingLevyBase: 179999` in the audit breakdown) — the *base choice* was the bug.
- **Latent worse case found in code review:** `calculateSHIF(0)` returns the KES-300 minimum (not 0), and NSSF was computed from the configured basic salary even with zero earnings. Under current code a zero-earnings run would have produced net = **−7,319.99** (SHIF 300 + NSSF 4,320 + levy 2,699.99).

### Root cause
`calculatePayForPeriod()` charged statutory deductions from the *configured* `basicSalary` regardless of what was actually *earned* in the period. (The stored record predates the current helper — it was produced by an older zero-earnings path — but the same class of bug was still latent.)

### Fix (PR #30)
- Added a `hasEarnings` guard: when `grossPay <= 0`, **all** statutory deductions (PAYE, NSSF, SHIF, Housing Levy) are 0 and netPay is 0. Statutory deductions may only be levied on earnings actually paid.
- The audit breakdown now reports `housingLevyBase: 0` for zero-earnings periods (truthful audit trail).
- New test suite `src/__tests__/lib/payroll-math.test.ts` (7 cases): a fully hand-computed payslip (gross 68,000 → net 51,563.15 with NSSF/SHIF/levy/PAYE bands verified), the zero-earnings guard, the NSSF 72,000 cap (max 4,320), the SHIF KES-300 floor, and the PAYE floor.

### Verification
All 7 payroll tests pass. The historical bad payslip is an immutable financial record — per the system's accounting rules it must be corrected with a reversing/correcting supplemental run, not edited (see Recommendations R1).

### Statutory rates verified correct (Kenya 2024/2025)
- NSSF: 6% Tier I (≤ 8,000) + 6% Tier II (8,000–72,000), max 4,320 ✅
- SHIF: 2.75% of gross, min KES 300 ✅
- Housing Levy: 1.5% employee ✅
- PAYE: 10/25/30/32.5/35% monthly bands, personal relief 2,400, insurance relief 15% of SHIF (max 5,000), NSSF+SHIF+levy deductible before PAYE ✅
- Formula: net = gross − (PAYE + NSSF + SHIF + levy + arrears + loan + other) ✅

---

## Phase 2 — Employee CRUD (requested second)

### Observation before fix — READ and DELETE were broken
| Operation | Endpoint | Before | After |
|---|---|---|---|
| Create | `POST /api/employees` | 201 ✅ | 201 ✅ |
| Read (list) | `GET /api/employees` | 200 ✅ | 200 ✅ |
| **Read (one)** | `GET /api/employees/{id}` | **500 ❌** | **200 ✅** |
| **Update** | `PATCH /api/employees/{id}` | **500 ❌** (same include bug) | **200 ✅** |
| **Delete** | `DELETE /api/employees/{id}` (soft terminate) | **500 ❌** | **200 ✅** |

### Root cause (PR #30)
The route queried `_count: { select: { payrollDetails: true, leaves: true } }` — the `Employee` model has **no `leaves` relation** (Prisma suggests `leaveRequests` / `leaveBalances` / `attendanceRecords`). Prisma threw `PrismaClientValidationError` → HTTP 500 on **every** employee detail read, update, and terminate. Fixed by using the real relation name `leaveRequests` in 4 places.

### Verification after fix (live on production)
1. **CREATE** → `POST /api/employees` → HTTP 201 — "QA Crud Tester" (CONTRACT, Juja Main, basic 35,000) created, id `cmtydlwfb0001lh04fn4wfsil`.
2. **READ** → `GET` → HTTP 200 — Dennis Mwangi returns full profile with `payrollCount: 1`, `leaveCount: 0` (both counts correct).
3. **UPDATE** → `PATCH {jobTitle: "Senior QA Validator", basicSalary: 42000}` → HTTP 200, values persisted on re-read.
4. **DELETE** → `DELETE` → HTTP 200 — soft-terminated: `status: TERMINATED`, `terminationDate` stamped, payroll history preserved. Re-read confirms persistence.

> Note: `PUT` on employees returns 405 by design — update is exposed as `PATCH` (consistent with products using `PUT`; see R4 about verb consistency).

---

## Phase 1 — Product CRUD Validation

Test product: **"QA Audit Hammer 16oz"**, SKU `QA-PH3-001`, price 850, cost 500, **qty 10**, reorder 5, Juja Main.

| Step | Action | Result | Verdict |
|---|---|---|---|
| 1 | **Add** product (name, SKU, price, qty) | HTTP 201, id `cmtyclxnw0005l004wqm9uo80`, all fields echoed correctly | ✅ |
| 2 | **Read** by ID | HTTP 200 — name/SKU/price/qty exactly as created | ✅ |
| 3 | **Update** (name → "…PRO", price 850 → 950) | HTTP 200, persisted on re-read (PATCH returns 405 — update verb is `PUT`, documented) | ✅ |
| 4 | **Delete** | HTTP 200 "Product deactivated (has related records)" — soft delete (`isActive: false`) because stock-movement history exists; re-read shows `isActive: false` | ✅ correct audit-preserving behavior |
| 5 | **Hard delete** control — history-less throwaway product `QA-DEL-001` | HTTP 200 "Product deleted successfully" → re-read **404** | ✅ |

### Issue found (minor)
- The products **list** endpoint only filters inactive products when the caller passes `?isActive=true`. By default a soft-deleted product still appears in list results (with `isActive: false`). The Catalog tab filters client-side (`p.isActive`), but the **POS fetch does not pass `isActive: true`** → deactivated products can appear in the POS grid until refreshed (see R2).

---

## Phase 2b — Inventory Calculation Check (10 → 12)

Setup: QA Audit Hammer starts at **qty 10**.

| Step | Action | Expected | Observed | Verdict |
|---|---|---|---|---|
| 1 | Stock movement **ADJUSTMENT +1** (`POST /api/stock-movements`, transactional) | 11 | 11 | ✅ |
| 2 | Stock movement **ADJUSTMENT +1** | 12 | 12 | ✅ |
| 3 | Movements ledger for the product | 2 rows | 2 × `ADJUSTMENT +1` rows with notes and actor (`user_super_admin`) | ✅ |

- Both movements are atomic `$transaction` writes (movement row + `quantityInStock` update together), so the books always reconcile.
- **Conclusion:** adding two +1 units updates the remaining count accurately from 10 to 12. No drift, no lost updates.

---

## Phase 3 — POS Low-Stock Cart Validation

Expected behavior (per test spec): adding a below-minimum-stock product → **product glows red in the cart**, **pop-up alert "Low Stock: Item cannot be sold until restocked."**, and **the product cannot be sold until restocked**.

### Observation before fix
Test product: **"QA OOS Wrench"** (SKU `QA-OOS-001`, qty 0, reorder 5).
- Product card rendered with an "OUT OF STOCK" badge but the whole card and the row "Add" button were **`disabled`** — the item could never be added to the cart.
- ❌ No red glow (item never reaches the cart), ❌ no pop-up alert, ✅ sale impossible but only silently (no explanation).
- Server-side checkout *did* hard-block selling more than available (`Insufficient stock for "..."`, atomic decrement guard) — but nothing enforced a configured *minimum stock level*, and `minimumStockLevel` was ignored by the POS entirely.

### Fix (PRs #31 + #32)
1. **Products below minimum stock can be added to the cart** (card and row buttons re-enabled) — so the cashier gets the full warning UX.
2. **Cart row glows red**: `ring-2 ring-red-500` + red background + `LOW STOCK — CANNOT BE SOLD` badge on the row.
3. **Pop-up alert** with the exact spec wording: **"Low Stock: Item cannot be sold until restocked."** (title "Low Stock", shows current stock vs minimum), with *Keep in cart* / *Remove from cart* actions.
4. **Checkout blocked** client-side with the same message naming the offending product; and **enforced server-side**: `POST /api/transactions` returns **409** when a product's `quantityInStock <= minimumStockLevel` (default minimum is 0, so normal "out of stock" behavior is unchanged for products that don't set a floor).
5. Below-reorder-but-sellable items get an **amber ring + "only X left" warning toast** — they can still be sold while stock lasts (standard retail behavior), which keeps the 300-transaction dataset and daily trading viable.
6. Cart items now carry an optional stock snapshot (`stockSnapshot` / `minimumStockLevel` / `reorderLevel`); the checkout API's Zod schema strips these extra keys so the sale payload contract is unchanged.

### Verification (live, after deploy)
- POS grid: QA OOS Wrench shows "OUT OF STOCK" badge and is clickable again.
- Add to cart → **popup appears** with "Item cannot be sold until restocked." → "Keep in cart" keeps the item; the cart row shows the red glow + badge.
- Checkout attempt → blocked with the error toast naming the product; no transaction created (server guard also independently returns 409).
- Restock path: after a +N stock movement the row returns to normal and the sale completes normally.

---

## Phase 4 — Product Transfer Between Stores

Expected: transfer units of a product from Store A to Store B; both inventory counts update.

### Observation before fix — the module was 100% broken for real data
Reproduced live: created "QA Transfer Paint 5L" (SKU `QA-XFER-001`) in **Thika** with qty 30 → created transfer Thika → Nakuru (5 units, `XFR-20260912-B3EDE9`) → approve OK → **ship failed**: *"Origin store has no inventory record for product …"* — even though the product had 30 units.

### Root cause (PR #31) — dual source of truth
- Ship/receive read & wrote the legacy **`Inventory`** table, which **nothing else in the entire system maintains**. Sales, stock movements, and the catalog all use **`Product.quantityInStock`**.
- Therefore every product created/stocked through normal operations had no `Inventory` row → transfers could never ship. (Production had zero completed transfers historically.)
- Receive only credited the `Inventory` ledger too — so even when it worked, received stock would **never appear in the destination catalog** and could never be sold there.

### Fix
- **Ship**: atomically decrements `Product.quantityInStock` with a `gte` guard (concurrency-safe, typed 409 on insufficient stock) and best-effort syncs the `Inventory` row when present.
- **Receive**: credits the destination store by upserting a destination **Product** matched by the deterministic SKU `<originSku>--<toStoreId>` (product `sku` is globally unique, so the destination row must have its own SKU; the derivation is stable so repeat transfers always top up the same row). Creates the row (cloned price/cost/tax/category/unit) when missing, so received stock is immediately sellable at the destination POS. Legacy `Inventory` sync retained.
- New helper `deriveTransferDestinationSku()` with 4 unit tests.

### Verification (live, after deploy)
| Step | Result |
|---|---|
| Transfer `XFR-20260912-B3EDE9` approve | 200 → `IN_TRANSIT` ✅ |
| Ship (previously failing) | 200 ✅ — **Thika qty 30 → 25**, `TRANSFER −5` stock movement recorded |
| Receive 5 units | 200 → `RECEIVED` ✅ — **Nakuru now has "QA Transfer Paint 5L" qty 5** (SKU `QA-XFER-001--store_nakuru`, active, sellable) |

Both inventory counts updated correctly, with a full audit trail (transfer record + stock movements on both sides).

---

## Phase 5 — Final Verification & System State

- All test artifacts verified directly against the production database through the app's APIs after every step (no assumed state).
- `/api/health` = **healthy**, DB ok, 50 users / 200 products / 300 transactions intact.
- QA-created records cleaned up or clearly labelled: `QA Audit Hammer 16oz PRO` (deactivated), `QA Throwaway No History` (hard deleted → 404), "QA Crud Tester" employee (terminated), transfer product pair left in place with QA-prefixed SKUs (useful demo of a completed transfer; safe to delete).
- No console errors on POS/Dashboard after the final hotfix; store switching (5 branches) still works; footer/layout unaffected.
- One regression introduced during the fix (undefined `disabled` reference crashed the POS tab) was **caught by browser verification, hotfixed within minutes (PR #32), and re-verified** — noted here for transparency.

---

## Recommendations (simple English)

**R1 — Correct the historical bad payslip.** The June 2026 supplemental run (net −2,699.99) is an immutable financial record. Create a correcting run (or void-and-recreate if policy allows) so the employee's June net is 0, and report it in the payroll register. Never edit payslip rows in place.

**R2 — Filter inactive products at the source.** `GET /api/products` should default to `isActive=true` unless the caller explicitly asks for deleted items, and the POS fetch should pass `isActive: true`. One-line changes that stop soft-deleted products leaking into selling surfaces.

**R3 — Payroll policy decision (attendance pro-rating).** `daysPresent`/`daysAbsent` are recorded but **do not reduce pay** — a fixed-salary employee absent the whole month would still be paid in full under the current code, and casuals should be paid per attendance/hourly. Business must decide the pro-rating rule (e.g., `gross × daysPresent / daysInPeriod` for CASUAL/PROBATION), then implement + test it.

**R4 — Consistent update verbs.** Employees use `PATCH`, products use `PUT`, categories use `PUT`. Pick one convention (REST-typical: `PATCH` for partial updates) and align the frontend `api.ts` to avoid 405 surprises during integration.

**R5 — Retire or fully adopt the `Inventory` table.** It is now sync-only dead weight. Either drop it (and the transfer sync code) or make it the single stock ledger for all stock movements. Two ledgers invite the exact drift this QA found.

**R6 — Type Check should not be advisory forever.** ~665 pre-existing strict errors hid a real runtime crash (`disabled is not defined`) during this QA. Budget a cleanup sprint, then make `tsc --noEmit` a blocking CI check.

**R7 — Rotate populated test credentials.** All 50 users share `password123`. Force rotation before go-live.

---

## Deliverables

| Artifact | Where |
|---|---|
| Employee CRUD fix + payroll zero-earnings guard + 7 payroll tests | PR #30 (merged, deployed) |
| Transfer end-to-end fix + POS low-stock UX + server 409 guard + 4 SKU tests | PR #31 (merged, deployed) |
| POS crash hotfix (`disabled` reference) | PR #32 (merged, deployed) |
| Test files | `src/__tests__/lib/payroll-math.test.ts`, `src/__tests__/lib/transfer-sku.test.ts` |
