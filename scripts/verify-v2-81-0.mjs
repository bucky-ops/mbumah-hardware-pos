#!/usr/bin/env node
// verify-v2-81-0.mjs — release gate for "the link carries the whole scope".
//
// Contracts locked:
//   1. Version slots: package.json 2.81.0 (3 slots) + verify script
//      registered; What's-New 2.81.0 leads the feed.
//   2. Pure module: deskReportReportHref (ONE composer — window/branch/
//      drawer in deterministic order, defaults leave no ink, invalid days
//      are not a scope), deskReportDrawerHref scope param (the panel door
//      hands its branch over), deskReportArrival (absent keys are null,
//      not defaults; only real windows count; request precedence intact).
//   3. The view: TWO-BEAT arrival — beat one re-keys ONLY what the link
//      carried (announced on the scope channel, drawers cleared), beat two
//      resolves the drawer against the RE-KEYED read (settle guard), the
//      drawer wears the from-the-link chip, a refusal keeps the scope and
//      strips only the drawer; the whole state mirrors into the URL through
//      syncUrl (replaceState, never navigation, gate held during arrival).
//   4. The desk panel: the drill-down door rides the pure builder and
//      hands its branch filter over with the name.
//   5. Prior anchors: walk, announcers, one-drawer rule, drawer CSVs,
//      report CSV, slice builders, deep-link resolver, 6 doors.

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
const atLeast = (v, base) => {
  if (typeof v !== 'string') return false;
  const [a, b, c] = v.split('.').map(Number);
  const [x, y, z] = base.split('.').map(Number);
  return a > x || (a === x && (b > y || (b === y && c >= z)));
};
check('package.json version is >= 2.81.0', atLeast(PKG.version, '2.81.0'), PKG.version ?? 'missing');
check('mbumah.releaseVersion is >= 2.81.0', atLeast(PKG.mbumah?.releaseVersion, '2.81.0'));
check('mbumah.baseVersion is >= 2.81.0', atLeast(PKG.mbumah?.baseVersion, '2.81.0'));
check('verify:v2-81-0 script registered', PKG.scripts?.['verify:v2-81-0'] === 'node scripts/verify-v2-81-0.mjs');
const WN = read('src/lib/whats-new.ts') ?? '';
check('whats-new carries the 2.81.0 entry first', WN.includes("version: '2.81.0'") && WN.indexOf("version: '2.81.0'") < WN.indexOf("version: '2.80.0'"));
check('whats-new leads with the whole-scope story', WN.includes('The link carries the whole scope') && WN.includes('two-beat') && WN.includes('from the link'));
check('whats-new feed has grown to 81+ entries', (WN.match(/version: '[^']+'/g) || []).length >= 81);

console.log('== Pure module: the whole scope rides ==');
const MOD = read('src/lib/hr/desk-report.ts') ?? '';
check('deskReportReportHref is exported (ONE composer)', MOD.includes('export function deskReportReportHref('));
check('defaults leave no ink (7 days / null branch / no drawer = bare path)', MOD.includes("return parts.length > 0 ? `/org/desk-report?${parts.join('&')}` : '/org/desk-report';"));
check('window rides only when real and non-default', MOD.includes("days && days !== DESK_REPORT_DEFAULT_DAYS") && MOD.includes('(DESK_REPORT_WINDOW_DAYS as readonly number[]).includes(days)'));
check('branch rides encoded', MOD.includes('`branch=${encodeURIComponent(branch)}`'));
check('one deterministic order: days, branch, drawer', MOD.indexOf('parts.push(`days=${days}`);') < MOD.indexOf('if (branch) parts.push(') && MOD.indexOf('if (branch) parts.push(') < MOD.indexOf('if (drawer) parts.push('));
check('deskReportDrawerHref takes the scope and rides the composer', MOD.includes('scope?: DeskReportScopeParams') && MOD.match(/export function deskReportDrawerHref\([\s\S]*?deskReportReportHref\(/) !== null);
check('DeskReportScopeParams names the optional keys', MOD.includes('export interface DeskReportScopeParams {') && MOD.includes('days?: number | null;') && MOD.includes('branch?: string | null;'));
check('deskReportArrival is exported', MOD.includes('export function deskReportArrival('));
check('absent keys are null, not defaults', MOD.includes('const rawDays = Number.parseInt(params.get(\'days\') ?? \'\', 10);') && MOD.includes("(DESK_REPORT_WINDOW_DAYS as readonly number[]).includes(rawDays) ? rawDays : null") && MOD.includes("params.get('branch')?.trim() || null"));
check('the drawer rides the v2.80 parser (request precedence intact)', MOD.includes('return { days, branch, drawer: deskReportDrawerParam(search) };'));
check('the module header tells the v2.81.0 story', MOD.includes('v2.81.0: the link carries the whole scope') && MOD.includes('honest two-beat'));

console.log('== The view: the two-beat arrival, the whole-state mirror ==');
const VIEW = read('src/components/org/desk-report-view.tsx') ?? '';
check('the view imports the arrival parser, the composer and the resolver', VIEW.includes('deskReportArrival,') && VIEW.includes('deskReportReportHref,') && VIEW.includes('deskReportResolveDeepLink,'));
check('the arrival is parsed at resolve time (client-nav safe), gated one-shot', VIEW.includes('const deepLinkOpen = useRef(true);') && VIEW.includes('const arrival = deskReportArrival(window.location.search);') && VIEW.includes('deepLinkOpen.current = false; // a plain visit: nothing to answer'));
const rekey = VIEW.split('const rekey = setTimeout(')[1]?.split('}, 0);')[0] ?? '';
check('beat one re-keys ONLY what the link carried', rekey.includes('setDays(arrival.days);') && rekey.includes('setBranch(arrival.branch);') && rekey.includes('clearDrawers();') && rekey.includes('setScopeAnnouncement(deskReportScopeAnnouncement(\'window\'') && rekey.includes("setScopeAnnouncement(deskReportScopeAnnouncement('branch', label));"));
check('the re-key announces before the numbers land (the v2.78 rule holds)', rekey.includes('setScopeAnnouncement(') && rekey.includes('setDays(') && rekey.indexOf('setScopeAnnouncement(') < rekey.indexOf('setDays('));
const beatTwo = VIEW.split('const resolve = setTimeout(')[1]?.split('}, 0);')[0] ?? '';
check('the settle guard waits for the re-keyed read', VIEW.includes('if (data.window.days !== days || (data.scope.branch ?? null) !== branch) return;'));
check('beat two opens the drawer the link named and wears the arrival', beatTwo.includes('deskReportResolveDeepLink(arrival.drawer, data)') && beatTwo.includes("if (arrival.drawer.kind === 'reviewer') setOpenReviewer(arrival.drawer.id);") && beatTwo.includes('setViaLink(true);'));
check('a refusal keeps the scope and strips only the drawer', beatTwo.includes('syncUrl();') && beatTwo.includes('setWalkAnnouncement(result.announcement)'));
const sync = VIEW.split('const syncUrl = useCallback(')[1]?.split('}, [days, branch, openReviewer, openRequest]);')[0] ?? '';
check('syncUrl composes window, branch and drawer through the pure builder', /deskReportReportHref\(\s+days,\s+branch,/.test(sync) && sync.includes("{ kind: 'request', id: openRequest }") && sync.includes("{ kind: 'reviewer', id: openReviewer }"));
check('the mirror replaces state, never navigates', sync.includes("history.replaceState(null, '', href)") && !sync.includes('history.pushState') && !sync.includes('window.location.assign'));
const mirror = VIEW.split('the WHOLE state does')[1]?.split('}, [syncUrl]);')[0] ?? '';
check('the mirror holds while the arrival gate is open', mirror.includes('if (deepLinkOpen.current) return;') && mirror.includes('syncUrl();'));
check('the link badge resets everywhere the via chips reset, only the arrival sets it', (VIEW.match(/setViaLink\(false\)/g) || []).length === 7 && (VIEW.match(/setViaLink\(true\)/g) || []).length === 1);
check('both drawers wear the from-the-link chip — a badge, not a door', VIEW.includes('data-testid="desk-report-reviewer-linkchip"') && VIEW.includes('data-testid="desk-report-request-linkchip"') && (VIEW.match(/from the link/g) || []).length >= 2 && VIEW.includes('<Link2 className="h-2.5 w-2.5" aria-hidden /> from the link'));
check('the chip wears the emerald family with dark variants', (VIEW.match(/border-emerald-200 bg-emerald-50 px-1\.5 py-px text-\[9px\] tracking-wide text-emerald-700 dark:border-emerald-500\/30 dark:bg-emerald-500\/10 dark:text-emerald-300/g) || []).length === 2);
check('the deep links add no doors — the walk stays 6', (VIEW.match(/data-desk-door\n/g) || []).length === 6);

console.log('== The desk panel hands the scope over ==');
const PANELS = read('src/components/org/panels.tsx') ?? '';
check('the panel imports the pure href builder', PANELS.includes("import { deskReportDrawerHref } from '@/lib/hr/desk-report';"));
check('the drill-down door rides the builder and hands the branch filter over', PANELS.includes("href={deskReportDrawerHref('reviewer', reviewer, { branch: branch ?? null })}") && PANELS.includes('data-testid="desk-drilldown-report-link"') && PANELS.includes("title={`Open ${reviewer}'s file in the desk report`}"));
check('the clear button survives beside the door', PANELS.includes('data-testid="desk-drilldown-clear"') && PANELS.includes('onClick={clearReviewer}'));

console.log('== Prior anchors ==');
check('the walk announcer survives', VIEW.includes('data-testid="desk-report-walk-announcer"'));
check('the scope announcer survives', VIEW.includes('data-testid="desk-report-scope-announcer"'));
check('the drawers keep their one-drawer rule', VIEW.includes('const clearDrawers = useCallback(') && VIEW.includes('jumpToReviewer') && VIEW.includes('jumpToRequest'));
check('the drawer CSVs survive (filing family intact)', VIEW.includes('data-testid="desk-report-reviewer-csv"') && VIEW.includes('data-testid="desk-report-request-csv"') && MOD.includes('export function deskReportSliceToCsv(') && MOD.includes('export function deskReportSliceCsvFilename('));
check('the report\u2019s own CSV voice survives', VIEW.includes('data-testid="desk-report-csv"') && MOD.includes('export function deskReportToCsv('));
check('the v2.80 resolver survives untouched', MOD.includes('export function deskReportResolveDeepLink(') && MOD.includes("`The link asked for ${link.id}'s file — no visits from ${link.id} in this window's report.`"));
check('the footnote says an open drawer rides the address bar', (VIEW.split('data-testid="desk-report-footnote"')[1] ?? '').split('</p>')[0].includes('An open drawer rides the address bar — copy the URL and the same file opens for whoever follows.'));

console.log(`\nv2.81.0 verification: ${fail === 0 ? 'ALL PASS' : 'FAILURES'} (${pass} pass, ${fail} fail)`);
if (fail > 0) { failures.forEach((f) => console.error(`  FAIL: ${f}`)); process.exit(1); }
