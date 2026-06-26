# Contributing to Mbumah Hardware POS

Thank you for contributing to **Mbumah Hardware POS & ERP**! This document
defines the workflow, code style, and review process for all changes —
especially for the **v2.0.0** development cycle.

---

## 1. Branching & Pull Request Workflow

### Branch Strategy

```
main              ← production-ready, protected, only receives PRs from v2.0.0-dev
  └── v2.0.0-dev  ← integration branch for v2.0.0; all feature PRs target this
        ├── feat/etims-integration
        ├── feat/responsive-sidebar
        ├── fix/dashboard-auth-headers
        └── ...
```

| Branch           | Purpose                                      | Can push directly? |
| ---------------- | -------------------------------------------- | ------------------ |
| `main`           | Production release branch                     | **No** — PR only   |
| `v2.0.0-dev`     | v2.0.0 integration / staging                  | **No** — PR only   |
| `feat/*`         | New features                                  | Yes (your own)     |
| `fix/*`          | Bug fixes                                     | Yes (your own)     |
| `chore/*`        | Tooling, deps, refactors (no behavior change) | Yes (your own)     |
| `docs/*`         | Documentation only                            | Yes (your own)     |

### Branch Protection Rules (configured on GitHub)

**`main`:**
- ✅ Require a pull request before merging
- ✅ Require at least **1 approving review**
- ✅ Require status checks to pass before merging (CI lint + build)
- ✅ Require branches to be up to date before merging
- ✅ Restrict direct pushes that bypass a pull request
- ✅ Restrict force pushes

**`v2.0.0-dev`:**
- ✅ Require a pull request before merging
- ✅ Require at least **1 approving review**
- ✅ Require status checks to pass (CI lint)
- ⚠️ Force pushes allowed (for rebasing feature branches)

### PR Lifecycle

1. **Create a feature branch** from `v2.0.0-dev`:
   ```bash
   git checkout v2.0.0-dev
   git pull origin v2.0.0-dev
   git checkout -b feat/etims-integration
   ```

2. **Develop & commit** using [Conventional Commits](#3-commit-messages).

3. **Self-review** — run `bun run lint` locally; ensure zero warnings.

4. **Open a PR** against `v2.0.0-dev` (not `main`):
   ```bash
   git push -u origin feat/etims-integration
   # Open PR on GitHub: base = v2.0.0-dev
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

7. **Merge** — squash-and-merge into `v2.0.0-dev`.

8. **Release to `main`** — when `v2.0.0-dev` is stable and all milestones are
   met, open a final PR: `v2.0.0-dev` → `main`. This triggers the Vercel
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
