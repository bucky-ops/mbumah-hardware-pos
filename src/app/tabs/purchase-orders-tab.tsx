'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ClipboardList, Search, Plus, Eye, Loader2, X,
  Package, CalendarDays, Filter, ArrowUpDown,
  FileText, Clock, CheckCircle2, Circle, AlertTriangle,
  Truck, ChevronLeft, Trash2, Send, Ban,
  MoreHorizontal,
  PackageCheck, PackageX, ShieldCheck, Stamp,
  Receipt, ShoppingBag, DollarSign,
} from 'lucide-react';

import { useAppStore } from '@/lib/stores';
import { useAuthStore } from '@/lib/stores';
import {
  purchaseOrdersApi, suppliersApi, productsApi,
  formatKES, formatDate,
  type PurchaseOrderListItem,
  type SupplierItem,
  type ProductListItem,
} from '@/lib/api';
import { handleError } from '@/lib/error-handler';
import { ResponsiveDialog } from '@/components/ui/responsive-dialog';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// ─── Constants ──────────────────────────────────────────────

const PO_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'SENT',
  'CONFIRMED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
] as const;

const VAT_RATE = 0.16;

const STATUS_FLOW: string[] = [
  'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'CONFIRMED', 'PARTIALLY_RECEIVED', 'RECEIVED',
];

// ─── Helper: status badge styling ──────────────────────────

function getStatusBadgeClasses(status: string): string {
  switch (status) {
    case 'DRAFT':
      return 'bg-gray-100 text-gray-700 dark:bg-gray-800/50 dark:text-gray-300';
    case 'PENDING_APPROVAL':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
    case 'APPROVED':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
    case 'SENT':
      return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300';
    case 'CONFIRMED':
      return 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300';
    case 'PARTIALLY_RECEIVED':
      return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300';
    case 'RECEIVED':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300';
    case 'CANCELLED':
      return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'DRAFT': return <FileText className="h-3 w-3" />;
    case 'PENDING_APPROVAL': return <Clock className="h-3 w-3" />;
    case 'APPROVED': return <ShieldCheck className="h-3 w-3" />;
    case 'SENT': return <Send className="h-3 w-3" />;
    case 'CONFIRMED': return <Stamp className="h-3 w-3" />;
    case 'PARTIALLY_RECEIVED': return <PackageCheck className="h-3 w-3" />;
    case 'RECEIVED': return <CheckCircle2 className="h-3 w-3" />;
    case 'CANCELLED': return <Ban className="h-3 w-3" />;
    default: return <Circle className="h-3 w-3" />;
  }
}

function formatStatusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

// ─── Sub-components ─────────────────────────────────────────

function POStatusTimeline({ status }: { status: string }) {
  const isCancelled = status === 'CANCELLED';

  const getStepStatus = (step: string): 'completed' | 'current' | 'upcoming' => {
    if (isCancelled) return 'upcoming';
    const stepIdx = STATUS_FLOW.indexOf(step);
    const currentIdx = STATUS_FLOW.indexOf(status);
    if (stepIdx < currentIdx) return 'completed';
    if (stepIdx === currentIdx) return 'current';
    return 'upcoming';
  };

  const displaySteps = STATUS_FLOW.filter(
    (s) => s !== 'PARTIALLY_RECEIVED' || status === 'PARTIALLY_RECEIVED'
  );

  return (
    <div className="w-full">
      <div className="flex items-center justify-between gap-0">
        {displaySteps.map((step, i) => {
          const stepStatus = getStepStatus(step);
          return (
            <React.Fragment key={step}>
              {i > 0 && (
                <div className="flex-1 h-0.5 mx-0.5">
                  <div
                    className={`h-full rounded-full transition-colors ${
                      stepStatus === 'completed' ? 'bg-green-400' : 'bg-muted-foreground/20'
                    }`}
                  />
                </div>
              )}
              <div className="flex flex-col items-center shrink-0" title={formatStatusLabel(step)}>
                {stepStatus === 'current' ? (
                  <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center shadow-md">
                    <div className="w-2 h-2 rounded-full bg-white" />
                  </div>
                ) : stepStatus === 'completed' ? (
                  <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                    <CheckCircle2 className="w-4 h-4 text-white" />
                  </div>
                ) : (
                  <div className="w-6 h-6 rounded-full border-2 border-muted-foreground/25 flex items-center justify-center">
                    <Circle className="w-3 h-3 text-muted-foreground/30" />
                  </div>
                )}
                <span
                  className={`text-[9px] mt-1 whitespace-nowrap ${
                    stepStatus === 'current'
                      ? 'text-primary font-bold'
                      : stepStatus === 'completed'
                        ? 'text-green-600 font-medium'
                        : 'text-muted-foreground/40'
                  }`}
                >
                  {formatStatusLabel(step)}
                </span>
              </div>
            </React.Fragment>
          );
        })}
      </div>
      {isCancelled && (
        <div className="flex items-center justify-center mt-3">
          <Badge className="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 gap-1">
            <Ban className="h-3 w-3" /> CANCELLED
          </Badge>
        </div>
      )}
    </div>
  );
}

// ─── Create PO Dialog ──────────────────────────────────────

