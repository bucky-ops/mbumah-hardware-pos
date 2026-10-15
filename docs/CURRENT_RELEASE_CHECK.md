# Current Release Check

Baseline audit performed before the audit-implementation sequence (branch
`feat/audit-implementation-sequence`, cut from `origin/main` @ 894226e,
release v2.18.3). Every finding below was re-verified against the current
code with file and line evidence. Evidence file: this document.

## Version decision block (release 1 of the sequence)

```
Detected version: 2.18.3 (package.json version + mbumah.releaseVersion; latest valid tag v2.18.3)
Valid base version: 2.18.3 (annotated tag exists on origin/main)
Hotfix number: none yet on this base
Change classification: CORRECTION
Proposed next version: v2.18.3.0
Reason: branch workspace foundation residuals (precise console reason codes,
  workspace route layout guard) plus the stale root VERSION file
Evidence: org-console.tsx generic badge; workspace/server.ts reason vocabulary;
  VERSION file contained 2.18.1 while package.json reported 2.18.3
```

Release sequence applied to the detected base 2.18.3 (the spec sequence
assumed base 2.18.1; the same classification logic is applied to the
detected sequence, per the version rule):

| Seq | Classification | Version | Scope |
| --- | --- | --- | --- |
| 1 | CORRECTION | v2.18.3.0 | Findings 1, 7 residuals; VERSION file alignment |
| 2 | CORRECTION | v2.18.3.1 | Finding 12 detail (build-log scan patterns); start-script dual mode |
| 3 | CORRECTION | v2.18.3.2 | Findings 8/17/18/21/22 residuals (STK idempotency, USER_DELETE_BLOCKED audit, schema endpoint roles, heal rate limit) |
| 4 | CORRECTION | (verification only; no defect found) | Findings 13, 14 verified consistent |
| 5 | FEATURE | v2.18.4 | Finding 3 full diagnostics API + expert UI minimum |
| 6 | MAINTENANCE | bundled into v2.18.4 | Findings 15, 16, 19, 20, 23, 25 residuals |
| 7+ | FEATURE | v2.18.5 onward | Advanced expert modules (coverage matrix below) |

## Findings status (evidence-based)

