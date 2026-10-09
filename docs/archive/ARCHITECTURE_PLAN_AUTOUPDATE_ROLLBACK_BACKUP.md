# Mbumah Hardware POS — Architecture Plan: Automatic Updates, Rollback and Automated Backups

Version 1.0 — 2026-10-07 — status: implemented (Phase 0 shipped in v2.9.0)

This document is the comprehensive architecture plan requested in the client RFP. It covers three commitments:

1. GitHub-integrated automatic updates that install new releases while the shops are dormant.
2. Rollback to a previous stable state — one command on laptops, one button in the cloud.
3. Automatic database backups, including a backup captured when the application crashes.

Each component is specified with its key features, step-by-step implementation actions, recommended tools, a phased timeline across the 12-month horizon, and measurable success metrics. Cross-cutting concerns, a roadmap with governance, and the assumptions, risks and next steps behind the plan follow.

Phase 0 of this plan is not a proposal — it has shipped. Version 2.9.0 delivers the updater and rollback scripts, the two scheduled tasks, the crash-backup hook, the update ledger, the admin endpoints and the Admin card listed in Appendix A. Everything else in this document is sequenced work for the remaining horizon.

---

## 1. Executive summary

Mbumah Hardware POS runs in two worlds that must stay in step: the cloud deployment (Vercel application, Neon PostgreSQL) and a fleet of counter laptops running the no-Docker install kit (Node.js 20, Next.js standalone build, one SQLite file at `~/mbumah-pos-data/pos.db`). Before this plan, the laptop fleet was operated by hand: updates were applied with a manual `git pull` and an installer re-run whenever someone found the time, no rollback mechanism existed, and no automated backup protected the single SQLite file that holds every sale, credit record and KRA document.

This plan replaces that manual operating model with three interlocking mechanisms. Every update takes a backup first, records what it did in an append-only ledger, and only completes if a health check passes — otherwise it rolls itself back. Every rollback starts from that same ledger, so reverting is a lookup, not an archaeology exercise. And the backup layer is exercised continuously: nightly on a schedule, on demand from the Admin screen, and automatically when the process crashes.

### 1.1 Current state versus what ships now

| Area | Before (baseline v2.8.0 and earlier) | Now (Phase 0, shipped in v2.9.0) |
|---|---|---|
| Code updates | Manual `git pull` and installer re-run per laptop, at random times of day; Vercel deployed `main` automatically but nothing coordinated the stores with the cloud | `deploy/nodocker/update-pos.ps1` (plus `.sh` twin) runs as the scheduled task "Mbumah POS Nightly Update" at 23:00, inside the 22:00–06:00 dormancy window; releases are discovered from GitHub Releases, which are auto-published on every version bump |
| Rollback | None structured — recovering meant reinstalling an older build by hand | One-command `Rollback-Mbumah-POS.bat` on laptops (backed by `rollback-pos.ps1`/`.sh`); cloud rollback button in Admin → "Updates, rollback & backups" card via `POST /api/admin/updates/rollback` and the Vercel deployments API |
| Backups | No laptop backups at all; cloud relied on provider retention with no tested restore path | Crash-triggered backup (`src/lib/crash-backup.ts` invoked from the root `instrumentation.ts` process hook), scheduled nightly backup task at 02:30, admin-triggered `POST /api/admin/backup` snapshot endpoint, Neon point-in-time recovery (PITR) as cloud DR |
| Visibility | Health endpoint only; nobody could say which version a store ran or when it was last backed up | Append-only JSONL update ledger at `%USERPROFILE%\mbumah-pos-data\update-ledger.jsonl`, surfaced by `GET /api/admin/updates` and the Admin "Updates, rollback & backups" card |

### 1.2 KPI targets

The whole plan is engineered against three headline targets:

| # | KPI | Target |
|---|---|---|
| 1 | RTO — laptop restore | 5 minutes or less from decision to a healthy, trading system |
| 2 | RPO — data loss window | 24 hours or less on laptops (nightly 02:30 backup plus crash-triggered backups); point-in-time recovery on the cloud via Neon PITR |
| 3 | Config drift | 0 — every laptop on the same release, same env contract, same task schedule; the update ledger and `GET /api/admin/updates` make any drift visible the moment it appears |

### 1.3 Scope

In scope for this plan:

- The laptop fleet (Windows-first, Node.js 20 + SQLite) and its update, rollback and backup lifecycle.
- The cloud deployment (Vercel + Neon PostgreSQL) as far as rollback, snapshots and disaster recovery are concerned.
- The admin-facing surfaces (endpoints and the Admin card) that make the three components operable by non-technical owners.

Out of scope for this revision:

- Feature development of the POS/ERP itself (covered by the normal product backlog and release notes).
- Payment gateway or KRA/eTIMS integration changes, except where a release must be rolled back.
- Procurement of new infrastructure — the plan deliberately builds only on GitHub, Vercel, Neon and the existing laptop kit.

### 1.4 How the three components interlock

Every automatic update first takes a backup, then writes a ledger entry binding the previous version, the new version, the backup path and the health-check outcome together. That ledger entry is exactly what the rollback scripts and the cloud rollback button consume, so an update is always one step from a verified restore point. The backup system is exercised by the release process itself rather than sitting unused until a disaster, and the crash hook guarantees that even an abnormal exit leaves a fresh copy behind.

