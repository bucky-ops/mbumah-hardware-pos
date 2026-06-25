<!--
  Thank you for contributing to Mbumah Hardware POS! 🇰🇪

  Please fill out every section below. The "Mandatory Pre-Review Checklist" is
  REQUIRED — do not request review until every box is checked. Reviewers will
  reject PRs with unchecked mandatory boxes.

  For schema/DB changes, attach the migration name and confirm `bun run db:push`
  succeeds against your local Postgres (not just SQLite).

  For API route changes, confirm `export const dynamic = 'force-dynamic';` is
  present — this is critical for the Vercel build (see README troubleshooting).

  For financial/M-Pesa/ledger changes, attach screenshots of the audit-log
  entries produced by your new flow, and confirm the immutability guard on
  JournalEntry is preserved (see SECURITY.md §3).
-->

# Pull Request

## Description

<!-- A clear, concise description of WHAT this PR changes and WHY. Link the issue(s) it closes. -->

Fixes #(issue number)
Refs #(related issue / PR)

### What changed?

<!-- Bullet list of the key changes. Keep it scannable — reviewers should understand the shape of the PR in <60 seconds. -->

- 
- 
- 

### Why?

<!-- The motivation. What user pain or operational problem does this solve? If this is a bug fix, what was the root cause? -->

---

## Type of Change

<!-- Check all that apply. -->

- [ ] 🐛 Bug fix (non-breaking change which fixes an issue)
- [ ] ✨ New feature (non-breaking change which adds functionality)
- [ ] 💥 Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] ♻️ Refactor (code restructuring without changing external behavior)
- [ ] 📝 Documentation update
- [ ] 🗄️ Database migration / Prisma schema change
- [ ] 🚀 CI/CD / build / deployment change
- [ ] 🎨 UI / UX improvement
- [ ] ♿ Accessibility improvement
- [ ] 🔒 Security hardening
- [ ] ⚡ Performance improvement

---

## ✅ Mandatory Pre-Review Checklist

<!-- These 7 boxes are REQUIRED for every PR. Do not request review until all are checked. -->

