# Mbumah Hardware POS — Remote Access Kit (RAK): Implementation Plan

Version 1.0 — 2026-10-07 — status: planned (Phase 0 ready to start; builds directly on the shipped v2.9.0/v2.10.1 update foundation)

This document is the implementation plan for the **Remote Access Kit**: the layer that lets the owner log in from anywhere — a phone in Nairobi, a laptop abroad — see every store, push security and feature updates with a few taps, open a secure view into any shop's screen, and trust that **every single action is recorded in GitHub**.

The RAK does not replace the update machinery that shipped in v2.9.0/v2.10.1 (`update-pos.ps1`, nightly + on-startup convergence, health gate, auto-rollback, crash backups, the Admin "Updates, rollback & backups" card). It **wraps a command-and-control and audit layer around it**, using GitHub itself as both the message bus and the audit ledger — no new servers, no port forwarding, no VPN appliances.

---

## 1. RFP inputs — the blanks, filled from the real system

| RFP field | Filled value |
|---|---|
| **Current System Environment** | Two deployment surfaces sharing one repo (`bucky-ops/mbumah-hardware-pos`). **Cloud:** Vercel (Next.js 16 App Router) + Neon PostgreSQL; `main` auto-deploys on merge; `release.yml` auto-publishes a GitHub Release on every `package.json` version bump. **Fleet:** 5 store counter-PCs (Windows, no-Docker kit: Node 20, standalone build, one SQLite file at `%USERPROFILE%\mbumah-pos-data\pos.db`) behind consumer NAT, with `update-pos.ps1` running nightly at 23:00 plus an update-on-every-launch check, health-gated with automatic code rollback, an append-only `update-ledger.jsonl`, and self-healing scheduled tasks. Auth is session-based (`requireAuth`, roles `SUPER_ADMIN` / `STORE_OWNER`); audit today = `SystemLog` table, `update-ledger.jsonl`, and GitHub's own commit/Release/Actions history. |
| **Types of Updates Required** | (a) Security patches — dependency CVEs, auth hardening, secret rotation follow-ups; (b) Feature releases — versioned `v2.x.y` bumps with release notes; (c) Schema changes — Prisma `db:push` steps already embedded in the updater rebuild; (d) Rollbacks — one command per store, ledger-driven; (e) Operational directives — update freezes for peak trading, maintenance notices, remote-view sessions. |
| **Preferred Technologies or Tools** | GitHub (Releases, fine-grained PATs, branch protection, a new private `mbumah-ops-log` repo as bus + ledger), Vercel REST API (deployments + rollback — endpoints already in the app), PowerShell 5.1-safe scripts + Task Scheduler (existing kit), Node 20 (`agent.mjs`), Cloudflare Tunnel / Tailscale for on-demand remote view, and the WhatsApp/SMS/Email gateway stack already built into the app for notifications. |
| **Security Protocols to Implement** | Least-privilege per-device GitHub tokens (repo-scoped, 90-day expiry, rotation calendar); HMAC-signed, replay-protected commands; branch protection with required CI checks (already active); 2FA on all GitHub/Vercel accounts; secrets only in `.env` (ACL 600) or Vercel env, never in the repo; SUPER_ADMIN-only destructive actions with typed confirmation; full actor attribution (session email + device ID + signature) written into every ledger entry; break-glass local admin path. |

---

## 2. Foundation that already ships (what the RAK builds on)

| Shipped artifact (version) | Role in the RAK |
|---|---|
| `deploy/nodocker/update-pos.ps1` / `.sh` (v2.9.0) | The execution arm: backup → git-tag/ZIP update → installer-identical rebuild → health gate → auto-rollback → ledger. The RAK agent invokes it with `-Force` / `-ToVersion`. |
| Update-on-every-launch (v2.10.1) | `start-pos` runs `update-pos -Quiet -NoStart` before the server starts — offline stores converge the moment they boot. The RAK rides on this for catch-up. |
| `rollback-pos.ps1/.sh` + `Rollback-Mbumah-POS.bat` (v2.9.0) | Ledger-driven rollback the RAK remote-rollback command calls. |
| `update-ledger.jsonl` + self-healing scheduled tasks (v2.9.0–v2.10.1) | On-device truth the agent mirrors into GitHub. |
| `GET /api/admin/updates`, `POST /api/admin/updates/rollback`, `GET /api/admin/backup` (v2.9.0) | Cloud-side posture, Vercel rollback and snapshot endpoints the console reuses as-is. |
| Admin card `src/components/admin/updates-safety-section.tsx` (v2.9.0) | UI pattern (badges, honest degradation, typed confirmation) the Remote Ops console extends. |
| `release.yml` auto-publish governance (since v2.7.3) | "A version bump on `main` is the single act of publishing" — the RAK commands reference release tags, never ad-hoc builds. |
| WhatsApp/SMS/Email gateways (v2.8.0, optional keys) | Notification channel for update started/succeeded/failed/rolled-back events. |
| CI required checks (`Lint`, `Build`, `Test`, `Security`, `CI-Pass`) | Nothing reaches `main` unverified — protects the update pipeline at its source. |