---

## 2. Component 1 — GitHub-integrated automatic updates during dormancy

Manual updates are the largest source of avoidable operational risk in the estate. Stores drift onto different versions, security fixes wait for someone to find the time, and every update competes with trading hours. This component installs an update pipeline that monitors the GitHub repository, installs each new release only while a shop is dormant, verifies the result with a health check, and reverses itself automatically if that check fails.

### 2.1 Key features and why they matter

| Feature | What it does | Why it is important |
|---|---|---|
| Dormant-window updates | Updates run only between 22:00 and 06:00 shop-local time, via the "Mbumah POS Nightly Update" scheduled task at 23:00; the updater skips and defers if a shift is open | Shop operations are never interrupted — a sale in progress outranks any release |
| Release monitoring | The updater polls the GitHub Releases API for the latest `v*` tag; GitHub Releases are auto-published by the release workflow on every version bump | One source of truth for every laptop and the cloud; a version bump on `main` is the single act of publishing |
| Pre-update backup | A database backup is mandatory before any code is swapped | Every update starts from a known-good copy of the data, so even a failed update loses nothing |
| Health-gated atomic switch | The new build is prepared in a separate folder, started, and only promoted to "current" after `/api/health` reports healthy (including the real `database_stats` check) | A broken build never becomes the running system — the gate is the same readiness check proven in the v2.7.3 launcher fix |
| Automatic code rollback on failed health check | If the health check fails after the switch, the updater reverts to the previous version and records the rollback in the ledger | Overnight failures self-heal before staff arrive; no engineer visit needed |
| Update ledger (JSONL audit trail) | Every attempt appends one JSON line to `%USERPROFILE%\mbumah-pos-data\update-ledger.jsonl`: timestamp, from-version, to-version, trigger, backup path, outcome | Feeds the rollback picker, the Admin card and every metric in Section 2.6; makes the fleet auditable |

### 2.2 Step-by-step implementation actions

Shipped in Phase 0 (v2.9.0):

1. **Publish releases automatically.** The `release.yml` workflow publishes a GitHub Release with tag `v<version>` whenever `package.json` is bumped on `main`. No bump, no release — this governance has been in force since v2.7.3 and is the contract the updater consumes.
2. **Build the updater.** `deploy/nodocker/update-pos.ps1` (Windows) and `deploy/nodocker/update-pos.sh` (Linux/macOS twin): resolve the latest release via the GitHub Releases API using `GITHUB_TOKEN`; install by `git fetch` + `git checkout <tag>` as the primary path, with the codeload ZIP of the same tag as fallback; run `npm ci` and the production build; take the pre-update backup; swap atomically.
3. **Schedule and wrap it.** Register the "Mbumah POS Nightly Update" scheduled task at 23:00 (`schtasks` on Windows, cron on Linux) and ship the double-click wrappers `Update-Mbumah-POS.bat` / `Rollback-Mbumah-POS.bat` so an owner can update or roll back without a terminal.
4. **Gate on health and roll back automatically.** After the switch, the script polls `/api/health`; on failure it restores the previous version directory and appends a failed-update plus rollback entry to the ledger.
5. **Write the ledger.** Append one JSON line per update attempt to `%USERPROFILE%\mbumah-pos-data\update-ledger.jsonl`, and expose it through `GET /api/admin/updates`.

Next phases:

6. **Harden (months 0–3).** Catch-up update on first boot if the laptop was off at 23:00; ledger rotation at a size cap; staleness detection if a store has not updated within its ring's grace period.
7. **Staged rings (months 3–6).** Ring 0 = the dev store receives every release first; ring 1 = one canary shop after ring 0 soaks for 24 hours; ring 2 = the remaining laptops. Ring membership is a config file per laptop.
8. **Notifications (months 3–6).** Update started / succeeded / failed / rolled-back events reach the owner via the WhatsApp/SMS/email channel stack already built for vouchers (see Section 5.4).
9. **Fleet management (months 6–12).** Per-store version dashboard fed by the ledger, canary promotion policy, update freeze windows for peak trading seasons, and drift alarms at zero tolerance.

### 2.3 Update flow and ledger format

At 23:00 the updater executes the following sequence; every terminal outcome — success, failure or deferral — lands in the ledger:

1. Load configuration from the shop's `.env` (including `GITHUB_TOKEN` and `BACKUP_DIR`) and resolve the latest release tag from the GitHub Releases API.
2. Dormancy guard: if a shift is open or a sale is in progress, append a `deferred` ledger entry and exit; the next scheduled run or boot-time catch-up retries.
3. Pre-flight: disk space, database integrity and the mandatory pre-update backup into `BACKUP_DIR`.
4. Fetch and build: `git fetch origin tag <version>` + `git checkout <version>` (codeload ZIP of the same tag if git is unavailable), then `npm ci` and the production build in a staging directory.
5. Atomic switch and health gate: point the launcher at the new build, poll `/api/health` (including the real `database_stats` check).
6. Outcome: healthy — append a `success` entry and keep the previous build for one-command rollback; unhealthy — automatically revert to the previous build, append `failed` plus `rolled_back` entries, and continue running the last known-good version.

