# Payroll Run Lifecycle (v2.18.9)

Phase 4.6 of the EMS implementation sequence: the payroll run state machine,
maker-checker approvals, idempotent journal posting, payslip issuance
(numbering + PDF + plain-language trace), and reverse-and-replace corrections.

The computation itself is the v2.18.8 engine (`src/lib/hr/payroll/engine.ts`,
integer cents, golden fixtures). This document covers what wraps it.

## State machine

```
DRAFT ──prepare(/validate)──▶ payslips computed ──submit──▶ PENDING_APPROVAL
  ▲                                                          │        │
  │                                     approve              │        │ reject(reason)
  │                                     (maker ≠ preparer)   ▼        ▼
  └──────────────────────────── REJECTED ◀────────────────── APPROVED
                                                               │        │
                                          post (idempotent journal + payslip numbers)
                                                               ▼        │ void
                                                            POSTED      │
                                                               │        ▼
                                          lock              LOCKED    VOIDED
                                                               │
                                          disburse (mark payslips PAID)
```

- `REJECTED` runs go back to the preparer, who fixes inputs and re-prepares
  (`/validate` works from `DRAFT` **and** `REJECTED`).
- `VOIDED` is terminal and only reachable before posting. Posted runs are
  corrected through PayrollCorrection, never by editing payslips.
- `FAILED` is reserved for unexpected engine/infrastructure failures.

## Maker-checker (spec rule 21)

- The user who **prepares** (submits) a run is recorded in
  `PayrollRun.preparedByUserId`. `/approve` refuses the same user with
  `403 MAKER_CHECKER_VIOLATION` — **regardless of role**. There is no role
  combination (including SUPER_ADMIN) that bypasses the check; approval must
  come from a different human.
- Corrections have the same rule: the requester cannot approve/reject their own
  correction request.

## Permission matrix (existing `hr.*` keys)

| Action | Permission | Roles (fail-closed) |
| --- | --- | --- |
| Create period / create run / prepare (`/validate`) / submit | `hr.payroll.prepare` | HR_MANAGER, STORE_OWNER |
| Approve / reject / void run; approve/reject correction | `hr.payroll.approve` | STORE_OWNER |
| Post journal / lock run | `hr.payroll.post` | STORE_OWNER |
| Disburse (mark payslips PAID) | `hr.payroll.disburse` | STORE_OWNER |
| Request correction | `hr.payroll.correct` | HR_MANAGER, STORE_OWNER |
| Read runs/payslips/corrections | `hr.payroll.read.all` / `.branch` | HR_MANAGER, BRANCH_MANAGER, STORE_OWNER, ACCOUNTANT |

All routes compose `hrGuard` (feature flag + permission + branch scope + deny
logging). Branch context always resolves from the session, never the client.

## Prepare-time gates (spec acceptance #9–#11)

`POST /api/payroll/runs/[id]/validate` computes every active employee and
**blocks the whole run** listing per-employee reason codes when:

- `MISSING_CONSENT` — no active ConsentRecord on file.
- `TIMESHEET_NOT_APPROVED` — unapproved attendance days in the period
  (`hasUnapprovedTimesheet`).
- `RATE_TABLE_MISSING` / `OVERLAPPING_RATE_TABLES` — statutory tables missing
  or overlapping at the period end date.
- `NEGATIVE_NET`, `DEDUCTION_CAP_EXCEEDED` — engine guardrails.

Blocked runs stay in `DRAFT` with the issue list persisted to
`PayrollRun.errorMessage`; the UI renders the codes verbatim.

### Gate surfaces and contracts (v2.135.0 → v2.141.0)

The gate's verdict is not a transient — every surface below reads the same
frozen facts and follows the same honesty rules:

- **Frozen verdict (v2.135.0).** Prepare freezes a snapshot of what the gate
  said — the per-lane counts and the employee codes it acted on — stamped
  with the same clock moment on both the passing and the blocked path. The
  strip never refreshes in place: what prepare said is what the strip says,
  and the live panel speaks for "now". A run with no snapshot (prepared
  before v2.135.0) renders one honest dashed note, never a guessed verdict.