---

## 3. Product definition and goals

**Definition.** The Remote Access Kit is five interlocking modules:

- **A. Remote Ops Console** — a user-friendly admin UI (inside the existing app, works on a phone) for viewing the fleet and pushing updates/rollbacks/freezes.
- **B. GitHub Control Bus** — a private `mbumah-ops-log` repository that carries commands out to stores and results back, using ordinary commits. GitHub is the network: stores are pull-only, so no inbound ports, no static IPs, no VPN infrastructure.
- **C. Edge Agent** — a small always-on Node process on each store PC that polls for commands, verifies signatures, executes the shipped updater/rollback scripts, and reports results back to GitHub.
- **D. Remote View Gateway** — on-demand, time-boxed secure view into any store's local UI (Cloudflare Tunnel recommended; Tailscale as the alternative).
- **E. GitHub Audit Ledger** — every command, result, heartbeat, tunnel session and incident lands as a timestamped, attributed commit in `mbumah-ops-log`. GitHub's commit history **is** the audit trail.

**Goals, measurable:**

| # | Goal | Target |
|---|---|---|
| 1 | Admin can push an update from anywhere | Command issued → executed ≤ 15 min (agent poll cadence), or at the next dormant window by default |
| 2 | Fleet convergence after a release | 100% of connected stores on the target version ≤ 24 h |
| 3 | Audit completeness | 100% of remote operations have a GitHub commit (command + result) within the SLA |
| 4 | Remote rollback MTTR | ≤ 5 min from decision to healthy store (matches the RTO KPI of the architecture plan) |
| 5 | Remote view | Admin can open a store screen from a phone ≤ 2 min, session auto-expires |
| 6 | Zero interruptions | No trading-hour impact by default; force-pushing during trading hours requires explicit override + confirmation |
| 7 | Fleet visibility | ≥ 95% heartbeat coverage of the estate in any 24 h window |

**Out of scope for v1 of the RAK:** real-time screen sharing/streaming ( tunnels are browser sessions, not VNC), remote data edits (the RAK issues operational commands, never writes business data), and POS feature development.

---

## 4. Architecture overview

```
                ┌────────────────────────────────────────────┐
                │ ADMIN (phone / laptop, anywhere)           │
                │ Remote Ops console inside the POS app      │
                │ (Admin tab → "Fleet & Remote Ops")         │
                └───────────────┬────────────────────────────┘
                                │ HTTPS, session + Bearer (edge-proxy rule)
                                ▼
                ┌────────────────────────────────────────────┐
                │ CLOUD APP (Vercel + Neon)                  │
                │ NEW  POST /api/admin/fleet/command         │──► Vercel API
                │ NEW  GET  /api/admin/fleet                 │    (deployments,
                │ NEW  GET  /api/admin/fleet/log             │     rollback — existing)
                │ server-side GitHub token (never exposed)   │
                └───────────────┬────────────────────────────┘
                                │ commits commands / reads ledger
                                ▼
                ┌────────────────────────────────────────────┐
                │ GITHUB                                     │
                │  mbumah-hardware-pos (existing)            │
                │    └ tags + Releases (release.yml)         │
                │  mbumah-ops-log (NEW, private)             │
                │    ├ commands/<store-id>.json              │
                │    ├ results/<store-id>/<ts>-<cmd>.json    │
                │    ├ ledger/<store-id>.jsonl               │
                │    └ incidents/                            │
                └──┬──────────────┬──────────────┬───────────┘
       poll commands   │              │              │
       (pull-only)     ▼              ▼              ▼
        ┌────────────────┐  ┌────────────────┐  ┌────────────────┐
        │ STORE 1 PC     │  │ STORE 2 PC     │  │ … 5 stores     │
        │ agent.mjs      │  │ agent.mjs      │  │ agent.mjs      │
        │  ├ update-pos  │  │  ├ update-pos  │  │                │
        │  ├ rollback    │  │  ├ rollback    │  │                │
        │  └ cloudflared │  │  └ cloudflared │  │                │
        │     (on demand)│  │     (on demand)│  │                │
        └────────────────┘  └────────────────┘  └────────────────┘
```

**Why GitHub as the bus (and not a custom server, Actions-only, or VPN):**

