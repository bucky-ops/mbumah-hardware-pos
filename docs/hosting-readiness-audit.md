# Hosting Readiness Audit

Review of two external planning documents against the repository as of v2.16.0
(main 6a22472). The documents were:

1. "Hosting and subdomain phases" mission specification: a seven phase plan
   (v2.15.0-alpha.1 through v2.15.0) covering repository hygiene, schema
   safety tooling, offline subdomain workspaces, LAN hosting, tunnel hosting,
   security hardening, M-Pesa callback safety, and release discipline.
2. "Local and online hosting guide for Mbumah Hardware POS": an audit and
   how-to guide covering the same architecture (one shared database, branch
   subdomains, LAN access, Cloudflare Tunnel).

Verdict: the architecture both documents describe is correct and is already
implemented to a large extent. The repository shipped subdomain workspaces in
v2.16.0 before this review. The remaining value in the specification is a set
of small, concrete gaps, which are dispositioned in section 6. Section 3 lists
where the documents' assumptions no longer match the codebase.

## 1. Specification corrections

These are points where the external documents are outdated or wrong about
this repository. No code change is needed; they are recorded so future
planning starts from reality.

| # | Document assumption | Repository reality |
|---|---|---|
| 1 | NextAuth.js drives auth; NEXTAUTH_URL and cookie config are central | Auth is a custom Bearer token backed by the Prisma Session table with an `mbt_token` cookie fallback (src/lib/auth.ts, src/lib/workspace/session-cookie.ts). `next-auth` remains an unused dependency and `NEXTAUTH_*` names are legacy env names only. Cookie domain/secure/sameSite handling already exists. |
| 2 | No subdomain routing exists yet | Shipped in v2.16.0: Store slug/subdomain/brandingColor, host allowlist, reserved word rejection, subdomain rewrite to /stores/{sub}/..., org console, branch selector, role based post-login redirect, hosts printer, verifier. |
| 3 | Cart and form state live in localStorage | The offline engine is IndexedDB (idb, database `mbumah-offline-pos`) with a durable sales queue, replay, backoff, DLQ, PWA shell (sw.js, offline.html), and per-store carts. v2.15.1 fixed the TanStack mutation networkMode gate so offline checkout actually reaches the queue. |
| 4 | users.isEngraved is possibly an AI artifact | It is a deliberate feature (engraved administrator identity) used by src/lib/engraved-admin.ts, the admin tab, and the users API. Decision: KEEP. |
| 5 | Release series v2.15.0 | v2.15.0, v2.15.1, v2.15.2 and v2.16.0 are already released. Applying the specification's own rule (detect the current version and use the next minor), remaining work ships as v2.17.0 and later. |
| 6 | Repair P2022 drift with a bare `prisma db push` | A bare push REFUSES non-interactively on existing databases when unique constraints are involved (the exact laptop incident). v2.15.2 replaced it with scripts/ensure-schema.mjs: push, then on refusal back up the SQLite file and converge with --accept-data-loss. The hosting guide's section 10.11 remedy should be read through that lens. |
| 7 | The app runs on the owner's PC and goes online via tunnel | That is one of two supported topologies. The primary production path is Vercel plus Neon PostgreSQL; the self-hosting path (nodocker/laptop, SQLite, optional tunnel) is fully supported and documented. Both share one database and the same workspace routing. |
| 8 | Create roughly 29 separate documentation files | The repository completed a documentation consolidation (docs/ topic files, runbooks/, archive/). Recreating 24 near-duplicate files would reintroduce sprawl. Section 5 maps each requested topic to its existing home; only genuinely missing topics get new files. |
| 9 | Store needs isActive and logoUrl columns | Equivalents exist: Store.status (ACTIVE default, UI derives active state) and Organization.logoUrl. No schema change required. |
| 10 | RBAC matrix should be adjusted where weaker | The repository PERMISSION_MATRIX (src/lib/types.ts) is the source of truth and already includes WAREHOUSE_MANAGER with assigned-store scoping. It is at least as strict as the specification matrix; nothing was weakened. |

## 2. Phase by phase status

