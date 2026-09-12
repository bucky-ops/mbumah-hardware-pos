# QA Report — Customer Debt Payment Failures (Kenya Plumbing Co.)

**System:** Mbumah Hardware POS & ERP (mbumah-hardware-pos)
**Environment tested:** Production — https://mbumah-hardware-pos-one.vercel.app/
**Customer in scope:** Kenya Plumbing Co. (Nakuru branch)
**Report version:** 1.0 · App version at test time: 2.3.0 (reproduced) → 2.4.0 (fixes verified live)

---

## 1. Executive summary

Staff could not record customer debt payments. Every attempt from the
**Customers tab → "Record Payment"** button failed with the console error:

```
{message: 'storeId, debtLedgerId, amount, and paymentMethod are required.',
 code: 'UNKNOWN_ERROR', statusCode: 500, context: {…}, stack: '…'}
```

We reproduced the failure, root-caused **four** defects (one primary, three
companions), fixed all of them, and verified the fixes **live on production**
by recording a real payment for Kenya Plumbing Co. The console message looked
like a server error (500) but was actually a **client-side request bug
(missing `storeId`)**; the label `UNKNOWN_ERROR / 500` is added by the
front-end error normaliser for *any* unexpected error and misled the team.

**All fixes are deployed (v2.4.0) and verified working.**

---

## 2. Stepwise testing process

### Step 1 — Access the system as different personnel

We logged into the production system as five different staff roles and tried
the same operation (POST a debt payment for a Nakuru customer) against each:

| Role | Login used | Can record debt payments? | What we observed |
|---|---|---|---|
| SUPER_ADMIN | admin@mbumahhardware.co.ke | Yes | Payment **failed** (missing-field bug — see Step 4) |
| STORE_OWNER (Nakuru) | joseph.nduta.nak@… | Yes | Payment **failed** (same bug) |
| ACCOUNTANT | accountant@mbumahhardware.co.ke | Yes | Payment **failed** (same bug) |
| BRANCH_MANAGER (Nakuru) | nakuru.manager@… | No (by design) | Server correctly refused: 403 "Insufficient permissions. Requires one of: SUPER_ADMIN, STORE_OWNER, ACCOUNTANT." |
| CASHIER (Nakuru) | nakuru.cashier@… | No (by design) | Same correct 403 refusal |

**Observations on role differences:**
- The permission matrix is enforced correctly by the server — managers and
  cashiers are read-only for debt payments.
- **Finding F4 (UI gap):** the Customers screen showed the same
  "Record Payment" button to cashiers and managers, who could fill in the
  whole form and only then receive a 403. The button is now hidden from
  roles that cannot use it.
