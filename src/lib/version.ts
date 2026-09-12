/**
 * APP VERSION — single source of truth: package.json "version".
 *
 * RELEASE FLOW (see RELEASE_FLOW.md at the repo root):
 *   1. Bump package.json → "version" (the ONLY place a version is edited)
 *   2. /api/health reports it (server)
 *   3. The app footer renders it (client, via this module)
 *   4. openapi.json info.version mirrors it
 *   5. Tag vX.Y.Z + GitHub Release when it ships to production
 *
 * Importing package.json is build-time only (resolveJsonModule) — the JSON
 * lands in the client bundle once and can never drift from the deployed
 * build again (the footer previously hardcoded "v2.2.0" while the API
 * reported 2.5.0).
 */
import pkg from '../../package.json';

export const APP_VERSION: string = pkg.version;
export const APP_VERSION_LABEL: string = `v${pkg.version}`;
