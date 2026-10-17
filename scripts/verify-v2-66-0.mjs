#!/usr/bin/env node
// verify-v2-66-0.mjs — release gate for "the console catches up on the news".
//
// Contracts locked:
//   1. ChangelogModal renders the shared WHATS_NEW feed (latest highlighted,
//      per-entry testids, honest subtitle) — the frozen v2.18.3 list is gone.
//   2. Backlog collapse: latest + 5 open, honest hidden count, expand/collapse.
//   3. Shared seen flag: "Got it" writes mbt_seen_version = APP_VERSION.
//   4. Footer pill: SSR-safe mount gate, reads the shared flag, emerald both modes.
//   5. Dark-mode completeness + contacts block + What's-New + version slots.

import { readFileSync } from 'node:fs';

const read = (p) => {
  try { return readFileSync(p, 'utf8'); } catch { return null; }
};

let pass = 0, fail = 0;
const failures = [];
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`[PASS] ${name}`); }
  else { fail++; failures.push(name); console.log(`[FAIL] ${name}${detail ? ` — ${detail}` : ''}`); }
};

console.log('== Version slots ==');
const PKG = JSON.parse(read('package.json') ?? '{}');
check('package.json version is 2.66.0 or newer', PKG.version && PKG.version >= '2.66.0', PKG.version ?? 'missing');
check('mbumah.releaseVersion is 2.66.0 or newer', PKG.mbumah?.releaseVersion && PKG.mbumah.releaseVersion >= '2.66.0');
check('mbumah.baseVersion is 2.66.0 or newer', PKG.mbumah?.baseVersion && PKG.mbumah.baseVersion >= '2.66.0');
check('verify:v2-66-0 script registered', PKG.scripts?.['verify:v2-66-0'] === 'node scripts/verify-v2-66-0.mjs');
const WN = read('src/lib/whats-new.ts') ?? '';
check('whats-new carries the 2.66.0 entry (newer entries may lead)', WN.includes("version: '2.66.0'") && WN.indexOf("version: '2.66.0'") < WN.indexOf("version: '2.65.0'"));
check('whats-new leads with the catch-up story', WN.includes('The console catches up on the news'));
check('whats-new feed has grown past the modal collapse (66+ entries)', (WN.match(/version: '[^']+'/g) || []).length >= 66);

console.log('== Modal contract: the real release feed ==');
const CHROME = read('src/components/org/chrome.tsx') ?? '';
check('WHATS_NEW imported (single source of truth)', CHROME.includes("WHATS_NEW") && CHROME.includes("from '@/lib/whats-new';")); // import list grows per release (reading-state helpers v2.75/v2.76)
check('APP_VERSION imported', CHROME.includes("import { APP_BUILD_LABEL, APP_VERSION } from '@/lib/version';"));
check('the static v2.18.3-era story is gone', !CHROME.includes('Organization Console joins the unified lineage'));
check('feed split newest-first (latest + older)', /const \[latest, \.\.\.older\] = WHATS_NEW;/.test(CHROME));
check('latest entry emerald-highlighted with dark variants', /latest\s*\?\s*'rounded-xl border border-emerald-200 bg-emerald-50\/60 p-3 dark:border-emerald-500\/30 dark:bg-emerald-500\/10'/.test(CHROME));
check('latest pill sparkles', CHROME.includes('data-testid="changelog-latest-pill"') && CHROME.includes('<Sparkles className="h-2.5 w-2.5" aria-hidden /> latest'));
check('per-entry testids keyed by version', /data-testid=\{`changelog-entry-\$\{entry\.version\}`\}/.test(CHROME));
check('subtitle names the running version', /You&apos;re on version \{APP_VERSION\}/.test(CHROME));
check('modal testid + scrollable', CHROME.includes('data-testid="changelog-modal"') && /max-h-\[85vh\] overflow-y-auto sm:max-w-xl/.test(CHROME));
check('older-entry styling carries dark variants', CHROME.includes("'rounded-xl border border-slate-200 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-800/30'"));
check('header wears the orange brand tile', CHROME.includes('bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-400'));

console.log('== Collapse contract ==');
check('latest + 5 render open', CHROME.includes('const INITIAL_VISIBLE = 5;') && /older\.slice\(0, INITIAL_VISIBLE\)/.test(CHROME));
check('hidden count is honest', /const hiddenCount = older\.length - visibleOlder\.length;/.test(CHROME) && /Show \{hiddenCount\} older release\{hiddenCount === 1 \? '' : 's'\}/.test(CHROME));
check('expand + collapse buttons present', CHROME.includes('data-testid="changelog-show-older"') && CHROME.includes('data-testid="changelog-show-fewer"'));
check('collapse only offers itself when expanded with backlog', /showAll && older\.length > INITIAL_VISIBLE \? \(/.test(CHROME));
check('collapse buttons carry focus rings (orange, both modes)', (CHROME.match(/focus-visible:ring-2 focus-visible:ring-orange-400 dark:border-slate-700 dark:bg-slate-900/g) || []).length >= 2);

console.log('== Shared seen flag contract ==');
check('flag key is the shared mbt_seen_version', CHROME.includes("const SEEN_VERSION_KEY = 'mbt_seen_version';"));
check('"Got it" writes APP_VERSION to the flag', /localStorage\.setItem\(SEEN_VERSION_KEY, APP_VERSION\);/.test(CHROME));
check('the write is guarded + closes the modal', /const markSeen = \(\) => \{\s*try \{[\s\S]{0,200}\} catch \{[\s\S]{0,200}onOpenChange\(false\);/.test(CHROME));
check('"Got it" + GitHub link testids present', CHROME.includes('data-testid="changelog-got-it"') && CHROME.includes('data-testid="changelog-github-link"'));
check('business contacts survive (dark-restyled)', CHROME.includes('Contacts: 0795 191 909 · 0759 963 601 · mbumahhardware@gmail.com - Juja Town') && CHROME.includes('dark:bg-slate-800/50 dark:text-slate-500'));

console.log('== Footer pill contract ==');
check('SSR-safe mount gate (useSyncExternalStore)', /const mounted = useSyncExternalStore\(subscribeNoop, mountedProbe, serverProbe\);/.test(CHROME) && CHROME.includes('const serverProbe = () => false;'));
check('pill reads the shared flag once mounted (deferred setState)', /if \(!mounted\) return;[\s\S]{0,300}setReleaseWaiting\(localStorage\.getItem\(SEEN_VERSION_KEY\) !== APP_VERSION\);/.test(CHROME));
check('pill renders only while release notes wait', /\{releaseWaiting && \(\s*<span data-testid="footer-changelog-pill"/.test(CHROME));
check('pill tooltip names the waiting version', /title=\{`Release notes for v\$\{APP_VERSION\} are waiting`\}/.test(CHROME));
check('Changelog button testid-ed', CHROME.includes('data-testid="footer-changelog-button"'));
check('pill emerald in both modes', /border border-emerald-300 bg-emerald-50 px-1 py-px text-\[9px\] font-semibold text-emerald-700 dark:border-emerald-500\/40 dark:bg-emerald-500\/15 dark:text-emerald-300/.test(CHROME));
check('footer dark-mode complete', CHROME.includes('dark:border-slate-800 dark:bg-slate-900') && CHROME.includes('dark:text-slate-400'));

console.log('== Prior-version anchors (no regression) ==');
check('v2.65.0 drill-down bar still in the panel', (read('src/components/org/panels.tsx') ?? '').includes('data-testid="desk-drilldown-bar"'));
check('v2.64.0 ledger model still present', (read('prisma/schema.prisma') ?? '').includes('model LeaveReviewVisit'));
check('tabs-shell auto-dialog still reads the same flag', (read('src/components/whats-new-dialog.tsx') ?? '').includes("const SEEN_VERSION_KEY = 'mbt_seen_version';"));
check('verify:v2-65-0 script still registered', PKG.scripts?.['verify:v2-65-0'] === 'node scripts/verify-v2-65-0.mjs');

console.log(`\nv2.66.0 verification: ${fail === 0 ? 'ALL PASS' : `${fail} FAILURE(S)`}`);
if (fail > 0) { failures.forEach((f) => console.log(`  FAIL: ${f}`)); process.exit(1); }
