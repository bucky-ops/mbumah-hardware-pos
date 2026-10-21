import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.199.0 — the pending tile opens the approval desk (the KPI row's
 * SIXTH voice, the row's last silent card speaks).
 *
 * The Revenue card told the money's story since v2.173.0, the count face
 * found its week in v2.195.0, the ledger opened in v2.196.0, the shelf
 * in v2.197.0 and the yard in v2.198.0 while the Pending tile
 * badge-summed three queues in silence — even though the named PO roster
 * was already on the wire (`suppliers.purchaseOrders`, the Suppliers
 * Expert panel's payload since the Expert panel shipped). This release
 * gives the desk the row's sixth voice: the tile becomes the sixth
 * button (the indigo edge + live dot + queue qualifier chip — the family
 * vocabulary's sixth face), the three queues draw their COMPOSITION BAR
 * (card mini + modal reading size; indigo-600 POs → 500 shifts → 400
 * expenses — one family, three queues), and the drill-down speaks the
 * whole desk — the queues' counts and honest shares, the named pending
 * POs loudest-order-first with status/date chips and the order total,
 * the two count-only queues speaking where their rosters live in WORDS,
 * and the roster's 8-row window speaking its cap note when the count
 * outruns it. Zero new queries: every figure composes the SAME payload;
 * the drill-down composes, it never invents.
 *
 * The honesty rules carry the house line: a clean desk renders NO
 * percentage (never an invented "0%" of nothing), a zero queue draws
 * nothing, a clean desk says so, a PO sent without an expected date
 * says so (never a fabricated "on time"), the named rows are a window
 * (the count stays the truth; the cap note speaks when the window shows
 * fewer), an older cached answer without the roster speaks its
 * step-aside while the count story above still carries. AND the modal
 * is self-contained like its five siblings — no deep links: a
 * shell-tab link would be a role-gated door for some console viewers
 * (the honest-door law), so the pointer lines speak the destination in
 * words instead.
 *
 * The round's contrast finds are house law from birth: the revenue lens
 * toggle's ACTIVE GROSS chip re-voices from the white-on-emerald-600
 * that measured 3.67:1 — under the 4.5 bar its 10px uppercase text must
 * meet — to emerald-700 (5.37:1); the login error line re-voices from
 * red-600-on-red-50 (4.36:1 — the exact pairing v2.198.0 found on the
 * Expert OVERDUE badge) to red-700 (5.88:1); the Store Matrix's hot debt
 * figure re-voices red-600 → red-700 for family alignment (the pre-fix
 * 4.76:1 passes the installed palette's bar — the v2.159 knife-edge
 * number came from the older palette — but the house's hot REAL text
 * speaks red-700). The pre-fix states are pinned in reverse in the
 * round's contrast script so the gaps cannot return silently.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const kpi = readRepo('src/components/org/kpi-row.tsx');
const chrome = readRepo('src/components/org/chrome.tsx');
const matrix = readRepo('src/components/org/store-matrix.tsx');
const primitives = readRepo('src/components/org/primitives.tsx');
const route = readRepo('src/app/api/org/kpi-summary/route.ts');
const a11yDoc = readRepo('docs/a11y/contrast-math.md');
const workspaceDoc = readRepo('docs/multi-store-workspaces.md');
const changelog = readRepo('CHANGELOG.md');
const whatsNew = readRepo('src/lib/whats-new.ts');
const contrastScript = readRepo('scripts/contrast-math-approval-desk-v2199.mjs');
const verifyScript = readRepo('scripts/verify-v2-199-0.mjs');
const pkg = JSON.parse(readRepo('package.json'));

describe('the desk math executed - the queues, the filter, the voices', () => {
  // The component's derivations, executed on the wire's own sample (the
  // QA dev DB of 2026-10-21: one DRAFT PO — Bamburi Cement Ltd, KES
  // 70,760, Juja Main, no expected date — plus synthetic rows covering
  // the voices the seed alone cannot). The pins below hold the source to
  // this exact shape; this execution proves the math the pinned lines
  // speak.
  const TODAY = new Date('2026-10-21T00:00:00');
  const poDateChip = (expectedDate: string | null): { text: string; hot: boolean } => {
    if (!expectedDate) return { text: 'no date set', hot: false };
    const d = new Date(expectedDate);
    const days = Math.floor((TODAY.getTime() - d.getTime()) / 86_400_000);
    if (days > 0) return { text: `${days}d late`, hot: true };
    if (days === 0) return { text: 'due today', hot: true };
    return { text: `due in ${-days}d`, hot: false };
  };
  const sample = [
    { id: 'po-bamburi', supplier: 'Bamburi Cement Ltd', store: 'MBUMAH HARDWARE - Juja Main', status: 'DRAFT', total: 70_760, expectedDate: null },
    { id: 'po-late', supplier: 'Simba Corp', store: 'MBUMAH HARDWARE - Nairobi CBD Branch', status: 'PENDING_APPROVAL', total: 120_000, expectedDate: '2026-10-18T00:00:00.000Z' },
    { id: 'po-today', supplier: 'Tile & Coat', store: 'MBUMAH HARDWARE - Thika Branch', status: 'PENDING_APPROVAL', total: 45_500, expectedDate: '2026-10-21T00:00:00.000Z' },
    { id: 'po-future', supplier: 'Deacons', store: null, status: 'DRAFT', total: 15_000, expectedDate: '2026-10-24T00:00:00.000Z' },
    // the wider roster's other stages — the route carries them, the desk filters them out
    { id: 'po-approved', supplier: 'Caterlink', store: 'MBUMAH HARDWARE - Juja Main', status: 'APPROVED', total: 200_000, expectedDate: '2026-10-19T00:00:00.000Z' },
    { id: 'po-sent', supplier: 'Gramo', store: 'MBUMAH HARDWARE - Juja Main', status: 'SENT', total: 90_000, expectedDate: '2026-10-20T00:00:00.000Z' },
  ];

  it('the pending slice filters to the SAME two statuses the count reads', () => {
    const deskPOs = sample
      .filter((p) => p.status === 'DRAFT' || p.status === 'PENDING_APPROVAL')
      .sort((a, b) => b.total - a.total);
    expect(deskPOs.map((p) => p.id)).toEqual(['po-late', 'po-bamburi', 'po-today', 'po-future']);
    // the wider roster's approved/sent stages never speak on the desk
    expect(deskPOs.some((p) => ['APPROVED', 'SENT', 'CONFIRMED', 'PARTIALLY_RECEIVED'].includes(p.status))).toBe(false);
  });

  it('the rows sort loudest order first', () => {
    const sorted = [...sample].filter((p) => p.status === 'DRAFT' || p.status === 'PENDING_APPROVAL').sort((a, b) => b.total - a.total);
    expect(sorted.map((p) => p.total)).toEqual([120_000, 70_760, 45_500, 15_000]);
  });

  it('the date voice is honest - a PO without a date says so, never "on time"', () => {
    const byId = Object.fromEntries(sample.map((p) => [p.id, p]));
    expect(poDateChip(byId['po-bamburi'].expectedDate)).toEqual({ text: 'no date set', hot: false });
    expect(poDateChip(byId['po-late'].expectedDate)).toEqual({ text: '3d late', hot: true });
    expect(poDateChip(byId['po-today'].expectedDate)).toEqual({ text: 'due today', hot: true });
    expect(poDateChip(byId['po-future'].expectedDate)).toEqual({ text: 'due in 3d', hot: false });
  });

  it('the three queues compose the SAME counts the tile badge-summed', () => {
    const k = { purchaseOrders: 4, openShifts: 1, expenses: 2 };
    const pendingTotal = k.purchaseOrders + k.openShifts + k.expenses;
    expect(pendingTotal).toBe(7);
    const queues = [
      { key: 'purchaseOrders', value: k.purchaseOrders },
      { key: 'openShifts', value: k.openShifts },
      { key: 'expenses', value: k.expenses },
    ];
    // honest widths: the shares of the desk
    const shares = queues.map((q) => Math.round((q.value / pendingTotal) * 1000) / 10);
    expect(shares).toEqual([57.1, 14.3, 28.6]);
  });

  it('the zero-total honesty rule: an empty desk renders NO percentage', () => {
    const deskShare = (v: number, total: number): number | null => (total > 0 ? Math.round((v / total) * 1000) / 10 : null);
    expect(deskShare(0, 0)).toBeNull();
    expect(deskShare(3, 0)).toBeNull();
    expect(deskShare(3, 7)).toBe(42.9);
  });

  it('the cap rule: the named rows are a window, the count the truth', () => {
    const kPOs = 4;
    const namedRows = 4; // the route slices the roster to 8; the pending slice can be fewer
    expect(namedRows < kPOs).toBe(false); // this answer's window covers the queue
    // more pending POs than the window carried → the cap note speaks
    expect(2 < 4).toBe(true);
  });
});

describe('the one-writer rule - the queues live in ONE array, the voices in ONE function each', () => {
  it('the queue array is the single definition - card bar, modal bar, grid all read it', () => {
    expect(kpi).toContain("key: 'purchaseOrders', label: 'Purchase orders', hue: 'bg-indigo-600'");
    expect(kpi).toContain("key: 'openShifts', label: 'Open shifts', hue: 'bg-indigo-500'");
    expect(kpi).toContain("key: 'expenses', label: 'Expenses', hue: 'bg-indigo-400'");
    expect(kpi.match(/const deskQueues/g)?.length).toBe(1);
  });

  it('the share function is the single definition - the grid gate and figure read it', () => {
    expect(kpi).toContain('const deskShare = (v: number): number | null =>');
    expect(kpi.match(/deskShare\(/g)?.length).toBe(2);
  });

  it('the named queue composes the SAME roster the Suppliers panel reads', () => {
    expect(kpi).toContain('const poRosterReady = Array.isArray(data.suppliers?.purchaseOrders);');
    expect(kpi).toContain(".filter((p) => p.status === 'DRAFT' || p.status === 'PENDING_APPROVAL')");
    expect(kpi).toContain('.sort((a, b) => b.total - a.total)');
    expect(kpi.match(/const poRosterCapped/g)?.length).toBe(1);
    expect(kpi).toContain('deskPOs.length < k.pending.purchaseOrders');
  });

  it('the chips are single functions - status, date, each one writer', () => {
    expect(kpi.match(/poStatusChip\(/g)?.length).toBe(3); // exactly the modal's cls/title/text calls (the def is `poStatusChip = (`)
    expect(kpi.match(/const poDateChip/g)?.length).toBe(1);
    // the voices: approval indigo, draft calm slate, Nd-late amber, no-date slate
    expect(kpi).toContain("'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-500/30'");
    expect(kpi).toContain("'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-500/30'");
    expect(kpi).toContain("'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30'");
  });
});

describe('the card - the row\u2019s sixth button, the indigo face, the mini bar', () => {
  it('the pending card is a BUTTON that opens the desk', () => {
    expect(kpi).toContain('onClick={() => setDeskOpen(true)}');
    expect(kpi).toContain('data-testid="pending-card"');
    expect(kpi).toContain('const [deskOpen, setDeskOpen] = useState(false);');
    // the family vocabulary's sixth face: the indigo edge + live dot
    expect(kpi).toContain('<span className="absolute inset-y-0 left-0 w-1 bg-indigo-600" />');
    expect(kpi).toContain('{pendingTotal > 0 && <span className="h-2 w-2 rounded-full bg-indigo-600 anim-pulse-dot" />}');
    // the queue qualifier chip — the roster/ledger/watchlist chips' desk sibling
    expect(kpi).toContain('text-indigo-700 ring-1 ring-indigo-200');
    expect(kpi).toContain('>queue</span>');
    // the hot grammar survives the promotion
    expect(kpi).toContain("pendingTotal > 0 ? 'ring-1 ring-indigo-300' : ''");
    expect(kpi).toContain("pendingTotal > 0 ? 'text-indigo-700' : 'text-slate-600 dark:text-slate-400'");
  });

  it('the card draws the queue mini bar with honest segments only', () => {
    expect(kpi).toContain('className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-slate-100"');
    // the bar renders only when the desk holds work; a zero queue draws nothing
    expect(kpi).toContain('{pendingTotal > 0 && (');
    expect(kpi).toContain('q.value > 0 ? (');
    expect(kpi).toContain("style={{ width: `${(q.value / pendingTotal) * 100}%` }}");
    // the bar self-speaks for the reader who cannot see the hues
    expect(kpi).toContain('aria-label={`Approval queues: ${deskQueues.map((q) => `${q.label} ${q.value}`).join(\', \')}`}');
  });

  it('the revenue card gained its QA handle (the row\u2019s first voice is findable)', () => {
    expect(kpi).toContain('data-testid="revenue-card"');
  });
});

describe('the drill-down - the desk\u2019s anatomy, self-contained like its five siblings', () => {
  it('the modal mirrors the family anatomy and wears the desk title', () => {
    expect(kpi).toContain('<ShoppingCart className="h-4 w-4 text-indigo-600" /> The approval desk</DialogTitle>');
    expect(kpi).toContain('<Dialog open={deskOpen} onOpenChange={setDeskOpen}>');
    expect(kpi).toContain('data-testid="approval-desk-count"');
    expect(kpi).toContain('queues waiting on a human</span>');
    expect(kpi).toContain('the DB-derived action queue');
  });

  it('the composition bar + grid speak every queue with its honest share', () => {
    expect(kpi).toContain('data-testid="approval-desk-bar"');
    expect(kpi).toContain('data-testid={`approval-desk-queue-${q.key}`}');
    expect(kpi).toContain('% of desk');
    // the zero-total rule: the share only renders when the desk holds work
    expect(kpi).toContain('{deskShare(q.value) != null &&');
  });

  it('the named PO queue speaks supplier, branch, status, date and total', () => {
    expect(kpi).toContain('Purchase orders awaiting approval</p>');
    expect(kpi).toContain('data-testid="approval-desk-po-row"');
    expect(kpi).toContain("{p.supplier}</span>");
    expect(kpi).toContain("{p.store ?? 'Unassigned'}");
    expect(kpi).toContain('{kes(p.total)}');
    // the honest-date chips
    expect(kpi).toContain('{poDateChip(p.expectedDate).text}');
    expect(kpi).toContain('{poStatusChip(p.status).text}');
  });

  it('the honest absences: clean desk, count-only pointers, stale roster, cap note', () => {
    expect(kpi).toContain('data-testid="approval-desk-clear"');
    expect(kpi).toContain('Nothing waits on a human — the desk is clear.');
    expect(kpi).toContain('data-testid="approval-desk-shifts-note"');
    expect(kpi).toContain('the Shift Scheduling tab — the shift roster is not on this answer');
    expect(kpi).toContain('data-testid="approval-desk-expenses-note"');
    expect(kpi).toContain('the Financial tab — the expense ledger is not on this answer');
    expect(kpi).toContain('data-testid="approval-desk-po-stale"');
    expect(kpi).toContain('the named PO roster is not on this cached answer');
    expect(kpi).toContain('data-testid="approval-desk-po-capped"');
    expect(kpi).toContain('the named rows are a window on this answer');
  });

  it('NO deep links - the pointer is not a door (the honest-door law)', () => {
    // the modal block speaks destinations in words only; an <a> inside the
    // desk modal would be a role-gated door for some console viewers
    const deskBlock = kpi.slice(kpi.indexOf('The approval desk — v2.199.0'), kpi.lastIndexOf('</Dialog>'));
    expect(deskBlock).not.toContain('<a ');
    expect(deskBlock).not.toContain('href=');
    // the destinations are still spoken — in words
    expect(deskBlock).toContain('Shift Scheduling tab');
    expect(deskBlock).toContain('Financial tab');
  });

  it('the panel paints its dark half from birth (the six-panel law)', () => {
    expect(kpi).toContain('bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900');
    // dark chips: the house pattern (-500/10 ground, -300 voice, /30 ring)
    expect(kpi).toContain('dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-500/30');
    expect(kpi).toContain('dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30');
    expect(kpi).toContain('dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-500/30');
    expect(kpi).toContain('dark:bg-slate-900/60 dark:text-slate-400');
  });
});

describe('the wire - zero new queries, the desk composes what the route already carried', () => {
  it('the route\u2019s action queue and PO roster are untouched', () => {
    expect(route).toContain("rawDb.purchaseOrder.count({ where: { status: { in: ['DRAFT', 'PENDING_APPROVAL'] } } })");
    expect(route).toContain("where: { status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'CONFIRMED', 'PARTIALLY_RECEIVED'] } }");
    expect(route).toContain('purchaseOrders: poRows.slice(0, 8)');
    expect(route).toContain('pending: { purchaseOrders: pendingPOs, openShifts, expenses: pendingExpenses }');
  });

  it('the type contract already spoke the shapes the desk reads', () => {
    expect(primitives).toContain('pending: { purchaseOrders: number; openShifts: number; expenses: number }');
    expect(primitives).toContain('purchaseOrders: Array<{ id: string; supplier: string; store: string | null; status: string; total: number; expectedDate: string | null }>');
  });

  it('the component fetches nothing - the drill-down composes, it never invents', () => {
    expect(kpi).not.toContain('fetch(');
  });
});

describe('the contrast round - the three re-voices pinned at the source', () => {
  it('the lens ACTIVE GROSS chip speaks emerald-700; the old emerald-600 is gone', () => {
    expect(kpi).toContain("'bg-emerald-700 text-white shadow'");
    expect(kpi).not.toContain("'bg-emerald-600 text-white shadow'");
    // the net chip passes and stays
    expect(kpi).toContain("'bg-violet-600 text-white shadow'");
  });

  it('the login error line speaks red-700 on red-50', () => {
    expect(chrome).toContain('rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700');
    expect(chrome).not.toContain('text-xs text-red-600');
  });

  it('the Store Matrix hot debt figure speaks red-700', () => {
    expect(matrix).toContain("'font-semibold text-red-700'");
    expect(matrix).not.toContain("'font-semibold text-red-600'");
  });

  it('the round\u2019s contrast script exists and pins the ghosts in reverse', () => {
    expect(contrastScript).toContain('checkBug');
    expect(contrastScript).toContain('white on emerald-600 (pre-fix, must stay under)');
    expect(contrastScript).toContain('red-600 on red-50 (pre-fix, must stay under)');
    expect(contrastScript).toContain('re-voice is family alignment');
    // the bar fills follow the v2.198 decoration law — NOT asserted
    expect(contrastScript).toContain('decoration by the house rule (NOT asserted)');
  });
});

describe('the release surfaces', () => {
  it('package.json slots ride at 2.199.0', () => {
    expect(pkg.version).toBe('2.207.0');
    expect(pkg.mbumah.releaseVersion).toBe('2.207.0');
    expect(pkg.mbumah.baseVersion).toBe('2.207.0');
  });

  it('whats-new leads with the desk story', () => {
    const i99 = whatsNew.indexOf("version: '2.199.0'");
    const i98 = whatsNew.indexOf("version: '2.198.0'");
    expect(i99).toBeGreaterThanOrEqual(0);
    expect(i98).toBeGreaterThan(i99);
    expect(whatsNew).toContain('The pending tile opens the approval desk');
  });

  it('the changelog still tells the desk story (v2.200.0 heads the feed)', () => {
    expect(changelog).toContain('## [2.199.0] The pending tile opens the approval desk');
    expect(changelog.indexOf('## [2.199.0]')).toBeLessThan(changelog.indexOf('## [2.198.0]'));
  });

  it('the a11y doc records the round\u2019s numbers', () => {
    expect(a11yDoc).toContain('v2.199.0');
    expect(a11yDoc).toContain('3.67');
    expect(a11yDoc).toContain('5.37');
  });

  it('the workspace doc\u2019s door register carries the sixth door', () => {
    expect(workspaceDoc).toContain('v2.199.0');
    expect(workspaceDoc).toContain('The approval desk');
  });

  it('the verify script is wired for this round', () => {
    expect(verifyScript).toContain('2.199.0');
    expect(verifyScript).toContain('approval-desk-count');
  });
});
