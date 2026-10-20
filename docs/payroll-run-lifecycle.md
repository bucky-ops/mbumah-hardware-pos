# Payroll run lifecycle — contracts that already ship

Landing pad for the payroll run lifecycle phase (EMS spec v2.18.9 slot).
Before the phase's own gates get specced, this page pins the contracts the
shipped surfaces already enforce, so the lifecycle work inherits them instead
of re-deciding them. Each contract names the release that set it.

## The gate contract (as shipped)

- `prepare` is the run gate's only door. A run that cannot pass the gate is
  never half-created: the API refuses, the UI explains, nothing persists.
- Known gate blocks, each with a working UI desk (a gate row is never a
  read-only number):
  - `TIMESHEET_NOT_APPROVED` — the timesheet desk at `/hr/timesheets`
    (v2.136.0): pending read with line-for-line where-parity against the
    gate, one-button range approve through the single `approveTimesheet`
    service, `?employee=<id>` deep link focusing the row from the gate.
  - Employee consent (v2.131.0): the payroll gate panel links the same
    consent surfaces the desk uses.
- Every gate row that offers an escape renders it as a door (link/button)
  with an per-row `aria-label`, amber for "action clears the block".
- Gate verdicts and attempt chips are frozen on the run and rendered by the
  tolerant pure builders — a pre-verdict run renders nothing, never a guess
  (v2.135.0/v2.139.0).

## The accessibility contract (v2.147.0)

- Every interactive control is named **on itself**. Radix Select: the
  accessible name sits on the `SelectTrigger`, never on the root — the root
  never forwards it to the button. A bare `<span>`/`<p>`/`<div>` cannot
  carry `aria-label`; use an explicit role (`note`, `group`, `timer`,
  `region`) or an element whose implicit role accepts naming.
- Every table sits inside a scroll wrapper (`overflow-x-auto`); the page
  itself never scrolls horizontally.
- The ten-link header nav wraps (`flex-wrap`); at 390px every link stays
  visible and tappable.

## The shell contract (v2.148.0)

- The skip link is the first focusable element of the shell; its handler
  `preventDefault()`s and explicitly focuses `<main>` (SPA routers swallow
  fragment-focus; keep the `href` as the no-JS fallback).
- Every scrollable region is keyboard-reachable: `tabIndex={0}` + an honest
  `aria-label` + a `focus-visible` ring. A scroller with no focusable
  descendant is a violation (scrollable-region-focusable).
- Status pills wear their own passing tokens (red-600/white, amber-500 on
  slate-950); no `animate-pulse` on text that axe must measure.

## The width contract (v2.149.0)

- The unified console `<main>` carries `w-full min-w-0`: cross-axis auto
  margins (`mx-auto`) disable stretch and size main to fit-content — without
  `min-w-0` the widest descendant's intrinsic min-content becomes the
  console's width (measured: a 978px table min-content pushed the org
  console to 1012px at a 390px viewport).
- Every scroll wrapper ALSO carries `min-w-0`: a block scroll container does
  not zero its own min-content contribution, so an unwrapped min-width
  propagates through it even while it scrolls.
- Grid tracks use Tailwind's `grid-cols-N` (`minmax(0,1fr)`) — never raw
  `auto` columns that inherit content min-content.
- The spec line "No horizontal scroll on supported viewports" is checked at
  390px on every console surface (`documentElement.scrollWidth === 390`).

## The contrast contract (v2.148.0 + v2.149.0)

- Small text (below large-text thresholds) clears 4.5:1 on its real
  background — `amber-600`/`emerald-600`/`slate-400`/`slate-300` are not
  light-mode text tokens on white. The passing family:
  `amber-700`, `emerald-700`, `slate-500` (with `dark:` variants kept where
  the dark background flips the math).
- axe "incomplete" contrast nodes are resolved numerically in the round's
  QA notes, never waved through.

## The B2C auto-recovery contract (v2.155.0)