| Spec phase | Status | Evidence and notes |
|---|---|---|
| 1: audit, hygiene, schema safety | SATISFIED (different mechanism) | Docs hygiene, README split, markdown/gitignore cleanup shipped across the 14 phase organization (PR #101, #103). Schema safety is scripts/ensure-schema.mjs (v2.15.2) plus the P2022 sentinel inside /api/health and boot convergence in start-server.mjs. Backup tooling added in v2.17.0 (db:backup, db:verify). app_schema_meta table: backlog. |
| 2: offline subdomain foundation | SHIPPED (v2.16.0) | Schema fields, seed slugs/subdomains/branding, reserved words (exact 19 word match), proxy rewrite + x-store headers, /stores/[slug] gateway, /org/dashboard, /branches/select, role based redirects, scripts/domains/print-hosts.mjs, verify-subdomains.mjs, backfill-store-slugs.mjs. Deltas: /org/stores and /org/reports live inside the org console rather than separate routes (acceptable); CASHIER/BRANCH_MANAGER stay in the root SPA with a pinned store instead of redirecting to a branch URL (equivalent isolation, enforced server side). |
| 3: LAN hosting and fallback | MOSTLY SHIPPED | docs/lan-deployment.md, docs/local-offline-setup.md, root Caddyfile for the LAN gateway, path mode fallback on localhost and raw IPs, ALLOWED_HOSTS. Health endpoint additions (appMode, workspaceMode, databaseProvider) shipped in v2.17.0. Optional dedicated /api/health/db-schema route: backlog (the sentinel already degrades /api/health). dnsmasq documented inline; a shipped example conf is backlog trivia. |
| 4: online tunnel hosting | PARTIAL | docs/tunnel-development.md, docs/subdomain-workspaces.md, docs/self-hosting.md cover the tunnel flow and DNS routing. Missing conveniences: a committed cloudflared config example, explicit x-forwarded-host awareness in the proxy (tunnel hardening), ngrok deep-dive. All backlog. |
| 5: security hardening | LARGELY SHIPPED | Host allowlist with 403 for pages, CSRF origin checks for API, credentialed CORS restricted to trusted origins, SecurityEvent audit for workspace denials, AuditLog for LOGIN_SUCCESS/LOGIN_FAILED/LOGOUT/ROLE_CHANGE, session cookie with configurable domain/secure/sameSite, security headers in next.config.ts and nginx, rate tiers AUTH, PASSWORD_RESET, PAYMENT, READ, WRITE, SEARCH, MESSAGING, CLIENT_ERROR, WEBHOOK. v2.17.0 adds the missing STK Push PAYMENT tier. Export specific tier: backlog. |
| 6: M-Pesa callback and operations | MOSTLY SHIPPED | Callback implementation exceeds the spec: CheckoutRequestID lookup, atomic claim (updateMany on PENDING and not-yet-received), duplicate acknowledgement, amount mismatch routed to reconciliation instead of settling, symmetric compensation on failure, receipt uniqueness. Mock server exists (docker/mpesa-mock). Updater runs ensure-schema before start. Deltas: maintenance mode page (backlog), app_schema_meta (backlog), MPESA_ENVIRONMENT is validated but code branches on credential presence instead (backlog small fix). |
| 7: stable release and docs | RESOLVED | Version series corrected to 2.17.0+ (section 1 item 5). Verification baselines recorded in section 7. Documentation mapping in section 5. |

## 3. Requested documentation topics: mapping

| Spec asked for | Lives in |
|---|---|
| hosting-readiness-audit.md | This file |
| offline-schema-repair.md, database-backup.md, backup-and-restore.md | deploy/nodocker README troubleshooting rows, scripts/ensure-schema.mjs header, db:backup script help; consolidation candidate for a future docs/database-operations.md |
| local-offline-subdomains.md | docs/local-offline-setup.md |
| branch-workspaces.md, store-context-resolution.md | docs/subdomain-workspaces.md, docs/multi-store-workspaces.md, docs/multi-tenant-architecture.md |
| lan-deployment.md | docs/lan-deployment.md (exists) |
| localhost-fallback.md | docs/lan-deployment.md and docs/subdomain-workspaces.md (path mode sections) |
| health-checks.md | docs/deployment.md health endpoints section |
| online-cloudflare-tunnel.md, tunnel-troubleshooting.md | docs/tunnel-development.md |
| online-hosting-overview.md, domain-setup.md, subdomain-dns.md | docs/subdomain-workspaces.md and docs/self-hosting.md |
| online-ngrok-dev.md | docs/tunnel-development.md (ngrok noted as temporary) |
| security-hardening.md, tenant-isolation.md | docs/multi-tenant-architecture.md, docs/authentication-and-rbac.md, SECURITY.md |
| rbac.md | docs/rbac.md (exists) |
| multi-tenancy.md | docs/multi-tenant-architecture.md |
| mpesa-setup.md, mpesa-callbacks.md | docs/deployment.md and docs/configuration.md M-Pesa sections |
| updater-flow.md | deploy/nodocker updater scripts and README |
| production-operations.md | docs/deployment.md, docs/self-hosting.md, docs/runbooks/ |
| maintenance-mode.md | Does not exist; blocked on the maintenance mode feature (backlog) |
| vercel-deployment.md | docs/vercel-deployment.md (exists) |
| etims-readiness.md | Mentioned in product docs; a dedicated page remains optional backlog |

## 4. Hosting guide assessment

The guide's architecture recommendation (one shared database, subdomains as
routing and authorization boundaries, local DNS or hosts entries offline,
Cloudflare Tunnel online, server-side isolation) is sound and matches what is
implemented. Items worth adopting from it:

