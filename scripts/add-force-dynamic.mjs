/**
 * scripts/add-force-dynamic.mjs
 *
 * One-shot script: adds `export const dynamic = 'force-dynamic';` to every
 * src/app/api/<path>/route.ts file that doesn't already have it. Inserts the
 * export AFTER the last `import` statement (so it lands at module top-level
 * below imports, before any other code).
 *
 * Idempotent: skips files that already export `dynamic`.
 *
 * Why force-dynamic?
 *   Next.js 16 App Router statically analyzes API routes during `next build`.
 *   If a route doesn't opt out, the build tries to evaluate the route module
 *   to collect page data — which imports `@/lib/db` → `@prisma/client` →
 *   tries to read `DATABASE_URL` at build time. With the SKIP_ENV_VALIDATION
 *   flag this no longer crashes, but the route still gets prerendered as a
 *   static artifact (wrong for an API that returns live data). Forcing
 *   dynamic ensures the route is always server-rendered per-request.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_ROOT = join(__dirname, '..', 'src', 'app', 'api');

const FORCE_DYNAMIC = "export const dynamic = 'force-dynamic';";

async function findRouteFiles(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await findRouteFiles(full)));
    } else if (entry.name === 'route.ts' || entry.name === 'route.tsx') {
      out.push(full);
    }
  }
  return out;
}

function hasForceDynamic(source) {
  // Match `export const dynamic = 'force-dynamic';` with any quote style.
  return /export\s+const\s+dynamic\s*=\s*['"]force-dynamic['"]\s*;?/.test(source);
}

function injectForceDynamic(source) {
  // Find the last `import ... from '...';` line.
  const lines = source.split('\n');
  let lastImportIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^import\s/.test(lines[i]) || /^\s*\}\s*from\s+['"]/.test(lines[i])) {
      lastImportIdx = i;
    }
  }
  if (lastImportIdx === -1) {
    // No imports — prepend at the very top.
    return `${FORCE_DYNAMIC}\n\n${source}`;
  }
  // Insert after the last import, with a blank line before and after.
  lines.splice(lastImportIdx + 1, 0, '', FORCE_DYNAMIC, '');
  return lines.join('\n');
}

async function main() {
  const files = await findRouteFiles(API_ROOT);
  console.info(`[add-force-dynamic] Found ${files.length} route files.`);

  let added = 0;
  let skipped = 0;
  const errors = [];

  for (const file of files) {
    try {
      const source = await readFile(file, 'utf8');
      if (hasForceDynamic(source)) {
        skipped++;
        continue;
      }
      const updated = injectForceDynamic(source);
      await writeFile(file, updated, 'utf8');
      added++;
      console.info(`  ✓ ${file.replace(API_ROOT, '<api>')}`);
    } catch (err) {
      errors.push({ file, err });
      console.error(`  ✗ ${file}: ${err.message}`);
    }
  }

  console.info(`\n[add-force-dynamic] Done. Added: ${added}. Skipped (already had it): ${skipped}. Errors: ${errors.length}.`);
  if (errors.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