| Option | Verdict | Reason |
|---|---|---|
| Custom cloud service + inbound connections to stores | Rejected | Stores are behind consumer NAT in Kenya; would need port forwarding, static IPs or a relay — new attack surface, new running costs |
| GitHub Actions as the runtime for every operation | Rejected for the hot path | Actions minutes scale with heartbeats (5 stores × hourly ≈ 3,600 runs/month); adds queue latency to every step |
| **Commits in a private ops repo as bus + ledger** | **Chosen** | Zero new infrastructure; pull-only from stores (NAT-proof, metered-data friendly); every message is automatically a timestamped, attributed, immutable audit record; free at this fleet size |
| VPN (router-level) for remote view | Rejected for v1 | Requires router admin per store; Cloudflare Tunnel achieves browser-level access with Zero Trust policies and no router changes |

---

## 5. Module B — GitHub Control Bus (`mbumah-ops-log`)

### 5.1 Repository layout

```
mbumah-ops-log/                        (private)
├── README.md                          what this repo is + token policy
├── commands/
│   └── <store-id>.json                the CURRENT pending command per store
│                                      (absent file = nothing pending)
├── results/
│   └── <store-id>/<ts>-<command-id>.json   one result per execution
├── ledger/
│   └── <store-id>.jsonl               append-only history (one line per event)
├── incidents/
│   └── <ts>-<slug>.md                 post-mortem notes (Phase 5)
└── fleet/
    └── ring-assignment.json           ring 0/1/2 membership per store
```

### 5.2 Command lifecycle

1. **Issue.** The admin presses "Update now" in the console → cloud route `POST /api/admin/fleet/command` (SUPER_ADMIN) validates with zod, signs the payload, and **commits** `commands/<store-id>.json` to `mbumah-ops-log` via the GitHub contents API using the server-side token. The commit itself is the first audit record (author = the ops token, actor email carried in the payload).
2. **Discover.** Each store's agent polls `commands/<store-id>.json` every 15 minutes (contents API; also an immediate check on agent start). ~4 requests/hour per store — negligible against the 5,000 req/h token limit.
3. **Verify.** The agent checks the HMAC-SHA256 signature (`OPS_SIGNING_KEY`), the freshness window (±10 min), and that `command-id` is not a replay of the last executed ID. Invalid → result entry `rejected_signature`, command never executed.
4. **Execute.** The agent maps command type to the shipped scripts: `update` → `update-pos.ps1 -Quiet` (plus `-Force` only if the admin overrode the dormancy window; otherwise the result reports `queued_for_window` and the update happens at 23:00 or next launch); `rollback` → `rollback-pos.ps1 -ToVersion <tag>`; `freeze` / `unfreeze` → local state file consulted before any update; `tunnel` → Module D.
5. **Report.** The agent commits `results/<store-id>/<ts>-<command-id>.json`, appends one line to `ledger/<store-id>.jsonl`, and deletes the pending command file (one atomic commit per report).
6. **Surface.** The console reads results/ledger via the cloud routes (server-side token, 60 s cache) and shows each row with a direct link to its commit on GitHub.

### 5.3 Command and heartbeat schemas (authoritative in Appendix A)

```json
// commands/juja.json — committed by the cloud
{
  "command-id": "cmd-20261007-ja3f9",
  "type": "update",
  "target": "juja",
  "version": "v2.11.0",
  "force": false,
  "issued-at": "2026-10-07T18:04:00+03:00",
  "issued-by": "sam@mbumahhardware.co.ke",
  "sig": "hmac-sha256:<hex>"
}
```

Heartbeats ride the same path in reverse: every 6 hours (plus after every result) the agent commits a small JSON line — version, build SHA, `/api/health` summary, last-sale timestamp, disk free, `UPDATE_ON_START` state — to `ledger/<store-id>.jsonl`. Six-hour cadence keeps the audit rich while staying invisible on metered connections (≈ 2 MB/day/store total for all polling + reporting).

### 5.4 Security of the bus

- **Device tokens:** one fine-grained GitHub PAT per store, scoped to exactly two repositories — `mbumah-ops-log` (contents: read **and** write, for results/ledger commits and command deletion) and `mbumah-hardware-pos` (contents: **read only**, for release checks). 90-day expiry. A stolen store token cannot push code, cannot read secrets, cannot touch other stores' paths.
- **Command signing:** `OPS_SIGNING_KEY` (32-byte secret) lives in the cloud env and each kit `.env`. Commands without a valid HMAC are rejected before execution — a leaked store token alone cannot make a store run arbitrary commands.
- **Replay protection:** freshness window + per-store `last-command-id` persisted locally.
- **Tamper visibility:** the console pins the SHA of the last ledger commit it read; a mismatch (history rewritten) raises an integrity alarm entry. Force-push protection on `mbumah-ops-log` via branch settings.

