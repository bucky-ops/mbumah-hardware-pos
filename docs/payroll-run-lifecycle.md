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
