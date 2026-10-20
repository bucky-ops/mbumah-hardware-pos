# Cron operations — the dispatcher that stays visible

How scheduled work actually fires in production, what keeps the hourly
cadence honest, and how to read the heartbeat. Companion to
`payroll-run-lifecycle.md` (the B2C auto-recovery contract lives there).

## The production story, in order

- **v2.16.0** landed the workspace edge proxy and — unknowingly — a 401
  wall: every `/api/cron/*` request died at the proxy's session gate BEFORE
  its own `x-cron-secret` check. Vercel Cron's unauthenticated GETs were
  silently rejected; no scheduled job fired in production.
- **v2.158.0** "the wake-up call gets through" fixed it: proxy Layer 5
  exempts `/api/cron/*` (`isCronPath`) so each route's own secret gate runs.
  Zero new trust at the edge — wrong secrets still 403 in-route, GET-only
  handlers, rate limiting intact. The first successful production tick
  fired after the deploy (all five sub-jobs green).
- **v2.159.0** closes the cadence and visibility gap (below).

## Cadence: designed hourly, fired daily, pinger restores hourly

- Vercel Hobby allows two cron entries and they are DAILY:
  - `/api/cron/nightly` — `30 2 * * *` (02:30 UTC)
  - `/api/cron/hourly` — `0 3 * * *` (03:00 UTC, ~06:00 EAT)
- Everything folded into the hourly dispatcher was designed for an hourly
  tick: outbox pump, payments sweeper, eTIMS retry, debt reminders, the
  B2C auto-recovery sweep, and (v2.163.0) the session reaper. The B2C
  backoff windows (2m-30m) are meaningless at one tick a day.
- **The remedy is `.github/workflows/cron-hourly.yml`**: a GitHub Actions
  workflow scheduled `0 * * * *` (plus `workflow_dispatch` for manual
  arming) that pings the production dispatcher with the `x-cron-secret`
  header and turns red on ANY non-200, non-success payload, or failed
  sub-job. Failure is honest and visible in the Actions tab.

### Arming the pinger (one-time, human)

1. Set `CRON_SECRET` on the Vercel project (production env). While unset,
   the dispatcher fail-opens: ticks are accepted unauthenticated and each
   one writes a `CRON_SECRET_UNSET` WARN systemLog.
2. Add the repo secret `CRON_SECRET` (same value) in GitHub → Settings →
   Secrets and variables → Actions.
3. Optional repo secret `PROD_URL` (defaults to the known deployment URL).
4. Run the workflow once via `workflow_dispatch` to verify end-to-end.

### Verifying the arming (two reads, five minutes, v2.165.0)

Arming is not done until it is OBSERVED done — two independent reads
confirm it, and neither requires shell access:

1. **The Actions tab**: the `workflow_dispatch` run (step 4) must be green
   — the "Verify every sub-job came back ok" step is the honest verdict, a
   red run names the failing sub-job in its log. A green run here is proof
   the repo secret + the URL work.
2. **The card**: reload the org console's Automation pulse — the amber
   "CRON_SECRET unset" badge must flip to the emerald "tick gate armed"
   (the posture is read server-side from the env, so the flip is proof the
   Vercel env var landed), and the tick source label (v2.165.0) on the
   "Last tick" line plus a green run in the Actions tab close the loop.

## The tick ledger (v2.159.0, extended v2.164.0 + v2.165.0)

- Every completed dispatch writes ONE `CRON_DISPATCH_TICK` INFO systemLog
  row with `metadata.results` = `[{ name, ok, status }, ...]` for all
  sub-jobs. The `CRON_DISPATCH_PARTIAL_FAILURE` WARN stays for severity
  filtering; the ledger is the always-row.
- **v2.164.0**: the session-reaper's entry also carries `deleted` (the
  sweep's own count) whenever the response body held a non-negative finite
  number — promoted by the dispatcher's `ledgerEntry`, never invented by
  the ledger. The Automation pulse card renders it as `· reaped N` (or
  `· clean` for zero) on the chip and an "N reaped" header pill when
  positive. Older ticks and other sub-jobs simply lack the field.
