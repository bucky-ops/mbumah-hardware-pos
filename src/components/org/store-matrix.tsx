'use client';

// Store Intelligence Matrix (v2.18.3 port of the sandbox Branch Intelligence
// Matrix) - renders MAIN-lineage Store rows from /api/org/summary. Sticky
// header, drag-resizable columns, column visibility, client-side CSV export
// from the loaded rows (real data only), per-row workspace modal.

import { useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Download, ExternalLink, FileText, LayoutGrid, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { kes, num, type StoreRow } from './primitives';
import { buildStoreWorkspaceUrl } from '@/lib/workspace/links';

interface ColDef {
  key: string;
  label: string;
  width: number;
  min: number;
  align?: 'left' | 'right';
  render: (s: StoreRow) => React.ReactNode;
  export: (s: StoreRow) => string | number;
}

const storeCode = (s: StoreRow) => s.code ?? s.slug ?? s.id.slice(0, 3);

const workspaceHref = (s: StoreRow) =>
  buildStoreWorkspaceUrl({ id: s.id, slug: s.slug, subdomain: s.subdomain }, { page: 'dashboard', forcePath: true });

export function StoreMatrix({ stores, onToast }: { stores: StoreRow[]; onToast: (msg: string) => void }) {
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [wsStore, setWsStore] = useState<StoreRow | null>(null);
  const dragging = useRef<{ key: string; startX: number; startW: number } | null>(null);

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
        ), export: (s) => storeCode(s) },
      { key: 'status', label: 'Status', width: 84, min: 72, render: (s) => (
          <Badge variant="outline" className={s.status === 'ACTIVE' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'text-slate-500'}>{s.status}</Badge>
        ), export: (s) => s.status },
      { key: 'revenue', label: 'Revenue', width: 104, min: 84, align: 'right', render: (s) => <span className="font-semibold text-slate-800">{num(s.todayRevenue)}</span>, export: (s) => s.todayRevenue },
      { key: 'txns', label: 'Txns', width: 62, min: 52, align: 'right', render: (s) => <span className="tabular-nums">{s.todayTransactions}</span>, export: (s) => s.todayTransactions },
      { key: 'low', label: 'Low Stock', width: 86, min: 72, align: 'right', render: (s) => (s.lowStockCount > 0 ? <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100">{s.lowStockCount}</Badge> : <span className="text-slate-500">0</span>), export: (s) => s.lowStockCount },
      { key: 'overdue', label: 'Overdue Rentals', width: 110, min: 90, align: 'right', render: (s) => (s.overdueRentals > 0 ? <Badge className="bg-red-100 text-red-700 hover:bg-red-100">{s.overdueRentals}</Badge> : <span className="text-slate-500">0</span>), export: (s) => s.overdueRentals },
      { key: 'debt', label: 'Debt Total', width: 112, min: 92, align: 'right', render: (s) => <span className={s.debtOutstanding > 150_000 ? 'font-semibold text-red-600' : 'text-slate-700'}>{kes(s.debtOutstanding)}</span>, export: (s) => s.debtOutstanding },
      { key: 'debtcount', label: 'Debt Accts', width: 88, min: 76, align: 'right', render: (s) => <span className="tabular-nums text-slate-500">{s.debtCount}</span>, export: (s) => s.debtCount },
      { key: 'mpesa', label: 'M-Pesa Pending', width: 110, min: 90, align: 'right', render: (s) => (s.pendingMpesa > 0 ? <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">{s.pendingMpesa}</Badge> : <span className="text-slate-500">0</span>), export: (s) => s.pendingMpesa },
      { key: 'actions', label: 'Actions', width: 220, min: 190, render: (s) => (
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => setWsStore(s)}><ExternalLink className="mr-1 h-3 w-3" /> Open Workspace</Button>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => onToast(`${s.name} - ${s.lowStockCount} low stock / ${s.overdueRentals} overdue rentals / debt ${kes(s.debtOutstanding)}`)}><FileText className="mr-1 h-3 w-3" /> Snapshot</Button>
          </div>
        ), export: () => '' },
    ],
    [onToast],
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

  const exportCsv = () => {
    const header = cols.filter((c) => c.key !== 'actions').map((c) => c.label).join(',');
    const rows = stores.map((s) => cols.filter((c) => c.key !== 'actions').map((c) => c.export(s)).join(','));
    const blob = new Blob([`Store Intelligence Matrix (generated ${new Date().toISOString()})\n${header}\n${rows.join('\n')}\n`], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'store_intelligence.csv';
    a.click();
    URL.revokeObjectURL(url);
    onToast('Exported store_intelligence.csv');
  };

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
                    {c.align !== 'right' && <span className="whitespace-nowrap">{c.label}</span>}
                    {c.align === 'right' && <span className="ml-auto whitespace-nowrap">{c.label}</span>}
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
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-3">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-sm font-bold text-slate-800">{value}</p>
    </div>
  );
}