function CreatePODialog({
  open,
  onOpenChange,
  storeId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
}) {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const [supplierId, setSupplierId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [poItems, setPoItems] = useState<
    { productId: string; name: string; sku: string; quantity: string; unitCost: string; currentStock: number }[]
  >([]);
  const [productSearch, setProductSearch] = useState('');
  const [lowStockLoading, setLowStockLoading] = useState(false);

  // Fetch active suppliers
  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers-list', storeId],
    queryFn: () => suppliersApi.list({ storeId, isActive: 'true', limit: 200 }),
    enabled: open,
  });
  const suppliers: SupplierItem[] = Array.isArray(suppliersData?.data) ? suppliersData.data : [];

  // Product search
  const { data: productSearchData, isLoading: productSearchLoading } = useQuery({
    queryKey: ['po-product-search', storeId, productSearch],
    queryFn: () => productsApi.search(productSearch, storeId),
    enabled: open && productSearch.length >= 2,
  });
  const searchResults: ProductListItem[] = Array.isArray(productSearchData?.data)
    ? productSearchData.data
    : [];

  const addProductFromSearch = (product: ProductListItem) => {
    if (poItems.find((i) => i.productId === product.id)) {
      toast.error('Product already added');
      return;
    }
    setPoItems([
      ...poItems,
      {
        productId: product.id,
        name: product.name,
        sku: product.sku,
        quantity: '1',
        unitCost: String(product.costPrice),
        currentStock: product.quantityInStock,
      },
    ]);
    setProductSearch('');
  };

  const addLowStockItems = async () => {
    setLowStockLoading(true);
    try {
      const res = await productsApi.list({ storeId, limit: 200 });
      const allProducts: ProductListItem[] = Array.isArray(res?.data) ? res.data : [];
      const lowStockProducts = allProducts.filter(
        (p) => p.isActive && p.quantityInStock <= p.reorderLevel && !poItems.find((i) => i.productId === p.id)
      );
      if (lowStockProducts.length === 0) {
        toast.info('No low-stock products found');
        return;
      }
      const newItems = lowStockProducts.map((p) => ({
        productId: p.id,
        name: p.name,
        sku: p.sku,
        quantity: String(Math.max(Math.ceil(p.reorderLevel * 2 - p.quantityInStock), 1)),
        unitCost: String(p.costPrice),
        currentStock: p.quantityInStock,
      }));
      setPoItems([...poItems, ...newItems]);
      toast.success(`Added ${newItems.length} low-stock item${newItems.length > 1 ? 's' : ''}`);
    } catch (_err) {
      toast.error('Failed to load low-stock products');
    } finally {
      setLowStockLoading(false);
    }
  };

  const removeItem = (index: number) => {
    setPoItems(poItems.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, field: 'quantity' | 'unitCost', value: string) => {
    const updated = [...poItems];
    updated[index] = { ...updated[index], [field]: value };
    setPoItems(updated);
  };

  const subTotal = poItems.reduce(
    (sum, item) => sum + (parseFloat(item.quantity) || 0) * (parseFloat(item.unitCost) || 0),
    0
  );
  const taxAmount = subTotal * VAT_RATE;
  const totalAmount = subTotal + taxAmount;

  const createMutation = useMutation({
    mutationFn: () =>
      purchaseOrdersApi.create({
        storeId,
        supplierId,
        expectedDate: expectedDate || undefined,
        notes: notes || undefined,
        createdById: user?.id || undefined,
        items: poItems
          .filter((item) => item.productId && parseFloat(item.quantity) > 0)
          .map((item) => ({
            productId: item.productId,
            quantity: parseFloat(item.quantity),
            unitCost: parseFloat(item.unitCost),
          })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      toast.success('Purchase order created successfully');
      onOpenChange(false);
      resetForm();
    },
    onError: (err: unknown) => {
      const msg = handleError(err, 'Create purchase order');
      toast.error(msg);
    },
  });

  const resetForm = () => {
    setSupplierId('');
    setExpectedDate('');
    setNotes('');
    setPoItems([]);
    setProductSearch('');
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) resetForm();
    onOpenChange(nextOpen);
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Create Purchase Order"
      description="Create a new purchase order for a supplier"
      size="xl"
      footer={
        <>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!supplierId || poItems.length === 0 || createMutation.isPending}
          >
            {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create PO
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* Supplier & Date */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Supplier *</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger>
                <SelectValue placeholder="Select supplier" />
              </SelectTrigger>
              <SelectContent>
                {suppliers
                  .filter((s) => s.isActive)
                  .map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Expected Delivery Date</Label>
            <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
          </div>
        </div>

        <Separator />

        {/* Product Search */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Add Products</Label>
            <Button type="button" variant="outline" size="sm" onClick={addLowStockItems} disabled={lowStockLoading}>
              {lowStockLoading ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5 mr-1 text-amber-600" />
              )}
              Add Low Stock Items
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9 h-9"
              placeholder="Search products by name or SKU..."
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
            />
          </div>
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
                  .filter((p) => !poItems.find((i) => i.productId === p.id))
                  .slice(0, 10)
                  .map((product) => (
                    <button
                      key={product.id}
                      className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors flex items-center justify-between"
                      onClick={() => addProductFromSearch(product)}
                    >
                      <div>
                        <p className="text-sm font-medium">{product.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{product.sku}</p>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Stock: {product.quantityInStock} &middot; {formatKES(product.costPrice)}
                      </div>
                    </button>
                  ))
              )}
            </div>
          )}
        </div>

        {/* Items List */}
        {poItems.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              Order Items ({poItems.length}) &middot; Total Qty:{' '}
              {poItems.reduce((s, i) => s + (parseFloat(i.quantity) || 0), 0)}
            </p>
            <div className="border rounded-md divide-y max-h-60 overflow-y-auto">
              {poItems.map((item, index) => (
                <div key={item.productId || index} className="flex items-center gap-3 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.name || 'Unknown'}</p>
                    <p className="text-xs text-muted-foreground font-mono">
                      {item.sku}
                      {item.currentStock !== undefined && (
                        <span className="ml-2 text-amber-600">
                          <Package className="h-3 w-3 inline mr-0.5" />
                          {item.currentStock} in stock
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="w-16">
                      <Label className="text-[10px] text-muted-foreground">Qty</Label>
                      <Input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(e) => updateItem(index, 'quantity', e.target.value)}
                        className="h-7 text-xs text-center"
                      />
                    </div>
                    <div className="w-24">
                      <Label className="text-[10px] text-muted-foreground">Unit Cost</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.unitCost}
                        onChange={(e) => updateItem(index, 'unitCost', e.target.value)}
                        className="h-7 text-xs text-center"
                      />
                    </div>
                    <div className="text-right w-20">
                      <Label className="text-[10px] text-muted-foreground">Total</Label>
                      <p className="text-xs font-medium">
                        {formatKES((parseFloat(item.quantity) || 0) * (parseFloat(item.unitCost) || 0))}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50 shrink-0"
                      onClick={() => removeItem(index)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          productSearch.length < 2 && (
            <div className="text-center py-6 text-muted-foreground border rounded-md border-dashed">
              <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Search for products above or add low-stock items</p>
            </div>
          )
        )}

        {/* Totals */}
        {poItems.length > 0 && (
          <div className="space-y-1.5 p-3 bg-muted/30 rounded-lg border text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-medium">{formatKES(subTotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">VAT (16%)</span>
              <span className="font-medium">{formatKES(taxAmount)}</span>
            </div>
            <Separator />
            <div className="flex justify-between text-base font-bold">
              <span>Total</span>
              <span>{formatKES(totalAmount)}</span>
            </div>
          </div>
        )}

        {/* Notes */}
        <div className="space-y-2">
          <Label>Notes</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Order notes..."
            rows={2}
          />
        </div>
      </div>
    </ResponsiveDialog>
  );
}

// ─── Receive Items Dialog ──────────────────────────────────

function ReceiveItemsDialog({
  open,
  onOpenChange,
  purchaseOrder,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  purchaseOrder: PurchaseOrderListItem | null;
}) {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [receivedQtys, setReceivedQtys] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    if (purchaseOrder?.items && open) {
      const initial: Record<string, string> = {};
      purchaseOrder.items.forEach((item) => {
        const remaining = item.quantity - item.receivedQty;
        initial[item.id] = remaining > 0 ? String(remaining) : '0';
      });
      setReceivedQtys(initial);
      setError(null);
    }
  }, [purchaseOrder, open]);

  const receiveMutation = useMutation({
    mutationFn: () => {
      if (!purchaseOrder) throw new Error('No PO selected');
      const receivedItems = Object.entries(receivedQtys)
        .filter(([, qty]) => parseFloat(qty) > 0)
        .map(([itemId, qty]) => ({ itemId, receivedQty: parseFloat(qty) }));
      if (receivedItems.length === 0) throw new Error('No items to receive');
      return purchaseOrdersApi.receiveItems(
        purchaseOrder.id,
        receivedItems,
        user?.id || undefined
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-order-detail'] });
      toast.success('Items received and stock updated');
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      const msg = handleError(err, 'Receive PO items');
      toast.error(msg);
    },
  });

  const validateAndSubmit = () => {
    if (!purchaseOrder?.items) return;
    setError(null);

    for (const item of purchaseOrder.items) {
      const qty = parseFloat(receivedQtys[item.id] || '0');
      const remaining = item.quantity - item.receivedQty;
      if (qty > remaining) {
        setError(`Cannot receive more than remaining quantity for ${item.productName || 'item'}`);
        return;
      }
      if (qty < 0) {
        setError(`Quantity cannot be negative for ${item.productName || 'item'}`);
        return;
      }
    }

    receiveMutation.mutate();
  };

  if (!purchaseOrder?.items) return null;

  const totalBeingReceived = Object.values(receivedQtys).reduce(
    (sum, qty) => sum + (parseFloat(qty) || 0),
    0
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageCheck className="h-5 w-5 text-emerald-600" />
            Receive Items — {purchaseOrder.poNumber}
          </DialogTitle>
          <DialogDescription>
            Enter quantities received for each item. Stock will be updated automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 max-h-80 overflow-y-auto">
          {purchaseOrder.items.map((item) => {
            const remaining = item.quantity - item.receivedQty;
            const product = item.product;
            const currentVal = parseFloat(receivedQtys[item.id] || '0');
            const isOver = currentVal > remaining;
            return (
              <div
                key={item.id}
                className={`flex items-center gap-3 border rounded-lg p-3 transition-colors ${
                  isOver ? 'border-red-300 bg-red-50/50 dark:border-red-800 dark:bg-red-900/20' : ''
                }`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{product?.name || item.productName || 'Unknown'}</p>
                  <p className="text-xs text-muted-foreground">
                    <span>Ordered: {item.quantity}</span>
                    <span className="mx-1">&middot;</span>
                    <span>Received: {item.receivedQty}</span>
                    <span className="mx-1">&middot;</span>
                    <span className={remaining > 0 ? 'text-amber-600 font-medium' : 'text-green-600'}>
                      Remaining: {remaining}
                    </span>
                  </p>
                </div>
                <div className="w-28 space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Receiving Now</Label>
                  <Input
                    type="number"
                    min="0"
                    max={remaining}
                    value={receivedQtys[item.id] || '0'}
                    onChange={(e) =>
                      setReceivedQtys({ ...receivedQtys, [item.id]: e.target.value })
                    }
                    className={`h-9 text-sm ${isOver ? 'border-red-400 focus-visible:ring-red-400' : ''}`}
                    disabled={remaining <= 0}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {error && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 p-2 rounded-md">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="flex items-center justify-between text-sm pt-2 border-t">
          <span className="text-muted-foreground">Total items being received</span>
          <span className="font-bold text-lg">{totalBeingReceived}</span>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={validateAndSubmit} disabled={receiveMutation.isPending || totalBeingReceived === 0}>
            {receiveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Receive Items
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── PO Detail View ────────────────────────────────────────

function PODetailView({
  po,
  open,
  onOpenChange,
}: {
  po: PurchaseOrderListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    action: string;
    label: string;
    description: string;
  } | null>(null);

  // Fetch fresh detail
  const { data: detailData, isLoading: detailLoading } = useQuery({
    queryKey: ['purchase-order-detail', po?.id],
    queryFn: () => purchaseOrdersApi.get(po!.id),
    enabled: open && !!po?.id,
  });
  const detail: PurchaseOrderListItem | null = detailData?.data ?? po;

  const statusMutation = useMutation({
    mutationFn: ({ status, extra }: { status: string; extra?: Record<string, string> }) =>
      purchaseOrdersApi.updateStatus(po!.id, status, extra),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-order-detail', po?.id] });
      toast.success(`PO status updated to ${formatStatusLabel(variables.status)}`);
      setConfirmAction(null);
    },
    onError: (err: unknown) => {
      const msg = handleError(err, 'Update PO status');
      toast.error(msg);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => purchaseOrdersApi.delete(po!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      toast.success('Purchase order deleted');
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      const msg = handleError(err, 'Delete purchase order');
      toast.error(msg);
    },
  });

  const handleStatusAction = (newStatus: string) => {
    const extra: Record<string, string> = {};
    if (newStatus === 'APPROVED') extra.approvedById = user?.id || '';
    if (newStatus === 'CANCELLED') extra.cancelledById = user?.id || '';
    statusMutation.mutate({ status: newStatus, extra });
  };

  const getAvailableActions = useCallback((): {
    key: string;
    label: string;
    icon: React.ReactNode;
    variant: 'default' | 'outline' | 'destructive';
    action: string;
    confirmDescription: string;
  }[] => {
    if (!detail) return [];
    const s = detail.status;
    switch (s) {
      case 'DRAFT':
        return [
          {
            key: 'submit',
            label: 'Submit for Approval',
            icon: <Send className="h-4 w-4" />,
            variant: 'default',
            action: 'PENDING_APPROVAL',
            confirmDescription: 'Submit this PO for approval? It will no longer be editable.',
          },
          {
            key: 'cancel',
            label: 'Cancel',
            icon: <Ban className="h-4 w-4" />,
            variant: 'destructive',
            action: 'CANCELLED',
            confirmDescription: 'Are you sure you want to cancel this purchase order?',
          },
          {
            key: 'delete',
            label: 'Delete',
            icon: <Trash2 className="h-4 w-4" />,
            variant: 'destructive',
            action: 'DELETE',
            confirmDescription: 'Permanently delete this purchase order? This cannot be undone.',
          },
        ];
      case 'PENDING_APPROVAL':
        return [
          {
            key: 'approve',
            label: 'Approve',
            icon: <ShieldCheck className="h-4 w-4" />,
            variant: 'default',
            action: 'APPROVED',
            confirmDescription: 'Approve this purchase order?',
          },
          {
            key: 'sendback',
            label: 'Send Back to Draft',
            icon: <ChevronLeft className="h-4 w-4" />,
            variant: 'outline',
            action: 'DRAFT',
            confirmDescription: 'Send this PO back to draft for editing?',
          },
          {
            key: 'cancel',
            label: 'Cancel',
            icon: <Ban className="h-4 w-4" />,
            variant: 'destructive',
            action: 'CANCELLED',
            confirmDescription: 'Are you sure you want to cancel this purchase order?',
          },
        ];
      case 'APPROVED':
        return [
          {
            key: 'send',
            label: 'Send to Supplier',
            icon: <Send className="h-4 w-4" />,
            variant: 'default',
            action: 'SENT',
            confirmDescription: 'Mark this PO as sent to the supplier?',
          },
          {
            key: 'cancel',
            label: 'Cancel',
            icon: <Ban className="h-4 w-4" />,
            variant: 'destructive',
            action: 'CANCELLED',
            confirmDescription: 'Are you sure you want to cancel this purchase order?',
          },
        ];
      case 'SENT':
        return [
          {
            key: 'confirm',
            label: 'Mark Confirmed',
            icon: <Stamp className="h-4 w-4" />,
            variant: 'default',
            action: 'CONFIRMED',
            confirmDescription: 'Mark this PO as confirmed by the supplier?',
          },
          {
            key: 'cancel',
            label: 'Cancel',
            icon: <Ban className="h-4 w-4" />,
            variant: 'destructive',
            action: 'CANCELLED',
            confirmDescription: 'Are you sure you want to cancel this purchase order?',
          },
        ];
      case 'CONFIRMED':
        return [
          {
            key: 'receive',
            label: 'Receive Items',
            icon: <PackageCheck className="h-4 w-4" />,
            variant: 'default',
            action: 'RECEIVE',
            confirmDescription: '',
          },
          {
            key: 'cancel',
            label: 'Cancel',
            icon: <Ban className="h-4 w-4" />,
            variant: 'destructive',
            action: 'CANCELLED',
            confirmDescription: 'Are you sure you want to cancel this purchase order?',
          },
        ];
      case 'PARTIALLY_RECEIVED':
        return [
          {
            key: 'receive',
            label: 'Receive Items',
            icon: <PackageCheck className="h-4 w-4" />,
            variant: 'default',
            action: 'RECEIVE',
            confirmDescription: '',
          },
          {
            key: 'complete',
            label: 'Mark Complete',
            icon: <CheckCircle2 className="h-4 w-4" />,
            variant: 'outline',
            action: 'RECEIVED',
            confirmDescription: 'Mark this PO as fully received?',
          },
        ];
      default:
        return [];
    }
  }, [detail]);

  if (!detail) return null;

  const actions = getAvailableActions();
  const isCancelled = detail.status === 'CANCELLED';
  const isReceived = detail.status === 'RECEIVED';

  // Calculate receiving progress
  const totalOrdered = detail.items?.reduce((s, i) => s + i.quantity, 0) ?? 0;
  const totalReceived = detail.items?.reduce((s, i) => s + i.receivedQty, 0) ?? 0;
  const receivePct = totalOrdered > 0 ? (totalReceived / totalOrdered) * 100 : 0;

  return (
    <>
      <ResponsiveDialog
        open={open}
        onOpenChange={onOpenChange}
        title={
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary" />
            {detail.poNumber}
          </div>
        }
        description={
          <div className="flex items-center gap-2 mt-1">
            <Badge className={`text-xs gap-1 ${getStatusBadgeClasses(detail.status)}`}>
              {getStatusIcon(detail.status)}
              {formatStatusLabel(detail.status)}
            </Badge>
            <span className="text-muted-foreground">&middot;</span>
            <span className="text-muted-foreground">{detail.supplier?.name || 'Unknown Supplier'}</span>
          </div>
        }
        size="xl"
      >
        {detailLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <div className="space-y-5">
            {/* Status Timeline */}
            <div className="p-4 bg-muted/30 rounded-lg border">
              <POStatusTimeline status={detail.status} />
            </div>

            {/* Receiving Progress (if applicable) */}
            {['CONFIRMED', 'PARTIALLY_RECEIVED', 'RECEIVED'].includes(detail.status) && detail.items && detail.items.length > 0 && (
              <div className="p-4 bg-muted/30 rounded-lg border space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Receiving Progress</span>
                  <span className="font-medium">
                    {totalReceived} / {totalOrdered} items
                  </span>
                </div>
                <Progress value={receivePct} className="h-2" />
              </div>
            )}

            {/* PO Info Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <InfoItem icon={<FileText className="h-4 w-4" />} label="PO Number" value={detail.poNumber} />
              <InfoItem icon={<ShoppingBag className="h-4 w-4" />} label="Supplier" value={detail.supplier?.name || '—'} />
              <InfoItem icon={<CalendarDays className="h-4 w-4" />} label="Order Date" value={formatDate(detail.orderDate)} />
              <InfoItem
                icon={<Truck className="h-4 w-4" />}
                label="Expected Date"
                value={detail.expectedDate ? formatDate(detail.expectedDate) : 'Not set'}
              />
              <InfoItem icon={<Receipt className="h-4 w-4" />} label="Total Amount" value={formatKES(detail.totalAmount)} />
              <InfoItem icon={<Package className="h-4 w-4" />} label="Items" value={`${detail.items?.length ?? detail.itemCount ?? 0} line items`} />
            </div>

            {/* Financial Summary */}
            <div className="p-3 bg-muted/30 rounded-lg border text-sm space-y-1.5">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatKES(detail.subTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tax (16% VAT)</span>
                <span>{formatKES(detail.taxAmount)}</span>
              </div>
              <Separator />
              <div className="flex justify-between font-bold text-base">
                <span>Total</span>
                <span>{formatKES(detail.totalAmount)}</span>
              </div>
            </div>

            {/* Audit Info */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              {detail.createdBy && (
                <div className="p-2 rounded-md bg-muted/20">
                  <span className="text-muted-foreground">Created by:</span>{' '}
                  <span className="font-medium">{detail.createdBy.name}</span>
                </div>
              )}
              {detail.approvedBy && (
                <div className="p-2 rounded-md bg-muted/20">
                  <span className="text-muted-foreground">Approved by:</span>{' '}
                  <span className="font-medium">{detail.approvedBy.name}</span>
                  {detail.approvedAt && (
                    <span className="text-muted-foreground ml-1">on {formatDate(detail.approvedAt)}</span>
                  )}
                </div>
              )}
              {detail.receivedBy && (
                <div className="p-2 rounded-md bg-muted/20">
                  <span className="text-muted-foreground">Received by:</span>{' '}
                  <span className="font-medium">{detail.receivedBy.name}</span>
                  {detail.receivedAt && (
                    <span className="text-muted-foreground ml-1">on {formatDate(detail.receivedAt)}</span>
                  )}
                </div>
              )}
              {detail.cancelledBy && (
                <div className="p-2 rounded-md bg-red-50 dark:bg-red-900/20">
                  <span className="text-red-600">Cancelled by:</span>{' '}
                  <span className="font-medium text-red-600">{detail.cancelledBy.name}</span>
                  {detail.cancelledAt && (
                    <span className="text-red-500 ml-1">on {formatDate(detail.cancelledAt)}</span>
                  )}
                </div>
              )}
            </div>

            {/* Notes */}
            {detail.notes && (
              <div className="p-3 bg-muted/30 rounded-lg border">
                <p className="text-xs text-muted-foreground mb-1">Notes</p>
                <p className="text-sm">{detail.notes}</p>
              </div>
            )}

            {/* Line Items Table */}
            <div>
              <h4 className="text-sm font-semibold mb-2">Line Items</h4>
              <div className="border rounded-md overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Product</TableHead>
                      <TableHead className="text-xs text-center">Qty Ordered</TableHead>
                      <TableHead className="text-xs text-right">Unit Cost</TableHead>
                      <TableHead className="text-xs text-right">Total</TableHead>
                      <TableHead className="text-xs text-center">Qty Received</TableHead>
                      <TableHead className="text-xs text-center">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.items?.map((item) => {
                      const itemReceivedPct =
                        item.quantity > 0 ? (item.receivedQty / item.quantity) * 100 : 0;
                      const itemStatus =
                        item.receivedQty >= item.quantity
                          ? 'Received'
                          : item.receivedQty > 0
                            ? 'Partial'
                            : 'Pending';
                      const itemStatusColor =
                        itemStatus === 'Received'
                          ? 'text-emerald-600'
                          : itemStatus === 'Partial'
                            ? 'text-amber-600'
                            : 'text-muted-foreground';

                      return (
                        <TableRow key={item.id}>
                          <TableCell>
                            <div>
                              <p className="text-sm font-medium">
                                {item.product?.name || item.productName || 'Unknown'}
                              </p>
                              {item.product?.sku && (
                                <p className="text-xs text-muted-foreground font-mono">{item.product.sku}</p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-center text-sm">{item.quantity}</TableCell>
                          <TableCell className="text-right text-sm">{formatKES(item.unitCost)}</TableCell>
                          <TableCell className="text-right text-sm font-medium">
                            {formatKES(item.totalCost)}
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex flex-col items-center gap-1">
                              <span className="text-sm">
                                {item.receivedQty}/{item.quantity}
                              </span>
                              <Progress value={itemReceivedPct} className="h-1 w-12" />
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <span className={`text-xs font-medium ${itemStatusColor}`}>{itemStatus}</span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* Action Buttons */}
            {!isCancelled && !isReceived && actions.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
                {actions.map((act) => {
                  if (act.action === 'RECEIVE') {
                    return (
                      <Button
                        key={act.key}
                        variant={act.variant}
                        onClick={() => setReceiveOpen(true)}
                      >
                        {act.icon}
                        <span className="ml-2">{act.label}</span>
                      </Button>
                    );
                  }
                  return (
                    <Button
                      key={act.key}
                      variant={act.variant === 'destructive' ? 'destructive' : act.variant}
                      onClick={() =>
                        setConfirmAction({
                          action: act.action,
                          label: act.label,
                          description: act.confirmDescription,
                        })
                      }
                      disabled={statusMutation.isPending || deleteMutation.isPending}
                    >
                      {act.icon}
                      <span className="ml-2">{act.label}</span>
                    </Button>
                  );
                })}
              </div>
            )}

            {/* Cancelled notice */}
            {isCancelled && (
              <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                <PackageX className="h-8 w-8 text-red-500 shrink-0" />
                <div>
                  <p className="font-semibold text-red-700 dark:text-red-400">Purchase Order Cancelled</p>
                  {detail.cancelledBy && (
                    <p className="text-sm text-red-600 dark:text-red-300">
                      By {detail.cancelledBy.name}
                      {detail.cancelledAt && ` on ${formatDate(detail.cancelledAt)}`}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </ResponsiveDialog>

      {/* Receive Items Dialog */}
      <ReceiveItemsDialog
        open={receiveOpen}
        onOpenChange={setReceiveOpen}
        purchaseOrder={detail}
      />

      {/* Confirm Action Dialog */}
      <Dialog
        open={!!confirmAction}
        onOpenChange={(v) => !v && setConfirmAction(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm Action</DialogTitle>
            <DialogDescription>{confirmAction?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)}>
              Cancel
            </Button>
            <Button
              variant={
                confirmAction?.action === 'CANCELLED' || confirmAction?.action === 'DELETE'
                  ? 'destructive'
                  : 'default'
              }
              disabled={statusMutation.isPending || deleteMutation.isPending}
              onClick={() => {
                if (!confirmAction) return;
                if (confirmAction.action === 'DELETE') {
                  deleteMutation.mutate();
                } else {
                  handleStatusAction(confirmAction.action);
                }
              }}
            >
              {statusMutation.isPending || deleteMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {confirmAction?.label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Info Item Helper ──────────────────────────────────────

function InfoItem({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2.5 p-2.5 bg-muted/20 rounded-lg">
      <div className="text-muted-foreground shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
        <p className="text-sm font-medium truncate">{value}</p>
      </div>
    </div>
  );
}

// ─── Summary Card ──────────────────────────────────────────

function SummaryCard({
  icon,
  label,
  value,
  subValue,
  iconBg,
  iconColor,
  borderLeftColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  subValue?: string;
  iconBg: string;
  iconColor: string;
  borderLeftColor: string;
}) {
  return (
    <Card className={`border-l-4 ${borderLeftColor} backdrop-blur-sm bg-card/80`}>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className={`h-10 w-10 rounded-lg ${iconBg} flex items-center justify-center shrink-0`}>
            <div className={iconColor}>{icon}</div>
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-xl font-bold truncate">{value}</p>
            {subValue && <p className="text-xs text-muted-foreground">{subValue}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Component ────────────────────────────────────────

export default function PurchaseOrdersTab() {
  const { currentStoreId } = useAppStore();
  const queryClient = useQueryClient();

  // State
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [supplierFilter, setSupplierFilter] = useState<string>('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [sortField, setSortField] = useState<'orderDate' | 'totalAmount' | 'status'>('orderDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [createOpen, setCreateOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrderListItem | null>(null);
  const [filtersVisible, setFiltersVisible] = useState(false);

  const limit = 20;
  const currentTime = useMemo(() => new Date().getTime(), []);

  // Fetch POs
  const { data: poData, isLoading: poLoading, isError: poError } = useQuery({
    queryKey: [
      'purchase-orders',
      currentStoreId,
      statusFilter,
      supplierFilter,
      dateFrom,
      dateTo,
      page,
    ],
    queryFn: () =>
      purchaseOrdersApi.list({
        storeId: currentStoreId,
        status: statusFilter !== 'ALL' ? statusFilter : undefined,
        supplierId: supplierFilter !== 'ALL' ? supplierFilter : undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        page,
        limit,
      }),
    enabled: !!currentStoreId,
  });

  const purchaseOrders: PurchaseOrderListItem[] = useMemo(
    () => (Array.isArray(poData?.data) ? poData.data : []),
    [poData]
  );
  const pagination = poData?.pagination;

  // Fetch suppliers for filter dropdown
  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers-list-po', currentStoreId],
    queryFn: () => suppliersApi.list({ storeId: currentStoreId, limit: 200 }),
    enabled: !!currentStoreId,
  });
  const suppliers: SupplierItem[] = Array.isArray(suppliersData?.data) ? suppliersData.data : [];

  // ── Derived summary stats ──
  const stats = useMemo(() => {
    const all = purchaseOrders;
    const totalPOs = all.length;
    const pendingApproval = all.filter((po) => po.status === 'PENDING_APPROVAL').length;
    const inTransit = all.filter((po) => po.status === 'SENT' || po.status === 'CONFIRMED').length;

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const receivedThisMonth = all.filter(
      (po) =>
        po.status === 'RECEIVED' &&
        po.receivedAt &&
        new Date(po.receivedAt).getTime() >= new Date(startOfMonth).getTime()
    ).length;

    const totalValue = all
      .filter((po) => po.status !== 'CANCELLED')
      .reduce((s, po) => s + po.totalAmount, 0);

    return { totalPOs, pendingApproval, inTransit, receivedThisMonth, totalValue };
  }, [purchaseOrders]);

  // ── Sort ──
  const sortedPOs = useMemo(() => {
    const filtered = search.trim()
      ? purchaseOrders.filter(
          (po) =>
            po.poNumber.toLowerCase().includes(search.toLowerCase()) ||
            po.supplier?.name?.toLowerCase().includes(search.toLowerCase())
        )
      : purchaseOrders;

    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'orderDate') {
        cmp = new Date(a.orderDate).getTime() - new Date(b.orderDate).getTime();
      } else if (sortField === 'totalAmount') {
        cmp = a.totalAmount - b.totalAmount;
      } else if (sortField === 'status') {
        cmp = a.status.localeCompare(b.status);
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
  }, [purchaseOrders, search, sortField, sortDir]);

  const toggleSort = (field: 'orderDate' | 'totalAmount' | 'status') => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const openDetail = (po: PurchaseOrderListItem) => {
    setSelectedPO(po);
    setDetailOpen(true);
  };

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('ALL');
    setSupplierFilter('ALL');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  };

  const hasActiveFilters =
    search || statusFilter !== 'ALL' || supplierFilter !== 'ALL' || dateFrom || dateTo;

  // ─── Render ────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* ── Overview Dashboard ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <SummaryCard
          icon={<ClipboardList className="h-5 w-5" />}
          label="Total POs"
          value={stats.totalPOs}
          iconBg="bg-blue-100 dark:bg-blue-900/30"
          iconColor="text-blue-600 dark:text-blue-400"
          borderLeftColor="border-l-blue-500"
        />
        <SummaryCard
          icon={<Clock className="h-5 w-5" />}
          label="Pending Approval"
          value={stats.pendingApproval}
          iconBg="bg-amber-100 dark:bg-amber-900/30"
          iconColor="text-amber-600 dark:text-amber-400"
          borderLeftColor="border-l-amber-500"
        />
        <SummaryCard
          icon={<Truck className="h-5 w-5" />}
          label="In Transit"
          value={stats.inTransit}
          subValue="SENT + CONFIRMED"
          iconBg="bg-cyan-100 dark:bg-cyan-900/30"
          iconColor="text-cyan-600 dark:text-cyan-400"
          borderLeftColor="border-l-cyan-500"
        />
        <SummaryCard
          icon={<PackageCheck className="h-5 w-5" />}
          label="Received (Month)"
          value={stats.receivedThisMonth}
          iconBg="bg-emerald-100 dark:bg-emerald-900/30"
          iconColor="text-emerald-600 dark:text-emerald-400"
          borderLeftColor="border-l-emerald-500"
        />
        <SummaryCard
          icon={<DollarSign className="h-5 w-5" />}
          label="Total Value"
          value={formatKES(stats.totalValue)}
          subValue="Excl. cancelled"
          iconBg="bg-purple-100 dark:bg-purple-900/30"
          iconColor="text-purple-600 dark:text-purple-400"
          borderLeftColor="border-l-purple-500"
        />
      </div>

      {/* ── Toolbar ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative flex-1 w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by PO number or supplier..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          {search && (
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => {
                setSearch('');
                setPage(1);
              }}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFiltersVisible(!filtersVisible)}
            className={filtersVisible ? 'bg-muted' : ''}
          >
            <Filter className="h-4 w-4 mr-1" />
            Filters
            {hasActiveFilters && (
              <Badge className="ml-1.5 h-5 w-5 p-0 text-[10px] flex items-center justify-center bg-primary text-primary-foreground">
                !
              </Badge>
            )}
          </Button>

          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
              <X className="h-3.5 w-3.5 mr-1" />
              Clear
            </Button>
          )}

          <Button onClick={() => setCreateOpen(true)} size="sm">
            <Plus className="h-4 w-4 mr-1" />
            New PO
          </Button>
        </div>
      </div>

      {/* ── Filter Bar ── */}
      {filtersVisible && (
        <Card className="backdrop-blur-sm bg-card/80 border-border/50">
          <CardContent className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Status</Label>
                <Select
                  value={statusFilter}
                  onValueChange={(v) => {
                    setStatusFilter(v);
                    setPage(1);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Statuses</SelectItem>
                    {PO_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        <span className="flex items-center gap-2">
                          <span className={getStatusBadgeClasses(s).split(' ')[0]}>
                            {getStatusIcon(s)}
                          </span>
                          {formatStatusLabel(s)}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Supplier</Label>
                <Select
                  value={supplierFilter}
                  onValueChange={(v) => {
                    setSupplierFilter(v);
                    setPage(1);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Suppliers</SelectItem>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Order Date From</Label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => {
                    setDateFrom(e.target.value);
                    setPage(1);
                  }}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Order Date To</Label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => {
                    setDateTo(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Table ── */}
      <Card className="backdrop-blur-sm bg-card/80 border-border/50">
        <CardContent className="p-0">
          {poLoading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : poError ? (
            <div className="text-center py-12 text-muted-foreground">
              <AlertTriangle className="h-10 w-10 mx-auto mb-3 text-red-400" />
              <p className="font-medium text-red-600">Failed to load purchase orders</p>
              <p className="text-sm mt-1">Please try refreshing the page</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() =>
                  queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
                }
              >
                Retry
              </Button>
            </div>
          ) : sortedPOs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <ClipboardList className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No purchase orders found</p>
              <p className="text-sm mt-1">
                {hasActiveFilters
                  ? 'Try adjusting your filters or search terms'
                  : 'Create your first purchase order to get started'}
              </p>
              {!hasActiveFilters && (
                <Button size="sm" className="mt-3" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4 mr-1" />
                  Create Purchase Order
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs cursor-pointer select-none" onClick={() => toggleSort('orderDate')}>
                        <span className="flex items-center">
                          PO Number
                          <ArrowUpDown className={`h-3.5 w-3.5 ml-1 inline ${sortField === 'orderDate' ? 'text-primary' : 'text-muted-foreground/40'}`} />
                        </span>
                      </TableHead>
                      <TableHead className="text-xs">Supplier</TableHead>
                      <TableHead className="text-xs cursor-pointer select-none" onClick={() => toggleSort('status')}>
                        <span className="flex items-center">
                          Status
                          <ArrowUpDown className={`h-3.5 w-3.5 ml-1 inline ${sortField === 'status' ? 'text-primary' : 'text-muted-foreground/40'}`} />
                        </span>
                      </TableHead>
                      <TableHead className="text-xs">Order Date</TableHead>
                      <TableHead className="text-xs">Expected Date</TableHead>
                      <TableHead className="text-xs cursor-pointer select-none text-right" onClick={() => toggleSort('totalAmount')}>
                        <span className="flex items-center justify-end">
                          Total Amount
                          <ArrowUpDown className={`h-3.5 w-3.5 ml-1 inline ${sortField === 'totalAmount' ? 'text-primary' : 'text-muted-foreground/40'}`} />
                        </span>
                      </TableHead>
                      <TableHead className="text-xs text-center">Items</TableHead>
                      <TableHead className="text-xs text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedPOs.map((po) => {
                      const isOverdue =
                        po.expectedDate &&
                        po.status !== 'RECEIVED' &&
                        po.status !== 'CANCELLED' &&
                        new Date(po.expectedDate).getTime() < currentTime;

                      return (
                        <TableRow
                          key={po.id}
                          className="cursor-pointer hover:bg-muted/50 transition-colors"
                          onClick={() => openDetail(po)}
                        >
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-semibold text-sm text-primary">
                                {po.poNumber}
                              </span>
                              {isOverdue && (
                                <Badge className="text-[9px] bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 gap-0.5">
                                  <AlertTriangle className="h-3 w-3" /> Overdue
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="text-sm">{po.supplier?.name || '—'}</span>
                          </TableCell>
                          <TableCell>
                            <Badge className={`text-[10px] gap-1 ${getStatusBadgeClasses(po.status)}`}>
                              {getStatusIcon(po.status)}
                              {formatStatusLabel(po.status)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {formatDate(po.orderDate)}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {po.expectedDate ? formatDate(po.expectedDate) : '—'}
                          </TableCell>
                          <TableCell className="text-right font-medium text-sm">
                            {formatKES(po.totalAmount)}
                          </TableCell>
                          <TableCell className="text-center text-sm">
                            {po.items?.length ?? po.itemCount ?? 0}
                          </TableCell>
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                                <DropdownMenuItem onClick={() => openDetail(po)}>
                                  <Eye className="h-4 w-4 mr-2" />
                                  View Details
                                </DropdownMenuItem>
                                {po.status === 'CONFIRMED' || po.status === 'PARTIALLY_RECEIVED' ? (
                                  <DropdownMenuItem
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedPO(po);
                                      setDetailOpen(true);
                                      // We'll trigger receive from the detail view
                                    }}
                                  >
                                    <PackageCheck className="h-4 w-4 mr-2" />
                                    Receive Items
                                  </DropdownMenuItem>
                                ) : null}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              {pagination && pagination.totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t">
                  <p className="text-xs text-muted-foreground">
                    Showing {(page - 1) * limit + 1}–{Math.min(page * limit, pagination.total)} of{' '}
                    {pagination.total} orders
                  </p>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm px-2">
                      {page} / {pagination.totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= pagination.totalPages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      <ChevronLeft className="h-4 w-4 rotate-180" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Create PO Dialog ── */}
      <CreatePODialog open={createOpen} onOpenChange={setCreateOpen} storeId={currentStoreId} />

      {/* ── PO Detail Dialog ── */}
      <PODetailView po={selectedPO} open={detailOpen} onOpenChange={setDetailOpen} />
    </div>
  );
}
