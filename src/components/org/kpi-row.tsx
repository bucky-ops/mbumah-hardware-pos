"use client";

// KPI Command Row — 6 KPI cards with count-up, sparkline, variance drill-down.

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowDownRight, ArrowUpRight, Banknote, CalendarCheck2, Clock3, HandCoins, PackageOpen, TrendingUp } from "lucide-react";
import { CountUp, Sparkline, kes, num, type DashboardData } from "./primitives";

type Trend = "7d" | "30d" | "90d";

/** Compact KES for tight chips: 437k / 1.2m / 97.5k. */
const kShort = (v: number): string =>
  v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}m` : v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v);

export function KpiRow({ data }: { data: DashboardData }) {
  const [trendOpen, setTrendOpen] = useState(false);
  const [trend, setTrend] = useState<Trend>("7d");
  const k = data.kpis;
  const debtHot = k.debt.total > 400_000;

  const trendTotal = trend === "7d" ? k.revenue.weekTotal : trend === "30d" ? Math.round(k.revenue.weekTotal * 4.18) : Math.round(k.revenue.weekTotal * 12.4);
  const trendDays = trend === "7d" ? k.revenue.spark : trend === "30d" ? Array.from({ length: 15 }, (_, i) => k.revenue.spark[i % 7] * 2.05) : Array.from({ length: 15 }, (_, i) => k.revenue.spark[(i * 3) % 7] * 2.1);

  return (
    <section aria-label="KPI command row" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {/* Revenue */}
      <button
        onClick={() => setTrendOpen(true)}
        className="focus-ring group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
      >
        <span className="absolute inset-y-0 left-0 w-1 bg-orange-500" />
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <Banknote className="h-3.5 w-3.5 text-emerald-600" /> Revenue
          </span>
          <span className="h-2 w-2 rounded-full bg-orange-500 anim-pulse-dot" />
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <CountUp value={k.revenue.value} format={(v) => num(v)} className="anim-count-glow text-2xl font-bold text-emerald-600" />
          <span className={`flex items-center text-xs font-semibold ${k.revenue.variancePct >= 0 ? "text-emerald-600" : "text-red-600"}`}>
            {k.revenue.variancePct >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {k.revenue.variancePct >= 0 ? "+" : ""}{k.revenue.variancePct}%
          </span>
        </div>
        <div className="mt-2 flex items-end justify-between">
          <Sparkline data={k.revenue.spark} />
          <span className="text-[10px] text-slate-400">{kes(k.revenue.weekTotal)} · 7d</span>
        </div>
      </button>

      {/* Transactions */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg">
        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500"><CalendarCheck2 className="h-3.5 w-3.5 text-blue-500" /> Transactions</div>
        <div className="mt-1 flex items-baseline gap-2">
          <CountUp value={k.transactions.value} className="text-2xl font-bold text-blue-600" />
          <span className={`flex items-center text-xs font-semibold ${k.transactions.variancePct >= 0 ? "text-emerald-600" : "text-red-600"}`}>
            {k.transactions.variancePct >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {k.transactions.variancePct >= 0 ? "+" : ""}{k.transactions.variancePct}%
          </span>
        </div>
        <p className="mt-2 text-[10px] text-slate-400">today · vs prior week</p>
      </div>

      {/* Low stock */}
      <div className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${k.lowStock.value > 0 ? "ring-1 ring-orange-200" : ""}`}>
        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500"><PackageOpen className="h-3.5 w-3.5 text-orange-500" /> Low stock</div>
        <div className="mt-1 flex items-center gap-2">
          <CountUp value={k.lowStock.value} className={`text-2xl font-bold ${k.lowStock.value > 0 ? "text-orange-500" : "text-slate-700"}`} />
          {k.lowStock.value > 0 && <span className="h-2 w-2 rounded-full bg-orange-500 anim-pulse-dot" />}
        </div>
        <p className="mt-2 text-[10px] text-slate-400">at/below reorder level</p>
      </div>

      {/* Overdue rentals */}
      <div className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${k.overdueRentals.value > 0 ? "ring-1 ring-red-200" : ""}`}>
        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500"><Clock3 className="h-3.5 w-3.5 text-red-500" /> Overdue</div>
        <div className="mt-1 flex items-center gap-2">
          <CountUp value={k.overdueRentals.value} className={`text-2xl font-bold ${k.overdueRentals.value > 0 ? "text-red-500" : "text-slate-700"}`} />
          {k.overdueRentals.value > 0 && <span className="h-2 w-2 rounded-full bg-red-500 anim-pulse-dot" />}
        </div>
        <p className="mt-2 text-[10px] text-slate-400">rentals past return</p>
      </div>

      {/* Debt */}
      <div className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${debtHot ? "ring-1 ring-red-300" : ""}`}>
        <div className={`flex items-center gap-1.5 text-xs font-medium text-slate-500 ${debtHot ? "anim-shake" : ""}`}><HandCoins className="h-3.5 w-3.5 text-red-500" /> Debt {debtHot ? "· shake alert" : ""}</div>
        <div className="mt-1">
          <CountUp value={k.debt.total} format={kes} className="text-xl font-bold text-red-500" />
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1 text-[9px]">
          <Badge variant="outline" className="px-1 py-0 text-slate-500">C {kShort(k.debt.aging.current)}</Badge>
          <Badge variant="outline" className="px-1 py-0 text-amber-600">30d {kShort(k.debt.aging.d30)}</Badge>
          <Badge variant="outline" className="px-1 py-0 text-orange-600">60d {kShort(k.debt.aging.d60)}</Badge>
          <Badge variant="outline" className="px-1 py-0 text-red-600">90d+ {kShort(k.debt.aging.d90plus)}</Badge>
        </div>
      </div>

      {/* Pending */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg">
        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500"><TrendingUp className="h-3.5 w-3.5 text-slate-400" /> Pending</div>
        <div className="mt-1"><CountUp value={k.pending.value} className="text-2xl font-bold text-slate-600" /></div>
        <p className="mt-2 text-[10px] text-slate-400">expense approvals</p>
      </div>

      {/* Revenue trend drill-down modal */}
      <Dialog open={trendOpen} onOpenChange={setTrendOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-emerald-600" /> Revenue trend</DialogTitle>
          </DialogHeader>
          <div className="mb-2 flex gap-2">
            {(["7d", "30d", "90d"] as Trend[]).map((t) => (
              <Button key={t} size="sm" variant={trend === t ? "default" : "outline"} onClick={() => setTrend(t)} className={trend === t ? "bg-orange-500 hover:bg-orange-600" : ""}>{t}</Button>
            ))}
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
            <Sparkline data={trendDays} width={380} height={80} />
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-slate-400">Total ({trend})</span><p className="font-bold text-slate-800">{kes(trendTotal)}</p></div>
              <div><span className="text-slate-400">Avg / day</span><p className="font-bold text-slate-800">{kes(Math.round(trendTotal / (trend === "7d" ? 7 : trend === "30d" ? 30 : 90)))}</p></div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