Example ledger entries (one JSON object per line in `update-ledger.jsonl`):

```json
{"ts":"2026-10-07T23:04:11+03:00","event":"update_success","from":"v2.8.0","to":"v2.9.0","trigger":"scheduled","backup":"backups/pre-update-v2.9.0-20261007T2302.zip","health":"ok","path":"git-tag"}
{"ts":"2026-10-08T23:11:38+03:00","event":"update_failed","from":"v2.9.0","to":"v2.9.1","trigger":"scheduled","backup":"backups/pre-update-v2.9.1-20261008T2301.zip","health":"database_stats_error","path":"codeload-zip"}
{"ts":"2026-10-08T23:12:05+03:00","event":"auto_rollback","from":"v2.9.1","to":"v2.9.0","trigger":"health-gate","health":"ok"}
```

### 2.4 Recommended tools and libraries

| Tool | Role in this component |
|---|---|
| GitHub Releases API | Release discovery and metadata; called with `GITHUB_TOKEN` for the higher rate limit and with conditional requests (ETag) to stay polite |
| `git fetch` + `git checkout <tag>` | Primary install path — exact, reproducible, identical to the tagged commit |
| codeload ZIP fallback | `https://codeload.github.com/<owner>/<repo>/zip/refs/tags/<tag>` — install path when git is missing or fetch fails; no API call required |
| npm (`npm ci` + build) | Dependency install and standalone production build inside the update |
| `schtasks` / cron | Schedules "Mbumah POS Nightly Update" (23:00) on Windows and Linux respectively |
| `Invoke-RestMethod` / `curl` | Health-check polling and API calls from the update scripts (PowerShell 5.1-compatible) |

### 2.5 Timeline

| Phase | Window | Scope | Exit criteria |
|---|---|---|---|
| Phase 1 — deliver and harden | 0–3 months | Phase 0 shipped in v2.9.0 (updater, wrappers, 23:00 task, health gate, auto-rollback, ledger). Hardening: boot-time catch-up, ledger rotation, staleness alerts | First fully hands-free update cycle on every enrolled laptop with zero shop-hours impact |
| Phase 2 — staged rings and notifications | 3–6 months | Ring 0 dev store, ring 1 canary, ring 2 fleet; update-event notifications via the voucher gateway stack | All laptops tracking the latest release within 7 days; owners receive notifications for every update outcome |
| Phase 3 — fleet management and canary store | 6–12 months | Per-store version dashboard, canary promotion policy, peak-season freeze windows, drift alarms | Version drift 0 across the fleet; security patches deployed within 72 hours of release |

### 2.6 Success metrics

| Metric | Target | How it is measured |
|---|---|---|
| Update success rate | 99% or higher | Successful update entries divided by total attempts in the ledger, per month |
| User-visible interruptions during shop hours | Zero | Updates only execute 22:00–06:00 with an open-shift guard; ledger timestamps audited against shop hours |
| Mean update window | Under 20 minutes end-to-end per laptop | Start and finish timestamps on each ledger entry |
| Ledger coverage | 100% of updates ledgered | Every scheduled-task execution has a matching ledger entry, success or failure |

---

## 3. Component 2 — Rollback to a previous stable state

A bad release is the most common self-inflicted outage in any continuously updated system. Before this plan, recovery meant manually reinstalling an older build. This component turns recovery into a controlled, minutes-long operation: one command on a laptop, one button in the cloud — both driven by the update ledger rather than guesswork.

### 3.1 Key features and why they matter

| Feature | What it does | Why it is important |
|---|---|---|
| One-command laptop rollback | `Rollback-Mbumah-POS.bat` (repo root) launches `deploy/nodocker/rollback-pos.ps1` (`.sh` twin for Linux): pick a version, back up, re-checkout, rebuild, health-gate | A till recovers in minutes without an engineer visit and without terminal skills |
| Cloud rollback button | Admin → "Updates, rollback & backups" card → `POST /api/admin/updates/rollback` calls the Vercel deployments API (`POST /v13/deployments/{id}/rollback`) to promote the previous production deployment | Bad cloud code is reverted in seconds with zero local effort |
| Code-only rollback principle | Rollback reverts code, never the database schema; migrations are written forward-compatible (additive-first) so newer schema keeps working with older code | No destructive schema reversal is ever required, which is what makes rollback safe and fast |
| Pre-rollback backup | The rollback scripts take a fresh backup before touching anything, exactly like the updater | Even the recovery action itself cannot lose data |
| Ledger-driven version picker | The rollback UI and script list versions from `update-ledger.jsonl` — only versions that actually ran on this machine or in the cloud are offered | The operator chooses from proven-installed states, not theoretical tags |

### 3.2 Step-by-step implementation actions

Shipped in Phase 0 (v2.9.0):

