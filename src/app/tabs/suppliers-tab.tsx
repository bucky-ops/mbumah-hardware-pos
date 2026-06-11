'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Truck, Search, Plus, Star, Eye, Loader2,
  Phone, Mail, MapPin, Building2, User, FileText,
  ChevronRight, Download, Package, CalendarDays,
  ClipboardCheck, AlertTriangle, Hash
} from 'lucide-react';

import { useAppStore } from '@/lib/stores';
import {
  suppliersApi, purchaseOrdersApi, productsApi,
  formatKES, formatDate, formatDateTime,
  type SupplierItem,
  type PurchaseOrderListItem,
  type PurchaseOrderItemDetail,
  type ProductListItem,
} from '@/lib/api';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

// Avatar gradient colors
const AVATAR_GRADIENTS = [
  'from-rose-500 to-pink-600',
  'from-violet-500 to-purple-600',
  'from-cyan-500 to-teal-600',
  'from-emerald-500 to-green-600',
  'from-amber-500 to-orange-600',
  'from-red-500 to-rose-600',
  'from-teal-500 to-cyan-600',
  'from-orange-500 to-amber-600',
];

function getAvatarGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
}

function getPOStatusBadge(status: string) {
  switch (status) {
    case 'DRAFT': return 'bg-gray-100 text-gray-700 dark:bg-gray-800/50 dark:text-gray-300';
    case 'SENT': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
    case 'CONFIRMED': return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300';
    case 'RECEIVED': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300';
    case 'CANCELLED': return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300';
    default: return 'bg-muted text-muted-foreground';
  }
}

function getPaymentTermsLabel(terms: string): string {
  switch (terms) {
    case 'NET_15': return 'Net 15';
    case 'NET_30': return 'Net 30';
    case 'NET_60': return 'Net 60';
    case 'IMMEDIATE': return 'Immediate';
    default: return terms;
  }
}

function StarRating({ rating, onRate, readonly = false }: { rating: number; onRate?: (r: number) => void; readonly?: boolean }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={readonly}
          onClick={() => onRate?.(star)}
          className={`transition-colors ${readonly ? 'cursor-default' : 'cursor-pointer hover:scale-110'}`}
        >
          <Star
            className={`h-4 w-4 ${
              star <= rating
                ? 'text-amber-400 fill-amber-400'
                : 'text-gray-300 dark:text-gray-600'
            }`}
          />
        </button>
      ))}
    </div>
  );
}

// ============================================================================
// ADD/EDIT SUPPLIER DIALOG
// ============================================================================

