#!/usr/bin/env node
// ============================================================================
// MBUMAH HARDWARE POS — Remote Access Kit EDGE AGENT (v2.11.0)
// ============================================================================
// Runs on each store laptop (scheduled task "Mbumah POS Agent", every 15 min).
// Pull-only: it polls the private ops-log repo for a signed command targeted
// at THIS store, verifies it, executes the shipped updater/rollback scripts,
// and reports the result back to GitHub. NO inbound ports are ever opened.
//
//   tick():
//     1. fetch commands/<STORE_ID>.json            (device token, contents API)
//     2. verify HMAC sig + ±10 min freshness + replay window
//     3. dispatch:
//          update   → update-pos.ps1|.sh -Quiet [-Force] [-ToVersion v]
//          rollback → rollback-pos.ps1|.sh -ToVersion v
//          freeze   → write  mbumah-pos-data/frozen.flag (+ reason inside)
//          unfreeze → remove frozen.flag
//          tunnel   → honest not_supported result (Phase 3 of the RAK plan)
//     4. commit results/<store>/<ts>-<cmd>.json + append ledger/<store>.jsonl
//     5. heartbeat every 6 h (version + /api/health summary + frozen state)
//
// Every run is a single tick that exits — power cuts and offline laptops are
// normal states, never errors. The next tick (or shop opening, via the
// update-on-launch check) converges everything.
//
// Usage:  node deploy/nodocker/agent.mjs            (one tick — scheduled mode)
//         node deploy/nodocker/agent.mjs --status   (print config + state)
//
// Config comes from the kit .env:  STORE_ID, OPS_SIGNING_KEY, GITHUB_TOKEN
// (device token: ops-log Contents RW + main repo Contents Read), APP_PORT.
// See docs/REMOTE_ACCESS_KIT_PLAN.md and .env.nodocker.example.
// ============================================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostname } from 'node:os';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';

const AGENT_VERSION = '1.0.0';
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

// ── .env loader (same rules as cron-local.mjs) ──────────────────────────────
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

const OPS_REPO = process.env.OPS_LOG_REPO || 'bucky-ops/mbumah-ops-log';
const DEVICE_TOKEN = process.env.OPS_GITHUB_TOKEN || process.env.GITHUB_TOKEN || '';
const SIGNING_KEY = process.env.OPS_SIGNING_KEY || '';
const APP_PORT = process.env.APP_PORT || '3000';
const DATA_DIR = process.env.MBUMAH_DATA_DIR || join(process.env.USERPROFILE || process.env.HOME || '.', 'mbumah-pos-data');
const STATE_FILE = join(DATA_DIR, 'agent-state.json');
const FROZEN_FLAG = join(DATA_DIR, 'frozen.flag');

const HEARTBEAT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 h
const FRESHNESS_MS = 10 * 60 * 1000;              // commands expire after 10 min
const UPDATE_TIMEOUT_MS = 25 * 60 * 1000;         // npm ci + build can be slow
const IS_WINDOWS = process.platform === 'win32';

function storeId() {
  const raw = process.env.STORE_ID || hostname();
  return raw.toLowerCase().replace(/[^a-z0-9._-]/g, '-').slice(0, 80) || 'unknown-store';
}
const STORE = storeId();

// ── Tiny helpers ─────────────────────────────────────────────────────────────
const log = (...a) => console.log(`[RAK-AGENT ${new Date().toISOString()}]`, ...a);

function readState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { lastCommandId: null, lastHeartbeatAt: null };
  }
}
function writeState(state) {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {
    log(`[WARN] could not persist state: ${e.message}`);
  }
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(',')}}`;
}

function verifySignature(payload, sig) {
  if (!SIGNING_KEY || typeof sig !== 'string') return false;
  try {
    const provided = sig.replace(/^hmac-sha256:/i, '').trim().toLowerCase();
    const expected = createHmac('sha256', SIGNING_KEY).update(canonicalJson(payload)).digest('hex');
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function gh(path, init = {}) {
  const run = async () => {
    try {
      const r = await fetch(`https://api.github.com/repos/${OPS_REPO}${path}`, {
        method: init.method || 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${DEVICE_TOKEN}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(15000),
      });
      const text = await r.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = null; }
      return { ok: r.ok, status: r.status, data };
    } catch (e) {
      return { ok: false, status: 0, data: null, error: e.message };
    }
  };
  let res = await run();
  if (!res.ok && (res.status >= 500 || res.status === 0)) {
    await new Promise((r) => setTimeout(r, 1500));
    res = await run();
  }
  return res;
}

