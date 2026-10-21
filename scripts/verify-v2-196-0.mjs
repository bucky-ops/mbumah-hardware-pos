#!/usr/bin/env node
// v2.196.0 verification — "the debt card opens the ledger".
// Fresh-written per the house convention. Pins the release end to end:
// the named ledger's voice (the third button, the red face, the ledger
// qualifier, the composition bar with honest segments), the drill-down
// (the reading-size bar, the four bucket cells with their shares, the
// rose overdue strip + the zero-total honesty, the named ledger rows
// with status/bucket chips, the ledger by branch, the settled/stale
// tolerances), the section headers' dark-voice fix (the discovery at
// 4.15:1), the REAL-chain contrast script, and the release surfaces.
// Comment-strip per lesson 49; comment-text pins trimmed to survive wraps.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p) => readFileSync(join(process.cwd(), p), 'utf8');
let pass = 0;
let fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log(`[PASS] ${name}`); }
  catch (e) { fail++; console.log(`[FAIL] ${name}\n       ${e.message}`); }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };

check("version: package.json leads 2.196.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.196.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.196.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.196.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-196-0"], "verify:v2-196-0 script missing");
  assert(pkg.scripts["verify:v2-195-0"], "verify:v2-195-0 script missing (the prior surface must stay wired)");
});

check("release surfaces speak the version", () => {
  const changelog = read("CHANGELOG.md");
  assert(changelog.includes("## [2.196.0] The debt card opens the ledger"), "CHANGELOG head missing");
  assert(changelog.indexOf("## [2.196.0]") < changelog.indexOf("## [2.195.0]"), "2.196.0 is not the changelog head");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.196.0'"), "whats-new head missing");
  assert(feed.includes("title: 'The debt card opens the ledger'"), "whats-new title missing");
  assert(feed.indexOf("2.196.0") < feed.indexOf("2.195.0"), "2.196.0 is not the feed head");
});

check("the wire: zero new queries — the named ledger was already on the wire", () => {
  const route = read("src/app/api/org/kpi-summary/route.ts");
  assert(route.includes("debtExpert: {"), "the debtExpert block missing");
  assert(route.includes("topDebtors: topDebts.map((d) => ({"), "the topDebtors mapping missing");
  assert(route.includes("aging: { current: debtCurrent, d30: debtD30, d60: debtD60, d90plus: debtD90 },"), "the aging buckets missing");
  const primitives = read("src/components/org/primitives.tsx");
  assert(primitives.includes("topDebtors: Array<{ id: string; customer: string; store: string | null; outstanding: number; bucket: string; status: string }>"), "the type contract missing");
});

check("the card: the row's third button, the red face, the ledger qualifier", () => {
  const kpi = read("src/components/org/kpi-row.tsx");
  assert(kpi.includes('onClick={() => setDebtOpen(true)}'), "the button missing");
  assert(kpi.includes('data-testid="debt-card"'), "the testid missing");
  assert(kpi.includes('const [debtOpen, setDebtOpen] = useState(false);'), "the state missing");
  assert(kpi.includes('<span className="absolute inset-y-0 left-0 w-1 bg-red-500" />'), "the red edge missing");
  assert(kpi.includes('{k.debt.total > 0 && <span className="h-2 w-2 rounded-full bg-red-500 anim-pulse-dot" />}'), "the live dot missing");
  assert(kpi.includes('text-red-700 ring-1 ring-red-200'), "the ledger chip paint missing");
  assert(kpi.includes('>ledger</span>'), "the ledger qualifier missing");
  assert(kpi.includes("debtHot ? 'ring-1 ring-red-300' : ''"), "the hot ring missing");
  assert(kpi.includes("debtHot ? 'anim-shake' : ''"), "the hot shake missing");
});

