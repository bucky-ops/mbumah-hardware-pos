# Release versioning

The version vocabulary for this repository: where versions live, which shapes are valid, and the decisions that must be made before any release work starts. The standard release flow is in [Release process](release-process.md); how the updaters consume these versions is in [Updater release channels](updater-release-channels.md).

## Version shapes

| Shape | Meaning | Examples |
|-------|---------|----------|
| Three-part `X.Y.Z` | Normal feature and patch releases | `2.17.7`, `2.18.0` |
| Four-part `X.Y.Z.N` | Correction hotfixes UNDER an existing base release only, hotfix number `.0` through `.5` | `2.18.0.0`, `2.18.0.1` |
| Any prerelease or floating suffix | NOT used in this project | `2.18.1-rc.1`, `2.18.1+build`, `alpha`, `beta`, `rc`, `preview`, `latest` are all rejected |

Rules enforced by [scripts/release/parse-version.mjs](../scripts/release/parse-version.mjs) and [scripts/release/validate-tag.mjs](../scripts/release/validate-tag.mjs):

- A four-part tag is valid ONLY while its three-part base tag `vX.Y.Z` exists. `v2.18.0.0` is valid because `v2.18.0` exists; `v2.19.0.0` without `v2.19.0` is invalid, is ignored, and is reported with that reason.
- A hotfix `.0` compares equal to its base version, so `2.18.0` and `2.18.0.0` are the same release level for update decisions.
- Hotfix numbers above `.5` are rejected. If a base needs more than five corrections, ship the next three-part release instead.

## Version sources and precedence

| Source | Content | Notes |
|--------|---------|-------|
| `VERSION` file (repo root) | The full release version, e.g. `2.18.0.1` | Plain text, read by tooling that cannot parse JSON |
| `package.json` `"version"` | Three-part semver ONLY (`2.18.0`) | Stays valid semver on every release, including hotfixes |
| `package.json` `"mbumah"` block | `releaseVersion` (full four-part version), `baseVersion`, `hotfix` number | Set on correction releases; carries the part semver cannot express |
| Git tags | `v<full version>` (`v2.18.0`, `v2.18.0.1`) | Cut automatically by `release.yml` from the merge commit |
| GitHub releases | One per tag; drafts and prereleases are never used by the updater | The updater validates tags before selecting them |
| Updater state | The version a machine currently runs (`currentVersion` in the update state file) | Machine-local truth; see [Updater release channels](updater-release-channels.md) |
| Runtime version | `/api/health`, footer and login badge, `openapi.json` | Read from `package.json`; correction releases surface the four-part label via the `mbumah` metadata |

The comparison rule that makes correction releases work: whenever a script compares an installed version against a release tag, it uses `mbumah.releaseVersion` when present (falling back to `"version"`). Comparing the three-part `"version"` against a four-part tag never matches, which is exactly the defect that made a machine rebuild v2.18.0.0 on every start before v2.18.0.1 fixed it.

## How release.yml picks the version

`.github/workflows/release.yml` reads the version from `package.json` with the same precedence:

```bash
VERSION=$(node -p "const p = require('./package.json'); (p.mbumah && p.mbumah.releaseVersion) || p.version")
```

- `package.json` `"version"` stays three-part semver; `mbumah.releaseVersion` carries the full four-part version on correction releases.
- If the tag `v<VERSION>` does not exist yet, the workflow pushes the annotated tag from the merge commit and publishes the GitHub Release.
- If the tag already exists, the workflow exits as a no-op (ordinary merges without a version bump release nothing).

## The version decision block

Before ANY release work starts (bumping files, tagging, publishing), decide and print the version decision. Every release session produces this block first:

```text
Detected version:        2.18.0.1  (from package.json mbumah.releaseVersion)
Valid base version:      2.18.0    (three-part base tag v2.18.0 exists)
Hotfix number:           1         (next free hotfix for this base: .2)
Change classification:   correction (fix to a defect in the 2.18.0 line)
Proposed next version:   2.18.0.2  (or 2.18.1 for a normal patch release)
Reason:                  why this shape was chosen for this change set
```

The classification rule of thumb:

- A fix for a defect in the version a fleet of machines already runs, shipped ahead of the next normal release: four-part hotfix (`2.18.0.N`).
- Anything else (features, schema changes, planned patch work): three-part release (`2.18.1`, `2.19.0`).
- If the hotfix counter for a base would exceed `.5`, or the fixes accumulate beyond a correction: fold them into the next three-part release.

## Tag rules

- Never skip a tag. Every released version has exactly one `v`-tag and one GitHub Release (the guarantee `release.yml` enforces since v2.6.2).
- Never reuse a tag. A tag points at the exact merge commit that shipped it; re-pointing it would make machines that installed the old build indistinguishable from machines on the new one.
- Never move a tag. If a release is broken, ship a new version (hotfix or patch); the updater's rollback exists for the machines, not for the tag history.
- Tags are cut automatically. Manual tagging is the fallback of last resort and must reproduce the same version sources.

## Related

- [Release process](release-process.md): the standard bump, merge and publish flow
- [Updater release channels](updater-release-channels.md): how machines select releases by channel
- [Prisma config](prisma-config.md): the version policy for the Prisma dependency (stable 6.x only)
