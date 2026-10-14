#!/usr/bin/env node
// ============================================================================
// MBUMAH HARDWARE POS - Standalone build verifier (v2.18.0.1)
// ============================================================================
// Runs AFTER `next build` (BUILD_STANDALONE=1) and the standalone assembly
// copy steps in the installers/updaters. Proves the standalone output is
// COMPLETE before an installer finishes or an updater declares success:
//
//   1. .next/standalone/server.js exists
//   2. .next/standalone/.next/static exists (client assets were assembled)
//   3. EVERY server chunk referenced by any route/runtime file inside
//      .next/standalone actually exists there.
//
// Check 3 is the generic safety net for the Windows failure class seen in
// the field (v2.17.6/v2.17.7 reports): Turbopack emits async-imported
// node builtins as separate chunk files named after the specifier
// ("[externals]_node:inspector_7a4283c6._.js"). NTFS forbids colons, so
// the standalone trace-copy failed with EINVAL and those routes lost their
// chunks at runtime - while the updater still printed "UPDATE COMPLETE".
// With this verifier, an incomplete standalone build is a hard failure:
// the updater rolls back instead of restarting into a broken server.
//
// Exit codes: 0 = complete, 1 = incomplete (callers MUST abort/rollback).
// No dependencies - runs with plain node on Windows/macOS/Linux.
// ============================================================================

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const standaloneDir = join(root, '.next', 'standalone');
const serverJs = join(standaloneDir, 'server.js');
const standaloneServerDir = join(standaloneDir, '.next', 'server');
const standaloneChunksDir = join(standaloneServerDir, 'chunks');
const standaloneStaticDir = join(standaloneDir, '.next', 'static');

function fail(messages) {
  console.error('');
  console.error('[FAIL] Standalone build verification FAILED:');
  for (const m of messages) console.error('  - ' + m);
  console.error('');
  console.error('The build output is incomplete. The updater/installer will not');
  console.error('use it. Do NOT try to start the POS from this build.');
  process.exit(1);
}

const problems = [];

// -- 1. server.js ------------------------------------------------------------
if (!existsSync(serverJs)) {
  problems.push(
    'server.js missing in .next/standalone - the production build did not produce a standalone server (build failed or was interrupted).',
  );
}

// -- 2. client static assets -------------------------------------------------
if (!existsSync(standaloneStaticDir)) {
  problems.push(
    '.next/standalone/.next/static missing - client assets were not assembled into the standalone output.',
  );
}

// -- 3. every referenced server chunk exists ---------------------------------
const referenced = new Set();
let scannedFiles = 0;
const CHUNK_REF_RE = /server\/chunks\/([^"'\s\\)]+?\.(?:js|mjs|cjs|wasm))/g;

if (existsSync(standaloneServerDir)) {
  const queue = [standaloneServerDir];
  while (queue.length > 0) {
    const dir = queue.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        queue.push(full);
      } else if (entry.isFile() && /\.(js|mjs|cjs)$/.test(entry.name)) {
        let text;
        try {
          text = readFileSync(full, 'utf8');
        } catch {
          continue;
        }
        scannedFiles += 1;
        let m;
        CHUNK_REF_RE.lastIndex = 0;
        while ((m = CHUNK_REF_RE.exec(text)) !== null) {
          referenced.add(m[1]);
        }
      }
    }
  }
}

const missing = [];
for (const name of referenced) {
  if (!existsSync(join(standaloneChunksDir, name))) {
    missing.push(name);
  }
}

if (missing.length > 0) {
  const shown = missing.slice(0, 8).join('\n  ');
  problems.push(
    `${missing.length} server chunk(s) referenced by routes are MISSING from .next/standalone (Windows EINVAL copyfile class of failure):\n  ${shown}${missing.length > 8 ? '\n  ...' : ''}`,
  );
}

if (problems.length > 0) fail(problems);

console.log(
  `[OK] Standalone build verified: server.js present, ${scannedFiles} server files scanned, ` +
    `all ${referenced.size} referenced chunks present, static assets assembled.`,
);
