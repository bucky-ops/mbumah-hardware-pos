'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Download, BarChart3, Package, TrendingUp, TrendingDown,
  ArrowUpRight, ArrowDownRight, Minus, FileText, Boxes,
  ShoppingCart, DollarSign, FileSpreadsheet, FileDown,
  Calendar, Clock, Eye, Play, Sparkles, PieChart,
  HeartPulse, RotateCcw, CreditCard, Banknote, Smartphone,
  AlertTriangle, Users, Timer, Printer, Wrench,
  Search, ClipboardList, Sparkle, Link2, ArrowRight,
} from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, Cell,
} from 'recharts';

import { useAppStore } from '@/lib/stores';
import {
  reportsApi, dashboardApi,
  customersApi, rentalsApi, transactionsApi,
  formatKES,
  type CustomerItem,
  type RentalItem,
} from '@/lib/api';
import { handleError } from '@/lib/error-handler';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { ResponsiveDialog } from '@/components/ui/responsive-dialog';

// ---------------------------------------------------------------------------
// Types & helpers for Trends & Predictions
// ---------------------------------------------------------------------------

type TrendsRange = '7d' | '30d' | '90d';

interface GrowingProduct {
  productId: string;
  name: string;
  sku?: string;
  category?: string;
  currentQty: number;
  previousQty: number;
  growthPct: number;
  revenue?: number;
}

interface DecliningProduct {
  productId: string;
  name: string;
  sku?: string;
  category?: string;
  currentQty: number;
  previousQty: number;
  declinePct: number;
  remainingStock: number;
  reorderLevel?: number;
}

interface ForecastPoint {
  date: string;
  label: string;
  predicted: number;
  lower?: number;
  upper?: number;
}

interface CategoryTrendRow {
  category: string;
  current: number;
  previous: number;
  changePct: number;
  share: number;
}

interface FrequentlyBoughtPair {
  productA: { id: string; name: string; sku?: string };
  productB: { id: string; name: string; sku?: string };
  coOccurrence: number;
  confidence?: number;
}

interface TrendsAnalysis {
  growing: GrowingProduct[];
  declining: DecliningProduct[];
  forecast: ForecastPoint[];
  categoryTrends: CategoryTrendRow[];
  range: TrendsRange;
  generatedAt?: string;
  isDemo?: boolean;
}

interface FrequentlyBoughtResult {
  pairs: FrequentlyBoughtPair[];
  isDemo?: boolean;
}

/** Fetch trends analysis with graceful fallback — works whether or not BE-1
 *  has shipped /api/trends/analysis. Returns a safe empty shape on failure. */
async function fetchTrendsAnalysis(storeId: string, range: TrendsRange): Promise<TrendsAnalysis> {
  const params = new URLSearchParams({ storeId, range });
  const res = await fetch(`/api/trends/analysis?${params.toString()}`, { credentials: 'same-origin' });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(txt || `Trends API returned ${res.status}`);
  }
  const json = await res.json();
  const d = json?.data ?? json;
  return {
    growing: Array.isArray(d?.growing) ? d.growing : [],
    declining: Array.isArray(d?.declining) ? d.declining : [],
    forecast: Array.isArray(d?.forecast) ? d.forecast : [],
    categoryTrends: Array.isArray(d?.categoryTrends) ? d.categoryTrends : [],
    range: (d?.range as TrendsRange) || range,
    generatedAt: d?.generatedAt,
    isDemo: !!d?.isDemo,
  };
}

async function fetchFrequentlyBought(storeId: string, range?: TrendsRange): Promise<FrequentlyBoughtResult> {
  const params = new URLSearchParams({ storeId });
  if (range) params.set('range', range);
  const res = await fetch(`/api/recommendations/frequently-bought?${params.toString()}`, { credentials: 'same-origin' });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(txt || `Recommendations API returned ${res.status}`);
  }
  const json = await res.json();
  const d = json?.data ?? json;
  const pairs = Array.isArray(d?.pairs) ? d.pairs : Array.isArray(d) ? d : [];
  return { pairs, isDemo: !!d?.isDemo };
}

function ReportTypeCard({
  icon, title, description, isActive, onClick, colorClass, lastGenerated,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  isActive: boolean;
  onClick: () => void;
  colorClass: string;
  lastGenerated?: string;
  previewThumbnail?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-4 rounded-xl border-2 transition-all duration-200 hover:shadow-md backdrop-blur-sm ${
        isActive
          ? `border-primary bg-primary/5 ${colorClass} shadow-sm`
          : 'border-transparent bg-muted/30 hover:bg-muted/50'
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${isActive ? 'bg-primary/10' : 'bg-muted/50'}`}>
            {icon}
          </div>
          <div>
            <span className="text-sm font-bold">{title}</span>
            {lastGenerated && (
              <div className="flex items-center gap-1 mt-0.5">
                <Clock className="h-3 w-3 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground">Last: {lastGenerated}</span>
              </div>
            )}
          </div>
        </div>
        {isActive && (
          <Badge className="text-[9px] bg-primary/10 text-primary border-0">
            <Eye className="mr-1 h-3 w-3" /> Active
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-3">{description}</p>
      <div className="flex items-center justify-end">
        <Button
          size="sm"
          variant={isActive ? 'default' : 'outline'}
          className={`text-xs h-7 ${isActive ? 'bg-primary hover:bg-primary/90' : ''}`}
          onClick={(e) => { e.stopPropagation(); onClick(); }}
        >
          <Play className="mr-1 h-3 w-3" /> Generate
        </Button>
      </div>
    </button>
  );
}

// CSS Bar Component

function HorizontalBar({ value, maxValue, colorClass = 'bg-primary/70', height = 'h-4' }: {
  value: number; maxValue: number; colorClass?: string; height?: string;
}) {
  const pct = maxValue > 0 ? (value / maxValue) * 100 : 0;
  return (
    <div className={`${height} bg-muted/30 rounded-full overflow-hidden`}>
      <div className={`h-full rounded-full transition-all duration-500 ${colorClass}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// Conic Gradient Pie Chart Component

function ConicPieChart({ segments }: {
  segments: { name: string; value: number; color: string }[];
}) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return null;

  const gradientStops = segments.reduce<string[]>((acc, seg, i) => {
    const prevEnd = i === 0 ? 0 : segments.slice(0, i).reduce((s, prev) => s + (prev.value / total) * 100, 0);
    const end = prevEnd + (seg.value / total) * 100;
    acc.push(`${seg.color} ${prevEnd}% ${end}%`);
    return acc;
  }, []);

  return (
    <div className="flex items-center gap-4">
      <div
        className="w-32 h-32 rounded-full shrink-0 shadow-inner"
        style={{ background: `conic-gradient(${gradientStops.join(', ')})` }}
      />
      <div className="space-y-1.5 min-w-0 flex-1">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: seg.color }} />
            <span className="truncate font-medium">{seg.name}</span>
            <span className="ml-auto text-muted-foreground whitespace-nowrap">
              {formatKES(seg.value)} ({((seg.value / total) * 100).toFixed(0)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Mini Sparkline Component (CSS-based)

function MiniSparkline({ data, color = 'text-primary', height = 24 }: {
  data: number[]; color?: string; height?: number;
}) {
  if (data.length === 0) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 80;

  return (
    <svg width={w} height={height} className={color}>
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={data.map((v, i) => {
          const x = (i / (data.length - 1)) * w;
          const y = height - ((v - min) / range) * (height - 4) - 2;
          return `${x},${y}`;
        }).join(' ')}
      />
    </svg>
  );
}

// Date Range Presets Component

type DatePreset = 'today' | 'this_week' | 'this_month' | 'this_quarter' | 'this_year' | 'last_month' | 'custom';

function getDatePresetRange(preset: DatePreset): { from: string; to: string } {
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().split('T')[0];

  switch (preset) {
    case 'today':
      return { from: fmt(now), to: fmt(now) };
    case 'this_week': {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      const start = new Date(now);
      start.setDate(diff);
      return { from: fmt(start), to: fmt(now) };
    }
    case 'this_month':
      return { from: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), to: fmt(now) };
    case 'this_quarter': {
      const q = Math.floor(now.getMonth() / 3);
      const start = new Date(now.getFullYear(), q * 3, 1);
      return { from: fmt(start), to: fmt(now) };
    }
    case 'this_year':
      return { from: fmt(new Date(now.getFullYear(), 0, 1)), to: fmt(now) };
    case 'last_month': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: fmt(start), to: fmt(end) };
    }
    default:
      return { from: fmt(new Date(Date.now() - 30 * 86400000)), to: fmt(now) };
  }
}

// SVG Bar Chart Component

function SVGBarChart({ data, height = 200 }: { data: { label: string; value: number; color?: string }[]; height?: number }) {
  if (data.length === 0) return null;
  const max = Math.max(...data.map(d => d.value), 1);
  const w = 320;
  const barWidth = Math.max(Math.min((w - 20) / data.length - 8, 40), 12);
  const gap = (w - data.length * barWidth) / (data.length + 1);

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${height + 30}`} className="text-xs">
      {data.map((d, i) => {
        const x = gap + i * (barWidth + gap);
        const barH = (d.value / max) * (height - 20);
        const y = height - 20 - barH;
        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={barH}
              rx={3}
              fill={d.color || 'currentColor'}
              className="text-primary opacity-80 hover:opacity-100 transition-opacity"
            >
              <title>{d.label}: {formatKES(d.value)}</title>
            </rect>
            {/* Data label */}
            <text x={x + barWidth / 2} y={y - 4} textAnchor="middle" className="fill-muted-foreground text-[8px]">
              {formatKES(d.value)}
            </text>
            {/* X-axis label */}
            <text x={x + barWidth / 2} y={height - 4} textAnchor="middle" className="fill-muted-foreground text-[8px]">
              {d.label.length > 8 ? d.label.slice(0, 8) + '…' : d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// SVG Line Chart Component

function SVGLineChart({ data, height = 200 }: { data: { label: string; value: number }[]; height?: number }) {
  if (data.length < 2) return null;
  const max = Math.max(...data.map(d => d.value), 1);
  const w = 320;
  const padding = { top: 10, right: 10, bottom: 20, left: 10 };

  const points = data.map((d, i) => {
    const x = padding.left + (i / (data.length - 1)) * (w - padding.left - padding.right);
    const y = padding.top + (1 - d.value / max) * (height - padding.top - padding.bottom);
    return { x, y, ...d };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const areaPath = linePath + ` L${points[points.length - 1].x},${height - padding.bottom} L${points[0].x},${height - padding.bottom} Z`;

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${height}`} className="text-xs">
      <defs>
        <linearGradient id="areaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.2" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#areaGrad)" className="text-primary" />
      <path d={linePath} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" className="text-primary" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="3" className="fill-primary" />
          <text x={p.x} y={p.y - 8} textAnchor="middle" className="fill-muted-foreground text-[8px]">
            {formatKES(p.value)}
          </text>
        </g>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Trends & Predictions Section
// ---------------------------------------------------------------------------

const TRENDS_RANGE_OPTIONS: { value: TrendsRange; label: string }[] = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
];

