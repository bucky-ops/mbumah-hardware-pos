# Standalone output

Standalone output (`output: "standalone"` in `next.config.ts`) produces a self-contained server in `.next/standalone` that can run without the repo's `node_modules`. It is OPT-IN via the `BUILD_STANDALONE=1` environment variable and is used ONLY by the Docker image and the Linux no-Docker installs.

Windows never builds standalone output; see [Windows local builds](windows-local-builds.md) for that policy and its reasoning.

## Policy matrix

The policy lives in one shared function, `resolveStandaloneOutput` in [src/lib/build-mode.ts](../src/lib/build-mode.ts), which `next.config.ts`, the build verifier and the test suite all read. That keeps the launcher, the verifiers and the config from drifting apart.

| Environment | Result |
|-------------|--------|
| `BUILD_STANDALONE` unset | Normal output (Windows laptops, Vercel, plain `next build`) |
| `BUILD_STANDALONE=1` on Windows | Normal output, plus a warning: Windows never builds standalone, so the flag is ignored |
| `BUILD_STANDALONE=1` on Linux or in Docker | Standalone output (unchanged behavior) |

Being disabled by default is deliberate. Standalone exists for deployment targets whose runner executes `.next/standalone/server.js` directly and does not keep the repo's `node_modules` next to the build. Laptop installs build and run on the same machine, so `next start` against a plain build is simpler and removes the Windows trace-copy failure class entirely (see [Windows local builds](windows-local-builds.md)).

## Who builds and assembles it

| Deployment | Builds standalone | Assembles static and public into `.next/standalone` |
|-----------|-------------------|------------------------------------------------------|
| Docker image (`Dockerfile`) | yes (`ENV BUILD_STANDALONE=1`) | yes, as `COPY` steps for `.next/static` and `public` in the runner stage |
| Linux no-Docker installer and updater (`install-nodocker.sh`, `update-pos.sh`) | yes (exports `BUILD_STANDALONE=1` for the whole rebuild) | yes, with `cp -r` of `.next/static` and `public` after the build |
| Windows installer and updater | never (the policy ignores the flag and warns) | never; the updater instead deletes stale `.next\standalone` leftovers before building |
| Vercel | no (its own build pipeline and output format) | not applicable |

## Launcher behavior

[deploy/nodocker/start-server.mjs](../deploy/nodocker/start-server.mjs) supports both start modes:

1. When `.next/standalone/server.js` exists, it runs that server directly. The standalone server does not read `.env` by itself, which is one reason the launcher exists: it loads the repo `.env` first (and `.env` wins over an inherited environment).
2. Otherwise, when `.next/BUILD_ID` exists, it starts a normal build with `next start` from `node_modules` (`node_modules/next/dist/bin/next start -p <port> -H 0.0.0.0`).
3. When neither exists, it exits with the "Build output missing" message and points at the installer/updater.

Since v2.18.0.2 the `next start` child is NOT detached: the updater stops the launcher with a process-tree kill (`taskkill /T` on Windows) so a stopped-but-still-listening orphan cannot hold port 3000.

## Defense in depth: the node-builtin alias

The v2.18.0.1 fix stays in `next.config.ts` for the Docker and Linux builds: `turbopack.resolveAlias` maps every `node:*` specifier to its identical bare specifier (`node:fs` to `fs`, `node:inspector` to `inspector`, and so on). Node treats the two forms as the same module, so this is a pure rename at the bundler level, and Turbopack chunk file names never contain a colon (`[externals]_inspector_7a4283c6._.js` instead of `[externals]_node:inspector_7a4283c6._.js`).

On Windows this alias is no longer load-bearing (no standalone output means no trace-copy), but Docker and Linux still assemble and copy standalone output, so the alias keeps the failure class impossible there too, including for future dynamic imports inside dependencies.

## Verification

[scripts/verify-build-output.mjs](../scripts/verify-build-output.mjs) resolves its mode with the same policy function. In standalone mode it delegates to [scripts/verify-standalone.mjs](../scripts/verify-standalone.mjs), which proves:

1. `.next/standalone/server.js` exists,
2. `.next/standalone/.next/static` was assembled,
3. every server chunk referenced by any route or runtime file is actually present in `.next/standalone`.

Check 3 is the generic safety net for the original field failure: an incomplete standalone build is now a hard failure (exit 1) that stops the installer or triggers the updater's rollback, instead of a restart into a broken server. See [Updater release channels](updater-release-channels.md) for the rollback flow.

## Related

- [Windows local builds](windows-local-builds.md): the normal-build policy on Windows
- [Staged updates](staged-updates.md): the server-triggered update pipeline for self-hosted machines

## Start command fallback (v2.18.3.1)

`npm start` / `bun start` run `deploy/nodocker/start-server.mjs`, which picks
the right server for the build this release was built with: the standalone
server when `.next/standalone/server.js` exists (Linux or Docker builds made
with BUILD_STANDALONE=1), otherwise `next start` against the plain build
output. Windows laptops, where the standalone output is disabled by policy,
therefore start correctly with the plain command instead of failing on a
missing standalone bundle. The launcher also applies the repo .env with
env-wins precedence and fails fast with guidance when no build output exists.
