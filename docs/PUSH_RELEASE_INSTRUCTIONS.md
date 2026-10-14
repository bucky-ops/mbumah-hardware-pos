# Push Release Instructions — v2.18.2 / v2.18.2.1 (Organization Console)

> **Why this file exists:** the v2.18.2 + v2.18.2.1 release work was built and QA-certified in the
> cloud sandbox (`/home/z/my-project`), which has **no GitHub credentials** and a **template-rooted
> git lineage** (the sandbox git history starts from a Next.js template "Initial commit", not from
> the production repo's 282-commit ancestry). The release therefore cannot be pushed to
> `main` — or to the `v2.18.2` / `v2.18.2.1` tags on the shared tag namespace — from the sandbox
> without decisions that belong to the owner. This document contains everything needed to ship it.

## 1. What is ready

| Artifact | Where | State |
|---|---|---|
| Release commit (FEATURE v2.18.2) | `4de987b` | tagged `v2.18.2` (local) |
| Release commit (CORRECTION v2.18.2.1) | `c1e7ecf` | tagged `v2.18.2.1` (local) |
| Full QA | `docs/TEST_AUDIT_REPORT_v2.18.x.{md,json}` | 25/25 E2E + 14/14 re-check PASS |
| Git bundle (offline transport) | `download/mbumah-v2.18.2.1-release.bundle` | main + both tags |

> **History scrubbed before handoff:** the sandbox lineage originally tracked `.env`,
> `.github-token`, `.neon-token`, `.vercel-usage-token`, `db/stress.db` (122 MB), `db/custom.db`,
> `upload/` and a script containing an embedded token (`scripts/fix_malnutrition_build.py`).
> The entire lineage was rewritten with `git filter-branch` to drop them from **every** commit
> (verified: 0 hits across `8dc005f..main`; blob store pruned). Hashes above are the
> post-scrub values. Pre-rewrite copies of the runtime files live in `/home/z/release-backup/`
> (outside the repo, never commit them). `.gitignore` now forbids all of these paths.

## 2. ⚠️ Integration risk — read before merging to main

The sandbox release is a **self-consistent parallel implementation** that diverges from
`origin/main` (e49f48e, v2.18.1) at the data-model level:

| | origin/main (v2.18.1) | sandbox release (v2.18.2.1) |
|---|---|---|
| Branch model | `Store` (+ `StoreMembership`) | `Branch` (slug/subdomain/town/brandColor) |
| Transaction model | `SalesTransaction` / `SaleItem` | `Transaction` / `TransactionItem` |
| Prisma schema | 88 models, PostgreSQL-canonical + provider-flip script | 43 models, SQLite-native |
| Auth | `src/lib/auth.ts` (1,226 lines) + Session model | scrypt sessions, `User.passwordHash` nullable |
| src/lib/db.ts | 758 lines | 12 lines |

Merging to `main` therefore requires a **re-platforming pass** (re-target the ~20 new API routes
and the org console from `Branch`→`Store`, real auth, 88-model schema) — do **not** fast-forward
`main` to this lineage. Treat the branch as the source of truth for the console *product work*.

## 3. Ship path A — publish the release branch (safe, no history changes)

From any machine with push rights to `bucky-ops/mbumah-hardware-pos`:

```bash
# Import from the bundle (if not pushing from the sandbox clone directly):
git clone https://github.com/bucky-ops/mbumah-hardware-pos.git mbumah-ship && cd mbumah-ship
git fetch /path/to/mbumah-v2.18.2.1-release.bundle \
  'refs/heads/main:refs/heads/sandbox-release' \
  'refs/tags/v2.18.2:refs/tags/sandbox/v2.18.2' \
  'refs/tags/v2.18.2.1:refs/tags/sandbox/v2.18.2.1'

# Publish as a review branch (new ref — never force, never touches main/tags):
git push origin sandbox-release:refs/heads/release/v2.18.2.1-org-console

# Optionally publish the tags under a namespace-safe prefix (NOT bare v2.18.2* —
# the Windows updater selects releases by tag semver and must not see
# sandbox-rooted tags until the lineage is reconciled):
git push origin refs/tags/sandbox/v2.18.2 refs/tags/sandbox/v2.18.2.1
```

## 4. Ship path B — push directly from this sandbox (if the owner provides a token)

```bash
cd /home/z/my-project
export GH_TOKEN=<owner-provided-token>          # fine-grained: contents:write on the repo
git remote set-url origin "https://x-access-token:${GH_TOKEN}@github.com/bucky-ops/mbumah-hardware-pos.git"
git push origin main:refs/heads/release/v2.18.2.1-org-console
git push origin refs/tags/v2.18.2 refs/tags/v2.18.2.1   # only after lineage decision (§2/§3)
git remote set-url origin https://github.com/bucky-ops/mbumah-hardware-pos.git  # scrub token
```

## 5. Reconciliation checklist (before this becomes the real v2.18.2.1)

- [ ] Re-target new API routes + console components: `Branch`→`Store`, real `SalesTransaction`
- [ ] Port the 18 expert-module models into the 88-model PostgreSQL schema (with `@db.Decimal`)
- [ ] Wire console auth into the real `src/lib/auth.ts` (Session model) instead of scrypt standalone
- [ ] Reconcile `src/proxy.ts` (origin 440-line version is authoritative; fold in subdomain rewrite)
- [ ] Re-run `docs/TEST_AUDIT_REPORT_v2.18.x.md` acceptance numbers against the reconciled schema
- [ ] Only then tag the reconciled commit `v2.18.3` (or `v2.18.2` on main lineage) for the updater

## 6. Execution record — Ship path B executed (2026-10-14)

Executed with the owner-provided token (fine-grained PAT, admin/maintain/push verified via API).
Token used ephemerally in the remote URL and scrubbed from `.git/config` immediately after push;
stored only outside the repo (`/home/z/release-backup/`, 0600). **Never commit tokens.**

| Action | Result |
|---|---|
| `main` → `refs/heads/release/v2.18.2.1-org-console` | ✅ new branch (tip `9999925` + docs record commit) |
| `v2.18.2` → `refs/tags/sandbox/v2.18.2` | ✅ annotated, namespace-safe |
| `v2.18.2.1` → `refs/tags/sandbox/v2.18.2.1` | ✅ annotated, namespace-safe |
| GitHub Release on `sandbox/v2.18.2.1` | ✅ **prerelease** — updater cannot select it |
| Release asset | ✅ `mbumah-v2.18.2.1-release.bundle` (20.1 MB, complete history) |
| Bare tags `v2.18.2*` on remote | ⛔ intentionally withheld (§3 updater guardrail) until reconciliation (§5) |

Release: `https://github.com/bucky-ops/mbumah-hardware-pos/releases/tag/sandbox/v2.18.2.1`
