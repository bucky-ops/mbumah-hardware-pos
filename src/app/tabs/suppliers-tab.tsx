'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Truck, Search, Plus, Star, Eye, Loader2, X,
  Phone, Mail, MapPin, Building2, User, FileText,
  ChevronRight, Download, Package, CalendarDays,
  ClipboardCheck, AlertTriangle, Hash, Clock, CheckCircle2,
  Circle, ArrowRight, TrendingUp, Award, Timer, MessageSquare,
  Send, MoreVertical,
} from 'lucide-react';

import { useAppStore } from '@/lib/stores';
import {
  suppliersApi, purchaseOrdersApi, productsApi,
  formatKES, formatDate, formatDateTime,
  openWhatsApp, openEmail, openSMS,
  type SupplierItem,
  type PurchaseOrderListItem,
  type PurchaseOrderItemDetail,
  type ProductListItem,
  type SupplierSendOrderResult,
} from '@/lib/api';
import { handleError } from '@/lib/error-handler';
import { ResponsiveDialog } from '@/components/ui/responsive-dialog';

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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

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
    case 'CONFIRMED': return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
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

// PO Status Timeline Component

function POStatusTimeline({ status }: { status: string }) {
  const steps = ['DRAFT', 'SENT', 'CONFIRMED', 'RECEIVED'];
  const currentIndex = steps.indexOf(status);
  const isCancelled = status === 'CANCELLED';

  return (
    <div className="flex items-center gap-1">
      {steps.map((step, i) => {
        const isCompleted = !isCancelled && i <= currentIndex;
        const isCurrent = !isCancelled && i === currentIndex;
        const isPast = !isCancelled && i < currentIndex;

        return (
          <React.Fragment key={step}>
            {i > 0 && (
              <div className={`w-4 h-0.5 ${isPast ? 'bg-green-400' : 'bg-muted-foreground/20'}`} />
            )}
            <div className="flex flex-col items-center" title={step}>
              {isCurrent ? (
                <div className="w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                  <div className="w-1.5 h-1.5 rounded-full bg-white" />
                </div>
              ) : isPast ? (
                <CheckCircle2 className="w-4 h-4 text-green-500" />
              ) : (
                <Circle className="w-4 h-4 text-muted-foreground/30" />
              )}
              <span className={`text-[8px] mt-0.5 ${isCurrent ? 'text-primary font-bold' : isPast ? 'text-green-600' : 'text-muted-foreground/40'}`}>
                {step}
              </span>
            </div>
          </React.Fragment>
        );
      })}
      {isCancelled && (
        <Badge className="text-[9px] bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 ml-2">
          CANCELLED
        </Badge>
      )}
    </div>
  );
}

// PO Receiving Progress Component

function POReceivingProgress({ po }: { po: PurchaseOrderListItem }) {
  if (!po.items || po.items.length === 0) return null;

  const totalOrdered = po.items.reduce((s, item) => s + item.quantity, 0);
  const totalReceived = po.items.reduce((s, item) => s + item.receivedQty, 0);
  const pct = totalOrdered > 0 ? (totalReceived / totalOrdered) * 100 : 0;
  const isPartial = pct > 0 && pct < 100;
  const isComplete = pct >= 100;

  return (
    <div className="flex items-center gap-2 text-xs">
      <Progress value={pct} className="h-1.5 flex-1" />
      <span className={`font-medium whitespace-nowrap ${isComplete ? 'text-green-600' : isPartial ? 'text-amber-600' : 'text-muted-foreground'}`}>
        {totalReceived}/{totalOrdered}
      </span>
    </div>
  );
}

// Delivery Status Indicator

