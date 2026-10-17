#!/usr/bin/env node
// verify-v2-80-0.mjs — release gate for "the report is addressable".
//
// Contracts locked:
//   1. Version slots: package.json 2.80.0 (3 slots) + verify script
//      registered; What's-New 2.80.0 leads the feed.
//   2. Pure module: deskReportDrawerParam (one drawer per link, request
//      wins, whitespace-only is no link), deskReportDrawerHref (encoded
//      address), deskReportResolveDeepLink (opens against the same read;
//      every refusal named — reviewer absence, doorless cap, no visits).
//   3. The view: the arrival link is read once at first render (SSR-safe),
//      resolves one-shot against the first read (deferred, same lint
//      hygiene), opens per family or refuses with the address stripped;
//      the URL mirrors the open drawer via replaceState (never navigation)
//      and is skipped while an arrival is unresolved.
//   4. The desk panel's drill-down carries the per-reviewer deep-link door
//      in the panel's emerald family; the clear button survives.
//   5. Prior anchors: walk, announcers, one-drawer rule, drawer CSVs,
//      report CSV, slice builders, 6 doors.

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
check('package.json version is >= 2.80.0', atLeast(PKG.version, '2.80.0'), PKG.version ?? 'missing');
check('mbumah.releaseVersion is >= 2.80.0', atLeast(PKG.mbumah?.releaseVersion, '2.80.0'));
check('mbumah.baseVersion is >= 2.80.0', atLeast(PKG.mbumah?.baseVersion, '2.80.0'));
check('verify:v2-80-0 script registered', PKG.scripts?.['verify:v2-80-0'] === 'node scripts/verify-v2-80-0.mjs');
const WN = read('src/lib/whats-new.ts') ?? '';
check('whats-new carries the 2.80.0 entry first', WN.includes("version: '2.80.0'") && WN.indexOf("version: '2.80.0'") < WN.indexOf("version: '2.79.0'"));
check('whats-new leads with the addressable story', WN.includes('The report is addressable') && WN.includes('Their file in the report'));
check('whats-new feed has grown to 80+ entries', (WN.match(/version: '[^']+'/g) || []).length >= 80);

console.log('== Pure module: the deep links ==');
const MOD = read('src/lib/hr/desk-report.ts') ?? '';
check('deskReportDrawerParam is exported', MOD.includes('export function deskReportDrawerParam('));
check('the parser rides URLSearchParams on a search string', MOD.includes('new URLSearchParams(search.startsWith') && MOD.includes("params.get('request')") && MOD.includes("params.get('reviewer')"));
check('one drawer per link: the request wins when both params ride', MOD.includes('const request = params.get(\'request\')?.trim();') && MOD.indexOf("if (request) return { kind: 'request', id: request };") < MOD.indexOf("if (reviewer) return { kind: 'reviewer', id: reviewer };"));
check('whitespace-only params are no link at all', MOD.includes("params.get('reviewer')?.trim()") && MOD.includes('if (request) return') && MOD.includes('if (reviewer) return'));
// v2.81.0: the href composes through deskReportReportHref (scope-aware), encoding inside the composer.
check('deskReportDrawerHref is exported and encodes the subject', MOD.includes('export function deskReportDrawerHref(') && MOD.includes('`${drawer.kind}=${encodeURIComponent(drawer.id)}`'));
check('DeskReportDeepLinkResult names the verdict and the sentence', MOD.includes('export interface DeskReportDeepLinkResult {') && MOD.includes('open: boolean;') && MOD.includes('announcement: string;'));
check('deskReportResolveDeepLink is exported', MOD.includes('export function deskReportResolveDeepLink('));
check('the reviewer verdict names the file and its size', MOD.includes("`The link opened ${link.id}'s file — ${row.visits} ${row.visits === 1 ? 'visit' : 'visits'} in this window.`"));
check('an absent reviewer is refused, by name', MOD.includes("`The link asked for ${link.id}'s file — no visits from ${link.id} in this window's report.`"));
check('a request door opens and names the file', MOD.includes("`The link opened ${subject.employeeName}'s ${subject.leaveTypeName}.`"));
check('a doorless file is refused WITH the cap named', MOD.includes("deskReportHasRequestDoor(data.topRequests, link.id)") && MOD.includes("not among the report's ${DESK_REPORT_TOP_REQUESTS_LIMIT} most-visited"));
check('a file with no visits is refused honestly', MOD.includes('drew no visits in this window'));
check('the resolver reads the ledger through the slice helper', MOD.includes('deskReportRequestLedger(data.ledger, link.id).length') && MOD.includes('deskReportRequestSubject(data.ledger, link.id)'));

console.log('== The view: the arrival answers, the URL mirrors ==');
const VIEW = read('src/components/org/desk-report-view.tsx') ?? '';
// v2.81.0: the view parses through deskReportArrival and composes through deskReportReportHref.
check('the view imports the parser, the href builder and the resolver', VIEW.includes('deskReportArrival,') && VIEW.includes('deskReportReportHref,') && VIEW.includes('deskReportResolveDeepLink,'));
check('the arrival is gated one-shot, parsed at resolve time (client-nav safe)', VIEW.includes('const deepLinkOpen = useRef(true);') && (VIEW.split('const resolve = setTimeout(')[1]?.split('}, 0);')[0] ?? '').includes('deepLinkOpen.current = false;'));
const resolveBody = VIEW.split('const resolve = setTimeout(')[1]?.split('}, 0);')[0] ?? '';
check('the link is read from the address bar at the first read', VIEW.includes('const arrival = deskReportArrival(window.location.search);') && VIEW.includes('deepLinkOpen.current = false; // a plain visit: nothing to answer'));
// v2.81.0: the drawer is named by arrival.drawer and resolves against the re-keyed read.
check('the arrival resolves against the first read', resolveBody.includes('deskReportResolveDeepLink(arrival.drawer, data)'));
check('the verdict opens the family the link named', resolveBody.includes("if (arrival.drawer.kind === 'reviewer') setOpenReviewer(arrival.drawer.id);") && resolveBody.includes('else setOpenRequest(arrival.drawer.id);'));
// v2.81.0: the refusal rides syncUrl — the scope it landed on stays, only the drawer param is dropped.
check('a refusal strips the address (the bar stops claiming it)', resolveBody.includes('syncUrl();'));
check('the verdict speaks through the walk announcer', resolveBody.includes('setWalkAnnouncement(result.announcement)'));
// v2.81.0 grew the mirror: the whole state (window/branch/drawer) now
// composes through syncUrl (deskReportReportHref) and the mirror effect
// rides it — the contracts keep their meaning, the slices follow the shape.
const syncBody = VIEW.split('const syncUrl = useCallback(')[1]?.split('}, [days, branch, openReviewer, openRequest]);')[0] ?? '';
const mirrorBody = VIEW.split('the WHOLE state does')[1]?.split('}, [syncUrl]);')[0] ?? '';
check('the mirror rides the pure href builder for both families', /deskReportReportHref\(\s+days,\s+branch,/.test(syncBody) && syncBody.includes("{ kind: 'request', id: openRequest }") && syncBody.includes("{ kind: 'reviewer', id: openReviewer }"));
check('a closed drawer is the base address', syncBody.includes(': null,'));
check('the mirror holds while the arrival gate is open', mirrorBody.includes('if (deepLinkOpen.current) return;'));
check('the mirror replaces state, never navigates', syncBody.includes("history.replaceState(null, '', href)") && !syncBody.includes('history.pushState') && !syncBody.includes('window.location.assign'));
const foot = VIEW.split('data-testid="desk-report-footnote"')[1]?.split('</p>')[0] ?? '';
check('the footnote says an open drawer rides the address bar', foot.includes('An open drawer rides the address bar — copy the URL and the same file opens for whoever follows.'));
check('the deep links add no doors — the walk stays 6', (VIEW.match(/data-desk-door\n/g) || []).length === 6);

console.log('== The desk panel hands the report a name ==');
const PANELS = read('src/components/org/panels.tsx') ?? '';
check('the drill-down bar carries the report deep link', PANELS.includes('data-testid="desk-drilldown-report-link"'));
// v2.81.0 moved the href onto the pure builder (deskReportDrawerHref) so
// the panel's branch filter rides along — the encoding now lives inside the
// composer (encodeURIComponent(id) in desk-report.ts).
check('the link hands the narrowed reviewer over encoded (via the pure builder since v2.81.0)', PANELS.includes("href={deskReportDrawerHref('reviewer', reviewer, { branch: branch ?? null })}") && PANELS.includes("title={`Open ${reviewer}'s file in the desk report`}") && MOD.includes('encodeURIComponent(drawer.id)'));
check('the door is dressed like one (emerald family, dark variants, focus ring)', PANELS.split('data-testid="desk-drilldown-report-link"')[1]?.split('</Link>')[0]?.includes('border-emerald-200 bg-white') && PANELS.includes('dark:border-emerald-500/30 dark:bg-slate-900/60 dark:text-emerald-300 dark:hover:border-emerald-400 dark:hover:bg-emerald-500/15') && PANELS.includes('focus-visible:ring-emerald-400'));
check('the clear button survives beside the door', PANELS.includes('data-testid="desk-drilldown-clear"') && PANELS.includes('onClick={clearReviewer}'));

console.log('== Prior anchors ==');
check('the walk announcer survives', VIEW.includes('data-testid="desk-report-walk-announcer"'));
check('the scope announcer survives', VIEW.includes('data-testid="desk-report-scope-announcer"'));
check('the drawers keep their one-drawer rule', VIEW.includes('const clearDrawers = useCallback(') && VIEW.includes('jumpToReviewer') && VIEW.includes('jumpToRequest'));
check('the drawer CSVs survive (filing family intact)', VIEW.includes('data-testid="desk-report-reviewer-csv"') && VIEW.includes('data-testid="desk-report-request-csv"') && MOD.includes('export function deskReportSliceToCsv(') && MOD.includes('export function deskReportSliceCsvFilename('));
check('the report\u2019s own CSV voice survives', VIEW.includes('data-testid="desk-report-csv"') && MOD.includes('export function deskReportToCsv('));

console.log(`\nv2.80.0 verification: ${fail === 0 ? 'ALL PASS' : 'FAILURES'} (${pass} pass, ${fail} fail)`);
if (fail > 0) { failures.forEach((f) => console.error(`  FAIL: ${f}`)); process.exit(1); }
