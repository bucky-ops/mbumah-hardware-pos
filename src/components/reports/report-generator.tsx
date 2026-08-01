'use client';

// ReportGenerator — interactive report builder + CSV downloader.
//
// Features:
//   • Report type selector: Daily / Weekly / Monthly / Custom Range.
//   • Date range picker (single date for Daily; start + end for others).
//   • Store selector (defaults to the active store; SUPER_ADMIN can pick any).
//   • Generate button — fetches JSON from the API and shows a preview panel
//     with the summary metrics.
//   • Download CSV button — fetches the same report with format=csv and
//     triggers a browser download via `downloadCSV()` from lib/report-utils.
//   • Print-friendly layout (hidden toolbar when printing, summary cards
//     with clear borders, etc.).
//
// Endpoints used:
//   • Daily → /api/reports/daily?date=YYYY-MM-DD&storeId=…
//   • Weekly / Monthly / Custom → /api/reports/sales-summary?startDate=…&endDate=…&storeId=…

import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CalendarDays, FileBarChart, Download, Loader2, Printer,
  TrendingUp, TrendingDown, Minus, Store as StoreIcon,
  CreditCard, Package, Wallet, Receipt,
} from 'lucide-react';

import {
  downloadCSV, formatReportDate, formatNumber, formatISODate,
  type SalesSummaryData, type DailyReportData,
} from '@/lib/report-utils';
import { formatKES } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Tabs, TabsList, TabsTrigger,
} from '@/components/ui/tabs';

// ── Types ───────────────────────────────────────────────────────────────────

type ReportType = 'daily' | 'weekly' | 'monthly' | 'custom';

interface StoreOption {
  id: string;
  name: string;
  location?: string | null;
}

