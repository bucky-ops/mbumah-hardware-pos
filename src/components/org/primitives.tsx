"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Organization Console primitives (v2.18.2) — shared types + micro-visuals.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from "react";

// ── Dashboard payload types (per /api/dashboard) ─────────────────────────────
export interface BranchRow {
  id: string; code: string; name: string; town: string | null; slug: string | null;
  subdomain: string | null; brandColor: string | null;
  revenue: number; variancePct: number; transactions: number;
  stockHealthPct: number; lowStock: number; overdueRentals: number;
  debtTotal: number; aging90plus: number;
  shiftStatus: "Open" | "Closed"; mpesaMatched: "Matched" | "Mismatch"; etimsPending: number;
  health: number;
}
export interface DashboardData {
  ok: boolean;
  release: { version: string; label: string; commit: string; commitShort: string; commits: number; releases: number; tags: number; channel: string; env: string };
  org: { name: string; tagline: string; phone1: string; phone2: string; email: string; rootDomain: string; demoDomain: string };
  now: string;
  health: { score: number; label: string; breakdown: Array<{ key: string; label: string; score: number; weight: number; detail: string }> };
  kpis: {
    revenue: { value: number; variancePct: number; weekTotal: number; spark: number[] };
    transactions: { value: number; variancePct: number };
    lowStock: { value: number };
    overdueRentals: { value: number };
    debt: { total: number; aging: { current: number; d30: number; d60: number; d90plus: number } };
    pending: { value: number };
  };
  branches: BranchRow[];
  experts: {
    inventory: {
      totalSkus: number; stockValue: number; retailValue: number; lowStock: number; stockHealthPct: number;
      lowStockItems: Array<{ id: string; sku: string; name: string; category: string; stockQty: number; reorderLevel: number }>;
      stockoutRisk: Array<{ id: string; name: string; daysOfCover: number; stockQty: number }>;
      forecast7d: Array<{ category: string; sold7d: number; expectedDemand7d: number }>;
      categories: Array<{ name: string; skus: number; unitsSold7d: number }>;
    };
    debt: {
      total: number; aging: { current: number; d30: number; d60: number; d90plus: number };
      customers: Array<{ id: string; name: string; outstanding: number; creditLimit: number; availableCredit: number; creditStatus: string; riskScore: number; utilizationPct: number }>;
      activePlans: number; remindersSent: number;
    };
    rentals: {
      active: number; overdue: number; utilizationPct: number; revenue30d: number;
      items: Array<{ id: string; item: string; branch: string; customer: string; qty: number; dailyRate: number; deposit: number; status: string; rentOutAt: string; expectedReturnAt: string }>;
    };
    financials: {
      trialBalance: Array<{ account: string; debit: number; credit: number }>;
      totalDebit: number; totalCredit: number; balanced: boolean;
      pnl: { revenue: number; cogs: number; grossProfit: number; expenses: number; netProfit: number };
      vat: { standard16: number; zeroRated: number; exempt: number };
      cashFlow30d: number;
    };
    suppliers: {
      items: Array<{ id: string; name: string; category: string | null; leadTimeDays: number; onTimeRate: number; fulfillmentScore: number }>;
      delayed: number; avgLeadTime: number;
      purchaseOrders: Array<{ id: string; number: string; supplier: string; branch: string; status: string; total: number; expectedAt: string | null }>;
    };
    mpesa: {
      today: { matched: number; mismatch: number; pending: number; failed: number; duplicates: number; timeouts: number };
      txns: Array<{ id: string; checkoutRequestId: string; phoneMasked: string; amount: number; purpose: string; status: string; mpesaReceipt: string | null; resultDesc: string | null; createdAt: string }>;
    };
    etims: { pending: number; compliant: number; invoices: Array<{ number: string; balance: number; dueDate: string }>; sequential: boolean };
    audit: { items: ActivityItem[] };
    system: { healthScore: number; uptimeHint: string; dbQueue: number; offlineDevices: number; envTemplates: string[]; breakdown: { revenue: number; stock: number; debt: number; engagement: number } };
  };
  alerts: Array<{ type: string; severity: string; title: string; detail: string; actions: string[] }>;
  actionQueue: { pendingExpenses: number; pendingPOs: number; openShifts: number; managerAuthorizations: number };
  activity: ActivityItem[];
  notifications: number;
  chatUnread: number;
}
export interface ActivityItem {
  id: string; action: string; entity: string; userName: string; role: string;
  displayMessage: string; createdAt: string;
}