- Recovery is DURABLE, not dialog-bound: the hourly cron dispatcher folds a
  `b2c-recovery` sub-job (route `/api/cron/b2c-recovery`, service
  `src/lib/hr/payroll/b2c-recovery.ts`) that walks every posted/locked run
  still holding unpaid money (oldest first, capped 25 runs/tick) and applies
  the SAME gate arithmetic the run dialog uses.
- One source of truth: `pickB2CRecoveryActions` reads the run's
  `summariseRunB2CState` and re-sends only latest-FAILED, unsettled payslips
  whose `evaluateB2CRetryGate` allows (backoff elapsed, ceiling not hit);
  stuck PROCESSING past `B2C_STALE_PROCESSING_MS` triggers one re-query
  sweep. The cron can never be more aggressive than the UI — only more
  punctual.
- Idempotency is inherited, never re-invented: `initiatePayrollB2C` refuses
  a payslip with an active transaction, so overlapping ticks cannot
  double-pay. Ceil-blocked payslips (5 attempts) stay human-only.
- Environment discipline: in production without Daraja credentials and
  without `MPESA_B2C_ALLOW_MOCK`, the sweep early-outs (`configured:false`)
  before touching the database. Audit rows carry the sentinel actor
  `system:b2c-recovery` (AuditLog.userId is a plain nullable string).
- The run dialog says so: a `b2c-auto-recovery-note` truth line renders on
  posted/locked runs with the disburse permission — the backoff chips are
  advisory, not the only path home.
- The sweep is dispatched hourly — see `docs/cron-operations.md` for the
  production cadence story (Vercel's daily 03:00 UTC tick + the hourly
  GitHub Actions pinger), the `CRON_SECRET` arming contract, and the tick
  ledger / org-console Automation pulse card that make a healthy dispatch
  distinguishable from a silent one. The backoff windows (2m–30m) only
  regain their designed meaning once the hourly cadence is armed.

## The tabs contrast sweep (v2.155.0)

- The 19-tab POS shell family audited at 390px: every tab holds
  `scrollWidth === 390`; seven tabs carried the tinted-bg text failures the
  console family had already fixed — the same lesson-65 classes, tab-side.
- The standing text families (light tokens, `dark:` pairs kept):
  `green-700`, `emerald-700`, `sky-700` for text; `bg-emerald-700` (hover
  `bg-emerald-800`) for white-text fills; `from-emerald-600 to-emerald-700`
  for white-text gradients; bare `text-muted-foreground` (never `/70`) at
  10px. Numeric passes on the palette: green-700 on gray-50 4.80:1,
  emerald-700 on white 5.49:1, sky-700 on sky-50 5.57:1, white on
  emerald-700 5.49:1.
- Dark-mode hover convention: dark rest tokens darken LESS than light ones
  (`dark:bg-emerald-700` with `dark:hover:bg-emerald-600`) — protect `dark:`
  substrings BEFORE any family sweep, and re-check `dark:hover` pairs after.

## The amber + muted-alpha families (v2.156.0)

- The v2.155.0 re-audit on the shipped build surfaced the NEXT layer
  (lesson 64, fourth consecutive round): the amber text family (3.17-3.19:1
  on white) and the 9-10px muted-alpha helper lines (/60 measured 2.51:1,
  /70 3.07:1). The standing fix rides the same discipline: `amber-700`
  light tokens (hover pairs one step to -800), bare `text-muted-foreground`
  (5.76:1) — never alpha-muted below /80 for small text.
- The census-before-sweep ritual: grep the exact token AND its `dark:`
  twin AND its hover/focus prefixes; protect dark: substrings first; after
  the sweep grep for doubled tokens in both orders. `dark:text-amber-600`
  and `dark:text-muted-foreground/N` do not exist in this codebase — the
  sweeps are byte-safe by construction.

## The branches CSV contract (v2.152.0 + v2.154.0)