- **v2.165.0**: BOTH dispatchers write the ledger. The nightly dispatcher
  (which had left no always-row since v2.159.0) writes its own tick row,
  and every row's metadata names its dispatcher (`dispatcher: 'hourly' |`
  `'nightly'`) — the org card reads the field to label the "Last tick"
  line (`· nightly dispatcher`), and older rows simply omit the label.
  The card's tooltip on the same line carries the exact EAT stamp of the
  tick. Rows/day: ~25 with the pinger armed (~2/day without). SystemLog
  retention sweeps own the growth.

## The sub-jobs (six, as of v2.163.0)

| name | owns | notes |
|------|------|-------|
| `outbox` | outbox_events pump | opportunistic pumps also fire post-checkout |
| `payments-sweeper` | M-Pesa payment polling | early-outs when unconfigured |
| `etims-retry` | KRA eTIMS queue drain | backoff + DEAD ceiling (v2.6.0) |
| `debt-reminders` | overdue debt statements | 7-day per-ledger anti-spam throttle |
| `b2c-recovery` | failed/stuck B2C transfers | gate-allowed re-sends only (v2.155.0) |
| `session-reaper` | **expired auth sessions** | one `deleteMany` on the indexed `expiresAt` (v2.163.0); rides BOTH dispatchers since v2.165.0 (hourly 03:00 UTC + nightly 02:30 UTC — the idempotent deleteMany makes the overlap harmless); `runWithoutTenant` — Session is a global, tenant-exempt table; scope discipline: reads ONLY `expiresAt`, never `lastActiveAt` (idle expiry stays the portal guard's contract); every sweep leaves its own INFO `SESSIONS_REAPED` row, and a reaped-zero sweep is a SUCCESS |

## Reading the heartbeat: the Automation pulse card

`GET /api/org/automation` (ORG_ROLES = SUPER_ADMIN / STORE_OWNER /
ACCOUNTANT, parity with `/api/org/summary`; read-only over `rawDb` under
`runWithoutTenant`) returns:

- `lastTick`: the latest ledger row — timestamp (with the exact EAT stamp
  as the line's tooltip, v2.165.0), the dispatcher that fired when the row
  names one (`· hourly dispatcher` / `· nightly dispatcher`, v2.165.0),
  per-sub-job chips, and the 7-day `CRON_DISPATCH_PARTIAL_FAILURE` count.
- `failedTicks7d`: partial-failure rows in the last 7 days.
- `secretConfigured`: whether `CRON_SECRET` is set server-side — the honest
  tick-gate posture (fail-open ticks render the amber "CRON_SECRET unset"
  badge until the human arms the gate).
- `cadence`: the vercel.json schedule and the pinger workflow name — the
  card's truth line names both schedulers.

The org console card renders every state honestly: loading skeletons, an
empty state before the first tick, an error state with Retry (a read
failure is NOT a dispatch failure — the heartbeat keeps running), and the
live pulse (sub-job chips emerald-700 ok / red-700 failed with HTTP
status; the reaper chip adds `· reaped N` / `· clean`, a positive
count wears a sky "N reaped" pill in the card header, and the Last tick
line names its dispatcher and carries the exact EAT stamp tooltip since
v2.165.0). An unparseable ledger row keeps the timestamp and renders no
chips — never a guess.

## Contracts new scheduled work must inherit

- A new cron route needs NO proxy edit (`/api/cron/*` passes the edge gate
  by the v2.158.0 contract), but any new edge layer must preserve
  `isCronPath`.
- A new sub-job folds into the dispatcher (Vercel Hobby's two-cron limit
  keeps dedicated vercel.json entries out) — give it a name, a
  withErrorBoundary-wrapped GET, its own `x-cron-secret` check, and it
  inherits the ledger row and the pinger's green/red verdict for free.
  If the job must never miss a day, fold it into BOTH dispatchers (the
  session reaper has ridden both since v2.165.0) — idempotent jobs only;
  the overlap must be provably harmless.
- Sub-jobs must stay idempotent: overlapping ticks (Vercel + the pinger)
  cannot double-deliver. The B2C sweep inherits this from
  `initiatePayrollB2C`'s active-transaction refusal.
