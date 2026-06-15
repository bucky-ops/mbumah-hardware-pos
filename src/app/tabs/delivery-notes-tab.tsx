'use client';

import React, { useState, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Truck, Search, Plus, Eye, Loader2,
  Phone, MapPin, User, FileText, Clock,
  Package, CheckCircle2, AlertTriangle, ArrowRight,
  Printer, CalendarDays, Hash, Navigation,
  ChevronRight, CircleDot, MessageSquare,
} from 'lucide-react';

import { useAppStore } from '@/lib/stores';
import {
  deliveryNotesApi,
  formatDate, formatDateTime, formatKES,
  openWhatsApp,
  type DeliveryNoteItem,
  type DeliveryNoteItemDetail,
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
import { Textarea } from '@/components/ui/textarea';

// ─── Helpers ─────────────────────────────────────────────

function getStatusBadge(status: string) {
  switch (status) {
    case 'PENDING':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
    case 'IN_TRANSIT':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
    case 'DELIVERED':
      return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300';
    case 'CANCELLED':
      return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'PENDING': return <Clock className="h-3 w-3" />;
    case 'IN_TRANSIT': return <Navigation className="h-3 w-3" />;
    case 'DELIVERED': return <CheckCircle2 className="h-3 w-3" />;
    case 'CANCELLED': return <AlertTriangle className="h-3 w-3" />;
    default: return null;
  }
}

function getStatusLabel(status: string) {
  switch (status) {
    case 'PENDING': return 'Pending';
    case 'IN_TRANSIT': return 'In Transit';
    case 'DELIVERED': return 'Delivered';
    case 'CANCELLED': return 'Cancelled';
    default: return status;
  }
}

// Delivery status timeline
function DeliveryTimeline({ status }: { status: string }) {
  const steps = ['PENDING', 'IN_TRANSIT', 'DELIVERED'];
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
              <div className={`w-6 h-0.5 ${isPast ? 'bg-green-400' : 'bg-muted-foreground/20'}`} />
            )}
            <div className="flex flex-col items-center" title={step}>
              {isCurrent ? (
                <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                  <div className="w-2 h-2 rounded-full bg-white" />
                </div>
              ) : isPast ? (
                <CheckCircle2 className="w-5 h-5 text-green-500" />
              ) : (
                <CircleDot className="w-5 h-5 text-muted-foreground/30" />
              )}
              <span className={`text-[9px] mt-0.5 ${isCurrent ? 'text-primary font-bold' : isPast ? 'text-green-600' : 'text-muted-foreground/40'}`}>
                {step === 'PENDING' ? 'Pending' : step === 'IN_TRANSIT' ? 'Transit' : 'Delivered'}
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

// ─── Item type for create form ───────────────────────────

interface DeliveryFormItem {
  productName: string;
  quantity: number;
  unitType: string;
  notes: string;
}

const EMPTY_ITEM: DeliveryFormItem = {
  productName: '',
  quantity: 1,
  unitType: 'PIECE',
  notes: '',
};

// ─── Main Component ──────────────────────────────────────