- [ ] **Tested locally** — I ran `bun run dev` and manually verified the feature/fix works end-to-end (not just "it compiles"). I tested the happy path AND at least one error path.
- [ ] **Prisma migrations / `db push` included** — If this PR changes `prisma/schema.prisma`, I ran `bun run db:push` (or `bun run db:migrate --name <desc>`) and the change is reflected in the committed schema. (Check this box even if there were no schema changes — it confirms you considered the DB impact.)
- [ ] **No `any` types added** — I did not introduce any `any` types, `@ts-ignore`, or `@ts-expect-error` suppressions. TypeScript strict mode passes (`bun run build` succeeds with no type errors).
- [ ] **Multi-tenancy (`storeId`) verified** — Every new/modified database query is scoped by `storeId` (via the Prisma Client Extension's `runWithTenant()` or explicit `where: { storeId }`). No cross-store data leakage is possible. SUPER_ADMIN / cross-store flows explicitly opt out via `runWithoutTenant()`.
- [ ] **Added `export const dynamic = 'force-dynamic';` to any new API routes** — Every new/modified `src/app/api/**/route.ts` exports `dynamic = 'force-dynamic'` AND uses only named HTTP method exports (`export const GET`, `export const POST`, etc.) — NO default export. (Check this box even if the PR doesn't touch API routes — it confirms you considered the Vercel build implications.) This prevents Next.js from statically pre-rendering dynamic routes during `next build`, which would crash the Vercel build by triggering eager env validation when runtime secrets aren't injected.
- [ ] **Lint passes** — `bun run lint` exits with 0 errors and 0 warnings.
- [ ] **Tests pass** — `bun run test` exits 0 (if the PR touches test-covered code paths; if no tests exist for the changed code, note that in Additional Notes).

---

## 💥 Breaking Changes

<!-- If this PR introduces breaking changes, describe them and the migration path. If none, write "None". -->

- [ ] This PR introduces NO breaking changes.
- [ ] This PR introduces breaking changes (documented below).

### Breaking change details

<!-- For each breaking change: -->
<!-- 1. What breaks (API contract, DB schema, UI behavior, env var, etc.)? -->
<!-- 2. Who is affected (which roles, which stores, which integrations)? -->
<!-- 3. Migration path (what must downstream consumers / fork maintainers do?) -->
<!-- 4. Is there a feature flag or compatibility shim to ease the transition? -->

```text
// Example:
// GET /api/transactions no longer returns the deprecated `tax` field.
// Use `taxBreakdown.vat16` instead. The `tax` field has been removed
// because it conflated multiple tax types. Affected: any client calling
// /api/transactions and reading response[].tax. Migration: replace
// `.tax` with `.taxBreakdown.vat16` (a 1-line change). No shim — the
// field has been deprecated in the changelog since v0.3.0.
```

---

## 🗄️ Database Changes

<!-- If this PR includes Prisma schema changes, check the relevant boxes. -->

- [ ] No database changes
- [ ] Schema change — `bun run db:push` compatible (idempotent, no data migration needed)
- [ ] Schema change — migration included (`bun run db:migrate --name <desc>` run, `prisma/migrations/` committed)
- [ ] Data migration required (describe below)
- [ ] Seed data updated (`prisma/seed.ts` modified)

**Migration name**: _(if applicable)_

**Data migration plan** (if applicable):

```text
// For destructive or non-trivial migrations, describe the plan:
// 1. Back up production Neon DB
// 2. Run migration locally against a staging copy
// 3. Verify row counts before/after
// 4. Deploy during low-traffic window (Kenya evening, after 8pm EAT)
// 5. Roll back plan if needed
```

---

## 🧪 Testing

<!-- Describe the tests you ran to verify your changes. -->

- [ ] Manual testing in development (`bun run dev`)
- [ ] Unit tests pass (`bun run test`)
- [ ] Lint passes (`bun run lint`)
- [ ] Build succeeds (`bun run build`)
- [ ] API endpoint tested via curl / Postman / fetch
- [ ] Tested with SQLite (local dev default)
- [ ] Tested with PostgreSQL (Docker / CI / Neon preview DB)
- [ ] Tested in multiple browsers (Chrome + Firefox minimum)
- [ ] Tested on mobile viewport (375×667 minimum)
- [ ] Tested with the demo seeded data (5 stores, all 5 roles)

### Test Configuration

- **Node.js version**:
- **Bun version**:
- **Database**: SQLite / PostgreSQL
- **Browser(s) tested**:
- **OS**:

### Test Evidence

<!-- Paste screenshots / curl output / test logs demonstrating the fix works. -->

---

## 🇰🇪 Kenya-Specific Validation

<!-- If this PR touches payment, tax, or regulatory features, check the relevant boxes. -->

- [ ] N/A — this PR does not touch payment, tax, or regulatory features.
- [ ] KRA tax calculations correct (VAT 16% / Zero-Rated / Exempt preserved)
- [ ] M-Pesa STK Push flow works (sandbox credentials)
- [ ] M-Pesa callback handling is idempotent (no double-confirm on retry)
- [ ] KES currency formatting preserved (no accidental USD/EUR defaults)
- [ ] Receipt format compliant (tax breakdown, KRA PIN, sequential invoice number)
- [ ] Financial ledger immutability preserved — no edits/deletes to posted `JournalEntry` records (the Prisma Client Extension guard in `src/lib/db.ts` is intact; any mutations go through `withImmutabilityBypass(fn, reason)`)
- [ ] eTIMS-ready invoice fields preserved on `Transaction`

---

## 📸 Screenshots / Screen Recordings

<!-- For UI changes, drag screenshots here. For complex flows, attach a short screen recording. -->

**Before:**

**After:**

---

## 📝 Additional Notes

<!-- Anything else reviewers should know? Performance implications, design trade-offs, follow-up work, etc. -->

---

## 🔍 Reviewer Notes

<!-- For the reviewer — do not fill in. -->

- [ ] Code review passed
- [ ] Mandatory checklist verified
- [ ] Breaking changes (if any) have a documented migration path
- [ ] DB changes (if any) have a documented rollback plan
- [ ] Kenya-specific validation (if applicable) signed off
- [ ] Ready to merge

---

**By opening this PR, I confirm that:**
- I have read the [Contributor Covenant Code of Conduct](../CODE_OF_CONDUCT.md).
- I have read the [Security Policy](../SECURITY.md) and have NOT introduced any hardcoded secrets, credentials, or M-Pesa passkeys.
- This PR is my own original work (or properly attributed) and is licensed under the MIT License.
