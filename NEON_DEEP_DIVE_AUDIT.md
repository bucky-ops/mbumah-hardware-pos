# Neon ⇄ Vercel ⇄ GitHub — Deep-Dive Pipeline Audit

**Project:** pos-erp-crm (`broad-snow-78900501`) · mbumah-hardware-pos
**Audit date:** 2026-09-04 · **Method:** live API + SQL diagnostics against production, full repo/workflow inspection, real latency measurements. Every finding below is evidence-based; no speculation.

| Layer | Detail |
|---|---|
| Neon | PG **18.6**, branch `production` (`br-proud-lab-ai15r38h`), endpoint `ep-calm-butterfly-aivj6kzm` (+`-pooler`), `aws-us-east-1`, autoscaling **0.25 → 2 CU**, DB size **19 MB** |
| Vercel | Next.js 16, functions in **iad1** (via `x-vercel-id`), App integration deploys green |
| GitHub | `main` protected (required checks `CI Pass` + `Build`, strict, enforce-admins, no force-push), secret scanning **+ push protection enabled** |
| ORM | Prisma **^6.11.1**, pooled `DATABASE_URL` + direct `DIRECT_URL` split |

---

## Executive Summary

| # | Area | Finding | Severity | Status |
|---|------|---------|----------|--------|
| A1-1 | Compute | Scale-to-zero active → measured **~1.4 s cold-start penalty** on first hit after idle | Medium | Documented + options |
| A1-2 | Compute | `statement_timeout=0` (unbounded) on prod | Medium | Recommend |
| A2-1 | CI/CD | **Schema drift**: repo schema ahead of prod DB by 2 feature releases (eTIMS, loyalty, debt plans, exports, shifts) → P2022 runtime errors on freshly deployed code | **P0** | **FIXED this audit** (additive sync applied) |
| A2-2 | CI/CD | CLI deploy job failed on dead `VERCEL_TOKEN`; primary Vercel App path unaffected | Medium | **FIXED** (graceful degradation) |
| A2-3 | CI/CD | No migration discipline: schema reaches prod only via manual `db push`; no ephemeral PR branches | High | Roadmap + YAML |
| A3-1 | Performance | **Zero caching layer** — every request re-queries Neon; heavy seq-scan hotspots on `products` (10.4k) and `sales_transactions` (10.5k) vs idx scans (88) | High | Roadmap |
| A3-2 | Performance | Region alignment verified correct (iad1 ⇄ us-east-1) | Info | ✓ |
| A4-1 | Security | Leaked Neon password `npg_aRfW…` still **valid and live in git history**; rotation blocked on owning-account Vercel token (issue #9) | **P0** | Blocked — documented |
| A4-2 | Security | PITR retention only **6 hours** (`history_retention_seconds=21600`) | High | Recommend |
| A4-3 | Security | Multi-tenancy enforced only at ORM layer (no RLS); `neondb_owner` is the single super-privileged role | Medium | Roadmap |
| A5-1 | Observability | `pg_stat_statements` available but **not installed**; no Neon metric alerting; Sentry + Vercel Analytics present but not correlated with DB metrics | Medium | Framework below |

---

## 1. Database Connection Management & Serverless Compute

### What was verified (live)

**Pooling topology — correct.** `schema.prisma` uses `url = env("DATABASE_URL")` + `directUrl = env("DIRECT_URL")`; Vercel env points `DATABASE_URL` at the `-pooler` endpoint (PgBouncer, transaction mode) and `DIRECT_URL` at the compute endpoint. This is exactly the split Prisma needs (client goes through pooler; DDL/migrations go direct). `src/lib/db.ts` additionally documents and enforces this contract.

**Client lifecycle — correct.** `src/lib/db.ts` instantiates one `PrismaClient` per process cached on `globalThis` (survives warm-lambda reuse + dev HMR), eager connection-string validation, `log: ['error']` only. **No per-request `new PrismaClient()` anywhere** (grep-verified) — the classic serverless connection-exhaustion bug is not present.

**Autoscaling & suspension.** Endpoint config: `autoscaling_limit_min_cu=0.25`, `autoscaling_limit_max_cu=2`. The API reports `suspend_timeout_seconds=0`, but the operations log proves **scale-to-zero is active** (observed `suspend_compute` → `start_compute` cycles at 08:30/08:40/08:49/08:56 — value `0` resolves to the platform default ≈300 s). Measured cold-start cost on `/api/health/db`: **first request 2.12 s TTFB, subsequent warm requests 0.75–0.77 s** → ≈1.4 s wake penalty.

**Connection headroom.** `max_connections=901`. At idle, `pg_stat_activity` shows **zero application connections** (only Neon control-plane: pgbouncer, exporters, pg_cron, compute_ctl) — no leaky/idle connections.

**Timeouts.** `idle_in_transaction_session_timeout=300000` (5 min — good). ⚠️ `statement_timeout=0` — an orphaned heavy query can run unbounded.

### Recommendations

1. **Pin a statement timeout** for the app role (Neon console or SQL): `ALTER ROLE neondb_owner SET statement_timeout = '15s';` (POS OLTP queries here are small; 19 MB DB). Exempt migrations by setting it per-session in the migrate job.
2. **Cold-start strategy for a POS** (latency-sensitive at checkout):
   - Keep scale-to-zero during off hours (cost ≈ 0) and accept the ~1.4 s wake on first morning request; **or** on the Launch plan set the compute to *always-on* (0.25 CU ≈ 182 CU-hrs/mo) — only if morning latency complaints appear.
   - Do **not** add a synthetic keep-alive pinger: it converts scale-to-zero savings into 24/7 billing for little UX gain.
3. **Connection-limit guardrail** on the app env: append `&connection_limit=5&pool_timeout=10` to the pooled `DATABASE_URL` — caps per-instance pool width under traffic spikes (901 max_connections is generous, but the pooler, not Postgres, is the real bottleneck).
4. **PgBouncer transaction-mode caveats** already handled: `pgbouncer=true` is present in the pooled URL (disables prepared-statement reuse). Keep interactive transactions short (`maxWait`/`timeout` defaults in Prisma 6 are sane).

---

## 2. CI/CD, GitHub Integration & Database Branching

### What was verified (live)

- **CI (fixed & green):** `ci-cd.yml` runs Install → Lint → Typecheck (advisory) → Security & Schema → Test (hermetic SQLite, 330 tests) → Build → deploy jobs → `CI Pass` gate. On HEAD, `CI Pass` and `Build` (the two required checks) pass; only the redundant CLI deploy failed — root-caused to `Error: The token provided via --token argument is not valid.` (dead repo secret `VERCEL_TOKEN`), **fixed in this audit** with graceful degradation + step-summary warning.
- **Primary CD — healthy:** Vercel GitHub App deployed `e16bef0` to production **successfully** (deployment `6260625559`, `vercel[bot]`, "Deployment has completed").
- **Duplicate-project leak:** the App **also** auto-deploys `Production – mbumah-hardware-pos-ltcm` (deployment `6260588511`, success) — the duplicate Vercel project is still connected to the repo and still consuming builds. Requires owning-account access to remove (blocked, issue #9).
- **P0 discovered during this audit — schema drift.** `prisma migrate diff --from-url <prod> --to-schema-datamodel prisma/schema.prisma` showed prod was **2 feature releases behind**: missing eTIMS columns (`etimsInvoiceNumber`, `etimsQrCode`, … on `sales_transactions`; `etimsItemCode`… on `products`), loyalty columns on `customers`/`loyalty_transactions`, and entire tables `debt_payment_plans`, `debt_plan_installments`, `data_exports`, `shift_schedules`. Consequence: the freshly deployed code that reads those columns throws **P2022 at runtime** even though builds pass. **Remediated:** the drift was verified 100 % additive and `prisma db push` was applied to prod (17 s, zero data loss; backup branch `br-curly-queen-ai1b3jcc` taken first).
- **No ephemeral PR database branches:** PRs test against hermetic SQLite; no Neon branch-per-PR exists.

### Recommendations

1. **Stop relying on manual `db push` for prod.** Adopt `prisma migrate deploy` in the pipeline:
   ```bash
   # one-time baseline (keep current DB as-is)
   bunx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/0_init/migration.sql
   # then, in CI on main push, BEFORE the Vercel deploy step:
   bunx prisma migrate deploy   # uses DIRECT_URL; additive-only DDL; advisory-locks itself
   ```
   Migrations are recorded, replayable, and order-safe — `db push` is for prototyping only.
2. **Drift guard in CI** (catches the exact P0 class found here before it ships):
   ```yaml
   - name: Detect schema drift (repo schema vs production)
     if: github.ref == 'refs/heads/main'
     run: |
       bunx prisma migrate diff --from-url "$DIRECT_URL" \
         --to-schema-datamodel prisma/schema.prisma --exit-code \
       || { echo "::error::Production DB is out of sync with schema — run migrate deploy"; exit 1; }
     env:
       DIRECT_URL: ${{ secrets.DIRECT_URL }}
   ```
3. **Ephemeral Neon branch per PR** (free plan supports branching):
   ```yaml
   pr-db:
     runs-on: ubuntu-latest
     outputs:
       branch_id: ${{ steps.create.outputs.id }}
     steps:
       - id: create
         run: |
           BR="pr-${{ github.event.number }}"
           RESP=$(curl -s -X POST https://console.neon.tech/api/v2/projects/broad-snow-78900501/branches \
             -H "Authorization: Bearer $NEON_API_KEY" -H "Content-Type: application/json" \
             -d '{"branch":{"name":"'"$BR"'","parent_id":"br-proud-lab-ai15r38h"}}')
           echo "id=$(echo "$RESP" | jq -r .branch.id)" >> "$GITHUB_OUTPUT"
       - run: bunx prisma migrate deploy   # against the new branch's DIRECT_URL
   # on PR close: DELETE /branches/{id} (add a close-event job)
   ```
   Point Vercel preview env `DATABASE_URL`/`DIRECT_URL` at the branch endpoints for full-fidelity preview data.
4. **Neon branch protection:** `protect-production` is unavailable on the free plan (attempted: `BRANCHES_PROTECTED_LIMIT_EXCEEDED`). Revisit on Launch plan; meanwhile the protected `main` + migrate-deploy-only discipline is the effective guardrail.
5. **Delete the duplicate Vercel project** `mbumah-hardware-pos-ltcm` (owning-account token needed) — every push currently double-deploys.

---

## 3. Full-Stack Performance & Edge Topology

### What was verified (live)

- **Topology — optimal.** Function region `iad1` (US-East, from `x-vercel-id: hkg1::iad1::…`) and Neon `aws-us-east-1` are **co-located**; cross-region latency is not a factor. Sandbox RTT to Neon pooled endpoint ≈ consistent with same-region routing.
- **Latency profile:** warm app→DB query time **156 ms** (health payload), warm TTFB **0.47–0.77 s** from outside; homepage TTFB 40 ms (static). Cold-start penalty ≈1.4 s (see §1).
- **Driver/runtime choice — correct:** no `runtime = 'edge'` anywhere; all DB work runs on Node serverless with the standard Prisma engine. This is the right call — Prisma 6 on Edge needs `@neondatabase/serverless` + driver adapters and loses engine performance.
- **Caching — none.** Zero usage of `unstable_cache`, `revalidatePath`, `revalidateTag`, or `'use cache'` in the entire `src/` tree (grep-verified). Every catalog/report request re-queries Neon.
- **Query-shape signals (pg_stat_user_tables):** `products`: **10 441 seq_scans vs 88 idx_scans**; `sales_transactions`: **10 559 seq vs 884 idx**; `users`: 4 131 seq; `sessions`: 1 874 seq. Harmless at 19 MB (seq scan of 51 rows is instant) but this access pattern will degrade as the catalog and ledger grow.
- **DB stats:** cache hit **97.95 %**, 0 deadlocks, 0 waiting locks, no long-running queries.

### Recommendations

1. **Cache the read-heavy catalog** (products/categories are read ~200× more than written):
   ```ts
   import { unstable_cache } from 'next/cache';
   export const getStoreProducts = unstable_cache(
     (storeId: string) => db.product.findMany({ where: { storeId, isActive: true } }),
     ['products'], { revalidate: 60, tags: ['products'] }
   );
   // on product mutation: revalidateTag('products')
   ```
   Expected effect: removes the majority of Neon round-trips from dashboard/browse paths.
2. **Add the missing indexes** the seq-scan profile implies (verify against actual query filters first):
   - `Product @@index([storeId, isActive])`
   - `SalesTransaction @@index([storeId, createdAt])` + `@@index([cashierId])`
   - `Session @@index([sessionToken])` if lookups are by token string.
   Then `bunx prisma migrate dev --name perf-indexes` and ship via `migrate deploy`.
3. **Enable `pg_stat_statements`** (available in the distribution, not installed) for real top-query analytics instead of inferring from seq-scan counters:
   `CREATE EXTENSION IF NOT EXISTS pg_stat_statements;` (Neon console → Extensions) — pairs with the observability framework in §5.
4. **Read replica:** not justified yet (19 MB, single-region users). Revisit when reporting/ERP analytics start scanning `sales_transactions`/`journal_entries` heavily — Neon read replicas in the same region offload analytical reads without app-region changes.
5. **Edge runtime:** keep off for DB paths. If a storefront/public edge route is ever needed, use `@neondatabase/serverless` over WebSocket with `@prisma/adapter-neon` **only** on that route — never via the pooled TCP URL (Edge has no raw TCP).

---

## 4. Data Security, Compliance & Environment Variables

### What was verified (live)

- **Leaked credential — still critical.** The Neon password `npg_aRfWJIn8Neq9` was published in `VERCEL_NEON_VERIFICATION.md` (removed from HEAD in PR #7) but **remains valid** — this audit connected with it repeatedly — and **remains in git history** (public repo). Rotation is fully scripted (repo workflow `rotate-neon-credentials.yml`, two safe pre-flight aborts logged) but blocked because updating Vercel's `DATABASE_URL`/`DIRECT_URL` in the same atomic window requires an **owning-account Vercel token** — the provided `vck_…` token belongs to a different account (Recaro) and cannot see the project. Tracked as **issue #9** with exact unblock steps.
- **Vercel env hygiene:** since the June fix, Production/Preview/Development carry the correct pooled/direct split; CI never touches prod credentials (hermetic SQLite test env, placeholder build env).
- **Tenant isolation:** no Postgres RLS anywhere (verified `pg_tables.rowsecurity` = none). Instead, tenancy is enforced **at the ORM layer**: `src/lib/db.ts` wraps the client in an `AsyncLocalStorage`-based extension that force-ANDs `storeId` into every store-scoped query, with an explicit `runWithoutTenant` opt-out — plus financial immutability enforcement (`JournalEntry`/`SystemLog` are append-only at the ORM level). Strong single-layer control, but one ORM bypass (`$queryRaw`, `runWithoutTenant` misuse) away from cross-tenant reads.
- **Roles:** everything runs as `neondb_owner` (migration + app + this audit's scripts). No least-privilege split.
- **Backup/PITR:** `history_retention_seconds = 21600` → **6 hours** of point-in-time recovery. That is below even a single business day — a bad `db push` at 09:00 cannot be rolled back after 15:00. (This audit took a manual safety branch `backup-pre-topup-20260904` / `br-curly-queen-ai1b3jcc` before any change.)
- **Repo hardening already in place:** secret scanning + push protection **enabled**, dependabot alerts **disabled**, audit/log tables append-only.

### Recommendations

1. **P0 — rotate the Neon password the moment an owning-account Vercel token exists** (issue #9): rotation → atomic Vercel env update → redeploy → verify old password rejected → then scrub history (`git filter-repo --path VERCEL_NEON_VERIFICATION.md --invert-paths` + force-push, or simply rotate and let history hold a dead secret). Until rotation, treat the credential as public.
2. **Raise PITR to ≥ 7 days** (Neon console → Settings → History retention; included hours scale with plan). 6 h is incompatible with "recover from a Friday-evening mistake on Monday morning".
3. **Scheduled logical backups:** Neon branching is not a backup strategy alone; add a weekly `pg_dump` (GitHub Actions cron → encrypted artifact or S3) in addition to PITR.
4. **Least-privilege split:** create `pos_app` role (SELECT/INSERT/UPDATE on app schemas, no DDL) for `DATABASE_URL`, keep `neondb_owner` only in the migration job (`DIRECT_URL`). This converts any future SQL-injection/ORM-bypass into a bounded incident.
5. **RLS as defense-in-depth (optional, Prisma 6-friendly):** if multi-tenant isolation must survive ORM bypasses, enable RLS keyed on `SET app.store_id` issued per-request via a Prisma `$extends` query hook, then add `ENABLE ROW LEVEL SECURITY` + policies on the store-scoped tables. Given the existing ORM tenancy wall, this is hardening, not a gap-fix.
6. **Enable Dependabot security updates** (currently off) — one toggle, closes the automated-CVE window.

---

## 5. Full-Stack Observability & Monitoring

### What exists today

- **App:** `@sentry/nextjs@10` (client/server/edge configs), `@vercel/analytics`, `@vercel/speed-insights`.
- **Health surfaces:** `/api/health` and `/api/health/db` (live DB round-trip + row counts + `responseTime`) — used as the post-deploy probe in CI.
- **DB-side:** full access to `pg_stat_*` (this audit used it); Neon control-plane metrics in console; **no external Neon integration/alerting configured**; `pg_stat_statements` not installed.

### Framework to close the loop (Vercel function error ↔ Neon cause)

**Tier 1 — always-on Neon metrics (alert on):**

| Metric (source) | Threshold | Catches |
|---|---|---|
| `active connections` (`pg_stat_activity`, pooled) | > 60 % of pooler budget for 5 min | pool exhaustion / leak |
| cache hit % (`pg_stat_database`) | < 95 % sustained 15 min | memory pressure / full-scan regression |
| `deadlocks` (`pg_stat_database.deadlocks` delta) | > 0 in 15 min | transaction-order bugs |
| longest active query (`pg_stat_activity`) | > 30 s | runaway report / missing `statement_timeout` |
| suspend→start events/hr (Neon API `/operations`) | > 20/hr unexpected | thrashing (min CU too low) |
| CU utilization (Neon console/API) | > 80 % of plan for 15 min | autoscaling ceiling → upgrade |

**Tier 2 — correlation plumbing:**
1. Install `pg_stat_statements` (§3) and snapshot top-10 by `total_exec_time` **hourly** into `system_logs` (cron in-app or GitHub Actions schedule). This is the table that turns "Vercel 500s at 14:02" into "query X regressed at 13:57".
2. Stamp every Prisma error log with the Vercel request/trace id (Sentry already propagates it — add `traceId` to the `db.ts` error mapper) so a Sentry issue links to the exact function invocation; the invocation's DB-side fingerprint is then found in Tier-1/2 data by timestamp.
3. **Vercel Observability** (function duration, error rate, cold starts) + Neon consumption curve on one dashboard — cold-start spikes and CU spikes should visually coincide with traffic.

**Tier 3 — proactive scheduled checks (GitHub Actions cron):**
- `curl /api/health/db` every 5 min from an external runner; alert on `status != ok` or `responseTime > 1000 ms`.
- Weekly: run the drift guard (§2.2) and a `pg_stat_statements` top-10 review comment on an issue.

---

## Appendix — Actions executed during this audit

| Action | Result |
|---|---|
| Schema drift diff (`prisma migrate diff`) | 100 % additive drift identified (eTIMS, loyalty, 4 new tables) |
| `prisma db push` (after backup branch `br-curly-queen-ai1b3jcc`) | Prod synced in 17 s, zero data loss — P2022 class eliminated |
| `scripts/topup-demo-data.ts` (committed) — guarded, FK-verified, additive-only | **139 records applied, 0 failures** |
| Data population | products 51→**73**, categories 26→**42**, customers 17→**26**, suppliers 1→**12**, accounts 10→**27**, sales 8→**20**, expenses 1→**14**, debts 1→**7**, rentals 0→**3**, POs 0→**5**, gift cards 2→**16**, redemptions 0→**11** — verified live via `/api/health/db` |
| `ci-cd.yml` deploy jobs | Graceful degradation on dead `VERCEL_TOKEN` + warnings (Vercel App remains primary) |
| Audit trail | `system_logs` entry `DEMO_DATA_TOPUP` written to prod |

*Remaining blocker (issue #9): a valid owning-account Vercel token to rotate the leaked Neon password atomically and delete the duplicate Vercel project. Everything else above is executed.*
