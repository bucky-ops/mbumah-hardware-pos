"use client";

// Branch Intelligence Matrix — sticky header, drag-resizable columns, column
// visibility, CSV/PDF export, per-row actions + branch workspace modal.

import { useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download, ExternalLink, FileText, LayoutGrid, PackageSearch, Receipt, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { kes, num, type BranchRow, type DashboardData } from "./primitives";

interface ColDef {
  key: string;
  label: string;
  width: number;
  min: number;
  align?: "left" | "right";
  render: (b: BranchRow) => React.ReactNode;
  export: (b: BranchRow) => string | number;
}

const HEALTH_COLOR = (h: number) => (h >= 90 ? "text-emerald-600" : h >= 75 ? "text-amber-600" : "text-red-600");

export function BranchMatrix({ data, onToast }: { data: DashboardData; onToast: (msg: string) => void }) {
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [wsBranch, setWsBranch] = useState<BranchRow | null>(null);
  const dragging = useRef<{ key: string; startX: number; startW: number } | null>(null);

  const cols: ColDef[] = useMemo(
    () => [
      { key: "branch", label: "Branch", width: 190, min: 140, render: (b) => (
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); setWsBranch(b); }}
              className="focus-ring flex h-7 w-11 items-center justify-center rounded-md text-[10px] font-bold text-white transition-transform hover:scale-105"
              style={{ background: b.brandColor ?? "#12243D" }}
              title={`Open ${b.name} workspace`}
            >
              {b.code.slice(0, 3).toUpperCase()}
            </button>
            <div>
              <p className="text-[13px] font-semibold text-slate-800">{b.name}</p>
              <p className="text-[10px] text-slate-400">{b.town} · {b.subdomain ?? b.code}</p>
            </div>
          </div>
        ), export: (b) => b.code },
      { key: "revenue", label: "Revenue", width: 96, min: 80, align: "right", render: (b) => <span className="font-semibold text-slate-800">{num(b.revenue)}</span>, export: (b) => b.revenue },
      { key: "variance", label: "Variance", width: 84, min: 70, align: "right", render: (b) => (
          <span className={b.variancePct >= 0 ? "font-medium text-emerald-600" : "font-medium text-red-600"}>{b.variancePct >= 0 ? "+" : ""}{b.variancePct}%</span>
        ), export: (b) => b.variancePct },
      { key: "txns", label: "Txns", width: 60, min: 50, align: "right", render: (b) => <span className="tabular-nums">{b.transactions}</span>, export: (b) => b.transactions },
      { key: "stock", label: "Stock Health", width: 100, min: 84, align: "right", render: (b) => (
          <span className={HEALTH_COLOR(b.stockHealthPct)}>{b.stockHealthPct}%</span>
        ), export: (b) => b.stockHealthPct },
      { key: "low", label: "Low Stock", width: 82, min: 70, align: "right", render: (b) => (b.lowStock > 0 ? <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100">{b.lowStock}</Badge> : <span className="text-slate-300">0</span>), export: (b) => b.lowStock },
      { key: "overdue", label: "Overdue Rentals", width: 110, min: 90, align: "right", render: (b) => (b.overdueRentals > 0 ? <Badge className="bg-red-100 text-red-700 hover:bg-red-100">{b.overdueRentals}</Badge> : <span className="text-slate-300">0</span>), export: (b) => b.overdueRentals },
      { key: "debt", label: "Debt Total", width: 104, min: 88, align: "right", render: (b) => <span className={b.debtTotal > 150_000 ? "font-semibold text-red-600" : "text-slate-700"}>{kes(b.debtTotal)}</span>, export: (b) => b.debtTotal },
      { key: "aging90", label: "Aging 90+", width: 92, min: 80, align: "right", render: (b) => <span className={b.aging90plus > 0 ? "text-red-500" : "text-slate-300"}>{kes(b.aging90plus)}</span>, export: (b) => b.aging90plus },
      { key: "shift", label: "Shift", width: 78, min: 70, render: (b) => (
          <Badge variant="outline" className={b.shiftStatus === "Open" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "text-slate-400"}>{b.shiftStatus}</Badge>
        ), export: (b) => b.shiftStatus },
      { key: "mpesa", label: "M-Pesa", width: 90, min: 80, render: (b) => (
          <Badge variant="outline" className={b.mpesaMatched === "Matched" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-600"}>{b.mpesaMatched}</Badge>
        ), export: (b) => b.mpesaMatched },
      { key: "etims", label: "eTIMS Pending", width: 100, min: 84, align: "right", render: (b) => (b.etimsPending > 0 ? <span className="text-amber-600">{b.etimsPending}</span> : <span className="text-slate-300">0</span>), export: (b) => b.etimsPending },
      { key: "actions", label: "Actions", width: 240, min: 200, render: (b) => (
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => setWsBranch(b)}><ExternalLink className="mr-1 h-3 w-3" /> Open Workspace</Button>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => onToast(`${b.name} — inventory view: ${b.lowStock} low / health ${b.stockHealthPct}%`)}><PackageSearch className="mr-1 h-3 w-3" /> View Inventory</Button>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => onToast(`${b.name} — debt view: ${kes(b.debtTotal)} (90+ ${kes(b.aging90plus)})`)}><HandCoinsIcon /> View Debt</Button>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => onToast(`${b.name} shift is ${b.shiftStatus.toLowerCase()} — step-up required to ${b.shiftStatus === "Open" ? "close" : "start"}.`)}><Receipt className="mr-1 h-3 w-3" /> {b.shiftStatus === "Open" ? "Close" : "Start"} Shift</Button>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => onToast(`${b.name} reports — sales & inventory exports queued.`)}><FileText className="mr-1 h-3 w-3" /> View Reports</Button>
          </div>
        ), export: () => "" },
    ],
    [onToast]
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
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const exportCsv = () => {
    window.location.href = "/api/reports/export?kind=branch_intelligence";
    onToast("Exported branch_intelligence.csv");
  };
  const exportPdf = () => {
    onToast("Opening print dialog — save as PDF");
    setTimeout(() => window.print(), 150);
  };

  return (
    <section aria-label="Branch Intelligence Matrix" className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <LayoutGrid className="h-4 w-4 text-orange-500" /> Branch Intelligence Matrix
          <Badge variant="outline" className="text-[10px] text-slate-400">{data.branches.length} branches</Badge>
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
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={exportPdf}><FileText className="mr-1 h-3 w-3" /> PDF</Button>
        </div>
      </header>

      <div className="max-h-96 overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur">
            <TableRow className="hover:bg-transparent">
              {shown.map((c) => (
                <TableHead key={c.key} style={{ width: wOf(c), minWidth: wOf(c) }} className={c.align === "right" ? "text-right" : ""}>
                  <div className="flex items-center gap-1">
                    {c.align !== "right" && <span className="whitespace-nowrap">{c.label}</span>}
                    {c.align === "right" && <span className="ml-auto whitespace-nowrap">{c.label}</span>}
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
            {data.branches.map((b, i) => (
              <TableRow key={b.id} className="anim-slide-fade" style={{ animationDelay: `${i * 70}ms` }}>
                {shown.map((c) => (
                  <TableCell key={c.key} className={c.align === "right" ? "text-right" : ""}>{c.render(b)}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Branch workspace modal */}
      <Dialog open={wsBranch !== null} onOpenChange={(o) => !o && setWsBranch(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          {wsBranch && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span className="flex h-7 w-11 items-center justify-center rounded-md text-[10px] font-bold text-white" style={{ background: wsBranch.brandColor ?? "#12243D" }}>
                    {wsBranch.code.slice(0, 3).toUpperCase()}
                  </span>
                  {wsBranch.name} workspace
                  <Badge variant="outline" className="text-[10px] text-slate-400">{wsBranch.subdomain}</Badge>
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
                    <Metric label="Revenue today" value={kes(wsBranch.revenue)} />
                    <Metric label="Transactions" value={num(wsBranch.transactions)} />
                    <Metric label="Shift" value={wsBranch.shiftStatus} />
                  </div>
                  <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
                    POS terminal available inside the branch workspace (shared DB, branch-scoped storeId). SSO session cookie applies across {data.org.rootDomain} subdomains.
                  </p>
                </TabsContent>
                <TabsContent value="inventory" className="mt-3 space-y-2">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <Metric label="Stock health" value={`${wsBranch.stockHealthPct}%`} />
                    <Metric label="Low stock" value={num(wsBranch.lowStock)} />
                    <Metric label="eTIMS pending" value={num(wsBranch.etimsPending)} />
                  </div>
                  <Button size="sm" variant="outline" onClick={() => { window.location.href = "/api/reports/export?kind=inventory"; }}>Export branch inventory CSV</Button>
                </TabsContent>
                <TabsContent value="customers" className="mt-3 space-y-2">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <Metric label="Debt total" value={kes(wsBranch.debtTotal)} />
                    <Metric label="90+ aging" value={kes(wsBranch.aging90plus)} />
                    <Metric label="M-Pesa" value={wsBranch.mpesaMatched} />
                  </div>
                  <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">Credit facilities, statements and mkopo plans are managed per customer with branch isolation.</p>
                </TabsContent>
              </Tabs>
              <div className="mt-2 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                <Badge variant="outline" className="text-[10px]"><ShieldCheck className="mr-1 h-3 w-3 text-emerald-500" /> Health {wsBranch.health}/100</Badge>
                <Badge variant="outline" className="text-[10px]">Variance {wsBranch.variancePct >= 0 ? "+" : ""}{wsBranch.variancePct}%</Badge>
                <Button size="sm" className="h-7 bg-orange-500 text-[11px] hover:bg-orange-600" onClick={() => { window.open(`/stores/${wsBranch.code}/dashboard`, "_blank"); }}>
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
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-sm font-bold text-slate-800">{value}</p>
    </div>
  );
}

function HandCoinsIcon() {
  return <HandCoinsSvg />;
}
function HandCoinsSvg() {
  return (
    <svg viewBox="0 0 24 24" className="mr-1 h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11 15h2a2 2 0 1 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 17" /><path d="m7 21 1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a2 2 0 0 0-2.75-2.91l-4.2 3.9" /><path d="m2 16 6 6" /><circle cx="16" cy="9" r="2.9" /><path d="M17.8 3.4 18.4 2M21.7 6.3 23 5.7M19.7 8.6 21 9.6" />
    </svg>
  );
}