- The server security feed recorded each 403 attempt ("attempted access
  requiring: SUPER_ADMIN, STORE_OWNER, ACCOUNTANT") — good tamper-evidence.

### Step 2 — Locate the customer

- Searched "Kenya Plumbing" on the Customers tab. Found **Kenya Plumbing Co.**
  (phone 0711002010) at the **Nakuru** branch (store_nakuru).
- Customer details loaded correctly: Debt Balance **Ksh 54,116.00**, Credit
  Limit Ksh 220,000.00 (25% credit usage), Silver tier.
- The customer has **two open debt records**: Ksh 506.00 and Ksh 53,610.00.

**Finding F2 (broken panel):** the customer detail sheet showed a permanent
**"Authentication required."** error box with a Retry button where the
**Loyalty Card** should be. The same broken panel appears for *every*
customer, at every branch, for every role.

### Step 3 — Attempt to record a payment ("Record Payment")

- Opened the customer sheet → clicked **Record Payment**.
- The "Record Debt Payment" dialog opened correctly, with the debt record,
  amount field, Cash/M-Pesa method and reference field all present.
- Entered KES 50, clicked **Record Payment** → error toast, no payment saved.
- Console captured exactly the error quoted by the team.

### Step 4 — Reproduce and verify the required fields

We called the same API endpoint the button uses (`POST /api/debt`), sending
exactly what the dialog sends:

| Request body sent | Server answer |
|---|---|
| `{debtLedgerId, amount:100, paymentMethod:'CASH'}` (what the dialog sent — **no storeId**) | **400** `storeId, debtLedgerId, amount, and paymentMethod are required.` — **the reported bug, reproduced** |
| Same body **+ `storeId`** | Payment succeeds (verified later in Step 6) |
| `{amount:0, …}` (zero amount) | Misleading message: "…are required." (amount was *present but invalid*) — validation-order bug |

**Conclusion:** the front-end dialog sends only 3 of the 4 required fields.
The server demands `storeId, debtLedgerId, amount, paymentMethod`. The
`storeId` (which branch the payment belongs to) was simply never included in
the Customers-tab code path — even though its own TypeScript contract says it
is required. (The type checker is configured as *advisory*, so this slipped
through CI — see Recommendation R1.)

Why the console said **500 / UNKNOWN_ERROR** for a **400** request: the
front-end `handleError`/`normaliseError` helper wraps any error it cannot
classify as `code: UNKNOWN_ERROR, statusCode: 500`. That is a labelling
weakness worth improving, but it is cosmetic — the root cause was the
missing field.

### Step 5 — Audit of the payment implementation

We audited the full payment chain (dialog → API client → server → database →
journal) and found **four defects**:

| # | Defect | Where | Effect |
|---|---|---|---|
| F1 | **`storeId` missing from the payment payload** | `customers-tab.tsx` → `debtApi.makePayment` | Every debt payment from the Customers tab failed with 400. The Financial tab's own payment dialog sent `storeId` and worked — only the Customers path was broken. |
| F2 | **Loyalty card used an unauthenticated fetch** | `loyalty-card.tsx` (GET loyalty + POST redeem) and the customer-history fallback | The system authenticates with a Bearer token in localStorage; `credentials:'same-origin'` alone sends no credentials → permanent "Authentication required." + Retry in every customer sheet; points redemption could never work. |
| F3 | **`/api/customers/top` queried a column that does not exist** (`status` instead of `paymentStatus`) | `customers/top/route.ts` | The "Top Customers" widget's API returned **500 on every call, forever** (PrismaClientValidationError, "Unknown argument `status`"). |
| F4 | **Role checks not surfaced in the UI** | `customers-tab.tsx` | Cashiers/managers saw a "Record Payment" button that could only ever end in 403. |

We also hardened the server validation order (F1 companion): required-field
presence is now checked **first** and the response names exactly which fields
are missing; a zero amount now reports "must be greater than zero" instead of
"required". `amountOwed / amountPaid / balance` are now emitted as JSON
**numbers** (not Prisma-Decimal strings), preventing the string-concatenation
class of bugs that previously hit the P&L and payroll screens.

### Step 6 — Fixes, deployment and live verification

All fixes were merged to `main` (PR #37 + PR #38) and deployed as **v2.4.0**.
Live verification on production, as the admin user, on the Nakuru branch:

1. **Recorded a real payment** for Kenya Plumbing Co. (KES 506, Cash, the
   full small debt):
   - Toast: **"Payment recorded! New balance: Ksh 0.00"** ✅
   - Debt record `cmty2mok0002gkz04haqndaqp` became **SETTLED** (paid 506 / 506) ✅
   - Customer debt balance updated **54,116 → 53,610** ✅
   - Balanced journal entry posted automatically:
     **JE-20260912-54512 — Dr Cash 506.00 / Cr Accounts Receivable 506.00** ✅
   - Tamper-evident audit entry + debt-payment ledger row written ✅
2. **Loyalty card now loads** (points, tier, "Redeem Points" button) — no more
   "Authentication required." ✅
3. **Top Customers endpoint now returns 200** with real data
   (Kenya Plumbing Co. ranks #3 by spend: Ksh 62,099.50). ✅
4. **Settled debts are protected**: repeating a payment on the settled ledger
   is refused ("Cannot record payment on a settled debt."). ✅
5. **Validation messages are precise**: missing `storeId`+`debtLedgerId` now
   returns "storeId and debtLedgerId are required." ✅
6. **Branch codes are now visible in the UI**: sidebar shows `NAK Nakuru`, and
   the Switch Branch menu shows `JUJ / THI / RUI / NAI / NAK` chips. The
   Payroll → Employees table shows a **Staff No.** column
   (`MBM-NAK-E001…E006`). ✅
7. **Payroll correction delivered** (the June 2026 supplemental run that paid
   deductions on zero earnings, net −2,699.99): verified that run **never
   posted a journal entry and was never paid**, so a reversing GL entry would
   have been wrong; instead a new guarded **VOID** capability was added
   (`POST /api/payroll/runs/[id]/void` — refuses PAID runs and runs with
   posted journal entries) and the run is now **VOIDED** on production with
   the reason recorded for audit. ✅

---

## 3. Recommendations

| # | Recommendation | Status |
|---|---|---|
| R1 | Make the TypeScript type check **blocking** in CI (GitHub issue #8). The missing `storeId` violated the declared contract for months; an advisory check can't catch it. | Open (tracked) |
| R2 | Extend `handleError` to pass through the real HTTP status/code from API failures instead of labelling everything `UNKNOWN_ERROR / 500`. | Open |
| R3 | Sweep for remaining bare `fetch()` calls that need Bearer auth (grep `fetch(\``) — the loyalty card was one of several; use the new `authorizedFetchJson()` helper. | Partially done (loyalty + history fixed); sweep recommended |
| R4 | Keep the role-aware UI pattern: hide actions the signed-in role cannot perform (Record Payment now hidden for CASHIER/BRANCH_MANAGER). Apply the same review to write-offs, voids and price overrides. | Open |
| R5 | Data hygiene: consider a one-time reconciliation view for customers whose `currentDebtBalance` may drift from the sum of their ledger rows (the payment flow now keeps them in sync transactionally). | Open |

---

## 4. Answer to the original question (what changed to fix the feature)

**The dialog now sends `storeId` with every debt payment** — that single
omission was the root cause of the reported error. Additionally:

- `loyalty-card.tsx` and the history fallback now send the Bearer token
  (fixes the "Authentication required." box in the customer sheet).
- `/api/customers/top` now filters on `paymentStatus` (real column) and
  `transactionType='SALE'` — the widget works again.
- The Record Payment button is hidden from roles without payment rights.
- The server names missing fields exactly and rejects zero/negative amounts
  with the right message.
- All money fields on debt rows are JSON numbers.

**Result: the debt payment recording feature for Kenya Plumbing Co. (and every
other customer) is fully functional, with a balanced audit trail.**

*Report produced by the QA engagement of 12 Sept 2026. Test evidence:
API request/response transcripts, browser console captures and database
state checks recorded in the work log.*

---

# Supplement (v2.4.1) — Follow-up QA round of 12 Sept 2026

**Report version:** 2.0 · App version: 2.4.0 (re-tested) → 2.4.1 (fix verified live)

## S1. What we re-tested

With v2.4.0 live, we re-ran the full engagement end to end:

1. **Release verification** — `/api/health` reported `2.4.0`; both Vercel
   deployments green on the release commit; GitHub Releases `v2.3.0` and
   `v2.4.0` published.
2. **Role matrix re-probe (API)** — the same five personas, same operation.
3. **Browser golden path** — fresh SUPER_ADMIN login → branch switch to
   Nakuru → Customers → Kenya Plumbing Co. → **Record Payment**: amount
   `10,000`, method `M-Pesa`, reference `QGH7X2KM9P` → submit.
4. **CASHIER browser check** — fresh login as a Nakuru cashier.

### Golden-path result (all verified against the live database)

| Check | Result |
|---|---|
| Toast | `Payment recorded! New balance: Ksh 43,610.00` (53,610 − 10,000 exact) |
| Debt ledger | `amountOwed 53,610 · amountPaid 10,000 · balance 43,610 · PARTIAL` |
| Customer | `currentDebtBalance 43,610` |
| Journal entry | `JE-20260912-BF78C` "Debt payment received from Kenya Plumbing Co. — KES 10,000" — Debit 10,000 = Credit 10,000 (balanced) |
| Audit trail | `DEBT_PAYMENT_RECORDED` row written |
| UI | Dialog live-updated to `Ksh 43,610.00 / PARTIAL` without reload |

The dialog form also behaved correctly before submit: the submit button is
disabled while the amount is empty, choosing `M-Pesa` reveals a transaction
code field, and quick-fill buttons (Full / Half / 5,000 / 10,000) work.

**The originally reported defect is fixed and stays fixed.**

## S2. NEW defect found during this round — cross-tenant data reads (critical)

While documenting role differences we found a **tenant-isolation hole**, now
fixed in **v2.4.1** (PR #40).

### How it showed up

- A **juja STORE_OWNER** could `GET /api/debt?storeId=store_nakuru` and read
  **Nakuru's 20 debt ledgers**.
- A **Nakuru CASHIER** could `GET /api/customers?storeId=store_thika` and read
  **Thika's customers** — and the cashier's own **UI Customers tab silently
  rendered Juja's customers**, because the app persists the last-selected
  branch in localStorage (default `store_juja_main`) and non-admin users
  cannot switch branches.

### Root cause (two layers)

1. **Backend — `injectTenant()` (src/lib/db.ts) trusted routes to validate
   `storeId`.** The ORM helper passed through any explicitly-provided
   `where.storeId` "because requireStoreAccess guarantees non-admin callers
   can only request their own store". That guarantee only holds for the 44
   routes that actually use `requireStoreAccess`; list routes such as
   `/api/debt` and `/api/customers` read `storeId` straight from the query
   string. Result: role checks passed (a cashier *may* read customers), but
   the *store* filter was whatever the caller typed.
2. **Frontend — persisted `currentStoreId`.** The Zustand app store persists
   `currentStoreId` (default `store_juja_main`) and syncs nothing to the
   logged-in user, so branch-scoped staff could end up querying another
   branch's data at the UI layer too.

### The fix (v2.4.1, PR #40, verified live)

1. **`injectTenant()` always narrows.** Pass-through only when the caller's
   `where.storeId` *equals* the tenant store (exact string match); any other
   value (different store id, or object filters like `{in:[...]}`) is
   AND-narrowed with the tenant store id — a query can now only ever
   **shrink** its scope, never widen it, for all 27 store-scoped models at
   once. Existing `AND` clauses are preserved.
2. **`syncStoreScopeToUser()`** re-aligns the persisted branch with the
   session user's own store on login, `fetchUser`, `setUser` and boot
   hydration. SUPER_ADMIN keeps branch switching.
3. **10 new regression tests** (`src/__tests__/lib/tenant-scoping.test.ts`);
   full suite 414/414.

### Post-fix verification (live on production, v2.4.1)

| Probe | Before | After |
|---|---|---|
| Nakuru CASHIER → Juja customers | 30 rows | **0 rows** |
| Nakuru CASHIER → Thika customers | 30 rows | **0 rows** |
| Juja STORE_OWNER → Nakuru debt ledgers | 20 rows | **0 rows** |
| Own-store reads (all roles) | 30 customers / 20 debts | unchanged ✓ |
| SUPER_ADMIN cross-store reads | all stores | unchanged ✓ |
| Nakuru cashier UI Customers tab | showed Juja customers | shows **Nakuru** customers incl. Kenya Plumbing Co. ✓ |
| `/api/health` | — | `2.4.1 healthy` |

## S3. Additional observations (minor, non-blocking)

- **RBAC in the UI is correct**: the CASHIER sees **no** "Record Payment"
  button (server would 403 anyway); "Redeem Points" IS shown and works for
  cashiers (a POS-counter capability — intended).
- **Customer-history mismatch UX**: pre-fix, a cashier viewing an
  out-of-store customer saw "Customer not found. [Retry]" because single-row
  lookups were already tenant-narrowed while list reads leaked. Post-fix the
  mismatch is gone; consider a friendlier "Not available in your branch"
  message for blocked lookups in future.
- **Error normaliser still labels 4xx as `UNKNOWN_ERROR / 500`** (v2.4.0
  report R2) — the misleading label that started this investigation remains
  on the backlog.

## S4. Updated recommendation list

| # | Recommendation | Status |
|---|---|---|
| R1–R5 | (as in v1.0 of this report) | R2/R3 partially delivered; rest open |
| R6 | Rotate `password123` on all populated test accounts | **open — do before go-live** |
| R7 | Sweep ALL routes that accept a `storeId` query param and add `requireStoreAccess` (the ORM fix already enforces isolation; route-level validation improves error messages from "empty list" to explicit 403) | open |
| R8 | Friendly tenant-blocked messaging in UI ("Not available in your branch") instead of "Customer not found. Retry" | open |
| R9 | Consider surfacing tenant-denied reads in the security event feed to detect probing | open |

**Bottom line:** the debt-payment feature works end to end with a balanced
journal trail, and this round's deeper role-matrix testing surfaced and fixed
a genuine cross-tenant read isolation hole (v2.4.1). Data for every branch is
now provably scoped to the logged-in user's own store, with SUPER_ADMIN
retaining org-wide access.

*Supplement produced by the QA engagement of 12 Sept 2026 (round 2).
Evidence: live API transcripts, browser captures, database state checks.*