interface ReportGeneratorProps {
  /** Active store — the default selection in the store dropdown. */
  storeId: string;
  /** Optional list of stores the user can switch between. When omitted or
   *  length <= 1, the store selector is hidden (single-store user). */
  stores?: StoreOption[];
  /** When true, the store selector is always shown even with one store. */
  forceShowStoreSelector?: boolean;
  className?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function isoToday(): string {
  return formatISODate(new Date());
}

function firstOfMonth(): string {
  const d = new Date();
  d.setDate(1);
  return formatISODate(d);
}

function startOfWeek(): string {
  const d = new Date();
  const day = d.getDay(); // 0 = Sun
  d.setDate(d.getDate() - day);
  return formatISODate(d);
}

// ── Component ───────────────────────────────────────────────────────────────

export function ReportGenerator({
  storeId: initialStoreId,
  stores,
  forceShowStoreSelector = false,
  className,
}: ReportGeneratorProps) {
  const [reportType, setReportType] = useState<ReportType>('daily');
  const [storeId, setStoreId] = useState<string>(initialStoreId);

  // Daily uses a single date; the others use start + end.
  const [singleDate, setSingleDate] = useState<string>(isoToday());
  const [startDate, setStartDate] = useState<string>(startOfWeek());
  const [endDate, setEndDate] = useState<string>(isoToday());

  // The fetched preview report (one of the two shapes). null until generated.
  const [preview, setPreview] = useState<SalesSummaryData | DailyReportData | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  // Stores query — used for the store selector.
  const { data: storesData } = useQuery({
    queryKey: ['stores-for-reports'],
    queryFn: async (): Promise<StoreOption[]> => {
      if (stores && stores.length > 0) return stores;
      const res = await fetch('/api/stores');
      const json = await res.json();
      return (json.data || []) as StoreOption[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const availableStores = storesData || stores || [];
  const showStoreSelector = forceShowStoreSelector || availableStores.length > 1;

  // When the report type changes, reset sensible default date ranges.
  const onReportTypeChange = (value: string) => {
    const t = value as ReportType;
    setReportType(t);
    setPreview(null);
    if (t === 'daily') {
      setSingleDate(isoToday());
    } else if (t === 'weekly') {
      setStartDate(startOfWeek());
      setEndDate(isoToday());
    } else if (t === 'monthly') {
      setStartDate(firstOfMonth());
      setEndDate(isoToday());
    } else {
      // custom — leave whatever the user already had
    }
  };

  // Resolve the active date range based on the report type.
  const { resolvedStart, resolvedEnd, resolvedSingle } = useMemo(() => {
    if (reportType === 'daily') {
      return { resolvedStart: singleDate, resolvedEnd: singleDate, resolvedSingle: singleDate };
    }
    if (reportType === 'weekly') {
      // Default to last 7 days if user hasn't changed anything.
      return { resolvedStart: startDate, resolvedEnd: endDate, resolvedSingle: null };
    }
    if (reportType === 'monthly') {
      return { resolvedStart: startDate, resolvedEnd: endDate, resolvedSingle: null };
    }
    return { resolvedStart: startDate, resolvedEnd: endDate, resolvedSingle: null };
  }, [reportType, singleDate, startDate, endDate]);

  const isRangeValid = useMemo(() => {
    if (!storeId) return false;
    if (reportType === 'daily') return !!resolvedSingle;
    return !!resolvedStart && !!resolvedEnd && new Date(resolvedStart) <= new Date(resolvedEnd);
  }, [reportType, resolvedStart, resolvedEnd, resolvedSingle, storeId]);

  // Build query string for the appropriate endpoint.
  const buildQuery = useCallback(
    (format: 'json' | 'csv') => {
      const params = new URLSearchParams({ storeId });
      if (reportType === 'daily') {
        params.set('date', resolvedSingle || isoToday());
      } else {
        params.set('startDate', resolvedStart);
        params.set('endDate', resolvedEnd);
      }
      params.set('format', format);
      return params.toString();
    },
    [reportType, resolvedStart, resolvedEnd, resolvedSingle, storeId],
  );

  const endpointPath = reportType === 'daily' ? '/reports/daily' : '/reports/sales-summary';

  // ── Generate (preview JSON) ──
  const handleGenerate = useCallback(async () => {
    if (!isRangeValid) {
      toast.error('Please pick a valid date range.');
      return;
    }
    setIsGenerating(true);
    setPreview(null);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('mbt_token') : null;
      const res = await fetch(`/api${endpointPath}?${buildQuery('json')}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Request failed (${res.status})`);
      }
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to generate report.');
      setPreview(json.data);
      toast.success('Report preview ready.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate report.');
    } finally {
      setIsGenerating(false);
    }
  }, [buildQuery, endpointPath, isRangeValid]);

  // ── Download CSV ──
  const handleDownloadCSV = useCallback(async () => {
    if (!isRangeValid) {
      toast.error('Please pick a valid date range.');
      return;
    }
    setIsDownloading(true);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('mbt_token') : null;
      const res = await fetch(`/api${endpointPath}?${buildQuery('csv')}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Download failed (${res.status})`);
      }
      const csv = await res.text();
      const filename =
        reportType === 'daily'
          ? `daily_report_${resolvedSingle || isoToday()}.csv`
          : `${reportType}_report_${resolvedStart}_to_${resolvedEnd}.csv`;
      downloadCSV(csv, filename);
      toast.success('CSV downloaded.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to download CSV.');
    } finally {
      setIsDownloading(false);
    }
  }, [buildQuery, endpointPath, isRangeValid, reportType, resolvedStart, resolvedEnd, resolvedSingle]);

  // ── Print ──
  const handlePrint = useCallback(() => {
    if (typeof window !== 'undefined') window.print();
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <Card className={className}>
      <CardHeader className="print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileBarChart className="h-4 w-4" />
            Report Generator
          </CardTitle>
          {preview && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={handlePrint}
              >
                <Printer className="mr-1 h-3.5 w-3.5" />
                Print
              </Button>
              <Button
                size="sm"
                className="h-8"
                onClick={handleDownloadCSV}
                disabled={isDownloading || !isRangeValid}
              >
                {isDownloading ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="mr-1 h-3.5 w-3.5" />
                )}
                Download CSV
              </Button>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ── Controls ─────────────────────────────────────────────── */}
        <div className="space-y-3 print:hidden">
          <div>
            <Label className="mb-1.5 block text-xs text-muted-foreground">
              Report type
            </Label>
            <Tabs value={reportType} onValueChange={onReportTypeChange}>
              <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4">
                <TabsTrigger value="daily" className="text-xs">Daily</TabsTrigger>
                <TabsTrigger value="weekly" className="text-xs">Weekly</TabsTrigger>
                <TabsTrigger value="monthly" className="text-xs">Monthly</TabsTrigger>
                <TabsTrigger value="custom" className="text-xs">Custom</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {showStoreSelector && (
              <div>
                <Label className="mb-1.5 block text-xs text-muted-foreground">
                  Store
                </Label>
                <Select value={storeId} onValueChange={setStoreId}>
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue placeholder="Select store" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableStores.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        <span className="flex items-center gap-1.5">
                          <StoreIcon className="h-3 w-3" />
                          {s.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {reportType === 'daily' ? (
              <div>
                <Label className="mb-1.5 block text-xs text-muted-foreground">
                  Date
                </Label>
                <Input
                  type="date"
                  value={resolvedSingle || singleDate}
                  onChange={(e) => setSingleDate(e.target.value)}
                  className="h-8"
                />
              </div>
            ) : (
              <>
                <div>
                  <Label className="mb-1.5 block text-xs text-muted-foreground">
                    Start date
                  </Label>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="h-8"
                  />
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs text-muted-foreground">
                    End date
                  </Label>
                  <Input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="h-8"
                  />
                </div>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={handleGenerate}
              disabled={isGenerating || !isRangeValid}
              size="sm"
            >
              {isGenerating ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileBarChart className="mr-1 h-3.5 w-3.5" />
              )}
              Generate Report
            </Button>
            <span className="text-xs text-muted-foreground">
              {reportType === 'daily' && resolvedSingle && (
                <span className="flex items-center gap-1">
                  <CalendarDays className="h-3 w-3" /> {formatReportDate(resolvedSingle)}
                </span>
              )}
              {reportType !== 'daily' && resolvedStart && resolvedEnd && (
                <span className="flex items-center gap-1">
                  <CalendarDays className="h-3 w-3" />
                  {formatReportDate(resolvedStart)} — {formatReportDate(resolvedEnd)}
                </span>
              )}
            </span>
          </div>
        </div>

        {/* ── Preview panel ───────────────────────────────────────── */}
        {isGenerating ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
          </div>
        ) : preview ? (
          <div className="space-y-4">
            <ReportPreview
              data={preview}
              reportType={reportType}
            />
            {/* Mobile-only download button — the header button is hidden on small screens */}
            <Button
              onClick={handleDownloadCSV}
              disabled={isDownloading}
              size="sm"
              className="w-full print:hidden sm:hidden"
            >
              {isDownloading ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="mr-1 h-3.5 w-3.5" />
              )}
              Download CSV
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center print:hidden">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <FileBarChart className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">No report generated yet</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Pick a report type and date range, then click <strong>Generate Report</strong> to
              preview the summary. You can download the full CSV afterwards.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Preview sub-component ───────────────────────────────────────────────────

function ReportPreview({
  data,
  reportType,
}: {
  data: SalesSummaryData | DailyReportData;
  reportType: ReportType;
}) {
  // Render the right preview based on which report shape was returned.
  if (reportType === 'daily') {
    return <DailyPreview data={data as DailyReportData} />;
  }
  return <SalesSummaryPreview data={data as SalesSummaryData} />;
}

function DailyPreview({ data }: { data: DailyReportData }) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-foreground">
            End-of-Day Reconciliation — {data.store?.name || 'Store'}
          </span>
          <span>{formatReportDate(data.date)}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard
          label="Net Revenue"
          value={formatKES(data.sales.totalRevenue)}
          icon={<Wallet className="h-3.5 w-3.5" />}
          accent="emerald"
        />
        <MetricCard
          label="Transactions"
          value={String(data.sales.transactionCount)}
          icon={<Receipt className="h-3.5 w-3.5" />}
          accent="sky"
        />
        <MetricCard
          label="Tax Collected"
          value={formatKES(data.taxCollected)}
          icon={<TrendingUp className="h-3.5 w-3.5" />}
          accent="amber"
        />
        <MetricCard
          label="Avg Order"
          value={formatKES(data.sales.avgTransactionValue)}
          icon={<CreditCard className="h-3.5 w-3.5" />}
          accent="purple"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PreviewPanel title="Returns">
          <Row label="Count" value={String(data.returns.count)} />
          <Row label="Refunded" value={formatKES(data.returns.totalRefunded)} />
        </PreviewPanel>
        <PreviewPanel title="Voided">
          <Row label="Count" value={String(data.voided.count)} />
          <Row label="Amount" value={formatKES(data.voided.totalVoided)} />
        </PreviewPanel>
      </div>

      <PreviewPanel title="Payment Method Breakdown">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="py-1 text-left font-medium">Method</th>
              <th className="py-1 text-right font-medium">Count</th>
              <th className="py-1 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.paymentBreakdown.map((p) => (
              <tr key={p.method} className="border-b last:border-0">
                <td className="py-1.5">{p.method}</td>
                <td className="py-1.5 text-right font-mono">{p.count}</td>
                <td className="py-1.5 text-right font-mono">{formatNumber(p.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </PreviewPanel>

      {data.cashierBreakdown && data.cashierBreakdown.length > 0 && (
        <PreviewPanel title="Cashier Breakdown">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="py-1 text-left font-medium">Cashier</th>
                <th className="py-1 text-right font-medium">Transactions</th>
                <th className="py-1 text-right font-medium">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {data.cashierBreakdown.map((c) => (
                <tr key={c.cashierId} className="border-b last:border-0">
                  <td className="py-1.5">{c.cashierName}</td>
                  <td className="py-1.5 text-right font-mono">{c.transactionCount}</td>
                  <td className="py-1.5 text-right font-mono">{formatKES(c.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </PreviewPanel>
      )}
    </div>
  );
}

function SalesSummaryPreview({ data }: { data: SalesSummaryData }) {
  const changePct = data.comparison?.revenueChangePercent;
  const trendIcon =
    changePct === null || changePct === undefined ? (
      <Minus className="h-3.5 w-3.5" />
    ) : changePct > 0 ? (
      <TrendingUp className="h-3.5 w-3.5" />
    ) : changePct < 0 ? (
      <TrendingDown className="h-3.5 w-3.5" />
    ) : (
      <Minus className="h-3.5 w-3.5" />
    );
  const trendColor =
    changePct === null || changePct === undefined
      ? 'text-muted-foreground'
      : changePct > 0
        ? 'text-emerald-600 dark:text-emerald-400'
        : changePct < 0
          ? 'text-red-600 dark:text-red-400'
          : 'text-muted-foreground';

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold text-foreground">
            Sales Summary — {data.store?.name || 'All Stores'}
          </span>
          <span>
            {formatReportDate(data.period.startDate)} — {formatReportDate(data.period.endDate)}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard
          label="Total Revenue"
          value={formatKES(data.totals.revenue)}
          icon={<Wallet className="h-3.5 w-3.5" />}
          accent="emerald"
          footer={
            data.comparison ? (
              <span className={`flex items-center gap-1 ${trendColor}`}>
                {trendIcon}
                {changePct !== null && changePct !== undefined
                  ? `${changePct > 0 ? '+' : ''}${changePct.toFixed(1)}%`
                  : '—'}
              </span>
            ) : undefined
          }
        />
        <MetricCard
          label="Transactions"
          value={String(data.totals.transactions)}
          icon={<Receipt className="h-3.5 w-3.5" />}
          accent="sky"
        />
        <MetricCard
          label="Avg Order"
          value={formatKES(data.totals.avgOrderValue)}
          icon={<CreditCard className="h-3.5 w-3.5" />}
          accent="amber"
        />
        <MetricCard
          label="Gross Profit"
          value={formatKES(data.totals.grossProfit)}
          icon={<TrendingUp className="h-3.5 w-3.5" />}
          accent="purple"
          footer={
            <span className="text-muted-foreground">
              Margin: {data.totals.profitMargin.toFixed(1)}%
            </span>
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PreviewPanel title="Payment Method Breakdown">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="py-1 text-left font-medium">Method</th>
                <th className="py-1 text-right font-medium">Count</th>
                <th className="py-1 text-right font-medium">Amount</th>
                <th className="py-1 text-right font-medium">%</th>
              </tr>
            </thead>
            <tbody>
              {data.paymentBreakdown.map((p) => (
                <tr key={p.method} className="border-b last:border-0">
                  <td className="py-1.5">{p.method}</td>
                  <td className="py-1.5 text-right font-mono">{p.count}</td>
                  <td className="py-1.5 text-right font-mono">{formatNumber(p.amount)}</td>
                  <td className="py-1.5 text-right font-mono text-muted-foreground">
                    {p.percent.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </PreviewPanel>

        <PreviewPanel title="Top 10 Products">
          <div className="max-h-64 overflow-y-auto scrollbar-thin">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b text-muted-foreground">
                  <th className="py-1 text-left font-medium">#</th>
                  <th className="py-1 text-left font-medium">Product</th>
                  <th className="py-1 text-right font-medium">Qty</th>
                  <th className="py-1 text-right font-medium">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {data.topProducts.map((p, i) => (
                  <tr key={p.productId} className="border-b last:border-0">
                    <td className="py-1.5 text-muted-foreground">{i + 1}</td>
                    <td className="py-1.5">
                      <div className="truncate">{p.productName}</div>
                      <div className="text-[10px] text-muted-foreground">{p.sku}</div>
                    </td>
                    <td className="py-1.5 text-right font-mono">{formatNumber(p.quantity)}</td>
                    <td className="py-1.5 text-right font-mono">{formatNumber(p.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </PreviewPanel>
      </div>

      <PreviewPanel title="Hourly Sales Distribution">
        <div className="flex h-32 items-end gap-0.5">
          {data.hourlyDistribution.map((h) => {
            const max = Math.max(...data.hourlyDistribution.map((x) => x.revenue), 1);
            const heightPct = (h.revenue / max) * 100;
            return (
              <div
                key={h.hour}
                className="group relative flex-1 rounded-t-sm bg-emerald-500/70 transition-colors hover:bg-emerald-500"
                style={{ height: `${Math.max(2, heightPct)}%` }}
                title={`${h.label} — ${formatNumber(h.revenue)} KES (${h.transactionCount} txns)`}
              >
                <span className="absolute -top-5 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-1 py-0.5 text-[9px] text-background group-hover:block">
                  {formatNumber(h.revenue)}
                </span>
              </div>
            );
          })}
        </div>
        <div className="mt-1 flex justify-between text-[9px] text-muted-foreground">
          <span>00:00</span>
          <span>06:00</span>
          <span>12:00</span>
          <span>18:00</span>
          <span>23:00</span>
        </div>
      </PreviewPanel>
    </div>
  );
}

// ── Small building blocks ───────────────────────────────────────────────────

const ACCENT_CLASSES: Record<string, { border: string; icon: string }> = {
  emerald: {
    border: 'border-l-emerald-500',
    icon: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
  },
  sky: {
    border: 'border-l-sky-500',
    icon: 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300',
  },
  amber: {
    border: 'border-l-amber-500',
    icon: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
  },
  purple: {
    border: 'border-l-purple-500',
    icon: 'bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300',
  },
};

function MetricCard({
  label,
  value,
  icon,
  accent = 'emerald',
  footer,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent?: keyof typeof ACCENT_CLASSES;
  footer?: React.ReactNode;
}) {
  const a = ACCENT_CLASSES[accent] || ACCENT_CLASSES.emerald;
  return (
    <div className={`rounded-md border border-l-4 bg-card p-3 ${a.border}`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span className={`flex h-6 w-6 items-center justify-center rounded ${a.icon}`}>
          {icon}
        </span>
      </div>
      <p className="mt-1.5 truncate text-lg font-semibold tabular-nums">{value}</p>
      {footer && <div className="mt-1 text-[10px]">{footer}</div>}
    </div>
  );
}

function PreviewPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <Package className="h-3.5 w-3.5 text-muted-foreground" />
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h4>
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b py-1 text-xs last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-medium">{value}</span>
    </div>
  );
}

export default ReportGenerator;
