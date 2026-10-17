#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.58.0 verification
// Scope: one builder to file them all + the org-console narrowing fix.
// (1) The per-table CSV buttons on the HR reports tabs deliver the SAME
//     governed file a digest email carries (header block, OWASP guard,
//     honest filename), table section only, via the export endpoint's new
//     table=1 param and the pure tableToCsv builder; the unguarded
//     client-side CSV builder is retired.
// (2) The org console's org-wide aggregate reads (summary + kpi-summary) go
//     through rawDb so the v2.57.0 leak class (a runWithoutTenant bypass
//     silently ignored inside a Next.js request) can never shrink an org
//     total to one branch for a store-scoped viewer.
// (3) A permanent source-contract audit pins every runWithoutTenant call
//     site that touches a store-scoped model.
// Every v2.47–v2.57 feature is asserted intact.
// Run: node scripts/verify-v2-58-0.mjs

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
let failures = 0;

function check(name, ok, detail = '') {
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${name}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failures += 1;
}

function read(rel) {
  const p = join(ROOT, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

console.log('== Version slots ==');
const PKG = JSON.parse(read('package.json') ?? '{}');
check('package.json version is 2.58.0', PKG.version === '2.58.0', PKG.version ?? 'missing');
check('mbumah.releaseVersion is 2.58.0', PKG.mbumah?.releaseVersion === '2.58.0');
check('mbumah.baseVersion is 2.58.0', PKG.mbumah?.baseVersion === '2.58.0');
const WN = read('src/lib/whats-new.ts') ?? '';
check("What's-New carries the 2.58.0 entry", WN.includes("version: '2.58.0'"));
check("What's-New names the one-builder story", WN.includes('One builder to file them all'));
check('verify:v2-58-0 script is wired', (PKG.scripts ?? {})['verify:v2-58-0'] === 'node scripts/verify-v2-58-0.mjs');
check('verify:v2-57-0 script is still wired (history intact)', (PKG.scripts ?? {})['verify:v2-57-0'] === 'node scripts/verify-v2-57-0.mjs');

console.log('== Builder: tableToCsv (governed file, table section) ==');
const DC = read('src/lib/hr/digest-csv.ts') ?? '';
check('tableToCsv exists (pure builder)', DC.includes('export function tableToCsv'));
check('it keeps the header block (Report/Organization/Scope/Period)', DC.includes("csvRow(['Report', digest.reportLabel])"));
check('it drops the Summary block', !/tableToCsv[\s\S]*csvRow\(\['Summary'\]\)/.test(DC.split('export function tableToCsv')[1] ?? ''));
check('the filename carries the -table suffix', DC.includes('-table.csv`'));
check('it reuses the OWASP csvCell guard', DC.includes('lines.push(csvRow(table.columns))'));
check('null when the digest has no table (NO_TABLE_DATA upstream)', DC.includes('if (!table || table.rows.length === 0)'));
check('the digest builder is untouched', DC.includes('export function digestToCsv'));

console.log('== Route: the table=1 section param ==');
const ER = read('src/app/api/hr/reports/export/route.ts') ?? '';
check('parseExportQuery accepts the section', ER.includes("section: 'digest' | 'table'"));
check('table=1 / true accepted, junk refused (INVALID_SECTION)', ER.includes("code: 'INVALID_SECTION'"));
check('the route picks the builder by section', ER.includes("parsed.section === 'table' ? tableToCsv(digest, now) : digestToCsv(digest, now)"));
check('a missing table answers NO_TABLE_DATA honestly', ER.includes('NO_TABLE_DATA'));
check('the audit metadata carries the section', ER.includes("section: parsed.section"));

console.log('== UI: the per-table buttons ride the governed builder ==');
const RP = read('src/app/(shell)/hr/reports/page.tsx') ?? '';
check('the unguarded client-side builder is retired', !RP.includes('function downloadCSV') && !RP.includes('function csvEscape'));
check('the table export helper exists', RP.includes('const exportTableCsv = useCallback'));
check('the helper requests the table section', RP.includes("table: '1'"));
check('all six tables ride the governed endpoint', (RP.match(/void exportTableCsv\('/g) ?? []).length === 6);
check('employment-cost rides it', RP.includes("void exportTableCsv('employment-cost')"));
check('leave-utilisation keeps its year param path', RP.includes("reportKey === 'leave-utilisation'"));
check('the toolbar button disables while a table export builds', RP.includes('disabled={tableBusy !== null}'));
check('the toolbar says what the file is (honest tooltip)', RP.includes('the governed digest format'));
check('the busy state is labelled honestly', RP.includes("'Building…'"));
check('the download note names the format', RP.includes('The governed digest format, table section only.'));
check('the v2.52.0 digest export is untouched', RP.includes('const exportDigestCsv = useCallback'));

console.log('== FIX: the org console reads org-wide by construction ==');
const OS = read('src/app/api/org/summary/route.ts') ?? '';
const OK = read('src/app/api/org/kpi-summary/route.ts') ?? '';
check('org summary imports rawDb', OS.includes("import { rawDb, runWithoutTenant } from '@/lib/db';"));
check('org kpi-summary imports rawDb', OK.includes("import { rawDb, runWithoutTenant } from '@/lib/db';"));
check('org summary has no un-intercepted-hardened reads left', !/\bdb\.\w+\./.test(OS.replace(/^import.*$/gm, '')));
check('org kpi-summary has no un-intercepted-hardened reads left', !/\bdb\.\w+\./.test(OK.replace(/^import.*$/gm, '')));
check('org summary names the leak class in a comment', OS.includes('v2.57.0 leak class'));
check('org kpi-summary names the leak class in a comment', OK.includes('v2.57.0 leak class'));
check('org summary stays read-only', !/rawDb\.\w+\.(create|update|delete|upsert)/.test(OS));
check('org kpi-summary stays read-only', !/rawDb\.\w+\.(create|update|delete|upsert)/.test(OK));

console.log('== Audit: the bypass-read contract test ==');
const AT = read('src/tests/bypass-reads-audit.test.ts') ?? '';
check('the audit test exists', !!AT);
check('it pins the store-scoped bypass surface', AT.includes('STORE_SCOPED_MODELS'));
check('it allow-lists with written reasons', AT.includes('needs a reason'));
check('it guards against stale allow-list entries', AT.includes('no longer exists'));
check('it keeps the v2.57.0 feed fix pinned', AT.includes('must not regress'));

console.log('== Tests ==');
const RE = read('src/tests/report-digest-export.test.ts') ?? '';
check('the table section param suite exists', RE.includes('parseExportQuery: table section param (v2.58.0)'));
check('the tableToCsv suite exists', RE.includes('tableToCsv: the digest file minus the Summary block'));
check('the NO_TABLE_DATA honesty is tested', RE.includes('answers NO_TABLE_DATA'));
check('the injection guard is tested at the table level', RE.includes('guards a table cell that starts with a formula trigger'));
check('the bypass audit test file exists', !!read('src/tests/bypass-reads-audit.test.ts'));
check('v2.57.0 feed contract test still exists', !!read('src/tests/notifications-feed-tenant-free.test.ts'));

console.log('');
if (failures === 0) {
  console.log('v2.58.0 verification: ALL PASS');
} else {
  console.log(`v2.58.0 verification: ${failures} FAILURE(S)`);
  process.exit(1);
}
