# HARDWARE FINANCIAL MODULE SYSTEM — COMPREHENSIVE LIFECYCLE AUDIT

**Role:** Principal Financial Systems Architect & Database Engineer (Supply-Chain Ledgering, Serverless Infrastructure)
**Date:** 2026-09-04 · **Repo:** `bucky-ops/mbumah-hardware-pos` @ `33c6563` (main) · **Prod DB:** Neon `pos-erp-crm` (`broad-snow-78900501`), branch `br-proud-lab-ai15r38h`, PG 18.6
**Stack:** Next.js 16 (App Router, 180 API routes) · Prisma 6 (~90 models) · Neon Serverless Postgres (pgbouncer pooled) · Vercel (iad1) · GitHub Actions · M-Pesa Daraja (STK + callback) · Kenya eTIMS/KRA · CSV-based ERP hand-off

**Method:** Every finding below was verified twice: (1) full source read with `file:line` evidence, and (2) where possible, **live verification against production Neon** (table counts, ledger sums, invariant checks) and the git history. One agent-reported finding (a claimed syntax error in `reports/export/route.ts`) was **disproven by byte-level inspection** and is deliberately excluded — this report contains no unverified claims.

---

## 0. EXECUTIVE SUMMARY

The system has **good bones** — an atomic checkout transaction, an ORM-level immutability guard on ledger tables, a sound Decimal `Money` primitive, and a real double-entry assertion on sale postings. But the financial module as deployed is **not a trustworthy system of record today**:

| # | Theme | Severity | One-line statement |
|---|-------|----------|--------------------|
| S1 | **Authentication is decorative** | **P0** | The edge proxy only checks that a `Bearer` header is *non-empty*; dozens of money-moving routes never call a session validator. `Authorization: Bearer x` creates sales, records debt payments, mints gift cards, and posts journal entries. |
| S2 | **The buy side never hits the books** | **P0** | Goods receipt posts zero journal entries; Accounts Payable (2000) is defined but never used; Inventory GL is credited by COGS but never debited by purchases → structurally negative inventory valuation. |
| S3 | **M-Pesa is broken end-to-end** | **P0** | The callback is unauthenticated (forgeable), the confirmation transaction throws on every success (FK violation on `userId: 'system'`), posted ledger lines are rewritten via `updateMany`, and the server-side STK push uses a relative `fetch` that can never resolve — every M-Pesa sale is permanently stuck `PENDING` with stock already gone. |
| S4 | **Concurrency = read-then-write everywhere** | **P0** | Zero `SELECT … FOR UPDATE`, zero `isolationLevel`, zero version columns, no DB CHECK constraints. Oversell, gift-card double-spend, debt double-payment, drawer drift, WAC corruption are all one concurrent request away. |
| S5 | **Store transfers destroy stock deterministically** | **P0** | The receive handler writes a field (`receivedBy`) that does not exist in the schema — it crashes *after* crediting destination stock, guaranteeing double-credit on every retry. The `inventory` table does not even exist in production. |
| S6 | **The audit trail is empty** | **P0** | `audit_logs` has **0 rows** in production; the hash-chain `verify()` is a mathematical no-op; the compliance dashboard self-attests 100%. |
| S7 | **eTIMS is a mock that lies green** | **P0** | `etims-service.ts` hardcodes `status: 'ISSUED'`, renders a fake QR, and `testConnection()` always returns success — non-compliant tax invoices will be displayed to customers. |
| S8 | **Live credential leak at HEAD** | **P0** | `scripts/set-vercel-env.sh:43-46` contains the production Neon password (rotation is staged but blocked — see §10 Wave 0). |
| S9 | **Reproducibility: migrations are fiction** | **P0** | The only migration is a 30-table baseline with `DOUBLE PRECISION` money columns; production is only correct because `prisma db push` was run by hand. A fresh provision (Neon PR branch, DR restore) yields a float-valued ledger with missing tables. |

**Live production evidence (queried 2026-09-04):**

| Signal | Value | Interpretation |
|---|---|---|
| Trial balance | Σdebit = Σcredit = **208,954.40** | Currently balanced — but on only **9 journal entries** |
| Journal coverage | 20 sales → **8** SALE journals; 14 expenses → **1** | **60% of sales and 93% of expenses are unposted** |
| Stock ledgers | `products` = 11,765 units; `warehouse_stocks` = **0 rows**; `inventory` table = **missing**; `stock_movements` = 24 rows (all SALE) | Two of three stock ledgers empty/absent; movement sum ≠ balance; no opening-balance movements |
| Serialized assets | `serial_numbers` = **0 rows**, zero code references | Serialized-asset subsystem is schema-only |
| Governance tables | `audit_logs` = 0, `financial_periods` = 0, `trial_balance_snapshots` = 0, `bank_accounts` = 0 | No audit trail, no period control, no bank rec in production |

Severity key: **P0** = exploitable/corrupting today · **P1** = high financial risk · **P2** = material weakness. Cross-cutting findings are labeled `SYS-n`; lifecycle findings `F<phase>-n`.

---

## PHASE 1 — PROCUREMENT & SUPPLIER PAYMENTS (P2P)

**Flow today:** `POST /api/purchase-orders` (DRAFT) → `PUT /api/purchase-orders/[id]` (status: CONFIRMED/APPROVED/CANCELLED) → `POST /api/purchase-orders/[id]` (receive: stock + WAC + movements) → supplier spend reports. **There is no supplier-invoice step, no three-way matching, and no AP sub-ledger.**

### Findings

**F1-1 · P0 — Goods receipt posts no ledger entries; AP is never used.**
`src/app/api/purchase-orders/[id]/route.ts:168-289` (receive transaction) writes only `product`, `warehouseStock`, `stockMovement`. Grep-verified: `recordGoodsReceiptEntry` does not exist; `ACCOUNTS_PAYABLE: '2000'` (`src/lib/account-helper.ts:11`) has **zero** posting call sites. Meanwhile `recordSaleJournalEntry` credits Inventory for COGS (`account-helper.ts:466-471`). Net effect: the Inventory GL account drifts **negative** as sales proceed, and the balance sheet is unreconstructable for the entire buy side.

```ts
// [id]/route.ts — inside db.$transaction: stock only, no tx.journalEntry.create
await tx.product.update({ where: { id: item.productId },
  data: { quantityInStock: { increment: recv.receivedQty }, costPrice: wac.newWac } });
await tx.warehouseStock.update(... { increment: recv.receivedQty } ...);
await tx.stockMovement.create({ data: { movementType: 'PURCHASE', ... } });
```

**Remediation (exact):** add to `account-helper.ts`:
```ts
export async function recordGoodsReceiptEntry(tx, { storeId, poId, totalCost, lineAccountTotals }) {
  const { inventoryAcc, apAcc } = await getAccountIds(storeId); // 1300 / 2000
  const entry = { totalDebit: totalCost, totalCredit: totalCost,
    lines: [ { accountId: inventoryAcc, debit: totalCost, credit: 0 },
             { accountId: apAcc,       debit: 0, credit: totalCost } ] };
  await createJournalEntry(tx, { referenceType: 'GOODS_RECEIPT', referenceId: poId, ...entry });
}
```
Call it inside the same receive `$transaction`, after stock writes, keyed by the PO's rounded `totalCost`. Later, when supplier invoices are introduced, split into GR/IR clearing (Dr Inventory / Cr GR-IR at receipt; Dr GR-IR / Cr AP at invoice) to enable three-way matching.

