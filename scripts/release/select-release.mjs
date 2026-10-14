#!/usr/bin/env node
// ============================================================================
// MBUMAH HARDWARE POS - Release selector (v2.18.0.2)
// ============================================================================
// Decides WHICH GitHub release a POS install should update to. Replaces the
// old blind "releases/latest" lookup, which returned four-part correction
// tags as if they were normal releases (the field report: a machine on
// 2.17.7 was updated to v2.18.0.0).
//
// Rules:
//   - Drafts and prereleases are never selected.
//   - Invalid tags are ignored and REPORTED, never selected. A four-part tag
//     without its three-part base is invalid (see validate-tag.mjs).
//   - stable channel (default): latest valid THREE-part release only.
//   - hotfix channel: latest valid three-part release, OR the latest valid
//     four-part hotfix for the CURRENT version's base - whichever is higher.
//   - manual channel: an explicitly requested tag (-ToVersion), validated
//     for format and base existence; allows explicit downgrades.
//   - Never downgrade: a selected release that is not higher than the
//     current version resolves to "up-to-date".
//
// Usage:
//   node scripts/release/select-release.mjs --current 2.17.7 [--channel stable]
//        [--releases-json '<json>' | --releases-file <path>] [--timeout 30]
//
//   --releases-json accepts an array of tag strings OR GitHub release objects
//   (tag_name/draft/prerelease); without it the script fetches the release
//   list from api.github.com (GITHUB_TOKEN respected when set).
//
// Output: logs go to STDERR; exactly ONE JSON line goes to STDOUT:
//   { action, current, channel, selected, reason,
//     latestStable, latestHotfixForBase, ignored: [{tag, reason}] }
//   action: "update" | "up-to-date" | "none"
//
// Exit codes: 0 = decision made, 1 = usage error, 2 = network failure,
//             3 = no valid release exists at all.
// Callers treat exit 2 like the previous offline behavior (skip, retry later).
// ============================================================================

import { get } from 'node:https';
import { readFileSync } from 'node:fs';
import { parseVersion, compareVersions, maxParsedVersion } from './parse-version.mjs';
import { validateTag } from './validate-tag.mjs';

const REPO_SLUG = 'bucky-ops/mbumah-hardware-pos';

function err(msg) {
  console.error(msg);
}
function argValue(name) {
  const i = process.argv.indexOf(name);
  if (i !== -1 && process.argv[i + 1] !== undefined) return process.argv[i + 1];
  return null;
}

// -- Args ---------------------------------------------------------------------
const currentRaw = argValue('--current') || '';
const channel = (argValue('--channel') || 'stable').toLowerCase();
const releasesJson = argValue('--releases-json');
const releasesFile = argValue('--releases-file');
const timeoutSec = Number(argValue('--timeout') || 30) || 30;
const toVersion = argValue('--to-version');

if (!['stable', 'hotfix', 'manual'].includes(channel)) {
  err(`[select-release] Unknown channel "${channel}" (expected stable, hotfix or manual).`);
  process.exit(1);
}

const current = parseVersion(currentRaw);
if (!current.valid) {
  err(`[select-release] Current version "${currentRaw}" is not a valid release version: ${current.reason}`);
  process.exit(1);
}
if (channel === 'manual' && !toVersion) {
  err('[select-release] Channel "manual" requires --to-version <tag>.');
  process.exit(1);
}

// -- Release list -------------------------------------------------------------
function fetchReleases(timeout) {
  return new Promise((resolve, reject) => {
    const path = `/repos/${REPO_SLUG}/releases?per_page=100&page=1`;
    const headers = {
      'User-Agent': 'mbumah-pos-updater',
      Accept: 'application/vnd.github+json',
    };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `token ${process.env.GITHUB_TOKEN}`;
    const req = get(
      { hostname: 'api.github.com', path, headers, timeout: timeout * 1000 },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`GitHub API answered HTTP ${res.statusCode}`));
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`GitHub API returned unparsable JSON: ${e.message}`));
          }
        });
      },
    );
    req.on('timeout', () => {
      req.destroy(new Error(`GitHub API timed out after ${timeout}s`));
    });
    req.on('error', reject);
  });
}

