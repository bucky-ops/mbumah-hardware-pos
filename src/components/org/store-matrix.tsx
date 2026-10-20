'use client';

// Store Intelligence Matrix (v2.18.3 port of the sandbox Branch Intelligence
// Matrix) - renders MAIN-lineage Store rows from /api/org/summary. Sticky
// header, drag-resizable columns, column visibility, client-side CSV export
// from the loaded rows (real data only), per-row workspace modal.
//
// v2.179.0 — the matrix reads the week: a "Week 7d" column speaks each
// store's seven-day shape (the SAME muted spark + WeekDeltaChip verdict the
// branches table and the store strip speak), joined by storeId from the
// perStoreTrend block the page already polls — no second fetch, an absent
// block degrades to the calm dash. The CSV export moves into a PURE lib
// (src/lib/org/store-matrix-csv.ts) and becomes the table's offline twin:
// Week 7d (KES), Prior week (KES) and Change (%) ride inline after Revenue,
// computed by the SAME weekDelta classifier the chips speak. The workspace
// modal's POS tab gains the week at the top — one week, one vocabulary,
// three surfaces.

import { useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Download, ExternalLink, FileText, LayoutGrid, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { Sparkline, WeekDeltaChip, kes, num, weekDeltaWords, type StoreRow } from './primitives';
import { buildStoreMatrixCsv } from '@/lib/org/store-matrix-csv';
import { buildStoreWorkspaceUrl } from '@/lib/workspace/links';

/**
 * v2.179.0: one store's week, as the summary's perStoreTrend block carries
 * it (the SAME shape the dashboard table and the store strip join on).
 * TOLERANT by contract — the whole prop is optional and nullable, and a
 * store with no entry renders the calm dash, never a fabricated shape.
 */
export type StoreMatrixTrendEntry = {
  storeId: string;
  spark: number[];
  weekTotal: number;
  priorWeekTotal?: number;
};

interface ColDef {
  key: string;
  label: string;
  /** Optional header hover hint — the column's semantics, one clause. */
  hint?: string;
  width: number;
  min: number;
  align?: 'left' | 'right';
  render: (s: StoreRow) => React.ReactNode;
}

const storeCode = (s: StoreRow) => s.code ?? s.slug ?? s.id.slice(0, 3);

const workspaceHref = (s: StoreRow) =>
  buildStoreWorkspaceUrl({ id: s.id, slug: s.slug, subdomain: s.subdomain }, { page: 'dashboard', forcePath: true });

export function StoreMatrix({
  stores,
  trend,
  onToast,
}: {
  stores: StoreRow[];
  /** v2.179.0: the summary's perStoreTrend block, passed through untouched. */
  trend?: StoreMatrixTrendEntry[] | null;
  onToast: (msg: string) => void;
}) {
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [wsStore, setWsStore] = useState<StoreRow | null>(null);
  const dragging = useRef<{ key: string; startX: number; startW: number } | null>(null);

  // v2.179.0: the week join — by storeId, never row order (the same rule
  // the branches table and the store strip speak). One Map, rebuilt only
  // when the block itself changes; a nullish block degrades to an empty map
  // and every cell falls back to the calm dash.
  const trendById = useMemo(
    () => new Map((trend ?? []).map((t) => [t.storeId, t])),
    [trend],
  );

  const cols: ColDef[] = useMemo(
    () => [
      { key: 'store', label: 'Store', width: 190, min: 140, render: (s) => (
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); setWsStore(s); }}
              className="focus-ring flex h-7 w-11 items-center justify-center rounded-md text-[10px] font-bold text-white transition-transform hover:scale-105"
              style={{ background: s.brandingColor ?? '#12243D' }}
              title={`Open ${s.name} workspace`}
            >
              {storeCode(s).slice(0, 3).toUpperCase()}
            </button>
            <div>
              <p className="text-[13px] font-semibold text-slate-800">{s.name}</p>
              <p className="text-[10px] text-slate-500">{s.location ?? ''} {s.subdomain ? `· ${s.subdomain}` : ''}</p>
            </div>
          </div>
        ) },
      { key: 'status', label: 'Status', width: 84, min: 72, render: (s) => (
          <Badge variant="outline" className={s.status === 'ACTIVE' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'text-slate-500'}>{s.status}</Badge>
        ) },
      { key: 'revenue', label: 'Revenue', width: 104, min: 84, align: 'right', render: (s) => <span className="font-semibold text-slate-800">{num(s.todayRevenue)}</span> },
      { key: 'week', label: 'Week 7d', hint: '7-day gross revenue, week ending today', width: 168, min: 136, render: (s) => (
          <MatrixWeekCell entry={trendById.get(s.id) ?? null} />
        ) },
      { key: 'txns', label: 'Txns', width: 62, min: 52, align: 'right', render: (s) => <span className="tabular-nums">{s.todayTransactions}</span> },
      { key: 'low', label: 'Low Stock', width: 86, min: 72, align: 'right', render: (s) => (s.lowStockCount > 0 ? <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100">{s.lowStockCount}</Badge> : <span className="text-slate-500">0</span>) },
      { key: 'overdue', label: 'Overdue Rentals', width: 110, min: 90, align: 'right', render: (s) => (s.overdueRentals > 0 ? <Badge className="bg-red-100 text-red-800 hover:bg-red-100">{s.overdueRentals}</Badge> : <span className="text-slate-500">0</span>) },
      { key: 'debt', label: 'Debt Total', width: 112, min: 92, align: 'right', render: (s) => <span className={s.debtOutstanding > 150_000 ? 'font-semibold text-red-600' : 'text-slate-700'}>{kes(s.debtOutstanding)}</span> },
      { key: 'debtcount', label: 'Debt Accts', width: 88, min: 76, align: 'right', render: (s) => <span className="tabular-nums text-slate-500">{s.debtCount}</span> },
      { key: 'mpesa', label: 'M-Pesa Pending', width: 110, min: 90, align: 'right', render: (s) => (s.pendingMpesa > 0 ? <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">{s.pendingMpesa}</Badge> : <span className="text-slate-500">0</span>) },
      { key: 'actions', label: 'Actions', width: 220, min: 190, render: (s) => (
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => setWsStore(s)}><ExternalLink className="mr-1 h-3 w-3" /> Open Workspace</Button>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => onToast(`${s.name} - ${s.lowStockCount} low stock / ${s.overdueRentals} overdue rentals / debt ${kes(s.debtOutstanding)}`)}><FileText className="mr-1 h-3 w-3" /> Snapshot</Button>
          </div>
        ) },
    ],
    [onToast, trendById],
  );

  const shown = cols.filter((c) => visible[c.key] !== false);
  const wOf = (c: ColDef) => widths[c.key] ?? c.width;

  const onDown = (key: string, e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = { key, startX: e.clientX, startW: wOf(cols.find((c) => c.key === key)!) };
    const move = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const col = cols.find((c) => c.key === dragging.current!.key)!;
      const w = Math.max(col.min, dragging.current.startW + ev.clientX - dragging.current.startX);
      setWidths((prev) => ({ ...prev, [key]: w }));
    };
    const up = () => {
      dragging.current = null;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // v2.179.0: the file is built by the PURE lib (src/lib/org/store-matrix-csv.ts)
  // — the one writer of these bytes — and the toast counts the week it
  // carried, the same parity move the branches export made in v2.178.0.
  const exportCsv = () => {
    const csv = buildStoreMatrixCsv(
      stores.map((s) => ({
        id: s.id,
        code: storeCode(s),
        status: s.status,
        todayRevenue: s.todayRevenue,
        todayTransactions: s.todayTransactions,
        lowStockCount: s.lowStockCount,
        overdueRentals: s.overdueRentals,
        debtOutstanding: s.debtOutstanding,
        debtCount: s.debtCount,
        pendingMpesa: s.pendingMpesa,
      })),
      new Date(),
      trend,
    );
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'store_intelligence.csv';
    a.click();
    URL.revokeObjectURL(url);
    onToast(trend && trend.length > 0 ? 'Exported store_intelligence.csv · week by store' : 'Exported store_intelligence.csv');
  };

  // v2.179.0: the open workspace dialog's week — the same join by storeId;
  // the accessible verdict is computed once (null → the dialog stays silent,
  // the base clauses already said everything there is).
  const wsTrend = wsStore ? trendById.get(wsStore.id) ?? null : null;
  const wsWords = wsTrend ? weekDeltaWords(wsTrend.weekTotal, wsTrend.priorWeekTotal ?? 0) : null;

  return (
    <section aria-label="Store Intelligence Matrix" className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <LayoutGrid className="h-4 w-4 text-orange-500" /> Store Intelligence Matrix
          <Badge variant="outline" className="text-[10px] text-slate-500">{stores.length} stores</Badge>
        </h2>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 text-[11px]"><SlidersHorizontal className="mr-1 h-3 w-3" /> Columns</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
              <DropdownMenuLabel>Column visibility</DropdownMenuLabel>
              {cols.map((c) => (
                <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-slate-50">
                  <Checkbox checked={visible[c.key] !== false} onCheckedChange={(v) => setVisible((p) => ({ ...p, [c.key]: Boolean(v) }))} />
                  {c.label}
                </label>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={exportCsv}><Download className="mr-1 h-3 w-3" /> CSV</Button>
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => { onToast('Opening print dialog - save as PDF'); setTimeout(() => window.print(), 150); }}><FileText className="mr-1 h-3 w-3" /> PDF</Button>
        </div>
      </header>

      <div className="max-h-96 overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur">
            <TableRow className="hover:bg-transparent">
              {shown.map((c) => (
                <TableHead key={c.key} style={{ width: wOf(c), minWidth: wOf(c) }} className={c.align === 'right' ? 'text-right' : ''}>
                  <div className="flex items-center gap-1">
                    {c.align !== 'right' && <span className="whitespace-nowrap" title={c.hint}>{c.label}</span>}
                    {c.align === 'right' && <span className="ml-auto whitespace-nowrap" title={c.hint}>{c.label}</span>}
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      className="ml-1 h-4 w-1 cursor-col-resize rounded bg-slate-200 hover:bg-orange-400"
                      onMouseDown={(e) => onDown(c.key, e)}
                      title="Drag to resize"
                    />
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {stores.map((s, i) => (
              <TableRow key={s.id} className="anim-slide-fade" style={{ animationDelay: `${i * 70}ms` }}>
                {shown.map((c) => (
                  <TableCell key={c.key} className={c.align === 'right' ? 'text-right' : ''}>{c.render(s)}</TableCell>
                ))}
              </TableRow>
            ))}
            {stores.length === 0 && (
              <TableRow><TableCell colSpan={shown.length} className="py-8 text-center text-xs text-slate-500">No stores returned by /api/org/summary for this role.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Store workspace modal */}
      <Dialog open={wsStore !== null} onOpenChange={(o) => !o && setWsStore(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          {wsStore && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span className="flex h-7 w-11 items-center justify-center rounded-md text-[10px] font-bold text-white" style={{ background: wsStore.brandingColor ?? '#12243D' }}>
                    {storeCode(wsStore).slice(0, 3).toUpperCase()}
                  </span>
                  {wsStore.name} workspace
                  <Badge variant="outline" className="text-[10px] text-slate-500">{wsStore.subdomain ?? wsStore.slug ?? wsStore.id}</Badge>
                </DialogTitle>
              </DialogHeader>
              <Tabs defaultValue="pos" className="mt-1">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="pos">POS</TabsTrigger>
                  <TabsTrigger value="inventory">Inventory</TabsTrigger>
                  <TabsTrigger value="customers">Customers</TabsTrigger>
                </TabsList>
                <TabsContent value="pos" className="mt-3 space-y-2">
                  {/* v2.179.0: the week at the top of the workspace dialog — the
                      SAME shape + verdict the matrix cell speaks (spark, gross
                      total, chip), the tooltip carries the prior week, and the
                      accessible verdict rides weekDeltaWords as its own sr-only
                      sentence. No week in the block → the row simply never
                      renders — the dialog stays about today, nothing invented. */}
                  {wsTrend ? (
                    <div
                      className="flex items-center justify-between gap-3 rounded-xl border border-orange-100 bg-orange-50/60 p-3 dark:border-orange-900/40 dark:bg-orange-950/20"
                      title={`7-day revenue ${kes(wsTrend.weekTotal)} (gross)${wsTrend.priorWeekTotal ? ` · prior ${kes(wsTrend.priorWeekTotal)}` : ''}`}
                    >
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-slate-500">7-day revenue (gross)</p>
                        <p className="text-sm font-bold tabular-nums text-slate-800">{kes(wsTrend.weekTotal)}</p>
                        <span className="sr-only">7-day revenue {kes(wsTrend.weekTotal)}</span>
                        {wsWords ? <span className="sr-only">{wsWords}</span> : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <Sparkline data={wsTrend.spark} stroke="#64748b" width={72} height={20} />
                        <WeekDeltaChip current={wsTrend.weekTotal} prior={wsTrend.priorWeekTotal ?? 0} />
                      </div>
                    </div>
                  ) : null}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <Metric label="Revenue today" value={kes(wsStore.todayRevenue)} />
                    <Metric label="Transactions" value={num(wsStore.todayTransactions)} />
                    <Metric label="Status" value={wsStore.status} />
                  </div>
                  <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
                    The POS terminal lives inside the branch workspace (shared database, store-scoped by the session). Open it with the button below; the workspace link uses the same path/subdomain rules as the rest of the app.
                  </p>
                </TabsContent>
                <TabsContent value="inventory" className="mt-3 space-y-2">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <Metric label="Low stock" value={num(wsStore.lowStockCount)} />
                    <Metric label="Overdue rentals" value={num(wsStore.overdueRentals)} />
                    <Metric label="M-Pesa pending" value={num(wsStore.pendingMpesa)} />
                  </div>
                </TabsContent>
                <TabsContent value="customers" className="mt-3 space-y-2">
                  <div className="grid grid-cols-2 gap-2 text-center">
                    <Metric label="Debt total" value={kes(wsStore.debtOutstanding)} />
                    <Metric label="Debt accounts" value={num(wsStore.debtCount)} />
                  </div>
                  <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">Credit facilities and mkopo plans are managed per customer inside the store workspace; cross-store access is blocked server-side.</p>
                </TabsContent>
              </Tabs>
              <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                <Badge variant="outline" className="text-[10px]"><ShieldCheck className="mr-1 h-3 w-3 text-emerald-500" /> {wsStore.status}</Badge>
                <Button size="sm" className="h-7 bg-orange-500 text-[11px] hover:bg-orange-600" onClick={() => { window.open(workspaceHref(wsStore), '_blank', 'noopener'); }}>
                  Open full workspace <ExternalLink className="ml-1 h-3 w-3" />
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );

  /**
   * v2.179.0: the matrix's week cell — the amount is the hero (the strip's
   * own "7-day revenue KES X" number, tabular so the digits stop dancing),
   * the muted spark + WeekDeltaChip sit under it (the branches table's exact
   * vocabulary, sized to the cell), the tooltip composes the prior week when
   * one exists, and the accessible words ride weekDeltaWords as sr-only
   * sentences. Honest absence: a store with no entry in the block renders
   * the calm dash — aria-hidden, exactly the dashboard's dash — never a
   * fabricated zero, never a stuck loading state.
   */
  function MatrixWeekCell({ entry }: { entry: StoreMatrixTrendEntry | null }) {
    if (!entry) {
      return (
        <span className="text-muted-foreground" aria-hidden="true">
          —
        </span>
      );
    }
    const words = weekDeltaWords(entry.weekTotal, entry.priorWeekTotal ?? 0);
    return (
      <div
        className="flex w-[140px] flex-col gap-0.5"
        title={`7-day revenue ${kes(entry.weekTotal)} (gross)${entry.priorWeekTotal ? ` · prior ${kes(entry.priorWeekTotal)}` : ''}`}
      >
        <span className="text-[13px] font-semibold tabular-nums text-slate-800">{kes(entry.weekTotal)}</span>
        <div className="flex items-center gap-1.5">
          <Sparkline data={entry.spark} stroke="#64748b" width={64} height={18} />
          <WeekDeltaChip current={entry.weekTotal} prior={entry.priorWeekTotal ?? 0} />
        </div>
        <span className="sr-only">7-day revenue {kes(entry.weekTotal)}</span>
        {words ? <span className="sr-only">{words}</span> : null}
      </div>
    );
  }
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-3">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-sm font-bold text-slate-800">{value}</p>
    </div>
  );
}
