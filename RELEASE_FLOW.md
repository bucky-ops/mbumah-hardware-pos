# Release Flow — Mbumah Hardware POS

**Rule: every change that reaches `main` ships under a new version. No exceptions, no drift.**

The version lives in ONE place: **`package.json` → `"version"`** (semver `MAJOR.MINOR.PATCH`).
Everything else reads from it:

| Artifact | Where the version comes from |
| --- | --- |
| `/api/health` response | imports `package.json` (`src/app/api/health/route.ts`) |
| App footer badge | imports `APP_VERSION_LABEL` from `src/lib/version.ts` → `package.json` |
| OpenAPI document | `src/lib/openapi.ts` `info.version` (mirror `package.json`) |
| Git tag / GitHub Release | `v<version>` cut from the merge commit |

> History: the footer used to hardcode `v2.2.0` while the API reported 2.5.0 —
> fixed in v2.5.1 by rendering `package.json` everywhere.

## 1. Choose the bump type

- **PATCH** (2.5.0 → 2.5.1) — bug fixes only: crashes, wrong numbers, security patches, regressions.
- **MINOR** (2.5.0 → 2.6.0) — new backward-compatible features (new screens, new endpoints, new report types).
- **MAJOR** (2.x → 3.0.0) — breaking changes (schema migrations that drop data, API contract breaks, auth overhauls).

## 2. Standard flow (every PR)

```bash
# 1. branch off the latest main
git checkout main && git pull origin main
git checkout -b feat/my-feature        # or fix/my-fix

# 2. bump version BEFORE the PR (one line)
#    package.json -> "version": "X.Y.Z"
#    src/lib/openapi.ts -> version: 'X.Y.Z'

# 3. verify locally
bun run lint
bun run test            # all green — CI runs the same suite

# 4. push and open a PR
git add -A && git commit -m "feat|fix vX.Y.Z: summary"
git push -u origin feat/my-feature
```

## 3. Merge & verify

1. Wait for **both CI checks** (Build + Test) on the PR → squash-merge.
   (Known flake: SQLite socket-timeout in CI → "Re-run failed jobs" is acceptable.)
2. Vercel auto-deploys `main`. Verify:
   - Commit status on the merge commit = ✅ (Vercel)
   - `GET /api/health` → `"version": "X.Y.Z"` and `status: healthy`
3. Browser check the golden path (login → POS → the touched area).

## 4. Tag & publish the GitHub Release

```bash
git checkout main && git pull origin main
git tag -a vX.Y.Z -m "vX.Y.Z — <one-line summary>"
git push origin vX.Y.Z
```

Then create the GitHub Release for the tag (mark it *latest*) with:
- what changed (user language),
- fixes with before/after evidence,
- any data repairs that were run and their audit reference.

## 5. Data repairs (when a bug corrupted production data)

If a bug wrote wrong numbers to the database:
1. Ship the code fix (steps 2–4).
2. Use a guarded, audited admin endpoint (e.g. `POST /api/admin/repair-journal-headers`,
   SUPER_ADMIN-only, dry-run first) — never hand-edit rows.
3. Verify with read-only API probes after the repair.
4. Record what was repaired in the release notes.

## Checklist (copy into the PR description)

- [ ] `package.json` + `src/lib/openapi.ts` version bumped
- [ ] `bun run lint` clean, tests green
- [ ] Golden-path browser check done on the deployed preview/production
- [ ] `/api/health` reports the new version after deploy
- [ ] Tag `vX.Y.Z` pushed + GitHub Release published (latest)
- [ ] Data repair executed + verified (only if applicable)
