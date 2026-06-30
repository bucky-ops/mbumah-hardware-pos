# Contributing to Mbumah Hardware POS

Thank you for contributing to **Mbumah Hardware POS & ERP**! This document
defines the workflow, code style, and review process for all changes —
especially for the **v2.0.0** development cycle.

---

## 1. Branching & Pull Request Workflow

### Branch Strategy

```
main              ← production-ready, protected
  └── develop     ← integration branch; all feature PRs target this
        ├── feat/etims-integration
        ├── feat/responsive-sidebar
        ├── fix/dashboard-auth-headers
        └── ...
  └── hotfix/critical-payment-bug  ← urgent fixes from main
```

| Branch           | Purpose                                                | Can push directly? |
| ---------------- | ------------------------------------------------------ | ------------------ |
| `main`           | Production release branch                               | **No** — PR only   |
| `develop`        | Integration / staging                                   | **No** — PR only   |
| `feat/*`         | New features                                            | Yes (your own)     |
| `fix/*`          | Bug fixes                                               | Yes (your own)     |
| `hotfix/*`       | Urgent production fixes (branched from main)            | Yes (your own)     |
| `chore/*`        | Tooling, deps, refactors (no behavior change)           | Yes (your own)     |
| `docs/*`         | Documentation only                                      | Yes (your own)     |

### Branch Protection Rules (configured on GitHub)

**`main`:**
- ✅ Require a pull request before merging
- ✅ Require at least **1 approving review**
- ✅ Require status checks to pass before merging (CI lint + build)
- ✅ Require branches to be up to date before merging
- ✅ Restrict direct pushes that bypass a pull request
- ✅ Restrict force pushes

**`develop`:**
- ✅ Require a pull request before merging
- ✅ Require at least **1 approving review**
- ✅ Require status checks to pass (CI lint)
- ⚠️ Force pushes allowed (for rebasing feature branches)

### Hotfix Workflow

Hotfix branches address urgent production bugs:

1. **Branch from `main`** (not `develop`):
   ```bash
   git checkout main
   git pull origin main
   git checkout -b hotfix/critical-payment-bug
   ```
2. **Apply the fix** and commit using `fix(scope): ...` convention.
3. **Open PRs to BOTH `main` and `develop`** — the fix must reach
   production and the integration branch:
   ```bash
   git push -u origin hotfix/critical-payment-bug
   # Open PR 1: base = main
   # Open PR 2: base = develop
   ```
4. After both PRs are merged, delete the hotfix branch.

### PR Lifecycle

1. **Create a feature branch** from `develop`:
   ```bash
   git checkout develop
   git pull origin develop
   git checkout -b feat/etims-integration
   ```