function AddSupplierDialog({
  open,
  onOpenChange,
  storeId,
  editSupplier,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
  editSupplier?: SupplierItem | null;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: '', email: '', phone: '', address: '', city: '',
    contactPerson: '', taxPin: '', paymentTerms: 'NET_30',
    rating: 3, notes: '',
  });

  React.useEffect(() => {
    if (editSupplier) {
      setForm({
        name: editSupplier.name || '',
        email: editSupplier.email || '',
        phone: editSupplier.phone || '',
        address: editSupplier.address || '',
        city: editSupplier.city || '',
        contactPerson: editSupplier.contactPerson || '',
        taxPin: editSupplier.taxPin || '',
        paymentTerms: editSupplier.paymentTerms || 'NET_30',
        rating: editSupplier.rating || 3,
        notes: editSupplier.notes || '',
      });
    } else {
      setForm({
        name: '', email: '', phone: '', address: '', city: '',
        contactPerson: '', taxPin: '', paymentTerms: 'NET_30',
        rating: 3, notes: '',
      });
    }
  }, [editSupplier, open]);

  const createMutation = useMutation({
    mutationFn: (data: typeof form) => suppliersApi.create({ storeId, ...data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success('Supplier created successfully');
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: (data: typeof form) => suppliersApi.update(editSupplier!.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['supplier-detail'] });
      toast.success('Supplier updated successfully');
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Supplier name is required');
      return;
    }
    if (editSupplier) {
      updateMutation.mutate(form);
    } else {
      createMutation.mutate(form);
    }
  };

  const isLoading = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editSupplier ? 'Edit Supplier' : 'Add New Supplier'}</DialogTitle>
          <DialogDescription>
            {editSupplier ? 'Update supplier information' : 'Add a new supplier to your store'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="name">Supplier Name *</Label>
              <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Bamburi Cement Ltd" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input id="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="supplier@email.com" className="pl-10" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input id="phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+254 700 000 000" className="pl-10" />
              </div>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="address">Address</Label>
              <Input id="address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Street address" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="city">City</Label>
              <Input id="city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Nairobi" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contactPerson">Contact Person</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input id="contactPerson" value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} placeholder="John Doe" className="pl-10" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="taxPin">Tax PIN (KRA)</Label>
              <Input id="taxPin" value={form.taxPin} onChange={(e) => setForm({ ...form, taxPin: e.target.value })} placeholder="A00XXXXXXX" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="paymentTerms">Payment Terms</Label>
              <Select value={form.paymentTerms} onValueChange={(v) => setForm({ ...form, paymentTerms: v })}>
                <SelectTrigger id="paymentTerms"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="IMMEDIATE">Immediate</SelectItem>
                  <SelectItem value="NET_15">Net 15</SelectItem>
                  <SelectItem value="NET_30">Net 30</SelectItem>
                  <SelectItem value="NET_60">Net 60</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Rating</Label>
              <StarRating rating={form.rating} onRate={(r) => setForm({ ...form, rating: r })} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Additional notes about this supplier..." rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editSupplier ? 'Update Supplier' : 'Add Supplier'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// CREATE PURCHASE ORDER DIALOG
// ============================================================================

function CreatePODialog({
  open,
  onOpenChange,
  storeId,
  suppliers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
  suppliers: SupplierItem[];
}) {
  const queryClient = useQueryClient();
  const [supplierId, setSupplierId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [poItems, setPoItems] = useState<{ productId: string; quantity: string; unitPrice: string }[]>([]);
  const [productSearch, setProductSearch] = useState('');

  const { data: productsData } = useQuery({
    queryKey: ['products-for-po', storeId, productSearch],
    queryFn: () => productsApi.list({ storeId, search: productSearch, limit: 50 }),
    enabled: open,
  });

  const products: ProductListItem[] = productsData?.data || [];

  const addItem = () => {
    setPoItems([...poItems, { productId: '', quantity: '1', unitPrice: '0' }]);
  };

  const removeItem = (index: number) => {
    setPoItems(poItems.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, field: 'productId' | 'quantity' | 'unitPrice', value: string) => {
    const updated = [...poItems];
    updated[index] = { ...updated[index], [field]: value };
    // Auto-fill unit price from product cost price
    if (field === 'productId') {
      const product = products.find((p) => p.id === value);
      if (product) {
        updated[index].unitPrice = String(product.costPrice);
      }
    }
    setPoItems(updated);
  };

  const totalAmount = poItems.reduce((sum, item) => {
    return sum + (parseFloat(item.quantity) || 0) * (parseFloat(item.unitPrice) || 0);
  }, 0);

  const createMutation = useMutation({
    mutationFn: () => purchaseOrdersApi.create({
      storeId,
      supplierId,
      expectedDate: expectedDate || undefined,
      notes: notes || undefined,
      items: poItems
        .filter((item) => item.productId && parseFloat(item.quantity) > 0)
        .map((item) => ({
          productId: item.productId,
          quantity: parseFloat(item.quantity),
          unitPrice: parseFloat(item.unitPrice),
        })),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success('Purchase order created successfully');
      onOpenChange(false);
      setSupplierId('');
      setExpectedDate('');
      setNotes('');
      setPoItems([]);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Purchase Order</DialogTitle>
          <DialogDescription>Create a new purchase order for a supplier</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Supplier *</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                <SelectContent>
                  {suppliers.filter((s) => s.isActive).map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
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

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Order Items</Label>
              <Button type="button" variant="outline" size="sm" onClick={addItem}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Item
              </Button>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search products..."
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                className="pl-10 mb-2"
              />
            </div>
            {poItems.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No items added yet. Click &ldquo;Add Item&rdquo; to start.</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
                {poItems.map((item, index) => (
                  <div key={index} className="grid grid-cols-12 gap-2 items-end border rounded-lg p-2">
                    <div className="col-span-5">
                      <Label className="text-xs">Product</Label>
                      <Select value={item.productId} onValueChange={(v) => updateItem(index, 'productId', v)}>
                        <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Select" /></SelectTrigger>
                        <SelectContent>
                          {products.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name} ({p.sku})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2">
                      <Label className="text-xs">Qty</Label>
                      <Input type="number" min="1" value={item.quantity} onChange={(e) => updateItem(index, 'quantity', e.target.value)} className="h-9 text-xs" />
                    </div>
                    <div className="col-span-3">
                      <Label className="text-xs">Unit Price</Label>
                      <Input type="number" min="0" step="0.01" value={item.unitPrice} onChange={(e) => updateItem(index, 'unitPrice', e.target.value)} className="h-9 text-xs" />
                    </div>
                    <div className="col-span-2 flex items-center justify-end">
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-700" onClick={() => removeItem(index)}>
                        &times;
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {totalAmount > 0 && (
              <div className="text-right text-sm font-medium pt-2 border-t">
                Total: {formatKES(totalAmount)}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Order notes..." rows={2} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              type="button"
              onClick={() => createMutation.mutate()}
              disabled={!supplierId || poItems.length === 0 || createMutation.isPending}
            >
              {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create PO
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// RECEIVE PO ITEMS DIALOG
// ============================================================================

function ReceivePODialog({
  open,
  onOpenChange,
  purchaseOrder,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  purchaseOrder: PurchaseOrderListItem | null;
}) {
  const queryClient = useQueryClient();
  const [receivedQtys, setReceivedQtys] = useState<Record<string, string>>({});

  React.useEffect(() => {
    if (purchaseOrder?.items) {
      const initial: Record<string, string> = {};
      purchaseOrder.items.forEach((item) => {
        const remaining = item.quantity - item.receivedQty;
        initial[item.id] = remaining > 0 ? String(remaining) : '0';
      });
      setReceivedQtys(initial);
    }
  }, [purchaseOrder, open]);

  const receiveMutation = useMutation({
    mutationFn: () => {
      if (!purchaseOrder) throw new Error('No PO selected');
      const receivedItems = Object.entries(receivedQtys)
        .filter(([, qty]) => parseFloat(qty) > 0)
        .map(([itemId, qty]) => ({ itemId, receivedQty: parseFloat(qty) }));
      if (receivedItems.length === 0) throw new Error('No items to receive');
      return purchaseOrdersApi.receiveItems(purchaseOrder.id, receivedItems);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['supplier-detail'] });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success('Items received and stock updated');
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!purchaseOrder?.items) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Receive Items - {purchaseOrder.poNumber}</DialogTitle>
          <DialogDescription>Enter quantities received for each item. Stock will be updated automatically.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 max-h-80 overflow-y-auto custom-scrollbar">
          {purchaseOrder.items.map((item) => {
            const remaining = item.quantity - item.receivedQty;
            const product = item.product;
            return (
              <div key={item.id} className="flex items-center gap-3 border rounded-lg p-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{product?.name || 'Unknown'}</p>
                  <p className="text-xs text-muted-foreground">
                    Ordered: {item.quantity} · Received: {item.receivedQty} · Remaining: {remaining}
                  </p>
                </div>
                <div className="w-24">
                  <Input
                    type="number"
                    min="0"
                    max={remaining}
                    value={receivedQtys[item.id] || '0'}
                    onChange={(e) => setReceivedQtys({ ...receivedQtys, [item.id]: e.target.value })}
                    className="h-9 text-sm"
                    disabled={remaining <= 0}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            type="button"
            onClick={() => receiveMutation.mutate()}
            disabled={receiveMutation.isPending}
          >
            {receiveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Receive Items
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// SUPPLIER DETAIL VIEW
// ============================================================================

function SupplierDetailView({
  supplierId,
  onBack,
  storeId,
}: {
  supplierId: string;
  onBack: () => void;
  storeId: string;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [receivePOOpen, setReceivePOOpen] = useState(false);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrderListItem | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['supplier-detail', supplierId],
    queryFn: () => suppliersApi.get(supplierId),
    enabled: !!supplierId,
  });

  const supplier = data?.data;

  const { data: poData } = useQuery({
    queryKey: ['purchase-orders-supplier', storeId, supplierId],
    queryFn: () => purchaseOrdersApi.list({ storeId, supplierId, limit: 50 }),
    enabled: !!supplierId,
  });

  const purchaseOrders = poData?.data || [];

  const deleteMutation = useMutation({
    mutationFn: () => suppliersApi.delete(supplierId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success('Supplier deactivated');
      onBack();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!supplier) return null;

  const summary = supplier.summary || { totalPOs: 0, totalPOValue: 0, pendingPOs: 0 };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronRight className="h-4 w-4 rotate-180 mr-1" />
          Back
        </Button>
        <Avatar className="h-12 w-12">
          <AvatarFallback className={`bg-gradient-to-br ${getAvatarGradient(supplier.name)} text-white font-bold`}>
            {supplier.name.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold">{supplier.name}</h2>
            <Badge variant={supplier.isActive ? 'default' : 'secondary'}>
              {supplier.isActive ? 'Active' : 'Inactive'}
            </Badge>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <StarRating rating={supplier.rating} readonly />
            <span className="text-xs text-muted-foreground">({supplier.rating}/5)</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-red-600 hover:text-red-700 hover:bg-red-50"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending || !supplier.isActive}
          >
            {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Deactivate'}
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total POs</p>
                <p className="text-xl font-bold">{summary.totalPOs}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pending Orders</p>
                <p className="text-xl font-bold">{summary.pendingPOs}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <Truck className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total PO Value</p>
                <p className="text-xl font-bold">{formatKES(summary.totalPOValue)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="info">
        <TabsList>
          <TabsTrigger value="info">Info</TabsTrigger>
          <TabsTrigger value="orders">Purchase Orders</TabsTrigger>
          <TabsTrigger value="contact">Contact</TabsTrigger>
        </TabsList>

        <TabsContent value="info" className="mt-4">
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Payment Terms</p>
                  <p className="font-medium">{getPaymentTermsLabel(supplier.paymentTerms)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Tax PIN</p>
                  <p className="font-medium">{supplier.taxPin || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Contact Person</p>
                  <p className="font-medium">{supplier.contactPerson || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">City</p>
                  <p className="font-medium">{supplier.city || '—'}</p>
                </div>
                <div className="sm:col-span-2">
                  <p className="text-xs text-muted-foreground mb-1">Address</p>
                  <p className="font-medium">{supplier.address || '—'}</p>
                </div>
                <div className="sm:col-span-2">
                  <p className="text-xs text-muted-foreground mb-1">Notes</p>
                  <p className="font-medium whitespace-pre-wrap">{supplier.notes || '—'}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="orders" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Purchase Orders</CardTitle>
                <Badge variant="outline">{purchaseOrders.length} orders</Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {purchaseOrders.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No purchase orders yet</p>
                </div>
              ) : (
                <div className="max-h-96 overflow-auto custom-scrollbar">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>PO #</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {purchaseOrders.map((po) => (
                        <TableRow key={po.id}>
                          <TableCell className="font-mono text-sm">{po.poNumber}</TableCell>
                          <TableCell className="text-sm">{formatDate(po.orderDate)}</TableCell>
                          <TableCell>
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getPOStatusBadge(po.status)}`}>
                              {po.status}
                            </span>
                          </TableCell>
                          <TableCell className="font-medium">{formatKES(po.totalAmount)}</TableCell>
                          <TableCell className="text-right">
                            {po.status !== 'CANCELLED' && po.status !== 'RECEIVED' && po.items && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => { setSelectedPO(po); setReceivePOOpen(true); }}
                              >
                                <ClipboardCheck className="h-3 w-3 mr-1" /> Receive
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="contact" className="mt-4">
          <Card>
            <CardContent className="p-4 space-y-4">
              {supplier.phone && (
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                    <Phone className="h-5 w-5 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Phone</p>
                    <p className="font-medium">{supplier.phone}</p>
                  </div>
                </div>
              )}
              {supplier.email && (
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                    <Mail className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Email</p>
                    <p className="font-medium">{supplier.email}</p>
                  </div>
                </div>
              )}
              {supplier.contactPerson && (
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                    <User className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Contact Person</p>
                    <p className="font-medium">{supplier.contactPerson}</p>
                  </div>
                </div>
              )}
              {supplier.address && (
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center">
                    <MapPin className="h-5 w-5 text-rose-600 dark:text-rose-400" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Address</p>
                    <p className="font-medium">{[supplier.address, supplier.city].filter(Boolean).join(', ')}</p>
                  </div>
                </div>
              )}
              {supplier.taxPin && (
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                    <Hash className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">KRA PIN</p>
                    <p className="font-medium">{supplier.taxPin}</p>
                  </div>
                </div>
              )}
              {!supplier.phone && !supplier.email && !supplier.contactPerson && !supplier.address && !supplier.taxPin && (
                <div className="text-center py-8 text-muted-foreground">
                  <Building2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No contact information available</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AddSupplierDialog open={editOpen} onOpenChange={setEditOpen} storeId={storeId} editSupplier={supplier} />
      <ReceivePODialog open={receivePOOpen} onOpenChange={setReceivePOOpen} purchaseOrder={selectedPO} />
    </div>
  );
}

// ============================================================================
// MAIN SUPPLIERS TAB
// ============================================================================

export default function SuppliersTab() {
  const currentStoreId = useAppStore((s) => s.currentStoreId);
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [addOpen, setAddOpen] = useState(false);
  const [createPOOpen, setCreatePOOpen] = useState(false);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [poFilterStatus, setPoFilterStatus] = useState<string>('all');

  // Suppliers query
  const { data: suppliersData, isLoading: suppliersLoading } = useQuery({
    queryKey: ['suppliers', currentStoreId, searchQuery, filterStatus],
    queryFn: () => suppliersApi.list({
      storeId: currentStoreId,
      search: searchQuery || undefined,
      isActive: filterStatus === 'all' ? undefined : filterStatus === 'active' ? 'true' : 'false',
      limit: 100,
    }),
    enabled: !!currentStoreId,
  });

  // Purchase orders query
  const { data: poData, isLoading: poLoading } = useQuery({
    queryKey: ['purchase-orders', currentStoreId, poFilterStatus],
    queryFn: () => purchaseOrdersApi.list({
      storeId: currentStoreId,
      status: poFilterStatus === 'all' ? undefined : poFilterStatus,
      limit: 50,
    }),
    enabled: !!currentStoreId,
  });

  const suppliers: SupplierItem[] = suppliersData?.data || [];
  const purchaseOrders: PurchaseOrderListItem[] = poData?.data || [];

  const activeSuppliers = suppliers.filter((s) => s.isActive).length;
  const pendingPOs = purchaseOrders.filter((po) => ['DRAFT', 'SENT', 'CONFIRMED'].includes(po.status)).length;
  const totalPOValue = purchaseOrders
    .filter((po) => po.status !== 'CANCELLED')
    .reduce((sum, po) => sum + po.totalAmount, 0);

  // CSV Export
  const exportCSV = () => {
    const headers = ['Name', 'Email', 'Phone', 'City', 'Contact Person', 'Payment Terms', 'Rating', 'Active', 'PO Count'];
    const rows = suppliers.map((s) => [
      s.name,
      s.email || '',
      s.phone || '',
      s.city || '',
      s.contactPerson || '',
      getPaymentTermsLabel(s.paymentTerms),
      String(s.rating),
      String(s.isActive),
      String(s.purchaseOrderCount || 0),
    ]);

    const csv = [headers.join(','), ...rows.map((r) => r.map((c) => `"${c}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `suppliers_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    toast.success('CSV exported successfully');
  };

  // If a supplier is selected, show detail view
  if (selectedSupplierId) {
    return (
      <div className="p-1">
        <SupplierDetailView
          supplierId={selectedSupplierId}
          onBack={() => setSelectedSupplierId(null)}
          storeId={currentStoreId}
        />
      </div>
    );
  }

  return (
    <div className="p-1 space-y-4">
      {/* Overview Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center shrink-0">
                <Truck className="h-5 w-5 text-violet-600 dark:text-violet-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Suppliers</p>
                <p className="text-xl font-bold">{suppliers.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0">
                <Building2 className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Active Suppliers</p>
                <p className="text-xl font-bold">{activeSuppliers}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
                <ClipboardCheck className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pending Orders</p>
                <p className="text-xl font-bold">{pendingPOs}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center shrink-0">
                <FileText className="h-5 w-5 text-teal-600 dark:text-teal-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total PO Value</p>
                <p className="text-xl font-bold">{formatKES(totalPOValue)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Supplier List */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <CardTitle className="text-base">Suppliers</CardTitle>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:flex-initial">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search suppliers..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 h-9 w-full sm:w-56"
                />
              </div>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="h-9 w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" className="h-9" onClick={exportCSV} disabled={suppliers.length === 0}>
                <Download className="h-4 w-4 mr-1" />
                <span className="hidden sm:inline">Export</span>
              </Button>
              <Button size="sm" className="h-9" onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4 mr-1" />
                <span className="hidden sm:inline">Add</span>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {suppliersLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
            </div>
          ) : suppliers.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Truck className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No suppliers found</p>
              <p className="text-sm mt-1">Add your first supplier to get started</p>
              <Button size="sm" className="mt-3" onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4 mr-1" /> Add Supplier
              </Button>
            </div>
          ) : (
            <div className="max-h-96 overflow-auto custom-scrollbar">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden md:table-cell">Contact</TableHead>
                    <TableHead className="hidden sm:table-cell">City</TableHead>
                    <TableHead>Rating</TableHead>
                    <TableHead className="hidden sm:table-cell">Terms</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">POs</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {suppliers.map((supplier) => (
                    <TableRow
                      key={supplier.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelectedSupplierId(supplier.id)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className={`bg-gradient-to-br ${getAvatarGradient(supplier.name)} text-white text-xs font-bold`}>
                              {supplier.name.slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium text-sm">{supplier.name}</p>
                            {supplier.contactPerson && (
                              <p className="text-xs text-muted-foreground">{supplier.contactPerson}</p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <div className="space-y-0.5">
                          {supplier.phone && (
                            <p className="text-xs flex items-center gap-1"><Phone className="h-3 w-3" />{supplier.phone}</p>
                          )}
                          {supplier.email && (
                            <p className="text-xs flex items-center gap-1 truncate max-w-[180px]"><Mail className="h-3 w-3 shrink-0" />{supplier.email}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-sm">{supplier.city || '—'}</TableCell>
                      <TableCell>
                        <StarRating rating={supplier.rating} readonly />
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-sm">{getPaymentTermsLabel(supplier.paymentTerms)}</TableCell>
                      <TableCell>
                        <Badge variant={supplier.isActive ? 'default' : 'secondary'} className="text-xs">
                          {supplier.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium">{supplier.purchaseOrderCount || 0}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Purchase Orders Section */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <CardTitle className="text-base">Purchase Orders</CardTitle>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Select value={poFilterStatus} onValueChange={setPoFilterStatus}>
                <SelectTrigger className="h-9 w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="DRAFT">Draft</SelectItem>
                  <SelectItem value="SENT">Sent</SelectItem>
                  <SelectItem value="CONFIRMED">Confirmed</SelectItem>
                  <SelectItem value="RECEIVED">Received</SelectItem>
                  <SelectItem value="CANCELLED">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" className="h-9" onClick={() => setCreatePOOpen(true)}>
                <Plus className="h-4 w-4 mr-1" />
                <span className="hidden sm:inline">New PO</span>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {poLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
            </div>
          ) : purchaseOrders.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p className="font-medium text-sm">No purchase orders</p>
              <p className="text-xs mt-1">Create a purchase order to track supplier deliveries</p>
            </div>
          ) : (
            <div className="max-h-96 overflow-auto custom-scrollbar">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>PO #</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {purchaseOrders.map((po) => (
                    <TableRow key={po.id}>
                      <TableCell className="font-mono text-sm">{po.poNumber}</TableCell>
                      <TableCell className="text-sm">{po.supplier?.name || '—'}</TableCell>
                      <TableCell className="text-sm">{formatDate(po.orderDate)}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getPOStatusBadge(po.status)}`}>
                          {po.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-medium">{formatKES(po.totalAmount)}</TableCell>
                      <TableCell className="text-right">
                        <POActions po={po} storeId={currentStoreId} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialogs */}
      <AddSupplierDialog open={addOpen} onOpenChange={setAddOpen} storeId={currentStoreId} />
      <CreatePODialog open={createPOOpen} onOpenChange={setCreatePOOpen} storeId={currentStoreId} suppliers={suppliers} />
    </div>
  );
}

// ============================================================================
// PO ACTIONS COMPONENT
// ============================================================================

function POActions({ po, storeId }: { po: PurchaseOrderListItem; storeId: string }) {
  const queryClient = useQueryClient();
  const [receiveOpen, setReceiveOpen] = useState(false);

  // Fetch full PO details for receiving
  const { data: poDetail } = useQuery({
    queryKey: ['purchase-order-detail', po.id],
    queryFn: () => purchaseOrdersApi.get(po.id),
    enabled: receiveOpen,
  });

  const statusMutation = useMutation({
    mutationFn: ({ status, notes }: { status: string; notes?: string }) =>
      purchaseOrdersApi.updateStatus(po.id, status, notes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success('PO status updated');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const nextStatusMap: Record<string, string> = {
    DRAFT: 'SENT',
    SENT: 'CONFIRMED',
    CONFIRMED: 'RECEIVED',
  };

  const nextStatus = nextStatusMap[po.status];

  return (
    <div className="flex items-center gap-1 justify-end">
      {nextStatus && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={(e) => {
            e.stopPropagation();
            statusMutation.mutate({ status: nextStatus });
          }}
          disabled={statusMutation.isPending}
        >
          {statusMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : `Mark ${nextStatus}`}
        </Button>
      )}
      {po.status === 'CONFIRMED' && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={(e) => {
            e.stopPropagation();
            setReceiveOpen(true);
          }}
        >
          <ClipboardCheck className="h-3 w-3 mr-1" /> Receive
        </Button>
      )}
      {po.status === 'DRAFT' && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-red-600 hover:text-red-700"
          onClick={(e) => {
            e.stopPropagation();
            statusMutation.mutate({ status: 'CANCELLED' });
          }}
          disabled={statusMutation.isPending}
        >
          Cancel
        </Button>
      )}
      <ReceivePODialog open={receiveOpen} onOpenChange={setReceiveOpen} purchaseOrder={poDetail?.data || null} />
    </div>
  );
}