async function putFile(path, content, message) {
  const existing = await gh(`/contents/${encodePath(path)}`);
  const body = {
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    ...(existing.ok && existing.data?.sha ? { sha: existing.data.sha } : {}),
  };
  return gh(`/contents/${encodePath(path)}`, { method: 'PUT', body });
}

async function deleteFile(path, message) {
  const existing = await gh(`/contents/${encodePath(path)}`);
  if (existing.status === 404) return { ok: true };
  if (!existing.ok) return existing;
  return gh(`/contents/${encodePath(path)}`, {
    method: 'DELETE',
    body: { message, sha: existing.data.sha },
  });
}

function encodePath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}

// ── Command execution ────────────────────────────────────────────────────────

function runScript(args, timeoutMs) {
  return new Promise((resolve) => {
    const file = IS_WINDOWS ? 'powershell.exe' : 'bash';
    const script = IS_WINDOWS
      ? join(root, 'deploy', 'nodocker', args.script + '.ps1')
      : join(root, 'deploy', 'nodocker', args.script + '.sh');
    const spawnArgs = IS_WINDOWS
      ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args.flags]
      : [script, ...args.flags];

    let stdout = '';
    let stderr = '';
    let settled = false;
    let child;
    try {
      child = spawn(file, spawnArgs, { cwd: root, windowsHide: true });
    } catch (e) {
      resolve({ code: -1, tail: `spawn failed: ${e.message}` });
      return;
    }
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { child.kill('SIGKILL'); } catch { }
        resolve({ code: -1, tail: `timed out after ${Math.round(timeoutMs / 60000)} min` });
      }
    }, timeoutMs);

    child.stdout?.on('data', (d) => { stdout += d; if (stdout.length > 20000) stdout = stdout.slice(-10000); });
    child.stderr?.on('data', (d) => { stderr += d; if (stderr.length > 20000) stderr = stderr.slice(-10000); });
    child.on('error', (e) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      resolve({ code: -1, tail: e.message });
    });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      const tail = (stdout + '\n' + stderr).trim().split(/\r?\n/).slice(-8).join(' | ');
      resolve({ code: code ?? -1, tail: tail.slice(0, 600) });
    });
  });
}

function isFrozen() {
  try { return existsSync(FROZEN_FLAG); } catch { return false; }
}
function setFrozen(reason) {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(FROZEN_FLAG, JSON.stringify({ reason: reason || '', at: new Date().toISOString() }, null, 2), 'utf8');
    return true;
  } catch { return false; }
}
function clearFrozen() {
  try { if (existsSync(FROZEN_FLAG)) unlinkSync(FROZEN_FLAG); return true; } catch { return false; }
}