1. **Make the ledger the source of truth.** Every update and rollback appends its full context (versions, backup path, outcome) to `update-ledger.jsonl`; `GET /api/admin/updates` exposes it.
2. **Ship the laptop rollback path.** `Rollback-Mbumah-POS.bat` → `deploy/nodocker/rollback-pos.ps1`/`.sh`: reads the ledger, offers previously installed versions, takes the pre-rollback backup, checks out the chosen tag, rebuilds, health-gates, appends a rollback entry.
3. **Ship the cloud rollback path.** `POST /api/admin/updates/rollback` resolves the target deployment and calls the Vercel deployments API using `VERCEL_TOKEN`, `VERCEL_PROJECT_ID` and `VERCEL_TEAM_ID`; the Admin "Updates, rollback & backups" card renders the button and the deployment history.
4. **Wire the env contract.** `.env` keys `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`, `GITHUB_TOKEN` and `BACKUP_DIR` documented and checked at startup; missing keys surface honestly on the Admin card.

Next phases:

5. **Codify the code-only rollback policy (months 0–3).** Written rule for the team: additive migrations first, destructive changes deferred one release; a rollback that meets an incompatible schema aborts, keeps the pre-rollback backup and escalates to the PITR runbook (Section 7.2).
6. **Rollback drills (months 3–6).** Quarterly timed exercise: roll the ring 0 dev store back one release via `Rollback-Mbumah-POS.bat` and record the duration against the metric in Section 3.6.
7. **Auto-rollback tuning and UX (months 6–12).** Post-update auto-rollback parameters reviewed against ledger statistics; version-picker UX improvements in the Admin card as the fleet grows.

### 3.3 Rollback decision path

When something looks wrong after a release, the operator follows one path:

1. **Laptop, owner present:** close the POS windows, double-click `Rollback-Mbumah-POS.bat`, pick the previous version from the ledger-driven list, confirm. The script does the rest and prints the outcome.
2. **Laptop, automatic:** if the failure happened during the 23:00 update, no action is needed — the health gate already reverted the code and the ledger says so.
3. **Cloud:** open Admin → "Updates, rollback & backups", review the deployment history, press the rollback action for the previous deployment; `POST /api/admin/updates/rollback` calls the Vercel deployments API and reports the result.
4. **Escalation:** if any path aborts (for example a schema-incompatible edge), the pre-rollback backup is preserved, nothing is deleted, and the Neon PITR runbook is the last resort with owner approval.

### 3.4 Recommended tools and libraries

| Tool | Role in this component |
|---|---|
| Update ledger (`update-ledger.jsonl`) | Source of truth for which versions ran where and with which backups; drives the version picker on both platforms |
| Git tags (`v`-prefixed semver) | Immutable rollback targets; each ledger entry names the exact tag it installed |
| Vercel deployments API (`POST /v13/deployments/{id}/rollback`) | Cloud rollback primitive, called server-side only from the admin endpoint |
| `Rollback-Mbumah-POS.bat` + `rollback-pos.ps1`/`.sh` | Laptop rollback mechanics: backup, checkout, rebuild, health gate, ledger entry |
| `verify-db.mjs` gate | Confirms the rolled-back build boots against a seeded, intact database before declaring success |
| Admin session auth | `POST /api/admin/updates/rollback` is role-gated (SUPER_ADMIN/STORE_OWNER) and audit-logged, matching the repo's established admin route patterns |

### 3.5 Timeline

| Phase | Window | Scope | Exit criteria |
|---|---|---|---|
| Phase 1 — deliver and harden | 0–3 months | Phase 0 shipped in v2.9.0 (laptop scripts, cloud endpoint and button, ledger picker, env contract). Add the written code-only rollback policy | One documented, policy-backed rollback path per platform |
| Phase 2 — drills and guardrails | 3–6 months | First two quarterly rollback drills on ring 0; auto-rollback parameters reviewed against ledger data | Rollback drill timings recorded and meeting the target in Section 3.6 |
| Phase 3 — maturity | 6–12 months | Version-picker UX refinements, ledger statistics dashboard, rollback-rate target tracking | Fewer than 5% of releases ever need rollback, and every rollback that happens is one action |

### 3.6 Success metrics

| Metric | Target | How it is measured |
|---|---|---|
| Rollback execution time | Under 10 minutes from decision to healthy, trading system | Drill timings and real rollback ledger entries |
| Rollback success rate | 99% or higher | Successful rollback entries divided by rollback attempts in the ledger |
| Data loss events caused by rollback | Zero | Code-only rollback never touches transaction data; any exception is an incident-log entry |

---

## 4. Component 3 — Automatic database backups on crash

The database is the business: sales, customer credit, stock movements and the KRA tax trail all live in it. The laptop deployment writes everything to one SQLite file, so a crash at the wrong moment could mean a corrupt file and lost history. This component layers backups so that there is always a recent copy: nightly on a schedule, on demand from the Admin screen, and automatically at the moment the process crashes.

### 4.1 Key features and why they matter

