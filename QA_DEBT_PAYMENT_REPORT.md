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
