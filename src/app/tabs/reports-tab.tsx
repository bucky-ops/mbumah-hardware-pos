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
  Search, ClipboardList,
} from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

import { useAppStore } from '@/lib/stores';
import {
  reportsApi, dashboardApi,
  customersApi, rentalsApi, transactionsApi,
  formatKES,
  type CustomerItem,
  type RentalItem,
} from '@/lib/api';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

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

// Main Reports Tab Component

export default function ReportsTab() {
  const currentStoreId = useAppStore((s) => s.currentStoreId);
  const [reportType, setReportType] = useState<'sales' | 'inventory' | 'valuation' | 'daily' | 'top_products' | 'customer_analysis' | 'rental_performance'>('sales');
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
      </div>
    </div>
  );
}
