'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Organization Console primitives (v2.18.3 port) - shared types + micro-visuals.
// Types mirror the main-lineage payloads: /api/org/summary (store matrix rows)
// and /api/org/kpi-summary (org KPIs + expert aggregates). All values are real
// server-computed numbers - no synthetic/demo figures anywhere.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';

// ── /api/org/summary row (per-store matrix) ──────────────────────────────────
export interface StoreRow {
  id: string;
  name: string;
  code: string | null;
  slug: string | null;
  subdomain: string | null;
  location: string | null;
  phone: string | null;
  status: string;
  brandingColor: string | null;
  todayRevenue: number;
  todayTransactions: number;
  lowStockCount: number;
  overdueRentals: number;
  debtOutstanding: number;
  debtCount: number;
  pendingMpesa: number;
}

export interface OrgSummaryData {
  generatedAt: string;
  totals: {
    revenue: number;
    transactions: number;
    lowStock: number;
    overdueRentals: number;
    debtOutstanding: number;
    pendingMpesa: number;
  };
  stores: StoreRow[];
  /** v2.23.0: per-branch HR drill-down rows (ORG scope + HR module on only). */
  hrPerStore?: Array<{
    storeId: string;
    storeName: string;
    headcountActive: number;
    monthEmploymentCost: number;
    monthAbsenceRatePct: number;
    latestPayroll: { periodName: string; status: string; createdAt: string } | null;
    expiryAlerts: { documentsExpiring90Days: number; assetsOverdue: number };
  }>;
  recentAudit: Array<{
    id: string;
    storeId: string | null;
    entityType: string;
    entityId: string;
    action: string;
    userId: string | null;
    timestamp: string;
  }>;
}

// ── /api/org/kpi-summary payload ─────────────────────────────────────────────
export interface HealthBreakdownItem {
  key: string;
  label: string;
  score: number;
  detail: string;
}

export interface ActivityItem {
  id: string;
  action: string;
  entity: string;
  userName: string;
  role: string;
  displayMessage: string;
  createdAt: string;
}

export interface ConsoleAlert {
  type: string;
  severity: string;
  title: string;
  detail: string;
  actions: string[];
}

export interface KpiSummaryData {
  generatedAt: string;
  kpis: {
    revenue: { today: number; weekTotal: number; priorWeekTotal: number; variancePct: number; spark: number[] };
    transactions: { today: number; weekTotal: number; priorWeekTotal: number; variancePct: number };
    lowStock: { count: number };
    overdueRentals: { count: number };
    debt: { total: number; count: number; aging: { current: number; d30: number; d60: number; d90plus: number } };
    pending: { purchaseOrders: number; openShifts: number; expenses: number };
  };
  health: { score: number; label: string; breakdown: HealthBreakdownItem[] };
  inventory: {
    totalSkus: number;
    stockValue: number;
    retailValue: number;
    lowStock: number;
    lowStockItems: Array<{ id: string; sku: string; name: string; category: string; store: string | null; stockQty: number; reorderLevel: number }>;
  };
  debtExpert: {
    total: number;
    aging: { current: number; d30: number; d60: number; d90plus: number };
    topDebtors: Array<{ id: string; customer: string; store: string | null; outstanding: number; bucket: string; status: string }>;
    activePlans: number;
    remindersSent: number;
  };
  rentals: {
    active: number;
    overdue: number;
    items: Array<{
      id: string; item: string; store: string | null; customer: string;
      ratePerDay: number; deposit: number; status: string;
      rentalStartDate: string; expectedReturnDate: string;
    }>;
  };
  suppliers: {
    count: number;
    openPOs: number;
    overduePOs: number;
    purchaseOrders: Array<{ id: string; supplier: string; store: string | null; status: string; total: number; expectedDate: string | null }>;
  };
  mpesa: {
    today: { pending: number; stale: number; completed: number; failed: number };
    txns: Array<{ id: string; checkoutRequestId: string | null; phoneMasked: string | null; amount: number; status: string; mpesaReceipt: string | null; resultDesc: string | null; createdAt: string }>;
  };
  etims: { pending: number; issued: number };
  system: { stores: number; activeUsers: number; chatMessages: number; notificationsUnread: number };
  alerts: ConsoleAlert[];
  actionQueue: { pendingExpenses: number; pendingPOs: number; openShifts: number };
  activity: ActivityItem[];
}

