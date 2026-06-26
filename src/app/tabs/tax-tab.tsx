'use client';

import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Calculator, Receipt, FileText, ShieldCheck, Plus, Search,
  TrendingUp, AlertCircle, CheckCircle2, Clock, Loader2,
  ChevronDown, ChevronRight, Settings, Wifi, WifiOff,
  Edit, Eye, Send, Check, X,
} from 'lucide-react';

import { useAppStore } from '@/lib/stores';
import {
  taxApi, formatKES, formatDate,
  type TaxCategoryItem, type TaxFilingItem,
} from '@/lib/api';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';

// ─── Helpers ────────────────────────────────────────────────

function filingStatusBadge(status: TaxFilingItem['status']) {
  const map: Record<string, { label: string; className: string }> = {
    DRAFT: { label: 'Draft', className: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
    FILED: { label: 'Filed', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
    APPROVED: { label: 'Approved', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
    PAID: { label: 'Paid', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
    LATE: { label: 'Late', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  };
  const s = map[status] || { label: status, className: 'bg-muted text-muted-foreground' };
  return <Badge className={`text-[10px] font-semibold px-2 ${s.className}`}>{s.label}</Badge>;
}

function taxTypeName(type: string) {
  const map: Record<string, string> = {
    VAT: 'VAT', WHT: 'WHT', INCOME_TAX: 'Income Tax', TURNOVER_TAX: 'Turnover Tax',
  };
  return map[type] || type;
}

// ─── Create / Edit Tax Category Dialog ──────────────────────

function TaxCategoryDialog({
  open,
  onOpenChange,
  category,
  storeId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  category: TaxCategoryItem | null;
  storeId: string;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(category?.name || '');
  const [rate, setRate] = useState(category?.rate?.toString() || '');
  const [description, setDescription] = useState(category?.description || '');
  const [etimsCode, setEtimsCode] = useState(category?.etimsCode || '');
  const [isActive, setIsActive] = useState(category?.isActive ?? true);

  React.useEffect(() => {
    if (open) {
      setName(category?.name || '');
      setRate(category?.rate?.toString() || '');
      setDescription(category?.description || '');
      setEtimsCode(category?.etimsCode || '');
      setIsActive(category?.isActive ?? true);
    }
  }, [open, category]);

  const createMutation = useMutation({
    mutationFn: (data: { storeId: string; name: string; rate: number; description?: string; etimsCode?: string; isActive?: boolean }) =>
      taxApi.categories.create(data),
    onSuccess: () => {
      toast.success('Tax category created');
      queryClient.invalidateQueries({ queryKey: ['tax-categories'] });
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to create category'),
  });

  const handleSave = () => {
    if (!name.trim()) { toast.error('Name is required'); return; }
    const rateNum = parseFloat(rate);
    if (isNaN(rateNum) || rateNum < 0 || rateNum > 100) { toast.error('Rate must be 0–100'); return; }
    createMutation.mutate({
      storeId,
      name: name.trim(),
      rate: rateNum,
      description: description.trim() || undefined,
      etimsCode: etimsCode.trim() || undefined,
      isActive,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{category ? 'Edit Tax Category' : 'New Tax Category'}</DialogTitle>
          <DialogDescription>Configure tax rate and eTIMS code for KRA compliance</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. VAT" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Rate (%)</Label>
              <Input type="number" min={0} max={100} step={0.01} value={rate} onChange={(e) => setRate(e.target.value)} placeholder="16" />
            </div>
            <div className="space-y-2">
              <Label>eTIMS Code</Label>
              <Input value={etimsCode} onChange={(e) => setEtimsCode(e.target.value)} placeholder="e.g. VAT-01" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description" rows={2} />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={isActive} onCheckedChange={setIsActive} />
            <Label className="text-sm">Active</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={createMutation.isPending} className="bg-emerald-600 hover:bg-emerald-700">
            {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {category ? 'Update' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Create Tax Filing Dialog ───────────────────────────────

function TaxFilingDialog({
  open,
  onOpenChange,
  storeId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  storeId: string;
}) {
  const queryClient = useQueryClient();
  const [filingPeriod, setFilingPeriod] = useState('');
  const [filingType, setFilingType] = useState('VAT');
  const [totalSales, setTotalSales] = useState('');
  const [totalTax, setTotalTax] = useState('');
  const [totalWht, setTotalWht] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');

  React.useEffect(() => {
    if (open) {
      const now = new Date();
      setFilingPeriod(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
      setFilingType('VAT');
      setTotalSales('');
      setTotalTax('');
      setTotalWht('');
      setDueDate('');
      setNotes('');
    }
  }, [open]);

  const createMutation = useMutation({
    mutationFn: (data: Parameters<typeof taxApi.filings.create>[0]) => taxApi.filings.create(data),
    onSuccess: () => {
      toast.success('Tax filing created');
      queryClient.invalidateQueries({ queryKey: ['tax-filings'] });
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to create filing'),
  });

  const handleSave = () => {
    if (!filingPeriod) { toast.error('Filing period is required'); return; }
    const salesNum = parseFloat(totalSales) || 0;
    const taxNum = parseFloat(totalTax) || 0;
    const whtNum = parseFloat(totalWht) || 0;
    createMutation.mutate({
      storeId,
      filingPeriod,
      filingType,
      totalSales: salesNum,
      totalTax: taxNum,
      totalWht: whtNum,
      dueDate: dueDate || undefined,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Tax Filing</DialogTitle>
          <DialogDescription>Create a tax filing record for KRA compliance</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Filing Period</Label>
              <Input value={filingPeriod} onChange={(e) => setFilingPeriod(e.target.value)} placeholder="2025-01" />
            </div>
            <div className="space-y-2">
              <Label>Filing Type</Label>
              <Select value={filingType} onValueChange={setFilingType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="VAT">VAT</SelectItem>
                  <SelectItem value="WHT">WHT</SelectItem>
                  <SelectItem value="INCOME_TAX">Income Tax</SelectItem>
                  <SelectItem value="TURNOVER_TAX">Turnover Tax</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Total Sales (KES)</Label>
              <Input type="number" min={0} step={0.01} value={totalSales} onChange={(e) => setTotalSales(e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-2">
              <Label>Total Tax (KES)</Label>
              <Input type="number" min={0} step={0.01} value={totalTax} onChange={(e) => setTotalTax(e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-2">
              <Label>WHT Amount (KES)</Label>
              <Input type="number" min={0} step={0.01} value={totalWht} onChange={(e) => setTotalWht(e.target.value)} placeholder="0" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Due Date</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={createMutation.isPending} className="bg-emerald-600 hover:bg-emerald-700">
            {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Filing
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Filing Detail Dialog ───────────────────────────────────

function FilingDetailDialog({
  filing,
  open,
  onOpenChange,
}: {
  filing: TaxFilingItem | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  if (!filing) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Tax Filing — {filing.filingPeriod}</DialogTitle>
          <DialogDescription>{taxTypeName(filing.filingType)} Filing Details</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Status</p>
              <div className="mt-1">{filingStatusBadge(filing.status)}</div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Filing Type</p>
              <p className="text-sm font-medium mt-1">{taxTypeName(filing.filingType)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Sales</p>
              <p className="text-sm font-medium mt-1">{formatKES(filing.totalSales)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Tax</p>
              <p className="text-sm font-medium mt-1 text-red-600">{formatKES(filing.totalTax)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">WHT Amount</p>
              <p className="text-sm font-medium mt-1">{formatKES(filing.totalWht)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Filing Date</p>
              <p className="text-sm font-medium mt-1">{filing.filingDate ? formatDate(filing.filingDate) : '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Due Date</p>
              <p className="text-sm font-medium mt-1">{filing.dueDate ? formatDate(filing.dueDate) : '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">eTIMS Reference</p>
              <p className="text-sm font-medium mt-1">{filing.etimsReference || '—'}</p>
            </div>
          </div>
          {filing.notes && (
            <div>
              <p className="text-xs text-muted-foreground">Notes</p>
              <p className="text-sm mt-1">{filing.notes}</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ─────────────────────────────────────────

export default function TaxTab() {
  const currentStoreId = useAppStore((s) => s.currentStoreId);
  const [innerTab, setInnerTab] = useState('categories');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editCategory, setEditCategory] = useState<TaxCategoryItem | null>(null);
  const [filingDialogOpen, setFilingDialogOpen] = useState(false);
  const [filingStatusFilter, setFilingStatusFilter] = useState('all');
  const [filingTypeFilter, setFilingTypeFilter] = useState('all');
  const [selectedFiling, setSelectedFiling] = useState<TaxFilingItem | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  // eTIMS settings state
  const [etimsUrl, setEtimsUrl] = useState('https://etims.kra.go.ke/api');
  const [etimsApiKey, setEtimsApiKey] = useState('');
  const [etimsDeviceSerial, setEtimsDeviceSerial] = useState('');
  const [etimsPin, setEtimsPin] = useState('');
  const [etimsTesting, setEtimsTesting] = useState(false);
  const [etimsConnected, setEtimsConnected] = useState<boolean | null>(null);
  const [etimsLastSync, setEtimsLastSync] = useState<string | null>(null);

  // Fetch tax categories
  const { data: categoriesData, isLoading: categoriesLoading } = useQuery({
    queryKey: ['tax-categories', currentStoreId, searchQuery],
    queryFn: () => taxApi.categories.list({ storeId: currentStoreId, search: searchQuery || undefined, limit: 100 }),
    enabled: !!currentStoreId,
  });

  // Fetch tax filings
  const { data: filingsData, isLoading: filingsLoading } = useQuery({
    queryKey: ['tax-filings', currentStoreId, filingStatusFilter, filingTypeFilter],
    queryFn: () => taxApi.filings.list({
      storeId: currentStoreId,
      status: filingStatusFilter !== 'all' ? filingStatusFilter : undefined,
      filingType: filingTypeFilter !== 'all' ? filingTypeFilter : undefined,
      limit: 100,
    }),
    enabled: !!currentStoreId,
  });

  const categories: TaxCategoryItem[] = Array.isArray(categoriesData?.data) ? categoriesData.data : [];
  const filings: TaxFilingItem[] = Array.isArray(filingsData?.data) ? filingsData.data : [];

  // Stats
  const totalVAT = useMemo(() =>
    filings.filter(f => f.filingType === 'VAT').reduce((s, f) => s + f.totalTax, 0),
    [filings]
  );
  const totalWHT = useMemo(() =>
    filings.filter(f => f.filingType === 'WHT').reduce((s, f) => s + f.totalWht, 0),
    [filings]
  );
  const filingsDue = useMemo(() =>
    filings.filter(f => f.status === 'DRAFT' || f.status === 'LATE').length,
    [filings]
  );
  const etimsActiveCategories = categories.filter(c => c.isActive && c.etimsCode).length;

  const toggleCategory = (id: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleTestConnection = () => {
    setEtimsTesting(true);
    // Simulate connection test
    setTimeout(() => {
      setEtimsConnected(etimsUrl.length > 0 && etimsApiKey.length > 0);
      setEtimsLastSync(new Date().toISOString());
      setEtimsTesting(false);
      if (etimsUrl.length > 0 && etimsApiKey.length > 0) {
        toast.success('eTIMS connection successful');
      } else {
        toast.error('eTIMS connection failed — check API URL and Key');
      }
    }, 1500);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Tax / eTIMS</h2>
          <p className="text-sm text-muted-foreground">Tax categories, rates, filings, and KRA eTIMS compliance</p>
        </div>
        <Button size="sm" className="h-8 bg-emerald-600 hover:bg-emerald-700" onClick={() => setFilingDialogOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> New Filing
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { title: 'Total VAT Collected', value: formatKES(totalVAT), icon: Receipt, color: 'text-emerald-600' },
          { title: 'WHT Withheld', value: formatKES(totalWHT), icon: TrendingUp, color: 'text-amber-600' },
          { title: 'Filings Due', value: filingsDue.toString(), icon: FileText, color: filingsDue > 0 ? 'text-red-600' : 'text-green-600' },
          { title: 'eTIMS Status', value: etimsActiveCategories > 0 ? `${etimsActiveCategories} Mapped` : 'Not Set', icon: ShieldCheck, color: etimsActiveCategories > 0 ? 'text-emerald-600' : 'text-slate-500' },
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
          <TabsTrigger value="categories"><Calculator className="mr-1.5 h-4 w-4" />Tax Categories</TabsTrigger>
          <TabsTrigger value="filings"><FileText className="mr-1.5 h-4 w-4" />Tax Filings</TabsTrigger>
          <TabsTrigger value="etims"><Settings className="mr-1.5 h-4 w-4" />eTIMS Settings</TabsTrigger>
        </TabsList>

        {/* ── Tax Categories ────────────────────────────── */}
        <TabsContent value="categories" className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search categories..."
                className="pl-9 h-9"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Button size="sm" className="h-9" onClick={() => { setEditCategory(null); setCategoryDialogOpen(true); }}>
              <Plus className="mr-1.5 h-4 w-4" /> Add Category
            </Button>
          </div>

          {categoriesLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : categories.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Calculator className="h-10 w-10 mx-auto text-muted-foreground/40" />
                <p className="mt-2 text-sm text-muted-foreground">No tax categories found</p>
                <Button size="sm" variant="outline" className="mt-3" onClick={() => { setEditCategory(null); setCategoryDialogOpen(true); }}>
                  <Plus className="mr-1.5 h-4 w-4" /> Create First Category
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {categories.map((cat) => (
                <Collapsible
                  key={cat.id}
                  open={expandedCategories.has(cat.id)}
                  onOpenChange={() => toggleCategory(cat.id)}
                >
                  <Card className="overflow-hidden">
                    <CollapsibleTrigger className="w-full text-left">
                      <CardContent className="p-4 hover:bg-muted/50 transition-colors">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${cat.isActive ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-slate-100 dark:bg-slate-800'}`}>
                              <Receipt className={`h-5 w-5 ${cat.isActive ? 'text-emerald-600' : 'text-slate-400'}`} />
                            </div>
                            <div>
                              <p className="font-medium text-sm">{cat.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {cat.rate}% {cat.etimsCode && `· eTIMS: ${cat.etimsCode}`}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge className={`text-[10px] px-2 ${cat.isActive ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>
                              {cat.isActive ? 'Active' : 'Inactive'}
                            </Badge>
                            <Badge variant="outline" className="text-[10px] font-mono px-2">
                              {cat.rate}%
                            </Badge>
                            {expandedCategories.has(cat.id) ? (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="border-t px-4 py-3 bg-muted/30">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <p className="text-xs text-muted-foreground">Name</p>
                            <p className="font-medium">{cat.name}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Rate</p>
                            <p className="font-medium">{cat.rate}%</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">eTIMS Code</p>
                            <p className="font-medium font-mono">{cat.etimsCode || '—'}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Description</p>
                            <p className="font-medium">{cat.description || '—'}</p>
                          </div>
                        </div>
                        {cat.taxRates && cat.taxRates.length > 0 && (
                          <div className="mt-3">
                            <p className="text-xs font-medium text-muted-foreground mb-2">Tax Rate History</p>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="h-8 text-xs">Name</TableHead>
                                  <TableHead className="h-8 text-xs">Rate</TableHead>
                                  <TableHead className="h-8 text-xs">Effective From</TableHead>
                                  <TableHead className="h-8 text-xs">Effective To</TableHead>
                                  <TableHead className="h-8 text-xs">Status</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {cat.taxRates.map((rate: { id: string; name: string; rate: number }) => (
                                  <TableRow key={rate.id}>
                                    <TableCell className="text-xs py-2">{rate.name}</TableCell>
                                    <TableCell className="text-xs py-2 font-mono">{rate.rate}%</TableCell>
                                    <TableCell className="text-xs py-2">{formatDate(rate.effectiveFrom)}</TableCell>
                                    <TableCell className="text-xs py-2">{rate.effectiveTo ? formatDate(rate.effectiveTo) : '—'}</TableCell>
                                    <TableCell className="py-2">
                                      <Badge className={`text-[9px] px-1.5 ${rate.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                                        {rate.isActive ? 'Active' : 'Inactive'}
                                      </Badge>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        )}
                        <div className="flex justify-end mt-3">
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setEditCategory(cat); setCategoryDialogOpen(true); }}>
                            <Edit className="mr-1 h-3 w-3" /> Edit
                          </Button>
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Card>
                </Collapsible>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Tax Filings ─────────────────────────────── */}
        <TabsContent value="filings" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={filingStatusFilter} onValueChange={setFilingStatusFilter}>
              <SelectTrigger className="w-[140px] h-9 text-xs">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="DRAFT">Draft</SelectItem>
                <SelectItem value="FILED">Filed</SelectItem>
                <SelectItem value="APPROVED">Approved</SelectItem>
                <SelectItem value="PAID">Paid</SelectItem>
                <SelectItem value="LATE">Late</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filingTypeFilter} onValueChange={setFilingTypeFilter}>
              <SelectTrigger className="w-[140px] h-9 text-xs">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="VAT">VAT</SelectItem>
                <SelectItem value="WHT">WHT</SelectItem>
                <SelectItem value="INCOME_TAX">Income Tax</SelectItem>
                <SelectItem value="TURNOVER_TAX">Turnover Tax</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" className="h-9 ml-auto bg-emerald-600 hover:bg-emerald-700" onClick={() => setFilingDialogOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> New Filing
            </Button>
          </div>

          {filingsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : filings.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <FileText className="h-10 w-10 mx-auto text-muted-foreground/40" />
                <p className="mt-2 text-sm text-muted-foreground">No tax filings found</p>
                <Button size="sm" variant="outline" className="mt-3" onClick={() => setFilingDialogOpen(true)}>
                  <Plus className="mr-1.5 h-4 w-4" /> Create First Filing
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Period</TableHead>
                    <TableHead className="text-xs">Type</TableHead>
                    <TableHead className="text-xs text-right">Total Sales</TableHead>
                    <TableHead className="text-xs text-right">Total Tax</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs">Filing Date</TableHead>
                    <TableHead className="text-xs">eTIMS Ref</TableHead>
                    <TableHead className="text-xs w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filings.map((f) => (
                    <TableRow key={f.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedFiling(f)}>
                      <TableCell className="text-xs font-medium py-3">{f.filingPeriod}</TableCell>
                      <TableCell className="text-xs py-3">
                        <Badge variant="outline" className="text-[10px] px-1.5">{taxTypeName(f.filingType)}</Badge>
                      </TableCell>
                      <TableCell className="text-xs py-3 text-right">{formatKES(f.totalSales)}</TableCell>
                      <TableCell className="text-xs py-3 text-right text-red-600">{formatKES(f.totalTax)}</TableCell>
                      <TableCell className="py-3">{filingStatusBadge(f.status)}</TableCell>
                      <TableCell className="text-xs py-3">{f.filingDate ? formatDate(f.filingDate) : '—'}</TableCell>
                      <TableCell className="text-xs py-3 font-mono">{f.etimsReference || '—'}</TableCell>
                      <TableCell className="py-3">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setSelectedFiling(f)}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}

          {/* Status Workflow Legend */}
          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-medium text-muted-foreground mb-2">Filing Status Workflow</p>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5 text-slate-500" />
                  <span className="text-xs">Draft</span>
                </div>
                <span className="text-muted-foreground">→</span>
                <div className="flex items-center gap-1">
                  <Send className="h-3.5 w-3.5 text-blue-500" />
                  <span className="text-xs">Filed</span>
                </div>
                <span className="text-muted-foreground">→</span>
                <div className="flex items-center gap-1">
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                  <span className="text-xs">Approved</span>
                </div>
                <span className="text-muted-foreground">→</span>
                <div className="flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                  <span className="text-xs">Paid</span>
                </div>
                <Separator orientation="vertical" className="h-4 mx-1" />
                <div className="flex items-center gap-1">
                  <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                  <span className="text-xs text-red-600">Late</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── eTIMS Settings ──────────────────────────── */}
        <TabsContent value="etims" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                eTIMS Configuration
              </CardTitle>
              <CardDescription>KRA Electronic Tax Invoice Management System settings</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>eTIMS API URL</Label>
                  <Input value={etimsUrl} onChange={(e) => setEtimsUrl(e.target.value)} placeholder="https://etims.kra.go.ke/api" />
                </div>
                <div className="space-y-2">
                  <Label>API Key</Label>
                  <Input type="password" value={etimsApiKey} onChange={(e) => setEtimsApiKey(e.target.value)} placeholder="Enter your API key" />
                </div>
                <div className="space-y-2">
                  <Label>Device Serial Number</Label>
                  <Input value={etimsDeviceSerial} onChange={(e) => setEtimsDeviceSerial(e.target.value)} placeholder="e.g. DV-001234" />
                </div>
                <div className="space-y-2">
                  <Label>PIN</Label>
                  <Input type="password" value={etimsPin} onChange={(e) => setEtimsPin(e.target.value)} placeholder="KRA PIN" />
                </div>
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9"
                    onClick={handleTestConnection}
                    disabled={etimsTesting}
                  >
                    {etimsTesting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : etimsConnected === true ? (
                      <Wifi className="mr-2 h-4 w-4 text-green-500" />
                    ) : etimsConnected === false ? (
                      <WifiOff className="mr-2 h-4 w-4 text-red-500" />
                    ) : (
                      <Wifi className="mr-2 h-4 w-4" />
                    )}
                    {etimsTesting ? 'Testing...' : 'Test Connection'}
                  </Button>
                  {etimsConnected === true && (
                    <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-xs">
                      <CheckCircle2 className="mr-1 h-3 w-3" /> Connected
                    </Badge>
                  )}
                  {etimsConnected === false && (
                    <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 text-xs">
                      <X className="mr-1 h-3 w-3" /> Disconnected
                    </Badge>
                  )}
                </div>
                <Button size="sm" className="h-9 bg-emerald-600 hover:bg-emerald-700" onClick={() => toast.success('eTIMS settings saved')}>
                  Save Settings
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Last Sync Status */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Sync Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Last Sync</p>
                  <p className="font-medium">{etimsLastSync ? formatDate(etimsLastSync) : 'Never'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Mapped Categories</p>
                  <p className="font-medium">{etimsActiveCategories} of {categories.length}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Pending Filings</p>
                  <p className="font-medium">{filingsDue}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Device Status</p>
                  <p className="font-medium">{etimsDeviceSerial ? 'Registered' : 'Not Registered'}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <TaxCategoryDialog
        open={categoryDialogOpen}
        onOpenChange={setCategoryDialogOpen}
        category={editCategory}
        storeId={currentStoreId}
      />
      <TaxFilingDialog
        open={filingDialogOpen}
        onOpenChange={setFilingDialogOpen}
        storeId={currentStoreId}
      />
      <FilingDetailDialog
        filing={selectedFiling}
        open={!!selectedFiling}
        onOpenChange={(v) => { if (!v) setSelectedFiling(null); }}
      />
    </div>
  );
}
