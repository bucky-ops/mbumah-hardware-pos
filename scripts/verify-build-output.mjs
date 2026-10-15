#!/usr/bin/env node
// ============================================================================
// MBUMAH HARDWARE POS - Build output verifier (v2.18.0.2)
// ============================================================================
// Mode-aware successor of the standalone-only check. Runs AFTER `next build`
// (and after the standalone assembly copy on Linux/Docker) and proves the
// output is COMPLETE before an installer finishes or an updater declares
// success and activates the release.
//
// Build modes (must match src/lib/build-mode.ts resolveStandaloneOutput):
//   standalone  : BUILD_STANDALONE=1 AND platform is not win32
//                 (Docker images and Linux no-Docker installs)
//   normal      : everything else (Windows laptops build normal output and
//                 start it with `next start`; Vercel uses its own pipeline)
//
// What it checks:
//   1. Build log scan (--build-log <path>, optional):
//        - "Failed to copy traced files", "EINVAL", "invalid argument,
//          copyfile"  -> FATAL when standalone was expected (this is the
//          Windows failure class that silently dropped chunks), IGNORABLE
//          when standalone was not expected (per policy the build cannot
//          have produced a standalone output at all).
//        - "Failed to compile", "> Build error occurred", "Type error:"
//          -> FATAL in every mode (a real build failure must never be
//          activated, even when the exit code was missed).
//   2. Output shape:
//        - standalone mode: delegates to scripts/verify-standalone.mjs
//          (server.js, assembled static assets, every referenced chunk).
//        - normal mode: .next/BUILD_ID and .next/server must exist, and a
//          stale .next/standalone/server.js is a HARD FAILURE (the launcher
//          prefers a standalone output when present - a leftover one would
//          boot the wrong, old server).
//
// Usage: node scripts/verify-build-output.mjs [--build-log <path>]
// Exit codes: 0 = verified, 1 = failed (callers MUST abort/rollback).
// No dependencies - runs with plain node on Windows/macOS/Linux.
// The scan helpers are exported so the vitest suite tests the real logic.
// ============================================================================

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

// -- Mode resolution (mirrors src/lib/build-mode.ts resolveStandaloneOutput) --
export function resolveBuildMode(env, platform) {
  const standaloneExpected = env.BUILD_STANDALONE === '1' && platform !== 'win32';
  return standaloneExpected ? 'standalone' : 'normal';
}

// -- Build log scanning ------------------------------------------------------
// v2.18.3.1: FATAL_EVERYWHERE also covers the failure classes the release
// integrity audit requires the updater to catch before activation:
// missing modules, webpack module resolution failures, and Prisma drift or
// runtime errors (P2022 "column does not exist", prisma:error log lines).
export const FATAL_EVERYWHERE = [
  /Failed to compile/,
  /> Build error occurred/,
  /^Type error:/m,
  /Cannot find module/,
  /Module not found/,
  /\bP2022\b/,
  /prisma:error/,
];
export const FATAL_STANDALONE_ONLY = [
  /Failed to copy traced files/i,
  /EINVAL/,
  /invalid argument, copyfile/i,
];

/**
 * Scan build log text for fatal problems.
 * Returns { fatal: string|null, ignored: string[] }.
 */
export function scanBuildLog(text, mode) {
  if (text == null) return { fatal: null, ignored: [] };
  for (const re of FATAL_EVERYWHERE) {
    const m = text.match(re);
    if (m) {
      return { fatal: `the build log contains a real build error ("${m[0]}")`, ignored: [] };
    }
  }
  for (const re of FATAL_STANDALONE_ONLY) {
    const m = text.match(re);
    if (m) {
      if (mode === 'standalone') {
        return {
          fatal:
            `the build log contains a standalone trace-copy failure ("${m[0]}") - ` +
            'the standalone output is incomplete and must not be activated',
          ignored: [],
        };
      }
      return {
        fatal: null,
        ignored: [
          `build log mentions "${m[0]}" - ignored: this build does not produce a ` +
            'standalone output (standalone trace-copy warnings cannot affect it)',
        ],
      };
    }
  }
  return { fatal: null, ignored: [] };
}

// -- CLI entry ---------------------------------------------------------------
function argValue(name) {
  const i = process.argv.indexOf(name);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  return null;
}

async function main() {
  const root = process.cwd();
  const mode = resolveBuildMode(process.env, process.platform);
  const buildLogPath = argValue('--build-log');
  let logFatal = null;
  const ignoredNotes = [];

  if (buildLogPath) {
    if (!existsSync(buildLogPath)) {
      console.error(`[FAIL] Build log not found: ${buildLogPath}`);
      process.exit(1);
    }
    let text = '';
    try {
      text = readFileSync(buildLogPath, 'utf8');
    } catch (e) {
      console.error(`[FAIL] Could not read the build log: ${e.message}`);
      process.exit(1);
    }
    const scan = scanBuildLog(text, mode);
    logFatal = scan.fatal;
    ignoredNotes.push(...scan.ignored);
  }

  function fail(messages) {
    console.error('');
    console.error('[FAIL] Build output verification FAILED:');
    for (const m of messages) console.error('  - ' + m);
    console.error('');
    console.error('The build output is incomplete. The updater/installer will not');
    console.error('activate it. Do NOT try to start the POS from this build.');
    process.exit(1);
  }

  const problems = [];
  if (logFatal) problems.push(logFatal);

  if (mode === 'standalone') {
    // Full standalone proof: server.js, assembled static assets, and every
    // referenced server chunk (scripts/verify-standalone.mjs, v2.18.0.1).
    if (logFatal) fail(problems); // no point walking a build that already failed
    const res = spawnSync(process.execPath, [join(root, 'scripts', 'verify-standalone.mjs')], {
      stdio: 'inherit',
    });
    if (res.status !== 0) {
      console.error('[FAIL] Standalone verification failed (see above).');
      process.exit(1);
    }
    for (const note of ignoredNotes) console.log(`[INFO] ${note}`);
    console.log(
      `[OK] Build output verified (mode: standalone, log: ${buildLogPath ? 'scanned' : 'not provided'}).`,
    );
    process.exit(0);
  }

  // Normal mode.
  const buildId = join(root, '.next', 'BUILD_ID');
  const serverDir = join(root, '.next', 'server');
  const staleStandalone = join(root, '.next', 'standalone', 'server.js');

  if (!existsSync(buildId)) {
    problems.push('.next/BUILD_ID is missing - the production build did not finish.');
  }
  if (!existsSync(serverDir)) {
    problems.push('.next/server is missing - no server build output was produced.');
  }
  if (existsSync(staleStandalone)) {
    problems.push(
      '.next/standalone/server.js exists but this build is NOT a standalone build. ' +
        'A stale standalone output from a previous release would be started instead of ' +
        'the new build. Delete .next/standalone and rebuild.',
    );
  }

  if (problems.length > 0) fail(problems);

  for (const note of ignoredNotes) console.log(`[INFO] ${note}`);
  console.log(
    `[OK] Build output verified (mode: normal, BUILD_ID present, server output present, ` +
      `log: ${buildLogPath ? 'scanned' : 'not provided'}).`,
  );
  process.exit(0);
}

// Only run the verification when executed directly (vitest imports the
// helpers without triggering a real verification of the dev checkout).
const isDirectRun =
  !!process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((e) => {
    console.error(`[FAIL] Build output verification crashed: ${e.message}`);
    process.exit(1);
  });
}