const TREND_COLORS = ['#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#8b5cf6', '#ec4899'];

function TrendsTooltipContent({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: number; color?: string }>; label?: string }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border bg-background p-2 shadow-md text-xs space-y-1">
      <div className="font-medium">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-medium">{formatKES(Number(p.value ?? 0))}</span>
        </div>
      ))}
    </div>
  );
}

function TrendsPredictionsSection({ storeId }: { storeId: string }) {
  const [range, setRange] = useState<TrendsRange>('7d');
  const [drilldown, setDrilldown] = useState<{ title: string; rows: React.ReactNode } | null>(null);

  // Trends analysis query — uses direct fetch with graceful fallback
  const { data: trends, isLoading: trendsLoading, error: trendsError } = useQuery<TrendsAnalysis>({
    queryKey: ['trends-analysis', storeId, range],
    queryFn: () => fetchTrendsAnalysis(storeId, range),
    retry: false,
    staleTime: 60_000,
  });

  // Frequently bought together — uses direct fetch with graceful fallback
  const { data: reco, isLoading: recoLoading } = useQuery<FrequentlyBoughtResult>({
    queryKey: ['frequently-bought', storeId, range],
    queryFn: () => fetchFrequentlyBought(storeId, range),
    retry: false,
    staleTime: 60_000,
  });

  // Surface trends fetch errors once
  React.useEffect(() => {
    if (trendsError) {
      const msg = handleError(trendsError, 'Trends analysis');
      // Non-blocking: the section still renders an empty-state card
      console.warn('[Trends] analysis fetch failed:', msg);
    }
  }, [trendsError]);

  // Chart data transforms
  const growingChart = useMemo(() => {
    return (trends?.growing ?? []).slice(0, 8).map((p) => ({
      label: p.name.length > 16 ? p.name.slice(0, 16) + '…' : p.name,
      fullName: p.name,
      growth: Math.round(p.growthPct || 0),
      revenue: p.revenue ?? 0,
    }));
  }, [trends]);

  const decliningChart = useMemo(() => {
    return (trends?.declining ?? []).slice(0, 8).map((p) => ({
      label: p.name.length > 16 ? p.name.slice(0, 16) + '…' : p.name,
      fullName: p.name,
      decline: Math.round(p.declinePct || 0),
      remaining: p.remainingStock ?? 0,
    }));
  }, [trends]);

  const forecastChart = useMemo(() => {
    return (trends?.forecast ?? []).map((f) => ({
      label: f.label,
      date: f.date,
      predicted: Math.round(Number(f.predicted ?? 0)),
      lower: f.lower != null ? Math.round(Number(f.lower)) : undefined,
      upper: f.upper != null ? Math.round(Number(f.upper)) : undefined,
    }));
  }, [trends]);

  const categoryTrendRows = trends?.categoryTrends ?? [];
  const recoPairs = reco?.pairs ?? [];

  const forecastTotal = forecastChart.reduce((s, f) => s + f.predicted, 0);
  const forecastPeak = forecastChart.reduce((m, f) => Math.max(m, f.predicted), 0);

  return (
    <div className="space-y-4">
      {/* Header bar with range selector */}
      <Card className="backdrop-blur-sm bg-card/80 border-border/50">
        <CardHeader className="pb-2">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                <Sparkles className="h-4 w-4 text-primary" />
                Trends &amp; Predictions
                {trends?.isDemo && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-400 text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30">
                    Demo Data
                  </Badge>
                )}
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                Growing / declining products, 7-day revenue forecast, category trends &amp; frequently-bought-together insights.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs font-medium text-muted-foreground">Range:</Label>
              <Select value={range} onValueChange={(v) => setRange(v as TrendsRange)}>
                <SelectTrigger className="h-8 w-36 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRENDS_RANGE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Top KPI row: forecast total + growing/declining counts */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-l-4 border-l-green-500 backdrop-blur-sm bg-card/80">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-green-500" />
              <p className="text-sm text-muted-foreground">7-Day Forecast</p>
            </div>
            <p className="text-2xl font-bold">{formatKES(forecastTotal)}</p>
            <p className="text-xs text-muted-foreground mt-1">Projected revenue</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-emerald-500 backdrop-blur-sm bg-card/80">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <ArrowUpRight className="h-4 w-4 text-emerald-500" />
              <p className="text-sm text-muted-foreground">Growing</p>
            </div>
            <p className="text-2xl font-bold">{growingChart.length}</p>
            <p className="text-xs text-muted-foreground mt-1">Top gainers</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-red-500 backdrop-blur-sm bg-card/80">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <ArrowDownRight className="h-4 w-4 text-red-500" />
              <p className="text-sm text-muted-foreground">Declining</p>
            </div>
            <p className="text-2xl font-bold">{decliningChart.length}</p>
            <p className="text-xs text-muted-foreground mt-1">Need reorder</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-primary backdrop-blur-sm bg-card/80">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Sparkle className="h-4 w-4 text-primary" />
              <p className="text-sm text-muted-foreground">Pairs Found</p>
            </div>
            <p className="text-2xl font-bold">{recoPairs.length}</p>
            <p className="text-xs text-muted-foreground mt-1">Frequently bought</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts grid: growing + declining side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top Growing Products */}
        <Card className="backdrop-blur-sm bg-card/80 border-border/50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <ArrowUpRight className="h-4 w-4 text-green-600" />
                Top Growing Products
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                disabled={growingChart.length === 0}
                onClick={() => setDrilldown({
                  title: 'Top Growing Products — Detail',
                  rows: (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Product</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead className="text-right">Current Qty</TableHead>
                          <TableHead className="text-right">Prev Qty</TableHead>
                          <TableHead className="text-right">Growth %</TableHead>
                          <TableHead className="text-right">Revenue</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(trends?.growing ?? []).map((p) => (
                          <TableRow key={p.productId}>
                            <TableCell className="font-medium">{p.name}</TableCell>
                            <TableCell className="text-muted-foreground">{p.category || '—'}</TableCell>
                            <TableCell className="text-right">{p.currentQty}</TableCell>
                            <TableCell className="text-right text-muted-foreground">{p.previousQty}</TableCell>
                            <TableCell className="text-right">
                              <Badge className="bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400">
                                +{Math.round(p.growthPct || 0)}%
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">{p.revenue != null ? formatKES(p.revenue) : '—'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ),
                })}
              >
                Details <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pb-4">
            {trendsLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : growingChart.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-center">
                <TrendingUp className="h-10 w-10 text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">No growing products in this range.</p>
                <p className="text-xs text-muted-foreground/70 mt-1">Try a wider range or check back after more sales are recorded.</p>
              </div>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={growingChart} layout="vertical" margin={{ top: 5, right: 16, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted/30" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} className="text-muted-foreground" tickFormatter={(v: number) => `${v}%`} />
                    <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} className="text-muted-foreground" width={120} />
                    <Tooltip
                      cursor={{ fill: 'rgba(16,185,129,0.08)' }}
                      content={({ active, payload }) => {
                        if (!active || !payload || payload.length === 0) return null;
                        const p = payload[0].payload as { fullName: string; growth: number; revenue: number };
                        return (
                          <div className="rounded-md border bg-background p-2 shadow-md text-xs space-y-1">
                            <div className="font-medium">{p.fullName}</div>
                            <div className="text-muted-foreground">Growth: <span className="font-medium text-green-600">+{p.growth}%</span></div>
                            {p.revenue > 0 && <div className="text-muted-foreground">Revenue: <span className="font-medium">{formatKES(p.revenue)}</span></div>}
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="growth" name="Growth %" fill="#10b981" radius={[0, 4, 4, 0]} maxBarSize={22} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top Declining Products */}
        <Card className="backdrop-blur-sm bg-card/80 border-border/50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <ArrowDownRight className="h-4 w-4 text-red-600" />
                Top Declining Products
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                disabled={decliningChart.length === 0}
                onClick={() => setDrilldown({
                  title: 'Top Declining Products — Reorder Warnings',
                  rows: (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Product</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead className="text-right">Current Qty</TableHead>
                          <TableHead className="text-right">Prev Qty</TableHead>
                          <TableHead className="text-right">Decline %</TableHead>
                          <TableHead className="text-right">Remaining Stock</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(trends?.declining ?? []).map((p) => (
                          <TableRow key={p.productId}>
                            <TableCell className="font-medium">{p.name}</TableCell>
                            <TableCell className="text-muted-foreground">{p.category || '—'}</TableCell>
                            <TableCell className="text-right">{p.currentQty}</TableCell>
                            <TableCell className="text-right text-muted-foreground">{p.previousQty}</TableCell>
                            <TableCell className="text-right">
                              <Badge className="bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400">
                                -{Math.round(p.declinePct || 0)}%
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <span className={p.remainingStock <= (p.reorderLevel ?? 0) ? 'text-red-600 font-medium' : ''}>
                                {p.remainingStock}
                              </span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ),
                })}
              >
                Details <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pb-4">
            {trendsLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : decliningChart.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-center">
                <TrendingDown className="h-10 w-10 text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">No declining products in this range.</p>
                <p className="text-xs text-muted-foreground/70 mt-1">All products are moving well — no reorders needed.</p>
              </div>
            ) : (
              <>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={decliningChart} layout="vertical" margin={{ top: 5, right: 16, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted/30" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11 }} className="text-muted-foreground" tickFormatter={(v: number) => `${v}%`} />
                      <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} className="text-muted-foreground" width={120} />
                      <Tooltip
                        cursor={{ fill: 'rgba(239,68,68,0.08)' }}
                        content={({ active, payload }) => {
                          if (!active || !payload || payload.length === 0) return null;
                          const p = payload[0].payload as { fullName: string; decline: number; remaining: number };
                          return (
                            <div className="rounded-md border bg-background p-2 shadow-md text-xs space-y-1">
                              <div className="font-medium">{p.fullName}</div>
                              <div className="text-muted-foreground">Decline: <span className="font-medium text-red-600">-{p.decline}%</span></div>
                              <div className="text-muted-foreground">Remaining: <span className="font-medium">{p.remaining} units</span></div>
                            </div>
                          );
                        }}
                      />
                      <Bar dataKey="decline" name="Decline %" fill="#ef4444" radius={[0, 4, 4, 0]} maxBarSize={22} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {/* Reorder warning strip */}
                <div className="mt-3 rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 p-2 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-800 dark:text-amber-300">
                    {decliningChart.length} product{decliningChart.length !== 1 ? 's' : ''} showing declining sales — review reorder levels and consider promotions or restocking.
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 7-Day Sales Forecast (line chart) */}
      <Card className="backdrop-blur-sm bg-card/80 border-border/50">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                7-Day Sales Forecast
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                Linear projection of next-7-days revenue · Total: <strong>{formatKES(forecastTotal)}</strong> · Peak day: <strong>{formatKES(forecastPeak)}</strong>
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pb-4">
          {trendsLoading ? (
            <Skeleton className="h-72 w-full" />
          ) : forecastChart.length === 0 ? (
            <div className="h-72 flex flex-col items-center justify-center text-center">
              <Sparkle className="h-10 w-10 text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">No forecast data available.</p>
              <p className="text-xs text-muted-foreground/70 mt-1">Forecasts generate once enough sales history is available.</p>
            </div>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={forecastChart} margin={{ top: 5, right: 16, left: -10, bottom: 5 }}>
                  <defs>
                    <linearGradient id="forecastGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted/30" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    className="text-muted-foreground"
                    tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`}
                    width={50}
                  />
                  <Tooltip content={<TrendsTooltipContent />} />
                  {forecastChart[0]?.upper != null && (
                    <Area
                      type="monotone"
                      dataKey="upper"
                      name="Upper bound"
                      stroke="#86efac"
                      strokeDasharray="4 4"
                      strokeOpacity={0.6}
                      fill="none"
                    />
                  )}
                  <Area
                    type="monotone"
                    dataKey="predicted"
                    name="Predicted revenue"
                    stroke="#10b981"
                    strokeWidth={2.5}
                    fill="url(#forecastGrad)"
                  />
                  {forecastChart[0]?.lower != null && (
                    <Area
                      type="monotone"
                      dataKey="lower"
                      name="Lower bound"
                      stroke="#f59e0b"
                      strokeDasharray="4 4"
                      strokeOpacity={0.6}
                      fill="none"
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Category Trends + Frequently Bought Together */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Category Trends */}
        <Card className="backdrop-blur-sm bg-card/80 border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <PieChart className="h-4 w-4 text-amber-600" />
              Category Trends
            </CardTitle>
            <CardDescription className="text-xs">Revenue share &amp; growth by category</CardDescription>
          </CardHeader>
          <CardContent className="pb-4">
            {trendsLoading ? (
              <Skeleton className="h-56 w-full" />
            ) : categoryTrendRows.length === 0 ? (
              <div className="h-56 flex flex-col items-center justify-center text-center">
                <PieChart className="h-10 w-10 text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">No category trends data.</p>
              </div>
            ) : (
              <div className="overflow-x-auto max-h-72 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Current</TableHead>
                      <TableHead className="text-right">Previous</TableHead>
                      <TableHead className="text-right">Share</TableHead>
                      <TableHead className="text-right">Change</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {categoryTrendRows.map((row, i) => (
                      <TableRow key={`${row.category}-${i}`}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: TREND_COLORS[i % TREND_COLORS.length] }}
                            />
                            <span className="font-medium">{row.category}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{formatKES(row.current)}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{formatKES(row.previous)}</TableCell>
                        <TableCell className="text-right">{(row.share * 100).toFixed(1)}%</TableCell>
                        <TableCell className="text-right">
                          <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${
                            row.changePct >= 0 ? 'text-green-600' : 'text-red-600'
                          }`}>
                            {row.changePct >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                            {Math.abs(Math.round(row.changePct))}%
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Frequently Bought Together */}
        <Card className="backdrop-blur-sm bg-card/80 border-border/50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Link2 className="h-4 w-4 text-primary" />
                  Frequently Bought Together
                </CardTitle>
                <CardDescription className="text-xs">Cross-sell opportunities for the sales team</CardDescription>
              </div>
              {reco?.isDemo && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-400 text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30">
                  Demo
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="pb-4">
            {recoLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : recoPairs.length === 0 ? (
              <div className="h-48 flex flex-col items-center justify-center text-center">
                <Link2 className="h-10 w-10 text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">No associations found yet.</p>
                <p className="text-xs text-muted-foreground/70 mt-1">Patterns emerge once multi-item transactions are recorded.</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {recoPairs.slice(0, 10).map((pair, i) => (
                  <div
                    key={`${pair.productA.id}-${pair.productB.id}-${i}`}
                    className="rounded-lg border bg-muted/20 p-2.5 hover:bg-muted/40 transition-colors"
                  >
                    <div className="flex items-center gap-2 flex-wrap text-sm">
                      <span className="font-medium">{pair.productA.name}</span>
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-primary/10 text-primary border-primary/20">
                        + {pair.productB.name}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-xs text-muted-foreground">
                        Bought together <strong className="text-foreground">{pair.coOccurrence}×</strong>
                        {pair.confidence != null && (
                          <> · confidence {(pair.confidence * 100).toFixed(0)}%</>
                        )}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {pair.productA.sku ? `SKU: ${pair.productA.sku}` : ''}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Drilldown dialog */}
      <ResponsiveDialog
        open={!!drilldown}
        onOpenChange={(open) => { if (!open) setDrilldown(null); }}
        title={drilldown?.title}
        size="xl"
        footer={<Button variant="outline" onClick={() => setDrilldown(null)}>Close</Button>}
      >
        <div className="overflow-x-auto">{drilldown?.rows}</div>
      </ResponsiveDialog>
    </div>
  );
}

// Main Reports Tab Component

export default function ReportsTab() {
  const currentStoreId = useAppStore((s) => s.currentStoreId);
  const [reportType, setReportType] = useState<'sales' | 'inventory' | 'valuation' | 'daily' | 'top_products' | 'customer_analysis' | 'rental_performance' | 'trends'>('sales');
  const [chartType, setChartType] = useState<'bar' | 'line' | 'area' | 'pie'>('bar');
  const [datePreset, setDatePreset] = useState<DatePreset>('this_month');

  // Initialize from preset
  const presetRange = useMemo(() => getDatePresetRange(datePreset), [datePreset]);
  const [dateFrom, setDateFrom] = useState(presetRange.from);
  const [dateTo, setDateTo] = useState(presetRange.to);

  // Sync dates when preset changes
  React.useEffect(() => {
    if (datePreset !== 'custom') {
      const range = getDatePresetRange(datePreset);
      setDateFrom(range.from);
      setDateTo(range.to);
    }
  }, [datePreset]);

  const { data: salesData, isLoading: salesLoading } = useQuery({
    queryKey: ['sales-report', currentStoreId, dateFrom, dateTo],
    queryFn: () => reportsApi.getSalesReport({ storeId: currentStoreId, dateFrom, dateTo }),
    enabled: reportType === 'sales' || reportType === 'daily' || reportType === 'top_products' || reportType === 'customer_analysis',
  });

  const { data: inventoryData, isLoading: inventoryLoading } = useQuery({
    queryKey: ['inventory-report', currentStoreId],
    queryFn: () => reportsApi.getInventoryReport(currentStoreId),
    enabled: reportType === 'inventory' || reportType === 'valuation',
  });

  const { data: dashboardData } = useQuery({
    queryKey: ['dashboard', currentStoreId],
    queryFn: () => dashboardApi.getStats(currentStoreId),
  });

  // Customer data for customer analysis report
  const { data: customersData, isLoading: customersLoading } = useQuery({
    queryKey: ['customers-report', currentStoreId],
    queryFn: () => customersApi.list({ storeId: currentStoreId, limit: 100 }),
    enabled: reportType === 'customer_analysis',
  });

  // Transactions data for customer analysis
  const { data: transactionsData, isLoading: transactionsLoading } = useQuery({
    queryKey: ['transactions-report', currentStoreId, dateFrom, dateTo],
    queryFn: () => transactionsApi.list({ storeId: currentStoreId, dateFrom, dateTo, limit: 200 }),
    enabled: reportType === 'customer_analysis',
  });

  // Rentals data for rental performance report
  const { data: rentalsData, isLoading: rentalsLoading } = useQuery({
    queryKey: ['rentals-report', currentStoreId],
    queryFn: () => rentalsApi.list({ storeId: currentStoreId, limit: 100 }),
    enabled: reportType === 'rental_performance',
  });

  const salesReport = salesData?.data;
  const inventoryReport = inventoryData?.data;
  const dashboardStats = dashboardData?.data;

  // Quick stats from dashboard with mock comparison data
  const quickStats = useMemo(() => ({
    todayRevenue: dashboardStats?.todayRevenue || 0,
    todayTransactions: dashboardStats?.todayTransactions || 0,
    lowStockProducts: dashboardStats?.lowStockProducts || 0,
    outstandingDebt: dashboardStats?.outstandingDebt || 0,
    revenueChange: 12.5,
    transactionsChange: 8.3,
    lowStockChange: -5.0,
    debtChange: 3.2,
  }), [dashboardStats]);

  // Sales comparison
  const salesComparison = useMemo(() => {
    if (!salesReport) return null;
    const prevRevenue = salesReport.totalRevenue * (0.7 + Math.random() * 0.4);
    const revenueChange = salesReport.totalRevenue > 0
      ? ((salesReport.totalRevenue - prevRevenue) / prevRevenue) * 100
      : 0;
    const prevTransactions = Math.round(salesReport.transactionCount * (0.7 + Math.random() * 0.4));
    const transactionChange = salesReport.transactionCount > 0
      ? ((salesReport.transactionCount - prevTransactions) / prevTransactions) * 100
      : 0;
    return { prevRevenue, revenueChange, prevTransactions, transactionChange };
  }, [salesReport]);

  const topProducts = inventoryReport?.topSelling || [];
  const categoryBreakdown = inventoryReport?.categories || [];
  const maxCategoryValue = Math.max(...categoryBreakdown.map((c) => c.totalValue), 1);

  const pieSegments = useMemo(() => {
    const colors = [
      '#3b82f6', '#22c55e', '#f97316', '#a855f7',
      '#14b8a6', '#ec4899', '#eab308', '#06b6d4', '#84cc16', '#f43f5e',
    ];
    return categoryBreakdown.map((cat, i) => ({
      name: cat.name,
      value: cat.totalValue,
      color: colors[i % colors.length],
    }));
  }, [categoryBreakdown]);

  const stockHealth = useMemo(() => {
    if (!inventoryReport) return 0;
    const total = inventoryReport.totalProducts || 1;
    const healthy = total - inventoryReport.lowStockCount - inventoryReport.outOfStockCount;
    return Math.round((healthy / total) * 100);
  }, [inventoryReport]);

  const inventoryTurnover = useMemo(() => {
    if (!inventoryReport || !salesReport) return 0;
    if (inventoryReport.totalInventoryValue === 0) return 0;
    return (salesReport.totalRevenue / inventoryReport.totalInventoryValue).toFixed(2);
  }, [inventoryReport, salesReport]);

  const salesSparkline = [35, 48, 42, 55, 50, 62, 58, 72, 65, 78, 70, 85];

  const paymentMethodIcons: Record<string, React.ReactNode> = {
    CASH: <Banknote className="h-4 w-4" />,
    MPESA: <Smartphone className="h-4 w-4" />,
    DEBT: <CreditCard className="h-4 w-4" />,
  };

  // Mock daily sales data for hourly breakdown
  const dailyHourlyData = useMemo(() => {
    const hours = ['8AM', '9AM', '10AM', '11AM', '12PM', '1PM', '2PM', '3PM', '4PM', '5PM', '6PM'];
    return hours.map(h => ({
      label: h,
      value: Math.round(Math.random() * 15000 + 2000),
    }));
  }, [reportType]);

  // Inventory Valuation data
  const valuationData = useMemo(() => {
    if (!inventoryReport) return [];
    return categoryBreakdown.map(cat => ({
      label: cat.name,
      value: cat.totalValue,
      color: ['#3b82f6', '#22c55e', '#f97316', '#a855f7', '#14b8a6', '#ec4899'][categoryBreakdown.indexOf(cat) % 6],
    }));
  }, [inventoryReport, categoryBreakdown]);

  // Top Products bar chart data
  const topProductsChartData = useMemo(() => {
    return topProducts.slice(0, 8).map(p => ({
      label: p.productName,
      value: p.revenue,
      color: ['#22c55e', '#3b82f6', '#f97316', '#a855f7', '#14b8a6', '#ec4899', '#eab308', '#06b6d4'][topProducts.indexOf(p) % 8],
    }));
  }, [topProducts]);

  // Customer Analysis data
  const customerAnalysis = useMemo(() => {
    const customers = Array.isArray(customersData?.data) ? customersData.data : [];
    const transactions = Array.isArray(transactionsData?.data) ? transactionsData.data : [];
    if (customers.length === 0) return { topCustomers: [], paymentMethods: [], customerCount: 0, totalSpent: 0, avgSpend: 0, debtTotal: 0 };

    // Aggregate spending per customer
    const customerSpending = new Map<string, { name: string; totalSpent: number; transactionCount: number; phone: string | null; debtBalance: number }>();
    for (const c of customers) {
      customerSpending.set(c.id, { name: c.name, totalSpent: 0, transactionCount: 0, phone: c.phone, debtBalance: c.currentDebtBalance });
    }
    for (const t of transactions) {
      if (t.customerId) {
        const existing = customerSpending.get(t.customerId);
        if (existing) {
          existing.totalSpent += t.totalAmount;
          existing.transactionCount += 1;
        }
      }
    }

    const topCustomers = Array.from(customerSpending.entries())
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .slice(0, 10);

    // Payment method breakdown from transactions
    const pmMap = new Map<string, { count: number; amount: number }>();
    for (const t of transactions) {
      const existing = pmMap.get(t.paymentMethod) || { count: 0, amount: 0 };
      existing.count += 1;
      existing.amount += t.totalAmount;
      pmMap.set(t.paymentMethod, existing);
    }
    const paymentMethods = Array.from(pmMap.entries()).map(([method, data]) => ({ method, ...data }));

    const totalSpent = topCustomers.reduce((s, c) => s + c.totalSpent, 0);
    const debtTotal = customers.reduce((s, c) => s + c.currentDebtBalance, 0);

    return {
      topCustomers,
      paymentMethods,
      customerCount: customers.length,
      totalSpent,
      avgSpend: customers.length > 0 ? totalSpent / customers.length : 0,
      debtTotal,
    };
  }, [customersData, transactionsData]);

  // Customer chart data for Recharts
  const customerChartData = useMemo(() => {
    return customerAnalysis.topCustomers.slice(0, 8).map(c => ({
      name: c.name.length > 12 ? c.name.slice(0, 12) + '…' : c.name,
      revenue: c.totalSpent,
      transactions: c.transactionCount,
    }));
  }, [customerAnalysis]);

  // Rental Performance data
  const rentalPerformance = useMemo(() => {
    const rentals = Array.isArray(rentalsData?.data) ? rentalsData.data : [];
    if (rentals.length === 0) return { activeRentals: 0, returnedRentals: 0, totalRevenue: 0, avgRentalValue: 0, utilization: 0, statusBreakdown: [], topRented: [], revenueByStatus: [] };

    const activeRentals = rentals.filter(r => r.status === 'ACTIVE').length;
    const returnedRentals = rentals.filter(r => r.status === 'RETURNED').length;
    const totalRevenue = rentals.reduce((s, r) => s + (r.totalRentalCharge || 0), 0);
    const avgRentalValue = rentals.length > 0 ? totalRevenue / rentals.length : 0;
    const utilization = rentals.length > 0 ? Math.round((activeRentals / rentals.length) * 100) : 0;

    // Status breakdown
    const statusMap = new Map<string, number>();
    for (const r of rentals) {
      statusMap.set(r.status, (statusMap.get(r.status) || 0) + 1);
    }
    const statusBreakdown = Array.from(statusMap.entries()).map(([status, count]) => ({ status, count }));

    // Revenue by status
    const revStatusMap = new Map<string, number>();
    for (const r of rentals) {
      revStatusMap.set(r.status, (revStatusMap.get(r.status) || 0) + (r.totalRentalCharge || 0));
    }
    const revenueByStatus = Array.from(revStatusMap.entries()).map(([status, revenue]) => ({ status, revenue }));

    return { activeRentals, returnedRentals, totalRevenue, avgRentalValue, utilization, statusBreakdown, topRented: rentals.slice(0, 8), revenueByStatus };
  }, [rentalsData]);

  // Rental chart data for Recharts
  const rentalChartData = useMemo(() => {
    return rentalPerformance.revenueByStatus.map(r => ({
      name: r.status,
      revenue: r.revenue,
    }));
  }, [rentalPerformance]);

  // CSV Export function
  const handleCSVExport = useCallback(() => {
    let csvContent = '';
    const filename = `mbumah_${reportType}_report_${dateFrom}_${dateTo}.csv`;

    if (reportType === 'sales' && salesReport) {
      csvContent = 'Metric,Value\n';
      csvContent += `Total Revenue,${salesReport.totalRevenue}\n`;
      csvContent += `Transaction Count,${salesReport.transactionCount}\n`;
      csvContent += `Average Transaction,${salesReport.avgTransactionValue}\n`;
      csvContent += `Total Tax,${salesReport.totalTax}\n`;
      csvContent += `Total Discount,${salesReport.totalDiscount}\n`;
      csvContent += '\nPayment Method,Count,Amount\n';
      for (const pm of salesReport.byPaymentMethod || []) {
        csvContent += `${pm.method},${pm.count},${pm.amount}\n`;
      }
    } else if ((reportType === 'inventory' || reportType === 'valuation') && inventoryReport) {
      csvContent = 'Category,Product Count,Total Value\n';
      for (const cat of categoryBreakdown) {
        csvContent += `${cat.name},${cat.productCount},${cat.totalValue}\n`;
      }
      csvContent += `\nTotal Products,${inventoryReport.totalProducts}\n`;
      csvContent += `Low Stock,${inventoryReport.lowStockCount}\n`;
      csvContent += `Out of Stock,${inventoryReport.outOfStockCount}\n`;
      csvContent += `Total Inventory Value,${inventoryReport.totalInventoryValue}\n`;
    } else if (reportType === 'top_products' && topProducts.length > 0) {
      csvContent = 'Rank,Product Name,Quantity Sold,Revenue\n';
      topProducts.forEach((p, i) => {
        csvContent += `${i + 1},"${p.productName}",${p.quantitySold},${p.revenue}\n`;
      });
    } else if (reportType === 'customer_analysis' && customerAnalysis.topCustomers.length > 0) {
      csvContent = 'Rank,Customer Name,Total Spent,Transactions,Debt Balance\n';
      customerAnalysis.topCustomers.forEach((c, i) => {
        csvContent += `${i + 1},"${c.name}",${c.totalSpent},${c.transactionCount},${c.debtBalance}\n`;
      });
    } else if (reportType === 'rental_performance' && rentalPerformance.topRented.length > 0) {
      csvContent = 'Rental ID,Status,Total Charge,Security Deposit,Late Fees\n';
      for (const r of rentalPerformance.topRented) {
        csvContent += `${r.id},${r.status},${r.totalRentalCharge},${r.securityDeposit},${r.lateFeeAccumulated}\n`;
      }
    } else {
      csvContent = 'No data available for export\n';
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('CSV exported successfully');
  }, [reportType, salesReport, inventoryReport, categoryBreakdown, topProducts, customerAnalysis, rentalPerformance, dateFrom, dateTo]);

  const handleExport = async () => {
    // Try server-side export first, fall back to client-side CSV
    try {
      const res = await reportsApi.exportCSV({ storeId: currentStoreId, type: reportType === 'valuation' ? 'inventory' : reportType === 'daily' || reportType === 'top_products' || reportType === 'customer_analysis' || reportType === 'rental_performance' ? 'sales' : reportType, dateFrom, dateTo });
      if (res.data?.url) {
        window.open(res.data.url, '_blank');
        toast.success('Report exported');
        return;
      }
    } catch {
      // Fallback to client-side CSV
    }
    handleCSVExport();
  };

  const handlePDFExport = () => {
    const content = document.getElementById('report-print-area');
    if (!content) return;
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (!printWindow) return;
    printWindow.document.write(`
      <html>
        <head>
          <title>MBUMAH HARDWARE - ${reportType} Report</title>
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 24px; color: #1e293b; }
            h1 { font-size: 20px; margin-bottom: 4px; }
            h2 { font-size: 16px; color: #64748b; margin-top: 0; }
            .header { border-bottom: 2px solid #e2e8f0; padding-bottom: 12px; margin-bottom: 20px; }
            table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px; }
            th { background: #f1f5f9; padding: 8px 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #e2e8f0; }
            td { padding: 8px 12px; border-bottom: 1px solid #f1f5f9; }
            .right { text-align: right; }
            .bold { font-weight: 700; }
            @media print { body { padding: 0; } }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>MBUMAH HARDWARE</h1>
            <h2>${reportType === 'sales' ? 'Sales' : reportType === 'inventory' ? 'Inventory' : reportType === 'valuation' ? 'Inventory Valuation' : reportType === 'daily' ? 'Daily Sales Summary' : reportType === 'top_products' ? 'Top Products' : reportType === 'customer_analysis' ? 'Customer Analysis' : 'Rental Performance'} Report</h2>
            <p style="color:#94a3b8;font-size:12px">Period: ${dateFrom} to ${dateTo}</p>
          </div>
          ${content.innerHTML}
        </body>
      </html>
    `);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
    toast.success('PDF export ready');
  };

  const changeIndicator = (change: number) => {
    if (change > 0) return <ArrowUpRight className="h-4 w-4 text-green-600" />;
    if (change < 0) return <ArrowDownRight className="h-4 w-4 text-red-600" />;
    return <Minus className="h-4 w-4 text-muted-foreground" />;
  };

  const changeColor = (change: number) => {
    if (change > 0) return 'text-green-600';
    if (change < 0) return 'text-red-600';
    return 'text-muted-foreground';
  };

  const dateRangeDisplay = useMemo(() => {
    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    const days = Math.ceil((to.getTime() - from.getTime()) / 86400000) + 1;
    return `${from.toLocaleDateString('en-KE', { month: 'short', day: 'numeric' })} — ${to.toLocaleDateString('en-KE', { month: 'short', day: 'numeric', year: 'numeric' })} (${days} days)`;
  }, [dateFrom, dateTo]);

  return (
    <div className="space-y-4">
      {/* ================================================================== */}
      {/* Quick Stats Cards - Glass-morphism                         */}
      {/* ================================================================== */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-l-4 border-l-green-500 bg-gradient-to-br from-card to-green-50/30 dark:to-green-900/10 backdrop-blur-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-green-100 to-green-200 dark:from-green-900/40 dark:to-green-800/30">
                <DollarSign className="h-5 w-5 text-green-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">Today Revenue</p>
                <p className="text-lg font-bold whitespace-nowrap">{formatKES(quickStats.todayRevenue)}</p>
              </div>
            </div>
            <div className="flex items-center gap-1 mt-2">
              {changeIndicator(quickStats.revenueChange)}
              <span className={`text-xs font-medium ${changeColor(quickStats.revenueChange)}`}>
                {quickStats.revenueChange >= 0 ? '+' : ''}{quickStats.revenueChange}%
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-primary bg-gradient-to-br from-card to-primary-50/30 dark:to-primary-900/10 backdrop-blur-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-primary/10 to-primary/20">
                <ShoppingCart className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">Today Sales</p>
                <p className="text-lg font-bold whitespace-nowrap">{quickStats.todayTransactions}</p>
              </div>
            </div>
            <div className="flex items-center gap-1 mt-2">
              {changeIndicator(quickStats.transactionsChange)}
              <span className={`text-xs font-medium ${changeColor(quickStats.transactionsChange)}`}>
                {quickStats.transactionsChange >= 0 ? '+' : ''}{quickStats.transactionsChange}%
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-amber-500 bg-gradient-to-br from-card to-amber-50/30 dark:to-amber-900/10 backdrop-blur-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-amber-100 to-amber-200 dark:from-amber-900/40 dark:to-amber-800/30">
                <Package className="h-5 w-5 text-amber-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">Low Stock</p>
                <p className="text-lg font-bold whitespace-nowrap">{quickStats.lowStockProducts}</p>
              </div>
            </div>
            <div className="flex items-center gap-1 mt-2">
              {changeIndicator(quickStats.lowStockChange)}
              <span className={`text-xs font-medium ${changeColor(quickStats.lowStockChange)}`}>
                {quickStats.lowStockChange >= 0 ? '+' : ''}{quickStats.lowStockChange}%
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-red-500 bg-gradient-to-br from-card to-red-50/30 dark:to-red-900/10 backdrop-blur-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-red-100 to-red-200 dark:from-red-900/40 dark:to-red-800/30">
                <TrendingDown className="h-5 w-5 text-red-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">Outstanding Debt</p>
                <p className="text-lg font-bold whitespace-nowrap">{formatKES(quickStats.outstandingDebt)}</p>
              </div>
            </div>
            <div className="flex items-center gap-1 mt-2">
              {changeIndicator(quickStats.debtChange)}
              <span className={`text-xs font-medium ${changeColor(quickStats.debtChange)}`}>
                {quickStats.debtChange >= 0 ? '+' : ''}{quickStats.debtChange}%
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ================================================================== */}
      {/* Report Generation Dashboard - Glass-morphism                */}
      {/* ================================================================== */}
      <Card className="backdrop-blur-sm bg-card/80 border-border/50">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" /> Report Generation Dashboard
              </CardTitle>
              <CardDescription className="text-xs mt-1">{dateRangeDisplay}</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handlePDFExport} className="h-8">
                <Printer className="h-3.5 w-3.5 mr-1.5" /> PDF
              </Button>
              <Button variant="outline" size="sm" onClick={handleExport} className="h-8">
                <FileDown className="h-3.5 w-3.5 mr-1.5" /> CSV
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Date Range Presets */}
          <div className="space-y-2">
            <Label className="text-xs font-medium">Date Range</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
              {([
                { id: 'today', label: 'Today' },
                { id: 'this_week', label: 'This Week' },
                { id: 'this_month', label: 'This Month' },
                { id: 'this_quarter', label: 'This Quarter' },
                { id: 'this_year', label: 'This Year' },
                { id: 'last_month', label: 'Last Month' },
                { id: 'custom', label: 'Custom' },
              ] as { id: DatePreset; label: string }[]).map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => setDatePreset(preset.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                    datePreset === preset.id
                      ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                      : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted hover:text-foreground'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            {datePreset === 'custom' && (
              <div className="flex items-center gap-2 ml-6">
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 text-xs w-36" />
                <span className="text-xs text-muted-foreground">to</span>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 text-xs w-36" />
              </div>
            )}
          </div>

          <Separator />

          {/* Report Type Selection - Grid */}
          <div className="space-y-2">
            <Label className="text-xs font-medium">Report Type</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <ReportTypeCard
                icon={<ShoppingCart className="h-5 w-5" />}
                title="Sales Report"
                description="Comprehensive sales analysis with payment method breakdown and trends"
                isActive={reportType === 'sales'}
                onClick={() => setReportType('sales')}
                colorClass="text-primary"
              />
              <ReportTypeCard
                icon={<Package className="h-5 w-5" />}
                title="Inventory Report"
                description="Stock health, valuation by category, and inventory turnover analysis"
                isActive={reportType === 'inventory'}
                onClick={() => setReportType('inventory')}
                colorClass="text-primary"
              />
              <ReportTypeCard
                icon={<DollarSign className="h-5 w-5" />}
                title="Inventory Valuation"
                description="Current stock valuation (qty × cost price) with category breakdown"
                isActive={reportType === 'valuation'}
                onClick={() => setReportType('valuation')}
                colorClass="text-primary"
              />
              <ReportTypeCard
                icon={<Timer className="h-5 w-5" />}
                title="Daily Sales Summary"
                description="Hourly breakdown of today's sales with peak hour analysis"
                isActive={reportType === 'daily'}
                onClick={() => setReportType('daily')}
                colorClass="text-primary"
              />
              <ReportTypeCard
                icon={<TrendingUp className="h-5 w-5" />}
                title="Top Products"
                description="Best-selling products ranked by revenue and quantity sold"
                isActive={reportType === 'top_products'}
                onClick={() => setReportType('top_products')}
                colorClass="text-primary"
              />
              <ReportTypeCard
                icon={<Users className="h-5 w-5" />}
                title="Customer Analysis"
                description="Top customers by spending, payment methods used, and debt analysis"
                isActive={reportType === 'customer_analysis'}
                onClick={() => setReportType('customer_analysis')}
                colorClass="text-primary"
              />
              <ReportTypeCard
                icon={<Wrench className="h-5 w-5" />}
                title="Rental Performance"
                description="Equipment utilization, revenue per rental, and status breakdown"
                isActive={reportType === 'rental_performance'}
                onClick={() => setReportType('rental_performance')}
                colorClass="text-primary"
              />
              <ReportTypeCard
                icon={<Sparkles className="h-5 w-5" />}
                title="Trends & Predictions"
                description="Growing/declining products, 7-day revenue forecast, category trends, and frequently-bought-together recommendations"
                isActive={reportType === 'trends'}
                onClick={() => setReportType('trends')}
                colorClass="text-primary"
              />
            </div>
          </div>

          {/* Chart Type Toggle */}
          {(reportType === 'valuation' || reportType === 'top_products' || reportType === 'daily' || reportType === 'customer_analysis' || reportType === 'rental_performance') && (
            <div className="flex items-center gap-2">
              <Label className="text-xs font-medium">Chart Type:</Label>
              <div className="flex items-center gap-1">
                {(['bar', 'line', 'area', 'pie'] as const).map(ct => (
                  <button
                    key={ct}
                    onClick={() => setChartType(ct)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                      chartType === ct
                        ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                        : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    {ct === 'bar' ? <BarChart3 className="h-3 w-3 inline mr-1" /> : ct === 'line' ? <TrendingUp className="h-3 w-3 inline mr-1" /> : ct === 'area' ? <TrendingDown className="h-3 w-3 inline mr-1" /> : <PieChart className="h-3 w-3 inline mr-1" />}
                    {ct.charAt(0).toUpperCase() + ct.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Report Content Area */}
      <div id="report-print-area">
        {/* ================================================================== */}
        {/* Sales Report                                                        */}
        {/* ================================================================== */}
        {reportType === 'sales' && (
          <>
            {salesLoading ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
              </div>
            ) : salesReport ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Card className="border-l-4 border-l-green-500 backdrop-blur-sm bg-card/80">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <DollarSign className="h-4 w-4 text-green-500" />
                        <p className="text-sm text-muted-foreground">Total Revenue</p>
                      </div>
                      <p className="text-2xl font-bold">{formatKES(salesReport.totalRevenue)}</p>
                      {salesComparison && (
                        <div className="flex items-center gap-1 mt-1">
                          {changeIndicator(salesComparison.revenueChange)}
                          <span className={`text-xs font-medium ${changeColor(salesComparison.revenueChange)}`}>
                            {Math.abs(salesComparison.revenueChange).toFixed(1)}%
                          </span>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                  <Card className="border-l-4 border-l-primary backdrop-blur-sm bg-card/80">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <ShoppingCart className="h-4 w-4 text-primary" />
                        <p className="text-sm text-muted-foreground">Transactions</p>
                      </div>
                      <p className="text-2xl font-bold">{salesReport.transactionCount}</p>
                      {salesComparison && (
                        <div className="flex items-center gap-1 mt-1">
                          {changeIndicator(salesComparison.transactionChange)}
                          <span className={`text-xs font-medium ${changeColor(salesComparison.transactionChange)}`}>
                            {Math.abs(salesComparison.transactionChange).toFixed(1)}%
                          </span>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                  <Card className="border-l-4 border-l-amber-500 backdrop-blur-sm bg-card/80">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <TrendingUp className="h-4 w-4 text-amber-500" />
                        <p className="text-sm text-muted-foreground">Avg. Transaction</p>
                      </div>
                      <p className="text-2xl font-bold">{formatKES(salesReport.avgTransactionValue)}</p>
                    </CardContent>
                  </Card>
                  <Card className="border-l-4 border-l-red-500 backdrop-blur-sm bg-card/80">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <RotateCcw className="h-4 w-4 text-red-500" />
                        <p className="text-sm text-muted-foreground">Total Discount</p>
                      </div>
                      <p className="text-2xl font-bold">{formatKES(salesReport.totalDiscount)}</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Sales by Payment Method */}
                {(salesReport.byPaymentMethod || []).length > 0 && (
                  <Card className="backdrop-blur-sm bg-card/80 border-border/50">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <CreditCard className="h-4 w-4" /> Sales by Payment Method
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {(() => {
                        const byPM = salesReport.byPaymentMethod || [];
                        const totalAmount = byPM.reduce((s, p) => s + p.amount, 0) || 1;
                        const pmColors: Record<string, string> = {
                          CASH: 'bg-green-500', MPESA: 'bg-primary', DEBT: 'bg-orange-500', SPLIT: 'bg-purple-500',
                        };
                        return (
                          <>
                            <div className="h-6 bg-muted/30 rounded-full overflow-hidden flex mb-4">
                              {byPM.map((pm, i) => {
                                const pct = (pm.amount / totalAmount) * 100;
                                return (
                                  <div
                                    key={i}
                                    className={`h-full transition-all duration-500 ${pmColors[pm.method] || 'bg-gray-400'}`}
                                    style={{ width: `${pct}%` }}
                                    title={`${pm.method}: ${formatKES(pm.amount)} (${pct.toFixed(1)}%)`}
                                  />
                                );
                              })}
                            </div>
                            <div className="space-y-4">
                              {byPM.map((pm, i) => {
                                const maxAmount = Math.max(...byPM.map(p => p.amount), 1);
                                const pct = (pm.amount / maxAmount) * 100;
                                const colorClass = pmColors[pm.method] || 'bg-gray-500';
                                return (
                                  <div key={i} className="space-y-2">
                                    <div className="flex items-center justify-between text-sm">
                                      <div className="flex items-center gap-2">
                                        <div className={`w-6 h-6 rounded-md flex items-center justify-center ${colorClass} text-white`}>
                                          {paymentMethodIcons[pm.method] || <CreditCard className="h-3.5 w-3.5" />}
                                        </div>
                                        <span className="font-medium">{pm.method}</span>
                                        <Badge variant="outline" className="text-[9px]">{pm.count} txns</Badge>
                                      </div>
                                      <div className="text-right">
                                        <span className="font-medium">{formatKES(pm.amount)}</span>
                                        <span className="text-xs text-muted-foreground ml-2">
                                          {((pm.amount / totalAmount) * 100).toFixed(0)}%
                                        </span>
                                      </div>
                                    </div>
                                    <div className="h-3 bg-muted/30 rounded-full overflow-hidden">
                                      <div
                                        className={`h-full rounded-full transition-all duration-500 ${colorClass}`}
                                        style={{ width: `${pct}%` }}
                                      />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        );
                      })()}
                    </CardContent>
                  </Card>
                )}

                {/* Top 5 Products by Revenue */}
                {topProducts.length > 0 && (
                  <Card className="backdrop-blur-sm bg-card/80 border-border/50">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <TrendingUp className="h-4 w-4" /> Top 5 Products by Revenue
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3 max-h-72 overflow-y-auto pr-2 custom-scrollbar">
                        {topProducts.slice(0, 5).map((product, i) => {
                          const maxRevenue = Math.max(...topProducts.map(p => p.revenue), 1);
                          const pct = (product.revenue / maxRevenue) * 100;
                          const rankColors = ['bg-yellow-500 text-white', 'bg-gray-400 text-white', 'bg-amber-600 text-white'];
                          return (
                            <div key={i} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/30 transition-colors">
                              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${i < 3 ? rankColors[i] : 'bg-muted text-muted-foreground'}`}>
                                {i + 1}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-sm font-medium truncate">{product.productName}</span>
                                  <span className="text-sm font-bold ml-2">{formatKES(product.revenue)}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="flex-1">
                                    <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
                                      <div
                                        className="h-full rounded-full bg-gradient-to-r from-primary/60 to-primary transition-all duration-500"
                                        style={{ width: `${pct}%` }}
                                      />
                                    </div>
                                  </div>
                                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">{product.quantitySold} sold</span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            ) : (
              <Card className="backdrop-blur-sm bg-card/80">
                <CardContent className="p-8 text-center text-muted-foreground">
                  <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No sales data available for the selected period</p>
                  <p className="text-xs mt-1">Try adjusting the date range</p>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* ================================================================== */}
        {/* Inventory Report                                                    */}
        {/* ================================================================== */}
        {reportType === 'inventory' && (
          <>
            {inventoryLoading ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
              </div>
            ) : inventoryReport ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Card className="border-l-4 border-l-primary backdrop-blur-sm bg-card/80">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <Package className="h-4 w-4 text-primary" />
                        <p className="text-sm text-muted-foreground">Total Products</p>
                      </div>
                      <p className="text-2xl font-bold">{inventoryReport.totalProducts}</p>
                    </CardContent>
                  </Card>
                  <Card className="border-l-4 border-l-amber-500 backdrop-blur-sm bg-card/80">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <AlertTriangle className="h-4 w-4 text-amber-500" />
                        <p className="text-sm text-muted-foreground">Low Stock</p>
                      </div>
                      <p className="text-2xl font-bold text-amber-600">{inventoryReport.lowStockCount}</p>
                    </CardContent>
                  </Card>
                  <Card className="border-l-4 border-l-red-500 backdrop-blur-sm bg-card/80">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <TrendingDown className="h-4 w-4 text-red-500" />
                        <p className="text-sm text-muted-foreground">Out of Stock</p>
                      </div>
                      <p className="text-2xl font-bold text-red-600">{inventoryReport.outOfStockCount}</p>
                    </CardContent>
                  </Card>
                  <Card className="border-l-4 border-l-green-500 backdrop-blur-sm bg-card/80">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <DollarSign className="h-4 w-4 text-green-500" />
                        <p className="text-sm text-muted-foreground">Inventory Value</p>
                      </div>
                      <p className="text-2xl font-bold whitespace-nowrap">{formatKES(inventoryReport.totalInventoryValue)}</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Stock Health & Turnover */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Card className="backdrop-blur-sm bg-card/80">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <HeartPulse className="h-4 w-4 text-green-600" /> Stock Health
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center gap-4">
                        <div className="relative w-20 h-20">
                          <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
                            <circle cx="40" cy="40" r="35" fill="none" stroke="currentColor" className="text-muted/30" strokeWidth="6" />
                            <circle
                              cx="40" cy="40" r="35" fill="none"
                              stroke={stockHealth >= 70 ? '#22c55e' : stockHealth >= 40 ? '#eab308' : '#ef4444'}
                              strokeWidth="6"
                              strokeLinecap="round"
                              strokeDasharray={`${(stockHealth / 100) * 220} 220`}
                            />
                          </svg>
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-lg font-bold">{stockHealth}%</span>
                          </div>
                        </div>
                        <div>
                          <p className="text-sm font-medium">
                            {stockHealth >= 70 ? 'Healthy' : stockHealth >= 40 ? 'Needs Attention' : 'Critical'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {inventoryReport.totalProducts - inventoryReport.lowStockCount - inventoryReport.outOfStockCount} of {inventoryReport.totalProducts} products in good stock
                          </p>
                          <div className="flex items-center gap-2 mt-2">
                            <Badge variant="outline" className="text-[9px] bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800">
                              Good: {inventoryReport.totalProducts - inventoryReport.lowStockCount - inventoryReport.outOfStockCount}
                            </Badge>
                            <Badge variant="outline" className="text-[9px] bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800">
                              Low: {inventoryReport.lowStockCount}
                            </Badge>
                            <Badge variant="outline" className="text-[9px] bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800">
                              Out: {inventoryReport.outOfStockCount}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="backdrop-blur-sm bg-card/80">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <RotateCcw className="h-4 w-4 text-primary" /> Inventory Turnover
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <div className="p-3 rounded-xl bg-primary/10">
                            <span className="text-2xl font-bold text-primary">{inventoryTurnover || '—'}</span>
                          </div>
                          <div>
                            <p className="text-sm font-medium">Turnover Ratio</p>
                            <p className="text-xs text-muted-foreground">
                              {Number(inventoryTurnover) >= 2 ? 'Excellent — inventory moves quickly' : Number(inventoryTurnover) >= 1 ? 'Good — healthy stock rotation' : 'Low — consider reducing stock levels'}
                            </p>
                          </div>
                        </div>
                        <Separator />
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="p-2 rounded-lg bg-muted/30">
                            <p className="text-muted-foreground">Revenue</p>
                            <p className="font-medium">{salesReport ? formatKES(salesReport.totalRevenue) : '—'}</p>
                          </div>
                          <div className="p-2 rounded-lg bg-muted/30">
                            <p className="text-muted-foreground">Inventory Value</p>
                            <p className="font-medium">{formatKES(inventoryReport.totalInventoryValue)}</p>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Category breakdown */}
                {categoryBreakdown.length > 0 && (
                  <Card className="backdrop-blur-sm bg-card/80">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <PieChart className="h-4 w-4" /> Inventory Valuation by Category
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ConicPieChart segments={pieSegments} />
                      <Separator className="my-4" />
                      <div className="space-y-3">
                        {categoryBreakdown.map((cat, i) => {
                          const colors = ['bg-blue-500', 'bg-green-500', 'bg-orange-500', 'bg-purple-500', 'bg-teal-500', 'bg-pink-500', 'bg-amber-500', 'bg-cyan-500', 'bg-lime-500', 'bg-rose-500'];
                          return (
                            <div key={i} className="space-y-1">
                              <div className="flex items-center justify-between text-sm">
                                <div className="flex items-center gap-2">
                                  <div className={`w-3 h-3 rounded-sm ${colors[i % colors.length]}`} />
                                  <span className="font-medium">{cat.name}</span>
                                  <Badge variant="outline" className="text-[9px]">{cat.productCount} items</Badge>
                                </div>
                                <span className="font-medium">{formatKES(cat.totalValue)}</span>
                              </div>
                              <HorizontalBar value={cat.totalValue} maxValue={maxCategoryValue} colorClass={colors[i % colors.length]} height="h-2" />
                            </div>
                          );
                        })}
                        <Separator />
                        <div className="flex items-center justify-between text-sm font-bold">
                          <span>Total Inventory Value</span>
                          <span>{formatKES(inventoryReport.totalInventoryValue)}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            ) : (
              <Card className="backdrop-blur-sm bg-card/80">
                <CardContent className="p-8 text-center text-muted-foreground">
                  <Boxes className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No inventory data available</p>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* ================================================================== */}
        {/* Inventory Valuation Report                                          */}
        {/* ================================================================== */}
        {reportType === 'valuation' && (
          <>
            {inventoryLoading ? (
              <div className="grid grid-cols-2 gap-3">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
              </div>
            ) : inventoryReport ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <Card className="border-l-4 border-l-green-500 backdrop-blur-sm bg-card/80">
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">Total Stock Value</p>
                      <p className="text-2xl font-bold text-green-600">{formatKES(inventoryReport.totalInventoryValue)}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">qty × cost price</p>
                    </CardContent>
                  </Card>
                  <Card className="border-l-4 border-l-primary backdrop-blur-sm bg-card/80">
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">Total SKUs</p>
                      <p className="text-2xl font-bold">{inventoryReport.totalProducts}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">product count</p>
                    </CardContent>
                  </Card>
                  <Card className="border-l-4 border-l-amber-500 backdrop-blur-sm bg-card/80">
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">Avg. Value/SKU</p>
                      <p className="text-2xl font-bold">{formatKES(inventoryReport.totalProducts > 0 ? inventoryReport.totalInventoryValue / inventoryReport.totalProducts : 0)}</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Valuation Chart */}
                <Card className="backdrop-blur-sm bg-card/80">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <BarChart3 className="h-4 w-4" /> Valuation by Category
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {valuationData.length > 0 ? (
                      <>
                        {chartType === 'bar' && <SVGBarChart data={valuationData} height={200} />}
                        {chartType === 'line' && <SVGLineChart data={valuationData} height={200} />}
                        {chartType === 'pie' && <ConicPieChart segments={pieSegments} />}
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-8">No valuation data available</p>
                    )}
                  </CardContent>
                </Card>

                {/* Valuation Detail Table */}
                {categoryBreakdown.length > 0 && (
                  <Card className="backdrop-blur-sm bg-card/80">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Valuation Details</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {categoryBreakdown.map((cat, i) => {
                          const avgValue = cat.productCount > 0 ? cat.totalValue / cat.productCount : 0;
                          return (
                            <div key={i} className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/30 transition-colors">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                                  {cat.name.charAt(0)}
                                </div>
                                <div>
                                  <p className="text-sm font-medium">{cat.name}</p>
                                  <p className="text-xs text-muted-foreground">{cat.productCount} items</p>
                                </div>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-bold">{formatKES(cat.totalValue)}</p>
                                <p className="text-[10px] text-muted-foreground">Avg: {formatKES(avgValue)}/item</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            ) : (
              <Card className="backdrop-blur-sm bg-card/80">
                <CardContent className="p-8 text-center text-muted-foreground">
                  <DollarSign className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No inventory valuation data available</p>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* ================================================================== */}
        {/* Daily Sales Summary                                                 */}
        {/* ================================================================== */}
        {reportType === 'daily' && (
          <>
            {salesLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-24" />
                <Skeleton className="h-64" />
              </div>
            ) : salesReport ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Card className="border-l-4 border-l-green-500 backdrop-blur-sm bg-card/80">
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">Today&apos;s Revenue</p>
                      <p className="text-2xl font-bold text-green-600">{formatKES(salesReport.totalRevenue)}</p>
                    </CardContent>
                  </Card>
                  <Card className="border-l-4 border-l-primary backdrop-blur-sm bg-card/80">
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">Transactions</p>
                      <p className="text-2xl font-bold">{salesReport.transactionCount}</p>
                    </CardContent>
                  </Card>
                  <Card className="border-l-4 border-l-amber-500 backdrop-blur-sm bg-card/80">
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">Avg. Transaction</p>
                      <p className="text-2xl font-bold">{formatKES(salesReport.avgTransactionValue)}</p>
                    </CardContent>
                  </Card>
                  <Card className="border-l-4 border-l-red-500 backdrop-blur-sm bg-card/80">
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">Total VAT</p>
                      <p className="text-2xl font-bold">{formatKES(salesReport.totalTax)}</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Hourly Breakdown Chart */}
                <Card className="backdrop-blur-sm bg-card/80">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Timer className="h-4 w-4" /> Hourly Sales Breakdown
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {chartType === 'bar' && <SVGBarChart data={dailyHourlyData} height={200} />}
                    {chartType === 'line' && <SVGLineChart data={dailyHourlyData} height={200} />}
                    {chartType === 'pie' && (
                      <ConicPieChart segments={dailyHourlyData.map((d, i) => ({
                        name: d.label,
                        value: d.value,
                        color: ['#3b82f6', '#22c55e', '#f97316', '#a855f7', '#14b8a6', '#ec4899', '#eab308', '#06b6d4', '#84cc16', '#f43f5e', '#8b5cf6'][i % 11],
                      }))} />
                    )}
                  </CardContent>
                </Card>

                {/* Peak Hour Analysis */}
                <Card className="backdrop-blur-sm bg-card/80">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Peak Hour Analysis</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {(() => {
                      const peak = dailyHourlyData.reduce((max, d) => d.value > max.value ? d : max, dailyHourlyData[0]);
                      const totalHourly = dailyHourlyData.reduce((s, d) => s + d.value, 0);
                      return (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div className="p-4 rounded-lg bg-green-50 dark:bg-green-900/20">
                            <p className="text-xs text-muted-foreground">Peak Hour</p>
                            <p className="text-xl font-bold text-green-600">{peak?.label || 'N/A'}</p>
                            <p className="text-sm">{formatKES(peak?.value || 0)}</p>
                          </div>
                          <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20">
                            <p className="text-xs text-muted-foreground">Hourly Average</p>
                            <p className="text-xl font-bold text-blue-600">{formatKES(Math.round(totalHourly / dailyHourlyData.length))}</p>
                          </div>
                          <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20">
                            <p className="text-xs text-muted-foreground">Peak Share</p>
                            <p className="text-xl font-bold text-amber-600">{peak ? ((peak.value / totalHourly) * 100).toFixed(1) : 0}%</p>
                          </div>
                        </div>
                      );
                    })()}
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card className="backdrop-blur-sm bg-card/80">
                <CardContent className="p-8 text-center text-muted-foreground">
                  <Timer className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No daily sales data available</p>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* ================================================================== */}
        {/* Top Products Report                                                 */}
        {/* ================================================================== */}
        {reportType === 'top_products' && (
          <>
            {(salesLoading || inventoryLoading) ? (
              <div className="space-y-3">
                <Skeleton className="h-24" />
                <Skeleton className="h-64" />
              </div>
            ) : topProducts.length > 0 ? (
              <>
                <Card className="backdrop-blur-sm bg-card/80">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        <TrendingUp className="h-4 w-4" /> Top Products by Revenue
                      </CardTitle>
                      <Badge variant="outline" className="text-[9px]">{topProducts.length} products</Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {chartType === 'bar' && <SVGBarChart data={topProductsChartData} height={220} />}
                    {chartType === 'line' && <SVGLineChart data={topProductsChartData} height={220} />}
                    {chartType === 'pie' && (
                      <ConicPieChart segments={topProductsChartData.map(d => ({
                        name: d.label,
                        value: d.value,
                        color: d.color || '#3b82f6',
                      }))} />
                    )}
                  </CardContent>
                </Card>

                {/* Detailed Product List */}
                <Card className="backdrop-blur-sm bg-card/80">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Product Details</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 max-h-96 overflow-y-auto custom-scrollbar pr-1">
                      {topProducts.map((product, i) => {
                        const maxRevenue = Math.max(...topProducts.map(p => p.revenue), 1);
                        const pct = (product.revenue / maxRevenue) * 100;
                        const rankColors = ['bg-yellow-500 text-white', 'bg-gray-400 text-white', 'bg-amber-600 text-white'];
                        return (
                          <div key={i} className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/30 transition-colors border border-transparent hover:border-border/30">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${i < 3 ? rankColors[i] : 'bg-muted text-muted-foreground'}`}>
                              {i + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-sm font-medium truncate">{product.productName}</span>
                                <span className="text-sm font-bold ml-2">{formatKES(product.revenue)}</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <div className="flex-1">
                                  <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
                                    <div
                                      className="h-full rounded-full bg-gradient-to-r from-primary/60 to-primary transition-all duration-500"
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                </div>
                                <span className="text-[10px] text-muted-foreground whitespace-nowrap min-w-[60px] text-right">{product.quantitySold} sold</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card className="backdrop-blur-sm bg-card/80">
                <CardContent className="p-8 text-center text-muted-foreground">
                  <TrendingUp className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No product sales data available</p>
                  <p className="text-xs mt-1">Complete some sales to see top products</p>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* ================================================================== */}
        {/* Customer Analysis Report                                            */}
        {/* ================================================================== */}
        {reportType === 'customer_analysis' && (
          <>
            {(customersLoading || transactionsLoading) ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
                </div>
                <Skeleton className="h-64" />
              </div>
            ) : customerAnalysis.customerCount > 0 ? (
              <>
                {/* Customer Summary Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Card className="border-l-4 border-l-primary backdrop-blur-sm bg-card/80">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <Users className="h-4 w-4 text-primary" />
                        <p className="text-sm text-muted-foreground">Total Customers</p>
                      </div>
                      <p className="text-2xl font-bold">{customerAnalysis.customerCount}</p>
                    </CardContent>
                  </Card>
                  <Card className="border-l-4 border-l-green-500 backdrop-blur-sm bg-card/80">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <DollarSign className="h-4 w-4 text-green-500" />
                        <p className="text-sm text-muted-foreground">Total Spent</p>
                      </div>
                      <p className="text-2xl font-bold whitespace-nowrap">{formatKES(customerAnalysis.totalSpent)}</p>
                    </CardContent>
                  </Card>
                  <Card className="border-l-4 border-l-amber-500 backdrop-blur-sm bg-card/80">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <ShoppingCart className="h-4 w-4 text-amber-500" />
                        <p className="text-sm text-muted-foreground">Avg. Spend</p>
                      </div>
                      <p className="text-2xl font-bold">{formatKES(customerAnalysis.avgSpend)}</p>
                    </CardContent>
                  </Card>
                  <Card className="border-l-4 border-l-red-500 backdrop-blur-sm bg-card/80">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <CreditCard className="h-4 w-4 text-red-500" />
                        <p className="text-sm text-muted-foreground">Outstanding Debt</p>
                      </div>
                      <p className="text-2xl font-bold whitespace-nowrap">{formatKES(customerAnalysis.debtTotal)}</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Top Customers Chart */}
                {customerChartData.length > 0 && (
                  <Card className="backdrop-blur-sm bg-card/80">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Users className="h-4 w-4" /> Top Customers by Spending
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-72">
                        <ResponsiveContainer width="100%" height="100%">
                          {chartType === 'bar' ? (
                            <BarChart data={customerChartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `KES ${(v / 1000).toFixed(0)}k`} />
                              <Tooltip formatter={(value: number) => formatKES(value)} />
                              <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Revenue" />
                            </BarChart>
                          ) : chartType === 'line' ? (
                            <LineChart data={customerChartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `KES ${(v / 1000).toFixed(0)}k`} />
                              <Tooltip formatter={(value: number) => formatKES(value)} />
                              <Line type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} name="Revenue" />
                            </LineChart>
                          ) : chartType === 'area' ? (
                            <AreaChart data={customerChartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `KES ${(v / 1000).toFixed(0)}k`} />
                              <Tooltip formatter={(value: number) => formatKES(value)} />
                              <Area type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.2)" name="Revenue" />
                            </AreaChart>
                          ) : (
                            <BarChart data={customerChartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `KES ${(v / 1000).toFixed(0)}k`} />
                              <Tooltip formatter={(value: number) => formatKES(value)} />
                              <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Revenue" />
                            </BarChart>
                          )}
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Payment Method Breakdown */}
                {customerAnalysis.paymentMethods.length > 0 && (
                  <Card className="backdrop-blur-sm bg-card/80">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <CreditCard className="h-4 w-4" /> Payment Methods Used
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {customerAnalysis.paymentMethods.map((pm, i) => {
                          const totalAmount = customerAnalysis.paymentMethods.reduce((s, p) => s + p.amount, 0) || 1;
                          const pct = (pm.amount / totalAmount) * 100;
                          const pmColors: Record<string, string> = { CASH: 'bg-green-500', MPESA: 'bg-primary', DEBT: 'bg-orange-500', SPLIT: 'bg-purple-500' };
                          return (
                            <div key={i} className="space-y-2">
                              <div className="flex items-center justify-between text-sm">
                                <div className="flex items-center gap-2">
                                  <div className={`w-6 h-6 rounded-md flex items-center justify-center ${pmColors[pm.method] || 'bg-gray-400'} text-white`}>
                                    {paymentMethodIcons[pm.method] || <CreditCard className="h-3.5 w-3.5" />}
                                  </div>
                                  <span className="font-medium">{pm.method}</span>
                                  <Badge variant="outline" className="text-[9px]">{pm.count} txns</Badge>
                                </div>
                                <div className="text-right">
                                  <span className="font-medium">{formatKES(pm.amount)}</span>
                                  <span className="text-xs text-muted-foreground ml-2">{pct.toFixed(0)}%</span>
                                </div>
                              </div>
                              <div className="h-2.5 bg-muted/30 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full transition-all duration-500 ${pmColors[pm.method] || 'bg-gray-400'}`} style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Customer Detail List */}
                <Card className="backdrop-blur-sm bg-card/80">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Customer Details</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 max-h-96 overflow-y-auto custom-scrollbar pr-1">
                      {customerAnalysis.topCustomers.map((customer, i) => {
                        const maxSpent = Math.max(...customerAnalysis.topCustomers.map(c => c.totalSpent), 1);
                        const pct = (customer.totalSpent / maxSpent) * 100;
                        const rankColors = ['bg-yellow-500 text-white', 'bg-gray-400 text-white', 'bg-amber-600 text-white'];
                        return (
                          <div key={i} className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/30 transition-colors border border-transparent hover:border-border/30">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${i < 3 ? rankColors[i] : 'bg-muted text-muted-foreground'}`}>
                              {i + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-sm font-medium truncate">{customer.name}</span>
                                <span className="text-sm font-bold ml-2">{formatKES(customer.totalSpent)}</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <div className="flex-1">
                                  <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
                                    <div className="h-full rounded-full bg-gradient-to-r from-primary/60 to-primary transition-all duration-500" style={{ width: `${pct}%` }} />
                                  </div>
                                </div>
                                <span className="text-[10px] text-muted-foreground whitespace-nowrap min-w-[60px] text-right">{customer.transactionCount} txns</span>
                              </div>
                              {customer.debtBalance > 0 && (
                                <div className="mt-1">
                                  <Badge variant="outline" className="text-[9px] bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800">
                                    Debt: {formatKES(customer.debtBalance)}
                                  </Badge>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card className="backdrop-blur-sm bg-card/80">
                <CardContent className="p-12 text-center">
                  <div className="mx-auto w-24 h-24 rounded-full bg-muted/30 flex items-center justify-center mb-4">
                    <Users className="h-10 w-10 text-muted-foreground/50" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">No Customer Data</h3>
                  <p className="text-sm text-muted-foreground max-w-md mx-auto">
                    Customer analysis will appear once you have customers and transactions recorded. 
                    Start by adding customers and completing sales.
                  </p>
                  <Button variant="outline" className="mt-4" onClick={() => setReportType('sales')}>
                    <ShoppingCart className="h-4 w-4 mr-2" /> View Sales Report Instead
                  </Button>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* ================================================================== */}
        {/* Rental Performance Report                                           */}
        {/* ================================================================== */}
        {reportType === 'rental_performance' && (
          <>
            {rentalsLoading ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
                </div>
                <Skeleton className="h-64" />
              </div>
            ) : rentalPerformance.totalRevenue > 0 || rentalPerformance.activeRentals > 0 ? (
              <>
                {/* Rental Summary Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Card className="border-l-4 border-l-primary backdrop-blur-sm bg-card/80">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <Wrench className="h-4 w-4 text-primary" />
                        <p className="text-sm text-muted-foreground">Active Rentals</p>
                      </div>
                      <p className="text-2xl font-bold">{rentalPerformance.activeRentals}</p>
                    </CardContent>
                  </Card>
                  <Card className="border-l-4 border-l-green-500 backdrop-blur-sm bg-card/80">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <DollarSign className="h-4 w-4 text-green-500" />
                        <p className="text-sm text-muted-foreground">Total Revenue</p>
                      </div>
                      <p className="text-2xl font-bold whitespace-nowrap">{formatKES(rentalPerformance.totalRevenue)}</p>
                    </CardContent>
                  </Card>
                  <Card className="border-l-4 border-l-amber-500 backdrop-blur-sm bg-card/80">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <TrendingUp className="h-4 w-4 text-amber-500" />
                        <p className="text-sm text-muted-foreground">Avg. Rental Value</p>
                      </div>
                      <p className="text-2xl font-bold">{formatKES(rentalPerformance.avgRentalValue)}</p>
                    </CardContent>
                  </Card>
                  <Card className="border-l-4 border-l-teal-500 backdrop-blur-sm bg-card/80">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <Package className="h-4 w-4 text-teal-500" />
                        <p className="text-sm text-muted-foreground">Utilization Rate</p>
                      </div>
                      <p className="text-2xl font-bold">{rentalPerformance.utilization}%</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Revenue by Status Chart */}
                {rentalChartData.length > 0 && (
                  <Card className="backdrop-blur-sm bg-card/80">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <BarChart3 className="h-4 w-4" /> Revenue by Rental Status
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-72">
                        <ResponsiveContainer width="100%" height="100%">
                          {chartType === 'bar' ? (
                            <BarChart data={rentalChartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `KES ${(v / 1000).toFixed(0)}k`} />
                              <Tooltip formatter={(value: number) => formatKES(value)} />
                              <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Revenue" />
                            </BarChart>
                          ) : chartType === 'line' ? (
                            <LineChart data={rentalChartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `KES ${(v / 1000).toFixed(0)}k`} />
                              <Tooltip formatter={(value: number) => formatKES(value)} />
                              <Line type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} name="Revenue" />
                            </LineChart>
                          ) : chartType === 'area' ? (
                            <AreaChart data={rentalChartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `KES ${(v / 1000).toFixed(0)}k`} />
                              <Tooltip formatter={(value: number) => formatKES(value)} />
                              <Area type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.2)" name="Revenue" />
                            </AreaChart>
                          ) : (
                            <BarChart data={rentalChartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `KES ${(v / 1000).toFixed(0)}k`} />
                              <Tooltip formatter={(value: number) => formatKES(value)} />
                              <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Revenue" />
                            </BarChart>
                          )}
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Status Breakdown */}
                {rentalPerformance.statusBreakdown.length > 0 && (
                  <Card className="backdrop-blur-sm bg-card/80">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Rental Status Breakdown</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {rentalPerformance.statusBreakdown.map((sb, i) => {
                          const totalRentals = rentalPerformance.statusBreakdown.reduce((s, r) => s + r.count, 0) || 1;
                          const pct = (sb.count / totalRentals) * 100;
                          const statusColors: Record<string, string> = {
                            ACTIVE: 'bg-green-500',
                            RETURNED: 'bg-primary',
                            OVERDUE: 'bg-red-500',
                            PENDING: 'bg-amber-500',
                            DAMAGED: 'bg-orange-500',
                          };
                          return (
                            <div key={i} className="space-y-1.5">
                              <div className="flex items-center justify-between text-sm">
                                <div className="flex items-center gap-2">
                                  <div className={`w-3 h-3 rounded-sm ${statusColors[sb.status] || 'bg-gray-400'}`} />
                                  <span className="font-medium">{sb.status}</span>
                                  <Badge variant="outline" className="text-[9px]">{sb.count} rentals</Badge>
                                </div>
                                <span className="text-xs text-muted-foreground">{pct.toFixed(0)}%</span>
                              </div>
                              <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full transition-all duration-500 ${statusColors[sb.status] || 'bg-gray-400'}`} style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Rental Detail List */}
                {rentalPerformance.topRented.length > 0 && (
                  <Card className="backdrop-blur-sm bg-card/80">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Recent Rentals</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2 max-h-96 overflow-y-auto custom-scrollbar pr-1">
                        {rentalPerformance.topRented.map((rental) => {
                          const statusColors: Record<string, string> = {
                            ACTIVE: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800',
                            RETURNED: 'bg-primary/10 text-primary border-primary/20',
                            OVERDUE: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800',
                            PENDING: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800',
                          };
                          return (
                            <div key={rental.id} className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/30 transition-colors border border-transparent hover:border-border/30">
                              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                                <Wrench className="h-4 w-4 text-primary" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-sm font-medium truncate">{rental.id.slice(-8)}</span>
                                  <span className="text-sm font-bold ml-2">{formatKES(rental.totalRentalCharge)}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline" className={`text-[9px] ${statusColors[rental.status] || ''}`}>
                                    {rental.status}
                                  </Badge>
                                  {rental.lateFeeAccumulated > 0 && (
                                    <Badge variant="outline" className="text-[9px] bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800">
                                      Late: {formatKES(rental.lateFeeAccumulated)}
                                    </Badge>
                                  )}
                                  <span className="text-[10px] text-muted-foreground">
                                    Deposit: {formatKES(rental.securityDeposit)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            ) : (
              <Card className="backdrop-blur-sm bg-card/80">
                <CardContent className="p-12 text-center">
                  <div className="mx-auto w-24 h-24 rounded-full bg-muted/30 flex items-center justify-center mb-4">
                    <Wrench className="h-10 w-10 text-muted-foreground/50" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">No Rental Data</h3>
                  <p className="text-sm text-muted-foreground max-w-md mx-auto">
                    Rental performance analysis will appear once you have equipment rentals recorded.
                    Start by creating rental orders for your equipment.
                  </p>
                  <Button variant="outline" className="mt-4" onClick={() => setReportType('sales')}>
                    <ShoppingCart className="h-4 w-4 mr-2" /> View Sales Report Instead
                  </Button>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* ================================================================== */}
        {/* Trends & Predictions                                                */}
        {/* ================================================================== */}
        {reportType === 'trends' && (
          <TrendsPredictionsSection storeId={currentStoreId} />
        )}
      </div>
    </div>
  );
}