| Feature | What it does | Why it is important |
|---|---|---|
| Crash-triggered backup | The root `instrumentation.ts` registers process-level `uncaughtException` and `unhandledRejection` handlers that invoke `src/lib/crash-backup.ts`, which copies the SQLite database to a timestamped crash-backup folder before the process dies | 100% of crashes end with the newest possible data captured — a crash never means a silent, corrupt loss |
| Scheduled nightly backup | The "Mbumah POS Nightly Backup" scheduled task runs at 02:30 daily and copies the database into the backup folder with retention pruning | Bounds the worst-case data-loss window to 24 hours on laptops (the RPO target) |
| WAL sidecar safety | The backup copies the SQLite database together with its `-wal` and `-shm` sidecar files so the copy is a consistent, restorable snapshot | A main-file-only copy of a WAL-mode database can be unusable; the sidecars are what make it safe |
| Admin-triggered snapshot download | `POST /api/admin/backup` produces an on-demand backup snapshot that the owner can download — the cloud path for the same protection | One-click, owner-operable backup before risky actions such as a major update or a bulk import |
| Neon PITR as cloud DR | The cloud Neon PostgreSQL database keeps point-in-time recovery; the retention window is documented and a restore is rehearsed | Any minute of cloud history is recoverable; underpins the last-resort path in the rollback policy |
| Retention guidance | Keep 14 nightly backups plus all crash-triggered backups by default; prune older nightlies; the uninstaller never deletes `Desktop\MbumahBackups` or the data-folder backups | Disk usage stays bounded without ever destroying the newest safety net |

### 4.2 Step-by-step implementation actions

Shipped in Phase 0 (v2.9.0):

1. **Build the crash hook.** Root `instrumentation.ts` registers `process.on('uncaughtException')` and `process.on('unhandledRejection')` handlers; each calls `src/lib/crash-backup.ts`, which performs the file-copy backup (including `-wal`/`-shm` sidecars) into `BACKUP_DIR` and logs the attempt before the process exits.
2. **Schedule the nightly backup.** Register "Mbumah POS Nightly Backup" at 02:30 (`schtasks`/cron) with the same retention rules as the updater's pre-update backup.
3. **Ship the admin snapshot endpoint.** `POST /api/admin/backup` creates a snapshot and returns a download — usable on both the cloud deployment and a laptop, gated by admin session auth and written to `systemLog`.
4. **Expose status.** `GET /api/admin/updates` reports the last backup time alongside update status so staleness is visible on the Admin card.

Next phases:

5. **Rehearse cloud DR (months 0–3).** Confirm the Neon PITR retention window in the Neon console, document the one-page restore runbook, and execute one timed point-in-time restore.
6. **Quarterly restore drills (months 3–6 and ongoing).** Restore the latest 02:30 backup to a scratch folder, run `deploy/nodocker/verify-db.mjs` against it, and record the timing against the RTO target.
7. **Retention and archive tuning (months 6–12).** Review backup folder growth per store, tune retention counts, and evaluate an off-laptop copy (USB rotation or object storage) for the KRA-aligned archive tier.

### 4.3 Backup inventory and folder layout

What is protected, and where it lands on a laptop:

| Item | Backed up | Notes |
|---|---|---|
| `pos.db` | Yes — nightly 02:30, pre-update, pre-rollback, on crash | The entire business database, single file |
| `pos.db-wal`, `pos.db-shm` | Yes — always together with `pos.db` | Required for a consistent, restorable snapshot of a WAL-mode database |
| `.env` (shop configuration) | Yes — nightly and pre-update | Tokens, VAT settings mirror, LAN binding; contains secrets, so ACL-restricted |
| `update-ledger.jsonl` | Not backed up — it is itself the audit record | Rotated at a size cap; treat as an operational log, not business data |

Resulting layout under `%USERPROFILE%\mbumah-pos-data\`:

```text
pos.db, pos.db-wal, pos.db-shm     <- live database (WAL mode)
update-ledger.jsonl                <- append-only update/rollback audit trail
backups/
  nightly-20261007T0230/           <- "Mbumah POS Nightly Backup" (02:30)
  pre-update-v2.9.0-20261007T2302/ <- taken by update-pos before every swap
  pre-rollback-20261008T2310/      <- taken by rollback-pos before every revert
  crash-20261009T140322/           <- taken by the instrumentation.ts crash hook
