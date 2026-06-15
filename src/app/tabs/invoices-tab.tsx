'use client';

import React, { useState, useMemo, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  FileText, Search, Plus, Eye, Loader2, Printer,
  ArrowRightLeft, XCircle, DollarSign, Clock,
  TrendingUp, AlertCircle, ShoppingCart, Receipt,
  FileCheck, FileMinus, FilePlus, ChevronDown,
  Trash2, ArrowUpDown, Send, CheckCircle2, Phone,
} from 'lucide-react';

import { useAppStore } from '@/lib/stores';
import {
  invoicesApi, productsApi, customersApi,
  formatKES, formatDate, formatDateTime,
  openWhatsApp,
  type InvoiceItem,
  type InvoiceItemDetail,
  type ProductListItem,
  type CustomerItem,
} from '@/lib/api';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';

// ─── Types ───────────────────────────────────────────────────────────────────

type InvoiceType = 'INVOICE' | 'QUOTATION' | 'PROFORMA' | 'CREDIT_NOTE' | 'DEBIT_NOTE';
type InvoiceStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'INVOICED' | 'PAID' | 'CANCELLED' | 'EXPIRED';
type TypeFilterTab = 'all' | InvoiceType;

interface LineItemDraft {
  key: string;
  productId: string | null;
  productName: string;
  description: string;
  quantity: number;
  unitType: string;
  pricePerUnit: number;
  discountPercent: number;
  taxRate: number;
}

// ─── Badge helpers ───────────────────────────────────────────────────────────