async function executeCommand(cmd) {
  const type = cmd.type;
  const flags = [];
  if (type === 'update') {
    flags.push('-Quiet');
    if (cmd.force) flags.push('-Force');
    if (cmd.version) flags.push('-ToVersion', String(cmd.version));
    if (isFrozen()) return { outcome: 'rejected_frozen', detail: 'store is frozen — run Unfreeze first' };
    const r = await runScript({ script: 'update-pos', flags }, UPDATE_TIMEOUT_MS);
    return {
      outcome: r.code === 0 ? 'success' : 'failed',
      detail: `exit ${r.code}${r.tail ? `: ${r.tail}` : ''}`,
      toVersion: cmd.version || null,
    };
  }
  if (type === 'rollback') {
    if (!cmd.version) return { outcome: 'failed', detail: 'rollback command missing version' };
    if (isFrozen()) return { outcome: 'rejected_frozen', detail: 'store is frozen — rollback blocked too' };
    const r = await runScript({ script: 'rollback-pos', flags: ['-ToVersion', String(cmd.version), '-Quiet'].filter(Boolean) }, UPDATE_TIMEOUT_MS);
    return {
      outcome: r.code === 0 ? 'success' : 'failed',
      detail: `exit ${r.code}${r.tail ? `: ${r.tail}` : ''}`,
      toVersion: cmd.version,
    };
  }
  if (type === 'freeze') {
    const ok = setFrozen(cmd.reason || cmd['issued-by'] || '');
    return { outcome: ok ? 'success' : 'failed', detail: ok ? `frozen: ${cmd.reason || 'no reason given'}` : 'could not write frozen.flag' };
  }
  if (type === 'unfreeze') {
    const ok = clearFrozen();
    return { outcome: ok ? 'success' : 'failed', detail: ok ? 'unfrozen' : 'could not remove frozen.flag' };
  }
  if (type === 'tunnel') {
    return { outcome: 'not_supported', detail: 'remote-view tunnels arrive in RAK Phase 3 (v2.12.0)' };
  }
  return { outcome: 'not_supported', detail: `unknown command type "${type}"` };
}

// ── Reporting ────────────────────────────────────────────────────────────────

function baseLine(event, extra = {}) {
  return {
    ts: new Date().toISOString(),
    event,
    storeId: STORE,
    agentVersion: AGENT_VERSION,
    ...extra,
  };
}

async function commitResult(commandId, outcome, detail, extra = {}) {
  const line = baseLine('result', {
    commandId, outcome, detail, ...extra,
  });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = `results/${STORE}/${stamp}-${commandId || 'manual'}.json`;
  const put = await putFile(path, `${JSON.stringify(line, null, 2)}\n`, `ops(${STORE}): ${outcome} ${commandId || ''}`.trim());
  // Ledger line mirrors the result (append-only history the console reads)
  // and carries the result commit URL so the console can deep-link to GitHub.
  if (put.ok && put.data?.commit?.sha) {
    line.commitSha = put.data.commit.sha;
    line.commitUrl = `https://github.com/${OPS_REPO}/commit/${put.data.commit.sha}`;
  }
  if (put.ok) {
    await appendLedger(line);
  } else {
    log(`[WARN] result commit failed: ${JSON.stringify(put.data?.message ?? put.error ?? 'unknown')}`);
  }
}

async function appendLedger(line) {
  const path = `ledger/${STORE}.jsonl`;
  const existing = await gh(`/contents/${encodePath(path)}`);
  let prior = '';
  if (existing.ok && existing.data?.content) {
    prior = Buffer.from(existing.data.content, 'base64').toString('utf8').trimEnd();
  }
  const updated = `${prior ? prior + '\n' : ''}${JSON.stringify(line)}\n`;
  return putFile(path, updated, `ops(${STORE}): ${line.event}`);
}

async function heartbeat(state, extra = {}) {
  let version = null;
  let health = null;
  try {
    const r = await fetch(`http://127.0.0.1:${APP_PORT}/api/health`, { signal: AbortSignal.timeout(4000) });
    if (r.ok) {
      const h = await r.json();
      version = h.version ?? null;
      health = h.status ?? (h.checks?.database_stats?.status === 'ok' ? 'ok' : null);
    }
  } catch { /* app not running — heartbeat still records liveness + version */ }
  if (!version) {
    try {
      version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version ?? null;
    } catch { /* keep null */ }
  }
  const line = baseLine('heartbeat', { version, health, frozen: isFrozen(), ...extra });
  const res = await appendLedger(line);
  if (res.ok) {
    state.lastHeartbeatAt = line.ts;
    writeState(state);
    log(`heartbeat sent (v${version ?? '?'}, health=${health ?? 'unknown'}, frozen=${isFrozen()})`);
  } else {
    log('[WARN] heartbeat commit failed (will retry next tick)');
  }
}

// ── Main tick ────────────────────────────────────────────────────────────────

