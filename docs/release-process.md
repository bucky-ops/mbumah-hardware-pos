# Release process

Rule: every change that reaches `main` ships under a new version. No exceptions.

The version lives in one place: `package.json`, field `"version"` (semver `MAJOR.MINOR.PATCH`). Everything else reads from it:

| Artifact | Where the version comes from |
|----------|------------------------------|
| `/api/health` response | imports `package.json` (`src/app/api/health/route.ts`) |
| App footer badge | imports `APP_VERSION_LABEL` from `src/lib/version.ts` (from `package.json`) |
| OpenAPI document | `src/lib/openapi.ts` `info.version` (mirrors `package.json`) |
| Git tag and GitHub Release | `v<version>` cut from the merge commit |

> History: the footer used to hardcode `v2.2.0` while the API reported 2.5.0. This was fixed in v2.5.1 by rendering `package.json` everywhere.

## 1. Choose the bump type

- **PATCH** (2.5.0 to 2.5.1): bug fixes only. Crashes, wrong numbers, security patches, regressions.
- **MINOR** (2.5.0 to 2.6.0): new backward-compatible features (new screens, new endpoints, new report types).
- **MAJOR** (2.x to 3.0.0): breaking changes (schema migrations that drop data, API contract breaks, auth overhauls).

## 2. Standard flow (every PR)

```bash
# 1. Branch off the latest main
git checkout main && git pull origin main
git checkout -b feat/my-feature        # or fix/my-fix

# 2. Bump the version BEFORE the PR (one line)
#    package.json -> "version": "X.Y.Z"
#    src/lib/openapi.ts -> version: 'X.Y.Z'

# 3. Verify locally
bun run lint
bun run test            # all green; CI runs the same suite

# 4. Push and open a PR
git add -A && git commit -m "feat|fix vX.Y.Z: summary"
git push -u origin feat/my-feature
```

## 3. Merge and verify

1. Wait for both CI checks (Build and Test) on the PR, then squash-merge. (Known flake: SQLite socket timeout in CI; "Re-run failed jobs" is acceptable.)
2. Vercel auto-deploys `main`. Verify:
   - The commit status on the merge commit is successful (Vercel).
   - `GET /api/health` returns `"version": "X.Y.Z"` and `status: healthy`.
3. Browser-check the golden path (login, POS, and the area the PR touched).

## 4. Tag and publish the GitHub Release (automatic since v2.6.2)

This step is automated. `.github/workflows/release.yml` runs on every push to `main` and:

1. Reads the version from `package.json` (single source of truth).
2. If the tag `vX.Y.Z` does not exist yet, pushes the annotated tag from the merge commit and publishes the GitHub Release (marked latest, with auto-generated notes from the commits since the previous tag).
3. If the tag already exists, exits as a no-op (ordinary merges without a version bump release nothing).

This machinery exists because manual tagging was forgotten twice: v2.5.8 and v2.6.1 both reached production before a release was cut. The workflow makes the guarantee physical: every version on `main` has a release page.

Release notes still benefit from a human touch: after the automatic release appears, you may edit the release body to add user-language highlights, before-and-after evidence, or data-repair references.

## 5. Data repairs (when a bug corrupted production data)

If a bug wrote wrong numbers to the database:

1. Ship the code fix (steps 2 to 4).
2. Use a guarded, audited admin endpoint (for example `POST /api/admin/repair-journal-headers`, SUPER_ADMIN-only, dry-run first). Never hand-edit rows.
3. Verify with read-only API probes after the repair.
4. Record what was repaired in the release notes.

## Checklist (copy into the PR description)

- [ ] `package.json` version bumped (`src/lib/openapi.ts` mirrors it automatically since v2.6.2; never edit the spec version by hand)
- [ ] `bun run lint` clean, tests green
- [ ] Golden-path browser check done on the deployed preview or production
- [ ] `/api/health` reports the new version after deploy
- [ ] Tag `vX.Y.Z` and GitHub Release created automatically by `release.yml` after merge (verify it exists; no manual tagging)
- [ ] Footer and login screen show `vX.Y.Z · <sha>` on production
- [ ] Data repair executed and verified (only if applicable)