function normalizeReleaseList(input) {
  // Accept: array of strings, array of GitHub release objects, or a wrapped
  // GitHub release object array under any key. Filtering mirrors GitHub
  // semantics: drafts and prereleases are never stable candidates.
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      if (typeof item === 'string') return { tag: item, draft: false, prerelease: false };
      if (item && typeof item === 'object' && item.tag_name) {
        return { tag: String(item.tag_name), draft: Boolean(item.draft), prerelease: Boolean(item.prerelease) };
      }
      return null;
    })
    .filter(Boolean)
    .filter((r) => !r.draft && !r.prerelease);
}

let releases = [];
try {
  if (releasesJson) {
    releases = normalizeReleaseList(JSON.parse(releasesJson));
  } else if (releasesFile) {
    releases = normalizeReleaseList(JSON.parse(readFileSync(releasesFile, 'utf8')));
  } else {
    releases = normalizeReleaseList(await fetchReleases(timeoutSec));
  }
} catch (e) {
  err(`[select-release] Could not load the release list: ${e.message}`);
  process.exit(2);
}

// -- Validation ----------------------------------------------------------------
const allTags = releases.map((r) => r.tag);
const stable = [];
const hotfixes = [];
const ignored = [];
for (const r of releases) {
  const res = validateTag(r.tag, allTags);
  if (res.valid) {
    if (res.kind === 'stable') stable.push({ tag: r.tag, parsed: res.parsed });
    else hotfixes.push({ tag: r.tag, parsed: res.parsed });
  } else {
    ignored.push({ tag: r.tag, reason: res.reason });
  }
}

const latestStable = maxParsedVersion(stable.map((s) => s.parsed));
const latestStableTag = latestStable ? `v${latestStable.normalized}` : null;
const hotfixesForBase = hotfixes.filter((h) => h.parsed.baseVersion === current.baseVersion);
const latestHotfixForBase = maxParsedVersion(hotfixesForBase.map((h) => h.parsed));
const latestHotfixForBaseTag = latestHotfixForBase ? `v${latestHotfixForBase.normalized}` : null;

function printDecision(decision) {
  process.stdout.write(
    `${JSON.stringify({
      action: decision.action,
      current: current.normalized,
      channel,
      selected: decision.selected || null,
      reason: decision.reason || '',
      latestStable: latestStableTag,
      latestHotfixForBase: latestHotfixForBaseTag,
      ignored,
    })}\n`,
  );
}

// -- Manual channel --------------------------------------------------------------
if (channel === 'manual') {
  const res = validateTag(toVersion, allTags);
  if (!res.valid) {
    err(`[select-release] Requested version "${toVersion}" is not a valid release tag: ${res.reason}`);
    process.exit(1);
  }
  // Manual installs may deliberately move to an older valid release; format
  // and base existence are still enforced above.
  printDecision({ action: 'update', selected: `v${res.parsed.normalized}`, reason: 'explicitly requested version (manual channel)' });
  process.exit(0);
}

// -- Stable / hotfix channels ------------------------------------------------
let candidate = null;
let reason = '';
if (channel === 'stable') {
  candidate = latestStable;
  reason = 'latest valid three-part release (stable channel)';
  if (ignored.length > 0) {
    for (const ig of ignored) err(`[select-release] Ignored invalid release tag: ${ig.tag} (${ig.reason})`);
  }
} else {
  const pool = [];
  if (latestStable) pool.push(latestStable);
  if (latestHotfixForBase) pool.push(latestHotfixForBase);
  candidate = maxParsedVersion(pool);
  reason = latestHotfixForBase
    ? 'latest valid release for the current base (hotfix channel)'
    : 'latest valid three-part release (no hotfix for the current base)';
}

if (!candidate) {
  printDecision({ action: 'none', selected: null, reason: 'no valid release found in the repository release list' });
  process.exit(3);
}

const cmp = compareVersions(current, candidate);
if (cmp >= 0) {
  printDecision({
    action: 'up-to-date',
    selected: `v${candidate.normalized}`,
    reason:
      `current version ${current.normalized} is not older than the selected release ` +
      `v${candidate.normalized}; no update needed`,
  });
  process.exit(0);
}

printDecision({
  action: 'update',
  selected: `v${candidate.normalized}`,
  reason,
});
process.exit(0);