async function tick() {
  if (!DEVICE_TOKEN) {
    log('no GITHUB_TOKEN/OPS_GITHUB_TOKEN in .env — agent idle (RAK not configured on this kit).');
    return;
  }
  const state = readState();
  const dueForHeartbeat =
    !state.lastHeartbeatAt ||
    Date.now() - new Date(state.lastHeartbeatAt).getTime() > HEARTBEAT_INTERVAL_MS;

  // 1. Fetch the pending command for this store (404 = nothing pending).
  const cmdRes = await gh(`/contents/commands/${encodePath(STORE)}.json`);
  if (cmdRes.status === 404 || cmdRes.status === 0) {
    // 0 = offline; either way there is nothing actionable this tick.
    if (dueForHeartbeat) await heartbeat(state);
    return;
  }
  if (!cmdRes.ok) {
    log(`command fetch failed (HTTP ${cmdRes.status}) — will retry next tick`);
    if (dueForHeartbeat) await heartbeat(state);
    return;
  }

  let cmd;
  try {
    cmd = JSON.parse(Buffer.from(cmdRes.data.content, 'base64').toString('utf8'));
  } catch (e) {
    await commitResult('malformed', 'rejected_signature', `command file unparseable: ${e.message}`);
    await deleteFile(`commands/${STORE}.json`, `ops(${STORE}): discard malformed command`);
    return;
  }

  const commandId = cmd['command-id'] || 'unknown';
  log(`command ${commandId} (${cmd.type}) from ${cmd['issued-by']}`);

  // 2. Verify authenticity + freshness + replay.
  const { sig, ...payload } = cmd;
  if (!verifySignature(payload, sig)) {
    log('[REJECT] bad signature — reporting and discarding');
    await commitResult(commandId, 'rejected_signature', 'HMAC verification failed', { type: cmd.type });
    await deleteFile(`commands/${STORE}.json`, `ops(${STORE}): discard rejected (bad signature) ${commandId}`);
    return;
  }
  const issuedAge = Date.now() - new Date(cmd['issued-at']).getTime();
  if (!Number.isFinite(issuedAge) || Math.abs(issuedAge) > FRESHNESS_MS) {
    await commitResult(commandId, 'rejected_freshness', `command age ${Math.round((issuedAge || 0) / 60000)} min exceeds 10 min window`, { type: cmd.type });
    await deleteFile(`commands/${STORE}.json`, `ops(${STORE}): discard stale ${commandId}`);
    return;
  }
  if (state.lastCommandId === commandId) {
    await commitResult(commandId, 'duplicate', 'command already executed (replay window)');
    await deleteFile(`commands/${STORE}.json`, `ops(${STORE}): discard replay ${commandId}`);
    return;
  }

  // 3. Execute + 4. report.
  const result = await executeCommand(cmd);
  log(`outcome: ${result.outcome} — ${result.detail}`);
  await commitResult(commandId, result.outcome, result.detail, {
    type: cmd.type,
    fromVersion: state.lastVersion || null,
    toVersion: result.toVersion || null,
  });

  state.lastCommandId = commandId;
  state.lastVersion = result.toVersion || state.lastVersion;
  writeState(state);

  await deleteFile(`commands/${STORE}.json`, `ops(${STORE}): clear executed ${commandId}`);

  // A result doubles as a heartbeat for freshness purposes.
  state.lastHeartbeatAt = new Date().toISOString();
  writeState(state);
}

// ── Entry ────────────────────────────────────────────────────────────────────
const arg = process.argv[2] || '';
if (arg === '--status') {
  console.log(JSON.stringify({
    storeId: STORE, repo: OPS_REPO, agentVersion: AGENT_VERSION,
    signingKeyConfigured: !!SIGNING_KEY, deviceTokenConfigured: !!DEVICE_TOKEN,
    frozen: isFrozen(), state: readState(), dataDir: DATA_DIR,
  }, null, 2));
} else {
  await tick().catch((e) => {
    log(`tick crashed (agent stays alive for the next scheduled run): ${e.message}`);
    process.exitCode = 0; // scheduled task must never look "failed" to Windows
  });
}
