#!/usr/bin/env node
// ============================================================================
// MBUMAH HARDWARE POS — local background-job scheduler (replaces Vercel Cron)
// Fires /api/cron/hourly every hour and /api/cron/nightly when the local
// hour is 02, authenticated with the CRON_SECRET from .env.
// Run alongside the app (start-pos.ps1 / start-pos.sh do this for you).
// ============================================================================
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

const envPath = join(root, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}

const port = process.env.APP_PORT || '3000';
const base = `http://localhost:${port}`;
const secret = process.env.CRON_SECRET || '';
const headers = secret ? { 'x-cron-secret': secret } : {};

async function call(path) {
  const t = new Date().toISOString().slice(0, 19).replace('T', ' ');
  try {
    const r = await fetch(base + path, { headers });
    console.log(`[${t}] ${path} → ${r.status}`);
  } catch (e) {
    console.log(`[${t}] ${path} → app not reachable (${e.message})`);
  }
}

async function tick() {
  // hourly dispatcher: outbox pump, payments sweeper, eTIMS retry, debt reminders
  await call('/api/cron/hourly');
  // nightly dispatcher: reconciliation + retention (once per day, local 02:00)
  if (new Date().getHours() === 2) await call('/api/cron/nightly');
}

console.log(`Local background jobs → ${base} (hourly + nightly @02:00). Keep this window open.`);
await tick();
setInterval(tick, 60 * 60 * 1000);
