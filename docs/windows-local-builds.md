# Windows local builds

How Windows laptop installs of the POS build and run their own production build. Since v2.18.0.2 a Windows install builds a NORMAL Next.js output (no `output: "standalone"`) and starts it with `next start` through [deploy/nodocker/start-server.mjs](../deploy/nodocker/start-server.mjs). Standalone output stays reserved for Docker and Linux, as described in [Standalone output](standalone-output.md).

## What a Windows build produces

| Artifact | Present on Windows | Purpose |
|----------|--------------------|---------|
| `.next/BUILD_ID` | yes | Proof that the production build finished; the launcher detects a normal build by it |
| `.next/server` | yes | The server-side build the `next start` process serves |
| `.next/standalone` | no | Not produced on Windows at all (the policy forbids it) |

The install and update scripts run the same sequence as before (`npm install --include=optional`, schema push, `npm run build`), they simply no longer export `BUILD_STANDALONE=1` and no longer assemble a standalone folder. Before building, the Windows installer and updater delete stale `.next\standalone` leftovers from pre-2.18.0.2 releases.

## Why Windows no longer builds standalone

Before v2.18.0.2, Windows laptops built standalone output so the launcher could run `.next/standalone/server.js`. That build includes a "trace copy" phase which copies every file the server needs into `.next/standalone`. The field reports from v2.17.6 and v2.17.7 showed how that phase fails on NTFS:

- Turbopack gives asynchronously imported Node builtins their own chunk file, named after the specifier, for example `[externals]_node:inspector_7a4283c6._.js`.
- Linux filesystems accept colons in file names; NTFS forbids them.
- The copy step therefore fails with `EINVAL` ("invalid argument, copyfile"), the affected chunks are missing from `.next/standalone`, and routes such as `/api/batch` and `/api/cron/nightly` break at runtime while the updater still reports success.

A normal build has no trace-copy phase, so this entire failure class cannot occur: the build produces no standalone output at all. The second failure mode, "Build output missing (.next/standalone/server.js)", is also gone for the same reason: the launcher starts a normal build with `next start` and no longer depends on a standalone server existing.

The node-builtin alias fix from v2.18.0.1 (which removes colons from chunk file names everywhere) stays in place as defense in depth for the Docker and Linux builds; see [Standalone output](standalone-output.md).

## The sharp probe and image optimization

`next/image` optimization needs sharp's native binary for the exact platform (`@img/sharp-win32-x64` on Windows laptops). Some machines end up without it because an npm config skipped optional dependencies, antivirus software interfered, or the cache was damaged; the result was the "Could not load the sharp module using the win32-x64 runtime" 500 error on every optimized photo.

Since v2.18.0.1 the installers and updaters handle this in three layers, and v2.18.0.2 extended the last one to every Windows build:

1. Install with `npm install --include=optional` so a machine-level npm config can never skip the platform binary.
2. Repair a missing binary before the build: `npm install --no-save --os=win32 --cpu=x64 sharp` (ledger event `SHARP_REPAIR`).
3. Probe at build time: `next.config.ts` loads sharp with `require`. When the binary is unusable, the build bakes `images.unoptimized: true` into the output, so product photos are served without resizing instead of erroring on every request.

The degraded mode is calm by design: the POS works normally, only image resizing is skipped. Vercel and Docker build on Linux with a working sharp and keep optimization.

## Install location

Install (and keep) the app in a stable folder such as `C:\MbumahPOS`. Avoid these locations:

| Location | Why it breaks updates |
|----------|----------------------|
| `Downloads` | Cleanup tools and browser locks touch files while the build runs |
| `Compressed` (zipped folders view) | Windows treats the content as an archive; copies and locks behave unpredictably |
| Any `OneDrive` folder | Sync placeholders and upload locks compete with `next build` for the same files |

The updater checks the install path before every update and prints a warning when it detects one of these locations, recommending a move to `C:\MbumahPOS` (on Linux: `/opt/mbumah-pos`). The warning is advisory: the update continues, but file locks in these folders are a common cause of half-finished builds.

## Build verification

Every installer and updater run ends with [scripts/verify-build-output.mjs](../scripts/verify-build-output.mjs), which is mode-aware:

- Normal mode (Windows, Vercel, plain builds): proves `.next/BUILD_ID` and `.next/server` exist, and scans the build log for real build errors (`Failed to compile`, `> Build error occurred`, `Type error:`). A leftover `.next/standalone/server.js` from an older release is a HARD FAILURE, because the launcher prefers a standalone output when one is present and would boot the old server instead of the new build.
- Standalone mode (Docker, Linux): delegates to the full chunk-level verifier from v2.18.0.1 ([scripts/verify-standalone.mjs](../scripts/verify-standalone.mjs)).

`EINVAL` and "Failed to copy traced files" lines in the log are fatal only when a standalone build was expected. In normal mode they are recorded and reported as ignorable, because the policy guarantees the build cannot have produced a standalone output that could be damaged.

A failed verification aborts the installer or triggers the updater's automatic rollback; see [Updater release channels](updater-release-channels.md).

## Build logs

The updaters capture the full build output to a log file and record its path in the update state file:

```text
%USERPROFILE%\mbumah-pos-data\logs\build-{version}-{timestamp}.log
```

On Linux the same logs live in `~/mbumah-pos-data/logs/`. When an update fails, the updater prints the last log lines; the file itself stays on disk for support. This is what made the original EINVAL reports diagnosable: the warnings were in the log, but nothing used to read them.

## Related

- [Standalone output](standalone-output.md): where standalone output is still built and why
- [Updater release channels](updater-release-channels.md): how an update picks a release and rolls back
- [Troubleshooting and FAQ](troubleshooting-and-faq.md): the EINVAL and build output warning entry

## Start command fallback (v2.18.3.1)

`npm start` / `bun start` run `deploy/nodocker/start-server.mjs`, which picks
the right server for the build this release was built with: the standalone
server when `.next/standalone/server.js` exists (Linux or Docker builds made
with BUILD_STANDALONE=1), otherwise `next start` against the plain build
output. Windows laptops, where the standalone output is disabled by policy,
therefore start correctly with the plain command instead of failing on a
missing standalone bundle. The launcher also applies the repo .env with
env-wins precedence and fails fast with guidance when no build output exists.
