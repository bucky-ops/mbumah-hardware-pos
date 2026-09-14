# Customer Credit Engine — Documentation

**Module:** Mbumah Hardware POS · Customer Credit Engine
**Status:** Verified working reference implementation (sandbox, browser-tested end-to-end)
**Repo audited:** `bucky-ops/mbumah-hardware-pos` @ `485d016`

---

## 1. What this module delivers

Every customer carries a complete, audited credit identity:

| Attribute | Where it lives | Notes |
|---|---|---|
| Credit limit | `Customer.creditLimit` | Grant/raise requires an approver (MANAGER/OWNER) |
| Current outstanding | `Customer.outstanding` | Denormalized; updated only inside `$transaction` with a write-time predicate |
| Available credit | `limit − outstanding` (engine) | Clamped ≥ 0, shown everywhere |
| Invoice history | `Invoice` + `InvoiceItem` | Per-invoice balance, due date, derived OVERDUE state |
| Due dates | `Invoice.dueDate` | Nairobi calendar-day arithmetic (`daysOverdue`) |
| Days overdue | Engine-derived | Never stored stale (fixes upstream dead `status='OVERDUE'` filter) |
| Payment history | `Payment` rows | On-time rate feeds the score |
| Credit score | `Customer.creditScore` 0–100 | Recomputed from real history on every charge/payment |
| Approved by | `Customer.approvedBy*` + `CreditLimitChange` | Immutable old→new approval trail |
| Payment reminders | `PaymentReminder` | Throttled (6h), live-figure message, SIMULATED without provider keys |
| Suspended / active | `Customer.creditStatus` | ACTIVE / SUSPENDED / DEFAULTED — hard-blocks credit sales |
| Verdict | Engine | `🔴 DO NOT EXTEND CREDIT` style output, one source of truth |

## 2. Verdict engine (precedence, first match wins)

1. `SUSPENDED` / `DEFAULTED` → **DO NOT EXTEND CREDIT** 🔴
2. Available credit ≤ 0 → **DO NOT EXTEND CREDIT** (limit exhausted) 🔴
3. Utilisation ≥ 95% → **DO NOT EXTEND CREDIT** (limit reached) 🔴
4. Overdue balance aged 61+ days → **DO NOT EXTEND CREDIT** 🔴
5. Any overdue balance → **RESTRICTED — SETTLE OVERDUE** 🟠
6. Utilisation ≥ 80% → **CAUTION — NEAR LIMIT** 🟡
7. Score ≥ 75, no arrears → **GOOD STANDING** 🟢
8. No history → **NEW — PROVISIONAL** ⚪
9. Otherwise → **STANDARD** 🟢

Requested output format (`formatCreditStatusCard`):

```
🔴 JOHN CONTRACTORS LTD
Outstanding: KES 384,500
Credit limit: KES 400,000
Overdue: KES 92,000
Status: DO NOT EXTEND CREDIT
```

## 3. Credit score (0–100, higher = safer)

| Component | Weight | Logic |
|---|---|---|
| Payment record | 35 | on-time settled ratio; ×0.7 if avg late 16–45d; ×0.4 if >45d |
| Aging severity | 25 | 25 − bucket_severity × overdue_share (D1_30=6 … D90+=25) |
| Utilisation | 20 | <30%→20 · <60%→15 · <80%→10 · <95%→4 · ≥95%→0 |
| Tenure + volume | 20 | months/24×8 + min(lifetime/1M,1)×12 |

New customers (no invoices) score a neutral 55, band NEW. Bands: ≥75 LOW · 55–74 MEDIUM · <55 HIGH.

## 4. The credit gate (3 layers on `POST /api/invoices`)

- **L1 Verdict:** `DO_NOT_EXTEND` (or non-ACTIVE status) → 403 unless MANAGER/OWNER supplies `override` + `overrideReason` (audited in invoice notes).
- **L2 Pre-check (in-tx):** `total > limit − outstanding` → 422 with exact figures.
- **L3 TOCTOU-proof claim (in-tx):**
  ```ts
  updateMany({ where: { id, outstanding: { lte: limit − total } },
               data:  { outstanding: { increment: total } } })
  ```
  The predicate is evaluated **at write time**; a concurrent charge makes `count===0` and the entire invoice rolls back. Repayment uses the mirror claim (`outstanding gte applied`) before decrementing.