```

### 4.4 Recommended tools and libraries

| Tool | Role in this component |
|---|---|
| `instrumentation.ts` (Next.js root hook) | Registers the process-level `uncaughtException`/`unhandledRejection` handlers — the single entry point for crash-triggered backups |
| `src/lib/crash-backup.ts` + `fs` copy | Synchronous-ish file-copy backup of the SQLite file and WAL sidecars, portable across Windows and Linux |
| `pg_dump` | Logical export for cloud Postgres snapshots where a file copy does not apply |
| Neon API / PITR | Cloud disaster recovery: point-in-time restore to any retained minute; console-documented retention window |
| `schtasks` / cron | Schedules "Mbumah POS Nightly Backup" at 02:30 on Windows and Linux |
| `verify-db.mjs` | Proves a restored backup is intact and seeded during quarterly restore drills |

### 4.5 Timeline

| Phase | Window | Scope | Exit criteria |
|---|---|---|---|
| Phase 1 — deliver and harden | 0–3 months | Phase 0 shipped in v2.9.0 (crash hook, 02:30 task, snapshot endpoint, status surface). Add the Neon PITR runbook and one timed cloud restore | A crash observed in staging produces a restorable backup; the cloud restore is timed |
| Phase 2 — drills | 3–6 months | Quarterly restore drills on laptop backups; retention counts tuned per store | First two quarterly drills pass with recorded timings |
| Phase 3 — archive and assurance | 6–12 months | Off-laptop archive tier for KRA record-keeping; backup-freshness alerting; annual DR review | An off-device copy of every store's data exists and is restorable |

### 4.6 Success metrics

| Metric | Target | How it is measured |
|---|---|---|
| Crash backup coverage | 100% of crashes produce a backup attempt within 60 seconds | The `instrumentation.ts` hook runs synchronously on the crash path; crash tests in staging verify the backup folder |
| Backup restore drill | Passes quarterly | Drill log: restore to scratch, `verify-db.mjs` verdict, timing |
| RPO — laptops | 24 hours or less | Age of the most recent nightly (02:30) plus crash backups at any point in time |
| RPO — cloud | Effectively zero | Neon PITR retention window, verified by the rehearsed restore |

---

## 5. Cross-cutting concerns

The three components share infrastructure, so several qualities must hold across all of them rather than inside any single one. Each decision below is a requirement, not a preference.

### 5.1 Security

- **Token least privilege.** `GITHUB_TOKEN` is a fine-grained personal access token with read-only contents access to the single repository — enough for release discovery and tag checkout, nothing more. `VERCEL_TOKEN` is scoped to one project (`VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`) and is used only server-side by the rollback endpoint. All five `.env` keys (`VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`, `GITHUB_TOKEN`, `BACKUP_DIR`) stay out of version control and are checked for presence at startup.
- **Backups contain PII.** Laptop backups hold sales records, customer phone numbers and staff data. The data folder (`%USERPROFILE%\mbumah-pos-data`, including `update-ledger.jsonl` and backups) and the Desktop backup folder are ACL-restricted to the store user account; USB copies should be treated as confidential.
- **Audit via `systemLog`.** Every admin endpoint (`GET /api/admin/updates`, `POST /api/admin/updates/rollback`, `POST /api/admin/backup`) writes to the application's `systemLog` audit trail with actor and action, on top of the append-only ledger.
- **Role gating.** Admin endpoints require an authenticated SUPER_ADMIN or STORE_OWNER session, resolved inside the handler per the repo's established route pattern.
- **No secrets in the ledger or logs.** Ledger entries and `systemLog` records reference backup paths and versions only; tokens and connection strings never appear in either.

### 5.2 Performance

- **Updates only when dormant.** All heavy work — release download, `npm ci`, build, backup — runs inside the 22:00–06:00 window (task at 23:00). Trading hours see none of it.
- **Health checks stay cheap.** The update gate reuses `/api/health`, which performs one small database probe; polling it a handful of times per update adds no meaningful load.
- **The ledger stays small.** `update-ledger.jsonl` is append-only, one JSON line per event, rotated at a size cap; reading it for the version picker or the Admin card is a scan of kilobytes.
- **Backups off-peak.** The 02:30 file copy runs against a quiescent database; the crash-hook copy is bounded, single-file, and only ever executes when the process is already failing.
- **Fleet checks are pull-based.** `GET /api/admin/updates` reads local files (ledger, health) rather than calling out to GitHub or Vercel on page load, so the Admin card stays fast even when the platform APIs are slow.

### 5.3 Usability

- **Owner-facing `.bat` files.** `Update-Mbumah-POS.bat` and `Rollback-Mbumah-POS.bat` are double-click actions on the Desktop or repo root. No terminal skills are required anywhere in the daily operational loop — the same bar the install kit set with `Install-Mbumah-POS.bat`.
- **Honest status messages.** Scripts and the Admin card report plain-language outcomes — updated, failed, rolled back, deferred — and never fake success. This matches the honesty convention the client approved for voucher delivery statuses in v2.8.0.
- **One surface.** The Admin "Updates, rollback & backups" card answers the owner's three questions — what version are we on, when was the last update, when was the last backup — and hosts the rollback button and the snapshot action.
- **Failure messages are actionable.** A deferred update says it will retry at the next window; a failed health gate says the previous version is running and where the backup is; a missing token says exactly which `.env` key to set.

### 5.4 Closing the three named gaps

The RFP called out three systemic gaps explicitly. Each is closed structurally, not case by case, and each closure is observable in the metric tables above.

| Named gap | Consequence today | How this plan closes it |
|---|---|---|
| Error handling | Failures surface as blank screens or silent corruption; a failed overnight update would leave a broken till until morning | Health-gated updates with automatic code rollback on a failed health check; pre-flight checks and the `verify-db` gate; process-level `uncaughtException`/`unhandledRejection` crash hooks that capture a backup before exit |
| Testing protocol | Regressions reach stores before anyone notices; restores are never rehearsed | Staged rollout with ring 0 = the dev store soaking every release first; the `verify-db` gate in installer, updater and rollback; quarterly restore and rollback drills with recorded timings; existing CI (lint, build, test, security) on every pull request |
| User notifications | Staff and owners learn about updates and outages by accident | Today: the ledger plus the Admin card are the always-correct record. Next (months 3–6): update/rollback/backup events are pushed to owners by reusing the voucher gateway stack — Resend email and Twilio SMS/WhatsApp already wired end-to-end by the voucher send feature — with the in-app banner remaining the always-present channel |

Planned notification matrix (months 3–6):

| Event | Channels | Audience | Timing |
|---|---|---|---|
| Update applying / succeeded / failed | WhatsApp or SMS + email | Owner, admins | At the 23:00 window |
| Rollback executed (manual or automatic) | WhatsApp or SMS + email | Owner, admins | Within 5 minutes of the event |
| Backup failed or stale | Email | Admins | Within 15 minutes of detection |
| Crash backup taken | Ledger + Admin card (alert if followed by failed restart) | Admins | On next health report |

---

## 6. Roadmap & governance

### 6.1 Master roadmap

| Phase | Component 1 — Updates | Component 2 — Rollback | Component 3 — Backups |
|---|---|---|---|
| 0–3 months (deliver + harden) | Phase 0 shipped in v2.9.0: updater, 23:00 task, health gate, auto-rollback, ledger. Hardening: boot catch-up, ledger rotation, staleness alerts | Phase 0 shipped: laptop rollback scripts, cloud rollback button, ledger picker. Written code-only rollback policy; first Neon PITR restore | Phase 0 shipped: crash hook, 02:30 task, snapshot endpoint. Neon PITR runbook documented and rehearsed |
| 3–6 months (scale + drill) | Staged rings (ring 0 dev store, ring 1 canary, ring 2 fleet); update-event notifications via the voucher gateway stack | Quarterly rollback drills 1 and 2 on ring 0; auto-rollback tuning from ledger data | Quarterly restore drills; retention counts tuned per store |
| 6–12 months (manage + assure) | Fleet version dashboard, canary promotion policy, peak-season freeze windows | Version-picker UX refinements; rollback-rate tracking | Off-laptop archive tier for KRA record-keeping; backup-freshness alerting; annual DR review |

### 6.2 Version and tag policy

Releases continue the governance chain already in force:

1. `package.json` is bumped on `main` (patch = fixes, minor = features, major = breaking or schema-changing releases).
2. The `release.yml` workflow auto-publishes the GitHub Release and `v<version>` tag on every version bump — no bump, no release.
3. Vercel continues to deploy `main` automatically; laptops converge on the tagged release through the 23:00 updater.
4. The version in `package.json`, the Git tag, the running app and every ledger entry must agree; the Admin card makes any disagreement visible.

### 6.3 Ownership

The plan is sized for a small team of 2–3 developers at intermediate skill level; the split below keeps each workstream within one person's context while every drill involves at least two.

| Workstream | Owner | Primary skills applied |
|---|---|---|
| Updates pipeline (updater scripts, rings, fleet dashboard) | Developer 1 | PowerShell/Bash, GitHub Releases API, scheduling |
| Rollback and admin surface (rollback scripts, admin endpoints, Vercel API) | Developer 2 | Next.js API routes, Vercel platform, ledger design |
| Backups and drills (crash hook, scheduled tasks, PITR runbook, drills) | Developer 3 (or shared with Developer 1 in a 2-person team) | SQLite and Postgres operations, restore rehearsals |
| Phase sign-off and freeze-window calendar | Business owner (Mbumah) | Acceptance checklist format introduced with v2.8.0 |

---

## 7. Assumptions, risks, and next steps

### 7.1 Assumptions (RFP blanks filled)

The RFP template left three blanks. They are filled — and stated explicitly here — as follows:

1. **Application name: Mbumah Hardware POS.** The plan covers the Mbumah Hardware POS & ERP system (Next.js, Prisma) in both deployment worlds described below.
2. **Horizon: 12 months.** All timelines in Sections 2 to 6 use this horizon, split into 0–3, 3–6 and 6–12 month phases.
3. **Team: a small team of 2–3 developers at intermediate skill level.** Ownership in Section 6.3 assumes this size; no specialist DevOps or DBA headcount is required.

Environmental assumptions behind the design:

4. The laptop fleet is **Windows-first, running Node.js 20 and SQLite** (the single-file `pos.db` deployment from the no-Docker install kit), with the `.sh` twins covering any Linux machine.
5. The cloud estate is **Vercel (application) + Neon PostgreSQL (database)**, deployed from `main`, with Neon PITR available as the cloud recovery primitive.
6. The dormancy window is 22:00–06:00 shop-local time, with scheduled tasks at 23:00 (update) and 02:30 (backup).
7. GitHub and Vercel accounts, the `release.yml` auto-publish workflow, and the v2.8.0-era install kit are in place and functioning.
8. Phase 0 shipped in v2.9.0, so all artifacts in Appendix A exist and are the baseline this plan extends.
9. Shop laptops are shut down outside trading hours by policy ("close the black windows to close the shop"), which is why the boot-time catch-up and the server-off risk in Section 7.2 exist.

### 7.2 Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| GitHub API rate limits stall release discovery | Medium | Medium | `GITHUB_TOKEN` raises the limit from 60 to 5,000 requests/hour; conditional requests with ETag; the codeload ZIP fallback needs no API call at all |
| Server off at night — laptop powered down during the 23:00 window | Medium | Medium | Boot-time catch-up check that runs a missed update on first start; scheduler catch-up for missed tasks; staleness alert (months 3–6) if a store has not updated within its grace period |
| zip-vs-git divergence — the ZIP fallback produces a tree that differs from the git checkout | Low | Medium | Git tag checkout is the primary path; the ZIP fallback downloads the exact same tag from codeload; the ledger records which path was used so any divergence is auditable after the fact |
| Schema-incompatible rollback edge — an older build meets a newer, non-additive schema | Low | High | Code-only rollback principle with additive-first migrations makes this rare by construction; the rollback script aborts, preserves the pre-rollback backup, and escalates to the Neon PITR runbook as the last resort |
| Token expiry or revocation (`GITHUB_TOKEN`, `VERCEL_TOKEN`) | Medium | Medium | Startup and Admin-card config checks surface missing or rejected tokens honestly; quarterly rotation reminder; the updater degrades to the ZIP fallback if `GITHUB_TOKEN` fails while `VERCEL`-gated features fail loudly rather than silently |

### 7.3 Six immediate next steps

1. **Enroll every laptop.** Run `Update-Mbumah-POS.bat` once per machine to confirm the 23:00 scheduled task and the ledger are active, then verify each store appears healthy in `GET /api/admin/updates`.
2. **Configure the env contract on the admin machine.** Set `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`, `GITHUB_TOKEN` and `BACKUP_DIR`; confirm the Admin "Updates, rollback & backups" card shows every check green.
3. **Run restore drill number 1.** Restore last night's 02:30 backup to a scratch folder, run `deploy/nodocker/verify-db.mjs` against it, and record the timing against the 5-minute RTO target.
4. **Run rollback drill number 1.** Roll the dev store (ring 0) back one release with `Rollback-Mbumah-POS.bat`; confirm the pre-rollback backup, the health gate and the ledger entry.
5. **Write the one-page cloud DR runbook.** Confirm the Neon PITR retention window in the Neon console and document who calls what, in what order, for a cloud point-in-time restore.
6. **Put governance on the calendar.** Assign the Section 6.3 ownership, schedule the quarterly drill dates, and agree the peak-season update freeze windows with the business owner.

### 7.4 Quick reference

Commands an owner or administrator uses day to day (double-click the `.bat` equivalents where given):

```powershell
# Update a laptop to the latest release (or double-click Update-Mbumah-POS.bat)
powershell -ExecutionPolicy Bypass -File deploy\nodocker\update-pos.ps1