- **Gate trail (v2.138.0).** Every prepare attempt appends one immutable
  `PayrollRunGateEvent` row — outcome (`PASSED`/`BLOCKED`), the attempt's
  own verdict summary, the SAME clock the snapshot froze, and the actor.
  Append-only: no update or delete path exists. The run dialog tells the
  story oldest-first and marks where the verdict text moved between
  attempts; pre-trail prepared runs wear the dashed absence note.
- **Attempt chip (v2.139.0/v2.140.0).** `buildGateAttemptChip` reduces the
  trail to "N attempts · last PASSED/BLOCKED" — pluralized honestly, tone
  following the last outcome, `null` for zero/garbage (the chip NEVER
  invents an attempt). It rides the runs table row beside the frozen
  verdict AND the run dialog's frozen-verdict strip (built from the trail
  the dialog already holds — no extra fetch).
- **Timesheet desk (v2.136.0).** `/hr/timesheets` is the
  `TIMESHEET_NOT_APPROVED` block's remediation door: the pending read
  mirrors the gate's own where/order (parity-pinned), each row approves
  that employee's pending day range through the ONE audited
  `approveTimesheet` service.
- **Batch receipt (v2.139.0).** "Approve all" is a client-side walk of that
  same per-employee service — never a new bulk write path. Failures never
  abort the walk; the end-of-batch receipt (`buildBulkApproveSummary`)
  names every loser with its reason, and a batch that raced the desk says
  "nothing left to approve" instead of wearing a hollow green.
- **Weekends-only lens (v2.140.0/v2.141.0).** The desk's day strips carry a
  view lens (`deskWeekendDays`): "Weekends only" filters the chips to real
  Sat/Sun date-onlys, in order, garbage never passing. It is a preference,
  not a data change — the count chip keeps speaking the row's total, the
  `+N` overflow stays honest about what the lens shows, and a row with no
  weekend days says "no weekend days" rather than vanishing. Since v2.141.0
  the preference persists per browser (`readDeskLensPref`/`writeDeskLensPref`
  over localStorage): a dead storage degrades to OFF, never a crash, and the
  stored key is removed on turn-off rather than littered with a stale `0`.
- **Store gate timeline (v2.141.0).** `GET /api/payroll/gate-timeline` reads
  the SAME append-only `PayrollRunGateEvent` rows ACROSS runs — newest 120
  (the payload says `window` and `totalEvents`, so the card never pretends
  it saw more), with run period/status context attached and movement
  computed CHRONOLOGICALLY by `buildGateTimeline` (a verdict moves from the
  attempt before it, whatever run each belonged to — a run boundary does not
  reset the comparison). The card renders newest-first, best-effort by
  design (a timeline failure wears the card's rose error, never the page's),
  honest empty for a store that has never prepared, and a "Show all"
  toggle past eight rows. Same vocabulary everywhere: outcome verbatim,
  `Verdict unreadable` for garbage, movement marked with the sky pill.

## Posting (spec acceptance #1–#4)

`POST /api/payroll/runs/[id]/post` (from `APPROVED`):

1. Aggregates the stored **integer-cent** traces of all payslips per account
   (5200 salaries expense, 5210/5215 employer shares, 2210 PAYE, 2215 NSSF,
   2220 SHIF, 2225 housing, 2250 other, 2240 net payable) and asserts
   `Σdebits === Σcredits` (`JOURNAL_IMBALANCE` otherwise).
2. Verifies every account exists and is active for the organisation
   (`MISSING_CHART_ACCOUNT`; run `scripts/seed-payroll-accounts.mjs` to seed).
3. Posts **one combined journal entry through the existing
   `createJournalEntry` helper** with `idempotencyKey = payroll-run:{runId}` —
   a retried post returns the same entry and never double-journals.
4. Issues payslip numbers `PS-YYYYMMDD-NNNN` (gapless per-store sequence) and
   stamps `payslipIssuedAt`.
5. Flips any corrections waiting on this replacement run to `APPLIED`.

## Payslips (spec acceptance #5, #7)

- `GET /api/payroll/runs/[id]/payslips` — shaped views; statutory identifiers
  (national ID, KRA PIN, NSSF/SHIF numbers, bank account, M-Pesa number) are
  `[REDACTED]` unless the viewer holds `hr.employee.unmask.pii` (own-payslip
  self-service arrives with Stage G).