## 5. Waterfall repayment (`POST /api/customers/[id]/repay`)

One payment settles ALL open invoices in strict oldest-`dueDate`-first order (per slice: invoice update → `Payment` row), then a single conditional decrement + one signed `CreditLedgerEntry` + score recompute — all inside one transaction. Overpayment is rejected with the exact excess unless `allowOverpay`.

## 6. Financial math

- Decimal-exact (`Prisma.Decimal`), ROUND_HALF_UP 2dp. No floats.
- Discount **before** 16% VAT: `Taxable = Σ(qty×price) − discount`, `VAT = Taxable×0.16`, `Total = Taxable+VAT` (interactive invoicing, net pricing).
- Seeded invoices use VAT-inclusive quoting (`net = total/1.16`) — both presentations are VAT-Act valid.

## 7. API surface

| Endpoint | Purpose |
|---|---|
| `GET /api/credit/overview` | KPIs, aging, verdict mix, watchlist, full directory |
| `GET/POST /api/customers` | Directory (search/filter) · register with approved limit |
| `GET/PATCH /api/customers/[id]` | 360° profile (invoices/payments/ledger/approvals/reminders) · contact edit |
| `POST /api/customers/[id]/credit-limit` | Limit change + approval trail + exposure ack |
| `POST /api/customers/[id]/credit-status` | Suspend / reinstate / flag default (audited) |
| `POST /api/customers/[id]/repay` | Waterfall payment |
| `POST /api/customers/[id]/remind` | Payment reminder (throttled, env-gated dispatch) |
| `GET/POST /api/invoices` | List · credit sale through the 3-layer gate |
| `GET/POST /api/seed` | Demo portfolio (idempotent, `force` reset) |

## 8. Applying to the upstream repo (mapping)

| Sandbox file | Upstream target |
|---|---|
| `src/lib/credit-engine.ts` | new `src/lib/credit-engine.ts` beside `debt-helpers.ts` (reuse, don't replace) |
| `Customer.creditStatus/creditScore/approvedBy*` | add columns to `Customer` (Prisma → `schema.prisma` §Customer) |
| `CreditLimitChange` | new model; wire `PUT /api/customers/[id]` to require approver + write the log |
| `Invoice.overdue` derived state | replace upstream dead `status='OVERDUE'` writes/queries with derived `daysOverdue` |
| L3 claim pattern | align with upstream checkout (`transactions/route.ts` uses `lte headroom` — see note below) |
| Watchlist/verdict UI | extend `debt-management-tab.tsx` / `customers-tab.tsx` |
| Reminder throttling | merge into `scheduleReminders` / `/api/reminders/debt/*` |

> **Note for upstream:** the audit observed the checkout claim predicate as
> `currentDebtBalance lte headroom` where `headroom = limit − currentDebtBalance`.
> Algebraically that passes only when `balance ≤ limit/2`. The correct write-time
> predicate is `currentDebtBalance lte (limit − charge)` — implemented here and
> browser-verified (the sandbox caught this exact bug via a 409 before the fix).

## 9. RBAC (demo convention, production mapping)

Operator identity comes from `/api/users` switch in the UI; every mutation posts `operatorId` and the server enforces: payments/reminders = any role · limit changes & overrides = MANAGER+ · suspend = MANAGER+. In production derive the operator from the session (`requireAuth`/`requireStoreAccess`) — the check functions (`resolveOperator`/`requireRole`) are the single place to swap.

## 10. Known limits / next steps

- Penalties (late fees) and installment plans intentionally out of scope here — they map to upstream `DebtPaymentPlan` and merge cleanly via the same ledger.
- Reminder dispatch is SIMULATED until `TWILIO_*` / `RESEND_API_KEY` env keys exist.
- No cron sweeps buckets because nothing is stored stale (derived aging); upstream should still add a nightly sweep for its stored `agingBucket`.
- PII encryption (phone/KRA PIN, AES-256-GCM) is the next hardening step before production.
