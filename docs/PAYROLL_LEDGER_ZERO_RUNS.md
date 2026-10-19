# Payroll Period Ledger — Zero-Run Honesty (v2.110.0)

## The defect this fixes

The payroll period header's **Ledger drawer** classifies every run of the period into
buckets: posted entries (with proven, recomputed sums), runs in motion (counts, never
priced), and — since v2.100.0 — settled runs with no journal, surfaced as the
**missing-journal alarm** ("this must never happen"), because the header counts their
money while no entry carries it.

The classification was **value-blind**. A run whose payslips sum to **KES 0.00** owes
nothing: there is no journal to post, and the accounting engine produces no lines for
it. Yet the drawer alarmed on it — every single open — for the seeded 0-value LOCKED
REGULAR October run. A "must never happen" alarm that fires routinely trains the eye
to ignore it; the alarm's teeth dull exactly when they are needed.

## The value-aware split (v2.110.0)

`buildPeriodLedger` now reads each run's **payable truth** — `LedgerRunSource.totalNet`,
the sum of the run's payslip nets in KES, served by `GET /api/payroll/period-journal`
(selected straight from the `PayrollRun` row, never recomputed client-side).

For a settled run (`APPROVED` / `POSTED` / `LOCKED`) with no journal entry:

| Condition (at 2dp money precision) | Bucket | Drawer treatment |
| --- | --- | --- |
| `totalNet > 0` — the run **owed money** | `missingJournal` | red block, `role="alert"`, "this must never happen" |
| `totalNet == 0` (including float dust ≤ 0.004) | `zeroRuns` | quiet slate block, **not** an alert: "nothing was payable, so no journal posts — correct by design" |

The rounding goes through the same `money2` helper as every balance proof in the
builder, so a float hair can never fake a zero (masking a real debt) nor fake a debt
(alarming on nothing).

## What the drawer shows

- The **quiet zero block** (`data-testid="payroll-ledger-zero-runs"`): a slate card,
  no `role="alert"`, listing each zero run as a chip — `REGULAR · LOCKED · KES 0.00` —
  with the explicit sentence "This is not the missing-journal alarm." A reader who
  sees only the quiet block knows the period is honest and complete.
- The **red alarm** (`data-testid="payroll-ledger-missing"`) is untouched: it fires
  only for money that truly went missing.
- The drawer's "Nothing posted in this period yet." empty state now also counts zero
  runs before claiming emptiness.

## Invariants pinned by tests

`src/tests/period-journal.test.ts` (describe "the drawer knows a zero when it sees one"):

1. A settled zero-value run rides `zeroRuns`, never the alarm.
2. The alarm keeps its teeth: money owed with no journal still fires.
3. The zero split rounds at 2dp — 0.004 is a zero run.
4. A VOIDED zero run stays nowhere (a closed door is a closed door).
5. A mixed period fills every bucket at once, each with its own truth.
6. The route feeds `totalNet` to the builder.
7. The drawer renders the quiet block and keeps it separate from `role="alert"`.

`scripts/verify-v2-110-0.mjs` re-checks the same contract from the sources of record.

## Run doors (v2.111.0)

Every settled-run chip in the drawer is now a **door**: the zero-run chips
(slate, violet focus ring) and the missing-journal chips (rose) are real
buttons. Clicking one closes the ledger drawer and opens that run's full
detail dialog — one drawer closes, one opens, never two stacked. An audit
starts from the line, not from a hunt.

- Zero chip: `data-testid="payroll-ledger-zero-run-door"`, aria
  "Open the <TYPE> run's detail — a zero-value settled run".
- Missing chip: `data-testid="payroll-ledger-missing-run-door"`, aria
  "Open the <TYPE> run's detail — a settled run missing its journal".
- The quiet block stays quiet: its doors wear slate and a violet focus
  ring; `role="alert"` remains the red alarm's alone.
- Lifecycle proof this release: October's BONUS run (prepared by
  SUPER_ADMIN) was approved by STORE_OWNER — a distinct actor, so the
  maker-checker guard held — then posted with its journal; the drawer now
  carries three posted entries plus the quiet zero run.

## Related contracts

The run gate's own surfaces — frozen verdict, attempt trail, outcome lens,
period dots, and the timesheet desk that answers the TIMESHEET_NOT_APPROVED
block — are catalogued with their honesty rules in
[docs/hr/payroll-run-lifecycle.md](./hr/payroll-run-lifecycle.md), section
"Gate surfaces and contracts".