function DeliveryStatusIndicator({ po }: { po: PurchaseOrderListItem }) {
  const now = new Date().getTime();
  const expected = po.expectedDate ? new Date(po.expectedDate).getTime() : null;

  if (po.status === 'RECEIVED') {
    return (
      <Badge className="text-[9px] bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400 gap-0.5">
        <CheckCircle2 className="h-3 w-3" /> Delivered
      </Badge>
    );
  }

  if (po.status === 'CANCELLED') {
    return (
      <Badge className="text-[9px] bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 gap-0.5">
        <AlertTriangle className="h-3 w-3" /> Cancelled
      </Badge>
    );
  }

  if (expected && now > expected) {
    return (
      <Badge className="text-[9px] bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 gap-0.5">
        <AlertTriangle className="h-3 w-3" /> Overdue
      </Badge>
    );
  }

  if (expected) {
    const daysLeft = Math.ceil((expected - now) / 86400000);
    return (
      <Badge className="text-[9px] bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400 gap-0.5">
        <Clock className="h-3 w-3" /> {daysLeft}d left
      </Badge>
    );
  }

  return (
    <Badge className="text-[9px] bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400 gap-0.5">
      <Clock className="h-3 w-3" /> Pending
    </Badge>
  );
}

// Supplier Performance Card

