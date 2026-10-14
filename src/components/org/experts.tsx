"use client";

// Domain Expert Modules — 9 tabs over live /api/dashboard data:
// Inventory · Debt (mkopo) · Rentals · Financials · Suppliers · M-Pesa ·
// eTIMS · Audit · System.

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, Banknote, Boxes, Landmark, LifeBuoy, ReceiptText, Scale, Smartphone, Truck } from "lucide-react";
import { kes, num, type DashboardData } from "./primitives";

const PCT = (v: number) => `${v}%`;
const pctColor = (v: number) => (v >= 90 ? "text-emerald-600" : v >= 70 ? "text-amber-600" : "text-red-600");

export function ExpertModules({ data, onToast }: { data: DashboardData; onToast: (m: string) => void }) {
  const e = data.experts;
  return (
    <section aria-label="Domain Expert Modules" className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-800">Domain Expert Modules</h2>
        <p className="text-[11px] text-slate-400">Specialist consoles over shared, branch-scoped data — hidden from public surfaces, visible to authorized roles.</p>
      </header>
      <Tabs defaultValue="inventory" className="px-4 pb-4 pt-3">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-slate-50 p-1">
          <TabsTrigger value="inventory" className="text-[11px]"><Boxes className="mr-1 h-3 w-3" /> Inventory</TabsTrigger>
          <TabsTrigger value="debt" className="text-[11px]"><HandCoin /> Debt (Mkopo)</TabsTrigger>
          <TabsTrigger value="rentals" className="text-[11px]"><LifeBuoy className="mr-1 h-3 w-3" /> Rentals</TabsTrigger>
          <TabsTrigger value="financials" className="text-[11px]"><Landmark className="mr-1 h-3 w-3" /> Financials</TabsTrigger>
          <TabsTrigger value="suppliers" className="text-[11px]"><Truck className="mr-1 h-3 w-3" /> Suppliers</TabsTrigger>
          <TabsTrigger value="mpesa" className="text-[11px]"><Smartphone className="mr-1 h-3 w-3" /> M-Pesa</TabsTrigger>
          <TabsTrigger value="etims" className="text-[11px]"><ReceiptText className="mr-1 h-3 w-3" /> eTIMS</TabsTrigger>
          <TabsTrigger value="audit" className="text-[11px]"><Scale className="mr-1 h-3 w-3" /> Audit</TabsTrigger>
          <TabsTrigger value="system" className="text-[11px]"><Banknote className="mr-1 h-3 w-3" /> System</TabsTrigger>
        </TabsList>

        {/* ── Inventory Expert ─────────────────────────────────────────── */}
        <TabsContent value="inventory" className="mt-3 grid gap-4 lg:grid-cols-3">
          <div className="space-y-2 lg:col-span-1">
            <Tile label="Stock health" value={PCT(e.inventory.stockHealthPct)} tone={pctColor(e.inventory.stockHealthPct)} sub={`${num(e.inventory.totalSkus)} SKUs`} />
            <Tile label="Stock value (cost)" value={kes(e.inventory.stockValue)} sub={`retail ${kes(e.inventory.retailValue)}`} />
            <Tile label="Low stock" value={num(e.inventory.lowStock)} tone={e.inventory.lowStock ? "text-orange-500" : ""} sub="blocks checkout" />
            <Tile label="Stockout risk (7d)" value={num(e.inventory.stockoutRisk.length)} sub="items w/ ≤7d cover" />
          </div>
          <div className="lg:col-span-2">
            <SubTitle>7-day demand forecast (by category)</SubTitle>
            <Table>
              <TableHeader><TableRow><TableHead>Category</TableHead><TableHead className="text-right">Sold 7d</TableHead><TableHead className="text-right">Forecast 7d</TableHead><TableHead className="text-right">SKUs</TableHead></TableRow></TableHeader>
              <TableBody>
                {e.inventory.forecast7d.map((f) => (
                  <TableRow key={f.category}>
                    <TableCell className="text-xs">{f.category}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{num(f.sold7d)}</TableCell>
                    <TableCell className="text-right text-xs font-medium text-emerald-600 tabular-nums">{num(f.expectedDemand7d)}</TableCell>
                    <TableCell className="text-right text-xs text-slate-400">{e.inventory.categories.find((c) => c.name === f.category)?.skus ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {e.inventory.lowStockItems.length > 0 && (
              <>
                <SubTitle className="mt-3">Low stock / reorder</SubTitle>
                <div className="flex flex-wrap gap-2">
                  {e.inventory.lowStockItems.map((p) => (
                    <Badge key={p.id} variant="outline" className="border-orange-200 bg-orange-50 text-[10px] text-orange-700">
                      {p.name} · {p.stockQty}/{p.reorderLevel}
                    </Badge>
                  ))}
                </div>
                <Button size="sm" variant="outline" className="mt-2 h-7 text-[11px]" onClick={() => { window.location.href = "/api/reports/export?kind=inventory"; }}>Export inventory CSV</Button>
              </>
            )}
          </div>
        </TabsContent>

        {/* ── Debt Expert (mkopo) ──────────────────────────────────────── */}
        <TabsContent value="debt" className="mt-3 grid gap-4 lg:grid-cols-3">
          <div className="space-y-2">
            <Tile label="Outstanding" value={kes(e.debt.total)} tone={e.debt.total > 400_000 ? "text-red-500" : "text-slate-800"} sub="org-wide" />
            <Tile label="90+ days" value={kes(e.debt.aging.d90plus)} tone="text-red-500" sub={`30d ${kes(e.debt.aging.d30)} · 60d ${kes(e.debt.aging.d60)}`} />
            <Tile label="Active plans" value={num(e.debt.activePlans)} sub={`${e.debt.remindersSent} reminders sent`} />
            <Tile label="Available credit (top 10)" value={kes(e.debt.customers.reduce((a, c) => a + c.availableCredit, 0))} sub="across top debtors" />
          </div>
          <div className="lg:col-span-2">
            <SubTitle>Top debtors</SubTitle>
            <div className="max-h-64 overflow-y-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Customer</TableHead><TableHead className="text-right">Outstanding</TableHead><TableHead className="text-right">Utilization</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Risk</TableHead></TableRow></TableHeader>
                <TableBody>
                  {e.debt.customers.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="text-xs">{c.name}</TableCell>
                      <TableCell className="text-right text-xs font-semibold tabular-nums">{kes(c.outstanding)}</TableCell>
                      <TableCell className={`text-right text-xs tabular-nums ${pctColor(100 - c.utilizationPct)}`}>{c.utilizationPct}%</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] ${c.creditStatus === "ACTIVE" ? "border-emerald-200 text-emerald-700" : "border-red-200 text-red-600"}`}>{c.creditStatus}</Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs">{c.riskScore}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Button size="sm" variant="outline" className="mt-2 h-7 text-[11px]" onClick={() => { window.location.href = "/api/reports/export?kind=debt"; }}>Export debt CSV</Button>
          </div>
        </TabsContent>

        {/* ── Rentals Expert ───────────────────────────────────────────── */}
        <TabsContent value="rentals" className="mt-3 grid gap-4 lg:grid-cols-3">
          <div className="space-y-2">
            <Tile label="Active" value={num(e.rentals.active)} sub="on the yard" />
            <Tile label="Overdue" value={num(e.rentals.overdue)} tone={e.rentals.overdue ? "text-red-500" : ""} sub="damage fees may apply" />
            <Tile label="Utilization" value={PCT(e.rentals.utilizationPct)} sub="of rental fleet" />
            <Tile label="Revenue 30d" value={kes(e.rentals.revenue30d)} sub="returned rentals" />
          </div>
          <div className="lg:col-span-2">
            <SubTitle>Rental ledger (hidden from public — authorized roles only)</SubTitle>
            <div className="max-h-64 overflow-y-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Branch</TableHead><TableHead>Customer</TableHead><TableHead className="text-right">Rate/day</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {e.rentals.items.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs">{r.item} ×{r.qty}</TableCell>
                      <TableCell className="text-xs text-slate-500">{r.branch}</TableCell>
                      <TableCell className="text-xs text-slate-500">{r.customer}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{kes(r.dailyRate)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] ${r.status === "ACTIVE" ? "border-emerald-200 text-emerald-700" : r.status === "OVERDUE" ? "border-red-200 bg-red-50 text-red-600" : "text-slate-400"}`}>{r.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        {/* ── Financials Expert ────────────────────────────────────────── */}
        <TabsContent value="financials" className="mt-3 grid gap-4 lg:grid-cols-3">
          <div className="space-y-2">
            <Tile label="Net profit" value={kes(e.financials.pnl.netProfit)} tone={e.financials.pnl.netProfit >= 0 ? "text-emerald-600" : "text-red-500"} sub={`gross ${kes(e.financials.pnl.grossProfit)}`} />
            <Tile label="Cash flow 30d" value={kes(e.financials.cashFlow30d)} tone={e.financials.cashFlow30d >= 0 ? "text-emerald-600" : "text-red-500"} sub="revenue − expenses" />
            <Tile label="VAT 16% payable" value={kes(e.financials.vat.standard16)} sub={`zero-rated ${kes(e.financials.vat.zeroRated)} · exempt ${kes(e.financials.vat.exempt)}`} />
            <Tile label="Trial balance" value={e.financials.balanced ? "Balanced" : "Off"} tone={e.financials.balanced ? "text-emerald-600" : "text-red-500"} sub={`${kes(e.financials.totalDebit)} = ${kes(e.financials.totalCredit)}`} />
          </div>
          <div className="lg:col-span-2">
            <SubTitle>Chart of accounts — trial balance (double-entry)</SubTitle>
            <div className="max-h-64 overflow-y-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Account</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead></TableRow></TableHeader>
                <TableBody>
                  {e.financials.trialBalance.map((t) => (
                    <TableRow key={t.account}>
                      <TableCell className="text-xs">{t.account}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{t.debit ? kes(t.debit) : "—"}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{t.credit ? kes(t.credit) : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        {/* ── Suppliers Expert ─────────────────────────────────────────── */}
        <TabsContent value="suppliers" className="mt-3 grid gap-4 lg:grid-cols-3">
          <div className="space-y-2">
            <Tile label="Suppliers" value={num(e.suppliers.items.length)} sub={`avg lead ${e.suppliers.avgLeadTime} days`} />
            <Tile label="Delayed" value={num(e.suppliers.delayed)} tone={e.suppliers.delayed ? "text-amber-600" : "text-emerald-600"} sub="fulfillment < 70" />
            <Tile label="Open POs" value={num(e.suppliers.purchaseOrders.filter((p) => p.status !== "RECEIVED").length)} sub="awaiting delivery" />
          </div>
          <div className="lg:col-span-2">
            <SubTitle>Supplier performance (cost prices hidden from public)</SubTitle>
            <div className="max-h-64 overflow-y-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Supplier</TableHead><TableHead>Category</TableHead><TableHead className="text-right">Lead</TableHead><TableHead className="text-right">On-time</TableHead><TableHead className="text-right">Score</TableHead></TableRow></TableHeader>
                <TableBody>
                  {e.suppliers.items.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="text-xs">{s.name}</TableCell>
                      <TableCell className="text-xs text-slate-500">{s.category ?? "—"}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{s.leadTimeDays}d</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{s.onTimeRate}%</TableCell>
                      <TableCell className={`text-right text-xs font-semibold tabular-nums ${pctColor(s.fulfillmentScore)}`}>{s.fulfillmentScore}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        {/* ── M-Pesa Expert ────────────────────────────────────────────── */}
        <TabsContent value="mpesa" className="mt-3 grid gap-4 lg:grid-cols-3">
          <div className="grid grid-cols-2 gap-2">
            <Tile label="Matched" value={num(e.mpesa.today.matched)} tone="text-emerald-600" sub="verified callbacks" />
            <Tile label="Mismatch" value={num(e.mpesa.today.mismatch)} tone={e.mpesa.today.mismatch ? "text-red-500" : ""} sub="pending >10 min" />
            <Tile label="Duplicates" value={num(e.mpesa.today.duplicates)} sub="callbacks ignored" />
            <Tile label="Timeouts" value={num(e.mpesa.today.timeouts)} tone={e.mpesa.today.timeouts ? "text-amber-600" : ""} sub="result 1037" />
          </div>
          <div className="lg:col-span-2">
            <div className="mb-1 flex items-center justify-between">
              <SubTitle>Daraja STK Push ledger (no secrets exposed)</SubTitle>
              <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => onToast("Reconciliation query queued — Daraja status check simulated")}>Retry query</Button>
            </div>
            <div className="max-h-64 overflow-y-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Checkout</TableHead><TableHead>Phone</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead><TableHead>Receipt</TableHead></TableRow></TableHeader>
                <TableBody>
                  {e.mpesa.txns.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-mono text-[10px]">{m.checkoutRequestId}</TableCell>
                      <TableCell className="text-xs">{m.phoneMasked}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{kes(m.amount)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] ${m.status === "SUCCESS" ? "border-emerald-200 text-emerald-700" : m.status === "PENDING" ? "border-amber-200 text-amber-600" : "border-red-200 text-red-600"}`}>{m.status}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-[10px]">{m.mpesaReceipt ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        {/* ── eTIMS Expert ─────────────────────────────────────────────── */}
        <TabsContent value="etims" className="mt-3 grid gap-4 lg:grid-cols-3">
          <div className="space-y-2">
            <Tile label="Pending" value={num(e.etims.pending)} tone={e.etims.pending ? "text-amber-600" : "text-emerald-600"} sub="awaiting KRA" />
            <Tile label="Compliant" value={num(e.etims.compliant)} tone="text-emerald-600" sub="transmitted" />
            <Tile label="Numbering" value={e.etims.sequential ? "Sequential" : "Gaps"} tone="text-emerald-600" sub="invoice sequence" />
          </div>
          <div className="lg:col-span-2">
            <SubTitle>KRA eTIMS submission queue</SubTitle>
            <Table>
              <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead className="text-right">Balance</TableHead><TableHead className="text-right">Due</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
              <TableBody>
                {e.etims.invoices.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center text-xs text-slate-400">All invoices transmitted</TableCell></TableRow>
                )}
                {e.etims.invoices.map((i) => (
                  <TableRow key={i.number}>
                    <TableCell className="text-xs font-medium">{i.number}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{kes(i.balance)}</TableCell>
                    <TableCell className="text-right text-xs text-slate-500">{new Date(i.dueDate).toLocaleDateString("en-KE")}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => onToast(`${i.number} queued for eTIMS retry (simulated)`)}>Retry upload</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ── Audit Expert ─────────────────────────────────────────────── */}
        <TabsContent value="audit" className="mt-3">
          <SubTitle>Audit trail — CREATE events pop in live, 4h window</SubTitle>
          <div className="max-h-64 overflow-y-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>User</TableHead><TableHead>Role</TableHead><TableHead>Action</TableHead><TableHead>Resource</TableHead></TableRow></TableHeader>
              <TableBody>
                {e.audit.items.map((a, i) => (
                  <TableRow key={a.id} className={i === 0 ? "new-row-flash" : ""}>
                    <TableCell className="text-xs text-slate-500">{timeStr(a.createdAt)}</TableCell>
                    <TableCell className="text-xs">{a.userName}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px] text-slate-500">{a.role}</Badge></TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center gap-1 text-xs font-medium ${a.action === "CREATE" ? "anim-pop-in text-blue-600" : "text-slate-700"}`}>
                        {a.action === "CREATE" && <span className="h-1.5 w-1.5 rounded-full bg-blue-500 anim-pulse-dot" />}
                        {a.action}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">{a.displayMessage}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ── System Expert ────────────────────────────────────────────── */}
        <TabsContent value="system" className="mt-3 grid gap-4 lg:grid-cols-3">
          <div className="space-y-2">
            <Tile label="Overall health" value={`${e.system.healthScore}/100`} tone={e.system.healthScore >= 80 ? "text-emerald-600" : "text-amber-600"} sub={e.system.uptimeHint} />
            <Tile label="DB queue" value={num(e.system.dbQueue)} sub="pending writes" />
            <Tile label="Offline devices" value={num(e.system.offlineDevices)} sub="Dexie offline queue" />
          </div>
          <div className="lg:col-span-2">
            <SubTitle>Health breakdown</SubTitle>
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {data.health.breakdown.map((b) => (
                <div key={b.key} className="rounded-xl border border-slate-100 p-2 text-center">
                  <p className={`text-lg font-bold ${b.score >= 80 ? "text-emerald-600" : b.score >= 40 ? "text-amber-600" : "text-red-500"}`}>{b.score}</p>
                  <p className="text-[10px] font-medium text-slate-600">{b.label}</p>
                  <p className="text-[9px] text-slate-400">{b.detail}</p>
                </div>
              ))}
            </div>
            <SubTitle>Env templates</SubTitle>
            <div className="flex flex-wrap gap-1.5">
              {e.system.envTemplates.map((t) => <Badge key={t} variant="outline" className="font-mono text-[10px] text-slate-500">{t}</Badge>)}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </section>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`text-lg font-bold ${tone ?? "text-slate-800"}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
    </div>
  );
}
function SubTitle({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <h3 className={`mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 ${className}`}>{children}</h3>;
}
function timeStr(iso: string) {
  return new Date(iso).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
}
function HandCoin() {
  return <AlertTriangle className="mr-1 h-3 w-3" />;
}
