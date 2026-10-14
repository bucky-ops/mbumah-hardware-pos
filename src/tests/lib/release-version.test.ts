/**
 * Release version parser, comparator and tag validator tests (v2.18.0.2).
 *
 * These exercise the REAL modules the updaters use
 * (scripts/release/parse-version.mjs + scripts/release/validate-tag.mjs).
 * The selector end-to-end matrix runs in scripts/verify-release-selection.mjs
 * (wired into CI) because select-release.mjs is a CLI that calls process.exit.
 */
import { describe, expect, it } from 'vitest';
import { compareVersions, MAX_HOTFIX, parseVersion } from '../../../scripts/release/parse-version.mjs';
import { validateTag, validateTagList } from '../../../scripts/release/validate-tag.mjs';

interface Parsed {
  valid: boolean;
  normalized: string;
  major: number;
  minor: number;
  patch: number;
  hotfix: number | null;
  baseVersion: string;
  isValidThreePart: boolean;
  isValidFourPartHotfix: boolean;
  reason: string;
}

const parse = (raw: string | null | undefined): Parsed =>
  parseVersion(raw as string | null | undefined) as unknown as Parsed;

describe('release version parser (v2.18.0.2 correction)', () => {
  it('parses three-part versions with and without the v prefix', () => {
    for (const raw of ['2.17.7', 'v2.17.7']) {
      const p = parse(raw);
      expect(p.valid).toBe(true);
      expect(p.normalized).toBe('2.17.7');
      expect(p.isValidThreePart).toBe(true);
      expect(p.isValidFourPartHotfix).toBe(false);
      expect(p.hotfix).toBeNull();
      expect(p.baseVersion).toBe('2.17.7');
    }
  });

  it('parses four-part correction hotfixes and exposes their base', () => {
    const p = parse('v2.18.0.0');
    expect(p.valid).toBe(true);
    expect(p.isValidFourPartHotfix).toBe(true);
    expect(p.isValidThreePart).toBe(false);
    expect(p.hotfix).toBe(0);
    expect(p.baseVersion).toBe('2.18.0');
    expect(p.normalized).toBe('2.18.0.0');
  });

  it('marks 2.18.0.0 as a four-part hotfix, never a normal release', () => {
    const p = parse('2.18.0.0');
    expect(p.isValidFourPartHotfix).toBe(true);
    expect(p.isValidThreePart).toBe(false);
  });

  it('rejects hotfix numbers above the .5 limit', () => {
    const p = parse('2.18.0.6');
    expect(p.valid).toBe(false);
    expect(p.reason).toContain('.0 through .5');
    expect(MAX_HOTFIX).toBe(5);
    expect(parse('2.18.0.5').valid).toBe(true);
  });

  it('rejects prerelease and build suffixes for the stable release process', () => {
    expect(parse('2.19.0-rc.1').valid).toBe(false);
    expect(parse('v2.19.0-beta').valid).toBe(false);
    expect(parse('2.19.0+build.5').valid).toBe(false);
    expect(parse('2.19.0-rc.1').reason).toContain('prerelease');
  });

  it('rejects malformed versions', () => {
    for (const raw of ['', '2.18', '2.18.x', 'latest', 'v', '2.18.0.0.1']) {
      expect(parse(raw).valid).toBe(false);
    }
  });
});

describe('release version comparator', () => {
  it('orders three-part releases', () => {
    expect(compareVersions(parse('2.17.7'), parse('2.18.0'))).toBe(-1);
    expect(compareVersions(parse('2.18.0'), parse('2.17.7'))).toBe(1);
    expect(compareVersions(parse('2.17.7'), parse('v2.17.7'))).toBe(0);
  });

  it('treats the hotfix .0 as equal to its base and orders higher hotfixes above', () => {
    expect(compareVersions(parse('2.18.0'), parse('2.18.0.0'))).toBe(0);
    expect(compareVersions(parse('2.18.0.0'), parse('2.18.0.1'))).toBe(-1);
    expect(compareVersions(parse('2.18.0.1'), parse('2.18.0'))).toBe(1);
  });
});

describe('release tag validator', () => {
  it('accepts three-part tags as stable releases', () => {
    const res = validateTag('v2.18.0', ['v2.17.7', 'v2.18.0']);
    expect(res.valid).toBe(true);
    expect(res.kind).toBe('stable');
  });

  it('accepts a four-part tag only while its three-part base exists', () => {
    const ok = validateTag('v2.18.0.1', ['v2.18.0', 'v2.18.0.1']);
    expect(ok.valid).toBe(true);
    expect(ok.kind).toBe('hotfix');

    const bad = validateTag('v2.19.0.0', ['v2.18.0', 'v2.18.0.1']);
    expect(bad.valid).toBe(false);
    expect(bad.reason).toContain('base 2.19.0');
  });

  it('rejects prerelease suffixes and out-of-range hotfixes', () => {
    expect(validateTag('v2.19.0-rc.1', ['v2.19.0']).valid).toBe(false);
    expect(validateTag('v2.18.0.6', ['v2.18.0']).valid).toBe(false);
  });

  it('validates a whole tag list and reports every ignored tag with a reason', () => {
    const { valid, ignored } = validateTagList(['2.17.7', '2.18.0', '2.18.0.1', '2.19.0.0', '2.20.0-rc.1']);
    expect(valid.map((v: { tag: string }) => v.tag)).toEqual(['2.17.7', '2.18.0', '2.18.0.1']);
    expect(ignored.map((i: { tag: string }) => i.tag)).toEqual(['2.19.0.0', '2.20.0-rc.1']);
    for (const i of ignored as Array<{ reason: string }>) {
      expect(i.reason.length).toBeGreaterThan(0);
    }
  });
});
