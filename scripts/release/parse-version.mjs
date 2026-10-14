// ============================================================================
// MBUMAH HARDWARE POS - Release version parser (v2.18.0.2)
// ============================================================================
// Single parser for every version string the updater can meet:
//
//   2.17.7      three-part stable release
//   v2.17.7     same, tag-prefixed
//   2.17.7.0    four-part correction hotfix (.0 through .5)
//   v2.18.0.0   same, tag-prefixed
//
// Rejected on purpose (this project does not use them):
//   prerelease/build suffixes (2.18.1-rc.1, 2.18.1+build), hotfix numbers
//   above .5, and anything that is not MAJOR.MINOR.PATCH[.HOTFIX].
//
// Four-part versions are CORRECTION HOTFIXES, never normal feature
// releases - a four-part tag is only meaningful while its three-part base
// release exists (enforced by validate-tag.mjs / select-release.mjs).
//
// No dependencies - imported by scripts/release/*.mjs and the vitest suite.
// ============================================================================

/** Allowed correction-hotfix range: .0 through .5. */
export const MAX_HOTFIX = 5;

/**
 * Parse a version string into structured data.
 * Returns an object that ALWAYS has the documented fields; `valid` is false
 * with a `reason` when the input is not usable as a release version.
 */
export function parseVersion(raw) {
  const out = {
    raw: String(raw == null ? '' : raw),
    normalized: '',
    major: 0,
    minor: 0,
    patch: 0,
    hotfix: null,
    baseVersion: '',
    isValidThreePart: false,
    isValidFourPartHotfix: false,
    valid: false,
    channel: 'stable',
    reason: '',
  };
  let s = out.raw.trim();
  if (s.startsWith('v') || s.startsWith('V')) s = s.slice(1);
  out.normalized = s;

  if (!s) {
    out.reason = 'empty version string';
    return out;
  }
  if (s.includes('-') || s.includes('+')) {
    out.reason = 'prerelease or build metadata suffixes are not used for POS releases';
    return out;
  }
  const m = s.match(/^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?$/);
  if (!m) {
    out.reason = 'not a MAJOR.MINOR.PATCH or MAJOR.MINOR.PATCH.HOTFIX version';
    return out;
  }
  out.major = Number(m[1]);
  out.minor = Number(m[2]);
  out.patch = Number(m[3]);

  if (m[4] === undefined) {
    out.isValidThreePart = true;
    out.baseVersion = s;
    out.valid = true;
    return out;
  }

  const hotfix = Number(m[4]);
  if (hotfix < 0 || hotfix > MAX_HOTFIX) {
    out.reason = `hotfix number ${hotfix} is outside the allowed .0 through .${MAX_HOTFIX} range`;
    return out;
  }
  out.hotfix = hotfix;
  out.isValidFourPartHotfix = true;
  out.baseVersion = `${out.major}.${out.minor}.${out.patch}`;
  out.channel = 'hotfix';
  out.valid = true;
  return out;
}

/** Numeric hotfix for comparison (three-part versions compare as .0). */
function hotfixOf(parsed) {
  return parsed.hotfix == null ? 0 : parsed.hotfix;
}

/**
 * Compare two PARSED versions (parseVersion output). Returns -1, 0 or 1.
 * A missing hotfix compares equal to hotfix .0, so v2.18.0 and v2.18.0.0 are
 * the same release level for update decisions (a machine on either must not
 * be downgraded or reinstalled by the other).
 */
export function compareVersions(a, b) {
  const keys = ['major', 'minor', 'patch'];
  for (const k of keys) {
    if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
  }
  const ha = hotfixOf(a);
  const hb = hotfixOf(b);
  if (ha !== hb) return ha < hb ? -1 : 1;
  return 0;
}

/** Pick the highest of an array of PARSED versions, or null when empty. */
export function maxParsedVersion(list) {
  let best = null;
  for (const p of list) {
    if (!p || !p.valid) continue;
    if (best === null || compareVersions(p, best) > 0) best = p;
  }
  return best;
}

/** Convenience: parse + compare for raw strings. Returns -1, 0, 1 or null when either input is invalid. */
export function compareRawVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa.valid || !pb.valid) return null;
  return compareVersions(pa, pb);
}