// v2.64.0: the org console's "Desk activity" audit panel (GET
// /api/org/review-activity) — the v2.63.0 LeaveReviewVisit ledger read
// org-wide: who looked, where, when, whether the visit cleared a re-check.
//
// v2.65.0: the panel answers WHO and WHERE — `branches` (per-store visit
// counts, org-wide and filter-stable) powers the branch chip row, and
// `reviewerStats` (present only when the read was drilled down) carries
// the reviewer's org-wide totals for the drill-down header. `stats` stays
// org-wide under every filter — the tiles never re-key silently.
export interface DeskActivityData {
  generatedAt: string;
  stats: { total: number; weekVisits: number; weekClears: number; weekReviewers: number };
  recent: Array<{
    id: string;
    visitedByName: string;
    visitedAt: string;
    clearedRecheck: boolean;
    storeName: string | null;
    employeeName: string;
    leaveTypeName: string;
    requestStatus: string;
  }>;
  branches: Array<{ storeId: string; storeName: string; visits: number }>;
  reviewerStats?: { visits: number; clears: number; lastVisitAt: string | null };
}

// v2.65.0: the panel's active drill-down — `reviewer` matches the ledger's
// denormalised visitedByName (the string the rows render), `branch` is the
// store id. Both nullable = the unfiltered org view.
export interface DeskActivityFilter {
  reviewer: string | null;
  branch: string | null;
}

// ── Formatters ───────────────────────────────────────────────────────────────
export const kes = (v: number, dp = 0): string =>
  `KES ${v.toLocaleString('en-KE', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
export const num = (v: number): string => v.toLocaleString('en-KE');
export const timeAgo = (iso: string): string => {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

// ── CountUp (0 -> target over 1s) ────────────────────────────────────────────
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
export function Sparkline({ data, stroke = '#10b981', width = 96, height = 28 }: {
  data: number[]; stroke?: string; width?: number; height?: number;
}) {
  if (!data.length) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const points = data
    .map((v, i) => `${(i / (data.length - 1)) * (width - 4) + 2},${height - 2 - ((v - min) / range) * (height - 6)}`)
    .join(' ');
  const last = points.split(' ').slice(-1)[0].split(',');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="overflow-visible">
      <polyline points={points} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="2.5" fill={stroke} className="anim-pulse-dot" />
    </svg>
  );
}

// ── Health gauge (circular, animates 0 -> score over 1.5s) ───────────────────
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
  const stroke = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444';
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }} title={`Health ${score}/100 ${label ?? ''}`}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth="5" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={stroke} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (shown / 100) * c} style={{ transition: 'stroke-dashoffset 0.2s' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-[13px] font-bold" style={{ color: stroke }}>{shown}</span>
        {label ? <span className="text-[7px] uppercase tracking-wide text-slate-400">{label}</span> : null}
      </div>
    </div>
  );
}

// ── Mini Kenya map heatmap (simplified outline + store drop-pulse dots) ──────
const KENYA_PATH =
  'M60,18 L86,10 L104,22 L112,44 L104,66 L92,86 L74,104 L56,110 L40,100 L30,84 L22,64 L18,44 L28,28 Z';
// Known store slug positions; unknown slugs get a deterministic spread so the
// map still renders for any store set.
const STORE_GEO: Record<string, { x: number; y: number }> = {
  'juja-main': { x: 78, y: 58 },
  thika: { x: 88, y: 68 },
  ruiru: { x: 76, y: 74 },
  'nairobi-cbd': { x: 64, y: 70 },
  nakuru: { x: 48, y: 58 },
};
const FALLBACK_GEO = [
  { x: 64, y: 52 },
  { x: 82, y: 62 },
  { x: 60, y: 78 },
  { x: 44, y: 62 },
  { x: 72, y: 88 },
];
export function KenyaMap({ stores }: { stores: StoreRow[] }) {
  const maxRev = Math.max(...stores.map((s) => s.todayRevenue), 1);
  return (
    <svg viewBox="0 0 130 130" className="mx-auto h-44 w-44" role="img" aria-label="Store heatmap - Kenya">
      <path d={KENYA_PATH} fill="#f1f5f9" stroke="#cbd5e1" strokeWidth="1.5" />
      {stores.map((s, idx) => {
        const key = s.slug ?? s.code ?? '';
        const geo = STORE_GEO[key] ?? FALLBACK_GEO[idx % FALLBACK_GEO.length];
        const heat = s.todayRevenue / maxRev;
        const color = heat > 0.5 ? '#FF8C00' : heat > 0 ? '#10b981' : '#94a3b8';
        return (
          <g key={s.id} className="anim-drop" style={{ animationDelay: `${idx * 90}ms` }}>
            <circle cx={geo.x} cy={geo.y} r={6 + heat * 5} fill={color} opacity={0.25}>
              <animate attributeName="r" values={`${4 + heat * 4};${8 + heat * 6};${4 + heat * 4}`} dur="2.4s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.35;0.12;0.35" dur="2.4s" repeatCount="indefinite" />
            </circle>
            <circle cx={geo.x} cy={geo.y} r="3.2" fill={color} stroke="#fff" strokeWidth="1.2" />
            <title>{`${s.name} - ${kes(s.todayRevenue)}`}</title>
          </g>
        );
      })}
      <text x="65" y="126" textAnchor="middle" className="fill-slate-400" style={{ fontSize: 8 }}>Store heatmap · revenue</text>
    </svg>
  );
}
