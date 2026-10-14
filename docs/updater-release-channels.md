# Updater release channels

How the self-hosted updaters ([deploy/nodocker/update-pos.ps1](../deploy/nodocker/update-pos.ps1) and [update-pos.sh](../deploy/nodocker/update-pos.sh)) decide WHICH GitHub release to install. Since v2.18.0.2 the decision goes through a validated selector ([scripts/release/select-release.mjs](../scripts/release/select-release.mjs)) instead of the old blind "releases/latest" lookup, which returned four-part correction tags as if they were the next normal release. That defect is what updated a machine on 2.17.7 straight to v2.18.0.0 in the field; the selector makes that impossible.

Version rules (three-part versus four-part) are defined in [Release versioning](release-versioning.md).

## Channels

The channel comes from the `UPDATE_CHANNEL` variable (environment or `.env`), defaulting to `stable`. Unknown values fall back to `stable` with a warning.

| Channel | Selects | Use when |
|---------|---------|----------|
| `stable` (default) | The latest valid THREE-part release only | Normal shop machines |
| `hotfix` | The latest valid three-part release, OR the latest valid four-part hotfix for the CURRENT version's base, whichever is higher | Machines that should receive correction releases for the version they already run |
| `manual` | The explicitly requested tag (`-ToVersion v2.18.0.2`), still validated for format and base existence | Deliberate, operator-driven installs; this is the only channel that may move to an older release |

Additional selection rules, in every channel:

- Draft and prerelease GitHub releases are never selected.
- Invalid tags are ignored and REPORTED (they appear as `[INFO] Ignored invalid release tag: <tag>` with a reason), never selected.
- The updater never downgrades: a selected release that is not higher than the current version resolves to "up to date".
- The current version is read from the `mbumah.releaseVersion` metadata in `package.json` (falling back to `"version"`), so correction releases compare correctly against their own tags.

## Four-part versions

Tags shaped `vX.Y.Z.N` are CORRECTION HOTFIXES, never normal feature releases:

- The hotfix number must stay in the range `.0` through `.5` (`MAX_HOTFIX` in [scripts/release/parse-version.mjs](../scripts/release/parse-version.mjs)).
- A four-part tag is only valid while its three-part base tag `vX.Y.Z` exists. `v2.18.0.0` is valid because `v2.18.0` exists; a hypothetical `v2.19.0.0` without a `v2.19.0` base is INVALID, is ignored, and is reported with the reason "four-part tag without a valid three-part base".
- A hotfix `.0` compares equal to its base, so a machine on either `2.18.0` or `2.18.0.0` is never downgraded or reinstalled by the other.
- The updater never jumps from, for example, 2.17.7 to a four-part tag: the stable channel only ever sees three-part releases, and the hotfix channel only offers hotfixes for the base the machine already runs.

## Dry run

Set `UPDATE_DRY_RUN=1` (environment or `.env`) and run the updater to see the decision without changing anything:

```text
UPDATE DRY RUN (UPDATE_DRY_RUN=1) - nothing will be changed.
Current version: 2.17.7
Latest valid stable release: v2.18.0
Latest valid hotfix for current base: none for this base
Selected release: v2.18.0
Reason: latest valid three-part release (stable channel)
Would download: git fetch + git checkout v2.18.0
Would stop POS: no, because dry run
```

The run logs a `DRY_RUN` event to the update ledger and exits 0.

## Update state file

Both update mechanisms publish progress to a small JSON file:

| Writer | File |
|--------|------|
| Script updaters (nightly/startup, `update-pos.ps1` and `update-pos.sh`) | `%USERPROFILE%\mbumah-pos-data\update-state.json` (Linux/macOS: `~/mbumah-pos-data/update-state.json`) |
| Staged updater flow (server-triggered, `scripts/staged-update.mjs`) | `updater/update-state.json` in the repo |

The script updaters use the same field schema as the staged flow so consumers can read either file the same way. A state write is best effort and never breaks an update.

Fields written by the script updaters:

| Field | Meaning |
|-------|---------|
| `currentVersion` | Version the machine ran when the update started |
| `pendingVersion` | Version being installed |
| `state` / `phase` | Current lifecycle state (same value, two spellings for compatibility) |
| `progress` | 0 to 100 |
| `detail` | Short human-readable message |
| `startedAt` / `updatedAt` | ISO timestamps |
| `backupPath` | Pre-update backup folder (when taken) |
| `buildLogPath` | Captured build log (see [Windows local builds](windows-local-builds.md)) |
| `verificationLogPath` | Reserved for the verification log |
| `error` | Sanitized error text when `state` is `failed` |
| `rollbackAvailable` | Whether a rollback source was captured |
| `channel` | The channel this run used |