**F1-2 · P1 — GRN race: over-receipt and lost updates via stale snapshot.**
`[id]/route.ts:66-68` reads the PO **outside** the transaction; `:170-185` computes `newReceivedQty = Number(item.receivedQty) + recv.receivedQty` from that snapshot and writes it as an **absolute** value, while the stock side uses atomic `{ increment }`. Two concurrent GRNs both read `receivedQty=0`, both write `5`, but stock increments by 10. The over-receipt guard (`:178`) validates against stale data.

```ts
const existing = await db.purchaseOrder.findUnique({ where: { id }, include: { items: true } }); // outside tx
...
const newReceivedQty = Number(item.receivedQty) + recv.receivedQty;  // stale
if (newReceivedQty > Number(item.quantity)) { throw ... }            // stale guard
await tx.purchaseOrderItem.update({ data: { receivedQty: newReceivedQty } }); // absolute write
```

**Remediation:** re-read items inside the tx and use a guarded conditional update:
```ts
const ok = await tx.purchaseOrderItem.updateMany({
  where: { id: recv.itemId,
           receivedQty: item.receivedQty,                       // optimistic token
           quantity: { gte: { /* raw */ } } },
  data: { receivedQty: { increment: recv.receivedQty } } });
if (ok.count === 0) throw new APIError(409, 'Concurrent receipt detected — re-sync and retry');
```
(Prisma can't compare two columns in `where` — use `tx.$queryRaw` `UPDATE purchase_order_items SET "receivedQty"="receivedQty"+$1 WHERE id=$2 AND "receivedQty"+$1 <= quantity RETURNING id` and abort when 0 rows.)

**F1-3 · P1 — Segregation of duties absent; approval identities are client-supplied.**
`src/lib/auth.ts:205-268` — `requireStoreAccess` takes no `roles` option. `PUT [id]/route.ts:115-124` accepts `body.approvedById`; `:166` accepts `body.receivedById`; create accepts `body.createdById` (`route.ts:179`). One STORE_CLERK can create → approve → receive a PO and sign the audit trail as the owner. Contrast the correct pattern in `send-order/route.ts:174` (`session.userId`).

**Remediation:** derive every actor field from `session.userId`; wrap approve/receive/cancel in `requireAuth(['STORE_OWNER','BRANCH_MANAGER'])`, distinct from create; add a self-approval block (`approvedById !== createdById`).

**F1-4 · P1 — Status machine holes: phantom "RECEIVED", cancel-after-receipt, cascading deletes.**
`[id]/route.ts:94` permits `CONFIRMED → RECEIVED` via a plain status update with zero items received and no `receivedAt`. `CANCELLED` is allowed without checking `receivedQty` (`:121-124`), and the stale pre-tx status check (`:158`) lets cancel race an in-flight receive. Delete (`:308-316`) cascades items (`schema.prisma:909`) for any CANCELLED PO even if receipts already incremented stock; `StockMovement.referenceId` is a plain string with no FK (`schema.prisma:364`), so the receipts become dangling references.

**Remediation:** make status derived, not written: after each receipt recompute `status = f(receivedQty)`; reject `CANCELLED` when any `receivedQty > 0` (require a return-to-supplier flow instead); block delete when any item has `receivedQty > 0`; promote `referenceId` to a polymorphic relation or at least an indexed FK to `purchase_orders(id)`.

**F1-5 · P1 — Float money math and blanket 16% VAT on the PO path.**
`route.ts:153-166`: `totalCost = item.quantity * item.unitCost` (IEEE-754), `taxAmount = subTotal * (KENYA_VAT_RATE / 100)` with a hardcoded `KENYA_VAT_RATE = 16` applied to the whole header — zero-rated/exempt product classes are ignored (eTIMS exposure). `quantity`/`unitCost` are never validated (`NaN`, negative, fractional all flow through). The repo's own `Money` class (`src/lib/money.ts` — decimal.js, HALF_EVEN, largest-remainder allocation) is **unused here**. Production columns are `numeric` (verified via `information_schema`), so the schema is right and the *values* are float-rounded.

**Remediation:** validate `quantity > 0 && Number.isFinite`, `unitCost >= 0`; compute every line with `Money` (round HALF_EVEN at line level, derive header from rounded lines); move tax to per-line `TaxCategory/TaxRate` lookup (see Phase 9).

**F1-6 · P2 — PO number generation: cross-store collision guaranteed daily; double-submit 500s.**
`route.ts:141-147` counts **per-store** but `poNumber` is `@unique` **globally** (`schema.prisma:863`). Store B's first PO on any day collides with Store A's → unhandled P2002. Concurrent double-clicks both count N → same number.

**Remediation:** `@@unique([storeId, poNumber])`; allocate via a per-store daily counter row `SELECT … FOR UPDATE` (or Postgres sequence); accept an `Idempotency-Key` header and return the original response on replay.

**F1-7 · P2 — WAC recompute is last-write-wins.**
`[id]/route.ts:188-210` computes WAC from a fresh in-tx read but writes the **absolute** `costPrice`; `stock-movements/route.ts:264-294` reads the product **outside** the tx. Two concurrent receipts blend from the same base and one overwrites the other → silent COGS corruption on every subsequent sale. **Remediation:** single-statement SQL blend atomic with the increment (`UPDATE products SET "costPrice" = (("quantityInStock")*"costPrice" + $inc*$newCost)/("quantityInStock"+$inc), "quantityInStock" = "quantityInStock"+$inc WHERE id=$id`), or `SELECT … FOR UPDATE` the product row first.

**F1-8 · P2 — Manual `PURCHASE` movements bypass P2P entirely.**
`stock-movements/route.ts:202-218` allows STORE_OWNER/BRANCH_MANAGER to inject a `PURCHASE` movement with arbitrary unit cost, no PO/supplier reference, and bumps only `Product` (never `WarehouseStock`) — an un-auditable stock-value injection channel. **Remediation:** restrict manual types to `ADJUSTMENT`; require `referenceId` for `PURCHASE`; mirror to `WarehouseStock` + GL.

**F1-9 · P2 — Expenses editable after posting; no FK to the journal.**
`expenses/[id]/route.ts:44-83` updates `amount`/`category` on an ACTIVE expense whose JE was already posted (`expenses/route.ts:184-213`) with no reversing entry; `Expense.journalEntryId` is a bare `String?` with no `@relation` (`schema.prisma:928`). **Remediation:** make posted expenses immutable (void + recreate, mirroring the existing void flow) or post reversing+re-posting entries in one tx; add the relation.

**F1-10 · P2 — Per-item interactive transaction loops under `connection_limit=1`.**
The receive tx issues ~5 sequential queries per item with default `{ maxWait: 2s, timeout: 5s }` while `db.ts` mandates the pooled URL with `connection_limit=1&pgbouncer=true` — a 30-line PO ≈ 150 round-trips ≈ P2028 timeout risk, and concurrent requests head-of-line block on the single pooled connection. (The checkout path got this right: `{ timeout: 15000, maxWait: 10000 }` + pre-warmed account IDs, `transactions/route.ts:415-440`.) **Remediation:** batch (`updateMany`/`createMany`), pre-warm accounts, set explicit tx options, chunk long receipts.

---

## PHASE 2 — SERIALIZED ASSET LOGGING & BATCH TRACEABILITY

**Flow today: none.** This phase of the lifecycle exists only as schema.

**F2-1 · P1 — `SerialNumber` and `Batch` are dead code; zero rows in production.**
`prisma/schema.prisma:2033-2055` defines `SerialNumber` (`serial @unique`, `status IN_STOCK/SOLD/…`, `soldInTransactionId`), `:2060-2087` defines `Batch`. Grep across `src/`: **zero usages**. Live DB: `serial_numbers` = **0 rows**. The checkout path (`transactions/route.ts:504-539`) never consults serials. Consequences for a hardware ERP: no double-sell protection for warranted/high-value units (generators, machines), no warranty linkage, no recall traceability, no custody history.

**Remediation (exact lifecycle to implement):**
1. Sale intake: `items[].serials?: string[]` in `checkoutSchema`; server validates each serial `status='IN_STOCK' AND storeId=$storeId AND productId=$productId`.
2. Inside the checkout `$transaction`, for each serial: `tx.serialNumber.updateMany({ where: { serial, status: 'IN_STOCK' }, data: { status: 'SOLD', soldInTransactionId: txId, soldAt: now } })` — abort the sale if `count === 0` (this *is* the double-sell lock).
3. Receipt: create serials with `status='IN_STOCK'`, `receivedFromSupplierId`, inside the GRN tx.
4. Returns/rentals: transitions `SOLD→RETURNED→IN_STOCK` / `IN_STOCK→RESERVED→SOLD` with the same conditional-update pattern.
5. Backfill: hardware SKUs flagged `serialized: true` get serial capture mandatory at checkout.

**F2-2 · P2 — No FEFO/FIFO batch consumption; expiry never enforced.** `Batch` has `expiryDate`, but sales never decrement a batch. **Remediation:** for batch-tracked SKUs, decrement `Batch.quantity` (conditional `where quantity >= n`) oldest-expiry-first inside the sale tx; block checkout on expired batches.

**F2-3 · P1 — No custody audit for serialized assets.** Once F2-1 lands, every serial transition must write an `AuditLog` row (actor from session) in the same tx — see SYS-2/Phase 9.

---

## PHASE 3 — INVENTORY STATE MACHINE & MULTI-LEDGER INTEGRITY

**Structural fact (live-verified):** the same logical quantity lives in **three disconnected ledgers**, each written by different code paths:
- `Product.quantityInStock` — sales, adjustments, PO receive, rentals, batch (live: **11,765 units**)
- `WarehouseStock.quantity` — **only** PO receive, increment-only, **0 rows in production**
- `Inventory.quantityInStock` — **only** store-transfers, **table does not exist in production**

### Findings

**F3-1 · P0 — The ledgers have already diverged; no invariant exists.**
Live evidence: movement ledger has only 24 rows (all SALE, Σ −33 units) against 11,765 units of balance — seeded stock never produced opening movements, so `Σ movements = balance` can never hold. The eTIMS stock report (`etims/stock-report/route.ts:92-97`) derives `opening = closing − purchased + sold − adjusted` from this broken identity — a **KRA filing input that is fabricated**. Grep for `reconcil|drift|invariant`: nothing ties the ledgers together.

**Remediation (architectural):** declare `StockMovement` the **single authoritative ledger**; demote balances to projected caches. Add: (a) opening-balance movements for all current stock; (b) a nightly reconciliation job: `SELECT product_id, SUM(quantity) FROM stock_movements GROUP BY 1` vs balances → alert + quarantine on drift; (c) make the eTIMS stock report read the movement ledger only.

**F3-2 · P0 — Transfer receive crashes after mutating stock (nonexistent field) → deterministic double-credit.**
`store-transfers/[id]/route.ts:131-133` sets `updateData.receivedBy` — the `StoreTransfer` model has only `requestedBy`/`approvedBy` (`schema.prisma:2433-2434`; grep-verified). The receive loop first increments destination `Inventory` and writes TRANSFER movements (`:137-184`), **then** the final update throws `PrismaClientValidationError` → 500. Transfer stays `IN_TRANSIT`; the operator retries; stock re-credits every time. (And in production the `inventory` table doesn't exist at all — the first crash is P2021.)

```ts
updateData.status = 'RECEIVED';
updateData.receivedBy = body.receivedBy || null;   // field does not exist on the model
```

**Remediation:** remove `receivedBy` (or add the column via migration); make the status flip a **gate before any stock mutation**: `const claimed = await tx.storeTransfer.updateMany({ where: { id, status: 'IN_TRANSIT' }, data: { status: 'RECEIVED', receivedAt: now, receivedByUserId: session.userId } }); if (claimed.count === 0) return 409;` then perform stock writes — all inside one `$transaction`.

**F3-3 · P0 — Ship is repeatable and receive window is open; loops are not transactional.**
`[id]/route.ts:81-124`: `ship` leaves `status='IN_TRANSIT'` and never checks `shippedAt` — calling ship twice *sequentially* decrements origin twice (no race needed). Item loops run **without** `$transaction`; a missing `Inventory` row is silently skipped (`if (inventory)`, `:96`, `:153`) while the StockMovement is still written.

**Remediation:** same gate pattern (`updateMany where status='IN_TRANSIT' AND shippedAt IS NULL`); wrap each action in one tx; skip-with-log + counter for missing inventory rows instead of silent pass.

**F3-4 · P1 — PARTIAL is a terminal dead-end; cancel-after-ship writes no movement; vocabulary drift.**
Schema documents `PENDING → IN_TRANSIT → PARTIAL → COMPLETED | CANCELLED` (`schema.prisma:2425-2432`); code emits `RECEIVED`, never `COMPLETED` (`[id]/route.ts:131`). A `PARTIAL` transfer can neither be re-received (guard `:125` requires `IN_TRANSIT`) nor cancelled (`:209`) — the shortfall is stranded: origin decremented, destination never credited. Cancel-after-ship (`:218-230`) restores origin stock but writes **no** reversal movement.

**Remediation:** align vocabulary to the schema; allow `receive` on `PARTIAL`; on cancel write compensating `TRANSFER` reversal movements; enforce the transition map exactly like `purchase-orders/[id]/route.ts:89-106` (the best state machine in the repo — replicate it).

**F3-5 · P1 — Client-supplied `receivedQty` unbounded (arbitrary inventory credit/debit).**
`[id]/route.ts:136-146` trusts `receivedItem.receivedQty` with no `0 < qty ≤ item.quantity` clamp (contrast PO's over-receipt guard). A crafted body credits destination with any quantity — negative values **decrement** it. **Remediation:** validate per item, reject beyond tolerance, clamp to shipped quantity.

**F3-6 · P1 — `batchUpdateStock` sets absolute quantities and logs the *new total* as the movement, in a second tx with errors swallowed.**
`batch/route.ts:209-237`: stock 100→50 logs `ADJUSTMENT +50`; the movement ledger can never reconcile afterwards; the absolute set clobbers concurrent sales; the movement write is in a **separate** transaction whose failure is `.catch(() => {})` — balance changes with no ledger row. **Remediation:** compute delta, `increment: delta`, same tx, `quantity: delta` on the movement.

**F3-7 · P1 — Rental returns: double-return race, LOST items restocked, unbalanced damage journal.**
`rentals/[id]/return/route.ts:46-51` checks status **pre-tx**, then `:101-104` increments stock unconditionally inside the tx → concurrent returns double-credit. `:67-70` maps `SEVERE → LOST` but the same `+1` runs — destroyed goods return to sellable stock. The settlement JE (`:139-180`) omits `damageCharge` from the credit side → debits ≠ credits by exactly the damage amount. **Remediation:** conditional status claim (`updateMany where status IN (ACTIVE, OVERDUE)`); stock increment only for RETURNED/DAMAGED; include damage charge as a credit line (or A/R receivable) and assert balance.

**F3-8 · P2 — Tenant whitelist omits the new inventory models.**
`db.ts:246-301` `STORE_SCOPED_MODELS` lacks `inventory`, `serialNumber`, `batch`, `binLocation`, `productVariant` (all have non-nullable `storeId`), and `storeTransfer` is deliberately excluded with no compensating manual scoping. **Remediation:** add them; scope transfers by origin or destination in handlers.

**F3-9 · P2 — Stock ledger not immutable; actor spoofable.**
`stockMovement` is absent from `IMMUTABLE_MODELS` (`db.ts:315-334`) — the ORM guard protecting `JournalEntry` doesn't protect the stock ledger; `performedBy: performedBy || session.userId` (`stock-movements:312`) lets clients forge actors. **Remediation:** add `stockMovement` to `IMMUTABLE_MODELS`; actor always from session; require `referenceId` for PURCHASE/RETURN.

---

## PHASE 4 — INVENTORY & COUNTER CONCURRENCY (RACE CONDITION ATLAS)

**Systemic (SYS-4):** repo-wide grep: **zero** `SELECT … FOR UPDATE`, **zero** `isolationLevel` (only `SELECT 1` health checks), no version columns, no CHECK constraints (`quantityInStock Decimal @default(0)`, `schema.prisma:272/347/2479`). Default isolation is READ COMMITTED. Every guard is check-then-act (TOCTOU). Live: no negative stock *yet* — 20 sales at 11,765 units of depth has never stressed the window; the code path guarantees it will happen under real load.

| # | Race | Location | Failure mode | Exact fix |
|---|------|----------|--------------|-----------|
| R1 | **Oversell / negative stock** | `transactions/route.ts:507-526` (in-tx re-check is still read-then-write); `stock-movements/route.ts:272-342` (check outside tx, unconditional decrement); `rentals/route.ts:161-204` (no in-tx re-check) | Two checkouts of the last unit both pass → stock = −1 | `updateMany({ where: { id, quantityInStock: { gte: qty } }, data: { quantityInStock: { decrement: qty } } })`; abort sale if `count === 0`; add DB backstop `ALTER TABLE products ADD CONSTRAINT chk_nonneg CHECK ("quantityInStock" >= 0)` |
| R2 | **Gift-card double-spend (two paths)** | `gift-cards/[id]/redeem/route.ts:57-104` (check pre-tx, absolute write in tx); `transactions/route.ts:607-635` (re-read in tx, absolute write) | KES 1,000 card redeemed twice for 800 → both write 200, two redemption rows | `updateMany({ where: { id, currentBalance: { gte: amount }, status: 'ACTIVE' }, data: { currentBalance: { decrement: amount } } })`; reject on 0 |
| R3 | **Debt payment double-apply** | `debt/route.ts:154-201` (debt read pre-tx, `newAmountPaid` from stale base); same in `debt-payment-plans/[id]/installments/[installmentId]/pay/route.ts:107-147` | Two double-clicks → two `DebtPayment` rows, two JEs, two customer-balance decrements, `amountPaid` lands once → cash collected twice, balance can go negative | Conditional `updateMany({ where: { id, balance: { gte: paymentAmount } }, data: { amountPaid: { increment }, balance: { decrement } } })`; re-read inside tx; idempotency key (SYS-10) |
| R4 | **Voucher maxUses bypass** | `vouchers/redeem/route.ts:166-188` (`currentUses` read pre-tx, absolute write) | Concurrent redemptions both read 0 → both write 1 | `updateMany({ where: { id, currentUses: { lt: maxUses } }, data: { currentUses: { increment: 1 } } })` |
| R5 | **Loyalty points lost update** | `transactions/route.ts:776-800` (read-then-write in fresh post-commit tx) | Concurrent sales to one customer lose points | `updateMany ... points: { increment: earned }` on `CustomerLoyalty` |
| R6 | **Cash drawer running-balance drift (3 paths)** | `cash-drawer/route.ts:138-175`; `transactions/route.ts:533-546`; `expenses/route.ts:220-236`; M-Pesa callback `:126-142` | All read "latest entry" then write computed balance → concurrent events overwrite baselines; skimming becomes undetectable | Store drawer state as a single row per shift and `UPDATE cash_drawer_state SET balance = balance + $1 WHERE id=$shift RETURNING balance`; or compute `SUM(amount)` at read time; never persist a computed running balance |
| R7 | **GRN receivedQty / WAC** | Phase 1 F1-2, F1-7 | Over-receipt; COGS corruption | As specified there |
| R8 | **Rental double-return** | Phase 3 F3-7 | Double restock | Conditional status claim |

**Architectural remediation (pick one layer, enforce repo-wide):**
1. **Preferred — optimistic conditional writes:** the `updateMany({ where: <current-state predicate> })` + `count === 0 → 409` pattern. Works under READ COMMITTED (UPDATE takes a row lock), keeps pgbouncer transaction-mode compatibility (no long-held locks), and no raw SQL needed for the simple cases.
2. **For cross-row invariants** (e.g., multi-line receipts): `tx.$queryRaw` `SELECT … FOR UPDATE` on the parent rows, in a deterministic ID order to avoid deadlocks.
3. **DB backstop:** CHECK constraints for non-negative money/quantity columns; they turn silent corruption into a loud 500.
4. **Never** rely on Serializable — it conflicts with pgbouncer transaction pooling and Neon autosuspend (connection churn) and will produce serialization failures under load you are not equipped to retry yet.

---

## PHASE 5 — SALES CAPTURE & MONEY MATH (POS)

**Flow:** `POST /api/transactions` — one atomic `$transaction` (`:440-717`) creating SalesTransaction + SaleItems + Payments + stock decrements + StockMovements + method side-effects + one JE + Receipt. **Atomicity is real and good**; the inputs to it are not.

**F5-1 · P1 — The server trusts the client's price, cost, tax, and discount.**
`transactions/route.ts:329-373`: `pricePerUnit`, `taxRate`, `costPrice` come from the request body (products are fetched only for stock checks); `discountAmount` is validated only as `nonnegative` (`validations.ts:33-43`) — a discount larger than the subtotal produces a **negative `finalTotal`** (negative Payment, negative DebtLedger, gift-card check trivially passes). Combined with SYS-1 (no auth), any caller sells KES 10,000 goods for KES 1. `costPrice` from the client feeds COGS (`:655-659`).

```ts
const safePrice = parseFloat(String(item.pricePerUnit));   // client-supplied
const appliedDiscount = Number(discountAmount) || 0;       // unbounded
const finalTotal = totalAmount - appliedDiscount;          // can go negative
```

**Remediation:** re-price every line server-side from `Product` (price, `TaxCategory→TaxRate`); recompute `costPrice` from `Product.costPrice` (WAC) for COGS; enforce `0 ≤ discountAmount ≤ Σ(line discounts + subtotal)`; require `MANAGER+` role above a configurable discount threshold and write an AuditLog row for every override.

**F5-2 · P1 — Unrounded float math on the sale path; `Money` is dead code here.**
`helpers.ts:94-106` `calculateLineTotal` does pure float multiplies with no rounding; header totals accumulate the same (`transactions/route.ts:325-373`). Columns are `numeric`, so drift is frozen into the DB at write time; line-sum vs header can disagree by a cent — exactly what eTIMS reconciliation flags. **Remediation:** route all totals through `Money`/`KES()`; round each line HALF_EVEN to 2dp; derive header from rounded lines; store as strings into Prisma Decimal.

**F5-3 · P1 — SPLIT payments containing GIFT_CARD debit the liability without redeeming the card.**
`transactions/route.ts:676-687` aggregates the split into `paymentBreakdown.giftCard`; `recordSaleJournalEntry` then debits Gift Card Liability 2300 (`account-helper.ts:433-440`) — but the card balance is untouched and no `GiftCardRedemption` row is written. The card remains fully spendable (via the R2 route) while the GL says the liability was consumed. **Remediation:** redeem each GIFT_CARD split inside the same tx using the R2 conditional decrement; validate `Σ splits === finalTotal` with a clean 400 before the tx (today a mismatch surfaces as a raw 500 from the balance assert at `account-helper.ts:474-480`).

**F5-4 · P1 — Gift-card issuance mints spendable value with no tender and no journal.**
`gift-cards/route.ts:134-158` creates ACTIVE cards for arbitrary value with no Payment/drawer/JE. `recordGiftCardIssuance` exists (`account-helper.ts:503-556`) and is **never called** (grep-verified). Redemption then debits liability 2300 that was never credited → structurally negative liability. **Remediation:** wrap issuance: tender record (cash/M-Pesa drawer entry) + `recordGiftCardIssuance` + card create in one tx; restrict issuance roles; card codes crypto-random (today they are guessable and the route is unauthenticated).

**F5-5 · P2 — Vouchers never validated at checkout; loyalty points earned on unpaid sales.**
Checkout accepts `paymentDetails.voucherId` but never checks existence/validity — the discount is whatever the client sent (F5-1). Points are granted post-commit even when `paymentStatus === PENDING` (M-Pesa/DEBT) (`:763-823`); combined with F6-6, failed M-Pesa sales keep their points. **Remediation:** validate voucher server-side (R4 conditional increment) and mark it consumed in the sale tx; award loyalty only on `COMPLETED`.

**F5-6 · P2 — Reference-number generation is a collision factory.**
`generateReceiptNumber` = `MBM-YYYYMMDD-<Math.random()*99999>` (`helpers.ts:3-10`) against `Receipt.transactionId @unique`-adjacent `receiptNumber @unique` (`schema.prisma:458`) → birthday collision ≈ 50% at ~370/day → **checkout 500s with the customer standing there** (numbers are also guessable, feeding F6-1). Invoice numbering (`invoices/route.ts:18-37`) uses string `MAX+1` (`INV-9999 > INV-10000`), cross-store, racy. **Remediation:** per-store daily sequence allocated inside the tx (advisory lock or counter row) or DB sequences; crypto-random suffix if unpredictability matters; retry-on-P2002 as defense.

---

## PHASE 6 — PAYMENT GATEWAY & WEBHOOK INGESTION / FULFILLMENT (M-PESA)

**Flow:** checkout → (broken server-side STK push) → client-side `stkpush` (`src/lib/api.ts:727,746`) → Daraja → `POST /api/payments/mpesa/callback` (public) → mark paid + post journal + drawer. Live DB: `mpesa_transactions` = 2 rows — this subsystem is nearly unused in production, and what exists is the most dangerous code in the repo.

**F6-1 · P0 — The callback is unauthenticated and forgeable.**
`callback/route.ts:72-95` — no HMAC, no Daraja credential check, no IP allowlist; the route is in `PUBLIC_PATHS` and CSRF-exempt (`proxy.ts:138-154`); it additionally accepts a flat "mock" body shape (`resultCode` at top level, `:26-34,60-69`). `CheckoutRequestID` values are predictable (`ws_CO_<counter>` — see the repo's own mock, `docker/mpesa-mock/server.js:36`). Anyone can `POST {"Body":{"stkCallback":{"CheckoutRequestID":"ws_CO_1","ResultCode":0,…}}}` and flip an unpaid sale to `COMPLETED`, post the journal, and walk out with goods.

```ts
const body: MpesaCallbackBody = await request.json();      // no signature check
const data = extractCallbackData(body);
const isSuccess = data.resultCode === '0';
```

**Remediation (exact):** (1) validate Daraja's basic-auth `Authorization` header on the callback (per-environment credential in Vercel env) **and** an IP allowlist of Safaricom ranges; (2) reject non-`stkCallback` shapes when `NODE_ENV=production`; (3) verify `metadata.Amount === mpesaTx.amount` (in KES) before applying; (4) log a `SecurityEvent` on every rejected callback.

**F6-2 · P0 — The server-side STK push can never succeed (relative URL fetch).**
`transactions/route.ts:730-743`:

```ts
fetch('/api/payments/mpesa/stkpush?XTransformPort=3001', { ... }).catch(() => {
  // STK push failure logged but does not block the transaction
});
```

Node's `fetch` in a Vercel function cannot resolve a relative URL → immediate `TypeError`, swallowed. The `XTransformPort` gateway parameter is also a sandbox-gateway artifact that has no meaning inside production serverless. There is no retry, no DLQ enqueue, no stale-`PENDING` sweeper. Every M-Pesa sale commits with stock decremented, a PENDING `MpesaTransaction`, an unposted journal — and the customer is prompted only if the client dialog independently fires `stkpush`. **Remediation:** after the checkout tx commits, invoke the STK logic as an in-process function (or `fetch(new URL('/api/payments/mpesa/stkpush', process.env.APP_URL))`); add a `vercel.json` cron every 5 min: expire PENDING pushes older than 2 min → trigger F6-6 compensation.

**F6-3 · P0 — Callback confirmation throws on every success (FK violation) and rewrites immutable ledger lines.**
`callback/route.ts:126-142` creates a `CashDrawerLog` with `userId: 'system'` (`:136`) — `CashDrawerLog.userId` is a required FK to `User` (schema:803-804) and no such user is seeded → the confirmation transaction throws **every time**, while the `mpesaTransaction` row was already flipped `COMPLETED` **outside** the tx (`:98-107`). Sale stays PENDING, journal never posts, drawer entry never lands. Even if it worked, `:172-181` uses `tx.journalEntryLine.updateMany` to re-point a posted debit line from the M-Pesa account to cash — the sanctioned immutability bypass being used for **history rewriting** instead of lifecycle flags.

**Remediation:** (1) seed a real `system` user (or make `userId` nullable with a system discriminator); (2) move the status flip **inside** the tx and guard it: first statement `updateMany({ where: { id, status: 'PENDING', callbackReceived: false }, data: { status: 'COMPLETED', callbackReceived: true } })`, abort if 0 (Daraja retries then no-op); (3) never rewrite lines — post an *adjusting pair* (Dr Cash / Cr M-Pesa Clearing) via a new linked JE; (4) `@@unique([storeId, mpesaReceiptNumber])` to stop one receipt settling two rows.

**F6-4 · P1 — Callback is not idempotent and ignores state.**
No early-exit on `status === 'COMPLETED'` → Daraja retry storms duplicate the drawer entry on every retry (`:127-142`). `metadata.Amount` is never compared (partial/over settlement accepted). A callback arriving after the sale timed out/failed unconditionally flips it to COMPLETED. **Remediation:** as F6-3(2) + amount check + terminal-state guard that routes late callbacks to a reconciliation queue instead of mutating.

**F6-5 · P1 — Failure path never reverses stock or voids the pending journal.**
`callback/route.ts:200-224`: on failure, statuses flip (`mpesaTx`, sale `paymentStatus=FAILED`, payments) — but stock was decremented at checkout time, the pending JE stays unposted forever, and no compensating StockMovement is written. Every cancelled/timeout STK **permanently shrinks inventory**. **Remediation:** symmetric compensation in one tx: restock + `SALE_CANCELLED` movement + void pending JE (set `isVoided` with reason) + sale status `CANCELLED` — or defer stock decrement until payment confirmation (preferred for M-Pesa flows; keep pre-decrement for cash/DEBT).

**F6-6 · P1 — No payment-to-ledger reconciliation.**
Nothing ties `Payment.status` × `MpesaTransaction.status` × JE posted state; no sweeper exists (no `crons` in `vercel.json`). **Remediation:** daily reconciliation report + alert on: PENDING > 2 min, FAILED with posted JE, COMPLETED without JE, drawer entries without JEs.

**ERP hand-off note:** the only ERP "integration" today is CSV `data-exports`, which is structurally broken on Vercel (see F7-7). There is no ERP sync surface to audit beyond it — flagging this as a *capability gap* against the stated "integrates with ERP systems" requirement.

---

## PHASE 7 — GENERAL LEDGER, PERIOD CLOSE & FINANCIAL REPORTING

**What's good (verified):** `accounting-helpers.ts` implements a real lifecycle (create→approve→post→void) with creator≠approver (line 692), re-validation at posting (`:782-799`), reversals with linkage (`:892-928`), and `AuditLog` written in-tx (`:618-637`). `computeEntryTotals` (`:219-281`) rejects negative lines, both-sides lines, zero totals. The ORM hard-blocks UPDATE/DELETE on `JournalEntry/JournalEntryLine/SystemLog/AuditLog/TrialBalanceSnapshot` outside an audited bypass (`db.ts:315-334, 436-546`).

### Findings

**F7-1 · P1 — The double-entry invariant is app-only and bypassed by three parallel creation paths.**
`financial/journal/route.ts:120-170`: float sums with a 1-cent tolerance, accepts a line with both debit and credit > 0, accepts accounts from **any organization** (`where: { id: { in: accountIds } }` — no org/`isActive` filter), auto-posts, no `AuditLog`, `createdBy` from the request body. Legacy `recordSaleJournalEntry` (`account-helper.ts:474-480`) and inline cash-drawer/gift-card creates bypass the hardened `createJournalEntry` too. Nothing at the DB level (no CHECK, no trigger — migration-verified).

**Remediation:** route **all** creation through `createJournalEntry`; add DB enforcement:
```sql
ALTER TABLE journal_entry_lines ADD CONSTRAINT chk_single_side CHECK ((debit = 0) OR (credit = 0));
ALTER TABLE journal_entry_lines ADD CONSTRAINT chk_nonneg CHECK (debit >= 0 AND credit >= 0);
CREATE CONSTRAINT TRIGGER trg_je_balanced AFTER INSERT ON journal_entry_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_entry_balanced();
```
(`assert_entry_balanced` = `SELECT 1/0` unless `SUM(debit)=SUM(credit)` for the entry — the deferred variant works under pgbouncer transaction pooling.)

**F7-2 · P1 — Voiding a DRAFT mints a posted reversal from nothing.**
`accounting-helpers.ts:869-871` checks only `isVoided` — a draft (never posted) that is voided produces a **posted, non-voided reversing entry**, permanently corrupting balances computed from posted non-voided lines (`:432-440`). **Remediation:** `if (!entry.isPosted) throw` — void drafts in place via the bypass.

**F7-3 · P1 — Two divergent void implementations; the API one is audit-blind.**
`financial/journal/[id]/route.ts:41-67` flips `isVoided` directly: no reversal linkage, no mandatory reason, no `AuditLog` (only SystemLog); the linked expense update is a separate non-transactional step. **Remediation:** delete the inline void; make the route call `voidJournalEntry()`.

**F7-4 · P1 — Period control is advisory — and unused.**
Live: `financial_periods` = **0 rows**. Sale-path JEs never set `financialPeriodId`; `closeFinancialPeriod` counts unposted entries only among period-linked ones (`accounting-helpers.ts:1274-1287`); `voidJournalEntry` posts reversals into CLOSED/LOCKED periods with no `assertPeriodOpen` (`:912`); the manual journal route ignores periods entirely. **Remediation:** make period mandatory at creation (resolve by `entryDate`); count unposted by `entryDate`; claim the close with `updateMany({ where: { id, status: 'OPEN' } })`; route reversals into the current open period with a linkage note.

**F7-5 · P1 — Payment voids and expense edits bypass the ledger.**
`financial/payments/[id]/route.ts:45-48` flips a payment to `REFUNDED` with no reversing JE, no drawer entry, no sale update — cash and revenue stay overstated (classic refund-fraud vector). F1-9 covers expense edits. **Remediation:** one `reversePayment()` routine: reversing JE + drawer entry + sale status, all in the payment's tx; forbid edits on posted expenses.

**F7-6 · P1 — Whole-ledger scans in-request with float re-sums.**
`financial-audit.ts:216-341` (trial balance, financial audit) and `financial/accounts/route.ts:55-110` load every line into a 1 GB lambda and sum with JS `+` on Decimals; `reports/sales` fetches every sale item unbounded; `revenue-trend` allows unbounded `days`. With `statement_timeout=0` (live-verified), these run until the lambda timeout while holding Neon CU-billed compute. **Remediation:** `db.journalEntryLine.groupBy({ by: ['accountId'], _sum: { debit: true, credit: true } })`; cap windows; `statement_timeout=30s` at the pooler role level (see Phase 8).

**F7-7 · P1 — Data exports (the ERP hand-off) are structurally broken on Vercel.**
`data-exports/route.ts:37` writes to `EXPORTS_DIR = '/home/z/my-project/download/exports'` — not writable on Vercel → every export fails; generation is an unbounded in-memory `findMany` + full CSV string inside the request; timed-out runs leave rows stuck `PROCESSING` forever (no reaper, no crons). **Remediation:** stream to `/tmp` and upload to Vercel Blob/S3; cursor-chunked queries; move generation to a queued job (Vercel cron + handler); `PROCESSING` reaper at 15 min; signed download URLs with `expiresAt`.

**F7-8 · P2 — Dead/mismatched accounting code.** `reconcileAccount` selects a nonexistent `Account.balance` column (`financial-audit.ts:527-530` — never called, but a landmine); `banking/reconciliations/route.ts:65-67` includes a `transactions` relation the schema doesn't have → guaranteed 500; retention purge of `system_logs`/`audit_logs` always throws `IMMUTABILITY_VIOLATION` (`data-retention.ts:232-247` vs `db.ts:315-334`) — the nightly job fails silently. **Remediation:** fix or delete; wrap sanctioned purges in `withImmutabilityBypass('retention_purge')`.

**F7-9 · P2 — SYS-8 (reproduced here for this phase):** the init migration defines `journal_entries."totalDebit" DOUBLE PRECISION` and only 30 tables; production is correct only because `prisma db push` was run manually. `vercel-build.sh:42-45` papers over it with `--accept-data-loss`. Any fresh provision from migrations (a Neon PR branch, DR restore) yields a **float-valued ledger with missing tables**. **Remediation:** `prisma migrate diff --from-migrations --to-schema-datamodel --script` → baseline a real migration; delete the float init; remove `--accept-data-loss`; adopt `migrate deploy` in CI (see Phase 10 Wave 2).

---

## PHASE 8 — SERVERLESS STRUCTURAL LIMITS (VERCEL × NEON)

**Environment (live-config, prior-phase verified):** autoscaling 0.25–2 CU; scale-to-zero with suspend timeout 0 (ops logs show suspend/start cycles); `max_connections` 901; app connects via pooled endpoint `pgbouncer=true&connection_limit=1`; `statement_timeout=0`; `pg_stat_statements` available but **not installed**; history retention **6h**; functions in `iad1` co-located with Neon `us-east-1` (cold-start DB penalty measured ~1.4 s; warm TTFB 0.75 s; homepage 40 ms).

**F8-1 · P1 — `connection_limit=1` + interactive transactions = head-of-line blocking.**
Every checkout/receipt holds the *single* pooled connection for the whole interactive tx. Two concurrent cashiers on the same lambda instance serialize; a slow tx stalls everything behind it; Prisma's default 5 s interactive timeout compounds with per-item loops (F1-10). **Remediation:** keep `connection_limit` low (2–4) for pgbouncer transaction mode, set explicit `{ maxWait: 5000, timeout: 15000 }` on every interactive tx, batch per-item work, and never run interactive txs for read-only work.

**F8-2 · P1 — `statement_timeout=0` + unbounded scans = silent CU burn.**
F7-6's scans plus no timeout mean a single runaway report holds Neon compute (billed in CUs) until the lambda dies. **Remediation:** `ALTER ROLE neondb_owner SET statement_timeout = '30s';` (plus a larger override role for migrations); add Neon `pg_stat_statements` to find the top offenders.

**F8-3 · P1 — Disaster-recovery posture is inadequate for financial data.**
History retention = **6 h** → PITR covers less than one business day; no scheduled logical backups; production branch protection blocked by free-plan limits. **Remediation:** raise history retention (paid tier) to ≥ 7 days minimum (30 preferred); add a nightly cron: Neon API `backup` (or `pg_dump` to object storage) with 30-day retention and a monthly restore drill into a scratch branch; revisit branch protection on upgrade.

**F8-4 · P1 — Fire-and-forget promises die with the lambda.**
The broken STK push (`F6-2`), post-commit loyalty earn (`transactions:763-823`), and `.catch(() => {})` system logs all assume the process lives on. On Vercel, after the response returns, background work may be frozen at any time. **Remediation:** adopt a **transactional outbox**: write `outbox_events` rows inside the business tx (kind, payload, attempts); a cron-driven pump (every 1 min) processes with retries → DLQ (`dead-letter-queue.ts` already exists — wire it to the outbox instead of ad-hoc calls).

**F8-5 · P2 — Cold-start UX.** First-hit 2.12 s TTFB (DB cold-start penalty ~1.4 s on top of lambda cold start). **Remediation:** acceptable for POS if the offline queue works (it currently doesn't authenticate — SYS-10); consider Neon "compute, always-on" (minimum 0.25 CU 24/7) during business hours; `connect_timeout=15` in db.ts is already correct.

**F8-6 · P2 — No scheduled work exists.** `vercel.json` has no `crons`: no payment sweeper, no reconciliation, no retention, no export reaper — while code comments claim a "nightly financial audit cron" (`financial-audit.ts:24`) that has never been wired. **Remediation:** add crons (see Phase 10 Wave 2 list).

**F8-7 · P2 — In-request heavy generation** (exports, large reports) hits the 10–60 s function cap by design. Move to the outbox/queue pattern of F8-4.

---

## PHASE 9 — COMPLIANCE, AUDIT TRAIL, TAX (eTIMS/KRA) & ACCESS CONTROL

**F9-1 · P0 — The audit trail is empty and its integrity check is a no-op.**
Live: `audit_logs` = **0 rows**. `auditTrail.log()` is called from exactly one place (`access-control.ts:143`), and `verifyAccess`/`hasPermission` from **zero** routes (grep-verified) — the `PERMISSION_MATRIX` (`types.ts:414-470`) is decorative. `verify()` (`audit-trail.ts:329-377`) compares nothing ("the AuditLog model doesn't have that field yet…") → `isIntact` is always true; the compliance dashboard (`compliance.ts:86-292`) hardcodes `isImplemented: true` and score 100 — **self-attestation presented to management as control evidence**. Meanwhile `/api/audit-logs` (GET) is unauthenticated and returns user emails/roles (`audit-logs/route.ts:105`, `:52`) while `/api/system-logs` is properly gated — inverted exposure.

**Remediation:** add `previousHash`/`integrityHash` columns to `AuditLog`; write `auditTrail.log()` **inside** the same `$transaction` as every financial mutation (sale, GRN, void, refund, debt payment, price override, role change); implement `verify()` to recompute the chain; drive the dashboard from real evidence (chain-verify results, purge outcomes).

**F9-2 · P0 — eTIMS is a mock that always reports success (Tax Procedures Act exposure).**
`etims-service.ts:86-125`: `issueInvoice` returns hardcoded `status: 'ISSUED'` + a `verify/` URL; `getInvoiceStatus` → `ISSUED`; `testConnection` → "Production connection successful". `etims-utils.ts:175-206` renders a hash-based **fake QR**. `etims/issue-invoice/route.ts:44-89` writes `etimsStatus: 'ISSUED'` onto the transaction with no KRA call. Two divergent KRA paths coexist (`InvoiceForKRA`+`kra/submit` vs this), never reconciled. Line payload bugs: hardcoded `taxRate: 0.16` (ignores per-line rates), `discount: Number(item.discountAmount || 0)` — `SaleItem` has `discountPercent`, not `discountAmount`, so **line discounts are never reported**; numbering via unsynchronized `count(etimsStatus='ISSUED')+1` across all stores (`:47-55`).

**Remediation:** hard-fail when the service is mock and `ETIMS_SANDBOX=false` (refuse to issue); consolidate to the `InvoiceForKRA`+`kra-helpers` path (it has real forensics: `KraSubmission` rows with `responseJson/httpStatus/latencyMs`, exponential backoff, no-4xx-retry — `kra-helpers.ts:295-403`); render QR from the KRA-returned payload; fix line tax/discount mapping; allocate numbers transactionally per store/device.

**F9-3 · P1 — KRA credential and payload quality.**
KRA portal password is base64-labeled-AES (`kra/profile/route.ts:142-144`, honest comment admitting it; `kra-helpers.ts:172-182` reverses it) and `KraBusinessProfile.authToken` is plaintext (`schema.prisma:1767`) — reversible by anyone with DB read (and SYS-8/SYS-9 show DB read is not far-fetched). Payload quality: National ID (8-digit) sent as customer `PIN` (`kra/submit/route.ts:75-95`); blanket `hsCode: '0000.00.00'`; VAT-inclusive extraction using the client tax rate so exempt lines get VAT (`kra-helpers.ts:557-584`); `TaxCategory.etimsCode` (schema:2339) never consulted. **Remediation:** AES-256-GCM with a KMS-held key + envelope decryption; `validateKraPin()` before submission; HS-code mapping table; per-line tax from `TaxCategory`.

**F9-4 · P1 — Access control: presence ≠ authentication; roles ≠ authorization.**
SYS-1 (verified myself: `proxy.ts:240-259` checks only header format) plus: `requireStoreAccess` validates **only query params** against the session (`auth.ts:233-238`) while `POST` bodies carry `storeId` that `injectTenant` deliberately defers to (`db.ts:579-584`) → cross-tenant writes (POs, suppliers, KRA profiles, data exports); `users/route.ts:96-121` lets any financial role mint a `SUPER_ADMIN` (bypassing all store checks via `runWithoutTenant`, `auth.ts:89-92`); debt-plan approval never blocks self-approval (`debt-payment-plans/[id]/approve/route.ts:55-66`); stale role names (`STORE_MANAGER` at `kra/submit:42` vs actual `BRANCH_MANAGER`) silently exclude branch managers from KRA submission. **Remediation:** one shared `assertPermission(action, resource)` guard enforcing the matrix server-side; bind `storeId`/`orgId` from session everywhere (reject body-supplied values); role assignment restricted to `SUPER_ADMIN`; self-approval blocks; grep-fix stale role names.

**F9-5 · P1 — Account security is per-instance memory.**
`brute-force.ts:15` keeps counters in a `Map` that resets on every cold start and doesn't coordinate across instances; 5 wrong guesses permanently sets `isActive: false` (staff DoS, manual `scripts/reset-lockout.ts` to recover); rate limits (`rate-limit.ts:11`, proxy) share the same weakness; login accepts legacy reversible `hashed_` credentials (`auth/login/route.ts:61-64`); every seeded user has `bcrypt('password123')` (`seed.ts:205`). **Remediation:** persist `failedLoginAttempts/lockedUntil` (columns **already exist** in the schema, `schema.prisma:155-157`); never auto-deactivate; move IP counters to Postgres/Redis; delete the `hashed_` path; force seed-password rotation.

**F9-6 · P2 — Edge middleware bypasses.** CSRF allows `origin.includes(host)` — `https://app.example.com.evil.io` passes (`proxy.ts:84-95`); `security/block-ip` writes a key format `isRateLimited` never reads (`security/block-ip/route.ts:25`) — blocking is a no-op; `TaxFiling` totals are client-authored and never reconciled to `InvoiceForKRA`/transactions (`tax/filings/route.ts:129-144`). **Remediation:** exact Origin-host equality; fix the block key; compute filing totals server-side for the period.

**F9-7 · P2 — Retention vs statute.** `audit_logs` purge at 3 years (`data-retention.ts:104-112`) is below Kenya's 5–7 year record-keeping requirement (Tax Procedures Act), and the purge itself always throws immutability violations (F7-8); `DataExport` PII files have `expiresAt` but no purge; payroll/ledger models have no retention policy. **Remediation:** financial/audit retention ≥ 7 years with legal-hold flags; purge via audited bypass only; add cron for export expiry + unlink.

---

## PHASE 10 — CONSOLIDATED REMEDIATION ROADMAP (dependency-ordered)

### Wave 0 — this week (close the exploit surface; ~1–2 engineer-days)
1. **SYS-1:** wrap every state-changing route in `requireAuth/requireStoreAccess/withFinancialAuth` (mechanical; purchase-orders shows the pattern); validate sessions in the proxy or fail-closed per-route.
2. **F6-1:** Daraja callback credential + IP allowlist + amount check + reject mock shape in production.
3. **F6-3:** seed `system` user; idempotency guard (`callbackReceived`) as first statement in tx; stop `journalEntryLine.updateMany`.
4. **SYS-9:** delete `scripts/set-vercel-env.sh` (or strip secrets); rotate the Neon password **in the same window** as the Vercel env update (the rotation workflow exists; it is blocked on a valid owning-account `VERCEL_TOKEN` — issue #9); set `EXPOSE_ERRORS=false`; purge from git history (`git filter-repo`); base64→AES-GCM for KRA password.
5. **F3-2/F3-3:** the two transfer fixes (`receivedBy` removal + status-gate + tx) — one small PR, stops deterministic stock destruction.

### Wave 1 — next 1–2 sprints (correctness of the ledger)
6. **SYS-4/R1–R8:** conditional-update pattern repo-wide + CHECK constraints (`quantity >= 0`, single-side journal lines) + balanced-entry trigger.
7. **F1-1:** GRN journal posting (Dr Inventory / Cr AP) in the receive tx — restores the balance sheet.
8. **F5-1/F5-2:** server-side repricing + `Money` adoption on checkout, PO, expenses; discount caps + manager override with audit.
9. **SYS-7/F5-6/F1-6:** sequence-based numbering (PO, JE, receipt, invoice, KRA) + `Idempotency-Key` table + offline-sync replay dedupe (and add the missing `Authorization` header to `offline-sync.ts` — today replays 401).
10. **F7-2/F7-3/F7-5:** single void path (reversal + reason + audit); payment-void reversing JE; immutable posted expenses.
11. **F7-4:** mandatory financial periods + close claiming + reversal routing.

### Wave 2 — structural (the next month)
12. **F8-4:** transactional outbox + cron pump → DLQ; retire fire-and-forget promises.
13. **F3-1/F6-6:** nightly reconciliation job (movements vs balances; payments vs JEs; drawer vs GL) with alerting; opening-balance movement backfill.
14. **F7-9/SYS-8:** real migration baseline + `migrate deploy` in CI + drift-guard step (`migrate diff` in a workflow); delete `--accept-data-loss` fallback.
15. **F8-3:** PITR retention ↑, nightly backups + monthly restore drill; add `vercel.json` crons (payment sweeper 5 min; reconciliation daily; retention nightly; export reaper 15 min).
16. **F7-7:** exports → `/tmp` + object storage + queue; signed URLs.
17. **F8-2:** `statement_timeout`; enable `pg_stat_statements`; Neon alerts (CPU, active connections, cache hit rate) correlated with Sentry function alerts.

### Wave 3 — compliance hardening
18. **F9-1:** hash-chained AuditLog columns + in-tx logging + real verify; dashboard from evidence.
19. **F9-2/F9-3:** real eTIMS integration (or hard-disable issuance until it exists); KRA payload mapping + credential encryption.
20. **F9-4/F2-1/F2-2:** enforced permission matrix + SoD (approver ≠ receiver; self-approval blocks); serialized-asset lifecycle; FEFO batches.
21. **F9-7:** retention to statute; legal-hold; export purge.

---

## VERIFIED "DONE WELL" (preserve these)

1. **Atomic checkout** — one `$transaction` with explicit `{ timeout: 15000, maxWait: 10000 }` and pre-warmed account IDs (`transactions/route.ts:415-717`).
2. **ORM immutability + tenancy extensions** with an audited, narrow `withImmutabilityBypass` (`db.ts:246-609`); unit-tested.
3. **`Money` primitive** — decimal.js, HALF_EVEN, largest-remainder allocation, JSON-safe (`money.ts:71-74, 332-370`) — it just needs to be *wired in*.
4. **Balanced-assertion on sale JEs** (±0.01) and contra-revenue discount routing (`account-helper.ts:433-480`).
5. **PO status transition map** (`purchase-orders/[id]/route.ts:89-106`) — the model to replicate for transfers.
6. **Payroll double-payment guard** — status 409 + `@@unique([payrollRunId, employeeId])`.
7. **KRA submission forensics** — `KraSubmission` with full response capture, backoff, no-4xx-retry.
8. **Debt discipline** — overpayment rejection, aging recomputation, plan installments recomputed from source (`debt/route.ts:147-266`, `debt-plan-utils.ts:255-277`).
9. **Defense-in-depth proxy layers that do work** — payload caps, content-type checks, per-tier rate limits (they just need real auth underneath).
10. **Production DB is Decimal-based and currently balances** (208,954.40 both sides) — the schema is right; the code paths feeding it are not.

---

## APPENDIX A — Evidence & verification ledger
- **Code audit:** 5 domain sweeps with full-file reads; every headline finding re-verified by hand at HEAD `33c6563` (proxy auth, `set-vercel-env.sh`, `receivedBy`, relative fetch, `userId:'system'`, JE-line `updateMany`, `recordGiftCardIssuance` call-sites, AP posting absence, base64 KRA password, eTIMS mock).
- **False positive excluded:** claimed syntax error in `src/app/api/reports/export/route.ts:25` — byte-level inspection shows valid `return [headerLine, ...dataLines].join('\n');` (output-rendering artifact).
- **Live DB:** pooled connection as `neondb_owner` → table counts, `information_schema` column types (`numeric` confirmed), trial-balance sums, stock-ledger divergence, missing `inventory` table, zero-row governance tables.
- **CI:** latest `main` run `CI/CD success` (2026-09-04) — green CI does not exercise any financial invariant; typecheck remains advisory (issue #8).
- **Blocked item carried over:** Neon password rotation + duplicate Vercel project deletion require a valid owning-account Vercel token (issue #9 documents the unblock steps).

*Report generated 2026-09-04 · Author: Principal Financial Systems Architect review (automated + manual verification pass).*
