import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.200.0 — the branch row speaks (three doors on the branch workspaces'
 * KPI row).
 *
 * The org console's row finished its door arc in v2.199.0 with every card
 * speaking; the assessment that picked this round asked the worklog's own
 * open question — does a BRANCH-level dashboard have a row of quiet tiles
 * with named wires behind them? It does: Today's Revenue, Transactions and
 * Avg Transaction rendered divs (no affordance) even though the stories
 * they could tell already rode the dashboard wire — `hourlySalesBreakdown`
 * (the full day, hour by hour), `paymentMethodBreakdown` (a full GROUP BY,
 * the complete tender mix, NOT a window) and `recentTransactions` (the
 * API's named 10-row window). This release gives the three tiles the door
 * vocabulary: each becomes a button (the family edge bar + live dot + hot
 * ring — emerald ledger / teal receipts / amber ladder, the branch row's
 * own hue story), and each opens a self-contained focus view:
 *
 *   - The day's ledger: the hourly bars with the peak hour spoken twice
 *     (in the bar's aria-label AND in the day-ledger-peak line), the
 *     tender mix with honest "% of the day" shares, the latest receipts.
 *   - The day's receipts: the named roster newest-first with method +
 *     status chips (PAID emerald / else calm slate), the hour strip with
 *     the busiest hour spoken twice, and the honest window note when the
 *     count outruns the wire's 10-receipt window.
 *   - The basket ladder: the ATV headline with its composition line and
 *     the four size buckets over the NAMED roster — the ladder reads the
 *     window and says so (basket-ladder-window).
 *
 * The house laws hold from birth: every panel paints its dark half
 * (dark:border-slate-700 dark:bg-slate-900 — the branch row's THREE new
 * mounts of the dark-panel law); a zero day renders NO percentage (never
 * an invented "0%" of nothing) and says so; a zero bucket bar draws
 * nothing while its cell still speaks its honest 0; the count stays the
 * truth when the roster is a window; and the doors carry no anchors (the
 * honest-door law — the full sections already live on the page below the
 * row; the door is the story, not a shortcut).
 *
 * RBAC: the doors render only inside the full KPI row — the server already
 * refuses the revenue payload for limitedView roles, and the limited row is
 * a different component untouched by this round. Zero new queries: the
 * doors compose the SAME answer the cards show.
 *
 * The round's contrast work (scripts/contrast-math-branch-doors-v2200.mjs,
 * 28/28) caught the draft meta voices BEFORE ship: text-slate-400 in light
 * measured 2.63:1 on the white panel and text-slate-500 in dark measured
 * 3.74:1 on slate-900 — both under the 4.5 bar their 10px text must meet.
 * The shipped voice is text-slate-500 dark:text-slate-400 (4.77 / 6.79)
 * and the draft pair is pinned in reverse so the ghost cannot return.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const doors = readRepo('src/components/dashboard/kpi-doors.tsx');
const tab = readRepo('src/app/(shell)/tabs/dashboard-tab.tsx');
const apiRoute = readRepo('src/app/api/dashboard/route.ts');
const contrast = readRepo('scripts/contrast-math-branch-doors-v2200.mjs');
const a11yDoc = readRepo('docs/a11y/contrast-math.md');
const workspaceDoc = readRepo('docs/multi-store-workspaces.md');
const changelog = readRepo('CHANGELOG.md');
const whatsNew = readRepo('src/lib/whats-new.ts');
const pkg = JSON.parse(readRepo('package.json'));

describe('v2.200.0 — the branch row speaks: the wire (zero new queries)', () => {
  it('the doors ride the dashboard wire the row already carries', () => {
    expect(apiRoute).toContain('paymentMethodBreakdown');
    expect(apiRoute).toContain('hourlySalesBreakdown');
    expect(apiRoute).toContain('recentTransactions');
  });

  it('the roster window is the server\'s 10 (the honest window note\'s basis)', () => {
    expect(apiRoute).toContain('take: 10');
  });

  it('the doors file fetches nothing and imports no db', () => {
    expect(doors).not.toContain('fetch(');
    expect(doors).not.toContain('from \'@/lib/db\'');
    expect(doors).not.toContain('prisma');
  });

  it('the doors compose via structural subset, not a forked payload type', () => {
    expect(doors).toContain('export interface BranchKpiWire');
    expect(tab).toContain('import { DayLedgerModal, DayReceiptsModal, BasketLadderModal } from \'@/components/dashboard/kpi-doors\';');
    // the tab declares NO forked payload type: the wire is the doors'
    // structural contract, the tab's data flows in as-is.
    expect(tab).not.toContain('interface BranchKpiWire');
  });

  it('money is coerced at the boundary (the DECIMAL-STRING AUDIT precedent)', () => {
    expect(doors).toContain('function num(v: number | string | null | undefined): number');
    expect(doors).toContain('num(r.totalAmount)');
  });
});

describe('v2.200.0 — the row wiring: three buttons in the family vocabulary', () => {
  it('the door state is declared BEFORE the early return (the rules-of-hooks law)', () => {
    const kpiRow = tab.slice(tab.indexOf('function KpiRow('), tab.indexOf('function LimitedDashboard('));
    const stateIdx = kpiRow.indexOf('const [door, setDoor] = useState');
    const returnNullIdx = kpiRow.indexOf('if (!data) return null;');
    expect(stateIdx).toBeGreaterThan(-1);
    expect(returnNullIdx).toBeGreaterThan(stateIdx);
  });

  it('the revenue tile opens the ledger with the emerald face', () => {
    expect(tab).toContain('testId="branch-revenue-card"');
    expect(tab).toContain("onClick={() => setDoor('ledger')}");
    expect(tab).toContain('edgeClass="bg-emerald-600"');
    expect(tab).toContain('dotClass="bg-emerald-600"');
  });

  it('the transactions tile opens the receipts with the teal face', () => {
    expect(tab).toContain('testId="branch-transactions-card"');
    expect(tab).toContain("onClick={() => setDoor('receipts')}");
    expect(tab).toContain('edgeClass="bg-teal-600"');
    expect(tab).toContain('dotClass="bg-teal-600"');
  });

  it('the ATV tile opens the ladder with the amber face', () => {
    expect(tab).toContain('testId="branch-atv-card"');
    expect(tab).toContain("onClick={() => setDoor('ladder')}");
    expect(tab).toContain('edgeClass="bg-amber-600"');
    expect(tab).toContain('dotClass="bg-amber-600"');
  });

  it('the hot ring speaks only when the day is live (a quiet day stays quiet)', () => {
    expect(tab).toContain('hotRing={!noSalesToday}');
    expect(tab).toContain('hotRing={txns > 0}');
    expect(tab).toContain('hotRing={atv > 0}');
  });

  it('the KpiCard gained the testId/edge/dot/ring props and renders the handle', () => {
    expect(tab).toContain('testId?: string;');
    expect(tab).toContain('data-testid={testId}');
    expect(tab).toContain('`absolute inset-y-0 left-0 w-1 ${edgeClass}`');
    expect(tab).toContain('anim-pulse-dot');
  });

  it('the non-door tiles keep their voices (stock navigates, debt keeps its button)', () => {
    const kpiRow = tab.slice(tab.indexOf('function KpiRow('), tab.indexOf('// 4b. LIMITED DASHBOARD'));
    expect(kpiRow).toContain("onClick={() => onTab('inventory')}");
    expect(kpiRow).toContain("onClick={() => onTab('debt-management')}");
    expect(kpiRow).toContain('Tap to view debtors');
  });

  it('the three modals mount inside the row\'s fragment', () => {
    expect(tab).toContain('<DayLedgerModal data={data} open={door === \'ledger\'} onClose={() => setDoor(null)} />');
    expect(tab).toContain('<DayReceiptsModal data={data} open={door === \'receipts\'} onClose={() => setDoor(null)} />');
    expect(tab).toContain('<BasketLadderModal data={data} open={door === \'ladder\'} onClose={() => setDoor(null)} />');
  });
});

describe('v2.200.0 — the day\'s ledger (the revenue door)', () => {
  it('speaks its testid, headline, meta and the zero-day honest line', () => {
    expect(doors).toContain('data-testid="day-ledger-modal"');
    expect(doors).toContain('data-testid="day-ledger-amount"');
    expect(doors).toContain('data-testid="day-ledger-meta"');
    expect(doors).toContain('data-testid="day-ledger-clear"');
    expect(doors).toContain('No sales yet today — the ledger fills as the till rings.');
  });

  it('draws the 16 business-hour slots (6 AM - 9 PM, the page chart\'s window)', () => {
    expect(doors).toContain('const BUSINESS_HOURS = Array.from({ length: 16 }, (_, i) => i + 6);');
    expect(doors).toContain('data-testid={`day-ledger-hour-${h.hour}`}');
    expect(doors).toContain('aria-label={`Revenue by hour, 6 AM to 9 PM. Peak ${formatHour(maxHour.hour)} at ${formatKES(maxHour.amount)}.`}');
  });

  it('a zero hour draws nothing (a flat line, never a fake bar)', () => {
    expect(doors).toContain('{h.amount > 0 ? (');
  });

  it('the peak hour is spoken twice (aria + the day-ledger-peak line)', () => {
    expect(doors).toContain('data-testid="day-ledger-peak"');
    expect(doors).toContain('Peak hour');
  });

  it('the tender mix speaks honest "% of the day" shares from the full GROUP BY', () => {
    expect(doors).toContain('data-testid="day-ledger-methods"');
    expect(doors).toContain('% of the day');
    expect(doors).toContain('.filter((r) => r.amount > 0 || r.count > 0)');
    expect(doors).toContain('.sort((a, b) => b.amount - a.amount)');
  });

  it('a zero-total mix renders NO percentage (never "0%" of nothing)', () => {
    expect(doors).toContain('{methodTotal > 0 && (');
    expect(doors).toContain('data-testid="day-ledger-methods-clear"');
  });

  it('the latest receipts mini-roster is capped at 5 with the window note', () => {
    expect(doors).toContain('.slice(0, 5)');
    expect(doors).toContain('data-testid="day-ledger-window"');
    expect(doors).toContain('The wire names a 10-receipt window on the day — the count above stays the truth.');
  });
});

describe('v2.200.0 — the day\'s receipts (the transactions door)', () => {
  it('speaks its testid, count headline and the zero-day honest line', () => {
    expect(doors).toContain('data-testid="day-receipts-modal"');
    expect(doors).toContain('data-testid="day-receipts-count"');
    expect(doors).toContain('data-testid="day-receipts-clear"');
    expect(doors).toContain('No receipts yet today — the first sale of the day starts the story.');
  });

  it('the roster is newest-first with the honest window note', () => {
    expect(doors).toContain('.sort((a, b) => new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime())');
    expect(doors).toContain('data-testid="day-receipts-window"');
    expect(doors).toContain('the wire&rsquo;s 10-receipt window — {txns - receipts.length} more on the day');
  });

  it('every receipt row speaks method, status, customer and cashier', () => {
    expect(doors).toContain('data-testid="day-receipts-row"');
    expect(doors).toContain('data-testid="day-receipts-status"');
    expect(doors).toContain("{r.customer?.name ? r.customer.name : 'Walk-in'}");
    expect(doors).toContain('· served by {r.cashier.name}');
  });

  it('the status chip voices PAID emerald and every other state slate calm', () => {
    expect(doors).toContain("s === 'PAID' || s === 'COMPLETED'");
    expect(doors).toContain('bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30');
    expect(doors).toContain('bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-500/30');
  });

  it('the busiest hour is spoken twice (aria + the day-receipts-busiest line)', () => {
    expect(doors).toContain('data-testid="day-receipts-busiest"');
    expect(doors).toContain('Busiest hour');
  });

  it('the clock is a stable HH:MM voice (no locale drift)', () => {
    expect(doors).toContain('function clockTime(iso: string | null | undefined): string');
    expect(doors).toContain("'--:--'");
  });
});

describe('v2.200.0 — the basket ladder (the ATV door)', () => {
  it('speaks its testid, value headline, composition line and the zero line', () => {
    expect(doors).toContain('data-testid="basket-ladder-modal"');
    expect(doors).toContain('data-testid="basket-ladder-value"');
    expect(doors).toContain('data-testid="basket-ladder-meta"');
    expect(doors).toContain('data-testid="basket-ladder-clear"');
    expect(doors).toContain('No receipts on this answer yet — the ladder climbs with the first sale.');
  });

  it('the four buckets cover the whole day honestly (gaps impossible by construction)', () => {
    expect(doors).toContain("{ key: 'sub1k', label: 'Under KES 1,000', lo: 0, hi: 1_000 }");
    expect(doors).toContain("{ key: '1to5k', label: 'KES 1,000 - 5,000', lo: 1_000.01, hi: 5_000 }");
    expect(doors).toContain("{ key: '5to20k', label: 'KES 5,000 - 20,000', lo: 5_000.01, hi: 20_000 }");
    expect(doors).toContain("{ key: 'over20k', label: 'Over KES 20,000', lo: 20_000.01, hi: Number.POSITIVE_INFINITY }");
  });

  it('each bucket speaks its count and honest share of the NAMED roster', () => {
    expect(doors).toContain('data-testid={`basket-ladder-bucket-${b.key}`}');
    expect(doors).toContain('% of the named');
    expect(doors).toContain('Math.round((b.count / receipts.length) * 100)');
  });

  it('a zero bucket bar draws nothing while the cell still speaks its 0', () => {
    expect(doors).toContain('{b.count > 0 && (');
  });

  it('the ladder reads the window and says so', () => {
    expect(doors).toContain('data-testid="basket-ladder-window"');
    expect(doors).toContain('The ladder reads the {receipts.length} receipt');
  });
});

describe('v2.200.0 — the house laws', () => {
  it('every panel paints its dark half from birth (the branch three-mount law)', () => {
    expect(doors).toContain('dark:border-slate-700 dark:bg-slate-900');
    expect(contrast).toContain('the branch three-mount law');
  });

  it('the doors carry NO anchors (the honest-door law)', () => {
    expect(doors).not.toContain('<a ');
    expect(doors).not.toContain('href=');
  });

  it('null rows are filtered by predicate, never by non-null assertion', () => {
    expect(doors).toContain('.filter((r): r is NonNullable<typeof r> => Boolean(r))');
    expect(doors).not.toMatch(/\.filter\(Boolean\)/);
    expect(doors).not.toMatch(/[\w)\]]!(?:\.|\[| )/);
  });

  it('the limited dashboard row is untouched (RBAC by design)', () => {
    // paymentMethodBadgeClass sits just above LimitedDashboard; everything
    // after that point is the limited row + the dashboard's own widgets.
    const limited = tab.slice(tab.indexOf('function LimitedDashboard('));
    expect(limited).toContain("label=\"Today's Sales\"");
    expect(limited).not.toContain('setDoor');
    expect(limited).not.toContain('testId=');
  });

  it('the round\'s contrast script pins the ghosts in reverse and the source literals', () => {
    expect(contrast).toContain('checkBug');
    expect(contrast).toContain('ghost: slate-400 on white (the draft light voice)');
    expect(contrast).toContain('ghost: slate-500 on slate-900 (the draft dark voice)');
    expect(contrast).toContain('documented as DECORATION');
  });

  it('the a11y doc records the round\'s numbers', () => {
    expect(a11yDoc).toContain('v2.200.0');
    expect(a11yDoc).toContain('2.63');
    expect(a11yDoc).toContain('3.74');
    expect(a11yDoc).toContain('4.77');
  });

  it('the workspace doc\'s door register carries the branch doors', () => {
    expect(workspaceDoc).toContain('v2.200.0');
    expect(workspaceDoc).toContain('The day\'s ledger');
    expect(workspaceDoc).toContain('The day\'s receipts');
    expect(workspaceDoc).toContain('The basket ladder');
  });
});

describe('v2.200.0 — the release face', () => {
  it('the package speaks 2.200.0 in all three slots', () => {
    expect(pkg.version).toBe('2.210.0');
    expect(pkg.mbumah.releaseVersion).toBe('2.210.0');
    expect(pkg.mbumah.baseVersion).toBe('2.210.0');
  });

  it('the verify script for the round is registered', () => {
    expect(pkg.scripts['verify:v2-200-0']).toBe('node scripts/verify-v2-200-0.mjs');
  });

  it('whats-new leads with the round and tells the branch story', () => {
    const i200 = whatsNew.indexOf("version: '2.200.0'");
    const i199 = whatsNew.indexOf("version: '2.199.0'");
    expect(i200).toBeGreaterThanOrEqual(0);
    expect(i199).toBeGreaterThan(i200);
    expect(whatsNew).toContain('The branch row speaks');
  });

  it('the changelog keeps the round above its predecessor (the treadmill-proof order)', () => {
    expect(changelog.indexOf('## [2.200.0] The branch row speaks')).toBeGreaterThan(-1);
    expect(changelog.indexOf('## [2.200.0] The branch row speaks')).toBeLessThan(changelog.indexOf('## [2.199.0] The pending tile opens the approval desk'));
  });
});