State vocabulary: `idle`, `checking`, `selected`, `backing-up`, `downloading`, `extracting`, `installing-dependencies`, `building`, `verifying-build`, `activating`, `activated`, `rolled-back`, `failed`. The script updaters write the update run directly (`selected` follows the release check; `idle` covers "up to date" and dry runs); the staged updater flow uses a reduced phase set (`checking`, `downloading`, `preflight`, `backing-up`, `installing`, `activating`, `rolling-back`, `done`, `failed`) projected onto the same file, as described in [Staged updates](staged-updates.md).

## Safety layers

The updaters apply the following checks in order; any failure stops the update and (after the code was touched) rolls back.

1. **Release selection**: validated selector, invalid tags ignored and reported, never downgrades (this document).
2. **Pre-build checks** (before anything is downloaded or stopped):
   - Disk space: the update needs about 2 GB; below that it fails, between 2 and 5 GB it warns.
   - Database writability: the updater opens the database file exclusively for a moment; a lock held by another program fails the update.
   - Install path advisory: installs inside `Downloads`, `Compressed` or OneDrive folders produce a warning recommending a stable folder such as `C:\MbumahPOS` (see [Windows local builds](windows-local-builds.md)).
   - Dependency manifests present (`package.json` must exist).
3. **Pre-update backup**: database file (plus `-wal`/`-shm` sidecars) and `.env` to a timestamped folder. A failed backup aborts the update; data is never changed by an update and is never auto-restored.
4. **Build log capture and scanning**: the whole build output is written to `mbumah-pos-data/logs/build-{version}-{timestamp}.log`. [scripts/verify-build-output.mjs](../scripts/verify-build-output.mjs) scans it for real build errors (`Failed to compile`, `> Build error occurred`, `Type error:`) in every mode, and for the standalone trace-copy failure class (`Failed to copy traced files`, `EINVAL`, `invalid argument, copyfile`) whenever a standalone build was expected. In normal mode (Windows since v2.18.0.2) those trace-copy lines are reported as ignorable, because the build cannot have produced a standalone output at all.
5. **Build output verification BEFORE success**: the verifier proves `.next/BUILD_ID` and `.next/server` exist in normal mode, or the full standalone chunk-level proof in standalone mode. A stale `.next/standalone/server.js` in normal mode is a hard failure (the launcher would prefer it and boot the old server). A failed verification triggers rollback instead of "UPDATE COMPLETE".
6. **Health gate**: the restarted server must report `200` from `/api/health` with the database check `ok` (not just an HTTP response), and the reported version is compared against the target.
7. **Automatic rollback**: on any failure the updater checks out the previously captured git ref (or re-downloads the previous release as a ZIP overlay), rebuilds it with the same verified sequence, and restarts. The user-facing message stays calm:

```text
Update could not be completed.
The previous version is still available and will be started now.
```

Every decision is also recorded as one JSON line per event in the update ledger (`%USERPROFILE%\mbumah-pos-data\update-ledger.jsonl`): `DRY_RUN`, `TAG_IGNORED`, `BACKUP`, `UPDATE_START`, `UPDATE_SUCCESS`, `UPDATE_FAILED`, `ROLLBACK_SUCCESS`, `ROLLBACK_FAILED`, `SHARP_REPAIR`, `TASK_REGISTERED` and others.

## Operations note: how correction releases reach stable machines

The stable channel ignores four-part tags by design, so a correction release does NOT reach a stable-channel machine on its own. It reaches such machines in one of two ways:

1. The corrections are folded into the next three-part release (the normal path: the next feature or patch release contains everything the hotfixes fixed).
2. The machine's channel is set to `hotfix` (`UPDATE_CHANNEL=hotfix` in `.env`), which delivers the latest valid hotfix for the base the machine already runs.

Use `UPDATE_DRY_RUN=1` first when changing a machine's channel, and see [Release versioning](release-versioning.md) for how the versions themselves are produced.

## Related

- [Release versioning](release-versioning.md): version sources, the decision block, tag rules
- [Release process](release-process.md): the standard release flow on `main`
- [Windows local builds](windows-local-builds.md): what the rebuild does on Windows
- [Staged updates](staged-updates.md): the server-triggered pipeline with its own state file
