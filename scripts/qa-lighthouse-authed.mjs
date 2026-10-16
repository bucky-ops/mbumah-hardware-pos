#!/usr/bin/env node
// Lighthouse measurement on an authenticated page (v2.23.0).
//
// Recipe: launch Chrome with a persistent profile + CDP, seed the SPA's
// non-httpOnly mbt_token cookie via document.cookie on an origin page, then
// Lighthouse --port connects to the SAME instance so its own tabs share the
// cookie jar (extra-headers do not persist across fetches reliably).
//
// Usage: node scripts/qa-lighthouse-authed.mjs <url> <token> [out.json]

import { spawn } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';

const [, , url, token, outPath = '/tmp/lh-authed.json'] = process.argv;
if (!url || !token) {
  console.error('usage: node scripts/qa-lighthouse-authed.mjs <url> <mbt_token> [out.json]');
  process.exit(1);
}

const CHROME = process.env.CHROME_PATH ?? '/home/z/.agent-browser/browsers/chrome-155.0.8059.39/chrome';
const PORT = 9333;
const PROFILE = '/tmp/lh-chrome-profile';
const origin = new URL(url).origin;

rmSync(PROFILE, { recursive: true, force: true });

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdpSend(wsUrl, id, method, params = {}) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  const result = await new Promise((res) => {
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === id) res(msg);
    };
    ws.send(JSON.stringify({ id, method, params }));
  });
  ws.close();
  return result;
}

try {
  // 1. Wait for the CDP endpoint.
  let targets = null;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      targets = await res.json();
      if (targets.length > 0) break;
    } catch {
      /* chrome still booting */
    }
    await wait(300);
  }
  const page = targets?.find((t) => t.type === 'page');
  if (!page) throw new Error('No CDP page target found');

  // 2. Navigate the seeded tab to the origin and inject the session cookie.
  await cdpSend(page.webSocketDebuggerUrl, 1, 'Page.enable');
  await cdpSend(page.webSocketDebuggerUrl, 2, 'Page.navigate', { url: `${origin}/login` });
  await wait(2500);
  await cdpSend(page.webSocketDebuggerUrl, 3, 'Runtime.evaluate', {
    expression: `document.cookie='mbt_token=${token}; path=/'; document.cookie`,
    returnByValue: true,
  });

  // 3. Run Lighthouse against the same Chrome instance.
  const lh = spawn('npx', [
    '--yes',
    'lighthouse@12',
    url,
    `--port=${PORT}`,
    '--chrome-flags=--headless=new --no-sandbox --disable-dev-shm-usage',
    '--only-categories=performance,accessibility,best-practices,seo',
    '--output=json',
    `--output-path=${outPath}`,
    '--quiet',
  ], { cwd: '/home/z/ems', stdio: ['ignore', 'inherit', 'inherit'] });

  const code = await new Promise((res) => lh.on('close', res));
  if (code !== 0) throw new Error(`Lighthouse exited ${code}`);
  console.log(`OK ${outPath}`);
} finally {
  chrome.kill('SIGKILL');
}
