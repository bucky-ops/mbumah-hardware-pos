#!/usr/bin/env node
// ============================================================================
// MBUMAH HARDWARE POS - Windows build safety wiring self-check (v2.18.0.2)
// ============================================================================
// Source-level guard that the Windows build-mode policy is actually WIRED
// everywhere it must be. The runtime behavior matrix (which output mode for
// which platform) is unit-tested in src/tests; this script proves the
// deploy scripts cannot silently drift back to the broken configuration:
//
//   - next.config.ts keeps the BUILD_STANDALONE policy import
//   - Windows updater/installer NEVER set BUILD_STANDALONE again
//   - Windows updater uses the release selector and the build verifier
//   - Windows updater kills the process TREE (next start is a child process)
//   - Linux updater keeps standalone (allowed there) and uses the verifier
//   - the launcher supports BOTH start modes (standalone + next start)
//   - Docker still builds standalone and copies prisma.config.ts
//
// Exit 0 = wiring intact. Exit 1 = a deploy script regressed.
// ============================================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];

function read(rel) {
  try {
    return readFileSync(join(root, rel), 'utf8');
  } catch {
    failures.push(`${rel} is missing`);
    return '';
  }
}

function check(rel, description, predicate) {
  const text = read(rel);
  if (!text) return;
  if (predicate(text)) {
    console.log(`[OK] ${rel}: ${description}`);
  } else {
    failures.push(`${rel}: ${description}`);
  }
}

// -- next.config.ts ----------------------------------------------------------
check(
  'next.config.ts',
  'imports the shared build-mode policy (resolveStandaloneOutput)',
  (t) => t.includes('resolveStandaloneOutput') && t.includes('src/lib/build-mode'),
);

// -- Windows updater ---------------------------------------------------------
check(
  'deploy/nodocker/update-pos.ps1',
  'no longer sets BUILD_STANDALONE on Windows',
  (t) => !/\$env:BUILD_STANDALONE\s*=\s*'1'/.test(t),
);
check(
  'deploy/nodocker/update-pos.ps1',
  'selects releases through scripts/release/select-release.mjs',
  (t) => t.includes('scripts/release/select-release.mjs'),
);
check(
  'deploy/nodocker/update-pos.ps1',
  'verifies the build output before declaring success',
  (t) => t.includes('scripts\\verify-build-output.mjs'),
);
check(
  'deploy/nodocker/update-pos.ps1',
  'stops the POS with a process-tree kill (taskkill /T) so the next start child dies too',
  (t) => t.includes('taskkill /PID $p.ProcessId /T /F'),
);
check(
  'deploy/nodocker/update-pos.ps1',
  'supports UPDATE_DRY_RUN',
  (t) => t.includes('UPDATE_DRY_RUN'),
);
check(
  'deploy/nodocker/update-pos.ps1',
  'writes the update state file',
  (t) => t.includes('update-state.json'),
);

// -- Windows installer ---------------------------------------------------------
check(
  'deploy/nodocker/install-nodocker.ps1',
  'no longer sets BUILD_STANDALONE on Windows',
  (t) => !/\$env:BUILD_STANDALONE\s*=\s*'1'/.test(t),
);
check(
  'deploy/nodocker/install-nodocker.ps1',
  'no longer assembles a standalone output on Windows',
  (t) => !t.includes('Assemble the standalone server'),
);
check(
  'deploy/nodocker/install-nodocker.ps1',
  'verifies the build output after the build',
  (t) => t.includes('scripts\\verify-build-output.mjs'),
);

// -- Linux updater (standalone stays allowed on Linux) -------------------------
check(
  'deploy/nodocker/update-pos.sh',
  'still builds standalone on Linux (BUILD_STANDALONE=1)',
  (t) => t.includes('BUILD_STANDALONE=1'),
);
check(
  'deploy/nodocker/update-pos.sh',
  'selects releases through scripts/release/select-release.mjs',
  (t) => t.includes('scripts/release/select-release.mjs'),
);
check(
  'deploy/nodocker/update-pos.sh',
  'verifies the build output before declaring success',
  (t) => t.includes('scripts/verify-build-output.mjs'),
);
check(
  'deploy/nodocker/update-pos.sh',
  'supports UPDATE_DRY_RUN',
  (t) => t.includes('UPDATE_DRY_RUN'),
);

// -- Launcher supports both start modes ----------------------------------------
check(
  'deploy/nodocker/start-server.mjs',
  'starts the standalone server when present',
  (t) => t.includes('.next/standalone/server.js') || t.includes('.next', 'standalone'),
);
check(
  'deploy/nodocker/start-server.mjs',
  'falls back to `next start` for normal builds (Windows laptops)',
  (t) => t.includes("'start'") && t.includes('BUILD_ID'),
);

// -- Docker keeps standalone and gets the Prisma config -------------------------
check(
  'Dockerfile',
  'still builds standalone for the container image',
  (t) => t.includes('BUILD_STANDALONE=1'),
);
check(
  'Dockerfile',
  'copies prisma.config.ts into the runner (seed command lives there since v2.18.0.2)',
  (t) => t.includes('/app/prisma.config.ts ./prisma.config.ts'),
);

if (failures.length > 0) {
  console.error('');
  console.error('[FAIL] Windows build safety wiring FAILED:');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('');
console.log('[OK] Windows build safety wiring intact across next.config, updater, installer, launcher and Docker.');