- `GET /api/payroll/payslips/[id]/pdf` — zero-dependency PDF 1.4 writer fed by
  the **already-masked** view; the writer has no database access.
- `GET /api/payroll/payslips/[id]/trace` — engine steps plus plain-language
  sentences ("NSSF is deducted first; PAYE is computed on gross pay minus
  NSSF…") and the rate-table ids that produced every statutory line.

## Corrections: reverse and replace (spec acceptance #7, #8)

Issued payslips are immutable. `PayrollCorrection` requests carry a type:

| Type | Adjusting entry (balanced, idempotencyKey `payroll-correction:{id}`) | Replacement |
| --- | --- | --- |
| `UNDERPAYMENT` (+cents) | DR 5200 / CR 2240 | SUPPLEMENTARY run (idempotencyKey `payroll-correction-replacement:{id}`) |
| `OVERPAYMENT` (−cents) | DR 2240 / CR 5200 | SUPPLEMENTARY run |
| `REVERSAL` | Engine journal of the original payslip with debits/credits swapped | none (full reversal) |

The replacement run is a normal draft run — it goes through prepare →
maker-checked approve → post like any other, and posting marks the correction
`APPLIED`. Nothing ever edits a `PayrollDetail` row.

## Storage conventions

- `PayrollDetail` money columns are KES `Decimal` (pre-engine schema); the
  exact integer-cent truth travels in `computationTrace` JSON together with
  `rateTableIds` and `roundingAdjustmentCents`, so figures stay reproducible
  (future P10 extracts read these stored lines, never recomputed math).
- `PayrollRun.idempotencyKey` is a `@unique` natural key (EMS data model
  delta) for external triggers.

## Disbursement

Two disbursement paths exist for POSTED/LOCKED runs (both STORE_OWNER,
`hr.payroll.disburse`):

1. **Manual confirmation** — `POST /api/payroll/runs/[id]/disburse` marks
   `PENDING` payslips `PAID` with a payment reference and timestamp (bank
   transfer, cash, or an external payroll platform).
2. **M-Pesa B2C (v2.21.0)** — `POST /api/payroll/runs/[id]/disburse-mpesa`
   sends every `PENDING` payslip with net pay above zero to the employee's
   registered phone number as a Daraja B2C `SalaryPayment`:

   - One payslip has at most one active `MpesaTransaction` (additive nullable
     `payrollDetailId` column); re-running the action skips, never double-pays.
   - **Real mode** (Daraja B2C credentials configured): payslips stay `PENDING`
     until Safaricom calls `/api/payments/mpesa/b2c/result`, which is claimed
     exactly once per transaction and settles the payslip `PAID` with an
     `MPESA-<receipt>` reference (append-only bypass, audit logged). Failures
     (wrong number, unregistered recipient) leave the payslip `PENDING` for
     retry after the cause is fixed.
   - **Mock mode** (credentials absent): transactions complete immediately with `SIM…` receipts and payslips settle so QA can exercise the whole loop. Development defaults to mock; a production build must opt in with `MPESA_B2C_ALLOW_MOCK=true` (staging/hermetic QA; the opt-in is recorded in the audit event). Without the opt-in production refuses with `B2C_NOT_CONFIGURED` — money movement is never silently simulated.
   - Employees without a phone number are **skipped with a reason** (reported
     in the response summary), not failed; per-employee initiation failures
     are reported without aborting the batch.
   - The result webhook reuses the C2B callback security contract (HTTP Basic
     credentials + optional IP allowlist + SecurityEvent logging).

## Verification

- `npm test` — `src/tests/lib/payroll-run-lifecycle.test.ts` (22 cases):
  state machine, maker-checker, gate blocking, idempotent balanced posting,
  chart-account readiness, reversal line swap, replacement-run creation.
- `npm test` — `src/tests/lib/payroll-b2c-disbursement.test.ts` (13 cases):
  state guard, production mock refusal, phone/amount validation, idempotent
  re-run, no-phone skip, per-employee failure isolation, mock settlement,
  webhook settlement exactly once, duplicate delivery, failed-result handling.
- `npm run verify:payroll-lifecycle` — static contract checks (routes, masking,
  idempotency keys, no float math, audit coverage).
- `npm run verify:b2c` — static contract checks for the B2C wiring (schema
  column, Daraja payload, idempotency, webhook auth, UI affordances).
