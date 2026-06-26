'use client';

import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowUpDown, Package, CheckCircle, ArrowRight, Plus, Search,
  Truck, Clock, X, Eye, Send, Check, AlertCircle, Loader2, MapPin, Store,
} from 'lucide-react';

import { useAppStore } from '@/lib/stores';
import {
  storeTransfersApi, productsApi, formatKES, formatDate, formatDateTime,
  type StoreTransferItem,
} from '@/lib/api';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

// ─── Store type ─────────────────────────────────────────────

interface StoreInfo {
  id: string;
  name: string;
  location?: string;
}

// ─── Helpers ────────────────────────────────────────────────

function transferStatusBadge(status: StoreTransferItem['status']) {
  const map: Record<string, { label: string; className: string; icon?: React.ReactNode }> = {
    PENDING: { label: 'Pending', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', icon: <Clock className="h-3 w-3" /> },
    IN_TRANSIT: { label: 'In Transit', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', icon: <Truck className="h-3 w-3" /> },
    RECEIVED: { label: 'Received', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', icon: <CheckCircle className="h-3 w-3" /> },
    CANCELLED: { label: 'Cancelled', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', icon: <X className="h-3 w-3" /> },
    PARTIAL: { label: 'Partial', className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400', icon: <AlertCircle className="h-3 w-3" /> },
  };
  const s = map[status] || { label: status, className: 'bg-muted text-muted-foreground' };
  return (
    <Badge className={`text-[10px] font-semibold px-2 gap-1 ${s.className}`}>
      {s.icon}{s.label}
    </Badge>
  );
}

// ─── Transfer Detail Dialog ─────────────────────────────────

function TransferDetailDialog({
  transfer,
  open,
  onOpenChange,
  stores,
}: {
  transfer: StoreTransferItem | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  stores: StoreInfo[];
}) {
  const queryClient = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      storeTransfersApi.update(id, data),
    onSuccess: (_, vars) => {
      const action = vars.data.action;
      toast.success(`Transfer ${action || 'updated'} successfully`);
      queryClient.invalidateQueries({ queryKey: ['store-transfers'] });
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to update transfer'),
  });

  if (!transfer) return null;

  const fromStore = transfer.fromStore || stores.find(s => s.id === transfer.fromStoreId);
  const toStore = transfer.toStore || stores.find(s => s.id === transfer.toStoreId);

  const handleAction = (action: string) => {
    updateMutation.mutate({ id: transfer.id, data: { action } });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowUpDown className="h-5 w-5 text-blue-500" />
            Transfer {transfer.transferNumber}
          </DialogTitle>
          <DialogDescription>Inter-store stock transfer details</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* Route */}
          <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
            <div className="flex-1 text-center">
              <MapPin className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
              <p className="text-sm font-medium">{fromStore?.name || 'Unknown'}</p>
              <p className="text-xs text-muted-foreground">From</p>
            </div>
            <ArrowRight className="h-5 w-5 text-muted-foreground shrink-0" />
            <div className="flex-1 text-center">
              <MapPin className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
              <p className="text-sm font-medium">{toStore?.name || 'Unknown'}</p>
              <p className="text-xs text-muted-foreground">To</p>
            </div>
          </div>

          {/* Info Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Status</p>
              <div className="mt-1">{transferStatusBadge(transfer.status)}</div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Items</p>
              <p className="font-medium mt-1">{transfer.items?.length || 0}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Requested By</p>
              <p className="font-medium mt-1">{transfer.requestedBy || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Created</p>
              <p className="font-medium mt-1">{formatDateTime(transfer.createdAt)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Shipped</p>
              <p className="font-medium mt-1">{transfer.shippedAt ? formatDateTime(transfer.shippedAt) : '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Received</p>
              <p className="font-medium mt-1">{transfer.receivedAt ? formatDateTime(transfer.receivedAt) : '—'}</p>
            </div>
          </div>

          {transfer.notes && (
            <div>
              <p className="text-xs text-muted-foreground">Notes</p>
              <p className="text-sm mt-1">{transfer.notes}</p>
            </div>
          )}

          {/* Items Table */}
          {transfer.items && transfer.items.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Transfer Items</p>
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Product</TableHead>
                      <TableHead className="text-xs">SKU</TableHead>
                      <TableHead className="text-xs text-right">Qty</TableHead>
                      <TableHead className="text-xs text-right">Received</TableHead>
                      <TableHead className="text-xs">Unit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transfer.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="text-xs font-medium py-2">
                          {item.product?.name || 'Unknown'}
                        </TableCell>
                        <TableCell className="text-xs py-2 font-mono text-muted-foreground">
                          {item.product?.sku || '—'}
                        </TableCell>
                        <TableCell className="text-xs py-2 text-right">{item.quantity}</TableCell>
                        <TableCell className="text-xs py-2 text-right">{item.receivedQty}</TableCell>
                        <TableCell className="text-xs py-2">{item.unitType}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </div>
          )}

          {/* Action Buttons */}
          <Separator />
          <div className="flex flex-wrap gap-2">
            {transfer.status === 'PENDING' && (
              <>
                <Button
                  size="sm"
                  className="h-9 bg-blue-600 hover:bg-blue-700"
                  onClick={() => handleAction('approve')}
                  disabled={updateMutation.isPending}
                >
                  {updateMutation.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
                  Approve & Ship
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-9"
                  onClick={() => handleAction('cancel')}
                  disabled={updateMutation.isPending}
                >
                  <X className="mr-1.5 h-4 w-4" /> Cancel
                </Button>
              </>
            )}
            {transfer.status === 'IN_TRANSIT' && (
              <Button
                size="sm"
                className="h-9 bg-green-600 hover:bg-green-700"
                onClick={() => handleAction('receive')}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-1.5 h-4 w-4" />}
                Mark Received
              </Button>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ─────────────────────────────────────────

export default function TransfersTab() {
  const currentStoreId = useAppStore((s) => s.currentStoreId);
  const queryClient = useQueryClient();
  const [innerTab, setInnerTab] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [fromStoreFilter, setFromStoreFilter] = useState('all');
  const [toStoreFilter, setToStoreFilter] = useState('all');
  const [selectedTransfer, setSelectedTransfer] = useState<StoreTransferItem | null>(null);

  // Create transfer form state
  const [fromStoreId, setFromStoreId] = useState('');
  const [toStoreId, setToStoreId] = useState('');
  const [transferNotes, setTransferNotes] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [transferItems, setTransferItems] = useState<{ productId: string; name: string; sku: string; quantity: number; unitType: string }[]>([]);

  // Fetch transfers
  const { data: transfersData, isLoading: transfersLoading } = useQuery({
    queryKey: ['store-transfers', currentStoreId, statusFilter, fromStoreFilter, toStoreFilter],
    queryFn: () => storeTransfersApi.list({
      storeId: currentStoreId,
      status: statusFilter !== 'all' ? statusFilter : undefined,
      fromStoreId: fromStoreFilter !== 'all' ? fromStoreFilter : undefined,
      toStoreId: toStoreFilter !== 'all' ? toStoreFilter : undefined,
      limit: 100,
    }),
    enabled: !!currentStoreId,
  });

  // Fetch stores (for from/to selection)
  const { data: storesData } = useQuery({
    queryKey: ['stores'],
    queryFn: async () => {
      const res = await fetch('/api/stores');
      const json = await res.json();
      return json.data as StoreInfo[];
    },
  });

  // Product search for create transfer
  const { data: productSearchData, isLoading: productSearchLoading } = useQuery({
    queryKey: ['product-search', productSearch],
    queryFn: () => productsApi.search(productSearch, currentStoreId),
    enabled: productSearch.length >= 2,
  });

  const transfers: StoreTransferItem[] = Array.isArray(transfersData?.data) ? transfersData.data : [];
  const stores: StoreInfo[] = storesData || [];
  const searchResults = Array.isArray(productSearchData?.data) ? productSearchData.data : [];

  // Stats
  const pendingCount = useMemo(() => transfers.filter(t => t.status === 'PENDING').length, [transfers]);
  const inTransitCount = useMemo(() => transfers.filter(t => t.status === 'IN_TRANSIT').length, [transfers]);
  const completedThisMonth = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    return transfers.filter(t => t.status === 'RECEIVED' && new Date(t.receivedAt || t.updatedAt) >= monthStart).length;
  }, [transfers]);
  const totalItemsTransferred = useMemo(() =>
    transfers.filter(t => t.status === 'RECEIVED').reduce((s, t) => s + (t.items?.length || 0), 0),
    [transfers]
  );

  // Add product to transfer items
  const addProduct = (product: { id: string; name: string; sku: string; unitType: string }) => {
    if (transferItems.find(i => i.productId === product.id)) {
      toast.error('Product already added');
      return;
    }
    setTransferItems([...transferItems, {
      productId: product.id,
      name: product.name,
      sku: product.sku,
      quantity: 1,
      unitType: product.unitType,
    }]);
    setProductSearch('');
  };

  const removeProduct = (productId: string) => {
    setTransferItems(transferItems.filter(i => i.productId !== productId));
  };

  const updateQuantity = (productId: string, qty: number) => {
    if (qty < 1) return;
    setTransferItems(transferItems.map(i => i.productId === productId ? { ...i, quantity: qty } : i));
  };

  // Create transfer mutation
  const createMutation = useMutation({
    mutationFn: (data: Parameters<typeof storeTransfersApi.create>[0]) => storeTransfersApi.create(data),
    onSuccess: () => {
      toast.success('Transfer created successfully');
      queryClient.invalidateQueries({ queryKey: ['store-transfers'] });
      // Reset form
      setFromStoreId('');
      setToStoreId('');
      setTransferNotes('');
      setTransferItems([]);
      setInnerTab('all');
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to create transfer'),
  });

  const handleCreateTransfer = () => {
    if (!fromStoreId) { toast.error('Select source store'); return; }
    if (!toStoreId) { toast.error('Select destination store'); return; }
    if (fromStoreId === toStoreId) { toast.error('Source and destination must be different'); return; }
    if (transferItems.length === 0) { toast.error('Add at least one product'); return; }
    if (transferItems.some(i => i.quantity < 1)) { toast.error('All quantities must be at least 1'); return; }

    createMutation.mutate({
      fromStoreId,
      toStoreId,
      notes: transferNotes.trim() || undefined,
      items: transferItems.map(i => ({
        productId: i.productId,
        quantity: i.quantity,
        unitType: i.unitType,
      })),
    });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Store Transfers</h2>
          <p className="text-sm text-muted-foreground">Inter-branch stock transfers and tracking</p>
        </div>
        <Button size="sm" className="h-8 bg-blue-600 hover:bg-blue-700" onClick={() => setInnerTab('create')}>
          <Plus className="mr-1.5 h-4 w-4" /> New Transfer
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { title: 'Pending Transfers', value: pendingCount.toString(), icon: Clock, color: 'text-amber-600' },
          { title: 'In Transit', value: inTransitCount.toString(), icon: Truck, color: 'text-blue-600' },
          { title: 'Completed This Month', value: completedThisMonth.toString(), icon: CheckCircle, color: 'text-green-600' },
          { title: 'Total Items Transferred', value: totalItemsTransferred.toString(), icon: Package, color: 'text-purple-600' },
        ].map((stat) => (
          <Card key={stat.title}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{stat.title}</p>
                  <p className="text-lg font-bold mt-1">{stat.value}</p>
                </div>
                <stat.icon className={`h-8 w-8 ${stat.color} opacity-20`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Inner Tabs */}
      <Tabs value={innerTab} onValueChange={setInnerTab}>
        <TabsList>
          <TabsTrigger value="all"><ArrowUpDown className="mr-1.5 h-4 w-4" />All Transfers</TabsTrigger>
          <TabsTrigger value="create"><Plus className="mr-1.5 h-4 w-4" />Create Transfer</TabsTrigger>
        </TabsList>

        {/* ── All Transfers ───────────────────────────── */}
        <TabsContent value="all" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px] h-9 text-xs">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="IN_TRANSIT">In Transit</SelectItem>
                <SelectItem value="RECEIVED">Received</SelectItem>
                <SelectItem value="CANCELLED">Cancelled</SelectItem>
                <SelectItem value="PARTIAL">Partial</SelectItem>
              </SelectContent>
            </Select>
            <Select value={fromStoreFilter} onValueChange={setFromStoreFilter}>
              <SelectTrigger className="w-[150px] h-9 text-xs">
                <SelectValue placeholder="From Store" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stores</SelectItem>
                {stores.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={toStoreFilter} onValueChange={setToStoreFilter}>
              <SelectTrigger className="w-[150px] h-9 text-xs">
                <SelectValue placeholder="To Store" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stores</SelectItem>
                {stores.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {transfersLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : transfers.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <ArrowUpDown className="h-10 w-10 mx-auto text-muted-foreground/40" />
                <p className="mt-2 text-sm text-muted-foreground">No transfers found</p>
                <Button size="sm" variant="outline" className="mt-3" onClick={() => setInnerTab('create')}>
                  <Plus className="mr-1.5 h-4 w-4" /> Create First Transfer
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Transfer #</TableHead>
                    <TableHead className="text-xs">From</TableHead>
                    <TableHead className="text-xs">To</TableHead>
                    <TableHead className="text-xs text-center">Items</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs">Requested By</TableHead>
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-xs w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transfers.map((t) => {
                    const from = t.fromStore?.name || stores.find(s => s.id === t.fromStoreId)?.name || '—';
                    const to = t.toStore?.name || stores.find(s => s.id === t.toStoreId)?.name || '—';
                    return (
                      <TableRow key={t.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedTransfer(t)}>
                        <TableCell className="text-xs font-mono font-medium py-3">{t.transferNumber}</TableCell>
                        <TableCell className="text-xs py-3">
                          <div className="flex items-center gap-1.5">
                            <Store className="h-3 w-3 text-muted-foreground" />
                            {from}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs py-3">
                          <div className="flex items-center gap-1.5">
                            <ArrowRight className="h-3 w-3 text-muted-foreground" />
                            {to}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs py-3 text-center">
                          <Badge variant="secondary" className="text-[10px] px-1.5">{t.items?.length || 0}</Badge>
                        </TableCell>
                        <TableCell className="py-3">{transferStatusBadge(t.status)}</TableCell>
                        <TableCell className="text-xs py-3">{t.requestedBy || '—'}</TableCell>
                        <TableCell className="text-xs py-3">{formatDate(t.createdAt)}</TableCell>
                        <TableCell className="py-3">
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setSelectedTransfer(t)}>
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        {/* ── Create Transfer ─────────────────────────── */}
        <TabsContent value="create" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Create New Transfer</CardTitle>
              <CardDescription>Transfer stock between stores</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Store Selection */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>From Store (Source)</Label>
                  <Select value={fromStoreId} onValueChange={setFromStoreId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select source store" />
                    </SelectTrigger>
                    <SelectContent>
                      {stores.map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.name} {s.location ? `— ${s.location}` : ''}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>To Store (Destination)</Label>
                  <Select value={toStoreId} onValueChange={setToStoreId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select destination store" />
                    </SelectTrigger>
                    <SelectContent>
                      {stores.filter(s => s.id !== fromStoreId).map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.name} {s.location ? `— ${s.location}` : ''}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Separator />

              {/* Product Search */}
              <div className="space-y-2">
                <Label>Add Products</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-9 h-9"
                    placeholder="Search products by name or SKU..."
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                  />
                </div>
                {/* Search Results Dropdown */}
                {productSearch.length >= 2 && (
                  <div className="border rounded-md max-h-48 overflow-y-auto bg-background shadow-sm">
                    {productSearchLoading ? (
                      <div className="p-3 text-center">
                        <Loader2 className="h-4 w-4 animate-spin mx-auto text-muted-foreground" />
                      </div>
                    ) : searchResults.length === 0 ? (
                      <div className="p-3 text-center text-xs text-muted-foreground">No products found</div>
                    ) : (
                      searchResults
                        .filter(p => !transferItems.find(i => i.productId === p.id))
                        .slice(0, 10)
                        .map(product => (
                          <button
                            key={product.id}
                            className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors flex items-center justify-between"
                            onClick={() => addProduct({
                              id: product.id,
                              name: product.name,
                              sku: product.sku,
                              unitType: product.unitType,
                            })}
                          >
                            <div>
                              <p className="text-sm font-medium">{product.name}</p>
                              <p className="text-xs text-muted-foreground font-mono">{product.sku}</p>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Stock: {product.quantityInStock} · {formatKES(product.pricePerUnit)}
                            </div>
                          </button>
                        ))
                    )}
                  </div>
                )}
              </div>

              {/* Transfer Items List */}
              {transferItems.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Items to Transfer ({transferItems.length})</p>
                  <div className="border rounded-md divide-y">
                    {transferItems.map(item => (
                      <div key={item.productId} className="flex items-center gap-3 px-3 py-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{item.name}</p>
                          <p className="text-xs text-muted-foreground font-mono">{item.sku}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 w-7 p-0"
                            onClick={() => updateQuantity(item.productId, item.quantity - 1)}
                          >
                            -
                          </Button>
                          <Input
                            type="number"
                            min={1}
                            value={item.quantity}
                            onChange={(e) => updateQuantity(item.productId, parseInt(e.target.value) || 1)}
                            className="w-16 h-7 text-center text-sm"
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 w-7 p-0"
                            onClick={() => updateQuantity(item.productId, item.quantity + 1)}
                          >
                            +
                          </Button>
                          <span className="text-xs text-muted-foreground w-12">{item.unitType}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                            onClick={() => removeProduct(item.productId)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">Total items: {transferItems.reduce((s, i) => s + i.quantity, 0)}</p>
                </div>
              )}

              <Separator />

              {/* Notes */}
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  value={transferNotes}
                  onChange={(e) => setTransferNotes(e.target.value)}
                  placeholder="Optional transfer notes..."
                  rows={2}
                />
              </div>

              {/* Submit */}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setInnerTab('all')}>Cancel</Button>
                <Button
                  className="bg-blue-600 hover:bg-blue-700"
                  onClick={handleCreateTransfer}
                  disabled={createMutation.isPending || !fromStoreId || !toStoreId || transferItems.length === 0}
                >
                  {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  <Send className="mr-2 h-4 w-4" />
                  Submit Transfer
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Transfer Detail Dialog */}
      <TransferDetailDialog
        transfer={selectedTransfer}
        open={!!selectedTransfer}
        onOpenChange={(v) => { if (!v) setSelectedTransfer(null); }}
        stores={stores}
      />
    </div>
  );
}