1. The env profiles in its section 13 match .env.example and the deploy
   profiles; no action needed.
2. Its troubleshooting matrix (sections 10.1 to 10.14) is a good source for
   extending docs/troubleshooting-and-faq.md; several entries (tunnel 502,
   cookie not shared, CGNAT detection) are not yet covered there.
3. Its reminder that SQLite must not sit on a network share and that backups
   should precede updates is already encoded in the tooling and deploy docs.

Items to ignore from the guide: the bare `db push` P2022 remedy (superseded
by ensure-schema.mjs), the NextAuth specific cookie instructions (custom auth
already handles this), and its claim that subdomain support is absent.

## 5. Gap register

Disposition key: SHIPPED = included in v2.17.0. BACKLOG = recommended next
increments. OWNER = requires repository owner action.

| Priority | Item | Disposition |
|---|---|---|
| P1 | /api/health fields appMode, workspaceMode, databaseProvider | SHIPPED |
| P1 | Database backup tooling (db:backup, db:verify) | SHIPPED |
| P1 | STK Push rate limit tier (was generic WRITE) | SHIPPED |
| P1 | /api/healthy doc references pointed at the real /api/health/system-status | SHIPPED |
| P1 | This audit document | SHIPPED |
| P1 | Maintenance mode (MAINTENANCE_MODE env, calm service page, admin detail) | BACKLOG |
| P1 | app_schema_meta metadata table (appVersion, schemaHash, lastRepairAt) | BACKLOG |
| P2 | x-forwarded-host awareness in proxy for strict tunnel setups | BACKLOG |
| P2 | MPESA_ENVIRONMENT=mock behavioral wiring (branch on env, not only credentials) | BACKLOG |
| P2 | Export/report rate limit tier | BACKLOG |
| P2 | Committed dnsmasq example conf and cloudflared example config | BACKLOG |
| P2 | Optional dedicated /api/health/db-schema endpoint | BACKLOG |
| P3 | /org/stores and /org/reports as standalone routes | BACKLOG |
| P3 | Extend troubleshooting-and-faq.md from the guide's matrix | BACKLOG |
| OWNER | Neon credential rotation | OWNER |
| OWNER | Sentry configuration decision | OWNER |
| OWNER | Remove delete-duplicate-vercel-project.yml once the duplicate project is confirmed gone | OWNER |
| OWNER | Vercel wildcard domain, DNS, and workspace env vars to activate subdomain mode in production | OWNER |

## 6. Verification baseline

Current gates at the time of this audit (main 6a22472 plus this release):

- lint: 0 errors, 393 warnings (advisory baseline)
- typecheck: 470 errors with the committed postgres client (advisory
  baseline; the sqlite flavored client reads about 482, so compare only
  against the same client flavor)
- tests: 475 passed, 0 failed, 20 skipped (test database prepared by the
  pretest hook)
- prisma validate: valid
- production /api/health: healthy, version matches the release, database ok

Commands used during review: the specification's own rg set (subdomain,
idempotencyKey, isEngraved, secret scans), scripts/domains/verify-subdomains.mjs
against a local dev server, and the release gates above.
