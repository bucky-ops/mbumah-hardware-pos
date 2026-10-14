# Changelog

All notable changes to Mbumah Hardware POS are documented in this file (Keep a Changelog format; versions follow package.json).

## [2.18.0.2] Updater release selection, Windows build mode and Prisma config correction

Correction release covering the defects visible in the field report of a Windows laptop updating from 2.17.7 straight to v2.18.0.0: the updater treated a four-part correction tag as the next normal release, the build ran with standalone output it did not need on Windows, and the Prisma CLI warned about the deprecated package.json configuration block. package.json keeps the valid semver `2.18.0`; the full correction version `2.18.0.2` lives in the `mbumah.releaseVersion` metadata block, the root `VERSION` file and every app-reported version surface.

### Added
- **Validated release selection (`scripts/release/parse-version.mjs`, `validate-tag.mjs`, `select-release.mjs`)**: the updaters no longer take GitHub's `releases/latest` verbatim. Every release tag is parsed and validated against the release rules: three-part tags are normal releases, four-part tags are correction hotfixes that are only valid while their three-part base release exists, hotfix numbers stop at .5, prerelease suffixes are rejected. Invalid tags are ignored and reported (`Ignored invalid release tag: ...` with the reason) instead of being installed. The selector never downgrades and never jumps a 2.17.7 machine to a four-part tag.
- **Update channels (`UPDATE_CHANNEL`)**: stable (default, three-part releases only), hotfix (three-part releases plus valid hotfixes for the installed base), manual (explicit `-ToVersion`, still validated). `UPDATE_DRY_RUN=1` prints the current version, the latest valid stable release, the latest valid hotfix for the installed base, the selected release with its reason, and what would happen, then changes nothing.
- **Update state file**: the script updaters publish their progress to `%USERPROFILE%\mbumah-pos-data\update-state.json` (same schema as the staged updater's `updater/update-state.json`): current/pending version, state (idle through activated, rolled-back, failed), progress, backup path, build log path, channel, rollback availability.
- **Pre-build checks**: free disk space (fail under 2 GB, warn under 5 GB), database file writability, dependency manifest presence, and an install-location advisory when the app lives under Downloads, Compressed or OneDrive folders (recommendation: `C:\MbumahPOS`).
- **Build log capture and scanning**: updaters write every build to `mbumah-pos-data/logs/build-{version}-{timestamp}.log`; `scripts/verify-build-output.mjs` scans that log and fails the update on real build errors in every mode, and on the standalone trace-copy failure class (`EINVAL`, `Failed to copy traced files`) whenever a standalone build was expected.
- **Release safety gates in CI**: `verify:prisma-config`, `verify:release-selection` and `verify:windows-build` run in the Security & Schema job so the release rules and the build-mode wiring cannot regress silently.
- **Documentation**: docs/windows-local-builds.md, docs/standalone-output.md, docs/prisma-config.md, docs/updater-release-channels.md, docs/release-versioning.md, plus a troubleshooting entry.

### Fixed
- **Updater release selection (field report: 2.17.7 updated to v2.18.0.0)**: four-part correction tags are no longer treated as the next feature release. On the stable channel a 2.17.7 machine now moves to the latest valid three-part release (for example v2.18.0), and a machine already on the hotfix's base picks the hotfix. The selector is unit tested end to end (vitest plus `scripts/verify-release-selection.mjs` in CI).
- **Windows laptops build normal output (v2.18.0.2 policy)**: standalone output is now Docker/Linux only (`resolveStandaloneOutput` in `src/lib/build-mode.ts`). Windows never builds standalone even if BUILD_STANDALONE=1 is set (it warns instead), the Windows installer/updater dropped the standalone assembly step, and the launcher (`start-server.mjs`) starts the plain build with `next start` when no standalone output exists. This removes the entire Windows trace-copy/EINVAL failure class and the "Build output missing (.next/standalone/server.js)" failure mode. A stale standalone output from an older release is deleted during the rebuild and its presence after a normal build is a hard verification failure.
- **Process-tree stop on Windows**: the updater stops the POS with `taskkill /T /F` so the `next start` child process cannot survive as an orphan holding port 3000, and already-exited processes no longer produce errors.
- **Prisma configuration warning removed**: the deprecated `package.json#prisma` block (removal planned in Prisma 7) is gone; the seed command lives in `prisma.config.ts` (Prisma 6.16+), which loads the repo `.env` with the same ".env wins" precedence as the runtime launchers and defaults DIRECT_URL to DATABASE_URL. `prisma validate`, `prisma generate`, `prisma db push` and `prisma db seed` all verified; the Docker runner image copies `prisma.config.ts` so container seeding keeps working.
- **Prisma version drift guard**: `prisma` and `@prisma/client` are pinned to the current stable line (^6.19.2); the new `verify:prisma-config` check fails CI on any prerelease tag (such as 8.0.0-rc.22) or major drift. Update notices like "Update available 6.19.2 -> 8.0.0-rc.22" are informational only and never trigger upgrades.

### Security
- The updater now fails safe: it verifies the build output (build log scan plus output shape, including the stale-standalone check) BEFORE declaring success, publishes its state, and rolls the code back to the previous version automatically with the calm message "Update could not be completed. The previous version is still available."
- Invalid release tags can no longer be activated through the updater; the manual channel still validates tag format and base existence.
- No authorization, tenancy or data-handling changes; the database is only touched by the existing guarded schema converge, and the field log's in-sync database needed no repair.

## [2.18.0.1] Windows standalone build correction (EINVAL chunks, sharp, updater)

Field-report correction release for Windows laptop installs (ZIP, no git), covering the three defects visible in the v2.17.6/v2.17.7 update logs: "Failed to copy traced files ... EINVAL" build warnings, "Could not load the sharp module using the win32-x64 runtime" image errors, and an "UPDATE COMPLETE" banner followed by a start failure ("Build output missing (.next/standalone/server.js)").

### Added
- **Standalone build verifier (`scripts/verify-standalone.mjs`)**: after every installer/updater build, proves that `.next/standalone/server.js` exists, the client static assets were assembled, and EVERY server chunk referenced by any route or runtime file is actually present in the standalone output. An incomplete build is now a hard failure that triggers the updater's automatic rollback (and stops the installer with a clear message) instead of a restart into a broken server.

### Fixed
- **Windows EINVAL chunk loss (field log: `/api/batch`, `/api/cron/nightly`)**: Turbopack emits asynchronously imported node builtins as chunk files named after the specifier, e.g. `[externals]_node:inspector_7a4283c6._.js`. NTFS forbids colons in file names, so Windows standalone builds dropped those chunks with EINVAL copyfile warnings and the affected routes (batch operations, the nightly maintenance cron and everything sharing their chunks) broke at runtime while Linux and Vercel builds worked. Every `node:*` builtin is now aliased to its identical bare specifier (`turbopack.resolveAlias` in `next.config.ts`), so Turbopack's chunk file names never contain a colon on any platform - the runtime modules are byte-for-byte the same Node builtins.
- **`node:fs/promises` dynamic import in `src/lib/data-retention.ts`** converted to a static import: static built-in imports are inlined by the bundler and produce no chunk file at all (this was the nightly-cron half of the EINVAL pair).
- **sharp win32-x64 missing** (the "Could not load the sharp module" 500s on every optimized image): installers and updaters now install with `npm install --include=optional` so a machine-level npm config can never skip sharp's platform binary, repair a missing win32-x64 binary automatically (`npm install --no-save --os=win32 --cpu=x64 sharp`), and - as the final safety net - `next.config.ts` probes sharp at BUILD time and bakes `images.unoptimized` into standalone laptop builds whose machine has no usable binary, so product photos always serve (without resizing) instead of erroring.
- **Update loop on correction releases**: the updater compared `package.json` "version" (three-part, "2.18.0") against the release tag (four-part, "v2.18.0.0"), which can never match - a machine that installed v2.18.0.0 would download and rebuild it again on EVERY start. The Windows and macOS/Linux updaters now prefer the `mbumah.releaseVersion` metadata when comparing, so correction releases settle to "Already up to date" like every other release; the Start POS "was updated to" message reads the same field.
- **Scary-but-harmless stop error**: `Start POS` no longer prints the red "[ERROR] Cannot find a process with the process identifier ..." line when the server process exited early; it points at the reason printed above it and the two most common fixes instead.

### Security
- No authorization, tenancy or data-handling changes; the verifier only reads build output and the sharp repair only runs npm install scoped to the sharp package.

## [2.18.0.0] Branch workspace path fallback correction

Correction release for the "This branch workspace does not exist or is no longer available" error when opening a branch workspace from the organization console. package.json keeps the valid semver `2.18.0`; the full correction version `2.18.0.0` lives in the `mbumah.releaseVersion` metadata block, a new root `VERSION` file, and every app-reported version surface (footer, login screen, `/api/health`, openapi.json).

### Added
- **Safe branch workspace link builder (`src/lib/branch-workspace.ts`)**: one pure, client-safe and server-safe `getBranchWorkspaceHref` function that turns a store record plus the current origin into the correct new-tab URL: an absolute subdomain URL only when every safety check passes, otherwise `/stores/{slug}/dashboard`; `null` when no safe URL exists (missing slug, inactive store, mode off). It never produces `/stores/undefined`, `/stores/null` or unresolvable `//undefined..` URLs, and it re-uses the reserved-subdomain rules from `src/lib/workspace/config.ts`.
- **Server-side store context resolver reason codes**: `resolveStoreContext` and the `/api/me/store-context` payload now carry a stable, client-safe `reasonCode` alongside the unchanged internal `reason` (store-not-found, store-inactive, user-not-allowed, unauthenticated, missing-slug, schema-drift). The workspace gateway renders one calm message per cause, replacing the single generic "does not exist or is no longer available" copy.
- **New resolver detections**: a present-but-empty slug short-circuits to `missing-slug` without a database call, and a Prisma known request error during the store lookup (for example P2022, a missing column) is answered as `schema-drift` without leaking any error text. Denial audit rows now also carry the request host, pathname and request id for correlation.
- **Workspace environment safe defaults (`.env.example`)**: the branch workspace keys ship with safe local defaults (path mode, no shared cookie domain, minimal host allowlist, forwarded-host trust off) plus a comment block pointing at `.env.local-offline.example`, `.env.lan.example` and `.env.online.example` and the automatic path-fallback rule for localhost, 127.0.0.1 and raw IPs.
- **Hosts helper extension (`scripts/domains/print-hosts.mjs`)**: an optional second block from the `LOCAL_LAN_IP` environment variable and an explicit note that raw localhost needs no hosts entries in path mode; the script still only prints entries and never touches the hosts file.
- **Verification script and tests (`scripts/verify-branch-workspace.mjs`, `bun run verify:branch-workspace`; `src/tests/lib/branch-workspace.test.ts`)**: a read-only environment and hygiene check for branch workspace configuration, and 27 new vitest cases covering the link builder safety matrix (localhost, 127.0.0.1, raw IPv4/IPv6, path mode, reserved subdomains, missing slug, inactive stores, broken slug data) and the resolver reasonCode matrix (path/subdomain resolution, slug fallback, inactive denial, cross-store denial, SUPER_ADMIN/STORE_OWNER/warehouse-manager rules, schema drift, non-Prisma error re-throw).
- **Documentation**: `docs/branch-workspaces.md` (modes, fallback rules, button behavior, local/online setup), `docs/store-context-resolution.md` (resolver modes, reasonCode vocabulary, security properties), a "This branch workspace does not exist" entry in the troubleshooting guide with all six messages and their fixes, and cross-links from the README and the workspace docs.

### Fixed
- No broken `/stores/undefined` or `/stores/null` links: the organization console's "Open branch workspace" button now uses the safe builder and shows a calm inline message ("Branch workspace unavailable. Store slug is not configured.") instead of opening a dead tab when the store slug is missing.
- Localhost, 127.0.0.1, `*.localhost`, ::1 and raw LAN IPs no longer attempt invalid subdomain workspaces: branch links always fall back to `/stores/{slug}/dashboard` on those hosts, even when the environment asks for subdomains.
- A missing or whitespace store slug is handled safely end to end (calm console message, `missing-slug` gateway state, no database call).
- Inactive store access is blocked with a clear message ("This branch is currently inactive. Contact the store owner or system administrator.") at the button and in the gateway.
- Cross-store branch access stays denied server-side; the gateway wording and the audit trail make the cause explicit instead of a generic not-found.
- Schema drift on local databases now shows a calm, actionable "schema update needed" message instead of a misleading branch-not-found error.

### Security
- **Branch workspace resolution is validated on the server**: the store is re-derived from the request host or path slug for every call, never from client input, and authorization (role rules plus ACTIVE memberships) is enforced inside the resolver before any workspace payload is returned.
- **Denied access attempts are logged safely**: `UNAUTHORIZED_ACCESS` SecurityEvent rows for workspace denials now include the request host, pathname and request id, while never exposing error text, stack traces or secrets; audit failures still never change the access decision.

## [2.18.0] Full QA verification release

### Added
- **Full QA report (`docs/v2.18.0-qa-report.md`)**: the complete audit of the v2.17.x feature line - quality gates, hygiene sweeps, security and tenant isolation, workspace resolution, the staged updater contract, hosting modes, data integrity and observability - with per-area pass/fail/blocked results, evidence references, known gaps and the release verdict.
- **QA evidence for the v2.17.x feature line**: static gates re-measured at the 2.17.9 baseline (lint 0 errors and 396 warnings, typecheck 472 advisory, vitest 507/507, prisma validate valid), a 21-check runtime matrix on the seeded SQLite development server (auth, RBAC, cross-store 404-indistinguishable probing, store-context allow/deny, updater 401/400/202/409, subdomain and forwarded-host behavior, gateway page, chat) and a browser pass verifying the organization console login and the five branch workspace links.

### Fixed
- Nothing. This is a verification release: no runtime behavior changes are intended; the changes are the QA report, the version bump and release notes.

## [2.17.9] Staged updates and login progress UI

### Added
- **Staged update orchestrator (`scripts/staged-update.mjs`)**: the self-hosted staged update pipeline as one detached run - download, schema preflight on a throwaway copy of the database, verified database backup, install (install-directory swap when `MBUMAH_INSTALL_DIR` is set), activation and a bounded health smoke test - with automatic rollback of the previous release and database once the backup step has completed. Refuses to run on Vercel serverless (exit code 2); never runs destructive SQL; writes no secrets to the state file.
- **Updater state store (`src/lib/updater/state.ts`)**: the shared server-side state file (`updater/update-state.json`) with phase/percent/message progression, atomic tmp+rename writes, path-sanitized error text, and idle defaults (never a 500) on missing or corrupt files.
- **Update endpoints**: `GET /api/update/status` (public minimal progress; SUPER_ADMIN and STORE_OWNER additionally receive startedAt, sanitized error and pid) and `POST /api/update/prepare` (admin-only; 409 while an update is active, 501 on Vercel).
- **Login page update progress bar (`src/components/updater/update-progress-bar.tsx`)**: an iPhone-style amber progress banner that polls the public status endpoint every 2.5 s during maintenance windows and renders nothing at any other time, so the login form is untouched.
- **Documentation (`docs/staged-updates.md`)**: the phase table, the endpoint contract, orchestrator CLI usage, `UPDATE_ON_START` semantics and rollback behavior.

### Fixed
- `UPDATE_ON_START=0` now disables only the remote version check at startup; the local schema preflight (the start-time schema self-heal) always runs.

### Security
- **Update preparation is restricted to SUPER_ADMIN and STORE_OWNER**: `POST /api/update/prepare` validates the DB-backed session in-file (401 unauthenticated, 403 otherwise) before accepting a run and refuses serverless environments outright.
- **Public status exposes progress only**: `GET /api/update/status` answers phase, percent, message, target version and timestamp to everyone; error detail, process id and start time require an owner/administrator session, and even the stored error text is stripped of filesystem paths before it is written to disk.

## [2.17.8] Security, RBAC and tenant isolation hardening

### Fixed
- **`requireAuth` now enforces store-scope validation**: the wrapper skipped `assertStoreScope`, so (a) a non-admin session WITHOUT a store assignment ran handlers in `runWithoutTenant` (no ORM tenant filtering at all) and (b) cross-store `?storeId=` probes were silently answered instead of rejected. Both paths now return 403 and file the same SecurityEvent as `withSessionAuth` / `requireStoreAccess`. SUPER_ADMIN and validated multi-store members are unaffected.
- **Unauthenticated data routes closed**: `GET /api/suppliers/[id]/performance` (order trends, payment history, balances) and `GET /api/etims/dashboard` were exported with no session validation at all (the edge proxy checks Bearer PRESENCE, never validity); they now run behind `requireStoreAccess`. `POST /api/etims/test-connection` and `POST /api/etims/register-product` (an outbound KRA eTIMS action) require a manager-or-above session.
- **`X-Powered-By` removed from page responses**: the API headers block blanked it on `/api/*` only; `poweredByHeader: false` (next.config.ts) stops advertising the framework on every response.

### Security
- **Body storeId validation (`assertBodyStoreScope`)**: several mutating routes accepted `storeId` in the JSON body, and Prisma `create` is deliberately NOT tenant-intercepted (injectTenant only narrows read/update/delete), so a cross-store body value was a REAL cross-tenant write. The new shared guard applies the query-param policy (SUPER_ADMIN/STORE_OWNER pass, active StoreMembership passes, same store passes; otherwise 403 + SecurityEvent) and is wired into stock-movements POST, M-Pesa STK push, KRA submit, eTIMS invoice cancel, debt reminder process/schedule, and gift-card redemption. `reports/export` and receipt distribution already resolve the store server-side (the session wins) and are covered by the requireAuth fix.
- **[id] 404 policy + denied-attempt audit (`auditRecordMiss`)**: store-scoped `[id]` routes answer 404 for a missing record AND for another store's record (ORM tenancy narrows the unique lookup) - the caller cannot distinguish the two (no enumeration oracle), but a foreign-store id now writes a SecurityEvent (UNAUTHORIZED_ACCESS, blocked) plus a `CROSS_TENANT_RESOURCE_DENIED` ops log so IDOR probing is visible. Wired into `/api/products/[id]` (GET/PUT/DELETE), `/api/customers/[id]` (GET/PUT), `/api/transactions/[id]` (GET) and `/api/suppliers/[id]/performance`. Truly-missing ids stay silent.

### Added
- 12 new security regression tests (src/tests/lib/store-guard.test.ts) covering the body storeId policy matrix (SUPER_ADMIN / STORE_OWNER / active membership / no store assignment / cross-store deny with SecurityEvent) and the 404 classifier (silent for missing and own-store records, SecurityEvent for foreign-store records, probe failures swallowed so auditing never changes the response).

## [2.17.7] Online hosting and public subdomains

### Added
- **Trusted forwarded host support (`TRUST_X_FORWARDED_HOST`)**: the new `resolveRequestHost` helper (src/lib/workspace/config.ts, Edge-safe, no Prisma) resolves the client-visible request host from the first `x-forwarded-host` value when the flag is truthy ('1', 'true', 'yes', 'on', case-insensitive), falling back to the plain `Host` header. Wired into the proxy workspace pipeline (page routing, host allowlist, CORS preflight) and the workspace host readers (`/api/me/store-context`, `/api/stores/[storeSlug]`). Off by default everywhere: with the flag absent, request handling is byte-for-byte the pre-2.17.7 behavior.
- **Online tunnel env template (`.env.online.example`)**: copy to `.env` for a self-hosted public deployment on your own domain (`app.mbumah.co.ke` console plus the branch wildcard) behind Cloudflare Tunnel or Caddy, with secure shared cookies, the host allowlist, the forwarded-host trust flag, and commented production PostgreSQL and M-Pesa callback placeholders. Raw localhost and LAN IPs always fall back to path mode automatically.
- **Online hosting guide (`docs/online-hosting.md`)**: the production counterpart to the dev-focused tunnel guide. Covers the environment, the `x-forwarded-host` trust contract, a named Cloudflare Tunnel setup (ingress rules for the console host and the `*.mbumah.co.ke` wildcard, `cloudflared tunnel route dns`, Host header preservation notes) and a Caddy reverse proxy option (site blocks for the app host and the wildcard, automatic HTTPS via the DNS-01 challenge, admin endpoint off, no debug).

### Fixed
- The ngrok recipe in `docs/tunnel-development.md` is now explicitly marked DEV/TESTING ONLY (free tunnels rotate URLs and cannot serve branch wildcards) and points production readers at the online hosting guide; cross-links to the new guide were added from the self-hosting, subdomain-workspaces, LAN deployment, local offline setup and documentation index pages.

### Security
- `x-forwarded-host` is honored only when `TRUST_X_FORWARDED_HOST` is enabled, and the security contract is documented at the helper and in both hosting guides: enable it only behind a proxy or tunnel that overwrites the header (Cloudflare Tunnel, Caddy), never on a directly exposed server. The resolved host still passes the `ALLOWED_HOSTS` validation, so spoofed or unknown hosts are rejected with 403 regardless.

## [2.17.6] LAN hosting and localhost fallback completion

### Added
- **Protected db-schema health endpoint (`/api/health/schema`)**: an authenticated operator view of the full drift picture that the public `/api/health` only hints at. Probes every known drift-sensitive column (the five nullable `idempotencyKey` columns and `users.isEngraved`), reports per-probe results, the resolved provider, and row counts for the operational tables, and returns the matching remediation ("run the updater" or `npm run db:repair`). The endpoint never throws on a drifted database - reporting is its job.
- **LAN env template (`.env.lan.example`)**: copy to `.env` on the shop server for `mbumah.lan` (or the static LAN IP variant, documented inline) with the one shared SQLite database, plain-HTTP shared cookies and mock M-Pesa. Referenced from the LAN deployment guide.
- **Windows Firewall guidance** in `docs/lan-deployment.md`: the exact `New-NetFirewallRule` invocation for the POS port (private/domain profiles), a cross-device `Test-NetConnection` verification, and the Docker Desktop note.

### Verified (already shipped, unchanged)
- The no-Docker launcher binds `0.0.0.0` (`HOSTNAME` is forced in `deploy/nodocker/start-server.mjs`) and localhost plus raw LAN IPs fall back to path mode automatically (`resolveWorkspaceHostMode` returns `organization` for them); dnsmasq, Pi-hole and router DNS wildcard options are documented in the LAN guide.

## [2.17.5] Branch workspaces and organization console: verification release

### Verified
- The full branch workspaces and organization console matrix shipped in v2.16.0 was re-verified end to end against the current build (browser E2E on the seeded local database): SUPER_ADMIN login lands on `/org/dashboard` (5 branches, KPIs, per-branch revenue table); "Open branch workspace" actions open NEW TABS; `/stores/thika/dashboard` renders the pinned branch shell with its own page title and branch badge; the warehouse manager's branch selector lists exactly the assigned branches (Juja Main, Thika); a Juja cashier opening the Thika workspace receives the calm "You do not have access to this branch" denial; the global chat channel is readable from a branch account (chat visibility stays separate from branch data access). All roles share the one database; every workspace request is re-authorized server-side.

### Changed
- The global chat composer input now declares `type="text"` explicitly (consistency for input styling and accessibility queries; behavior unchanged).

## [2.17.4] Local offline subdomain foundation: env template and hosts writer

### Added
- **Local offline env template (`.env.local-offline.example`)**: copy to `.env` for a single-shop offline install where every branch behaves like its own website. Pre-wires the `mbumah.test` root domain (the default host allowlist then covers the root and every branch subdomain), SQLite paths for the one shared database, plain-HTTP shared-cookie settings (`.mbumah.test`, secure off) and the sandbox M-Pesa callback. Referenced from `docs/local-offline-setup.md`.
- **Hosts file writer (`npm run domains:write-hosts`)**: companion to the print-only helper. Writes an idempotent, clearly marked managed block (root domain plus all five seeded branch subdomains, LAN IP or 127.0.0.1 via `--ip`, custom root via `--domain`), takes a timestamped backup of the hosts file before every write, verifies the result, supports `--remove`, and refuses cleanly with the exact elevated command when not run as root/Administrator. Verified: the write, re-run (single replaced block, foreign entries preserved), remove, and the non-elevated refusal path.

The remaining foundation items of this phase (Store slug and subdomain schema, seeded slugs and subdomains for the five branches, store context resolver, middleware host resolution, allowed-host validation, `/stores/[storeSlug]` path fallback, reserved subdomain blocking) shipped in v2.16.0 and are unchanged here.

## [2.17.3] Database safety tooling and standalone opt-in

### Added
- **Schema preflight (`npm run db:preflight`)**: answers "will this schema apply safely?" BEFORE an install or update touches the live shop database. It copies the SQLite database to a throwaway preflight file, runs the read-only `prisma migrate diff` between the copy and the models, then classifies the convergence on the copy: `in-sync`, `lossless-converge`, `additive-converge` (the known safe case for this project's nullable idempotencyKey / isEngraved columns) or `unsafe` (even `--accept-data-loss` fails; callers must abort). The live database is never written. Server databases are diffed read-only via `PREFLIGHT_DATABASE_URL`. `KEEP_PREFLIGHT_DB=1` keeps the copy for inspection.
- **Safe additive repair (`npm run db:repair`)**: one operator command for the "Schema drift detected" state: verified backup first (`db:backup` semantics), then the ensure-schema converge (plain push, and only on the known additive-drift refusal a pre-converge SQLite backup plus `--accept-data-loss`), then a verification push that must be a clean no-op. Exit 0 means repaired and verified.
- **Windows standalone output is now opt-in** (`BUILD_STANDALONE=1`): the Docker image and both no-Docker installers/updaters set the flag (their launchers run `.next/standalone/server.js`); plain `next build` and Vercel build without it, which also avoids the Windows EINVAL copyfile errors the standalone file walk can trigger. `users.isEngraved` was audited and confirmed deliberate (self-healing bootstrap admin); its schema documentation stands.

### Investigated and blocked
- **`prisma.config.ts` migration (the deprecated `package.json#prisma` seed block stays for now)**: adding a Prisma config file changes Prisma 6.19 CLI behavior - the CLI then resolves the datasource from the .env file and ignores inherited environment variables, and schema management rides `directUrl`, so the entire self-host toolchain (ensure-schema converge, installers, CI database preparation, the new preflight and repair targets) silently loses explicit-target control. Reproduced and documented; reverted. Revisit when adopting Prisma 7, together with a toolchain-wide env strategy.

## [2.17.2] File organization and duplicate file removal

### Removed
- **Retired duplicate brand assets**: `public/logo.png` and `public/logo.svg` (the old flat logo generation) are gone. Every surface now uses the current 3D brand set: the app sidebar, receipts and printed documents, the PDF statement report (which now embeds the 3D gear mark), and the service worker precache (cache version bumped so clients pick up the new asset list).
- **One-shot operational workflow removed**: `.github/workflows/delete-duplicate-vercel-project.yml` served its purpose once the duplicate Vercel project was confirmed deleted; the workflow remains recoverable from git history if ever needed again.

### Changed
- **.gitignore hardened**: SQLite/PostgreSQL local database variants (`*.sqlite`, `*.db.wal`/`*.db.shm`) and OS or editor droppings (`Thumbs.db`, `*.swp`) are now ignored, alongside the existing env, log, and database exclusions. One shared database remains the rule: nothing in the repo creates per-branch databases.
- The Edge proxy matcher explicitly excludes the 3D brand assets from the workspace pipeline so they are always served statically.
- Project structure documentation updated to describe the current brand asset set.

## [2.17.1] Professional repository writing standards

### Changed
- **Decorative emojis removed from the product surface**: seed and tooling console output now uses plain status markers ([ok] / [skip] / Warning: / [FAIL]); the offline page, WhatsApp receipt text, email subjects and headings, staff message templates, PDF statement activity rows, and client error logs read as plain professional text. Typographic status glyphs used by financial tables (check and cross marks) and the Mac Command key notation are preserved.
- **AI-style em and en dashes removed** from prose, comments, documentation (including the archive), console output, and config banners across the repository. Technical hyphens inside identifiers, URLs, CLI flags, package names, and version strings are untouched.
- **Terminology standardized in prose**: M-Pesa, Daraja API, STK Push, TypeScript, Next.js, PostgreSQL. Code identifiers, enum values, and endpoint paths are unchanged.
- **Demo credentials labeled as local-only**: the README, client setup guide, and self-host READMEs now explicitly mark the seeded admin login as a local default that must be changed immediately after first login.

### Fixed
- **Brand consistency**: receipts, printed documents, and the PWA shortcuts now use the current 3D gear brand mark (the same set as the app sidebar and favicon) instead of the retired flat logo; the two PWA shortcut icons point at the standard icon set; staff-facing email placeholders use the mbumahhardware.co.ke domain.
- **Self-host README corrections**: removed a stale version reference and repaired a malformed documentation link.

## [2.17.0] Hosting readiness audit corrections (external spec review)

### Added
- **Hosting readiness audit** (`docs/hosting-readiness-audit.md`): the external "hosting and subdomain phases" specification and the "local and online hosting guide" were reviewed against the repository. The audit maps all seven spec phases to what actually shipped (v2.15.0 through v2.16.0), records where the documents' assumptions no longer match the codebase (custom Bearer auth instead of NextAuth, IndexedDB instead of localStorage, `isEngraved` is a deliberate feature, the v2.15.0 series is already released so remaining work uses 2.17.0+), and keeps a prioritized gap register with dispositions.
- **Deployment posture fields on `/api/health`**: new informational top-level fields `appMode` (APP_MODE vocabulary: local-offline / development / production), `workspaceMode` (auto / subdomain / path / off) and `databaseProvider` (sqlite / postgresql, derived from the DATABASE_URL scheme). Monitors, tunnel checks and the LAN health gates can now tell which deployment posture answered. Additive only; the status computation is unchanged.
- **Database backup tooling** (`scripts/backup-db.mjs`, `npm run db:backup`): timestamped SQLite backup with `-wal`/`-shm` sidecars, file-missing and empty-file refusal, size verification, `BACKUP_DIR` destination and `BACKUP_KEEP`/`--keep` retention (newest 20 by default). PostgreSQL URLs print masked pg_dump / snapshot guidance instead of handling credentials. `npm run db:verify` runs the provider-aware `prisma validate`.

### Fixed
- **STK Push now rides the PAYMENT rate tier** (20/min) in the Edge proxy instead of the generic WRITE tier; initiating a customer-facing M-Pesa payment prompt is money-touching and must not share the 30/min write budget.
- **Docs corrected**: `/api/healthy` never existed as a route - `docs/deployment.md` and `docs/self-hosting.md` now document the real authenticated aggregated status endpoint `/api/health/system-status`, and the `/api/health` field lists include the new posture fields.

## [2.16.0] Feature: subdomain workspaces for offline and localhost modes

### Added
- **Branch subdomain workspaces** - every branch can now be reached as its own website (`juja-main.mbumah.co.ke`) while everything stays on one shared database. The root domain remains the organization console; path mode (`/stores/juja-main/dashboard`) remains the universal fallback for localhost, raw IPs, previews and tunnels without wildcard DNS. Mode selection is automatic (`NEXT_PUBLIC_STORE_WORKSPACE_MODE=auto`) with explicit `subdomain`, `path` and `off` overrides.
- **Host security layer in the Edge proxy** (extends the previous API-only pipeline to pages): Host header allowlist (`ALLOWED_HOSTS`, built-in defaults cover localhost, LAN IPs, `*.vercel.app` and the configured root domain), port stripping, reserved-subdomain protection (www, api, auth, admin, app, ...), branch subdomain rewrites to the internal path workspace, advisory `x-store-subdomain` / `x-store-slug` request headers, and a CORS OPTIONS preflight answer for trusted origins only (never a wildcard with credentials).
- **Store workspace schema**: `Store.slug` + `Store.subdomain` (unique, RFC 1123 labels, reserved-word protected) and `Store.brandingColor` (branch accent). Production-safe idempotent backfill (`scripts/backfill-store-slugs.mjs`, wired into `vercel-build` and `npm run db:backfill-slugs`) stamps legacy rows without touching populated values.
- **Multi-store memberships**: new `StoreMembership` model (unique active row per user+store) grants additional branch access; `assertStoreScope` now honors org-wide roles (SUPER_ADMIN, STORE_OWNER) and active memberships, and the ORM tenant context follows the validated requested store so branch workspaces show the right branch's data. A demo WAREHOUSE_MANAGER (`warehouse@mbumahhardware.co.ke`, password123) is seeded with Juja Main + Thika assignments.
- **Organization console** (`/org/dashboard`): combined metrics (revenue, transactions, low stock, overdue rentals, debt aging, pending M-Pesa), per-branch performance table, recent audit events, and "Open branch workspace" actions that open a new tab (subdomain URL when available, path mode otherwise). SUPER_ADMIN and STORE_OWNER get the full view; ACCOUNTANT a read-only financial view; branch-only roles are denied and the attempt is audit-logged.
- **Branch selector** (`/branches/select`) for multi-store members: shows only assigned active stores, opens workspaces in new tabs, auto-redirects single-store members, calm empty state for unassigned users.
- **Global chat across subdomains** (`/chat` + `/api/chat/*`): a singleton GLOBAL channel readable by every authenticated user of every branch (chat visibility is separate from data access), branch origin badges on messages, store threads unchanged, Zod-validated sends (2000 char cap) on the MESSAGING rate tier, 5s/15s polling fallback - no WebSocket dependency, serverless-friendly.
- **Cross-subdomain session sharing (opt-in)**: when `NEXTAUTH_COOKIE_DOMAIN` is configured, login also sets a shared `mbt_token` cookie; branch subdomain origins adopt it at boot and validate via `/api/auth/me`. Without it, behavior is unchanged (Bearer in localStorage, per-origin login).
- **Workspace routing for the SPA**: `/stores/[slug]/[[...rest]]` renders the exact same shell (extracted to `src/components/app/main-app.tsx`) pinned to the resolved branch, with per-branch page titles (`{Store Name} | Mbumah Hardware POS`), a branch badge in the top bar, and the branch accent color. Single-branch roles no longer see a store switcher in a pinned workspace; org roles keep it (the server still validates every switch).
- **Local setup tooling**: `npm run domains:print` prints copy-pasteable hosts-file entries (macOS/Linux/Windows instructions in the docs), `npm run domains:verify` runs a PASS/FAIL verification matrix against a running server (subdomain resolution, host header attacks, reserved subdomains, port stripping, health through a branch host).

### Tests
- 28 new unit tests: workspace domain helpers (host parsing, allowlist, reserved subdomains, mode resolution, internal rewrites) and workspace store definitions consistency (seed vs client store-info vs domains config). Suite: 19 files / 475 tests green; lint 0 errors; typecheck at baseline.

### Notes
- All branches keep sharing one database; tenant isolation is unchanged and every workspace request is re-authorized server-side (denied attempts are written to the security event feed).
- Docs: `docs/subdomain-workspaces.md` (master reference), `docs/local-offline-setup.md`, `docs/lan-deployment.md`, `docs/tunnel-development.md`, `docs/multi-store-workspaces.md`, `docs/global-chat.md`, `docs/rbac.md`, `docs/architecture.md`, `docs/vercel-deployment.md`, `docs/self-hosting.md`.

## [2.15.2] Hotfix: offline laptops self-heal database schema drift

### Fixed
- **Critical (offline incident): laptops updated to a release whose schema added unique columns kept serving Prisma P2022 errors** - "The column `equipment_rentals.idempotencyKey` does not exist in the current database" on `/api/notifications`, `/api/debt`, `/api/reminders/debt/overdue` and `/api/stock-movements`. Root cause: v2.14.0 added five nullable `idempotencyKey @unique` columns; Prisma classifies adding a unique constraint to a NON-EMPTY existing database as a data-loss warning and REFUSES `prisma db push` in non-interactive mode ("Use the --accept-data-loss flag"). Every self-hosted path (Windows installer, updater, Linux laptop scripts, docker entrypoint) ran the bare push with no fallback, so the database silently stayed behind the code while `/api/health` stayed green (row counts never touch new columns).

### Added
- **`scripts/ensure-schema.mjs` - the self-healing schema converge step** now behind `npm run db:push` everywhere (installer, updater, laptop scripts, CI prepare): plain push first (fast no-op when in sync); when refused, it backs the SQLite file up (`pos.db.pre-heal-<timestamp>.db`, newest 5 kept) and converges with `--accept-data-loss` - safe for this project's recurring additive drift (new nullable unique columns).
- **Startup self-heal**: the standalone server launcher (`deploy/nodocker/start-server.mjs`) converges the schema on EVERY boot before starting the POS (~1s no-op when in sync), so an install whose update schema step was skipped repairs itself the next time the shop opens the till. Disable with `SKIP_SCHEMA_HEAL=1` in `.env`. The docker entrypoint uses the same converge step (replacing the blind push + retry).
- **Schema-drift sentinel in `/api/health`**: when row counts succeed but the schema lags the code, `database_stats` degrades from `ok` to `warning` with a self-service fix hint. The probe uses the generated Prisma client (an ORM `findFirst` on the sentinel column) - a raw `SELECT "idempotencyKey"` probe would be blind on SQLite, which treats a double-quoted unknown identifier as a string literal instead of erroring. The start-pos and update-pos health gates key on exactly this status, so a drifted database can no longer pass the update health gate unnoticed.

### Notes
- Data safety: the converge fallback only ever runs after a plain push is refused, takes a timestamped SQLite file backup first, and the updater still takes its full pre-update backup before the rebuild. No changes to totals, VAT math, payments, debt or discount gates.
- Immediate remedy for affected laptops (works on any version): close the POS, run `npm run db:push` in the app folder, start the POS. Updating to 2.15.2+ does this automatically.

## [2.15.1] Hotfix: offline sales actually queue (mutation networkMode)

### Fixed
- **Critical: the offline sale flow never fired while offline** - TanStack Query pauses mutations when `navigator.onLine` is false under its default `networkMode: 'online'`, so `checkoutMutation.mutationFn` never ran, `saveOfflineTransaction()` was never reached and tapping "Process Payment" offline silently did nothing (queue stayed empty, no synthetic receipt). The app-wide QueryClient now sets `mutations.networkMode: 'always'`; the checkout mutationFn's own `navigator.onLine` check routes offline sales into the IndexedDB queue, and mutations without an offline path surface their network error via their normal `onError` handlers.
- Caught by the post-release browser E2E (release-process step 3): `[HANDLE-CHECKOUT]` logged while the mutation function never did; after the fix the full loop was verified live on the POS - offline sale saved locally with amber queue badge and synthetic receipt, reconnect auto-synced it to the server (real receipt number, Completed), queue drained to the green dot, and exactly one "Offline sales synced" success toast appeared (no duplicates).

### Notes
- No schema changes; no changes to totals, VAT math, payments, debt or discount gates. The offline queue engine, idempotent replay and indicator were already correct - only the mutation gating blocked them.

## [2.15.0] Release: audit corrections, realtime self-hosting wiring, offline polish

### Fixed
- **Duplicate sync toasts at the till**: an automatic background sync with the POS tab mounted toasted twice for the same event (POS tab's own success toast + the global OfflineIndicator's transition toast). Toast ownership is now explicit - the top-bar indicator owns the single "Offline sales synced" success per queue transition, and the POS tab surfaces only what the indicator cannot see: per-sync failure detail (which sales will retry). Manual "Sync now" and offline/online announcements are unchanged.
- **Latent self-hosted startup bug**: nginx `proxy_pass http://nextjs_app` referenced a hostname the compose file never defined (the app container had been renamed to `mbumah_app`), so `docker-compose.prod.yml` failed at nginx startup with "host not found in upstream". The app service now carries the `nextjs_app` network alias (documented in place).
- **Fresh-clone test suite**: `bun run test` failed 16 DB-dependent tests locally because the hermetic SQLite test database (`prisma/prisma/dev.db`) only existed in CI. A new `pretest` hook (`scripts/prepare-test-db.mjs`) mirrors the CI prepare step (schema push + seed against the forced URL, committed postgresql schema text restored afterwards), making the suite self-sufficient: 17 files / 447 tests green on a fresh clone (was 411/16 failed).

### Added
- **Realtime notifications ship self-hosted**: `mini-services/notification-service` now has a production Dockerfile (bun runtime, frozen lockfile) and runs as an internal-only `notification` service in `docker-compose.prod.yml` (healthcheck on `/health`, nginx `depends_on` healthy). Nginx routes same-origin `/socket.io/` traffic to it with websocket upgrade headers and 24h timeouts. Verified end-to-end: Engine.IO polling handshake 200, websocket connect, `join-store` -> `room-joined`. On Vercel the client degrades gracefully (no realtime push, everything else unchanged).
- **Offline mode documentation** (`docs/offline-mode.md`): queue flow (queue -> replay -> dedupe -> cleanup), cashier-facing surfaces, step-by-step offline testing, developer notes; indexed from `docs/README.md`.
- **Health endpoints guide** (`docs/deployment.md`): documents the `/api/health` (public, automation) vs `/api/healthy` (authenticated, in-app) split and the realtime service wiring.

### Improved
- Repository organization phase 2: client source materials consolidated under `docs/assets/`, ops runbook moved to `docs/runbooks/`, sandbox template artifacts removed, repo-wide markdown hygiene (single H1, no emoji headings, no em dashes), gitignore env-variant coverage.

### Notes
- No schema changes; no changes to totals, VAT math, payments, debt or discount gates.
- Version reads from `package.json` everywhere (API, footer badge, OpenAPI) per the release process.

## [2.14.0] Production hardening: self-test, engraved admin, offline queue UX, stock contract

### Added
- **POST self-test + engraved-admin self-heal**: `/api/system/post` runs isolated production checks (PASS/FAIL/DEGRADED); `/api/system/heal` repairs the seeded engraved super admin idempotently; engraved accounts cannot be deleted, deactivated or demoted via the users API (403 `ENGRAVED_ADMIN_PROTECTED`); Admin tab gains a System Health card and shield badge.
- **Offline queue UX**: top-bar `OfflineIndicator` (green/amber dot + Offline Queue dialog listing every queued sale) on every tab, single per-transition reconnect toast, `clearOfflineQueue()` for the confirmed dialog action; canonical import path `@/lib/offline` with the queue contract documented in `src/lib/offline/README.md`.
- **Stock shortage contract**: checkout pre-validates every sellable line and fails with one structured 400 (`INSUFFICIENT_STOCK` + per-product details) before any charge; race losers map to the same contract; the POS clamps lines to available stock and routes zero-stock lines to the existing low-stock popup.
- **Ops**: `scripts/backup.sh` (sqlite3 `.backup` -> gzip with retention), database idempotency keys on `DebtLedger`/`EquipmentRental`/`Expense`/`StockMovement`.

### Improved
- **Fullscreen sidebar autohide**: in browser fullscreen the sidebar collapses to a 64px icon rail, auto-hides after 2s idle, peeks from a left-edge sensor, and restores state on exit; icon tooltips show F2-F5 shortcut hints; user menu gains "Toggle Fullscreen".
- **Inventory reorder prefill**: at/below-reorder products show "Reorder (+N)" (row menu, detail panel and a quick-fill chip in the Adjust Stock dialog) that prefills the suggested quantity to restore the stock level.
- **Typography sweep**: repo-wide string-literal cleanup (em dashes -> hyphens, decorative emojis out of internal UI); customer-facing templates exempt.
- **Repository organization phase 1**: Windows installers under `deploy/windows/`, QA screenshots and sandbox scripts removed, `bun.lock` as the sole lockfile, governance files (CONTRIBUTING/SECURITY/CODE_OF_CONDUCT/CHANGELOG/SUPPORT) and `.github` templates in place.

### Notes
- Receipts gained print/PDF parity (`<receipt-number>.pdf`), amount no-wrap, unit abbreviations and a fixed totals strip.
- No changes to totals, VAT math, payments, debt or discount gates.

## [2.13.3] Feature release: functional POS + new 3D logo + smart recommendations

### Added
- **New 3D brand logo everywhere (spec PART 1)**: the official MBUMAH HARDWARE artwork (navy gear · orange house · silver trowel · "Your Building Partner in Juja") now anchors the sidebar in a white rounded-xl container with drop shadow so it sits cleanly on the dark `#0f172a` rail; the old flat green "MH" initials square is gone. A gear-only crop marks the top bar (visible even when the sidebar is collapsed) and the favicon/PWA icons are regenerated from the same artwork. Light backgrounds use the full-color logo as-is; dark surfaces get the white-container wrapper.
- **Smart Sell More recommendations (spec PART 3)**: a client-side product-affinity engine (`src/lib/product-affinities.ts`) maps what's in the cart to what the same customer very likely still needs (cement → spade + mixer + nails; mabati → timber + nails; rebar → cement + binding wire…), ranks by frequency, drops items already in the cart or out of stock, and shows the top 6 as tappable chips (+ icon, category dot, price). Works from the first cart, with no sales history needed (the server's co-occurrence engine is merged in and takes over as history accumulates). An empty cart shows best-seller chips; a cart with no mapped affinity shows the coach text plus best sellers below. The section is collapsible and the collapse state persists per device.
- **Thika branch catalog aligned to spec (PART 2)**: `scripts/seed-thika-catalog.ts` (idempotent, owner-run, StockMovement-audited) ensures the THI branch carries the 11 spec products at exact prices and stock: 4-inch Nails (Ksh 150/kg · 350), Bamburi Cement 50kg (750 · 180 bags), Dulux Weathershield 20L (8,500 · 20), Mabati 28/30-Gauge 8ft (800/650 · 200/350), Plywood 8x4ft 18mm (2,800 · 45), PVC Pipe 4-inch x 3m (800 · 90), Rebar 12mm x 12m (1,200 · 280), Simba Cement 50kg (720 · 120 bags), Spade Heavy Duty (1,200 · 40), Timber 2x4 x 12ft Cypress (800 · 60), plus the rental Concrete Mixer (Ksh 85,000, RENTAL) and Chain Link 6ft x 50m (4,500) used by the demo cart.

### Improved
- **Instant, honest cart feedback (spec PART 2)**: product tiles now show a blue "1 in cart / 2 in cart" pill the moment a line lands (optimistic, under 100ms, no network involved; pops on every re-add), add-toasts name the product and price ("Added Spade (Heavy Duty) - Ksh 1,200"), and Hold toasts say exactly what was parked ("Cart held - 7 items").
- **Faster search**: the products query debounce drops 200ms → 150ms per the functional-POS spec; the input itself stays instantly responsive and barcode-scan Enter-to-cart behaviour is unchanged.
- **Zero-sales KPI honesty (new branches)**: when a branch has no sales today, the Today's Revenue card shows a gray trend badge (never green or red at zero) with a hover tooltip "No sales yet today - start selling!" and the same coaching line as the card sub-text. Live/updated/auto-refresh-30s behavior from v2.13.0 is untouched.

### Notes
- RBAC, manager-PIN overrides, abuse detection and the audit trail (v2.12.x-v2.13.0) are unchanged and fully enforced.
- No schema changes; no changes to totals, VAT math, payments, debt or discount gates.

## [2.13.2] Hotfix: checkout 500 regression + limited-dashboard money card

### Fixed
- **Critical: checkout 500 on every sale (v2.13.1 regression)**: the new VAT-ledger line chained `.mul()` on the `Money` wrapper (which exposes `multiply()`/`taxComponent()`, not `mul()`), throwing `TypeError: KES(...).mul is not a function` and failing **every** `POST /api/transactions` with a 500. Replaced with the vetted helper `KES(finalTotal).taxComponent(rate).toNumber()`, the exact intended formula (`total × rate/(100+rate)`), Decimal-safe, 2dp HALF_UP. Caught by the post-deploy prod E2E (network log captured the 500 body) within minutes of rollout.
- **Cashier dashboard "Today's Sales" showed a count as money**: the limited payload's `todaySales` carried the transaction COUNT, so one sale rendered as "Ksh 1.00" while the real net revenue only surfaced via Avg Order. Now returns net revenue (same semantic as the full dashboard), keeping "Transactions" as the count card.

## [2.13.1] Fixed: VAT alignment & cashier KPI scoping

Closes the two acceptance nuances documented at the v2.13.0 E2E verification. No schema changes; no changes to totals, payments, debt or discount-gate math.

### Fixed
- **VAT figure is now receipt-true (spec formula)**: the info-only "VAT (x% incl.)" line on the POS cart, checkout summary and printed receipt shows the VAT component **inside the amount the customer actually pays**: `Total × rate / (100 + rate)`. Previously it showed the pre-discount per-line VAT component, so a Ksh 220 cart with a Ksh 50 discount (Total 170) displayed VAT 30.34 instead of 23.45.
- **Server VAT ledger aligned (Kenya VAT Act)**: `SalesTransaction.taxAmount`, the journal `VAT_PAYABLE` credit, the eTIMS payload `vatTotal` and the receipt's taxable-amount derivation now all use the post-discount consideration, since a discount given at the time of supply reduces the taxable value. Net revenue (`totalAmount − taxAmount`) therefore increases by the discount's VAT component on discounted sales, which is correct under IFRS 15 (revenue at transaction price).
- **Journal entry restructure**: the cart-level discount is no longer booked to the `SALES_DISCOUNTS` contra-revenue account (it is already netted inside the transaction-price revenue; booking both would unbalance the entry by exactly the discount). The discount remains recorded on the transaction row (`discountAmount`) for analytics. Entries created before v2.13.1 are untouched and remain balanced.
- **Cashier dashboard KPIs strictly own-scoped**: the limited dashboard's "Today's Sales", "Transactions" and "Avg Order" aggregates now filter on `cashierId = session.userId` and are captioned "your sales", matching the RBAC spec ("My Sales", not the branch total). Low Stock remains a store-level signal (no revenue leakage; previously true by construction).

### Notes
- Historical transactions keep their stored figures (documents are immutable history); only sales created on/after v2.13.1 use the aligned VAT derivation.
- Info-only guarantee still holds: Totals, Subtotals, Discounts, payments, debt, gift-card redemptions and the discount permission gates are byte-identical to v2.13.0 behavior.

## [2.13.0] Feature release: RBAC & Audit

The v2.12.1 → v2.13.0 ladder completes the RBAC roadmap. This release's headline is already live since v2.12.5-v2.12.8; v2.13.0 adds the release polish and ships the full ladder together.

### The ladder (v2.12.1 v2.12.8)
- **v2.12.2-v2.12.5, RBAC core**: 16-key dotted feature-permission matrix (`src/lib/permissions.ts`) with a 5-role system (SUPER_ADMIN, STORE_OWNER, BRANCH_MANAGER, CASHIER, INVENTORY_MANAGER), backend `403 PERMISSION_DENIED` enforcement, role-filtered sidebar with lock affordances, LockedCard + access requests, cashier limited dashboard, manager step-up authorization at the counter (`POST /api/auth/manager-authorize`) for >5% discounts and high-risk debt (KES 150k+).
- **v2.12.6-v2.12.8, Audit & abuse**: consolidated Audit Trail page with CSV export, discount-spam abuse detection (>3 denials/1h → SecurityEvent + manager notifications), privilege-abuse lockout (5 denials/10 min → 15-minute lock + Super Admin alerts), Security tab in the notification center, inventory price guard for INVENTORY_MANAGER.
- **v2.12.1, POS hotfix**: per-unit fallback ("per " bug), product-card badge overlap, FAB overlap on checkout, category scrollbar, VAT "(incl.)" labels, stock counter units, duplicate-image cleanup script.

### Added (v2.13.0)
- **What's New dialog**: on first launch after an update, a "Karibu! What's New in Mbumah POS" modal summarizes the release (latest version highlighted, previous entries below) with a direct link to this changelog on GitHub. Shown once per version via `localStorage.mbt_seen_version`; SSR-safe, and it does not repeat when storage is unavailable.
- **Footer status chip**: the Connected dot is now a live online indicator (mirrors `navigator.onLine` via online/offline events): green pulsing dot when connected, red "Offline" when the connection drops. Hidden on xs screens.
- **Footer Shortcuts button**: opens the existing Keyboard Shortcuts help dialog (previously reachable only via the `?` shortcut).

### Deprecated
- **Versions prior to v2.13.0 are deprecated for support purposes; self-hosted stores should update via the in-app updater (v2.9.0+) or the Remote Access Kit flow.**

## [2.12.8] Audit Trail page

### Added
- **Audit Trail view in the Security tab**: a second view ("Security Dashboard | Audit Trail" toggle, dashboard stays default) rendering a consolidated table of permission denials, manager overrides and manager authorizations: timestamp (with time-ago), user (name + truncated email), role, color-coded action badge (red denial / amber override / green authorized), resource + reason, result (DENIED / SUCCESS), branch, IP address.
- **Filters**: role select, user search (name/email), date range (from/to), "Denied only" switch, free search (permission/resource/reason), Prev/Next pagination with totals, and **Export CSV** (`mbumah-audit-trail-YYYYMMDD.csv`) honoring the active filters.
- Loading skeletons, error state and an explicit empty state ("No audit events match your filters"); long tables scroll inside a `scrollbar-thin` container.

## [2.12.7] Abuse detection & security alerts

### Added
- **Discount-spam pattern alert**: a cashier (or any role) denied `pos.discount.gt5` more than 3 times in 1 hour now writes a `PRIVILEGE_ABUSE_PATTERN` SecurityEvent and notifies every active BRANCH_MANAGER and SUPER_ADMIN of the org (WARNING / SECURITY notification, e.g. "Grace Wanjiku (Cashier) attempted 4x discount >5% in 1h, 14:32"). In-memory sliding window per instance (same best-effort posture as the lockout engine); the SecurityEvent feed is the durable record.
- **Inventory price guard**: an INVENTORY_MANAGER whose product-price update deviates more than ±20% from the cost basis (or from the old price when cost is null) gets `403 MANAGER_APPROVAL_REQUIRED` + a `HIGH_RISK_ATTEMPT` security record. The same `managerOverride` credential object used at checkout lets a Branch Manager+ approve inline (writes a MANAGER_OVERRIDE audit row with `PRODUCT_PRICE_GUARD` context); 3 wrong approvals in 5 minutes trip the existing brute-force window.
- **Security tab in the Alerts panel**: role-gated (SUPER_ADMIN / STORE_OWNER / BRANCH_MANAGER) red-shield filter tab listing SECURITY-category notifications, with the 10 most recent abuse-set SecurityEvents (permission denials, high-risk attempts, brute force, lockouts, abuse patterns) merged below as read-only, red-tinted entries. The bell badge now reflects security alerts too; `/api/notifications` previously surfaced none of the durable SECURITY notification rows.

### Changed
- `/api/security/events` accepts BRANCH_MANAGER (store-scoped) and supports a comma-separated `eventTypes` filter.

## [2.12.6] Audit logging consolidation

### Added
- **GET /api/admin/audit-trail** (SUPER_ADMIN / STORE_OWNER / BRANCH_MANAGER): one consolidated, paginated feed merging hash-chained AuditLog rows (`PERMISSION_DENIED`, `MANAGER_OVERRIDE`, `MANAGER_AUTHORIZED`) with SecurityEvent denial rows (`PERMISSION_DENIED` / `HIGH_RISK_ATTEMPT`) that have no AuditLog twin, so every denial appears exactly once (nearest-timestamp dedup, HIGH_RISK kind carried from the twin). Branch-scoped for non-super-admin callers; `format=csv` streams the compliance export.

### Deferred
- **`pos.void` endpoint**: still does not exist (verified); nothing was invented for it. The `requireFeaturePermission('pos.void')` gate, manager-override flow and Audit Trail visibility are ready the moment the endpoint lands. Void >2/shift manager approval ships with it.
- **Email digest option** for security notifications (daily/weekly summary), scheduled for a later release.

## [2.12.5] RBAC stable

Umbrella release of the v2.12.2 → v2.12.5 RBAC ladder: the role/permission system is now enforced end-to-end: backend 403s with typed denial payloads, role-filtered navigation with lock affordances, manager approval flows at the counter, and a dedicated limited view for cashiers. See the individual sections below for what shipped in each step.

### Highlights
- One permission model, two layers: the resource→action matrix (`hasPermission`) for CRUD checks plus the dotted feature keys (`hasFeaturePermission`) for business rules like discounts and dashboards.
- Manager approvals are now a first-class counter workflow: the cashier can complete a gated sale by collecting a manager's credentials, and every approval/denial is durably audited.
- Cashiers see an honest, useful workspace instead of broken analytics: own-activity KPIs, their own sales, and a clear "request access" path.

### Notes
- No database migrations required (User.role is a string column; the permission matrix is code-defined in `src/lib/permissions.ts`).

## [2.12.4] Cashier Limited View

### Added
- **Limited dashboard for revenue-denied roles** (CASHIER, INVENTORY_MANAGER): the dashboard API early-returns a minimal payload (`limitedView: true`, today's sales, transaction count, average order value, low-stock counts and the caller's own last 10 sales (`mySales`)) and never computes or ships revenue trends, debt exposure, top products/customers, payment-method amounts or inventory value for these roles (restricted by construction).
- **Cashier dashboard layout**: greeting hero, 4 KPI cards only (Today's Sales, Transactions, Avg Order, Low Stock), a "My Sales" feed (receipt tail, payment-method badge, amount, time-ago), an info banner ("You're viewing a limited dashboard. Revenue, debt and analytics are hidden for your role.") and a 2-column grid of LockedCards for Revenue Trend, Debt Aging, Store Health and Financial Reports, each with a "Request Access" action.
- **High-risk debt warning in POS**: selecting a customer whose outstanding balance exceeds KES 150,000 shows a red inline warning in the customer selector; amounts appear only for roles holding `customers.view.debt`; cashiers see the generic "Credit approval required for this customer".

## [2.12.3] RBAC core: matrix, sidebar filtering, locked cards

### Added
- **INVENTORY_MANAGER role** (frontend surfaces): catalog, inventory, suppliers, purchase orders and transfers now grant the role; role labels and tier order shared app-wide (`ROLE_LABELS`, `requiredRoleLabelFor`).
- **Sidebar lock affordances**: tabs a role cannot open are no longer silently hidden; they render as a grayed row with a 14px Lock icon, a "Requires {role}" tooltip (e.g. "Requires Branch Manager"), `aria-disabled` non-clickable behavior, and just the lock icon when the sidebar is collapsed. Accessible tabs keep the orange active-item style.
- **Cashier navigation narrowed to spec**: exactly Dashboard, POS, Customers, Transactions (Messaging/Chat moved out of the cashier's reach).
- **LockedCard component** (`src/components/rbac/locked-card.tsx`): premium locked-section card matching the dashboard design language: lock glyph in a muted circle, "Requires {role}" title, one-line explanation from the permission copy, and a debounced "Request Access" button.
- **Access-request flow** (`POST /api/access-requests`): records a `SecurityEvent(ACCESS_REQUEST, INFO)` with the permission key, requester email and role, and creates Notification rows for every active SUPER_ADMIN and BRANCH_MANAGER of the organization (requester excluded). Grants remain a Super Admin action.
- **Top-bar role badge**: muted role chip next to the top-bar actions (hidden on very small screens); SUPER_ADMIN renders "SA · System Administrator".
- **Feature-permission hook layer**: `usePermissions()` now exposes the `feature` group (`posSell`, `posDiscountGt5`, `dashboardRevenue`, `inventoryViewCost`, …) built on `hasFeaturePermission`, plus a plain `canFeature(role, key)` helper.

### Fixed
- **Cost hiding**: where the products API strips `costPrice` to null (roles without `inventory.view.cost`), the inventory table, detail dialog, stock-value summary and CSV export now render "•••" ("Cost hidden for your role") instead of 0 / blank / NaN margins.

## [2.12.2] Security: backend permission middleware + 403 handling

### Added
- **Feature permission matrix** (`src/lib/permissions.ts`): 16 dotted keys (`pos.sell`, `pos.void`, `pos.discount.gt5`, `pos.discount.gt10`, `pos.view.all_sales`, `dashboard.view.revenue`, `dashboard.view.profit_margin`, `dashboard.view.debt_aging`, `inventory.edit`, `inventory.view.cost`, `customers.view.debt`, `customers.create`, `debt.approve.high_risk`, `financial.view`, `settings.roles.manage`) with SUPER_ADMIN bypass and fail-closed behavior, plus shop-floor denial copy and per-key required-role labels.
- **Backend enforcement**: `requireFeaturePermission(key)` wrapper returns `403 { code: 'PERMISSION_DENIED', permission, message }`; every denial writes a hash-chained AuditLog row and a SecurityEvent, and feeds the privilege-abuse engine (5 denials / 10 min → 15-minute lockout + SUPER_ADMIN notifications).
- **Manager step-up authorization**: `POST /api/auth/manager-authorize` verifies a manager's email + password (shared bcrypt path with login), gates on manager-tier roles, records `MANAGER_AUTHORIZED` audit rows, and rate-limits to 3 failed attempts / 5 min per email+IP (`429 BRUTE_FORCE_PIN`).
- **Checkout gates**: discounts > 5% require the manager tier or a verified `managerOverride` credential object; discounts > 10% require Store Owner tier (never cashier-overridable); credit sales to customers owing more than KES 150,000 require `debt.approve.high_risk` or a verified override; every override writes a `MANAGER_OVERRIDE` audit row.
- **Products cost stripping**: list/detail/search endpoints return `costPrice: null` for roles without `inventory.view.cost`; product create/update/delete restricted to manager tier + INVENTORY_MANAGER.
- **Role management segregation**: creating users and changing roles are now Super Admin-only (`settings.roles.manage`).
- **Wire format**: `ApiRequestError` now carries the parsed error body so the frontend can branch on `code` / `permission` / `requiresManagerOverride` instead of matching message text.

## [2.12.1] Hotfix

### Fixed
- **POS "per NULL" unit bug**: products saved with a NULL `unitType` (e.g. Bamburi Cement) rendered a dangling "per " on product cards and empty/"null" unit badges in the cart, catalog, inventory and POS views. All unit render sites now share one null-safe `unitLabel()` helper (`src/lib/units.ts`), with a `UNIT` fallback. Ships with an owner-run backfill script, `scripts/fix-null-units.ts` (cement/Bamburi → `BAG`, other NULL units → `PIECE`).
- **Product card badge overlap**: the top-left badge stack (NEW / RENTAL / BUNDLE / BEST SELLER / ON SALE) is capped at 55% width with per-badge truncation, and the top-right LOW STOCK / OUT OF STOCK badge at 42% with truncation, so they can no longer collide on narrow cards (both stay z-20; NEW badge rule unchanged).
- **FAB overlap on POS**: the floating home button is now hidden while the POS tab is active (it covered the checkout area on short viewports) and remains on every other tab.
- **Category chips scrollbar**: removed the `scrollbar-none` override so the existing slim `scrollbar-thin` scrollbar (6px, rounded, muted thumb, transparent track) is always visible; scroll behavior and arrows unchanged.
- **VAT labels marked "(incl.)"**: POS cart totals, last-sale receipt, checkout dialog and the printable receipt now read "VAT (16% incl.)", an info-only clarification that prices are VAT-inclusive (KE default; VAT = Total × 0.16 / 1.16). No tax math was changed.
- **Stock counter unit**: product-card stock labels now carry a short unit suffix ("393 kg left", "12 bags left") via a shared `unitShort()` helper.
- **Duplicate nail images**: owner-run script `scripts/fix-duplicate-images.ts` clears `imageUrl` on duplicate nail product rows (one canonical image kept per size variant) so the grid falls back to category images.

### Notes
- Shift math fix, debt-crisis logic, low-stock counts, system-activity sanitization, alert dedup, and revenue-outlier handling shipped in v2.12.0 (PR #86).