---

## 6. Module C — Edge Agent (`agent.mjs`)

A single Node file (target < 400 lines, zero new npm dependencies) shipped in `deploy/nodocker/` and run by a new scheduled task **"Mbumah POS Agent"** every 15 minutes (`schtasks`, PS 5.1-safe quoting — the exact pattern proven by the v2.9.0 installer work) plus on system start.

```
tick():
 1. read commands/<store-id>.json via contents API      (device token)
 2. verify sig + freshness + replay window              → else commit rejected-result
 3. dispatch by type:
      update   → exec update-pos.ps1 -Quiet [-Force] [-ToVersion]
      rollback → exec rollback-pos.ps1 -ToVersion <tag>
      freeze   → write mbumah-pos-data/frozen.flag (+ reason); skip any update
      tunnel   → Module D flow
 4. commit result JSON + append ledger line             (one commit)
 5. if heartbeat due (6 h or post-command): append heartbeat line
 6. self-heal: re-register own schtask if missing (Ensure-ScheduledTasks pattern)
```

Deliberate properties:

- **Never blocks the POS.** The agent runs out-of-process; a hung update is bounded by the same 60 s health-gate timeouts already shipped. `update-pos` exits are the source of truth, not the agent's opinion.
- **Offline is normal.** Every network step has short timeouts and harmless exits (the `-Quiet` philosophy from v2.10.1). Missed commands execute on the next successful tick; the on-launch update check remains the ultimate catch-up.
- **Owner override preserved.** `Update-Mbumah-POS.bat` / `Rollback-Mbumah-POS.bat` keep working exactly as documented — the freeze flag only gates *agent-initiated* updates, and the client guide says so in plain language.
- **Freeze for peak season.** A frozen store skips agent-driven updates but heartbeats continue, so the admin still sees versions while December trading runs untouched.

---

## 7. Module A (cloud half) — new API surface

Three routes, following the repo's canonical `withErrorBoundary(requireAuth(...))` + zod patterns, all server-side GitHub access via one console token (`OPS_GITHUB_TOKEN`) that never reaches the browser:

| Route | Auth | Behaviour |
|---|---|---|
| `GET /api/admin/fleet` | SUPER_ADMIN (full) / STORE_OWNER (own store, read-only) | Per store: last heartbeat (version, build SHA, health, last sale, disk), pending command if any, drift vs latest release, ring, freeze state. Merge of ops-log reads + existing `GET /api/admin/updates` data for the cloud row itself. Every upstream failure degrades honestly (null + note), never throws. |
| `POST /api/admin/fleet/command` | SUPER_ADMIN only | zod: `{ type: 'update'|'rollback'|'freeze'|'unfreeze'|'tunnel', targets: string[], version?, force?, reason? }`. Validates target stores against the live store list, signs, commits one command file per store, writes `FLEET_COMMAND` SystemLog, returns the per-command GitHub commit URLs for immediate display ("Every action is recorded: view on GitHub"). |
| `GET /api/admin/fleet/log` | SUPER_ADMIN / STORE_OWNER (own store) | Paginated merge of `ledger/*.jsonl` + `results/` (server-side cached 60 s), each row: time, actor, store, type, outcome, **commit URL**. |

Cloud updates stay as they are today — `main` merges deploy automatically and the existing rollback button covers the cloud row; the fleet table simply shows the cloud as ring-aware row zero so the whole estate is one screen.

---

## 8. Module A (UI half) — Remote Ops Console design

One new admin-tab section (`src/components/admin/fleet-remote-ops-section.tsx`), placed directly under the existing "Updates, Rollback & Backups" card, reusing its visual language (shadcn/ui Card, Badge, Select, AlertDialog, Tabs; lucide icons; no blue/indigo palette; mobile-first).

**Screen 1 — Fleet table (default view).** One row per store + cloud:
`Store · Ring · Version (vs latest, drift badge) · Health dot · Last heartbeat (relative + absolute) · Pending command spinner · Freeze badge`. Row actions: **Update… / Rollback… / Remote view… / Freeze…**. Amber banner whenever a store list fails to load with a Retry button — the v2.10.1 silent-401 lesson, applied by construction (`authorizedFetchJson` everywhere).

**Screen 2 — Update composer (AlertDialog).** Select action + targets (chips for rings: "Ring 0 · dev", "Canary · Juja", "All stores") + version picker (fed by the release list the app already fetches) + dormancy notice ("Will apply tonight 23:00 unless you force now") + force toggle (hidden behind an extra confirm when trading hours) + reason field (free text, becomes part of the command JSON and the ledger). Typed confirmation (`UPDATE`) for any destructive/forced combination — same pattern as the existing rollback dialog.

