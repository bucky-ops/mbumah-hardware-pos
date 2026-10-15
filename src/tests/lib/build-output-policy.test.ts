/**
 * Build output policy tests (v2.18.0.2 correction).
 *
 * Covers the two sides of the Windows build safety work:
 *  1. resolveStandaloneOutput (src/lib/build-mode.ts) - the exact policy
 *     matrix next.config.ts uses to decide the build output per platform.
 *  2. scanBuildLog (scripts/verify-build-output.mjs) - the build log scanner
 *     that must fail the updater on degraded output before activation.
 *
 * The release selector end-to-end scenarios run in
 * scripts/verify-release-selection.mjs (CI) and are asserted here too via a
 * small spawn for the incident case, so a regression fails BOTH gates.
 */
import { execFile } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { resolveStandaloneOutput } from '@/lib/build-mode';
import { resolveBuildMode, scanBuildLog } from '../../../scripts/verify-build-output.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(join(fileURLToPath(import.meta.url), '..', '..', '..', '..'));
const selector = join(repoRoot, 'scripts', 'release', 'select-release.mjs');

describe('standalone output policy (src/lib/build-mode.ts)', () => {
  it('defaults to a normal build when BUILD_STANDALONE is unset', () => {
    expect(resolveStandaloneOutput({}, 'win32')).toEqual({ output: undefined, mode: 'normal' });
    expect(resolveStandaloneOutput({ BUILD_STANDALONE: undefined }, 'linux')).toEqual({
      output: undefined,
      mode: 'normal',
    });
  });

  it('never builds standalone on Windows, even when forced, and warns', () => {
    const d = resolveStandaloneOutput({ BUILD_STANDALONE: '1' }, 'win32');
    expect(d.output).toBeUndefined();
    expect(d.mode).toBe('normal');
    expect(d.warning).toBeTruthy();
    expect(d.warning).toContain('Windows');
  });

  it('still builds standalone on Linux with BUILD_STANDALONE=1 (Docker path)', () => {
    const d = resolveStandaloneOutput({ BUILD_STANDALONE: '1' }, 'linux');
    expect(d).toEqual({ output: 'standalone', mode: 'standalone' });
  });
});

describe('build mode resolution (scripts/verify-build-output.mjs)', () => {
  it('matches the policy matrix', () => {
    expect(resolveBuildMode({ BUILD_STANDALONE: '1' }, 'linux')).toBe('standalone');
    expect(resolveBuildMode({ BUILD_STANDALONE: '1' }, 'win32')).toBe('normal');
    expect(resolveBuildMode({}, 'linux')).toBe('normal');
    expect(resolveBuildMode({ BUILD_STANDALONE: '0' }, 'linux')).toBe('normal');
  });
});

describe('build log scanner', () => {
  it('detects the Windows EINVAL trace-copy failure class as fatal in standalone mode', () => {
    const log =
      'next build\n' +
      'Failed to copy traced files.\n' +
      "EINVAL: invalid argument, copyfile '/repo/.next/server/chunks/[externals]_node:inspector_7a4283c6._.js'";
    const res = scanBuildLog(log, 'standalone');
    expect(res.fatal).toBeTruthy();
    expect(res.fatal).toContain('standalone trace-copy failure');
    expect(res.fatal).toContain('must not be activated');
    // A log with ONLY the EINVAL marker (no traced-files line) also fails.
    expect(scanBuildLog("EINVAL: invalid argument, copyfile '...'", 'standalone').fatal).toBeTruthy();
  });

  it('detects each of the three fatal patterns separately', () => {
    expect(scanBuildLog('warning: EINVAL while copying', 'standalone').fatal).toBeTruthy();
    expect(scanBuildLog('Failed to copy traced files for app/api/batch/route', 'standalone').fatal).toBeTruthy();
    expect(scanBuildLog('invalid argument, copyfile', 'standalone').fatal).toBeTruthy();
  });

  it('ignores standalone trace-copy warnings when standalone was not expected', () => {
    const res = scanBuildLog('Failed to copy traced files ... EINVAL', 'normal');
    expect(res.fatal).toBeNull();
    expect(res.ignored.length).toBe(1);
    expect(res.ignored[0]).toContain('does not produce');
  });

  it('fails on real build errors in every mode', () => {
    for (const mode of ['standalone', 'normal']) {
      expect(scanBuildLog('Failed to compile: /app/page.tsx', mode).fatal).toBeTruthy();
      expect(scanBuildLog('> Build error occurred', mode).fatal).toBeTruthy();
      expect(scanBuildLog('Type error: Property x does not exist', mode).fatal).toBeTruthy();
    }
  });

  it('fails on missing-module and module-resolution errors in every mode (v2.18.3.1)', () => {
    for (const mode of ['standalone', 'normal']) {
      expect(scanBuildLog("Error: Cannot find module 'next'", mode).fatal).toBeTruthy();
      expect(scanBuildLog('Module not found: Error: Can not resolve ./missing', mode).fatal).toBeTruthy();
    }
  });

  it('fails on Prisma drift and prisma error lines in every mode (v2.18.3.1)', () => {
    for (const mode of ['standalone', 'normal']) {
      expect(
        scanBuildLog('Error: P2022: The column `stores.slug` does not exist in the current database.', mode).fatal,
      ).toBeTruthy();
      expect(scanBuildLog('prisma:error Invalid `prisma.store.findMany()` invocation', mode).fatal).toBeTruthy();
    }
  });

  it('does not treat the P2022 digit sequence inside unrelated identifiers as fatal', () => {
    // \b guard: a hex id like "a1p2022x" or a plain number 2022 must not trip the scanner
    expect(scanBuildLog('digest 2022 recorded', 'normal').fatal).toBeNull();
    expect(scanBuildLog('commit 5p2022z ok', 'normal').fatal).toBeNull();
  });

  it('passes a clean build log', () => {
    const res = scanBuildLog('Compiled successfully\nRoute (app)                    Size\n', 'normal');
    expect(res.fatal).toBeNull();
    expect(res.ignored).toEqual([]);
  });

  it('handles empty input defensively', () => {
    expect(scanBuildLog(null, 'normal').fatal).toBeNull();
    expect(scanBuildLog('', 'standalone').fatal).toBeNull();
  });
});

describe('release selector incident guard (end-to-end)', () => {
  it('never selects a four-part tag as the next stable release (the 2.17.7 -> v2.18.0.0 incident)', async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        selector,
        '--current', '2.17.7',
        '--channel', 'stable',
        '--releases-json', '["2.17.7","2.18.0.0"]',
      ],
      { cwd: repoRoot },
    );
    const decision = JSON.parse(stdout.trim().split('\n').pop() as string);
    expect(decision.action).toBe('up-to-date');
    expect(decision.selected).toBe('v2.17.7');
    expect(decision.ignored).toEqual([
      expect.objectContaining({ tag: '2.18.0.0', reason: expect.stringContaining('base 2.18.0') }),
    ]);
  });

  it('selects the latest valid three-part release for stable channel', async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        selector,
        '--current', '2.17.7',
        '--channel', 'stable',
        '--releases-json', '["2.17.7","2.17.8","2.18.0","2.18.0.0","2.18.0.1"]',
      ],
      { cwd: repoRoot },
    );
    const decision = JSON.parse(stdout.trim().split('\n').pop() as string);
    expect(decision.action).toBe('update');
    expect(decision.selected).toBe('v2.18.0');
  });
});
