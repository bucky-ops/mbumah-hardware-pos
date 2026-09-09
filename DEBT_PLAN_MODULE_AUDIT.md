# Debt Plan Module — Comprehensive Audit Report

**Repository:** bucky-ops/mbumah-hardware-pos
**Branch:** `feature/debt-plan-hardening` (audited baseline: `main` @ `485d016`)
**Scope:** the Debt Payment Plan module end-to-end — `src/app/api/debt-payment-plans/**`, `src/lib/debt-plan-utils.ts`, `src/lib/db.ts` (tenancy layer), `src/app/tabs/debt-plans-tab.tsx`, `src/components/debt-plans/**`, `src/lib/api.ts` (client), `prisma/schema.prisma`, tests.
**Task reference:** Task 12-d (continues the Task 12-a/b/c remediation lineage already recorded in this repo's worklog).

---

## 1. Executive summary

The module's core money paths were already hardened in Task 12-c (atomic installment/debt-ledger claims, canonical `round2`, Decimal accumulation). This audit found that **the hardening stopped one layer short**: the plan *row itself* was mutated with read-modify-write totals that can be lost to concurrency, waivers over-credited customers on partially-paid installments, defaulted plans had **no exit from their state**, the stored `installmentAmount` disagreed with the actual schedule under interest, and — most seriously — **`DebtPaymentPlan` was missing from the ORM tenancy allowlist**, which let single-plan API routes touch other stores' plans by ID.

14 defects were confirmed (1 critical security, 5 high, 8 medium) plus 9 low-severity issues and 4 dead-code items. All items marked ✅ in §3 are fixed and regression-checked in this branch.

---

## 2. Findings

### CRITICAL

| ID | Location | Issue | Fix |
|---|---|---|---|
| **C1** | `src/lib/db.ts` (`STORE_SCOPED_MODELS`) | **IDOR / cross-tenant access on payment plans.** `debtPaymentPlan` carries a `storeId` column but was absent from the tenancy allowlist. The list route self-scopes via a validated query param, but `GET/PATCH/DELETE /api/debt-payment-plans/[id]`, `/approve`, `/pay`, `/waive` and `/installments` all load plans with a bare `findUnique({ where: { id } })` — no Layer-4 injection, no explicit check. Any ACCOUNTANT/MANAGER of store A could read, approve, pay, cancel or delete store B's plans by ID. | Added `"debtPaymentPlan"` to `STORE_SCOPED_MODELS`. `injectTenant` now ANDs the caller's `storeId` into every plan query (incl. `findUnique`, which Prisma supports via extendedWhereUnique). Installment-level claims stay safe because every route first loads (now tenant-narrowed) the plan and verifies the installment belongs to it. |

### HIGH

| ID | Location | Issue | Fix |
|---|---|---|---|
| **H1** | `waive/route.ts:116-117,143-224` | **Over-credit on partial-installment waivers.** The waive path computed `waivedAmount = amountDue` regardless of `amountPaid`. For an installment paid 1,000 of 5,000, the pay route had already decremented the debt ledger + `customer.currentDebtBalance` by 1,000 — waiving then decremented them by the **full 5,000**, over-crediting the customer by 1,000 and understating the plan balance by the same amount (plan `totalAmount` was also reduced by `amountDue` instead of the forgiven remainder). | Waive only the **unpaid remainder** `amountDue − amountPaid`, computed from the authoritative **in-transaction** row (also closes the outside-read → claim race). Plan `totalAmount`, ledger `amountOwed/balance`, and customer balance now all decrement by exactly the remainder. A concurrently-fully-paid installment returns a retryable 409-style conflict. |
| **H2** | `debt-plan-utils.ts:188-199` vs `:139-175` | **Interest model divergence.** `calculateInstallmentSchedule` pro-rated simple interest by plan duration (`rate × durationYears`) while `calculateInstallmentAmount` applied the rate as a flat one-off (`1 + rate/100`). The create route wrote `installmentAmount` from the flat helper — so the stored per-installment amount disagreed with the actual schedule for any plan shorter than a year (12% on 6 monthly installments: schedule charged 1.06× total, the column said 1.12×). | New `calculateTotalWithInterest(total, count, frequency, rate)` is the single source of truth; both the schedule and `calculateInstallmentAmount` (new `frequency` param) flow through it. The create route now derives `installmentAmount` **from the schedule itself** (`schedule[0].amountDue`, with the final installment as the rounding absorber). The create-plan dialog preview was rewritten to run the exact server schedule. |
| **H3** | `pay/route.ts:99-107`, `waive/route.ts:87-95`, `[id]/route.ts` PATCH | **DEFAULTED plans were bricked.** `getPlanStatus` flips a plan to DEFAULTED at ≥25% overdue installments — and the old guards then rejected every path out: pay/waive required ACTIVE/PAUSED (so the *cure* payments were rejected), PATCH had no transition from DEFAULTED, and DELETE only accepted PENDING_APPROVAL/CANCELLED. | Pay and waive now accept DEFAULTED (catch-up/cure; the status re-derivation automatically promotes back to ACTIVE once the overdue ratio drops). PATCH accepts DEFAULTED → CANCELLED. The details dialog surfaces a DEFAULTED banner and enables installment actions. |
| **H4** | `pay/route.ts:196-199`, `waive/route.ts:151-159` | **Lost-update on plan totals under concurrent pay/waive.** Installment-level claims are atomic, but the plan-row `amountPaid/balance/installmentsPaid/installmentsOverdue` write was an absolute overwrite recomputed from an **outside-tx snapshot** with only the current installment patched. A concurrent pay/waive on a *different* installment of the same plan could be silently reverted. | Totals are now recomputed from a fresh **in-transaction** `findMany` of all installments (own writes visible), then persisted. |
| **H5** | `payment-plan-card.tsx:40-42` + list route | **Next-due data was never present on list rows.** The list endpoint included only `_count`, so the card's `installments?.find(...)` was always `undefined` — "Next: <date>", the overdue date, and the "Payable" badge never rendered anywhere. | The list response now includes a minimal `nextInstallment` (first unpaid installment via `take: 1` nested include); the card prefers it and keeps the `find` fallback for full payloads. |

### MEDIUM

| ID | Location | Issue | Fix |
|---|---|---|---|
| **M1** | `approve/route.ts:65-76` | Approval did check-then-write: two concurrent approvals both passed the `PENDING_APPROVAL` pre-check and both wrote — the second silently overwrote the first approver's record. Also: no `approvedAt` anywhere in the schema (WHO without WHEN), and the response returned the raw Prisma row with unserialized Decimals (JSON stringifies them as strings). | Single atomic `updateMany({ where: { id, status: 'PENDING_APPROVAL' } })` with a count check → race loser gets 409. `approvedAt` stamped (additive schema field + migration `20260909120000_add_plan_approved_at`). Response serialized via the shared helper. |
| **M2** | `route.ts` (list) | Unbounded `findMany` — the grid rendered every plan in the store forever, and the `overdue=true` filter used the denormalized `installmentsOverdue` counter that only healed on detail visits (stale chip counts). | Server pagination (`page`/`pageSize`, cap 100, response envelope matches `ApiResponse.pagination`); the overdue filter now uses a live installment predicate (`dueDate < now AND status IN (SCHEDULED, PARTIAL, MISSED)`); one idempotent conditional sweep flips stale installments to OVERDUE before listing; live per-page overdue counts via a single `groupBy`. |
| **M3** | `route.ts` (create) validation gaps | `interestRate` accepted any number (a 1000000% rate produced a valid plan); `lateFee` unbounded; invalid `frequency` silently coerced to MONTHLY (masking client bugs); malformed JSON escaped as 500; `total > debtBalance + 0.5` slack allowed a plan to exceed the debt by half a KES; the customer was store-checked only implicitly (SUPER_ADMIN's tenant bypass could couple a cross-store customer to a ledger). | Rate bounded 0–100, fee bounded 0–100,000, strict frequency validation (400), JSON guard → 400, epsilon tightened to 0.01, explicit `customer.storeId === storeId` check, notes length cap. |
| **M4** | `stats/route.ts:38-42,72-75` | `totalOutstandingBalance` counted only ACTIVE/PAUSED plans — DEFAULTED balances (the most at-risk money) were invisible on the dashboard. | New additive `totalDefaultedOutstanding` field; surfaced as a trend line on the Outstanding stat card. |
| **M5** | `record-payment-dialog.tsx:69-78,109` | The amount prefill lived in an `onOpenChange` wrapper, but the parent opens the dialog **programmatically** (`open={Boolean(payInstallment)}`) and Radix only fires `onOpenChange` for user-initiated transitions — the prefill never ran, and the previous payment's amount persisted into the next open (it could even be silently submitted when ≤ the new remaining). | Dialogs are now remounted per open (`key={installment?.id ?? 'none'}` in the parent) and the amount initializes from the installment's remaining balance — no effects, no stale state. |
| **M6** | `create-plan-dialog.tsx:214-215` | The success path called the raw `onOpenChange`, bypassing the reset — reopening showed the previous customer/debt/amount pre-selected. | Success now routes through the reset path (`handleOpenChange(false)`). |
| **M7** | `create-plan-dialog.tsx:92-105` | Customer search was not debounced (the comment claimed staleTime debounces — it doesn't); a keystroke per character fired `GET /api/customers`. | 300 ms debounce before the value enters the query key. |
| **M8** | `debt-plans-tab.tsx:233-266` | A load failure was toast-only; the grid showed the *empty state* ("No payment plans yet") — error indistinguishable from no data. | Explicit rose error banner with a Retry button; truncation indicator when the server page cap hides plans. |

### LOW / hygiene

| ID | Location | Issue | Fix |
|---|---|---|---|
| L1 | `[id]/route.ts:59-117` | GET re-fetched the plan up to 3× and carried a `void markOverdueInstallments;` dead-import hack instead of using the util exported for exactly this purpose. | Single fetch; statuses merged in memory from the util; totals persisted once; dead hack removed. |
| L2 | 6× inline serializers | The same ~20-line Decimal→number block was copy-pasted in every route (and 6 slightly different shapes). | Shared `serializePlanRow` / `serializeInstallmentRow` in `debt-plan-utils.ts`; all routes now emit one consistent shape. |
| L3 | `waive-installment-dialog.tsx:160-180` | `getPaymentHistory`, `getInstallmentDateLabel` and a type re-export were exported and never imported (details dialog duplicates the logic inline). | Removed; the inline logic in the details dialog is the live implementation. |
| L4 | `create-plan-dialog.tsx:56-58` | `presetCustomerId` / `onCreated` props accepted but never passed by any caller ("launch from Customers tab" was never wired). | Removed until the feature exists (dead surface). |
| L5 | `debt-plans-tab.tsx:304` | Dead `export type { DebtPlanStatus }` re-export with zero consumers. | Removed. |
| L6 | `payment-plan-card.tsx:49-51` | Whole-card `onClick` without keyboard parity. | `role="button"`, `tabIndex`, Enter/Space handler, aria-label. |
| L7 | `debt-plans-tab.tsx:206-227` | Filter chips: selected state was color-only. | `aria-pressed` added. |
| L8 | `create-plan-dialog.tsx:342,391,377-383` | 2-column grids cramped on phones; slider had no accessible label and capped at 24 while the server allowed 60. | `grid-cols-1 sm:grid-cols-2`, `aria-label` on the slider, UI cap aligned to the server's 60. |
| L9 | `plan-details-dialog.tsx:559` | Float subtraction + no clamp on "next installment" remaining. | `Math.max(0, amountDue - amountPaid)`. Also: Cancel Plan now requires an AlertDialog confirmation (it was the only destructive action without one); date-only inputs parsed as local dates, not UTC midnight. |

### Verified NON-issues (checked, working as designed)

- **List-route tenancy** — `withFinancialAuth` → `requireStoreAccess` rejects any `storeId` param different from the caller's store (auth.ts:397-413); single-route tenancy is now closed by C1.
- **Response-shape handling in the UI** — every consumer uses `res.data`; no `res.waLink`-style bugs in this module.
- **Double-submit** — all mutations disable their buttons while pending; server-side claims make concurrent double-pay/waive safe regardless.
- **Money formatting** — canonical `formatKES` everywhere; no string-concatenated amounts (the one float subtraction was L9).
- **Existing test suite** — `debt-helpers.test.ts` green (85/85). `financial-remediations.test.ts` has 7 failures that reproduce identically on pristine `main` (environment-dependent, pre-existing; not touched by this branch).

---

## 3. Changes in this branch (files)

**Backend**
- `src/lib/db.ts` — C1 tenancy fix.
- `src/lib/debt-plan-utils.ts` — H2 interest unification (`calculateTotalWithInterest`), serializer consolidation (L2).
- `src/app/api/debt-payment-plans/route.ts` — H2, H5, M2, M3 (+ pagination envelope).
- `src/app/api/debt-payment-plans/[id]/approve/route.ts` — M1.
- `src/app/api/debt-payment-plans/[id]/route.ts` — H3 (DEFAULTED→CANCELLED), L1, M3-style JSON guard, shared serializer.
- `src/app/api/debt-payment-plans/[id]/installments/[installmentId]/pay/route.ts` — H3, H4, L2.
- `src/app/api/debt-payment-plans/[id]/installments/[installmentId]/waive/route.ts` — H1, H3, H4, L2.
- `src/app/api/debt-payment-plans/stats/route.ts` — M4.
- `prisma/schema.prisma` + `prisma/migrations/20260909120000_add_plan_approved_at/migration.sql` — M1 (additive, nullable).

**Frontend**
- `src/lib/api.ts` — `approvedAt`, `nextInstallment`, `totalDefaultedOutstanding`, list pagination params + typed pagination envelope.
- `src/components/debt-plans/payment-plan-card.tsx` — H5, L6, L9 (dangling "Completed").
- `src/components/debt-plans/record-payment-dialog.tsx` — M5, L9 (formatDate).
- `src/components/debt-plans/waive-installment-dialog.tsx` — H1 (UI half: remaining + partial explainer), M5, L3.
- `src/components/debt-plans/create-plan-dialog.tsx` — H2 (exact preview), M6, M7, L4, L8.
- `src/components/debt-plans/plan-details-dialog.tsx` — H3 (banner + actions), M1 UX (creator cannot approve — hidden with explanation), M5 (keys), L9 (cancel confirmation, clamp).
- `src/components/debt-plans/plans-stats-cards.tsx` — M4.
- `src/app/tabs/debt-plans-tab.tsx` — M2 (capped fetch + truncation indicator), M8, L5, L7.

**Tests**
- `src/tests/lib/debt-helpers.test.ts` — updated to the new `calculateInstallmentAmount(total, count, frequency, rate)` signature; new case pinning the pro-rated interest behavior. **85/85 green.**

---

## 4. Known limitations & recommendations (not in this PR)

1. **"Collected This Month" is an approximation.** Installments partially paid across two months are counted in full in the month of the last payment. A per-plan payment ledger (`DebtPlanPayment` rows, or reusing `DebtPayment` with a `planId` column) would make it exact and enable real MRR-style cohort reporting.
2. **No cron driver for the overdue sweep.** The sweep is lazy (detail GET, pay/waive, and now the list endpoint). Fine at current scale; a nightly job would also drive MISSED-status marking (currently dead), late-fee application (`lateFee`/`lateFeeApplied` are stored but never applied), and reminder escalation via `scheduleReminders`.
3. **`autoCharge` is stored but never charged** — M-Pesa STK push on due dates needs a scheduler + Daraja integration; until then the toggle is aspirational (labelled as requiring consent).
4. **Installment rows carry no `storeId`** — they inherit tenancy through their plan. If installments are ever queried directly at scale, consider a backfilled `storeId` for first-class tenancy + faster bucket queries.
5. **Frequency set is WEEKLY/BI_WEEKLY/MONTHLY** — DAILY/QUARTERLY would need `unitsPerYear` extension in `calculateTotalWithInterest` only (single place by design now).
6. **`getPlanStatus` 25% DEFAULTED threshold is a policy constant** — consider exposing it per store (some stores want 2-missed-installments semantics).

## 5. Deployment notes

- Migration `20260909120000_add_plan_approved_at` is additive/nullable — `bun run db:migrate:deploy` (Postgres/Neon) or `bun run db:push` (local SQLite) with zero downtime and no data backfill required.
- No breaking API changes: new response fields are additive; the list endpoint's new `pagination` envelope matches the pre-existing `ApiResponse.pagination` type; unknown-field consumers are unaffected.
- After deploy, the C1 tenancy fix takes effect immediately — any existing integrations that (incorrectly) read cross-store plans will start receiving 404s.