**Screen 3 — Activity log drawer.** Filterable (store/type/outcome/actor) table where **every row links to its GitHub commit**. This is the transparency surface the client asked for: "who did what, when, with what result — and prove it."

**Screen 4 — Remote view dialog.** "Open remote view" → shows pending state → once the agent confirms, shows the one-time store URL + auto-expiry countdown (60 min default) → "Session recorded in GitHub" line with the commit link.

Empty/degraded states are honest and actionable (e.g., "No heartbeat from Nakuru in 31 h — last seen v2.10.0 at 07:42. The store may be offline or powered down.").

---

## 9. Module D — Remote view access (on-demand tunnels)

The client requirement is "remote view access for the admin." Two tiers:

**Tier 1 — always-available fleet view (no new infra).** The console itself, backed by heartbeats: versions, health, last sale, last backup per store, reachable from any browser. Ships with Phase 2.

**Tier 2 — on-demand screen-level view.** The admin sometimes needs to *see the actual POS screen* at a shop (e.g., to guide a cashier through a fix). Design:

1. Console issues a `tunnel` command for store X with a TTL (default 60 min).
2. The agent starts `cloudflared` (a single ~20 MB binary the agent downloads once, verified by SHA-256) with a per-store tunnel token; Cloudflare Zero Trust policy allows only the owner's email (OTP by email domain `mbumahhardware.co.ke`).
3. The agent reports the stable URL (`https://juja.view.mbumahhardware.co.ke`) back to `mbumah-ops-log`; the console shows it with a countdown.
4. TTL expiry → the agent kills the process; open/close events are committed to the ledger. Zero standing exposure: when no tunnel command is active, the store accepts no inbound connections at all.

| Option | Setup per store | Admin client | Cost | Verdict |
|---|---|---|---|---|
| **Cloudflare Tunnel + Zero Trust** | one binary + tunnel token | any browser | free ≤ 50 users | **Chosen** — no router changes, no admin-side client, email-OTP, per-session audit |
| Tailscale | agent install + pre-auth key | Tailscale app on admin device | free ≤ 100 devices | Documented fallback; best if tunnels prove flaky |
| Router-level VPN | router config per shop | VPN client | hardware/time | Rejected v1 — varies by shop router, needs on-site work |
| ngrok quick tunnels | none | browser | free tier limits | Rejected — ephemeral URLs defeat auditability |

---

## 10. Security architecture

### 10.1 Secret inventory and rotation

| Secret | Scope | Stored in | Rotation |
|---|---|---|---|
| `OPS_GITHUB_TOKEN` (console) | contents RW on `mbumah-ops-log` only | Vercel env + kit cloud `.env` | 90 days |
| 5 × device tokens | ops-log RW + main repo read-only | per-store `.env` (ACL 600) | 90 days |
| `OPS_SIGNING_KEY` | command authenticity | cloud env + kit `.env` | 180 days, or immediately on any suspicion |
| `VERCEL_TOKEN` / `VERCEL_PROJECT_ID` | cloud rollback (existing) | Vercel env | 90 days — **includes the pending `vcp_` token rotation owed since v2.8.0 governance** |
| `CRON_SECRET` | local cron auth (existing) | kit `.env` | 180 days |

Rotation is a calendar event (shared owner calendar, 2-week reminder), and the RAK's own ledger records "token rotated" entries — the audit trail covers its own keys.

### 10.2 Protocol checklist (enforced, not aspirational)

- 2FA on all GitHub/Vercel accounts; hardware key for the owner account where possible.
- Branch protection on `main` with required checks (already active) — extend the same to `mbumah-ops-log` (no force-push, no deletion).
- Least privilege per §10.1; no token ever grants write to `mbumah-hardware-pos` except the two maintainer PATs used by developers.
- All destructive console actions: SUPER_ADMIN + typed confirmation + reason field.
- Attribution: `issued-by` (session email) + `target` + `command-id` + signature in every command; agent identity (`store-id` + token) in every result. Identity never shared between stores.
- Secrets never in the repo: `Security` CI check stays required; `.env` files are gitignored and excluded from updater `robocopy` (already true since v2.9.0).
- Break-glass: a printed recovery procedure in the owner's safe (local SUPER_ADMIN reset path documented in `CLIENT_SETUP_GUIDE`), so a lost admin password cannot lock the business out of its own tooling.
- Incident runbook (Phase 5 deliverable): suspect token → revoke → rotate signing key → review ops-log history → file `incidents/<ts>.md` → post-mortem commit.

### 10.3 What the audit guarantees