export default function DeliveryNotesTab() {
  const currentStoreId = useAppStore((s) => s.currentStoreId);
  const queryClient = useQueryClient();
  const printRef = useRef<HTMLDivElement>(null);

  // State
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [selectedNote, setSelectedNote] = useState<DeliveryNoteItem | null>(null);

  // Create form state
  const [formCustomerName, setFormCustomerName] = useState('');
  const [formCustomerPhone, setFormCustomerPhone] = useState('');
  const [formDeliveryAddress, setFormDeliveryAddress] = useState('');
  const [formDriverName, setFormDriverName] = useState('');
  const [formVehicleNumber, setFormVehicleNumber] = useState('');
  const [formScheduledDate, setFormScheduledDate] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formItems, setFormItems] = useState<DeliveryFormItem[]>([{ ...EMPTY_ITEM }]);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // ─── Queries ─────────────────────────────────────────

  const { data: notesData, isLoading } = useQuery({
    queryKey: ['delivery-notes', currentStoreId, statusFilter, searchQuery],
    queryFn: () => deliveryNotesApi.list({
      storeId: currentStoreId,
      status: statusFilter !== 'all' ? statusFilter : undefined,
    }),
    enabled: !!currentStoreId,
  });

  const { data: noteDetailData, isLoading: detailLoading } = useQuery({
    queryKey: ['delivery-note-detail', selectedNote?.id],
    queryFn: () => deliveryNotesApi.get(selectedNote!.id),
    enabled: !!selectedNote,
  });

  // ─── Mutations ───────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: deliveryNotesApi.create,
    onSuccess: () => {
      toast.success('Delivery note created successfully');
      resetCreateForm();
      setCreateOpen(false);
      queryClient.invalidateQueries({ queryKey: ['delivery-notes', currentStoreId] });
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to create delivery note'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      deliveryNotesApi.update(id, data),
    onSuccess: (_, variables) => {
      const newStatus = variables.data.status as string;
      toast.success(`Delivery note ${getStatusLabel(newStatus).toLowerCase()}`);
      queryClient.invalidateQueries({ queryKey: ['delivery-notes', currentStoreId] });
      queryClient.invalidateQueries({ queryKey: ['delivery-note-detail', selectedNote?.id] });
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to update delivery note'),
  });

  // ─── Data ────────────────────────────────────────────

  const deliveryNotes: DeliveryNoteItem[] = useMemo(() => {
    const raw = Array.isArray(notesData?.data) ? notesData.data : [];
    if (!searchQuery) return raw;
    const q = searchQuery.toLowerCase();
    return raw.filter(
      (dn) =>
        dn.deliveryNumber.toLowerCase().includes(q) ||
        dn.customerName.toLowerCase().includes(q) ||
        (dn.customerPhone && dn.customerPhone.toLowerCase().includes(q)) ||
        (dn.driverName && dn.driverName.toLowerCase().includes(q)) ||
        (dn.deliveryAddress && dn.deliveryAddress.toLowerCase().includes(q))
    );
  }, [notesData, searchQuery]);

  const noteDetail = noteDetailData?.data as (DeliveryNoteItem & { items: DeliveryNoteItemDetail[]; transaction?: { id: string; receiptNumber: string; totalAmount: number; paymentStatus: string } }) | undefined;

  // Stats
  const stats = useMemo(() => {
    const all = Array.isArray(notesData?.data) ? notesData.data : [];
    const today = new Date().toISOString().slice(0, 10);
    return {
      pending: all.filter((d) => d.status === 'PENDING').length,
      inTransit: all.filter((d) => d.status === 'IN_TRANSIT').length,
      deliveredToday: all.filter((d) => d.status === 'DELIVERED' && d.deliveredAt && d.deliveredAt.slice(0, 10) === today).length,
      total: all.length,
    };
  }, [notesData]);

  // ─── Form helpers ────────────────────────────────────

  function resetCreateForm() {
    setFormCustomerName('');
    setFormCustomerPhone('');
    setFormDeliveryAddress('');
    setFormDriverName('');
    setFormVehicleNumber('');
    setFormScheduledDate('');
    setFormNotes('');
    setFormItems([{ ...EMPTY_ITEM }]);
    setFormErrors({});
  }

  function validateForm(): boolean {
    const errors: Record<string, string> = {};
    if (!formCustomerName.trim()) errors.customerName = 'Customer name is required';
    if (formItems.length === 0 || formItems.every((i) => !i.productName.trim())) {
      errors.items = 'At least one item with a product name is required';
    }
    formItems.forEach((item, idx) => {
      if (!item.productName.trim()) errors[`item_${idx}_name`] = 'Product name required';
      if (item.quantity <= 0) errors[`item_${idx}_qty`] = 'Quantity must be > 0';
    });
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function handleCreate() {
    if (!validateForm()) return;
    const validItems = formItems.filter((i) => i.productName.trim());
    createMutation.mutate({
      storeId: currentStoreId,
      customerName: formCustomerName.trim(),
      customerPhone: formCustomerPhone.trim() || undefined,
      deliveryAddress: formDeliveryAddress.trim() || undefined,
      driverName: formDriverName.trim() || undefined,
      vehicleNumber: formVehicleNumber.trim() || undefined,
      scheduledDate: formScheduledDate || undefined,
      notes: formNotes.trim() || undefined,
      items: validItems.map((i) => ({
        productName: i.productName.trim(),
        quantity: i.quantity,
        unitType: i.unitType,
        notes: i.notes.trim() || undefined,
      })),
    });
  }

  function addItem() {
    setFormItems([...formItems, { ...EMPTY_ITEM }]);
  }

  function removeItem(index: number) {
    if (formItems.length <= 1) return;
    setFormItems(formItems.filter((_, i) => i !== index));
  }

  function updateItem(index: number, field: keyof DeliveryFormItem, value: string | number) {
    const updated = [...formItems];
    updated[index] = { ...updated[index], [field]: value };
    setFormItems(updated);
  }

  function handleViewNote(note: DeliveryNoteItem) {
    setSelectedNote(note);
    setViewOpen(true);
  }

  function handleSendWhatsApp(note: DeliveryNoteItem) {
    const phone = note.customerPhone || '';
    const itemsList = note.items
      ? note.items.map((item, i) => `${i + 1}. ${item.productName} x${item.quantity} ${item.unitType}`).join('\n')
      : '';
    const message = [
      `*Delivery Note: ${note.deliveryNumber}*`,
      `Customer: ${note.customerName}`,
      note.deliveryAddress ? `Address: ${note.deliveryAddress}` : '',
      note.driverName ? `Driver: ${note.driverName}` : '',
      note.vehicleNumber ? `Vehicle: ${note.vehicleNumber}` : '',
      note.scheduledDate ? `Scheduled: ${formatDate(note.scheduledDate)}` : '',
      '',
      itemsList ? `*Items:*\n${itemsList}` : '',
      '',
      'Thank you for doing business with us',
      '',
      '— Mbumah Hardware',
    ].filter(Boolean).join('\n');
    openWhatsApp(phone, message);
  }

  function handleStatusUpdate(id: string, newStatus: string) {
    updateMutation.mutate({ id, data: { status: newStatus } });
  }

  function handlePrint() {
    if (!printRef.current) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`
      <html>
        <head>
          <title>Delivery Note</title>
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 20px; color: #1a1a1a; }
            .header { text-align: center; border-bottom: 3px double #333; padding-bottom: 12px; margin-bottom: 16px; }
            .header h1 { font-size: 22px; margin: 0; letter-spacing: 1px; }
            .header h2 { font-size: 14px; margin: 4px 0 0; color: #666; }
            .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 16px; font-size: 13px; }
            .info-grid .label { font-weight: 600; color: #555; }
            .info-grid .value { color: #1a1a1a; }
            table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
            th { background: #f5f5f5; text-align: left; padding: 8px 12px; border: 1px solid #ddd; font-weight: 600; }
            td { padding: 8px 12px; border: 1px solid #ddd; }
            .status-badge { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; }
            .status-PENDING { background: #fef3c7; color: #92400e; }
            .status-IN_TRANSIT { background: #dbeafe; color: #1e40af; }
            .status-DELIVERED { background: #dcfce7; color: #166534; }
            .status-CANCELLED { background: #fee2e2; color: #991b1b; }
            .footer { margin-top: 24px; font-size: 12px; color: #888; text-align: center; border-top: 1px solid #eee; padding-top: 12px; }
            .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 40px; }
            .sig-line { border-top: 1px solid #333; padding-top: 4px; text-align: center; font-size: 12px; }
          </style>
        </head>
        <body>
          ${printRef.current.innerHTML}
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }

  // ─── Loading skeleton ────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-96 w-full rounded-lg" />
      </div>
    );
  }

  // ─── Render ──────────────────────────────────────────

  return (
    <div className="space-y-4 p-4">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-medium">Pending Deliveries</p>
                <p className="text-2xl font-bold text-amber-600">{stats.pending}</p>
              </div>
              <div className="h-10 w-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <Clock className="h-5 w-5 text-amber-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-medium">In Transit</p>
                <p className="text-2xl font-bold text-blue-600">{stats.inTransit}</p>
              </div>
              <div className="h-10 w-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <Navigation className="h-5 w-5 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-medium">Delivered Today</p>
                <p className="text-2xl font-bold text-green-600">{stats.deliveredToday}</p>
              </div>
              <div className="h-10 w-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-medium">Total Notes</p>
                <p className="text-2xl font-bold">{stats.total}</p>
              </div>
              <div className="h-10 w-10 rounded-full bg-gray-100 dark:bg-gray-800/50 flex items-center justify-center">
                <FileText className="h-5 w-5 text-gray-600 dark:text-gray-400" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Toolbar */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search delivery notes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-44">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="IN_TRANSIT">In Transit</SelectItem>
                <SelectItem value="DELIVERED">Delivered</SelectItem>
                <SelectItem value="CANCELLED">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={() => setCreateOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              New Delivery Note
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Delivery Notes Table */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          {deliveryNotes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Truck className="h-12 w-12 mb-3 opacity-40" />
              <p className="font-medium">No delivery notes found</p>
              <p className="text-sm mt-1">Create a new delivery note to get started</p>
              <Button className="mt-4 gap-2" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" /> Create Delivery Note
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-36">Delivery #</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="hidden md:table-cell">Phone</TableHead>
                    <TableHead className="hidden lg:table-cell">Address</TableHead>
                    <TableHead className="hidden md:table-cell">Driver</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden sm:table-cell">Date</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deliveryNotes.map((dn) => (
                    <TableRow
                      key={dn.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => handleViewNote(dn)}
                    >
                      <TableCell className="font-mono text-xs font-semibold">
                        <div className="flex items-center gap-1.5">
                          <Hash className="h-3 w-3 text-muted-foreground" />
                          {dn.deliveryNumber}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">{dn.customerName}</div>
                        {dn.items && dn.items.length > 0 && (
                          <div className="text-xs text-muted-foreground">{dn.items.length} item{dn.items.length > 1 ? 's' : ''}</div>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {dn.customerPhone ? (
                          <span className="text-sm flex items-center gap-1">
                            <Phone className="h-3 w-3 text-muted-foreground" />
                            {dn.customerPhone}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell max-w-48 truncate">
                        {dn.deliveryAddress ? (
                          <span className="text-sm flex items-center gap-1 truncate">
                            <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="truncate">{dn.deliveryAddress}</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {dn.driverName ? (
                          <span className="text-sm flex items-center gap-1">
                            <User className="h-3 w-3 text-muted-foreground" />
                            {dn.driverName}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${getStatusBadge(dn.status)}`}>
                          {getStatusIcon(dn.status)}
                          {getStatusLabel(dn.status)}
                        </span>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                        {formatDate(dn.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                          {dn.status === 'PENDING' && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[10px] gap-1 text-blue-600 border-blue-200 hover:bg-blue-50 dark:border-blue-800 dark:hover:bg-blue-900/20"
                              onClick={() => handleStatusUpdate(dn.id, 'IN_TRANSIT')}
                              disabled={updateMutation.isPending}
                            >
                              <Navigation className="h-3 w-3" />
                              <span className="hidden sm:inline">In Transit</span>
                            </Button>
                          )}
                          {dn.status === 'IN_TRANSIT' && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[10px] gap-1 text-green-600 border-green-200 hover:bg-green-50 dark:border-green-800 dark:hover:bg-green-900/20"
                              onClick={() => handleStatusUpdate(dn.id, 'DELIVERED')}
                              disabled={updateMutation.isPending}
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              <span className="hidden sm:inline">Delivered</span>
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            onClick={() => handleViewNote(dn)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-900/20"
                            onClick={() => handleSendWhatsApp(dn)}
                            title="Send to WhatsApp"
                          >
                            <MessageSquare className="h-3.5 w-3.5" />
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

      {/* ─── Create Dialog ─────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={(open) => { if (!open) resetCreateForm(); setCreateOpen(open); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5" />
              New Delivery Note
            </DialogTitle>
            <DialogDescription>
              Create a new delivery note for customer orders.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Customer Info */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" /> Customer Information
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="customerName">Customer Name *</Label>
                  <Input
                    id="customerName"
                    placeholder="e.g. John Kamau"
                    value={formCustomerName}
                    onChange={(e) => setFormCustomerName(e.target.value)}
                  />
                  {formErrors.customerName && <p className="text-xs text-red-500">{formErrors.customerName}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="customerPhone">Phone Number</Label>
                  <Input
                    id="customerPhone"
                    placeholder="e.g. 0712 345 678"
                    value={formCustomerPhone}
                    onChange={(e) => setFormCustomerPhone(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="deliveryAddress">Delivery Address</Label>
                <Textarea
                  id="deliveryAddress"
                  placeholder="e.g. 123 Kenyatta Ave, Juja"
                  value={formDeliveryAddress}
                  onChange={(e) => setFormDeliveryAddress(e.target.value)}
                  rows={2}
                />
              </div>
            </div>

            <Separator />

            {/* Delivery Info */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
                <Truck className="h-3.5 w-3.5" /> Delivery Information
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="driverName">Driver Name</Label>
                  <Input
                    id="driverName"
                    placeholder="e.g. Peter Mwangi"
                    value={formDriverName}
                    onChange={(e) => setFormDriverName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="vehicleNumber">Vehicle Number</Label>
                  <Input
                    id="vehicleNumber"
                    placeholder="e.g. KBA 123J"
                    value={formVehicleNumber}
                    onChange={(e) => setFormVehicleNumber(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="scheduledDate">Scheduled Delivery Date</Label>
                <Input
                  id="scheduledDate"
                  type="date"
                  value={formScheduledDate}
                  onChange={(e) => setFormScheduledDate(e.target.value)}
                />
              </div>
            </div>

            <Separator />

            {/* Items */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
                  <Package className="h-3.5 w-3.5" /> Delivery Items
                </h4>
                <Button type="button" size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={addItem}>
                  <Plus className="h-3 w-3" /> Add Item
                </Button>
              </div>
              {formErrors.items && <p className="text-xs text-red-500">{formErrors.items}</p>}

              <div className="space-y-3">
                {formItems.map((item, idx) => (
                  <div key={idx} className="flex flex-col sm:flex-row gap-2 p-3 rounded-lg border bg-muted/30">
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs">Product Name</Label>
                      <Input
                        placeholder="e.g. Cement 50kg"
                        value={item.productName}
                        onChange={(e) => updateItem(idx, 'productName', e.target.value)}
                        className="h-8 text-sm"
                      />
                      {formErrors[`item_${idx}_name`] && (
                        <p className="text-[10px] text-red-500">{formErrors[`item_${idx}_name`]}</p>
                      )}
                    </div>
                    <div className="w-20 space-y-1">
                      <Label className="text-xs">Qty</Label>
                      <Input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(e) => updateItem(idx, 'quantity', parseInt(e.target.value) || 0)}
                        className="h-8 text-sm"
                      />
                      {formErrors[`item_${idx}_qty`] && (
                        <p className="text-[10px] text-red-500">{formErrors[`item_${idx}_qty`]}</p>
                      )}
                    </div>
                    <div className="w-24 space-y-1">
                      <Label className="text-xs">Unit</Label>
                      <Select value={item.unitType} onValueChange={(val) => updateItem(idx, 'unitType', val)}>
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="PIECE">Pcs</SelectItem>
                          <SelectItem value="BAG">Bag</SelectItem>
                          <SelectItem value="BOX">Box</SelectItem>
                          <SelectItem value="KILOGRAM">Kg</SelectItem>
                          <SelectItem value="METER">M</SelectItem>
                          <SelectItem value="LITER">L</SelectItem>
                          <SelectItem value="SET">Set</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs">Notes</Label>
                      <Input
                        placeholder="Optional"
                        value={item.notes}
                        onChange={(e) => updateItem(idx, 'notes', e.target.value)}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="flex items-end pb-0.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                        onClick={() => removeItem(idx)}
                        disabled={formItems.length <= 1}
                      >
                        &times;
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            {/* Notes */}
            <div className="space-y-1.5">
              <Label htmlFor="formNotes">Additional Notes</Label>
              <Textarea
                id="formNotes"
                placeholder="Any additional delivery instructions..."
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { resetCreateForm(); setCreateOpen(false); }}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending} className="gap-2">
              {createMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Truck className="h-4 w-4" />
              )}
              Create Delivery Note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── View Dialog ───────────────────────────────── */}
      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Delivery Note Details
              </DialogTitle>
            </div>
            <DialogDescription>
              View and manage delivery note information.
            </DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <div className="space-y-3 py-4">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : noteDetail ? (
            <div className="space-y-4 py-2">
              {/* Hidden print area */}
              <div ref={printRef} className="hidden">
                {/* Print content - injected into print window */}
                <div className="print-content">
                  <div className="header">
                    <h1>MBUMAH HARDWARE</h1>
                    <h2>DELIVERY NOTE</h2>
                  </div>
                  <div className="info-grid">
                    <div><span className="label">Delivery #:</span> <span className="value">{noteDetail.deliveryNumber}</span></div>
                    <div><span className="label">Status:</span> <span className={`status-badge status-${noteDetail.status}`}>{getStatusLabel(noteDetail.status)}</span></div>
                    <div><span className="label">Customer:</span> <span className="value">{noteDetail.customerName}</span></div>
                    <div><span className="label">Phone:</span> <span className="value">{noteDetail.customerPhone || '—'}</span></div>
                    <div><span className="label">Address:</span> <span className="value">{noteDetail.deliveryAddress || '—'}</span></div>
                    <div><span className="label">Scheduled:</span> <span className="value">{noteDetail.scheduledDate ? formatDate(noteDetail.scheduledDate) : '—'}</span></div>
                    <div><span className="label">Driver:</span> <span className="value">{noteDetail.driverName || '—'}</span></div>
                    <div><span className="label">Vehicle:</span> <span className="value">{noteDetail.vehicleNumber || '—'}</span></div>
                    <div><span className="label">Created:</span> <span className="value">{formatDateTime(noteDetail.createdAt)}</span></div>
                    <div><span className="label">Delivered:</span> <span className="value">{noteDetail.deliveredAt ? formatDateTime(noteDetail.deliveredAt) : '—'}</span></div>
                  </div>
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Product</th>
                        <th>Qty</th>
                        <th>Unit</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(noteDetail.items || []).map((item, i) => (
                        <tr key={item.id}>
                          <td>{i + 1}</td>
                          <td>{item.productName}</td>
                          <td>{item.quantity}</td>
                          <td>{item.unitType}</td>
                          <td>{item.notes || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {noteDetail.notes && (
                    <div style={{ marginTop: '12px', fontSize: '13px' }}>
                      <strong>Notes:</strong> {noteDetail.notes}
                    </div>
                  )}
                  <div className="signatures">
                    <div className="sig-line">Driver Signature</div>
                    <div className="sig-line">Customer Signature</div>
                  </div>
                  <div className="footer">
                    This delivery note was generated by Mbumah Hardware POS System.
                  </div>
                </div>
              </div>

              {/* Header */}
              <div className="flex flex-col sm:flex-row items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-sm font-bold">{noteDetail.deliveryNumber}</span>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${getStatusBadge(noteDetail.status)}`}>
                      {getStatusIcon(noteDetail.status)}
                      {getStatusLabel(noteDetail.status)}
                    </span>
                  </div>
                  <DeliveryTimeline status={noteDetail.status} />
                </div>
                <div className="flex gap-2">
                  {noteDetail.status === 'PENDING' && (
                    <Button
                      size="sm"
                      className="gap-1.5 bg-blue-600 hover:bg-blue-700"
                      onClick={() => handleStatusUpdate(noteDetail.id, 'IN_TRANSIT')}
                      disabled={updateMutation.isPending}
                    >
                      {updateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Navigation className="h-3.5 w-3.5" />}
                      Mark In Transit
                    </Button>
                  )}
                  {noteDetail.status === 'IN_TRANSIT' && (
                    <Button
                      size="sm"
                      className="gap-1.5 bg-green-600 hover:bg-green-700"
                      onClick={() => handleStatusUpdate(noteDetail.id, 'DELIVERED')}
                      disabled={updateMutation.isPending}
                    >
                      {updateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      Mark Delivered
                    </Button>
                  )}
                  {(noteDetail.status === 'PENDING' || noteDetail.status === 'IN_TRANSIT') && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20"
                      onClick={() => handleStatusUpdate(noteDetail.id, 'CANCELLED')}
                      disabled={updateMutation.isPending}
                    >
                      Cancel
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={handlePrint}>
                    <Printer className="h-3.5 w-3.5" /> Print
                  </Button>
                  <Button
                    size="sm"
                    className="gap-1.5 bg-green-600 hover:bg-green-700 text-white"
                    onClick={() => handleSendWhatsApp(noteDetail)}
                    title="Send to WhatsApp"
                  >
                    <MessageSquare className="h-3.5 w-3.5" /> WhatsApp
                  </Button>
                </div>
              </div>

              <Separator />

              {/* Customer & Delivery Info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2.5">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Customer</h4>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex items-center gap-2">
                      <User className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-medium">{noteDetail.customerName}</span>
                    </div>
                    {noteDetail.customerPhone && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Phone className="h-3.5 w-3.5" />
                        {noteDetail.customerPhone}
                      </div>
                    )}
                    {noteDetail.deliveryAddress && (
                      <div className="flex items-start gap-2 text-muted-foreground">
                        <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        {noteDetail.deliveryAddress}
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-2.5">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Delivery</h4>
                  <div className="space-y-1.5 text-sm">
                    {noteDetail.driverName && (
                      <div className="flex items-center gap-2">
                        <User className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>{noteDetail.driverName}</span>
                      </div>
                    )}
                    {noteDetail.vehicleNumber && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Truck className="h-3.5 w-3.5" />
                        {noteDetail.vehicleNumber}
                      </div>
                    )}
                    {noteDetail.scheduledDate && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <CalendarDays className="h-3.5 w-3.5" />
                        Scheduled: {formatDate(noteDetail.scheduledDate)}
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      Created: {formatDateTime(noteDetail.createdAt)}
                    </div>
                    {noteDetail.deliveredAt && (
                      <div className="flex items-center gap-2 text-green-600">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Delivered: {formatDateTime(noteDetail.deliveredAt)}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Linked Transaction */}
              {noteDetail.transaction && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Linked Transaction</h4>
                    <div className="flex items-center gap-2 text-sm bg-muted/50 rounded-lg p-3">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">
                        {noteDetail.transaction.receiptNumber}
                      </span>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-muted-foreground">
                        KES {noteDetail.transaction.totalAmount}
                      </span>
                    </div>
                  </div>
                </>
              )}

              <Separator />

              {/* Items */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Items ({(noteDetail.items || []).length})
                </h4>
                {(noteDetail.items || []).length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">No items recorded</p>
                ) : (
                  <div className="rounded-lg border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10">#</TableHead>
                          <TableHead>Product</TableHead>
                          <TableHead className="w-16 text-center">Qty</TableHead>
                          <TableHead className="w-20">Unit</TableHead>
                          <TableHead className="hidden sm:table-cell">Notes</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(noteDetail.items || []).map((item, i) => (
                          <TableRow key={item.id}>
                            <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                            <TableCell className="font-medium text-sm">{item.productName}</TableCell>
                            <TableCell className="text-center text-sm">{item.quantity}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{item.unitType}</TableCell>
                            <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                              {item.notes || '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>

              {/* Notes */}
              {noteDetail.notes && (
                <>
                  <Separator />
                  <div className="space-y-1.5">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Notes</h4>
                    <p className="text-sm bg-muted/50 rounded-lg p-3">{noteDetail.notes}</p>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="py-8 text-center text-muted-foreground">
              <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p>Delivery note not found</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
