'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Activity, ArrowRight, Plus, CheckCircle, Loader2
} from 'lucide-react';

import { useAppStore } from '@/lib/stores';
import {
  systemLogsApi, stockMovementsApi, productsApi,
  formatDateTime,
  type SystemLogItem, type StockMovementItem,
} from '@/lib/api';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

function StockAdjustmentDialog({ storeId }: { storeId: string }) {
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');

  const { data: productsData } = useQuery({
    queryKey: ['products', storeId],
    queryFn: () => productsApi.list({ storeId, limit: 200 }),
  });

  const adjustMutation = useMutation({
    mutationFn: stockMovementsApi.createAdjustment,
    onSuccess: () => { toast.success('Stock adjusted'); setOpen(false); setProductId(''); setQuantity(''); setNotes(''); },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="bg-accent-orange hover:bg-accent-orange/90 text-accent-orange-foreground">
          <Plus className="mr-2 h-4 w-4" /> Adjustment
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Stock Adjustment</DialogTitle>
          <DialogDescription>Adjust stock quantity (positive to add, negative to remove)</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Product</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
              <SelectContent>
                {(productsData?.data || []).map(p => <SelectItem key={p.id} value={p.id}>{p.name} (Stock: {p.quantityInStock})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2"><Label>Quantity Change</Label><Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="e.g. +50 or -10" /></div>
          <div className="space-y-2"><Label>Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reason for adjustment" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => adjustMutation.mutate({ storeId, productId, quantity: Number(quantity), notes })} disabled={adjustMutation.isPending || !productId || !quantity}>
            {adjustMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
            Apply Adjustment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminTab() {
  const currentStoreId = useAppStore((s) => s.currentStoreId);
  const [logFilter, setLogFilter] = useState({ component: 'all', severity: 'all' });

  const { data: logsData, isLoading } = useQuery({
    queryKey: ['system-logs', currentStoreId, logFilter],
    queryFn: () => systemLogsApi.list({
      storeId: currentStoreId,
      component: logFilter.component !== 'all' ? logFilter.component : undefined,
      severity: logFilter.severity !== 'all' ? logFilter.severity : undefined,
      limit: 100,
    }),
  });

  const { data: movementsData } = useQuery({
    queryKey: ['stock-movements', currentStoreId],
    queryFn: () => stockMovementsApi.list({ storeId: currentStoreId, limit: 50 }),
  });

  const logs = logsData?.data || [];
  const movements = movementsData?.data || [];

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'CRITICAL': case 'ERROR': return 'destructive';
      case 'WARN': return 'outline';
      default: return 'secondary';
    }
  };

  return (
    <div className="space-y-4">
      <Tabs defaultValue="logs">
        <TabsList>
          <TabsTrigger value="logs"><Activity className="mr-2 h-4 w-4" />System Logs</TabsTrigger>
          <TabsTrigger value="movements"><ArrowRight className="mr-2 h-4 w-4" />Stock Movements</TabsTrigger>
        </TabsList>

        <TabsContent value="logs" className="space-y-4">
          <div className="flex gap-3">
            <Select value={logFilter.component} onValueChange={(v) => setLogFilter({ ...logFilter, component: v })}>
              <SelectTrigger className="w-48"><SelectValue placeholder="All Components" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Components</SelectItem>
                <SelectItem value="POS">POS</SelectItem>
                <SelectItem value="INVENTORY">Inventory</SelectItem>
                <SelectItem value="FINANCIAL">Financial</SelectItem>
                <SelectItem value="AUTH">Auth</SelectItem>
                <SelectItem value="PAYMENT">Payment</SelectItem>
                <SelectItem value="RENTAL">Rental</SelectItem>
                <SelectItem value="SYSTEM">System</SelectItem>
              </SelectContent>
            </Select>
            <Select value={logFilter.severity} onValueChange={(v) => setLogFilter({ ...logFilter, severity: v })}>
              <SelectTrigger className="w-40"><SelectValue placeholder="All Severities" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Severities</SelectItem>
                <SelectItem value="DEBUG">Debug</SelectItem>
                <SelectItem value="INFO">Info</SelectItem>
                <SelectItem value="WARN">Warning</SelectItem>
                <SelectItem value="ERROR">Error</SelectItem>
                <SelectItem value="CRITICAL">Critical</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-6 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Timestamp</TableHead>
                        <TableHead>Component</TableHead>
                        <TableHead>Severity</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead className="max-w-[300px]">Message</TableHead>
                        <TableHead>User</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {logs.length === 0 ? (
                        <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No logs found</TableCell></TableRow>
                      ) : logs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell className="text-xs font-mono whitespace-nowrap">{formatDateTime(log.createdAt)}</TableCell>
                          <TableCell><Badge variant="outline" className="text-[10px]">{log.component}</Badge></TableCell>
                          <TableCell><Badge variant={getSeverityColor(log.severity) as "destructive" | "outline" | "secondary"} className="text-[10px]">{log.severity}</Badge></TableCell>
                          <TableCell className="text-sm">{log.action}</TableCell>
                          <TableCell className="text-sm max-w-[300px] truncate">{log.message}</TableCell>
                          <TableCell className="text-sm">{log.user?.name || '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="movements" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Stock Movements</CardTitle>
                <StockAdjustmentDialog storeId={currentStoreId} />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {movements.length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No stock movements</TableCell></TableRow>
                    ) : movements.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="text-sm">{formatDateTime(m.createdAt)}</TableCell>
                        <TableCell className="text-sm font-medium">{m.product?.name || m.productId}</TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px]">{m.movementType}</Badge></TableCell>
                        <TableCell className="text-right font-medium">
                          <span className={m.quantity > 0 ? 'text-green-600' : 'text-red-600'}>
                            {m.quantity > 0 ? '+' : ''}{m.quantity}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{m.notes || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