| Finding | Status | Evidence |
| --- | --- | --- |
| 1. Console Workspace column | FIXED in v2.18.3.0 | org-console.tsx rendered the generic badge at line 340; reason codes existed only in workspace-gateway.tsx:214-258 and workspace/server.ts:68-86 |
| 2. Workspace-aware idempotent seed | IMPLEMENTED | prisma/seed.ts:279-359 upserts five stores (juja-main, thika, ruiru, nairobi-cbd, nakuru) with slug, subdomain, status ACTIVE |
| 3. Diagnostics API + expert info | PARTIAL -> v2.18.4 | src/app/api/org/ has summary + kpi-summary only; no expert-console route, no per-branch reason codes/remediation in API responses |
| 4. Host-aware link builder | IMPLEMENTED | src/lib/branch-workspace.ts: localhost/127.0.0.1/raw-IP path fallback (line 127 pre-refactor), reserved labels via workspace/config.ts:44-64 |
| 5. Server-side store context | IMPLEMENTED | src/lib/workspace/server.ts:196 resolveStoreContext; headers advisory only (comment lines 7-14); SecurityEvent audit 144-179 |
| 6. Proxy host rules | IMPLEMENTED | src/proxy.ts:282-284 allowlist (ALLOWED_HOSTS), reserved rejection config.ts:258, x-resolved-store-* headers proxy.ts:297-299,312 |
| 7. Workspace routes | IMPLEMENTED (catch-all) + layout added in v2.18.3.0 | src/app/stores/[slug]/[[...rest]]/page.tsx serves all tabs via the SPA shell; layout.tsx adds the placeholder-slug guard and server context |
| 8. API store scoping | IMPLEMENTED | src/lib/auth.ts:653 requireStoreAccess, assertStoreScope 459-500 (403 + SecurityEvent), withSessionAuth on customers/rentals/debt routes |
| 9. Staged updater | IMPLEMENTED | scripts/staged-update.mjs phases 77-86, staging 320-344, preflight-on-copy 361-366, rollback 249-304; updater/update-state.json state machine |
| 10. Safe schema repair | IMPLEMENTED | scripts/backup-db.mjs (verified copy), preflight-schema.mjs (copy + migrate diff), repair-branch-workspace-store-schema.mjs (raw SQL, sqlite_master 139-146, additive only); drift columns exist in schema.prisma (isEngraved 172, isSystem 173, idempotencyKey 393/522/629/684/979) |
| 11. Prisma config | IMPLEMENTED | prisma.config.ts:81-105; no package.json prisma block; prisma 6.19.2 pinned; scripts/verify-prisma-config.mjs |
| 12. Standalone opt-in | IMPLEMENTED; scan detail -> v2.18.3.1 | src/lib/build-mode.ts:40-53 (BUILD_STANDALONE, win32 ignored); verify-build-output.mjs scans EINVAL/traced-file failures but not "Cannot find module"/P2022 |
| 13. Canonical domain | IMPLEMENTED | prisma/seed.ts:44 CANONICAL_DEMO_DOMAIN mbumahhardware.co.ke (login domain) vs mbumah.co.ke (workspace root domain); decision recorded in docs/branch-manager-users.md |
| 14. README demo table | IMPLEMENTED | README.md:70-71 "| Role \| Email \| Password |" |
| 15. Logo assets | IMPLEMENTED | public/logo.svg + logo.png + logo.webp, src/app/icon.svg, src/app/favicon.ico, docs/BRAND.md |
| 16. README split | IMPLEMENTED | README.md 103 lines; docs/ has 38 documents + archive |
| 17. Engraved admin | IMPLEMENTED; audit action -> v2.18.3.2 | src/lib/engraved-admin.ts ensureEngravedAdminExists; users/[id] DELETE 403 ENGRAVED_ADMIN_PROTECTED (route.ts:56-65,266-268); soft delete logs USER_DEACTIVATED, no literal USER_DELETE_BLOCKED |
| 18. Health endpoints | IMPLEMENTED; role detail -> v2.18.3.2 | /api/health public safe (route.ts:226-245); /api/health/schema requireAuth (any signed-in role; spec wants SUPER_ADMIN/STORE_OWNER/trusted local only) |
| 19. Env templates | IMPLEMENTED | .env.example, .env.local-offline.example, .env.lan.example, .env.online.example; UPDATE_ON_START parsed by deploy/nodocker start scripts, disables remote check only (docs/staged-updates.md:48-50) |
| 20. Hosts helper | IMPLEMENTED | scripts/domains/print-hosts.mjs prints only (12-15); write-hosts.mjs is the separate explicit writer with backup + managed block |
| 21. M-Pesa callback | IMPLEMENTED; STK idempotency -> v2.18.3.2 | callback/route.ts: checkoutRequestId lookup 245-247, terminal-state gate 276-286, atomic claim 321-334, amount validation 290-312, branch from stored transaction 363/492; stkpush/route.ts has no idempotency key |
| 22. Security posture | IMPLEMENTED | next.config.ts:166-256 headers (HSTS, CSP, DENY, nosniff); rate-limit.ts in login + mpesa callback; brute-force lockout; CROSS_STORE_ACCESS_DENIED + SecurityEvent audit (auth.ts:391-407) |
| 23. Testing visibility | IMPLEMENTED; TEST_AUDIT_REPORT -> v2.18.4 | vitest configured, 25 test files, pretest prepare-test-db.mjs; docs/TEST_AUDIT_REPORT.md missing |
| 24. Invalid tag rejection | IMPLEMENTED | scripts/release/validate-tag.mjs:40-49 four-part needs valid three-part base; used by select-release.mjs:43,152,184 + deploy updaters |
| 25. Migration policy | PARTIAL -> v2.18.4 | prisma/migrations/ exists (4 migrations); db:push vs db:migrate:deploy split in package.json:24,30; docs/database-migration-policy.md missing |

## Extra findings from the baseline

| Item | Status | Evidence |
| --- | --- | --- |
| VERSION file stale (2.18.1 vs 2.18.3) | FIXED in v2.18.3.0 | no code reads VERSION; restored as the full-version surface |
| npm start assumes standalone output | -> v2.18.3.1 | package.json:14 start runs .next/standalone/server.js with no fallback; dual-mode exists only in deploy/nodocker/start-server.mjs:65-75 |
| abuse.ts noteDiscountSpam unused | accepted | lockout engine lives in auth.ts:878 noteDeniedAndMaybeLock; no behavior gap |
| release.yml does not run validate-tag | accepted | release.yml reads package.json and skips existing tags; validate-tag guards the updater path |

## Exit criteria (Phase 0)

1. Baseline documented: this file.
2. Current version known: 2.18.3 -> v2.18.3.0 next.
3. Store workspace fields status known: slug/subdomain nullable unique, status ACTIVE string, isActive exists on 12+ other models; Store uses status (deliberate lineage design, preserved).
4. Canonical domain evidence gathered: mbumahhardware.co.ke login domain, mbumah.co.ke workspace root domain, both documented.
5. No destructive action taken: no database commands run against any live database; work confined to a git worktree.
