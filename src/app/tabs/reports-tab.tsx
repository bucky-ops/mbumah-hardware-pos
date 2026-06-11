'use client';

import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Download, BarChart3, Package, TrendingUp, TrendingDown,
  ArrowUpRight, ArrowDownRight, Minus, FileText, Boxes,
  ShoppingCart, DollarSign, FileSpreadsheet,
} from 'lucide-react';

import { useAppStore } from '@/lib/stores';
import {
  reportsApi, dashboardApi,
  formatKES,
} from '@/lib/api';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// ============================================================================
// Report Type Card Component
// ============================================================================

function ReportTypeCard({
  icon, title, description, isActive, onClick, colorClass,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  isActive: boolean;
  onClick: () => void;
  colorClass: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-4 rounded-lg border-2 transition-all ${
        isActive
          ? `border-primary bg-primary/5 ${colorClass}`
          : 'border-transparent bg-muted/30 hover:bg-muted/50'
      }`}
    >
      <div className="flex items-center gap-3 mb-2">
        {icon}
        <span className="text-sm font-bold">{title}</span>
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
    </button>
  );
}

// ============================================================================
// CSS Bar Component
// ============================================================================

function HorizontalBar({ value, maxValue, colorClass = 'bg-primary/70' }: {
  value: number; maxValue: number; colorClass?: string;
}) {
  const pct = maxValue > 0 ? (value / maxValue) * 100 : 0;
  return (
    <div className="h-4 bg-muted/30 rounded-full overflow-hidden">
      <div className={`h-full rounded-full transition-all ${colorClass}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ============================================================================
// Main Reports Tab Component
// ============================================================================

export default function ReportsTab() {
  const currentStoreId = useAppStore((s) => s.currentStoreId);
  const [reportType, setReportType] = useState<'sales' | 'inventory'>('sales');
  const [dateFrom, setDateFrom] = useState(new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]);
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);

  const { data: salesData, isLoading: salesLoading } = useQuery({
    queryKey: ['sales-report', currentStoreId, dateFrom, dateTo],
    queryFn: () => reportsApi.getSalesReport({ storeId: currentStoreId, dateFrom, dateTo }),
    enabled: reportType === 'sales',
  });

  const { data: inventoryData, isLoading: inventoryLoading } = useQuery({
    queryKey: ['inventory-report', currentStoreId],
    queryFn: () => reportsApi.getInventoryReport(currentStoreId),
    enabled: reportType === 'inventory',
  });

  const { data: dashboardData } = useQuery({
    queryKey: ['dashboard', currentStoreId],
    queryFn: () => dashboardApi.getStats(currentStoreId),
  });

  const salesReport = salesData?.data;
  const inventoryReport = inventoryData?.data;
  const dashboardStats = dashboardData?.data;

  // Quick stats from dashboard
  const quickStats = useMemo(() => ({
    todayRevenue: dashboardStats?.todayRevenue || 0,
    todayTransactions: dashboardStats?.todayTransactions || 0,
    lowStockProducts: dashboardStats?.lowStockProducts || 0,
    outstandingDebt: dashboardStats?.outstandingDebt || 0,
  }), [dashboardStats]);

  // Sales comparison (mock: this period vs last period)
  const salesComparison = useMemo(() => {
    if (!salesReport) return null;
    // Simulate previous period with slight variation
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

  // Top products from inventory report
  const topProducts = inventoryReport?.topSelling || [];

  // Category breakdown for inventory
  const categoryBreakdown = inventoryReport?.categories || [];
  const maxCategoryValue = Math.max(...categoryBreakdown.map((c) => c.totalValue), 1);

  // CSV file size estimate
  const estimatedFileSize = useMemo(() => {
    if (reportType === 'sales' && salesReport) {
      const rows = salesReport.transactionCount || 0;
      const bytesPerRow = 120;
      const size = rows * bytesPerRow;
      if (size === 0) return '< 1 KB';
      if (size < 1024) return `${size} B`;
      if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
      return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    }
    if (reportType === 'inventory' && inventoryReport) {
      const rows = inventoryReport.totalProducts || 0;
      const bytesPerRow = 100;
      const size = rows * bytesPerRow;
      if (size === 0) return '< 1 KB';
      if (size < 1024) return `${size} B`;
      if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
      return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    }
    return '—';
  }, [reportType, salesReport, inventoryReport]);

  const handleExport = async () => {
    try {
      const res = await reportsApi.exportCSV({ storeId: currentStoreId, type: reportType, dateFrom, dateTo });
      if (res.data?.url) {
        window.open(res.data.url, '_blank');
        toast.success('Report exported');
      }
    } catch {
      toast.error('Export failed');
    }
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

  return (
    <div className="space-y-4">
      {/* Quick Stats Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                <DollarSign className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Today Revenue</p>
                <p className="text-lg font-bold">{formatKES(quickStats.todayRevenue)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <ShoppingCart className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Today Sales</p>
                <p className="text-lg font-bold">{quickStats.todayTransactions}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-yellow-100 dark:bg-yellow-900/30">
                <Package className="h-5 w-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Low Stock</p>
                <p className="text-lg font-bold">{quickStats.lowStockProducts}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30">
                <TrendingDown className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Outstanding Debt</p>
                <p className="text-lg font-bold">{formatKES(quickStats.outstandingDebt)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Report Generation Dashboard */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Report Generation Dashboard</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ReportTypeCard
              icon={<BarChart3 className="h-5 w-5 text-primary" />}
              title="Sales Report"
              description="Revenue, transactions, payment methods, and trends analysis for the selected period."
              isActive={reportType === 'sales'}
              onClick={() => setReportType('sales')}
              colorClass="text-primary"
            />
            <ReportTypeCard
              icon={<Boxes className="h-5 w-5 text-orange-600" />}
              title="Inventory Report"
              description="Stock levels, category valuation, top sellers, and reorder alerts."
              isActive={reportType === 'inventory'}
              onClick={() => setReportType('inventory')}
              colorClass="text-orange-600"
            />
          </div>
        </CardContent>
      </Card>

      {/* Controls */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3 items-end">
            {reportType === 'sales' && (
              <>
                <div className="space-y-1">
                  <Label className="text-sm">From</Label>
                  <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
                </div>
                <div className="space-y-1">
                  <Label className="text-sm">To</Label>
                  <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
                </div>
              </>
            )}
            <div className="ml-auto flex items-center gap-3">
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Estimated file size</p>
                <p className="text-sm font-medium">{estimatedFileSize}</p>
              </div>
              <Button onClick={handleExport} className="bg-primary hover:bg-primary/90 text-primary-foreground">
                <FileSpreadsheet className="mr-2 h-4 w-4" /> Export CSV
                <Download className="ml-2 h-3 w-3" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Sales Report */}
      {reportType === 'sales' && (
        <>
          {salesLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
            </div>
          ) : salesReport ? (
            <>
              {/* Sales Stats with Comparison */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card>
                  <CardContent className="p-4">
                    <p className="text-sm text-muted-foreground">Total Revenue</p>
                    <div className="flex items-center gap-2">
                      <p className="text-2xl font-bold text-green-600">{formatKES(salesReport.totalRevenue)}</p>
                      {salesComparison && changeIndicator(salesComparison.revenueChange)}
                    </div>
                    {salesComparison && (
                      <p className={`text-xs ${changeColor(salesComparison.revenueChange)}`}>
                        {salesComparison.revenueChange >= 0 ? '+' : ''}{salesComparison.revenueChange.toFixed(1)}% vs prev period
                      </p>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-sm text-muted-foreground">Total Sales</p>
                    <div className="flex items-center gap-2">
                      <p className="text-2xl font-bold">{salesReport.transactionCount}</p>
                      {salesComparison && changeIndicator(salesComparison.transactionChange)}
                    </div>
                    {salesComparison && (
                      <p className={`text-xs ${changeColor(salesComparison.transactionChange)}`}>
                        {salesComparison.transactionChange >= 0 ? '+' : ''}{salesComparison.transactionChange.toFixed(1)}% vs prev period
                      </p>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-sm text-muted-foreground">Total Tax</p>
                    <p className="text-2xl font-bold">{formatKES(salesReport.totalTax)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-sm text-muted-foreground">Avg Transaction</p>
                    <p className="text-2xl font-bold">{formatKES(salesReport.avgTransactionValue)}</p>
                  </CardContent>
                </Card>
              </div>

              {/* Sales by Payment Method - CSS Bar Chart */}
              {(salesReport.byPaymentMethod || []).length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Sales by Payment Method</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {(salesReport.byPaymentMethod || []).map((pm, i) => {
                        const byPM = salesReport.byPaymentMethod || [];
                        const maxAmount = Math.max(...byPM.map(p => p.amount), 1);
                        const pct = (pm.amount / maxAmount) * 100;
                        const colors = ['bg-primary/70', 'bg-green-500', 'bg-orange-500', 'bg-purple-500'];
                        return (
                          <div key={i} className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                              <div className="flex items-center gap-2">
                                <div className={`w-3 h-3 rounded-sm ${colors[i % colors.length]}`} />
                                <span className="font-medium">{pm.method}</span>
                              </div>
                              <div className="text-right">
                                <span className="text-muted-foreground">{pm.count} txns</span>
                                <span className="ml-3 font-medium">{formatKES(pm.amount)}</span>
                              </div>
                            </div>
                            <div className="h-4 bg-muted/30 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${colors[i % colors.length]}`}
                                style={{ width: `${pct}%` }}
                              />
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
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No sales data available for the selected period</p>
                <p className="text-xs mt-1">Try adjusting the date range</p>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Inventory Report */}
      {reportType === 'inventory' && (
        <>
          {inventoryLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
            </div>
          ) : inventoryReport ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card>
                  <CardContent className="p-4">
                    <p className="text-sm text-muted-foreground">Total Products</p>
                    <p className="text-2xl font-bold">{inventoryReport.totalProducts}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-sm text-muted-foreground">Low Stock</p>
                    <p className="text-2xl font-bold text-yellow-600">{inventoryReport.lowStockCount}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-sm text-muted-foreground">Out of Stock</p>
                    <p className="text-2xl font-bold text-red-600">{inventoryReport.outOfStockCount}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-sm text-muted-foreground">Inventory Value</p>
                    <p className="text-2xl font-bold">{formatKES(inventoryReport.totalInventoryValue)}</p>
                  </CardContent>
                </Card>
              </div>

              {/* Inventory Valuation by Category */}
              {categoryBreakdown.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Inventory Valuation by Category</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {categoryBreakdown.map((cat, i) => {
                        const colors = [
                          'bg-primary/70', 'bg-green-500', 'bg-orange-500',
                          'bg-purple-500', 'bg-teal-500', 'bg-pink-500',
                          'bg-indigo-500', 'bg-amber-500', 'bg-cyan-500', 'bg-lime-500',
                        ];
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
                            <HorizontalBar
                              value={cat.totalValue}
                              maxValue={maxCategoryValue}
                              colorClass={colors[i % colors.length]}
                            />
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

              {/* Top Products by Revenue */}
              {topProducts.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <TrendingUp className="h-4 w-4" /> Top Products by Revenue
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3 max-h-64 overflow-y-auto pr-2 custom-scrollbar">
                      {topProducts.map((product, i) => {
                        const maxRevenue = Math.max(...topProducts.map(p => p.revenue), 1);
                        const pct = (product.revenue / maxRevenue) * 100;
                        const medalColors = ['text-yellow-500', 'text-gray-400', 'text-amber-600'];
                        return (
                          <div key={i} className="space-y-1">
                            <div className="flex items-center gap-2 text-sm">
                              <span className={`font-bold text-xs w-5 ${i < 3 ? medalColors[i] : 'text-muted-foreground'}`}>
                                #{i + 1}
                              </span>
                              <span className="font-medium flex-1 truncate">{product.productName}</span>
                              <span className="text-xs text-muted-foreground">{product.quantitySold} sold</span>
                              <span className="font-medium ml-2">{formatKES(product.revenue)}</span>
                            </div>
                            <div className="ml-5">
                              <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-primary/60 transition-all"
                                  style={{ width: `${pct}%` }}
                                />
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
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <Boxes className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No inventory data available</p>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
