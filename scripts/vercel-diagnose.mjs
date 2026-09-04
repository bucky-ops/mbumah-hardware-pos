#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// READ-ONLY Vercel diagnostics (temporary — used to debug PR #15 build
// failures; deleted before merge). Never prints secret VALUES: env vars are
// listed as KEY + TARGETS only (Vercel returns encrypted entries without
// values), and every output line is scrubbed of connection-string URLs and
// bearer tokens.
//
// Env required (supplied by the workflow from repo secrets):
//   VERCEL_TOKEN, VERCEL_ORG_ID (team), GITHUB_SHA (set automatically)
// ─────────────────────────────────────────────────────────────────────────────

const TOKEN = process.env.VERCEL_TOKEN || '';
const ORG = process.env.VERCEL_ORG_ID || '';
const SHA = process.env.GITHUB_SHA || process.env.COMMIT_SHA || '';
const API = 'https://api.vercel.com';

if (!TOKEN) {
  console.log('VERCEL_TOKEN not available — nothing to diagnose.');
  process.exit(0);
}

function redact(s) {
  return String(s)
    .replace(/(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|file):\/\/[^\s"']+/gi, '<redacted-url>')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer <redacted>')
    .replace(new RegExp(TOKEN, 'g'), '<redacted-token>');
}

async function api(path) {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${API}${path}${sep}teamId=${ORG}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 400); }
  if (!res.ok) return { ok: false, status: res.status, body };
  return { ok: true, status: res.status, body };
}

function log(...parts) { console.log(...parts.map(redact)); }

async function main() {
  // 1) Find all mbumah projects
  const projRes = await api('/v9/projects?limit=50');
  const projects = (projRes.body && projRes.body.projects) || [];
  const matched = projects.filter((p) => /mbumah/i.test(p.name || ''));
  log(`\n=== Vercel projects matched: ${matched.map((p) => `${p.name}(${p.id})`).join(', ') || 'NONE'} ===`);
  if (!matched.length) return;

  for (const p of matched) {
    log(`\n########## PROJECT ${p.name} (${p.id}) ##########`);

    // 2) Env KEYS + targets only (no values — encrypted entries carry none)
    const envRes = await api(`/v9/projects/${p.id}/env?decrypt=false`);
    const envs = (envRes.body && envRes.body.envs) || [];
    log(`-- env keys (${envs.length}) [key | targets | type] --`);
    for (const e of envs) {
      log(`  ${e.key} | ${(e.target || []).join(',')} | ${e.type}`);
    }

    // 3) Recent deployments, match on commit SHA
    const depRes = await api(`/v6/deployments?projectId=${p.id}&limit=50`);
    const deps = (depRes.body && depRes.body.deployments) || [];
    const mine = deps.filter((d) => d.meta && d.meta.githubCommitSha === SHA);
    log(`-- deployments for ${SHA.slice(0, 8)}: ${mine.length} (of ${deps.length} recent) --`);
    for (const d of mine) {
      log(`  ${d.uid} | state=${d.state} | ready=${d.readyState} | url=${d.url}`);
    }

    // 4) Event logs for failed deployments
    for (const d of mine.filter((x) => ['ERROR', 'CANCELED', 'BUILDING'].includes(x.state) || x.readyState === 'ERROR')) {
      log(`\n-- deployment ${d.uid} (${d.state}/${d.readyState}) events --`);
      let events = null;
      for (const ver of ['v3', 'v2']) {
        const ev = await api(`/${ver}/deployments/${d.uid}/events?limit=300&builds=1`).catch(() => null);
        if (ev && ev.ok && Array.isArray(ev.body)) { events = ev.body; break; }
        if (ev && ev.ok && ev.body && Array.isArray(ev.body.events)) { events = ev.body.events; break; }
      }
      if (!events) { log('  (no event logs retrievable)'); continue; }
      const texts = events
        .map((e) => (typeof e === 'string' ? e : (e.payload && e.payload.text) || e.text || JSON.stringify(e)))
        .filter(Boolean);
      const flagged = texts.filter((t) =>
        /error|failed|prisma|P\d{4}|exit code|ECONN|ENOTFOUND|not found|abort/i.test(t));
      log(`  -- flagged lines (${flagged.length}/${texts.length}) --`);
      for (const t of flagged.slice(-80)) log(`  │ ${t.replace(/\n/g, '\n  │ ')}`);
      log('  -- last 25 lines --');
      for (const t of texts.slice(-25)) log(`  │ ${t.replace(/\n/g, '\n  │ ')}`);
    }
  }
}

main().catch((e) => { console.error('diagnose failed:', redact(e && e.message)); process.exit(0); });