- Three sections in one blob: the per-branch matrix, "People & payroll by
  branch" (headcount/cost/absence/payroll status/expiry alerts — empty cells
  honest when the org console has no data), and the desk's yesterday digest
  (org-wide review activity; a refused read exports without the section and
  the note says so). RFC-4180 quoting, generated stamp, raw numbers.
- The export note links the live blob ("Open") after download; one blob
  alive at a time; the URL is revoked on re-export.

## The spec's own paths (v2.160.0)

- Phase 4.6 literal spec-path parity is COMPLETE: the spec's
  `/api/payroll/exports/p10`, `/api/payroll/exports/statutory`, and
  `/api/payroll/liability-report` routes now exist. Each is a RE-EXPORT of
  its canonical handler (`/api/hr/reports/p10` and
  `/api/hr/reports/statutory-liability`) — same guard, same roles, same
  audit rows, zero duplicated logic, so the alias can never drift.
- Every Phase 4.6 and Phase 4.7 endpoint and page from the spec's
  "Create:" lists now exists on disk; `scripts/verify-spec-paths.mjs` is
  the mechanical gate that keeps it true (33 paths + the three alias
  re-export bindings; run it standalone or via `npm run verify:v2-160-0`).
- The login front door gained its `<main>` landmark the same round — the
  axe best-practice "region" rule (9 flagged blocks) is closed, the
  decorative background layers are aria-hidden, and the input focus pulse
  is raised from ambient-glow alphas (0.15/0.25) to a visible keyboard
  beacon (0.35/0.5).

## Spec parity appendix (v2.164.0)

The EMS spec (`upload/Pasted Content_1792080972078.txt`, Stage 4) named
eight phases. This table maps each to the release that delivered it, so
the next auditor starts from facts instead of archaeology. Phase numbers
are the spec's own; "deepening" rows cover the post-parity work the spec's
acceptance lines asked for but which shipped after the endpoint landed.

| Spec phase | Scope (the spec's own words) | Delivered in | Deepening |
|------------|------------------------------|--------------|-----------|
| 4.1 Foundations | permissions/types/settings/audit, feature flag, migration plan | v2.18.5 | — |
| 4.2 Employee records, documents, positions, grades, salary structures | HR master data | v2.18.6 | — |
| 4.3 Recruitment and onboarding | hiring pipeline | v2.18.6 | — |
| 4.4 Attendance and leave | attendance + leave workflows | v2.18.7 | timesheet desk + gate (v2.136.0), weekends lens (v2.138–145), desk a11y (v2.147.0) |
| 4.5 Payroll engine | computation, statutory tables | v2.18.8 | engine hardening continues per-round |
| 4.6 Payroll run lifecycle, journal posting, payslips, P10, corrections | the 14 Create paths + 11 acceptance lines | v2.18.9 | B2C disbursement (v2.21.0), gate verdict/trail/chips/card (v2.135–146), spec-path aliases (v2.160.0), idle contract (v2.162.0), session reaper (v2.163.0) |
| 4.7 Performance, assets, disciplinary, self-service | 10 API paths + 6 `/employees/me` pages | v2.19.0 (Stage G) | portal PDF (v2.161.0), Lighthouse re-measure (v2.161.0), idle timeout (v2.162.0), return path (v2.163.0) |
| 4.8 HR workspace, org console integration, reporting, compliance hardening | 6 report endpoints + 5 console tiles + 8 acceptance lines | v2.20.0 (Stage H) | dense tables (by v2.132.0), retention/legal-hold APIs (v2.28.0), a11y sweeps (v2.147–149), console contrast (v2.149.0), automation pulse (v2.159.0) |

Stage 5 (testing and verification) names nine `scripts/verify-*.mjs`
gates; they exist and run in CI, joined by the per-release
`verify-v2-*-0.mjs` family (fresh-written every round) and
`verify-spec-paths.mjs` (v2.160.0, the mechanical Phase 4.6 + 4.7 path
gate).

Parity rule this appendix obeys: every row cites a RELEASE that shipped
(shippable, tagged, in CHANGELOG) — never an intent. When a future phase
delta appears, it gets a row the day it ships.
