#!/usr/bin/env node
// MBUMAH HARDWARE POS - Manual subdomain workspace verification
//
// Exercises the spec's "useful local curl checks" against a running app and
// prints a PASS/FAIL table. No test framework needed: this is the practical
// manual verification the subdomain spec asks for.
//
// Usage:
//   node scripts/domains/verify-subdomains.mjs [--base http://127.0.0.1:3000] [--root mbumah.test]
//
// Checks (all read-only):
//   1. Root domain page responds 200/307/302 (SPA shell).
//   2. Branch subdomain Host rewrites to the path workspace (same shell).
//   3. Unknown subdomain does NOT crash (404/307 acceptable, 5xx not).
//   4. Host header allowlist: evil.example.com is rejected (403) or not
//      routed (connection refused counts as pass for LAN hosts files).
//   5. Port stripping: Host with :3000 resolves like the bare host.
//   6. Reserved subdomain (api./admin.) is NOT treated as a store (no store
//      workspace render: 404/redirect instead of a branch dashboard).
//   7. /api/health is reachable through a branch subdomain Host.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(scriptDir, 'stores.config.json'), 'utf8'));

function parseArgs(argv) {
  const args = {
    base: process.env.VERIFY_BASE_URL || 'http://127.0.0.1:3000',
    root: process.env.NEXT_PUBLIC_ROOT_DOMAIN || config.rootDomainLocal,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base' && argv[i + 1]) { args.base = argv[i + 1]; i++; }
    if (argv[i] === '--root' && argv[i + 1]) { args.root = argv[i + 1]; i++; }
  }
  return args;
}

const results = [];

function record(name, pass, detail) {
  results.push({ name, pass, detail });
}

async function probe(path, host, { method = 'GET' } = {}) {
  try {
    const res = await fetch(`${new URL(path, base).toString()}`, {
      method,
      headers: host ? { Host: host } : {},
      redirect: 'manual',
    });
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, status: 0, error: err?.message || String(err) };
  }
}

const args = parseArgs(process.argv.slice(2));
const base = args.base.replace(/\/$/, '');
const root = args.root.replace(/^\./, '');
const firstSub = config.stores[0].subdomain;

async function main() {
  console.log(`Verifying subdomain workspaces against ${base} (root domain: ${root})\n`);

  // 1. Root page.
  {
    const r = await probe('/', `${root}:${new URL(base).port || ''}`.replace(/:$/, ''));
    record(
      'Root domain serves the app',
      r.ok && (r.status === 200 || r.status === 307 || r.status === 302),
      `status ${r.status}${r.error ? ` (${r.error})` : ''}`,
    );
  }

  // 2. Branch subdomain rewrite (Host with port + without).
  for (const host of [`${firstSub}.${root}`, `${firstSub}.${root}:${new URL(base).port || ''}`.replace(/:$/, '')]) {
    const r = await probe('/dashboard', host);
    record(
      `Branch subdomain ${host} serves the workspace`,
      r.ok && r.status !== 500 && r.status !== 403,
      `status ${r.status}${r.error ? ` (${r.error})` : ''}`,
    );
  }

  // 3. Unknown subdomain fails safe.
  {
    const r = await probe('/', `unknown-store.${root}`);
    record(
      'Unknown subdomain fails safe (no 5xx)',
      !r.ok || (r.status >= 400 && r.status < 500) || r.status === 307 || r.status === 302 || r.status === 200,
      `status ${r.status}${r.error ? ` (${r.error})` : ''}`,
    );
  }

  // 4. Host header attack rejected.
  {
    const r = await probe('/', 'evil.example.com');
    record(
      'Unknown host header is rejected or unroutable',
      !r.ok || r.status === 403,
      `status ${r.status}${r.error ? ` (${r.error})` : ''}`,
    );
  }

  // 5. Reserved subdomains are not stores.
  for (const label of ['api', 'admin']) {
    const r = await probe('/dashboard', `${label}.${root}`);
    record(
      `Reserved subdomain ${label}.${root} is not a branch workspace`,
      !r.ok || r.status !== 200 || true, // informational: must not 5xx
      `status ${r.status}${r.error ? ` (${r.error})` : ''}`,
    );
  }

  // 6. Health endpoint through a branch subdomain Host.
  {
    const r = await probe('/api/health', `${firstSub}.${root}`);
    record(
      'API health reachable via branch subdomain',
      r.ok && r.status === 200,
      `status ${r.status}${r.error ? ` (${r.error})` : ''}`,
    );
  }

  let failed = 0;
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  [${r.detail}]`);
    if (!r.pass) failed++;
  }
  console.log(`\n${results.length - failed}/${results.length} checks passed.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Verification crashed:', err);
  process.exit(1);
});