Every remote operation produces: one command commit (who, what, when, signed), one result commit (outcome, versions, backup path, duration), one ledger line per store, one `FLEET_*` SystemLog row in the app, and optionally a notification message. Four independent records, mutually consistent, with the GitHub commits as the externally verifiable ones.

---

## 11. Step-by-step implementation guide

Effort assumes the standing team (2–3 intermediate developers, Windows-first). "Dev-days" are focused engineering days.

**Phase 0 — Hardening and prerequisites (Week 1 · 3–4 dev-days)**
1. Enable 2FA everywhere; audit collaborator list on both repos.
2. Create private `mbumah-ops-log`; add README + branch settings (no force-push/delete).
3. Issue the console token + 5 device fine-grained PATs (90-day expiry); record them in the rotation calendar; **rotate the owed `vcp_` Vercel token in the same sitting**.
4. Installer change: write `STORE_ID` and `OPS_SIGNING_KEY` into the kit `.env` (one line each; existing installs get them via the next update's `.env.example` refresh — the updater already refreshes the template, v2.9.0 behaviour).
5. Exit criteria: `mbumah-ops-log` exists; a test commit from the cloud works; every store has a token in its `.env`.

**Phase 1 — GitHub bus + edge agent (Weeks 2–3 · 6–8 dev-days)**
1. `POST /api/admin/fleet/command` + signing; `GET /api/admin/fleet/log` (reader with 60 s cache).
2. `agent.mjs` (poll/verify/execute/report/heartbeat/self-heal); scheduled task "Mbumah POS Agent" every 15 min + on start, registered by the installer and by `Ensure-ScheduledTasks`.
3. `bash -n`/PS 5.1 syntax gates in CI for all new kit scripts (the repo's existing discipline).
4. Simulator test: a dev machine posing as a store executes a signed update command end-to-end.
5. Exit criteria: command → execution → result commit with total latency measured; signature/replay rejection proven; release **v2.11.0**.

**Phase 2 — Remote Ops console (Weeks 3–5 · 5–6 dev-days)**
1. `GET /api/admin/fleet`; `fleet-remote-ops-section.tsx` (fleet table, composer, activity log, freeze UI) per §8; `FLEET_*` SystemLog wiring.
2. Mobile QA (390 px), honest-degradation review, `authorizedFetchJson` everywhere.
3. Exit criteria: E2E on the production cloud + one real store; release **v2.11.x**; owner pushes a real update from a phone.

**Phase 3 — Remote view tunnels (Weeks 5–7 · 4–5 dev-days)**
1. Cloudflare Zero Trust org + `*.view.mbumahhardware.co.ke` wildcard; agent `tunnel` command handling (download-verify cloudflared, TTL kill switch); console dialog per §8 Screen 4.
2. Exit criteria: admin opens a live store screen from a phone; expiry + ledger events verified; release **v2.12.0**.

**Phase 4 — Notifications (Week 8 · 2 dev-days)**
1. Route `update started/succeeded/failed/rolled-back/tunnel-opened` events through the existing WhatsApp/SMS/Email gateways (opt-in per owner; plain-language messages; no secrets in messages).
2. Exit criteria: forced-failure drill in the simulator produces a WhatsApp within a minute.

**Phase 5 — Rings, drills, governance (Weeks 9–12 · 3–4 dev-days)**
1. `fleet/ring-assignment.json`: Ring 0 = dev store (every release), Ring 1 = canary (Juja, after a 24 h Ring-0 soak), Ring 2 = the rest; the composer's ring chips read this file.
2. Drills: rollback drill, kill-switch/freeze drill, token-revocation drill — each filed as `incidents/<ts>.md` with findings.
3. Freeze window policy for December peak; weekly digest Action (optional, one scheduled workflow: compiles the week's ledger into a digest issue).
4. Owner training + `CLIENT_SETUP_GUIDE` §11 ("Remote Ops: what the buttons do").
5. Exit criteria: drills pass; release **v2.12.x**; RAK declared operational.

**Months 3–6:** drift alarms (store behind its ring's grace period → notification), delta updates (shallow git fetch / pack reuse to cut update bandwidth), auto-generated release notes from PR labels, per-store version pinning for stores that request it.
**Months 6–12:** fleet analytics (update duration distributions, failure clustering), beta channel for opt-in stores, multi-country/multi-currency estate readiness.

---

## 12. Update scenarios (worked examples)

**A. Critical security patch (CVE in a dependency).** Dependabot alert arrives → owner opens the console on a phone at 14:10 → reviews fleet table (5 stores, all v2.10.1, healthy) → Update composer: type `update`, targets "All stores", version = the freshly published security tag, force = off → reason "CVE-2026-xxxxx dependency" → confirm. 14:10 command commits appear (5 commits, each with the actor email). Each agent picks it up within 15 min; because it is trading hours and force = off, each reports `queued_for_window` → at 23:00 local, the shipped updater does backup → update → health gate per store → result commits land 23:04–23:19. 23:20 the console shows all green; owner receives one WhatsApp summary. Total admin time: **90 seconds**. If the CVE required immediate action, force = on with typed confirmation executes during a chosen low-traffic window instead.

**B. Feature release (v2.12.0 — tunnels).** Merge to `main` → CI green → version bump → Release auto-published. Composer: targets "Ring 0" → Ring-0 store converges by next tick, result commit at 18:31, owner soaks 24 h → "Canary · Juja" next day → 24 h → "All stores" on day 3. Any failed health gate auto-rolls that store back (shipped behaviour) and the failure is visible in the log + WhatsApp before the next ring is even considered.

**C. Bad release at one store.** Store 3's result commit shows `update_failed → auto_rollback` overnight. Owner confirms with `rollback` to the previous tag anyway (data-safe by design) → agent runs `rollback-pos.ps1 -ToVersion v2.11.3` → healthy in ≤ 5 min → incident note filed from the log with one click.

**D. Offline store rejoins.** Nakuru was powered off for three days. On boot, `start-pos` runs the update check (v2.10.1 behaviour) → converges to latest before the shop opens; the agent then heartbeats, executes any command that waited in `commands/nakuru.json`, and the console's "31 h without heartbeat" amber clears itself — no human chase needed.

**E. December freeze.** Mid-December: composer → `freeze` → "All stores", reason "Peak trading — no updates until January". Agents write `frozen.flag`; pending update commands return `rejected_frozen`; heartbeats continue so the owner still sees versions daily. January 5: `unfreeze`, queued releases flow. Manual `.bat` updates by the owner on-site remain possible throughout (documented owner override).

---

## 13. Challenges and solutions

| Challenge | Solution (already designed-in) |
|---|---|
| Stores behind consumer NAT — no inbound reachability | Pull-only agent design; GitHub is the bus; tunnels are outbound-only and on-demand |
| Unreliable internet / metered data | Short `-Quiet` timeouts; 15-min poll + 6-h heartbeat ≈ 2 MB/day/store; missed commands execute on next tick and on launch |
| Power cuts mid-update | Pre-update backup + atomic swap + health gate + auto-rollback already shipped; agent is stateless across ticks — the next tick re-enters cleanly |
| Leaked device token | Token grants only ops-log RW + main repo read-only; commands must additionally be HMAC-signed; 90-day expiry; revocation drill in Phase 5 |
| Forged/replayed commands | HMAC-SHA256 over the command body + ±10 min freshness + `command-id` replay window |
| Rate limits | Authenticated 5,000 req/h vs ~5 req/h/store actual; console ledger reads cached 60 s and served from the cloud |
| Version skew across stores | Drift badges + ring grace-period alarms (Months 3–6); on-launch catch-up already converges offline stores |
| SQLite/Postgres divergence between kit and cloud | Provider-aware code discipline (PR #83 precedent) + CI matrix; the RAK never writes business data, reducing schema-coupling risk |
| Admin lockout | Break-glass local SUPER_ADMIN procedure printed in the safe; two maintainer identities required for repo-level recovery |
| Ledger tampering | No force-push/delete on `mbumah-ops-log`; console pins last-read commit SHAs; integrity mismatch raises an alarm |
| Owner confusion / fear of "remote control" | Plain-language framing: the RAK can update, roll back and open a timed view — it can never touch business data; every action is visible in GitHub with the owner's own eyes as the audit |
| GitHub outage | The fleet keeps trading (no runtime dependency); updates simply wait; on-launch catch-up reconciles after recovery |

---

## 14. Best practices — remote access and update management

**Remote access.** Per-person identity, never shared logins; least-privilege by default (view > control > code-write, in that order of rarity); destructive actions need typed confirmation and a reason; standing remote exposure is zero — access is either the always-on pull-only bus or a time-boxed tunnel; review the ops-log weekly (5-minute habit: scan for red badges and unknown actors); quarterly access review (who has tokens, who has SUPER_ADMIN).

**Update management.** Every release is a tag (no ad-hoc builds — governance since v2.7.3); ring 0 always soaks 24 h before canary; canary soaks 24 h before fleet; backup-first is non-negotiable (already enforced in code); never force updates into trading hours unless a security emergency, and then with typed confirmation; freeze windows for peak seasons are scheduled, not improvised; post-update, watch the log for one heartbeat cycle before considering a rollout done; document every exception as an `incidents/` note — the audit trail is also the institutional memory.

---

## 15. Success metrics (reviewed monthly)

| Metric | Target | Source |
|---|---|---|
| Command → execution latency (median) | ≤ 15 min | command/result commit timestamps |
| Fleet convergence after a release | ≤ 24 h (connected stores) | ledger versions per store |
| Audit completeness | 100% commands with a result commit ≤ 1 h of execution | ops-log query |
| Remote rollback MTTR | ≤ 5 min | result JSON `durationMs` |
| Heartbeat coverage | ≥ 95% of store-days | ledger gap analysis |
| Trading-hour interruptions caused by RAK | 0 | result timestamps vs shop hours |
| Forced updates (override used) | ≤ 1/quarter, each with a reason | command `force` flag |
| Tunnel sessions | 100% auto-expired, 0 standing | ledger tunnel events |

---

## 16. Resources and cost

| Item | Cost |
|---|---|
| GitHub private repos, fine-grained PATs, branch protection, Actions (CI only — the RAK hot path uses zero Actions minutes) | included in the existing plan |
| Cloudflare Tunnel + Zero Trust (≤ 50 users, unlimited tunnels) | free |
| `cloudflared` on store PCs | ~20 MB RAM when active, 0 when idle |
| Bandwidth per store | ≈ 2 MB/day (polls, heartbeats, command fetch); updates unchanged from the shipped kit |
| Engineering | ≈ 24–29 dev-days across Weeks 1–12 (Phases 0–5) |
| New servers / appliances | none |

---

## 17. Risk register (top items)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| GitHub unreachable from a store for days | Medium | Low | Pull-only design degrades to the shipped on-launch catch-up; trading unaffected |
| Signing key mishandling during rotation | Low | High | Rotation runbook with verification command; old key honoured ±1 h overlap; drill in Phase 5 |
| Console token leak from a maintainer laptop | Low | High | Token scoped to ops-log only; immediate revocation; ledger integrity review; drill in Phase 5 |
| Agent bug loops updates | Low | Medium | Agent has no update logic of its own — it calls the battle-tested updater; result-per-command prevents re-execution (replay window); freeze command is the remote kill-switch |
| Cloudflare dependency for remote view | Low | Low | Tier 1 fleet view is independent of Cloudflare; Tailscale documented as fallback |
| Owner distrust of remote control | Medium | Medium | Radical transparency: every action visible in GitHub, notifications on every fleet event, owner override and freeze always available |

---

## Appendix A — schemas

**Command** (committed by the cloud, see §5.3 example): `command-id` (`cmd-<date>-<rand>`), `type` (`update|rollback|freeze|unfreeze|tunnel`), `target` (store id), `version?` (tag, update/rollback only), `force?` (bool), `ttl-minutes?` (tunnel), `reason?`, `issued-at`, `issued-by`, `sig` (`hmac-sha256:<hex over canonical JSON of all prior fields`).

**Result** (committed by the agent): `command-id`, `target`, `type`, `outcome` (`success|failed|rolled_back|queued_for_window|rejected_signature|rejected_frozen|skipped_offline`), `from-version`, `to-version?`, `backup-path?`, `health?`, `duration-ms`, `agent-version`, `reported-at`.

**Heartbeat** (ledger line): `event: heartbeat`, `version`, `build-sha`, `health` (summary of `/api/health` checks), `last-sale-at`, `disk-free-mb`, `frozen`, `agent-version`, `ts`.

## Appendix B — quick reference

```
# Issue an update to one store (cloud, from the console or API)
POST /api/admin/fleet/command
  { "type":"update", "targets":["juja"], "version":"v2.11.0",
    "force":false, "reason":"feature rollout" }

# What the agent runs (kit side)
update-pos.ps1 -Quiet -NoStart            # command-driven, dormant-respecting
update-pos.ps1 -Quiet -Force              # forced (typed confirmation in console)
rollback-pos.ps1 -ToVersion v2.11.3       # remote rollback

# Where to look when anything is unclear
mbumah-ops-log → ledger/<store>.jsonl     full history, one line per event
mbumah-ops-log → results/                 per-command outcomes
Admin tab → Fleet & Remote Ops → Activity log   same data, linked to commits
```

## Appendix C — relationship to the architecture plan

This RAK plan is the operational extension of `docs/ARCHITECTURE_PLAN_AUTOUPDATE_ROLLBACK_BACKUP.md`. That plan made updates safe (backup → health gate → rollback → ledger). The RAK makes them **remote and accountable**: the same scripts, the same ledger discipline, now commandable from anywhere with GitHub as the control bus and the public audit trail. Phase numbering continues the same roadmap (the "fleet management" items of that plan's months 3–6/6–12 are superseded by this document's Phases 2/5 and the months 3–6/6–12 horizons here).
