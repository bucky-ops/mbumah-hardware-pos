/**
 * APP VERSION — single source of truth: package.json "version".
 *
 * RELEASE FLOW (see RELEASE_FLOW.md at the repo root):
 *   1. Bump package.json → "version" (the ONLY place a version is edited)
 *   2. /api/health reports it (server)
 *   3. The app footer + login screen render it (client, via this module)
 *   4. openapi.json info.version mirrors it (via APP_VERSION — never edit
 *      the spec's version by hand; it used to drift at 2.5.7 while the app
 *      shipped 2.6.1)
 *   5. Tag vX.Y.Z + GitHub Release are cut AUTOMATICALLY by
 *      .github/workflows/release.yml on every push to main that ships a
 *      new package.json version (manual tagging was forgotten twice —
 *      v2.5.8 and v2.6.1 both had to be released by hand afterwards)
 *
 * Importing package.json is build-time only (resolveJsonModule) — the JSON
 * lands in the client bundle once and can never drift from the deployed
 * build again (the footer previously hardcoded "v2.2.0" while the API
 * reported 2.5.0).
 */
import pkg from '../../package.json';

export const APP_VERSION: string = pkg.version;
export const APP_VERSION_LABEL: string = `v${pkg.version}`;

/**
 * Build identity — the exact commit this bundle was compiled from.
 *
 * Vercel exposes VERCEL_GIT_COMMIT_SHA on every build and auto-prefixes the
 * NEXT_PUBLIC_ variant for Next.js, so client bundles get it inlined at
 * build time. Outside Vercel (local dev, self-hosted) we fall back to
 * 'dev' so the badge stays honest instead of showing a stale guess.
 */
const RAW_BUILD_SHA: string =
  process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ??
  process.env.VERCEL_GIT_COMMIT_SHA ??
  '';

export const APP_BUILD_SHA: string = RAW_BUILD_SHA
  ? RAW_BUILD_SHA.slice(0, 7)
  : 'dev';

/** Full badge, e.g. "v2.6.2 · 13c4aab" (or "v2.6.2 · dev" locally). */
export const APP_BUILD_LABEL: string = `${APP_VERSION_LABEL} · ${APP_BUILD_SHA}`;
