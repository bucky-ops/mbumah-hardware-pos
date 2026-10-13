# Staged updates (self-hosted)

Staged updates bring release v2.17.9's update pipeline to self-hosted deployments (the Windows laptop and the LAN server): the new release is downloaded, rehearsed against a copy of the database, backed up, installed, activated and only then accepted, with an automatic rollback when any stage fails. Progress is published to a small state file so the login page can show a calm progress bar while the update runs.

This pipeline is for self-hosted machines only. On Vercel the preparation endpoint refuses with 501 and the orchestrator refuses with exit code 2, because serverless has no filesystem or process control. The classic updater (`deploy/nodocker/update-pos.sh` / `update-pos.ps1` and the start-up check) is unchanged.

## How a staged update runs

| Phase | Meaning | Approximate percent |
| --- | --- | --- |
| `idle` | No update activity. | 0 |
| `checking` | The request was accepted; the artifact source is resolved. | 2 |
| `downloading` | The release artifact is fetched (https) or copied into `updater/staging/<timestamp>/` and verified non-empty. | 10 to 40 |
| `preflight` | `scripts/preflight-schema.mjs` rehearses the schema change on a throwaway copy of the database; the live data is never touched. | 55 |
| `backing-up` | `scripts/backup-db.mjs` writes a verified, timestamped backup of the live database. | 65 |
| `installing` | The artifact is extracted (`tar -xzf`) or the release directory is used directly. With `MBUMAH_INSTALL_DIR` set, the current install directory is renamed to `<dir>.previous-<timestamp>` and the new release takes its place. | 85 |
| `activating` | The new release is handed to the runtime and the smoke test starts. | 92 |
| smoke test | `MBUMAH_HEALTH_URL` is polled every 5 seconds, up to 12 attempts; a healthy report completes the run. | 92 to 100 |
| `done` | Update complete and healthy. | 100 |
| `rolling-back` | A failure after the backup step restores the previous install directory and the database. | varies |
| `failed` | The update did not complete; the system was rolled back or was never touched. | varies |

Safety properties of the orchestrator (`scripts/staged-update.mjs`): it never runs destructive SQL (no DROP or DELETE statements), it writes no secrets to the state file (error text is path-sanitized before it is written), every step has a timeout and the smoke loop is bounded, so a stuck run cannot hang forever.

## Endpoints

| Endpoint | Method | Access | Behavior |
| --- | --- | --- | --- |
| `/api/update/status` | GET | Public for progress; SUPER_ADMIN and STORE_OWNER receive extended detail | Returns `phase`, `percent`, `message`, `targetVersion`, `updatedAt` and the `maintenance` flag. Authenticated owners and administrators additionally receive `startedAt`, `error` (path-sanitized) and `pid`. A missing or corrupt state file answers the idle defaults; the endpoint never fails because of updater bookkeeping. |
| `/api/update/prepare` | POST | SUPER_ADMIN and STORE_OWNER only | Accepts an optional `targetVersion` (1 to 32 characters of letters, digits, dot, underscore) and an optional `artifactUrl` (must start with `https://`). Spawns the orchestrator detached and answers 202 immediately. Answers 409 while an update is already active and 501 on Vercel. |

The public status payload is intentionally minimal: no error detail, no process id, no filesystem paths. Those fields exist only in the owner/administrator projection, and even the `error` string has absolute paths replaced with `[path]` before it is ever written to disk.

## Orchestrator CLI

```
node scripts/staged-update.mjs --target-version 2.17.9 --artifact-url https://example.com/mbumah-2.17.9.tar.gz
node scripts/staged-update.mjs --target-version 2.17.9 --artifact-path /path/to/release.tar.gz
```

Environment:

- `MBUMAH_INSTALL_DIR`: the release directory to swap. When set, the current directory is renamed to `<dir>.previous-<timestamp>` before the new release moves in, which is what makes rollback a rename. When unset, the release is staged and verified under `updater/staging/` and the in-place overlay installs remain the job of `deploy/nodocker/update-pos`.
- `MBUMAH_HEALTH_URL`: smoke test URL, default `http://localhost:3000/api/health`.

Exit codes: `0` the update is complete and healthy, `1` the update failed (rolled back where possible), `2` the run was refused (serverless environment or invalid usage).

## UPDATE_ON_START semantics

`UPDATE_ON_START=0` in `.env` disables ONLY the remote version check (the launch-time GitHub release check performed by the start scripts). The local schema preflight is not affected: the start-time schema self-heal (`scripts/ensure-schema.mjs`, run by `deploy/nodocker/start-server.mjs` on every boot) always runs, so a database that lags the installed code still converges on the next start regardless of the flag. Within a staged update the same principle applies: the schema rehearsal (`preflight`) always runs; there is no flag that skips it.

## Rollback behavior

- A failure before the backup step completes changes nothing: the run reports `failed` with a sanitized reason and exits 1.
- A failure after the backup step (preflight, install, swap, activation or smoke test) first reports `rolling-back`, then restores the previous install directory when the install directory was swapped, then copies the newest backup file created by this run back over the live database file (local SQLite only; the stale `-wal` and `-shm` sidecars are removed after the copy so they cannot replay over the restored file), and finally reports `failed`.
- PostgreSQL deployments are not auto-restored by this pipeline: the backup tooling prints provider guidance (`pg_dump` or a managed snapshot) and the staged run records the backup location in the state file instead of guessing at provider credentials.

## Workspaces are unaffected

Staged updates replace the release on disk and do not touch routing or identity: subdomain workspaces, `/stores/<branch>` path links, the host allowlist and shared sign-on cookies all behave exactly as before the update. A staged update is transparent to every workspace URL.
