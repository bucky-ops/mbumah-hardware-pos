#!/usr/bin/env node
// verify-v2-78-0.mjs — release gate for "the scope speaks the keyboard".
//
// Contracts locked:
//   1. Version slots: package.json 2.78.0 (3 slots) + verify script
//      registered; What's-New 2.78.0 leads the feed.
//   2. Pure module: deskReportChipStep (APG roving step — arrows wrap,
//      Home/End jump, unhandled keys and bad indices move nothing) and
//      deskReportScopeAnnouncement (window / named branch / all-branches
//      sentences).
//   3. The view: roving tabindex on BOTH chip groups, the shared chipNav
//      handler on every chip, the second sr-only live region, and both
//      pickers announcing through it.
//   4. The footnote hint grew the arrow + enter chips.
//   5. Prior anchors: walk announcer, j/k glide, doors, drawers survive.

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
check('package.json version is >= 2.78.0', atLeast(PKG.version, '2.78.0'), PKG.version ?? 'missing');
check('mbumah.releaseVersion is >= 2.78.0', atLeast(PKG.mbumah?.releaseVersion, '2.78.0'));
check('mbumah.baseVersion is >= 2.78.0', atLeast(PKG.mbumah?.baseVersion, '2.78.0'));
check('verify:v2-78-0 script registered', PKG.scripts?.['verify:v2-78-0'] === 'node scripts/verify-v2-78-0.mjs');
const WN = read('src/lib/whats-new.ts') ?? '';
check('whats-new carries the 2.78.0 entry first', WN.includes("version: '2.78.0'") && WN.indexOf("version: '2.78.0'") < WN.indexOf("version: '2.77.0'"));
check('whats-new leads with the keyboard-scope story', WN.includes('The scope speaks the keyboard'));
check('whats-new feed has grown to 78+ entries', (WN.match(/version: '[^']+'/g) || []).length >= 78);

console.log('== Pure module: the roving step and the re-key sentence ==');
const MOD = read('src/lib/hr/desk-report.ts') ?? '';
check('deskReportChipStep is exported', MOD.includes('export function deskReportChipStep('));
check('arrows move forward and back, wrapping', MOD.includes("case 'ArrowRight':") && MOD.includes("case 'ArrowDown':") && MOD.includes("(index + 1) % count") && MOD.includes("(index - 1 + count) % count"));
check('Home and End jump to the ends', MOD.includes("case 'Home':") && MOD.includes("case 'End':") && MOD.includes('return count - 1;'));
check('unhandled keys move nothing', MOD.includes('default:') && MOD.includes('return null;'));
check('bad indices and empty groups move nothing', MOD.includes('if (count <= 0 || index < 0 || index >= count) return null;'));
check('deskReportScopeAnnouncement is exported', MOD.includes('export function deskReportScopeAnnouncement('));
check('window re-key names the window', MOD.includes("return `Window: ${label} — report re-keyed.`;"));
check('branch re-key names the branch', MOD.includes("return label ? `Branch: ${label} — report re-keyed.`"));
check('clearing the scope is its own sentence', MOD.includes("'All branches — report re-keyed.'"));

console.log('== The view: the chips answer the arrows ==');
const VIEW = read('src/components/org/desk-report-view.tsx') ?? '';
check('the view imports both new helpers', VIEW.includes('deskReportChipStep,') && VIEW.includes('deskReportScopeAnnouncement,'));
check('the scope announcer state exists', VIEW.includes("const [scopeAnnouncement, setScopeAnnouncement] = useState('');"));
check('the scope announcer is a second sr-only live region', VIEW.includes('data-testid="desk-report-scope-announcer"') && VIEW.includes('role="status" aria-live="polite"'));
const scopeSpan = VIEW.split('data-testid="desk-report-scope-announcer"')[0] ?? '';
check('the scope announcer mounts beside the walk announcer', scopeSpan.includes('data-testid="desk-report-walk-announcer"'));
check('pickDays announces before re-keying', /const pickDays = \(d: number\) => \{\s*\n\s*if \(d === days\) return;\s*\n\s*setScopeAnnouncement\(deskReportScopeAnnouncement\('window'/.test(VIEW));
check('pickBranch announces before re-keying', /const pickBranch = \(id: string \| null\) => \{\s*\n\s*if \(id === branch\) return;\s*\n\s*const label = id \? data\?\.branches\.find/.test(VIEW));
check('the chipNav handler exists and is shared', /const chipNav = \(e: React\.KeyboardEvent<HTMLButtonElement>\) => \{/.test(VIEW) && (VIEW.match(/onKeyDown=\{chipNav\}/g) || []).length === 3);
check('chipNav walks the sibling chips through the pure step', /const chips = Array\.from\(group\.querySelectorAll<HTMLButtonElement>\('button'\)\);/.test(VIEW) && VIEW.includes('const next = deskReportChipStep(e.key, idx, chips.length);') && VIEW.includes('chips[next].focus();'));
check('chipNav only claims the keys it moves', /if \(next === null\) return;\s*\n\s*e\.preventDefault\(\);/.test(VIEW));
check('window chips wear the roving tabindex', VIEW.includes('tabIndex={days === d ? 0 : -1}'));
check('branch chips wear the roving tabindex (all + per-branch)', VIEW.includes('tabIndex={!branch ? 0 : -1}') && VIEW.includes('tabIndex={active ? 0 : -1}'));

console.log('== The footnote hint grew the new keys ==');
const hint = VIEW.split('data-testid="desk-report-kbd-hint"')[1]?.split('</span>')[0] ?? '';
check('the hint keeps the walk keys', hint.includes('>j<') && hint.includes('>k<') && hint.includes('>esc<'));
check('the hint names the arrows and the commit key', hint.includes('>←</kbd>') && hint.includes('>→</kbd>') && hint.includes('>enter</kbd>'));
check('the hint stays screen-only', hint.includes('hidden items-center gap-1 sm:flex print:hidden'));

console.log('== Prior anchors ==');
check('the walk announcer survives', VIEW.includes('data-testid="desk-report-walk-announcer"'));
check('the j/k walk still glides and announces', VIEW.includes("next.scrollIntoView({ block: 'nearest', behavior: 'smooth' })") && VIEW.includes('announce(`Door ${nextIdx + 1} of ${doors.length} — ${label}`)'));
check('the doors keep their print contract', (VIEW.match(/print:hidden/g) || []).length >= 3);
check('the drawers keep their one-drawer rule', VIEW.includes('const clearDrawers = useCallback(') && VIEW.includes('jumpToReviewer') && VIEW.includes('jumpToRequest'));

console.log(`\nv2.78.0 verification: ${fail === 0 ? 'ALL PASS' : 'FAILURES'} (${pass} pass, ${fail} fail)`);
if (fail > 0) { failures.forEach((f) => console.error(`  FAIL: ${f}`)); process.exit(1); }