function getStatusBadge(status: InvoiceStatus) {
  const map: Record<InvoiceStatus, { label: string; className: string }> = {
    DRAFT: { label: 'Draft', className: 'bg-gray-100 text-gray-700 dark:bg-gray-800/50 dark:text-gray-300' },
    SENT: { label: 'Sent', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
    ACCEPTED: { label: 'Accepted', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
    INVOICED: { label: 'Invoiced', className: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400' },
    PAID: { label: 'Paid', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
    CANCELLED: { label: 'Cancelled', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
    EXPIRED: { label: 'Expired', className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
  };
  const s = map[status] || map.DRAFT;
  return <Badge variant="secondary" className={`text-[10px] font-semibold px-2 py-0.5 ${s.className}`}>{s.label}</Badge>;
}

function getTypeBadge(type: InvoiceType) {
  const map: Record<InvoiceType, { label: string; className: string; icon: React.ReactNode }> = {
    INVOICE: { label: 'Invoice', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', icon: <FileText className="h-3 w-3" /> },
    QUOTATION: { label: 'Quotation', className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400', icon: <Receipt className="h-3 w-3" /> },
    PROFORMA: { label: 'Proforma', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', icon: <FileCheck className="h-3 w-3" /> },
    CREDIT_NOTE: { label: 'Credit Note', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', icon: <FileMinus className="h-3 w-3" /> },
    DEBIT_NOTE: { label: 'Debit Note', className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400', icon: <FilePlus className="h-3 w-3" /> },
  };
  const t = map[type] || map.INVOICE;
  return (
    <Badge variant="secondary" className={`text-[10px] font-semibold px-2 py-0.5 gap-1 ${t.className}`}>
      {t.icon} {t.label}
    </Badge>
  );
}

function getTypeIcon(type: InvoiceType) {
  switch (type) {
    case 'INVOICE': return <FileText className="h-4 w-4 text-blue-500" />;
    case 'QUOTATION': return <Receipt className="h-4 w-4 text-purple-500" />;
    case 'PROFORMA': return <FileCheck className="h-4 w-4 text-amber-500" />;
    case 'CREDIT_NOTE': return <FileMinus className="h-4 w-4 text-red-500" />;
    case 'DEBIT_NOTE': return <FilePlus className="h-4 w-4 text-orange-500" />;
    default: return <FileText className="h-4 w-4" />;
  }
}

// ─── Line item calculator ────────────────────────────────────────────────────

function computeLineTotal(item: LineItemDraft): number {
  const base = item.quantity * item.pricePerUnit;
  const discount = base * (item.discountPercent / 100);
  const afterDiscount = base - discount;
  const tax = afterDiscount * (item.taxRate / 100);
  return afterDiscount + tax;
}

function computeLineSubtotal(item: LineItemDraft): number {
  return item.quantity * item.pricePerUnit;
}

function computeLineTax(item: LineItemDraft): number {
  const base = item.quantity * item.pricePerUnit;
  const discount = base * (item.discountPercent / 100);
  return (base - discount) * (item.taxRate / 100);
}

let lineItemCounter = 0;
function newLineItemKey(): string {
  return `line-${Date.now()}-${++lineItemCounter}`;
}

function createEmptyLineItem(): LineItemDraft {
  return {
    key: newLineItemKey(),
    productId: null,
    productName: '',
    description: '',
    quantity: 1,
    unitType: 'PIECE',
    pricePerUnit: 0,
    discountPercent: 0,
    taxRate: 16,
  };
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function InvoicesTab() {
  const currentStoreId = useAppStore((s) => s.currentStoreId);
  const queryClient = useQueryClient();

  // ── State ──
  const [typeFilter, setTypeFilter] = useState<TypeFilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createType, setCreateType] = useState<InvoiceType>('INVOICE');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState('');
  const [discountAmount, setDiscountAmount] = useState('0');
  const [notes, setNotes] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [terms, setTerms] = useState('');
  const [lineItems, setLineItems] = useState<LineItemDraft[]>([createEmptyLineItem()]);
  const [productSearch, setProductSearch] = useState('');
  const [showProductDropdown, setShowProductDropdown] = useState<number | null>(null);

  // View dialog
  const [viewOpen, setViewOpen] = useState(false);
  const [viewingInvoice, setViewingInvoice] = useState<InvoiceItem | null>(null);

  // Sort
  const [sortField, setSortField] = useState<'invoiceNumber' | 'totalAmount' | 'createdAt' | 'issueDate'>('createdAt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // ── Queries ──
  const { data: invoicesData, isLoading } = useQuery({
    queryKey: ['invoices', currentStoreId, typeFilter, statusFilter],
    queryFn: () => invoicesApi.list({
      storeId: currentStoreId,
      invoiceType: typeFilter === 'all' ? undefined : typeFilter,
      status: statusFilter === 'all' ? undefined : statusFilter,
    }),
  });

  const { data: invoiceDetailData } = useQuery({
    queryKey: ['invoice-detail', viewingInvoice?.id],
    queryFn: () => invoicesApi.get(viewingInvoice!.id),
    enabled: !!viewingInvoice?.id && viewOpen,
  });

  const { data: productsData } = useQuery({
    queryKey: ['products', currentStoreId, productSearch],
    queryFn: () => productsApi.list({ storeId: currentStoreId, search: productSearch || undefined, limit: 50 }),
  });

  const { data: customersData } = useQuery({
    queryKey: ['customers', currentStoreId],
    queryFn: () => customersApi.list({ storeId: currentStoreId, limit: 200 }),
  });

  // ── Mutations ──
  const createMutation = useMutation({
    mutationFn: invoicesApi.create,
    onSuccess: () => {
      toast.success('Document created successfully');
      queryClient.invalidateQueries({ queryKey: ['invoices', currentStoreId] });
      resetCreateForm();
      setCreateOpen(false);
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to create document'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => invoicesApi.update(id, data),
    onSuccess: (_, variables) => {
      toast.success('Document updated');
      queryClient.invalidateQueries({ queryKey: ['invoices', currentStoreId] });
      if (viewingInvoice?.id) {
        queryClient.invalidateQueries({ queryKey: ['invoice-detail', variables.id] });
      }
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to update document'),
  });

  // ── Derived data ──
  const rawInvoices: InvoiceItem[] = (invoicesData?.data as InvoiceItem[]) || [];
  const customers: CustomerItem[] = (customersData?.data as CustomerItem[]) || [];
  const products: ProductListItem[] = (productsData?.data as ProductListItem[]) || [];
  const invoiceDetail = invoiceDetailData?.data as InvoiceItem | undefined;

  // Filter by search
  const invoices = useMemo(() => {
    let result = rawInvoices;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(inv =>
        inv.invoiceNumber.toLowerCase().includes(q) ||
        inv.customerName.toLowerCase().includes(q) ||
        (inv.customerPhone && inv.customerPhone.includes(q)) ||
        (inv.customerEmail && inv.customerEmail.toLowerCase().includes(q))
      );
    }
    // Sort
    result = [...result].sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;
      switch (sortField) {
        case 'invoiceNumber': aVal = a.invoiceNumber; bVal = b.invoiceNumber; break;
        case 'totalAmount': aVal = a.totalAmount; bVal = b.totalAmount; break;
        case 'issueDate': aVal = new Date(a.issueDate).getTime(); bVal = new Date(b.issueDate).getTime(); break;
        case 'createdAt': default: aVal = new Date(a.createdAt).getTime(); bVal = new Date(b.createdAt).getTime(); break;
      }
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    return result;
  }, [rawInvoices, searchQuery, sortField, sortDirection]);

  // Stats
  const stats = useMemo(() => {
    const invoicesOnly = rawInvoices.filter(i => i.invoiceType === 'INVOICE');
    const quotations = rawInvoices.filter(i => i.invoiceType === 'QUOTATION');
    const paidInvoices = rawInvoices.filter(i => i.status === 'PAID');
    const outstanding = rawInvoices.filter(i =>
      ['DRAFT', 'SENT', 'ACCEPTED', 'INVOICED'].includes(i.status) && i.invoiceType === 'INVOICE'
    );
    const pendingQuotations = quotations.filter(i => ['DRAFT', 'SENT'].includes(i.status));
    return {
      totalInvoices: invoicesOnly.length,
      totalRevenue: paidInvoices.reduce((s, i) => s + i.totalAmount, 0),
      outstandingAmount: outstanding.reduce((s, i) => s + i.totalAmount, 0),
      pendingQuotations: pendingQuotations.length,
    };
  }, [rawInvoices]);

  // ── Calculations for create form ──
  const subtotal = useMemo(() => lineItems.reduce((s, item) => s + computeLineSubtotal(item), 0), [lineItems]);
  const totalTax = useMemo(() => lineItems.reduce((s, item) => s + computeLineTax(item), 0), [lineItems]);
  const discountNum = parseFloat(discountAmount) || 0;
  const grandTotal = subtotal - discountNum + totalTax;

  // ── Helpers ──
  const resetCreateForm = useCallback(() => {
    setCreateType('INVOICE');
    setSelectedCustomerId('');
    setCustomerName('');
    setCustomerPhone('');
    setCustomerEmail('');
    setCustomerAddress('');
    setIssueDate(new Date().toISOString().split('T')[0]);
    setDueDate('');
    setDiscountAmount('0');
    setNotes('');
    setInternalNotes('');
    setTerms('');
    setLineItems([createEmptyLineItem()]);
    setProductSearch('');
    setShowProductDropdown(null);
  }, []);

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const handleSelectCustomer = (customerId: string) => {
    setSelectedCustomerId(customerId);
    if (!customerId) {
      setCustomerName('');
      setCustomerPhone('');
      setCustomerEmail('');
      setCustomerAddress('');
      return;
    }
    const customer = customers.find(c => c.id === customerId);
    if (customer) {
      setCustomerName(customer.name);
      setCustomerPhone(customer.phone || '');
      setCustomerEmail(customer.email || '');
      setCustomerAddress(customer.address || '');
    }
  };

  const updateLineItem = (index: number, updates: Partial<LineItemDraft>) => {
    setLineItems(prev => prev.map((item, i) => i === index ? { ...item, ...updates } : item));
  };

  const removeLineItem = (index: number) => {
    setLineItems(prev => prev.length > 1 ? prev.filter((_, i) => i !== index) : prev);
  };

  const addLineItem = () => {
    setLineItems(prev => [...prev, createEmptyLineItem()]);
  };

  const addProductToLine = (index: number, product: ProductListItem) => {
    updateLineItem(index, {
      productId: product.id,
      productName: product.name,
      description: product.description || '',
      pricePerUnit: product.pricePerUnit,
      unitType: product.unitType,
      taxRate: product.taxRate,
      quantity: 1,
    });
    setShowProductDropdown(null);
    setProductSearch('');
  };

  const handleCreate = () => {
    if (!customerName.trim()) {
      toast.error('Customer name is required');
      return;
    }
    if (lineItems.some(item => !item.productName.trim())) {
      toast.error('All line items must have a product name');
      return;
    }
    if (lineItems.some(item => item.quantity <= 0)) {
      toast.error('All line items must have a quantity greater than 0');
      return;
    }

    createMutation.mutate({
      storeId: currentStoreId,
      invoiceType: createType,
      customerId: selectedCustomerId || null,
      customerName,
      customerPhone: customerPhone || null,
      customerEmail: customerEmail || null,
      customerAddress: customerAddress || null,
      issueDate,
      dueDate: dueDate || null,
      discountAmount: discountNum,
      notes: [notes, internalNotes ? `[Internal] ${internalNotes}` : ''].filter(Boolean).join('\n') || null,
      terms: terms || null,
      items: lineItems.map(item => ({
        productId: item.productId,
        productName: item.productName,
        description: item.description || null,
        quantity: item.quantity,
        unitType: item.unitType,
        pricePerUnit: item.pricePerUnit,
        discountPercent: item.discountPercent,
        taxRate: item.taxRate,
      })),
    });
  };

  const handleView = (invoice: InvoiceItem) => {
    setViewingInvoice(invoice);
    setViewOpen(true);
  };

  const handleConvertToInvoice = (invoice: InvoiceItem) => {
    if (invoice.invoiceType !== 'QUOTATION') return;
    createMutation.mutate({
      storeId: invoice.storeId,
      invoiceType: 'INVOICE',
      customerId: invoice.customerId,
      customerName: invoice.customerName,
      customerPhone: invoice.customerPhone,
      customerEmail: invoice.customerEmail,
      customerAddress: invoice.customerAddress,
      issueDate: new Date().toISOString().split('T')[0],
      dueDate: invoice.dueDate,
      discountAmount: invoice.discountAmount,
      notes: `Converted from ${invoice.invoiceNumber}`,
      terms: invoice.terms,
      items: (invoice.items || []).map(item => ({
        productId: item.productId,
        productName: item.productName,
        description: item.description,
        quantity: item.quantity,
        unitType: item.unitType,
        pricePerUnit: item.pricePerUnit,
        discountPercent: item.discountPercent,
        taxRate: item.taxRate,
      })),
    });
  };

  const handleStatusChange = (invoice: InvoiceItem, status: InvoiceStatus) => {
    updateMutation.mutate({ id: invoice.id, data: { status } });
  };

  const handlePrint = () => {
    window.print();
  };

  const handleSendWhatsApp = (invoice: InvoiceItem) => {
    const phone = invoice.customerPhone || '';
    const itemsList = invoice.items
      ? invoice.items.map((item, i) => `${i + 1}. ${item.productName} x${item.quantity} ${item.unitType} — ${formatKES(item.lineTotal)}`).join('\n')
      : '';
    const message = [
      `*${invoice.invoiceType === 'QUOTATION' ? 'Quotation' : invoice.invoiceType === 'PROFORMA' ? 'Proforma' : 'Invoice'}: ${invoice.invoiceNumber}*`,
      `Date: ${formatDate(invoice.issueDate)}`,
      `Customer: ${invoice.customerName}`,
      '',
      itemsList ? `*Items:*\n${itemsList}` : '',
      `*Total: ${formatKES(invoice.totalAmount)}*`,
      invoice.dueDate ? `Due Date: ${formatDate(invoice.dueDate)}` : '',
      '',
      '— Mbumah Hardware',
    ].filter(Boolean).join('\n');
    openWhatsApp(phone, message);
  };

  // ── Product dropdown ref ──
  const productDropdownRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Close product dropdown on outside click
  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (showProductDropdown === null) return;
      const el = productDropdownRefs.current[showProductDropdown];
      if (el && !el.contains(e.target as Node)) {
        setShowProductDropdown(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showProductDropdown]);

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Invoices</p>
                <p className="text-2xl font-bold">{stats.totalInvoices}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-purple-500">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                <Clock className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pending Quotations</p>
                <p className="text-2xl font-bold">{stats.pendingQuotations}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-emerald-500">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                <TrendingUp className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Revenue</p>
                <p className="text-xl font-bold">{formatKES(stats.totalRevenue)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-orange-500">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-100 dark:bg-orange-900/30">
                <AlertCircle className="h-5 w-5 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Outstanding</p>
                <p className="text-xl font-bold">{formatKES(stats.outstandingAmount)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Type Filter Tabs + Search + Create */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <Tabs value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeFilterTab)}>
            <TabsList className="h-9">
              <TabsTrigger value="all" className="text-xs px-3">All</TabsTrigger>
              <TabsTrigger value="INVOICE" className="text-xs px-3">Invoices</TabsTrigger>
              <TabsTrigger value="QUOTATION" className="text-xs px-3">Quotations</TabsTrigger>
              <TabsTrigger value="PROFORMA" className="text-xs px-3">Proformas</TabsTrigger>
              <TabsTrigger value="CREDIT_NOTE" className="text-xs px-3">Credit Notes</TabsTrigger>
              <TabsTrigger value="DEBIT_NOTE" className="text-xs px-3">Debit Notes</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search invoices..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-9 text-sm"
              />
            </div>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px] h-9 text-sm">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="DRAFT">Draft</SelectItem>
                <SelectItem value="SENT">Sent</SelectItem>
                <SelectItem value="ACCEPTED">Accepted</SelectItem>
                <SelectItem value="INVOICED">Invoiced</SelectItem>
                <SelectItem value="PAID">Paid</SelectItem>
                <SelectItem value="CANCELLED">Cancelled</SelectItem>
                <SelectItem value="EXPIRED">Expired</SelectItem>
              </SelectContent>
            </Select>

            <Button size="sm" className="h-9 gap-1.5" onClick={() => { resetCreateForm(); setCreateOpen(true); }}>
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">New Document</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4, 5].map(i => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : invoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <FileText className="h-12 w-12 mb-3 opacity-30" />
              <p className="text-sm font-medium">No documents found</p>
              <p className="text-xs">Create your first invoice or quotation to get started</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[140px]">
                      <Button variant="ghost" size="sm" className="h-auto p-0 font-semibold text-xs hover:bg-transparent" onClick={() => handleSort('invoiceNumber')}>
                        Number <ArrowUpDown className="h-3 w-3 ml-1" />
                      </Button>
                    </TableHead>
                    <TableHead className="w-[110px]">Type</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">
                      <Button variant="ghost" size="sm" className="h-auto p-0 font-semibold text-xs hover:bg-transparent" onClick={() => handleSort('totalAmount')}>
                        Amount <ArrowUpDown className="h-3 w-3 ml-1" />
                      </Button>
                    </TableHead>
                    <TableHead className="w-[100px]">Status</TableHead>
                    <TableHead className="w-[110px]">
                      <Button variant="ghost" size="sm" className="h-auto p-0 font-semibold text-xs hover:bg-transparent" onClick={() => handleSort('issueDate')}>
                        Date <ArrowUpDown className="h-3 w-3 ml-1" />
                      </Button>
                    </TableHead>
                    <TableHead className="w-[180px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((inv) => (
                    <TableRow key={inv.id} className="group cursor-pointer" onClick={() => handleView(inv)}>
                      <TableCell className="font-mono text-sm font-medium">
                        <div className="flex items-center gap-2">
                          {getTypeIcon(inv.invoiceType as InvoiceType)}
                          {inv.invoiceNumber}
                        </div>
                      </TableCell>
                      <TableCell>{getTypeBadge(inv.invoiceType as InvoiceType)}</TableCell>
                      <TableCell>
                        <div>
                          <p className="text-sm font-medium">{inv.customerName}</p>
                          {inv.customerPhone && (
                            <p className="text-xs text-muted-foreground">{inv.customerPhone}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatKES(inv.totalAmount)}
                      </TableCell>
                      <TableCell>{getStatusBadge(inv.status as InvoiceStatus)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(inv.issueDate)}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleView(inv)}
                            title="View"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>

                          {inv.invoiceType === 'QUOTATION' && ['DRAFT', 'SENT', 'ACCEPTED'].includes(inv.status) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-purple-600 hover:text-purple-700"
                              onClick={() => handleConvertToInvoice(inv)}
                              title="Convert to Invoice"
                              disabled={createMutation.isPending}
                            >
                              <ArrowRightLeft className="h-4 w-4" />
                            </Button>
                          )}

                          {inv.status === 'DRAFT' && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-blue-600 hover:text-blue-700"
                              onClick={() => handleStatusChange(inv, 'SENT')}
                              title="Mark as Sent"
                              disabled={updateMutation.isPending}
                            >
                              <Send className="h-4 w-4" />
                            </Button>
                          )}

                          {inv.invoiceType === 'INVOICE' && ['SENT', 'ACCEPTED'].includes(inv.status) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-emerald-600 hover:text-emerald-700"
                              onClick={() => handleStatusChange(inv, 'PAID')}
                              title="Mark as Paid"
                              disabled={updateMutation.isPending}
                            >
                              <CheckCircle2 className="h-4 w-4" />
                            </Button>
                          )}

                          {!['CANCELLED', 'PAID', 'EXPIRED'].includes(inv.status) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-red-500 hover:text-red-600"
                              onClick={() => handleStatusChange(inv, 'CANCELLED')}
                              title="Cancel"
                              disabled={updateMutation.isPending}
                            >
                              <XCircle className="h-4 w-4" />
                            </Button>
                          )}

                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => { setViewingInvoice(inv); setViewOpen(true); setTimeout(() => handlePrint(), 300); }}
                            title="Print"
                          >
                            <Printer className="h-4 w-4" />
                          </Button>

                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-900/20"
                            onClick={() => handleSendWhatsApp(inv)}
                            title="Send via WhatsApp"
                          >
                            <Phone className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Create Dialog ── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {getTypeIcon(createType)}
              Create New Document
            </DialogTitle>
            <DialogDescription>
              Generate a new invoice, quotation, or other financial document
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[80vh] -mx-6 px-6">
            <div className="space-y-6 pb-4">
              {/* Document Type + Customer */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Document Type</Label>
                  <Select value={createType} onValueChange={(v) => setCreateType(v as InvoiceType)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="INVOICE">
                        <span className="flex items-center gap-2"><FileText className="h-4 w-4 text-blue-500" /> Invoice</span>
                      </SelectItem>
                      <SelectItem value="QUOTATION">
                        <span className="flex items-center gap-2"><Receipt className="h-4 w-4 text-purple-500" /> Quotation</span>
                      </SelectItem>
                      <SelectItem value="PROFORMA">
                        <span className="flex items-center gap-2"><FileCheck className="h-4 w-4 text-amber-500" /> Proforma</span>
                      </SelectItem>
                      <SelectItem value="CREDIT_NOTE">
                        <span className="flex items-center gap-2"><FileMinus className="h-4 w-4 text-red-500" /> Credit Note</span>
                      </SelectItem>
                      <SelectItem value="DEBIT_NOTE">
                        <span className="flex items-center gap-2"><FilePlus className="h-4 w-4 text-orange-500" /> Debit Note</span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Customer</Label>
                  <Select value={selectedCustomerId} onValueChange={handleSelectCustomer}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a customer..." />
                    </SelectTrigger>
                    <SelectContent>
                      {customers.map(c => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name} {c.phone ? `(${c.phone})` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Customer Details */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Customer Name *</Label>
                  <Input
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Customer name"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="Phone number"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    placeholder="Email address"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Address</Label>
                  <Input
                    value={customerAddress}
                    onChange={(e) => setCustomerAddress(e.target.value)}
                    placeholder="Delivery address"
                  />
                </div>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Issue Date</Label>
                  <Input
                    type="date"
                    value={issueDate}
                    onChange={(e) => setIssueDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Due Date</Label>
                  <Input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </div>
              </div>

              <Separator />

              {/* Line Items */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-base font-semibold">Line Items</Label>
                  <Button variant="outline" size="sm" onClick={addLineItem} className="gap-1.5">
                    <Plus className="h-3.5 w-3.5" /> Add Item
                  </Button>
                </div>

                <div className="space-y-3">
                  {lineItems.map((item, index) => (
                    <Card key={item.key} className="p-4">
                      <div className="grid grid-cols-12 gap-3 items-start">
                        {/* Product name / search */}
                        <div className="col-span-12 md:col-span-3 space-y-1 relative">
                          <Label className="text-xs">Product</Label>
                          <div ref={(el) => { productDropdownRefs.current[index] = el; }}>
                            <div className="relative">
                              <Input
                                value={item.productName}
                                onChange={(e) => {
                                  updateLineItem(index, { productName: e.target.value, productId: null });
                                  setProductSearch(e.target.value);
                                  setShowProductDropdown(index);
                                }}
                                onFocus={() => setShowProductDropdown(index)}
                                placeholder="Search or type product name"
                                className="text-sm"
                              />
                              <Button
                                variant="ghost"
                                size="icon"
                                className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
                                onClick={() => setShowProductDropdown(showProductDropdown === index ? null : index)}
                              >
                                <ChevronDown className="h-3.5 w-3.5" />
                              </Button>
                            </div>

                            {showProductDropdown === index && (
                              <div className="absolute z-50 top-full mt-1 w-full bg-popover border rounded-md shadow-lg max-h-48 overflow-y-auto">
                                <div className="p-2 border-b">
                                  <Input
                                    placeholder="Search products..."
                                    value={productSearch}
                                    onChange={(e) => setProductSearch(e.target.value)}
                                    className="h-7 text-xs"
                                    autoFocus
                                  />
                                </div>
                                {products
                                  .filter(p => !productSearch || p.name.toLowerCase().includes(productSearch.toLowerCase()))
                                  .slice(0, 10)
                                  .map(product => (
                                    <button
                                      key={product.id}
                                      className="w-full text-left px-3 py-2 hover:bg-accent text-sm flex items-center justify-between"
                                      onClick={() => addProductToLine(index, product)}
                                    >
                                      <div>
                                        <span className="font-medium">{product.name}</span>
                                        <span className="text-muted-foreground ml-2 text-xs">{product.sku}</span>
                                      </div>
                                      <span className="text-xs font-medium">{formatKES(product.pricePerUnit)}</span>
                                    </button>
                                  ))}
                                {products.filter(p => !productSearch || p.name.toLowerCase().includes(productSearch.toLowerCase())).length === 0 && (
                                  <div className="px-3 py-4 text-center text-xs text-muted-foreground">No products found</div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Description */}
                        <div className="col-span-12 md:col-span-2 space-y-1">
                          <Label className="text-xs">Description</Label>
                          <Input
                            value={item.description}
                            onChange={(e) => updateLineItem(index, { description: e.target.value })}
                            placeholder="Description"
                            className="text-sm"
                          />
                        </div>

                        {/* Qty */}
                        <div className="col-span-3 md:col-span-1 space-y-1">
                          <Label className="text-xs">Qty</Label>
                          <Input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(e) => updateLineItem(index, { quantity: Math.max(1, parseInt(e.target.value) || 1) })}
                            className="text-sm text-center"
                          />
                        </div>

                        {/* Unit */}
                        <div className="col-span-3 md:col-span-1 space-y-1">
                          <Label className="text-xs">Unit</Label>
                          <Select value={item.unitType} onValueChange={(v) => updateLineItem(index, { unitType: v })}>
                            <SelectTrigger className="h-9 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="PIECE">Pc</SelectItem>
                              <SelectItem value="BOX">Box</SelectItem>
                              <SelectItem value="KG">Kg</SelectItem>
                              <SelectItem value="METER">M</SelectItem>
                              <SelectItem value="LITER">L</SelectItem>
                              <SelectItem value="SET">Set</SelectItem>
                              <SelectItem value="ROLL">Roll</SelectItem>
                              <SelectItem value="BAG">Bag</SelectItem>
                              <SelectItem value="PACKET">Pkt</SelectItem>
                              <SelectItem value="PAIR">Pair</SelectItem>
                              <SelectItem value="TON">Ton</SelectItem>
                              <SelectItem value="FEET">Ft</SelectItem>
                              <SelectItem value="YARD">Yd</SelectItem>
                              <SelectItem value="SQ_METER">Sq M</SelectItem>
                              <SelectItem value="SQ_FEET">Sq Ft</SelectItem>
                              <SelectItem value="CUBIC_METER">Cb M</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Price */}
                        <div className="col-span-4 md:col-span-2 space-y-1">
                          <Label className="text-xs">Price</Label>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.pricePerUnit}
                            onChange={(e) => updateLineItem(index, { pricePerUnit: parseFloat(e.target.value) || 0 })}
                            className="text-sm"
                          />
                        </div>

                        {/* Discount % */}
                        <div className="col-span-3 md:col-span-1 space-y-1">
                          <Label className="text-xs">Disc %</Label>
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            value={item.discountPercent}
                            onChange={(e) => updateLineItem(index, { discountPercent: Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)) })}
                            className="text-sm text-center"
                          />
                        </div>

                        {/* Tax % */}
                        <div className="col-span-3 md:col-span-1 space-y-1">
                          <Label className="text-xs">Tax %</Label>
                          <Input
                            type="number"
                            min="0"
                            value={item.taxRate}
                            onChange={(e) => updateLineItem(index, { taxRate: Math.max(0, parseFloat(e.target.value) || 0) })}
                            className="text-sm text-center"
                          />
                        </div>

                        {/* Line Total + Remove */}
                        <div className="col-span-6 md:col-span-1 flex items-end gap-1">
                          <div className="flex-1 space-y-1">
                            <Label className="text-xs">Total</Label>
                            <div className="h-9 flex items-center text-sm font-semibold">
                              {formatKES(computeLineTotal(item))}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-red-500 hover:text-red-600 shrink-0"
                            onClick={() => removeLineItem(index)}
                            disabled={lineItems.length <= 1}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>

              <Separator />

              {/* Totals */}
              <div className="flex flex-col items-end gap-2">
                <div className="w-full max-w-xs space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="font-medium">{formatKES(subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-sm items-center gap-3">
                    <span className="text-muted-foreground">Discount</span>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={discountAmount}
                      onChange={(e) => setDiscountAmount(e.target.value)}
                      className="w-28 h-8 text-sm text-right"
                    />
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Tax</span>
                    <span className="font-medium">{formatKES(totalTax)}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between text-base font-bold">
                    <span>Grand Total</span>
                    <span>{formatKES(grandTotal)}</span>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Notes, Internal Notes & Terms */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Additional notes for this document"
                    rows={3}
                    className="text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Internal Notes</Label>
                  <Textarea
                    value={internalNotes}
                    onChange={(e) => setInternalNotes(e.target.value)}
                    placeholder="Internal notes (not visible to customer)"
                    rows={3}
                    className="text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Payment Terms</Label>
                  <Textarea
                    value={terms}
                    onChange={(e) => setTerms(e.target.value)}
                    placeholder="Payment terms, validity, etc."
                    rows={3}
                    className="text-sm"
                  />
                </div>
              </div>
            </div>
          </ScrollArea>

          <DialogFooter className="border-t pt-4">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending} className="gap-2">
              {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Create {createType.charAt(0) + createType.slice(1).toLowerCase().replace('_', ' ')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── View Dialog ── */}
      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {getTypeIcon((viewingInvoice?.invoiceType || 'INVOICE') as InvoiceType)}
                <div>
                  <DialogTitle className="flex items-center gap-2">
                    {viewingInvoice?.invoiceNumber}
                    {viewingInvoice && getTypeBadge(viewingInvoice.invoiceType as InvoiceType)}
                  </DialogTitle>
                  <DialogDescription>
                    {viewingInvoice && getStatusBadge(viewingInvoice.status as InvoiceStatus)}
                  </DialogDescription>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={handlePrint} className="gap-1.5">
                <Printer className="h-4 w-4" /> Print
              </Button>
            </div>
          </DialogHeader>

          <ScrollArea className="max-h-[80vh] -mx-6 px-6">
            {invoiceDetail ? (
              <div className="space-y-6 pb-4 print:p-0">
                {/* Document Header */}
                <div className="bg-muted/30 rounded-lg p-6 print:bg-white print:border print:rounded-none">
                  <div className="flex flex-col md:flex-row justify-between gap-6">
                    {/* Company Info */}
                    <div>
                      <h2 className="text-xl font-bold text-foreground">Mbumah Hardware</h2>
                      <p className="text-sm text-muted-foreground mt-1">Juja, Kiambu County</p>
                      <p className="text-sm text-muted-foreground">Phone: +254 700 000 000</p>
                    </div>

                    {/* Document Info */}
                    <div className="text-right space-y-1">
                      <p className="text-sm">
                        <span className="text-muted-foreground">Document:</span>{' '}
                        <span className="font-semibold">{invoiceDetail.invoiceNumber}</span>
                      </p>
                      <p className="text-sm">
                        <span className="text-muted-foreground">Issue Date:</span>{' '}
                        <span className="font-medium">{formatDate(invoiceDetail.issueDate)}</span>
                      </p>
                      {invoiceDetail.dueDate && (
                        <p className="text-sm">
                          <span className="text-muted-foreground">Due Date:</span>{' '}
                          <span className="font-medium">{formatDate(invoiceDetail.dueDate)}</span>
                        </p>
                      )}
                      <p className="text-sm">
                        <span className="text-muted-foreground">Status:</span>{' '}
                        {getStatusBadge(invoiceDetail.status as InvoiceStatus)}
                      </p>
                    </div>
                  </div>

                  {/* Bill To */}
                  <div className="mt-6 pt-4 border-t">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Bill To</p>
                    <p className="font-semibold">{invoiceDetail.customerName}</p>
                    {invoiceDetail.customerPhone && <p className="text-sm text-muted-foreground">{invoiceDetail.customerPhone}</p>}
                    {invoiceDetail.customerEmail && <p className="text-sm text-muted-foreground">{invoiceDetail.customerEmail}</p>}
                    {invoiceDetail.customerAddress && <p className="text-sm text-muted-foreground">{invoiceDetail.customerAddress}</p>}
                  </div>
                </div>

                {/* Line Items Table */}
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="text-xs">#</TableHead>
                        <TableHead className="text-xs">Item</TableHead>
                        <TableHead className="text-xs text-center">Qty</TableHead>
                        <TableHead className="text-xs text-right">Unit Price</TableHead>
                        <TableHead className="text-xs text-center">Disc %</TableHead>
                        <TableHead className="text-xs text-center">Tax %</TableHead>
                        <TableHead className="text-xs text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(invoiceDetail.items || []).map((item: InvoiceItemDetail, idx: number) => (
                        <TableRow key={item.id}>
                          <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
                          <TableCell>
                            <div>
                              <p className="text-sm font-medium">{item.productName}</p>
                              {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-center">{item.quantity} {item.unitType}</TableCell>
                          <TableCell className="text-sm text-right">{formatKES(item.pricePerUnit)}</TableCell>
                          <TableCell className="text-sm text-center">{item.discountPercent}%</TableCell>
                          <TableCell className="text-sm text-center">{item.taxRate}%</TableCell>
                          <TableCell className="text-sm text-right font-semibold">{formatKES(item.lineTotal)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Totals */}
                <div className="flex justify-end">
                  <div className="w-full max-w-xs space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span className="font-medium">{formatKES(invoiceDetail.subtotal)}</span>
                    </div>
                    {invoiceDetail.discountAmount > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Discount</span>
                        <span className="font-medium text-red-600">-{formatKES(invoiceDetail.discountAmount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Tax</span>
                      <span className="font-medium">{formatKES(invoiceDetail.taxAmount)}</span>
                    </div>
                    <Separator />
                    <div className="flex justify-between text-lg font-bold">
                      <span>Total</span>
                      <span>{formatKES(invoiceDetail.totalAmount)}</span>
                    </div>
                  </div>
                </div>

                {/* Notes & Terms */}
                {(invoiceDetail.notes || invoiceDetail.terms) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {invoiceDetail.notes && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Notes</p>
                        <p className="text-sm bg-muted/30 rounded-lg p-3">{invoiceDetail.notes}</p>
                      </div>
                    )}
                    {invoiceDetail.terms && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Terms & Conditions</p>
                        <p className="text-sm bg-muted/30 rounded-lg p-3">{invoiceDetail.terms}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Quick Actions */}
                <div className="flex flex-wrap gap-2 pt-2">
                  {invoiceDetail.invoiceType === 'QUOTATION' && ['DRAFT', 'SENT', 'ACCEPTED'].includes(invoiceDetail.status) && (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => { handleConvertToInvoice(invoiceDetail); setViewOpen(false); }}
                      disabled={createMutation.isPending}
                      className="gap-1.5"
                    >
                      <ArrowRightLeft className="h-4 w-4" /> Convert to Invoice
                    </Button>
                  )}
                  {invoiceDetail.status === 'DRAFT' && (
                    <Button variant="outline" size="sm" onClick={() => handleStatusChange(invoiceDetail, 'SENT')} disabled={updateMutation.isPending} className="gap-1.5">
                      <Send className="h-4 w-4" /> Mark as Sent
                    </Button>
                  )}
                  {invoiceDetail.invoiceType === 'INVOICE' && ['SENT', 'ACCEPTED'].includes(invoiceDetail.status) && (
                    <Button variant="outline" size="sm" onClick={() => handleStatusChange(invoiceDetail, 'PAID')} disabled={updateMutation.isPending} className="gap-1.5">
                      <DollarSign className="h-4 w-4" /> Mark as Paid
                    </Button>
                  )}
                  {!['CANCELLED', 'PAID', 'EXPIRED'].includes(invoiceDetail.status) && (
                    <Button variant="destructive" size="sm" onClick={() => { handleStatusChange(invoiceDetail, 'CANCELLED'); }} disabled={updateMutation.isPending} className="gap-1.5">
                      <XCircle className="h-4 w-4" /> Cancel
                    </Button>
                  )}
                  <Button
                    size="sm"
                    className="gap-1.5 bg-green-600 hover:bg-green-700 text-white"
                    onClick={() => handleSendWhatsApp(invoiceDetail)}
                    title="Send via WhatsApp"
                  >
                    <Phone className="h-4 w-4" /> WhatsApp
                  </Button>
                </div>

                {/* Metadata */}
                <div className="text-xs text-muted-foreground pt-2">
                  <p>Created: {formatDateTime(invoiceDetail.createdAt)} · Updated: {formatDateTime(invoiceDetail.updatedAt)}</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