2. **Develop & commit** using [Conventional Commits](#3-commit-messages).

3. **Self-review** — run `bun run lint` locally; ensure zero warnings.

4. **Open a PR** against `develop` (not `main`):
   ```bash
   git push -u origin feat/etims-integration
   # Open PR on GitHub: base = develop
   ```

5. **PR template** — fill in:
   - **Summary** of changes
   - **Related issue** (e.g., `Closes #42`)
   - **Screenshots** (for UI changes)
   - **Testing** — how you verified (agent-browser steps, manual flows)
   - **Checklist** — lint passes, no console errors, docs updated

6. **Review** — at least 1 approval required. Reviewers check:
   - Code quality & adherence to stack (Next.js 16, TypeScript, shadcn/ui)
   - RBAC correctness (if touching auth/API routes)
   - Database changes (Prisma schema + `bun run db:push`)
   - No secrets / hardcoded credentials

7. **Merge** — squash-and-merge into `develop`.

8. **Release to `main`** — when `develop` is stable and all milestones are
   met, open a final PR: `develop` → `main`. This triggers the Vercel
   production deployment.

---

## 2. Code Style

### Stack (non-negotiable)

| Layer         | Technology                                     |
| ------------- | ---------------------------------------------- |
| Framework     | Next.js 16 (App Router)                         |
| Language      | TypeScript 5 (strict)                           |
| Styling       | Tailwind CSS 4 + shadcn/ui (New York)           |
| Database      | Prisma ORM (SQLite dev / Neon Postgres prod)    |
| State         | Zustand (client) + TanStack Query (server)      |
| Icons         | lucide-react                                    |
| Auth          | JWT in `localStorage.mbt_token` + CSRF cookie   |

### Rules

- **TypeScript everywhere** — no `any` without a justification comment.
- **`'use client'` / `'use server'`** directives on every component/route.
- **shadcn/ui components preferred** over custom implementations. Check
  `src/components/ui/` before building new primitives.
- **API routes** — every protected route uses `requireAuth()` (or relies on
  `src/middleware.ts` global Bearer-token enforcement). Never write a raw
  `fetch()` to a protected endpoint without the `Authorization` header — use
  the `api.ts` client or an `authedFetch` helper.
- **Prisma** — schema in `prisma/schema.prisma`; access via
  `import { db } from '@/lib/db'`. After schema changes, run
  `bun run db:push`.
- **No indigo/blue colors** unless explicitly requested.
- **Responsive** — mobile-first; test at 375px, 768px, 1280px.
- **Sticky footer** — if a `footer` exists, use
  `min-h-screen flex flex-col` + `mt-auto` on the footer.

### ESLint & Formatting

```bash
bun run lint     # must pass with 0 errors, 0 warnings
```

Configuration lives in `eslint.config.mjs` and `.prettierrc` (if present).
Do not disable rules inline without a comment explaining why.

---

## 3. Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

| Type       | When to use                                    |
| ---------- | ---------------------------------------------- |
| `feat`     | New feature                                    |
| `fix`      | Bug fix                                        |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf`     | Performance improvement                        |
| `chore`    | Build, deps, tooling, CI                       |
| `docs`     | Documentation only                             |
| `style`    | Formatting, whitespace, semicolons (no logic)  |
| `test`     | Adding or fixing tests                         |

### Scopes (common)

`etims`, `pos`, `inventory`, `rentals`, `payroll`, `finance`, `reports`,
`customers`, `suppliers`, `auth`, `ui`, `db`, `api`

### Examples

```
feat(etims): add KRA invoice submission endpoint

Implements POST /api/kra/submission that maps SalesTransaction data to
the KRA eTIMS invoice format and submits via the kra-helpers module.
Includes retry logic and status polling.

Closes #18
```

```
fix(dashboard): add Authorization header to trends fetch

fetchDashboardTrends used a raw fetch() without the Bearer token,
causing 401s that silently fell back to "No forecast data yet".
Added authedFetch helper mirroring api.ts auth logic.
```

```
chore(deps): bump prisma to 6.4.1
```

---

## 4. Database Changes

1. Edit `prisma/schema.prisma`.
2. Run `bun run db:push` to apply to local SQLite.
3. Update `prisma/seed.ts` if new seed data is needed.
4. Document any migration notes in the PR description.
5. For production (Neon Postgres), the deploy script handles `db:push`
   automatically — but call it out in the PR if schema changed.

---

## 5. Testing & QA

Every PR must be verified before merging:

```bash
bun run lint              # 0 errors, 0 warnings
bun run dev               # server starts on :3000
```

Then use **agent-browser** for end-to-end verification:

```bash
agent-browser open http://localhost:3000
agent-browser snapshot    # verify page renders, no blank screen
# Click through the feature you changed; check dev.log for 500s
```

**Checklist before requesting review:**
- [ ] `bun run lint` passes clean
- [ ] Dev server starts without errors in `dev.log`
- [ ] agent-browser confirms the changed feature renders and is interactive
- [ ] No new 401/500 errors in the browser console or `dev.log`
- [ ] Responsive layout holds at mobile + desktop widths
- [ ] RBAC still enforced (if touching auth or API routes)
- [ ] Dark mode still looks correct (if touching UI)

---

## 6. Git Hooks (recommended)

Consider adding a pre-commit hook:

```bash
#!/bin/sh
bun run lint || exit 1
```

---

## 7. Questions?

- **Architecture decisions** — see `PROJECT_PLAN_V2.md`.
- **Audit status** — see the Phase 2 checklist in `PROJECT_PLAN_V2.md`.
- **Worklog** — `/home/z/my-project/worklog.md` contains the full development
  history and handover notes.

---

## 8. Deployment Troubleshooting

### Vercel "Loading..." White Screen

If the Vercel deployment shows a permanent "Loading..." screen:

1. **Check browser console** for `X.map is not a function` errors — this means
   an API response field expected to be an array is `undefined`/`null`.
2. **Ensure `Array.isArray()` guards** are in every `useQuery` `queryFn` that
   receives array data from the dashboard API.
3. **Check ErrorBoundary behavior** — if the error overlay is dismissed and
   children re-render, the same crash recurs, React unmounts the tree, and
   the server-rendered "Loading..." HTML persists. The ErrorBoundary must
   render a safe fallback when `dismissed=true`.
4. **Verify environment variables** in Vercel Dashboard → Settings →
   Environment Variables: `DATABASE_URL` (Neon pooled connection string),
   `JWT_SECRET`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`.
5. **Check Prisma provider** — the `scripts/setup-prisma-provider.mjs` script
   must detect `postgresql://` in `DATABASE_URL` and set the schema provider
   to `postgresql` (not `sqlite`). The `vercel-build` script in `package.json`
   runs this automatically.
6. **Force-dynamic API routes** — every `src/app/api/**/route.ts` must export
   `dynamic = 'force-dynamic'` to prevent static pre-rendering during build.

### Vercel Build Failures

- `P1003 table does not exist`: Run `npx prisma db push` against the production
  `DATABASE_URL` to create the schema.
- `P1001 connection lost`: Verify `DATABASE_URL` uses the Neon **pooled**
  connection string (hostname ends in `-pooler.neon.tech`).
- `NEXTAUTH_URL` error: Ensure it matches the Vercel deployment URL exactly.

### Database Connection Pooling

Serverless functions (Vercel) open a new connection per invocation. You MUST use
the **pooled** PgBouncer connection string from Neon/Supabase:

- Neon: append `-pooler` to hostname + `?pgbouncer=true&connection_limit=1`
- Supabase: use port 6543 (Transaction pooler)

---

## 9. Security

### Required Secrets (GitHub + Vercel)

| Secret              | Where   | Purpose                                              |
| ------------------- | ------- | ---------------------------------------------------- |
| `DATABASE_URL`      | Vercel  | Neon/Supabase pooled connection string               |
| `DIRECT_URL`        | Vercel  | Neon/Supabase direct connection (migrations)         |
| `JWT_SECRET`        | Vercel  | Signs auth tokens (`openssl rand -base64 32`)        |
| `NEXTAUTH_SECRET`   | Vercel  | Signs NextAuth sessions                              |
| `NEXTAUTH_URL`      | Vercel  | Canonical app URL (e.g. `https://mbumah-pos.vercel.app`) |
| `VERCEL_TOKEN`      | GitHub  | Vercel deployment from CI                            |
| `VERCEL_ORG_ID`     | GitHub  | Vercel organization                                  |
| `VERCEL_PROJECT_ID` | GitHub  | Vercel project                                       |

### Security Checklist (every PR)

- [ ] No hardcoded secrets, API keys, or M-Pesa passkeys
- [ ] New API routes use `requireAuth()` or `withErrorBoundary()`
- [ ] Financial model mutations go through `withImmutabilityBypass(fn, reason)`
- [ ] Multi-tenancy enforced (every query scoped by `storeId`)
- [ ] CSRF token sent on state-changing requests (POST/PUT/DELETE)
- [ ] Rate limiting applied on auth endpoints
- [ ] Input validation via Zod schemas (`validateInput()`)
