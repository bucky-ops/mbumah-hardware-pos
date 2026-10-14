// ============================================================================
// MBUMAH HARDWARE POS - Release tag validator (v2.18.0.2)
// ============================================================================
// Validates one release tag against the tag universe of the repository.
//
// Rules (docs/updater-release-channels.md, docs/release-versioning.md):
//   - Three-part tags (vX.Y.Z) are the normal feature/patch releases.
//   - Four-part tags (vX.Y.Z.N) are correction hotfixes and are ONLY valid
//     when the three-part base tag vX.Y.Z exists in the repository. The
//     published v2.18.0.0/v2.18.0.1 pair is therefore valid, but a tag such
//     as v2.19.0.0 without a v2.19.0 base would be rejected.
//   - Hotfix numbers must stay in the .0 through .5 range.
//   - Prerelease suffixes (-rc.1, -beta, +build) are rejected for this
//     release process.
//
// No dependencies.
// ============================================================================

import { parseVersion } from './parse-version.mjs';

/**
 * Validate one tag.
 * @param {string} rawTag         tag such as "v2.18.0" or "2.18.0.1"
 * @param {string[]} existingTags every tag that exists in the repository
 *                                 (v-prefix optional, mixes allowed)
 * @returns {{valid: boolean, reason: string, kind: 'stable'|'hotfix'|'invalid', parsed: object}}
 */
export function validateTag(rawTag, existingTags) {
  const parsed = parseVersion(rawTag);
  if (!parsed.valid) {
    return { valid: false, reason: parsed.reason, kind: 'invalid', parsed };
  }

  if (parsed.isValidFourPartHotfix) {
    const known = new Set();
    for (const t of existingTags || []) {
      const p = parseVersion(t);
      if (p.valid && p.normalized) known.add(p.normalized);
    }
    if (!known.has(parsed.baseVersion)) {
      return {
        valid: false,
        reason:
          `four-part tag without a valid three-part base ${parsed.baseVersion}: ` +
          'four-part versions are correction hotfixes and require their base release to exist',
        kind: 'invalid',
        parsed,
      };
    }
    return {
      valid: true,
      reason: `valid correction hotfix for base ${parsed.baseVersion} (hotfix .${parsed.hotfix})`,
      kind: 'hotfix',
      parsed,
    };
  }

  return { valid: true, reason: 'valid three-part release', kind: 'stable', parsed };
}

/**
 * Validate a whole list of tags. Returns { valid: [...], ignored: [...] }.
 * `ignored` entries keep the exact reason so updaters can print them.
 */
export function validateTagList(tags) {
  const valid = [];
  const ignored = [];
  for (const tag of tags || []) {
    const res = validateTag(tag, tags);
    if (res.valid) {
      valid.push({ tag: String(tag), kind: res.kind, parsed: res.parsed });
    } else {
      ignored.push({ tag: String(tag), reason: res.reason });
    }
  }
  return { valid, ignored };
}