# Roll a laptop back to a previous version (or double-click Rollback-Mbumah-POS.bat)
powershell -ExecutionPolicy Bypass -File deploy\nodocker\rollback-pos.ps1

# Read the ledger (latest 10 events)
Get-Content "$env:USERPROFILE\mbumah-pos-data\update-ledger.jsonl" -Tail 10

# Verify a restored or live database
node deploy\nodocker\verify-db.mjs
```

Cloud actions (rollback, snapshot) run from Admin → "Updates, rollback & backups"; no terminal is required.

---

## Appendix A — Phase 0 artifacts shipped in v2.9.0

All of the following exist as of v2.9.0 and are the concrete foundation this plan builds on.

| Artifact | Path / identifier | Purpose |
|---|---|---|
| Updater script (Windows) | `deploy/nodocker/update-pos.ps1` | Release discovery, pre-update backup, build, health-gated atomic switch, auto-rollback, ledger write |
| Updater script (Linux twin) | `deploy/nodocker/update-pos.sh` | Same behavior for Linux laptops and servers |
| Rollback script (Windows) | `deploy/nodocker/rollback-pos.ps1` | Ledger-driven version picker, pre-rollback backup, re-checkout, health gate, ledger write |
| Rollback script (Linux twin) | `deploy/nodocker/rollback-pos.sh` | Same behavior for Linux machines |
| One-click wrappers | `Update-Mbumah-POS.bat`, `Rollback-Mbumah-POS.bat` (repo root) | Double-click update and rollback for non-technical owners |
| Scheduled task — update | "Mbumah POS Nightly Update" at 23:00 | Hands-free updates inside the 22:00–06:00 dormancy window |
| Scheduled task — backup | "Mbumah POS Nightly Backup" at 02:30 | Nightly SQLite file backup with retention pruning |
| Update ledger | `%USERPROFILE%\mbumah-pos-data\update-ledger.jsonl` | Append-only audit trail consumed by rollback, the Admin card and every metric |
| Crash-backup module | `src/lib/crash-backup.ts` | Copies the SQLite database and WAL sidecars into a timestamped crash-backup folder |
| Process crash hook | `instrumentation.ts` (repo root) | Registers `uncaughtException`/`unhandledRejection` handlers that invoke the crash backup |
| Admin API — status | `GET /api/admin/updates` | Ledger, current and latest release, last backup time; powers the Admin card |
| Admin API — cloud rollback | `POST /api/admin/updates/rollback` | Server-side call to the Vercel deployments API to roll production back |
| Admin API — snapshot | `POST /api/admin/backup` | Admin-triggered backup snapshot with download |
| Admin UI | Admin → "Updates, rollback & backups" card | One surface for status, ledger history, rollback and backup actions |
| Environment keys | `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`, `GITHUB_TOKEN`, `BACKUP_DIR` | Least-privilege credentials (server-side only) and the backup destination |