check("the composition bar: honest segments, one writer, three consumers", () => {
  const kpi = read("src/components/org/kpi-row.tsx");
  assert(kpi.includes("{ key: 'current', label: 'Current', value: k.debt.aging.current, hue: 'bg-slate-400' }"), "the current bucket missing");
  assert(kpi.includes("{ key: 'd90plus', label: '90d+', value: k.debt.aging.d90plus, hue: 'bg-red-500' }"), "the 90d+ bucket missing");
  assert((kpi.match(/agingBuckets\.map\(/g) || []).length === 3, "the bucket array must have exactly 3 consumers");
  assert(kpi.includes('b.value > 0 && k.debt.total > 0 ? ('), "the honest-segment gate missing");
  assert(kpi.includes('style={{ width: `${(b.value / k.debt.total) * 100}%` }}'), "the share width missing");
  assert(kpi.includes('aria-label={`Aging composition: current ${kes(k.debt.aging.current)}, 30d ${kes(k.debt.aging.d30)}, 60d ${kes(k.debt.aging.d60)}, 90d+ ${kes(k.debt.aging.d90plus)}`}'), "the bar aria-label missing");
});

check("the shares: one writer, the zero-total honesty rule", () => {
  const kpi = read("src/components/org/kpi-row.tsx");
  assert(kpi.includes('const debtShare = (v: number): number | null => (k.debt.total > 0 ? Math.round((v / k.debt.total) * 1000) / 10 : null);'), "the share fn missing");
  assert((kpi.match(/debtShare\(/g) || []).length === 3, "the share fn must have exactly 3 calls");
  assert(kpi.includes('const overdueSum = k.debt.aging.d30 + k.debt.aging.d60 + k.debt.aging.d90plus;'), "the overdue sum missing");
  assert(kpi.includes('const overduePct = debtShare(overdueSum);'), "the overdue share missing");
  assert(kpi.includes('{overdueSum > 0 && ('), "the strip gate missing");
  assert(kpi.includes('debtShare(b.value) != null &&'), "the grid share gate missing");
});

check("the drill-down: the ledger's anatomy in the face's red", () => {
  const kpi = read("src/components/org/kpi-row.tsx");
  assert(kpi.includes('<HandCoins className="h-4 w-4 text-red-600" /> Debt ledger</DialogTitle>'), "the title missing");
  assert(kpi.includes('<Dialog open={debtOpen} onOpenChange={setDebtOpen}>'), "the dialog missing");
  assert(kpi.includes('data-testid="debt-ledger-total"'), "the total testid missing");
  assert(kpi.includes('data-testid="debt-ledger-meta"'), "the meta testid missing");
  assert(kpi.includes('{num(k.debt.count)} accounts'), "the accounts meta missing");
  assert(kpi.includes('data-testid="debt-aging-bar"'), "the bar testid missing");
  assert(kpi.includes('data-testid={`debt-bucket-${b.key}`}'), "the bucket testid missing");
  assert(kpi.includes('% of ledger'), "the share voice missing");
  assert(kpi.includes('data-testid="debt-overdue-strip"'), "the strip testid missing");
  assert(kpi.includes('data-testid="debt-overdue-amount"'), "the strip amount missing");
  assert(kpi.includes('data-testid="debt-overdue-share"'), "the strip share missing");
  assert(kpi.includes('border border-rose-100 bg-rose-50/70 px-2.5 py-1.5 dark:border-rose-500/30 dark:bg-rose-500/10'), "the rose strip paint missing");
});

check("the named ledger rows: loudest first, status + bucket chips", () => {
  const kpi = read("src/components/org/kpi-row.tsx");
  assert(kpi.includes('data-testid="debt-debtor-row"'), "the debtor row missing");
  assert(kpi.includes('loudest balance first — the same accounts the Debt Expert panel speaks'), "the section line missing");
  assert(kpi.includes('[...data.debtExpert.topDebtors].sort((a, b) => b.outstanding - a.outstanding)'), "the sort missing");
  assert(kpi.includes("'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30'"), "the partial chip missing");
  assert(kpi.includes("'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30'"), "the overdue chip missing");
  assert(kpi.includes("'bg-slate-50 text-slate-500 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-500/30'"), "the calm chip missing");
  assert(kpi.includes("bucket === 'DAYS_90_PLUS' ? '90d+' : bucket.toLowerCase()"), "the bucket label fallback missing");
  assert(kpi.includes('data-testid="debt-branch-row"'), "the branch row missing");
  assert(kpi.includes("const name = d.store ?? 'Unassigned';"), "the unassigned rule missing");
  assert(kpi.includes("{b.count} {b.count === 1 ? 'account' : 'accounts'}"), "the count chip missing");
});

check("the tolerances: settled says so, stale steps aside", () => {
  const kpi = read("src/components/org/kpi-row.tsx");
  assert(kpi.includes('const ledgerReady = Array.isArray(data.debtExpert?.topDebtors);'), "the ready gate missing");
  assert(kpi.includes('const ledgerStale = !ledgerReady;'), "the stale flag missing");
  assert(kpi.includes('data-testid="debt-ledger-empty"'), "the empty note missing");
  assert(kpi.includes('No outstanding balances — every account is settled.'), "the empty line missing");
  assert(kpi.includes('data-testid="debt-ledger-stale"'), "the stale note missing");
  assert(kpi.includes('the named ledger is not on this cached answer — the aging story above still speaks. Reload to fetch it.'), "the stale line missing");
});

check("the dark-ground law: the third panel joins from birth, the headers gain their dark voice", () => {
  const kpi = read("src/components/org/kpi-row.tsx");
  assert((kpi.split('bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900').length - 1) === 3, "all three panels must paint the dark half");
  assert(kpi.includes('uppercase tracking-wide text-slate-500 dark:text-slate-400">The week by branch'), "the revenue/tx section header fix missing");
  assert(kpi.includes('uppercase tracking-wide text-slate-500 dark:text-slate-400">The named ledger'), "the named-ledger header fix missing");
  assert(kpi.includes('mb-2 text-[10px] text-slate-500 dark:text-slate-400'), "the sub-line fix missing");
  assert(kpi.includes('text-red-600 dark:text-red-400'), "the headline dark voice missing");
});

check("the a11y surface: the REAL-chain script and the doc close", () => {
  const script = read("scripts/contrast-math-debt-ledger-v2196.mjs");
  assert(script.includes("v2.196.0 contrast math — the debt ledger"), "the script header missing");
  assert(script.includes('pre-fix section header slate-500 on the dark dialog'), "the discovery row missing");
  const doc = read("docs/a11y/contrast-math.md");
  assert(doc.includes("the debt ledger + the section headers' dark voice (v2.196.0)"), "the a11y doc section missing");
  const ws = read("docs/multi-store-workspaces.md");
  assert(ws.includes("v2.196.0 gives the debt face the same voice"), "the workspace doc sentence missing");
});

check("the suite: the release's vitest file is wired", () => {
  const suite = read("src/tests/debt-ledger-v2196.test.ts");
  assert(suite.includes('the debt card opens the ledger'), "the suite header missing");
  assert(suite.includes('data-testid="debt-card"'), "the suite card pin missing");
  assert(suite.includes('data-testid="debt-ledger-stale"'), "the suite stale pin missing");
});

console.log(`\nv2.196.0 verification: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