// ── Formatters ───────────────────────────────────────────────────────────────
export const kes = (v: number, dp = 0): string =>
  `KES ${v.toLocaleString("en-KE", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
export const num = (v: number): string => v.toLocaleString("en-KE");
export const timeAgo = (iso: string): string => {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

// ── CountUp (0 → target over 1s) ─────────────────────────────────────────────
export function CountUp({ value, format = num, duration = 1000, className }: {
  value: number; format?: (v: number) => string; duration?: number; className?: string;
}) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const from = fromRef.current;
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(from + (value - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span className={className}>{format(display)}</span>;
}

// ── Sparkline (7d revenue) ───────────────────────────────────────────────────
export function Sparkline({ data, stroke = "#10b981", width = 96, height = 28 }: {
  data: number[]; stroke?: string; width?: number; height?: number;
}) {
  if (!data.length) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const points = data
    .map((v, i) => `${(i / (data.length - 1)) * (width - 4) + 2},${height - 2 - ((v - min) / range) * (height - 6)}`)
    .join(" ");
  const last = points.split(" ").slice(-1)[0].split(",");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="overflow-visible">
      <polyline points={points} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="2.5" fill={stroke} className="anim-pulse-dot" />
    </svg>
  );
}

// ── Health gauge (circular, animates 0 → score over 1.5s) ────────────────────
export function HealthGauge({ score, label, size = 56 }: { score: number; label?: string; size?: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 1500);
      setShown(Math.round(score * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [score]);
  const stroke = score >= 80 ? "#10b981" : score >= 60 ? "#f59e0b" : "#ef4444";
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }} title={`Health ${score}/100 ${label ?? ""}`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth="5" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={stroke} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (shown / 100) * c} style={{ transition: "stroke-dashoffset 0.2s" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-[13px] font-bold" style={{ color: stroke }}>{shown}</span>
        {label ? <span className="text-[7px] uppercase tracking-wide text-slate-400">{label}</span> : null}
      </div>
    </div>
  );
}

// ── Mini Kenya map heatmap (simplified outline + branch drop-pulse dots) ─────
const KENYA_PATH =
  "M60,18 L86,10 L104,22 L112,44 L104,66 L92,86 L74,104 L56,110 L40,100 L30,84 L22,64 L18,44 L28,28 Z";
const BRANCH_GEO: Record<string, { x: number; y: number }> = {
  "juja-main": { x: 78, y: 58 },
  thika: { x: 88, y: 68 },
  ruiru: { x: 76, y: 74 },
  "nairobi-cbd": { x: 64, y: 70 },
  nakuru: { x: 48, y: 58 },
};
export function KenyaMap({ branches }: { branches: BranchRow[] }) {
  const maxRev = Math.max(...branches.map((b) => b.revenue), 1);
  return (
    <svg viewBox="0 0 130 130" className="mx-auto h-44 w-44" role="img" aria-label="Branch heatmap — Kenya">
      <path d={KENYA_PATH} fill="#f1f5f9" stroke="#cbd5e1" strokeWidth="1.5" />
      {branches.map((b, idx) => {
        const geo = BRANCH_GEO[b.code] ?? { x: 64, y: 64 };
        const heat = b.revenue / maxRev;
        const color = heat > 0.5 ? "#FF8C00" : heat > 0 ? "#10b981" : "#94a3b8";
        return (
          <g key={b.code} className="anim-drop" style={{ animationDelay: `${idx * 90}ms` }}>
            <circle cx={geo.x} cy={geo.y} r={6 + heat * 5} fill={color} opacity={0.25}>
              <animate attributeName="r" values={`${4 + heat * 4};${8 + heat * 6};${4 + heat * 4}`} dur="2.4s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.35;0.12;0.35" dur="2.4s" repeatCount="indefinite" />
            </circle>
            <circle cx={geo.x} cy={geo.y} r="3.2" fill={color} stroke="#fff" strokeWidth="1.2" />
            <title>{`${b.name} — ${kes(b.revenue)}`}</title>
          </g>
        );
      })}
      <text x="65" y="126" textAnchor="middle" className="fill-slate-400" style={{ fontSize: 8 }}>Branch heatmap · revenue</text>
    </svg>
  );
}