function SupplierPerformanceCard({ purchaseOrders }: { purchaseOrders: PurchaseOrderListItem[] }) {
  const receivedPOs = purchaseOrders.filter(po => po.status === 'RECEIVED');
  const onTimePOs = receivedPOs.filter(po => {
    if (!po.expectedDate) return true;
    return new Date(po.createdAt).getTime() <= new Date(po.expectedDate).getTime();
  });
  const fulfilledPOs = purchaseOrders.filter(po => po.status !== 'CANCELLED');
  const totalPOValue = purchaseOrders.filter(po => po.status !== 'CANCELLED').reduce((s, po) => s + po.totalAmount, 0);

  const onTimeRate = receivedPOs.length > 0 ? Math.round((onTimePOs.length / receivedPOs.length) * 100) : 0;
  const fulfillmentRate = purchaseOrders.length > 0 ? Math.round((fulfilledPOs.length / purchaseOrders.length) * 100) : 100;
  const avgLeadTime = receivedPOs.length > 0
    ? Math.round(receivedPOs.reduce((s, po) => {
        const created = new Date(po.orderDate).getTime();
        const delivered = po.expectedDate ? new Date(po.expectedDate).getTime() : created;
        return s + Math.max(Math.ceil((delivered - created) / 86400000), 1);
      }, 0) / receivedPOs.length)
    : 0;

  // Quality rating based on received vs ordered quantities
  const qualityRating = receivedPOs.length > 0
    ? Math.min(5, Math.round((fulfillmentRate / 20) * 10) / 10)
    : 0;

  return (
    <Card className="backdrop-blur-sm bg-card/80 border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Award className="h-4 w-4 text-amber-500" /> Supplier Performance
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-3 rounded-lg bg-green-50/80 dark:bg-green-900/20 backdrop-blur-sm border border-green-200/30 dark:border-green-800/30">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="h-4 w-4 text-green-600" />
              <span className="text-xs text-muted-foreground">On-Time Rate</span>
            </div>
            <p className="text-xl font-bold text-green-600">{onTimeRate}%</p>
            <div className="mt-1 h-1 bg-green-200/50 rounded-full overflow-hidden">
              <div className="h-full bg-green-500 rounded-full" style={{ width: `${onTimeRate}%` }} />
            </div>
          </div>
          <div className="p-3 rounded-lg bg-blue-50/80 dark:bg-blue-900/20 backdrop-blur-sm border border-blue-200/30 dark:border-blue-800/30">
            <div className="flex items-center gap-2 mb-1">
              <ClipboardCheck className="h-4 w-4 text-blue-600" />
              <span className="text-xs text-muted-foreground">Fulfillment Rate</span>
            </div>
            <p className="text-xl font-bold text-blue-600">{fulfillmentRate}%</p>
            <div className="mt-1 h-1 bg-blue-200/50 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full" style={{ width: `${fulfillmentRate}%` }} />
            </div>
          </div>
          <div className="p-3 rounded-lg bg-amber-50/80 dark:bg-amber-900/20 backdrop-blur-sm border border-amber-200/30 dark:border-amber-800/30">
            <div className="flex items-center gap-2 mb-1">
              <Timer className="h-4 w-4 text-amber-600" />
              <span className="text-xs text-muted-foreground">Avg. Lead Time</span>
            </div>
            <p className="text-xl font-bold text-amber-600">{avgLeadTime > 0 ? `${avgLeadTime}d` : '—'}</p>
          </div>
          <div className="p-3 rounded-lg bg-purple-50/80 dark:bg-purple-900/20 backdrop-blur-sm border border-purple-200/30 dark:border-purple-800/30">
            <div className="flex items-center gap-2 mb-1">
              <Star className="h-4 w-4 text-purple-600" />
              <span className="text-xs text-muted-foreground">Quality Rating</span>
            </div>
            <p className="text-xl font-bold text-purple-600">{qualityRating > 0 ? qualityRating : '—'}/5</p>
            {qualityRating > 0 && <StarRating rating={Math.round(qualityRating)} readonly />}
          </div>
        </div>

        {purchaseOrders.length === 0 && (
          <div className="text-center py-6 text-muted-foreground">
            <Award className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No purchase orders to evaluate performance</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ADD/EDIT SUPPLIER DIALOG

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
    onError: (err: unknown) => {
      const msg = handleError(err, 'Create supplier');
      toast.error(msg);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: typeof form) => suppliersApi.update(editSupplier!.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['supplier-detail'] });
      toast.success('Supplier updated successfully');
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      const msg = handleError(err, 'Update supplier');
      toast.error(msg);
    },
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
              <Label htmlFor="taxPin">Tax PIN</Label>
              <Input id="taxPin" value={form.taxPin} onChange={(e) => setForm({ ...form, taxPin: e.target.value })} placeholder="P0512345678" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="paymentTerms">Payment Terms</Label>
              <Select value={form.paymentTerms} onValueChange={(v) => setForm({ ...form, paymentTerms: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="IMMEDIATE">Immediate</SelectItem>
                  <SelectItem value="NET_15">Net 15</SelectItem>
                  <SelectItem value="NET_30">Net 30</SelectItem>
                  <SelectItem value="NET_60">Net 60</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
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
  const [poItems, setPoItems] = useState<{ productId: string; name: string; sku: string; quantity: string; unitPrice: string; currentStock: number }[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [lowStockLoading, setLowStockLoading] = useState(false);

  // Product search query (debounced via query key)
  const { data: productSearchData, isLoading: productSearchLoading } = useQuery({
    queryKey: ['po-product-search', storeId, productSearch],
    queryFn: () => productsApi.search(productSearch, storeId),
    enabled: open && productSearch.length >= 2,
  });

  const searchResults: ProductListItem[] = Array.isArray(productSearchData?.data) ? productSearchData.data : [];

  // Add product from search dropdown
  const addProductFromSearch = (product: ProductListItem) => {
    if (poItems.find(i => i.productId === product.id)) {
      toast.error('Product already added');
      return;
    }
    setPoItems([...poItems, {
      productId: product.id,
      name: product.name,
      sku: product.sku,
      quantity: '1',
      unitPrice: String(product.costPrice),
      currentStock: product.quantityInStock,
    }]);
    setProductSearch('');
  };

  // Add low stock items
  const addLowStockItems = async () => {
    setLowStockLoading(true);
    try {
      const res = await productsApi.list({ storeId, limit: 200 });
      const allProducts: ProductListItem[] = Array.isArray(res?.data) ? res.data : [];
      const lowStockProducts = allProducts.filter(
        (p) => p.isActive && p.quantityInStock <= p.reorderLevel && !poItems.find(i => i.productId === p.id)
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
        unitPrice: String(p.costPrice),
        currentStock: p.quantityInStock,
      }));
      setPoItems([...poItems, ...newItems]);
      toast.success(`Added ${newItems.length} low-stock item${newItems.length > 1 ? 's' : ''}`);
    } catch (err) {
      toast.error('Failed to load low-stock products');
    } finally {
      setLowStockLoading(false);
    }
  };

  const removeItem = (index: number) => {
    setPoItems(poItems.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, field: 'quantity' | 'unitPrice', value: string) => {
    const updated = [...poItems];
    updated[index] = { ...updated[index], [field]: value };
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
    onError: (err: unknown) => {
      const msg = handleError(err, 'Create purchase order');
      toast.error(msg);
    },
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

          {/* Product Search with Dropdown */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Add Products</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addLowStockItems}
                disabled={lowStockLoading}
              >
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
                    .filter(p => !poItems.find(i => i.productId === p.id))
                    .slice(0, 10)
                    .map(product => (
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

          {/* PO Items List */}
          {poItems.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                Order Items ({poItems.length}) &middot; Total Qty: {poItems.reduce((s, i) => s + (parseFloat(i.quantity) || 0), 0)}
              </p>
              <div className="border rounded-md divide-y max-h-60 overflow-y-auto custom-scrollbar">
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
                        <Label className="text-[10px] text-muted-foreground">Unit Price</Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.unitPrice}
                          onChange={(e) => updateItem(index, 'unitPrice', e.target.value)}
                          className="h-7 text-xs text-center"
                        />
                      </div>
                      <div className="text-right w-20">
                        <Label className="text-[10px] text-muted-foreground">Total</Label>
                        <p className="text-xs font-medium">
                          {formatKES((parseFloat(item.quantity) || 0) * (parseFloat(item.unitPrice) || 0))}
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
              {totalAmount > 0 && (
                <div className="text-right text-sm font-medium pt-2 border-t">
                  Total: {formatKES(totalAmount)}
                </div>
              )}
            </div>
          )}

          {poItems.length === 0 && productSearch.length < 2 && (
            <div className="text-center py-6 text-muted-foreground border rounded-md border-dashed">
              <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Search for products above or add low-stock items</p>
            </div>
          )}

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
    onError: (err: unknown) => {
      const msg = handleError(err, 'Receive PO items');
      toast.error(msg);
    },
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

  const purchaseOrders = Array.isArray(poData?.data) ? poData.data : [];

  const deleteMutation = useMutation({
    mutationFn: () => suppliersApi.delete(supplierId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success('Supplier deactivated');
      onBack();
    },
    onError: (err: unknown) => {
      const msg = handleError(err, 'Deactivate supplier');
      toast.error(msg);
    },
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
  const lastOrderDate = purchaseOrders.length > 0
    ? purchaseOrders.sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime())[0]?.orderDate
    : null;

  return (
    <div className="space-y-4">
      {/* Header - Glass-morphism */}
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
            <Badge className={`text-xs ${supplier.isActive ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full mr-1 ${supplier.isActive ? 'bg-green-500' : 'bg-red-500'}`} />
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

      {/* Summary Cards - Glass-morphism */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="border-l-4 border-l-blue-500 backdrop-blur-sm bg-card/80">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total POs</p>
                <p className="text-xl font-bold">{summary.totalPOs}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-amber-500 backdrop-blur-sm bg-card/80">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pending Orders</p>
                <p className="text-xl font-bold">{summary.pendingPOs}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-green-500 backdrop-blur-sm bg-card/80">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0">
                <Truck className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Spend</p>
                <p className="text-xl font-bold">{formatKES(summary.totalPOValue)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-violet-500 backdrop-blur-sm bg-card/80">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center shrink-0">
                <CalendarDays className="h-5 w-5 text-violet-600 dark:text-violet-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Last Order</p>
                <p className="text-lg font-bold">{lastOrderDate ? formatDate(lastOrderDate) : '—'}</p>
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
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="contact">Contact</TabsTrigger>
        </TabsList>

        <TabsContent value="info" className="mt-4">
          <Card className="backdrop-blur-sm bg-card/80">
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
          <Card className="backdrop-blur-sm bg-card/80">
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
                  <p className="text-xs mt-1">Create a PO to start tracking orders</p>
                </div>
              ) : (
                <div className="max-h-96 overflow-auto custom-scrollbar">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>PO #</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Status Timeline</TableHead>
                        <TableHead>Delivery</TableHead>
                        <TableHead>Received</TableHead>
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
                            <POStatusTimeline status={po.status} />
                          </TableCell>
                          <TableCell>
                            <DeliveryStatusIndicator po={po} />
                          </TableCell>
                          <TableCell className="w-[120px]">
                            <POReceivingProgress po={po} />
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

        <TabsContent value="performance" className="mt-4">
          <SupplierPerformanceCard purchaseOrders={purchaseOrders} />
        </TabsContent>

        <TabsContent value="contact" className="mt-4">
          <Card className="backdrop-blur-sm bg-card/80">
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

              {/* Send options */}
              <Separator />
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Quick Send</p>
                <div className="flex flex-wrap gap-2">
                  {supplier.phone && (
                    <>
                      <Button
                        size="sm"
                        className="gap-1.5 bg-green-600 hover:bg-green-700 text-white"
                        onClick={() => {
                          const message = `Hello ${supplier.name}, this is Mbumah Hardware. We wanted to reach out regarding our supplier relationship.`;
                          openWhatsApp(supplier.phone!, message);
                        }}
                      >
                        <MessageSquare className="h-4 w-4" /> WhatsApp
                      </Button>
                      <Button
                        size="sm"
                        className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
                        onClick={() => {
                          const message = `Hello ${supplier.name}, this is Mbumah Hardware. We wanted to reach out regarding our supplier relationship.`;
                          openSMS(supplier.phone!, message);
                        }}
                      >
                        <Phone className="h-4 w-4" /> SMS
                      </Button>
                    </>
                  )}
                  {supplier.email && (
                    <Button
                      size="sm"
                      className="gap-1.5 bg-orange-600 hover:bg-orange-700 text-white"
                      onClick={() => {
                        const subject = `Mbumah Hardware - Supplier Communication`;
                        const body = `Dear ${supplier.contactPerson || supplier.name},\n\nThis is a message from Mbumah Hardware.\n\nBest regards,\nMbumah Hardware Team`;
                        openEmail(supplier.email!, subject, body);
                      }}
                    >
                      <Mail className="h-4 w-4" /> Email
                    </Button>
                  )}
                  {!supplier.phone && !supplier.email && (
                    <p className="text-xs text-muted-foreground">No phone or email available for sending.</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AddSupplierDialog open={editOpen} onOpenChange={setEditOpen} storeId={storeId} editSupplier={supplier} />
      <ReceivePODialog open={receivePOOpen} onOpenChange={setReceivePOOpen} purchaseOrder={selectedPO} />
    </div>
  );
}

function POActions({ po, storeId }: { po: PurchaseOrderListItem; storeId: string }) {
  const queryClient = useQueryClient();
  const [receiveOpen, setReceiveOpen] = useState(false);

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
    onError: (err: unknown) => {
      const msg = handleError(err, 'Update PO status');
      toast.error(msg);
    },
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

// ─── Send Order Dialog ─────────────────────────────────────────────────────
//
// Send a purchase order (or a custom message) to a supplier via WhatsApp or
// Email. Calls suppliersApi.sendOrder(id, { channel, purchaseOrderId, message })
// which returns { waLink, channel, recipient, message, subject } — opens the
// waLink in a new tab on success.

function SendOrderDialog({
  open,
  onOpenChange,
  supplier,
  storeId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplier: SupplierItem | null;
  storeId: string;
}) {
  const queryClient = useQueryClient();
  // Lazy initialisers — when the parent remounts this dialog with a new `key`
  // (per supplier.id), these run once with the new supplier so the form
  // pre-fills correctly. Avoids setState-in-effect.
  const [channel, setChannel] = useState<'WHATSAPP' | 'EMAIL'>('WHATSAPP');
  const [purchaseOrderId, setPurchaseOrderId] = useState<string>('none');
  const [message, setMessage] = useState(() =>
    `Hello ${supplier?.contactPerson || supplier?.name || 'there'}, this is Mbumah Hardware. ` +
    `We would like to place an order. Please confirm availability and pricing. Thank you!`,
  );

  // Load this supplier's POs so the user can attach one (optional).
  const { data: poData, isLoading: poLoading } = useQuery({
    queryKey: ['supplier-purchase-orders', storeId, supplier?.id],
    queryFn: () => purchaseOrdersApi.list({ storeId, supplierId: supplier?.id, limit: 50 }),
    enabled: !!supplier && open,
  });
  const purchaseOrders: PurchaseOrderListItem[] = Array.isArray(poData?.data) ? poData.data : [];

  const sendMutation = useMutation({
    mutationFn: async (): Promise<SupplierSendOrderResult> => {
      if (!supplier) throw new Error('No supplier selected');
      // Either a PO id OR a custom message must be provided.
      const payload: {
        purchaseOrderId?: string;
        message?: string;
        channel: 'WHATSAPP' | 'EMAIL';
      } = { channel };
      if (purchaseOrderId && purchaseOrderId !== 'none') {
        payload.purchaseOrderId = purchaseOrderId;
        if (message.trim()) payload.message = message.trim();
      } else {
        if (!message.trim()) throw new Error('Message is required when no purchase order is selected');
        payload.message = message.trim();
      }
      // Preferred: typed API client (returns ApiResponse<SupplierSendOrderResult>).
      try {
        const res = await suppliersApi.sendOrder(supplier.id, payload);
        if (res?.data) return res.data;
      } catch {
        // fall through to direct fetch
      }
      // Fallback: direct fetch with same-origin credentials.
      const r = await fetch(`/api/suppliers/${supplier.id}/send-order`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = (await r.json()) as { success?: boolean; data?: SupplierSendOrderResult; error?: string };
      if (!json.success || !json.data) {
        throw new Error(json.error || `Request failed: ${r.status}`);
      }
      return json.data;
    },
    onSuccess: (result) => {
      toast.success(`Order sent to ${supplier?.name || 'supplier'} via ${result.channel}`);
      // Open the WhatsApp / mailto link in a new tab so the user can dispatch it.
      if (result.waLink) {
        try {
          window.open(result.waLink, '_blank');
        } catch {
          /* pop-up blocked — link is also visible in the success toast */
        }
      }
      queryClient.invalidateQueries({ queryKey: ['messages', storeId] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders', storeId] });
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      const msg = handleError(err, 'Send order to supplier');
      toast.error(msg);
    },
  });

  if (!supplier) return null;

  // Channel-specific helper text
  const channelMissing = channel === 'WHATSAPP' ? !supplier.phone : !supplier.email;

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={
        <span className="flex items-center gap-2">
          <Send className="h-5 w-5 text-primary" />
          Send Order to {supplier.name}
        </span>
      }
      description={
        channel === 'WHATSAPP'
          ? `Generates a WhatsApp deep link ${supplier.phone ? `to ${supplier.phone}` : '(no phone on file)'} you can open and send.`
          : `Generates an email ${supplier.email ? `to ${supplier.email}` : '(no email on file)'} with the order details.`
      }
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sendMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => sendMutation.mutate()}
            disabled={sendMutation.isPending || channelMissing || (purchaseOrderId === 'none' && !message.trim())}
            className="bg-green-600 hover:bg-green-700 text-white gap-2"
          >
            {sendMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send via {channel === 'WHATSAPP' ? 'WhatsApp' : 'Email'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {channelMissing && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800 dark:text-amber-300">
              This supplier has no {channel === 'WHATSAPP' ? 'phone number' : 'email address'} on file.
              {channel === 'WHATSAPP'
                ? ' Switch to Email or update the supplier profile first.'
                : ' Switch to WhatsApp or update the supplier profile first.'}
            </p>
          </div>
        )}

        {/* Channel */}
        <div className="space-y-2">
          <Label>Channel</Label>
          <Select value={channel} onValueChange={(v) => setChannel(v as 'WHATSAPP' | 'EMAIL')}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="WHATSAPP">
                <span className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-green-600" /> WhatsApp
                </span>
              </SelectItem>
              <SelectItem value="EMAIL">
                <span className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-amber-600" /> Email
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Optional PO selector */}
        <div className="space-y-2">
          <Label>Purchase Order <span className="text-muted-foreground">(optional)</span></Label>
          <Select value={purchaseOrderId} onValueChange={setPurchaseOrderId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a purchase order..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No PO — send custom message</SelectItem>
              {poLoading ? (
                <SelectItem value="__loading" disabled>Loading…</SelectItem>
              ) : purchaseOrders.length === 0 ? (
                <SelectItem value="__empty" disabled>No purchase orders on file</SelectItem>
              ) : (
                purchaseOrders.map((po) => (
                  <SelectItem key={po.id} value={po.id}>
                    {po.poNumber} · {formatKES(po.totalAmount)} · {po.status}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            Selecting a PO attaches the full order details (items, totals, expected delivery date) to the message.
          </p>
        </div>

        {/* Custom message (optional when a PO is selected, required otherwise) */}
        <div className="space-y-2">
          <Label>
            Custom Message
            {purchaseOrderId !== 'none' && <span className="text-muted-foreground"> (optional add-on)</span>}
            {purchaseOrderId === 'none' && <span className="text-red-500"> *</span>}
          </Label>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            placeholder="Type an optional message to accompany the order…"
            className="resize-y"
          />
          <p className="text-[11px] text-muted-foreground">{message.length} characters</p>
        </div>

        {/* Recipient summary */}
        <div className="rounded-lg border bg-muted/30 p-3 text-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Recipient</span>
            <span className="font-medium">
              {channel === 'WHATSAPP' ? (supplier.phone || '—') : (supplier.email || '—')}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Contact person</span>
            <span className="font-medium">{supplier.contactPerson || '—'}</span>
          </div>
        </div>
      </div>
    </ResponsiveDialog>
  );
}

export default function SuppliersTab() {
  const currentStoreId = useAppStore((s) => s.currentStoreId);
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [addOpen, setAddOpen] = useState(false);
  const [createPOOpen, setCreatePOOpen] = useState(false);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [poFilterStatus, setPoFilterStatus] = useState<string>('all');
  // Send Order dialog state
  const [sendOrderOpen, setSendOrderOpen] = useState(false);
  const [sendOrderSupplier, setSendOrderSupplier] = useState<SupplierItem | null>(null);

  // Debounce search input by 300ms so typing doesn't fire a request per keystroke.
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchQuery]);

  const { data: suppliersData, isLoading: suppliersLoading } = useQuery({
    queryKey: ['suppliers', currentStoreId, debouncedSearch, filterStatus],
    queryFn: () => suppliersApi.list({
      storeId: currentStoreId,
      search: debouncedSearch || undefined,
      isActive: filterStatus === 'all' ? undefined : filterStatus === 'active' ? 'true' : 'false',
      limit: 100,
    }),
    enabled: !!currentStoreId,
  });

  const { data: poData, isLoading: poLoading } = useQuery({
    queryKey: ['purchase-orders', currentStoreId, poFilterStatus],
    queryFn: () => purchaseOrdersApi.list({
      storeId: currentStoreId,
      status: poFilterStatus === 'all' ? undefined : poFilterStatus,
      limit: 50,
    }),
    enabled: !!currentStoreId,
  });

  const suppliers: SupplierItem[] = Array.isArray(suppliersData?.data) ? suppliersData.data : [];
  const purchaseOrders: PurchaseOrderListItem[] = Array.isArray(poData?.data) ? poData.data : [];

  const activeSuppliers = suppliers.filter((s) => s.isActive).length;
  const pendingPOs = purchaseOrders.filter((po) => ['DRAFT', 'SENT', 'CONFIRMED'].includes(po.status)).length;
  const totalPOValue = purchaseOrders
    .filter((po) => po.status !== 'CANCELLED')
    .reduce((sum, po) => sum + po.totalAmount, 0);
  const avgRating = suppliers.length > 0
    ? (suppliers.reduce((s, sup) => s + sup.rating, 0) / suppliers.length).toFixed(1)
    : '0';

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
      {/* Overview Stats - Glass-morphism */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-l-4 border-l-violet-500 backdrop-blur-sm bg-card/80">
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
        <Card className="border-l-4 border-l-green-500 backdrop-blur-sm bg-card/80">
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
        <Card className="border-l-4 border-l-amber-500 backdrop-blur-sm bg-card/80">
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
        <Card className="border-l-4 border-l-teal-500 backdrop-blur-sm bg-card/80">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center shrink-0">
                <Star className="h-5 w-5 text-teal-600 dark:text-teal-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Avg. Rating</p>
                <p className="text-xl font-bold">{avgRating}/5</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Supplier List - Cards */}
      <Card className="backdrop-blur-sm bg-card/80 border-border/50">
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
            <div className="text-center py-16 text-muted-foreground">
              <div className="relative mx-auto w-20 h-20 mb-4">
                <div className="absolute inset-0 bg-muted/50 backdrop-blur-sm rounded-2xl border border-border/30" />
                <Truck className="absolute inset-0 m-auto h-10 w-10 text-muted-foreground/30" />
              </div>
              <p className="text-base font-medium">No suppliers found</p>
              <p className="text-sm text-muted-foreground/60 mt-1">Add your first supplier to get started</p>
              <Button size="sm" className="mt-3" onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4 mr-1" /> Add Supplier
              </Button>
            </div>
          ) : (
            <div className="max-h-96 overflow-auto custom-scrollbar">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Supplier</TableHead>
                    <TableHead className="hidden md:table-cell">Contact</TableHead>
                    <TableHead className="hidden sm:table-cell">City</TableHead>
                    <TableHead>Rating</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden sm:table-cell">Last Order</TableHead>
                    <TableHead className="text-right">POs</TableHead>
                    <TableHead className="w-[60px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {suppliers.map((supplier) => (
                    <TableRow
                      key={supplier.id}
                      className="cursor-pointer hover:bg-muted/50 transition-colors"
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
                      <TableCell>
                        <Badge className={`text-xs ${supplier.isActive ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full mr-1 inline-block ${supplier.isActive ? 'bg-green-500' : 'bg-red-500'}`} />
                          {supplier.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                        {supplier.purchaseOrders?.[0]?.orderDate ? formatDate(supplier.purchaseOrders[0].orderDate) : '—'}
                      </TableCell>
                      <TableCell className="text-right font-medium">{supplier.purchaseOrderCount || 0}</TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 shrink-0"
                              aria-label={`Actions for ${supplier.name}`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                            <DropdownMenuLabel className="text-xs text-muted-foreground">
                              {supplier.name}
                            </DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onSelect={(e) => {
                                e.preventDefault();
                                setSendOrderSupplier(supplier);
                                setSendOrderOpen(true);
                              }}
                              className="gap-2 cursor-pointer"
                            >
                              <Send className="h-4 w-4 text-green-600" />
                              Send Order…
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={(e) => {
                                e.preventDefault();
                                setSelectedSupplierId(supplier.id);
                              }}
                              className="gap-2 cursor-pointer"
                            >
                              <Eye className="h-4 w-4" />
                              View Details
                            </DropdownMenuItem>
                            {supplier.phone && (
                              <DropdownMenuItem
                                onSelect={(e) => {
                                  e.preventDefault();
                                  openWhatsApp(
                                    supplier.phone!,
                                    `Hello ${supplier.name}, this is Mbumah Hardware. We wanted to reach out regarding our supplier relationship.`,
                                  );
                                }}
                                className="gap-2 cursor-pointer"
                              >
                                <Phone className="h-4 w-4 text-green-600" />
                                Quick WhatsApp
                              </DropdownMenuItem>
                            )}
                            {supplier.email && (
                              <DropdownMenuItem
                                onSelect={(e) => {
                                  e.preventDefault();
                                  openEmail(
                                    supplier.email!,
                                    `Mbumah Hardware - Supplier Communication`,
                                    `Dear ${supplier.contactPerson || supplier.name},\n\nThis is a message from Mbumah Hardware.\n\nBest regards,\nMbumah Hardware Team`,
                                  );
                                }}
                                className="gap-2 cursor-pointer"
                              >
                                <Mail className="h-4 w-4 text-amber-600" />
                                Quick Email
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Purchase Orders Section - */}
      <Card className="backdrop-blur-sm bg-card/80 border-border/50">
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
            <div className="text-center py-12 text-muted-foreground">
              <div className="relative mx-auto w-16 h-16 mb-3">
                <div className="absolute inset-0 bg-muted/50 backdrop-blur-sm rounded-2xl border border-border/30" />
                <Package className="absolute inset-0 m-auto h-8 w-8 text-muted-foreground/30" />
              </div>
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
                    <TableHead>Status Timeline</TableHead>
                    <TableHead>Delivery</TableHead>
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
                        <POStatusTimeline status={po.status} />
                      </TableCell>
                      <TableCell>
                        <DeliveryStatusIndicator po={po} />
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
      <SendOrderDialog
        key={sendOrderSupplier?.id ?? 'none'}
        open={sendOrderOpen}
        onOpenChange={(open) => {
          setSendOrderOpen(open);
          if (!open) setSendOrderSupplier(null);
        }}
        supplier={sendOrderSupplier}
        storeId={currentStoreId}
      />
    </div>
  );
}
