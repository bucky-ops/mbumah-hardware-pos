'use client';

import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download } from 'lucide-react';

import { useAppStore } from '@/lib/stores';
import {
  reportsApi,
  formatKES,
} from '@/lib/api';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Simple chart placeholder component
function ChartPlaceholder({ name, className }: { name: string; className?: string }) {
  return (
    <div className={`flex items-center justify-center bg-muted/30 border border-dashed border-muted-foreground/20 rounded-md ${className || 'h-64'}`}>
      <p className="text-sm text-muted-foreground">Chart: {name}</p>
    </div>
  );
}

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

  const salesReport = salesData?.data;
  const inventoryReport = inventoryData?.data;

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

  return (
    <div className="space-y-4">
      {/* Controls */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3 items-end">
            <div className="space-y-1">
              <Label className="text-sm">Report Type</Label>
              <Select value={reportType} onValueChange={(v) => setReportType(v as 'sales' | 'inventory')}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sales">Sales Report</SelectItem>
                  <SelectItem value="inventory">Inventory Report</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {reportType === 'sales' && (
              <>
                <div className="space-y-1"><Label className="text-sm">From</Label><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" /></div>
                <div className="space-y-1"><Label className="text-sm">To</Label><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" /></div>
              </>
            )}
            <Button onClick={handleExport} variant="outline" className="ml-auto">
              <Download className="mr-2 h-4 w-4" /> Export CSV
            </Button>
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
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Total Revenue</p><p className="text-2xl font-bold text-green-600">{formatKES(salesReport.totalRevenue)}</p></CardContent></Card>
                <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Total Sales</p><p className="text-2xl font-bold">{salesReport.transactionCount}</p></CardContent></Card>
                <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Total Tax</p><p className="text-2xl font-bold">{formatKES(salesReport.totalTax)}</p></CardContent></Card>
                <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Avg Transaction</p><p className="text-2xl font-bold">{formatKES(salesReport.avgTransactionValue)}</p></CardContent></Card>
              </div>
              {salesReport.byPaymentMethod.length > 0 && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-base">Sales by Payment Method</CardTitle></CardHeader>
                  <CardContent>
                    <ChartPlaceholder name="Sales by Payment Method" />
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <Card><CardContent className="p-8 text-center text-muted-foreground"><p>No sales data available for the selected period</p></CardContent></Card>
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
                <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Total Products</p><p className="text-2xl font-bold">{inventoryReport.totalProducts}</p></CardContent></Card>
                <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Low Stock</p><p className="text-2xl font-bold text-yellow-600">{inventoryReport.lowStockCount}</p></CardContent></Card>
                <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Out of Stock</p><p className="text-2xl font-bold text-red-600">{inventoryReport.outOfStockCount}</p></CardContent></Card>
                <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Inventory Value</p><p className="text-2xl font-bold">{formatKES(inventoryReport.totalInventoryValue)}</p></CardContent></Card>
              </div>
              {inventoryReport.categories.length > 0 && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-base">Inventory by Category</CardTitle></CardHeader>
                  <CardContent>
                    <ChartPlaceholder name="Inventory by Category" />
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <Card><CardContent className="p-8 text-center text-muted-foreground"><p>No inventory data available</p></CardContent></Card>
          )}
        </>
      )}
    </div>
  );
}
