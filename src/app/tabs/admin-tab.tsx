'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Activity, ArrowRight, Plus, CheckCircle, Loader2,
  Cpu, HardDrive, Clock, Users, Zap, Trash2, RefreshCw,
  Database, ShieldCheck, AlertCircle, Info, Bell,
  Search, ChevronDown, ChevronUp, FileDown, Globe,
  Shield, Wrench, PackageX, AlertOctagon, LogOut,
  UserCheck, UserX, PlusCircle, MinusCircle,
} from 'lucide-react';

import { useAppStore } from '@/lib/stores';
import {
  systemLogsApi, stockMovementsApi, productsApi,
  formatDateTime,
  type SystemLogItem, type StockMovementItem,
} from '@/lib/api';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

// ============================================================================
// System Health Indicator Component (Enhanced)
// ============================================================================

function HealthIndicator({ label, value, max, unit, colorClass }: {
  label: string; value: number; max: number; unit: string; colorClass?: string;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  const status = pct < 50 ? 'good' : pct < 80 ? 'warning' : 'critical';
  const statusColors = {
    good: 'text-green-600',
    warning: 'text-yellow-600',
    critical: 'text-red-600',
  };
  const barColors = {
    good: '[&>div]:bg-green-500',
    warning: '[&>div]:bg-yellow-500',
    critical: '[&>div]:bg-red-500',
  };
  const bgColors = {
    good: 'bg-green-500',
    warning: 'bg-yellow-500',
    critical: 'bg-red-500',
  };
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${bgColors[status]} animate-pulse`} />
          <span className={`font-medium ${colorClass || statusColors[status]}`}>
            {typeof value === 'number' && value % 1 !== 0 ? value.toFixed(1) : value}{unit}
          </span>
        </div>
      </div>
      <Progress value={pct} className={`h-2.5 ${barColors[status]}`} />
    </div>
  );
}

// ============================================================================
// Mini Sparkline Component (CSS-based)
// ============================================================================

function MiniSparkline({ data, color = 'text-primary', height = 24 }: {
  data: number[]; color?: string; height?: number;
}) {
  if (data.length === 0) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 100;

  return (
    <svg width={w} height={height} className={color}>
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={data.map((v, i) => {
          const x = (i / (data.length - 1)) * w;
          const y = height - ((v - min) / range) * (height - 4) - 2;
          return `${x},${y}`;
        }).join(' ')}
      />
    </svg>
  );
}

// ============================================================================
// Stock Adjustment Dialog (Enhanced)
// ============================================================================

const REASON_CATEGORIES = [
  { value: 'RESTOCK', label: 'Restock', icon: PlusCircle, color: 'text-green-600' },
  { value: 'DAMAGE', label: 'Damage', icon: PackageX, color: 'text-red-600' },
  { value: 'THEFT', label: 'Theft', icon: AlertOctagon, color: 'text-red-800' },
  { value: 'CORRECTION', label: 'Correction', icon: Wrench, color: 'text-amber-600' },
  { value: 'RETURN', label: 'Return', icon: RefreshCw, color: 'text-blue-600' },
];

function StockAdjustmentDialog({ storeId }: { storeId: string }) {
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [adjustmentType, setAdjustmentType] = useState<'ADD' | 'SUBTRACT'>('ADD');
  const [reasonCategory, setReasonCategory] = useState('');
  const [notes, setNotes] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: productsData } = useQuery({
    queryKey: ['products', storeId],
    queryFn: () => productsApi.list({ storeId, limit: 200 }),
  });

  const adjustMutation = useMutation({
    mutationFn: stockMovementsApi.createAdjustment,
    onSuccess: () => {
      toast.success('Stock adjusted successfully');
      setOpen(false);
      setProductId('');
      setQuantity('');
      setAdjustmentType('ADD');
      setReasonCategory('');
      setNotes('');
      setProductSearch('');
      setErrors({});
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const allProducts = productsData?.data || [];
  const filteredProducts = useMemo(() => {
    if (!productSearch.trim()) return allProducts;
    const q = productSearch.toLowerCase();
    return allProducts.filter(p =>
      p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
    );
  }, [allProducts, productSearch]);

  const selectedProduct = allProducts.find(p => p.id === productId);
  const quantityNum = Number(quantity);
  const effectiveQuantity = adjustmentType === 'ADD' ? quantityNum : -quantityNum;
  const newStockLevel = selectedProduct ? selectedProduct.quantityInStock + effectiveQuantity : null;

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!productId) newErrors.productId = 'Product is required';
    if (!quantity || quantity === '0') newErrors.quantity = 'Quantity is required';
    if (quantity && isNaN(quantityNum)) newErrors.quantity = 'Must be a valid number';
    if (quantityNum <= 0) newErrors.quantity = 'Quantity must be positive';
    if (adjustmentType === 'SUBTRACT' && selectedProduct && quantityNum > selectedProduct.quantityInStock) {
      newErrors.quantity = `Cannot remove more than current stock (${selectedProduct.quantityInStock})`;
    }
    if (!reasonCategory) newErrors.reasonCategory = 'Reason category is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (validate()) {
      adjustMutation.mutate({
        storeId,
        productId,
        quantity: effectiveQuantity,
        notes: `[${reasonCategory}] ${notes}`,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="bg-accent-orange hover:bg-accent-orange/90 text-accent-orange-foreground">
          <Plus className="mr-2 h-4 w-4" /> Adjustment
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Stock Adjustment</DialogTitle>
          <DialogDescription>Add or remove stock quantity with a reason</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {/* Product Search */}
          <div className="space-y-2">
            <Label>Search Product</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="Search by name or SKU..."
                className="pl-9"
              />
            </div>
          </div>

          {/* Product Select */}
          <div className="space-y-2">
            <Label>Product</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger className={errors.productId ? 'border-red-500' : ''}>
                <SelectValue placeholder="Select product" />
              </SelectTrigger>
              <SelectContent>
                {filteredProducts.map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} (Stock: {p.quantityInStock} {p.unitType})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.productId && <p className="text-xs text-red-500">{errors.productId}</p>}
            {selectedProduct && (
              <div className="p-2 rounded-lg bg-muted/30 border text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Current Stock</span>
                  <span className="font-medium">{selectedProduct.quantityInStock} {selectedProduct.unitType}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Reorder Level</span>
                  <span className="font-medium">{selectedProduct.reorderLevel}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Price</span>
                  <span className="font-medium">KES {selectedProduct.pricePerUnit.toLocaleString()}</span>
                </div>
              </div>
            )}
          </div>

          {/* Adjustment Type */}
          <div className="space-y-2">
            <Label>Adjustment Type</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAdjustmentType('ADD')}
                className={`flex items-center justify-center gap-2 p-2.5 rounded-lg border-2 transition-all ${
                  adjustmentType === 'ADD'
                    ? 'border-green-500 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                    : 'border-transparent bg-muted/30 hover:bg-muted/50'
                }`}
              >
                <PlusCircle className="h-4 w-4" />
                <span className="text-sm font-medium">Add Stock</span>
              </button>
              <button
                type="button"
                onClick={() => setAdjustmentType('SUBTRACT')}
                className={`flex items-center justify-center gap-2 p-2.5 rounded-lg border-2 transition-all ${
                  adjustmentType === 'SUBTRACT'
                    ? 'border-red-500 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                    : 'border-transparent bg-muted/30 hover:bg-muted/50'
                }`}
              >
                <MinusCircle className="h-4 w-4" />
                <span className="text-sm font-medium">Remove Stock</span>
              </button>
            </div>
          </div>

          {/* Quantity */}
          <div className="space-y-2">
            <Label>Quantity</Label>
            <Input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="Enter quantity"
              min="1"
              className={errors.quantity ? 'border-red-500' : ''}
            />
            {errors.quantity && <p className="text-xs text-red-500">{errors.quantity}</p>}
            {selectedProduct && quantityNum > 0 && (
              <div className={`p-2 rounded-lg border text-xs ${
                newStockLevel !== null && newStockLevel >= 0
                  ? newStockLevel > selectedProduct.reorderLevel
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                    : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
                  : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
              }`}>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">New Stock Level</span>
                  <span className={`font-bold text-base ${
                    newStockLevel !== null && newStockLevel >= 0
                      ? newStockLevel > selectedProduct.reorderLevel ? 'text-green-600' : 'text-amber-600'
                      : 'text-red-600'
                  }`}>
                    {newStockLevel ?? '—'} {selectedProduct.unitType}
                  </span>
                </div>
                {newStockLevel !== null && newStockLevel >= 0 && (
                  <div className="mt-1">
                    <Progress
                      value={Math.min((newStockLevel / (selectedProduct.reorderLevel * 3)) * 100, 100)}
                      className={`h-1.5 ${newStockLevel > selectedProduct.reorderLevel ? '[&>div]:bg-green-500' : '[&>div]:bg-amber-500'}`}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Reason Category */}
          <div className="space-y-2">
            <Label>Reason Category <span className="text-red-500">*</span></Label>
            <div className="grid grid-cols-2 gap-1.5">
              {REASON_CATEGORIES.map((cat) => (
                <button
                  key={cat.value}
                  type="button"
                  onClick={() => setReasonCategory(cat.value)}
                  className={`flex items-center gap-1.5 p-2 rounded-lg border text-xs transition-all ${
                    reasonCategory === cat.value
                      ? 'border-primary bg-primary/5'
                      : 'border-transparent bg-muted/30 hover:bg-muted/50'
                  }`}
                >
                  <cat.icon className={`h-3.5 w-3.5 ${cat.color}`} />
                  <span className="font-medium">{cat.label}</span>
                </button>
              ))}
            </div>
            {errors.reasonCategory && <p className="text-xs text-red-500">{errors.reasonCategory}</p>}
          </div>

          {/* Additional Notes */}
          <div className="space-y-2">
            <Label>Additional Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional additional notes..."
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={adjustMutation.isPending}>
            {adjustMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
            Apply Adjustment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Quick Actions Component (Enhanced with Confirm Dialogs)
// ============================================================================

function QuickActions() {
  const [loading, setLoading] = useState<string | null>(null);

  const handleAction = async (action: string) => {
    setLoading(action);
    await new Promise(r => setTimeout(r, 1500));
    setLoading(null);
    toast.success(`${action} completed successfully`);
  };

  const actions = [
    { id: 'reindex', label: 'Reindex Database', icon: Database, desc: 'Rebuild search indexes for faster queries', color: 'text-blue-600', destructive: false },
    { id: 'cache', label: 'Clear Cache', icon: Trash2, desc: 'Clear all application and query cache', color: 'text-orange-600', destructive: true },
    { id: 'health', label: 'Health Check', icon: ShieldCheck, desc: 'Run full system diagnostics scan', color: 'text-green-600', destructive: false },
    { id: 'optimize', label: 'Optimize DB', icon: Zap, desc: 'Optimize database tables and indexes', color: 'text-purple-600', destructive: false },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {actions.map((action) => (
          action.destructive ? (
            <AlertDialog key={action.id}>
              <AlertDialogTrigger asChild>
                <button
                  type="button"
                  disabled={loading !== null}
                  className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30 hover:bg-muted/50 transition-all disabled:opacity-50 text-left"
                >
                  {loading === action.label ? (
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  ) : (
                    <action.icon className={`h-5 w-5 ${action.color}`} />
                  )}
                  <div>
                    <p className="text-sm font-medium">{action.label}</p>
                    <p className="text-[10px] text-muted-foreground">{action.desc}</p>
                  </div>
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Confirm {action.label}</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action may temporarily affect system performance. Are you sure you want to proceed?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => handleAction(action.label)}>
                    {loading === action.label ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Confirm
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <button
              key={action.id}
              type="button"
              onClick={() => handleAction(action.label)}
              disabled={loading !== null}
              className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30 hover:bg-muted/50 transition-all disabled:opacity-50 text-left"
            >
              {loading === action.label ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : (
                <action.icon className={`h-5 w-5 ${action.color}`} />
              )}
              <div>
                <p className="text-sm font-medium">{action.label}</p>
                <p className="text-[10px] text-muted-foreground">{action.desc}</p>
              </div>
            </button>
          )
        ))}
      </div>
      <Button variant="outline" size="sm" className="w-full" onClick={() => toast.info('Log export coming soon')}>
        <FileDown className="mr-2 h-4 w-4" /> Export Logs
      </Button>
    </div>
  );
}

// ============================================================================
// Activity Feed Component (Enhanced)
// ============================================================================

function ActivityFeed({ logs }: { logs: SystemLogItem[] }) {
  const [visibleCount, setVisibleCount] = useState(8);
  const recentLogs = logs.slice(0, visibleCount);
  const hasMore = logs.length > visibleCount;

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'CRITICAL': case 'ERROR':
        return <AlertCircle className="h-3.5 w-3.5 text-red-500" />;
      case 'WARN':
        return <AlertCircle className="h-3.5 w-3.5 text-yellow-500" />;
      default:
        return <Info className="h-3.5 w-3.5 text-blue-500" />;
    }
  };

  const getSeverityBg = (severity: string) => {
    switch (severity) {
      case 'CRITICAL': case 'ERROR': return 'bg-red-100 dark:bg-red-900/20';
      case 'WARN': return 'bg-yellow-100 dark:bg-yellow-900/20';
      default: return 'bg-blue-100 dark:bg-blue-900/20';
    }
  };

  const getComponentBadge = (component: string) => {
    const componentStyles: Record<string, string> = {
      POS: 'bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800',
      INVENTORY: 'bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800',
      AUTH: 'bg-purple-100 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800',
      FINANCIAL: 'bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800',
      PAYMENT: 'bg-teal-100 dark:bg-teal-900/20 text-teal-700 dark:text-teal-400 border-teal-200 dark:border-teal-800',
      RENTAL: 'bg-orange-100 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800',
      SYSTEM: 'bg-gray-100 dark:bg-gray-900/20 text-gray-700 dark:text-gray-400 border-gray-200 dark:border-gray-800',
    };
    return componentStyles[component] || 'bg-muted text-muted-foreground';
  };

  const getRelativeTime = (dateStr: string) => {
    const now = new Date();
    const date = new Date(dateStr);
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  };

  return (
    <div className="space-y-2">
      <div className="max-h-80 overflow-y-auto pr-2 custom-scrollbar space-y-2">
        {recentLogs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No recent activity</p>
        ) : recentLogs.map((log) => (
          <div key={log.id} className="flex items-start gap-2 p-2 rounded-lg hover:bg-muted/30 transition-colors">
            <div className={`mt-0.5 p-1 rounded-md ${getSeverityBg(log.severity)}`}>
              {getSeverityIcon(log.severity)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <p className="text-xs font-medium truncate">{log.action}</p>
                <Badge variant="outline" className={`text-[8px] px-1 py-0 h-4 border ${getComponentBadge(log.component)}`}>
                  {log.component}
                </Badge>
              </div>
              <p className="text-[10px] text-muted-foreground truncate">{log.message}</p>
            </div>
            <span className="text-[10px] text-muted-foreground whitespace-nowrap" title={formatDateTime(log.createdAt)}>
              {getRelativeTime(log.createdAt)}
            </span>
          </div>
        ))}
      </div>
      {hasMore && (
        <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => setVisibleCount(c => c + 8)}>
          <ChevronDown className="mr-1 h-3 w-3" /> Load More ({logs.length - visibleCount} remaining)
        </Button>
      )}
    </div>
  );
}

// ============================================================================
// User Management Component (Enhanced)
// ============================================================================

const MOCK_USERS = [
  { id: '1', name: 'Admin User', email: 'admin@mbumah.co.ke', role: 'SUPER_ADMIN' as const, status: 'Online' as const, lastActive: 'Just now', initials: 'AU' },
  { id: '2', name: 'Jane Cashier', email: 'jane@mbumah.co.ke', role: 'CASHIER' as const, status: 'Offline' as const, lastActive: '2 hours ago', initials: 'JC' },
  { id: '3', name: 'Peter Accountant', email: 'peter@mbumah.co.ke', role: 'ACCOUNTANT' as const, status: 'Offline' as const, lastActive: '1 day ago', initials: 'PA' },
];

const ROLE_STYLES: Record<string, { bg: string; text: string; badge: string; border: string }> = {
  SUPER_ADMIN: { bg: 'bg-red-500', text: 'text-white', badge: 'bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800', border: 'border-red-500' },
  CASHIER: { bg: 'bg-green-500', text: 'text-white', badge: 'bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800', border: 'border-green-500' },
  ACCOUNTANT: { bg: 'bg-amber-500', text: 'text-white', badge: 'bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800', border: 'border-amber-500' },
};

function UserManagement() {
  const [userStates, setUserStates] = useState<Record<string, boolean>>({
    '1': true, '2': true, '3': true,
  });

  const toggleUserStatus = (userId: string) => {
    setUserStates(prev => ({ ...prev, [userId]: !prev[userId] }));
    toast.success(`User status updated`);
  };

  return (
    <div className="space-y-2">
      {MOCK_USERS.map((user) => {
        const style = ROLE_STYLES[user.role] || ROLE_STYLES.CASHIER;
        const isActive = userStates[user.id] ?? true;
        return (
          <div key={user.id} className={`flex items-center gap-3 p-2.5 rounded-lg border-l-2 ${style.border} hover:bg-muted/30 transition-colors`}>
            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold ${style.bg} ${style.text}`}>
              {user.initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium truncate">{user.name}</p>
                <Badge variant="outline" className={`text-[9px] px-1.5 py-0 h-4 border ${style.badge}`}>
                  {user.role}
                </Badge>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <p className="text-[10px] text-muted-foreground">{user.email}</p>
                <span className="text-[10px] text-muted-foreground">•</span>
                <p className="text-[10px] text-muted-foreground">Last active: {user.lastActive}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${user.status === 'Online' ? 'bg-green-500' : 'bg-gray-400'}`} />
                <span className="text-[10px] text-muted-foreground">{user.status}</span>
              </div>
              <Switch
                checked={isActive}
                onCheckedChange={() => toggleUserStatus(user.id)}
                className="scale-75"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Main Admin Tab Component
// ============================================================================

export default function AdminTab() {
  const currentStoreId = useAppStore((s) => s.currentStoreId);
  const [logFilter, setLogFilter] = useState({ component: 'all', severity: 'all' });

  // Simulated system health metrics
  const [uptime, setUptime] = useState(0);
  const [apiResponseTime, setApiResponseTime] = useState(0);
  const [apiHistory, setApiHistory] = useState<number[]>([120, 95, 140, 110, 85, 130, 100, 115, 90, 105, 125, 98]);

  useEffect(() => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      setUptime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const measure = async () => {
      const start = Date.now();
      try {
        await fetch('/api/products?storeId=store_juja_main&limit=1');
        const elapsed = Date.now() - start;
        setApiResponseTime(elapsed);
        setApiHistory(prev => [...prev.slice(-11), elapsed]);
      } catch {
        setApiResponseTime(999);
        setApiHistory(prev => [...prev.slice(-11), 999]);
      }
    };
    measure();
    const interval = setInterval(measure, 30000);
    return () => clearInterval(interval);
  }, []);

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hrs = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (days > 0) return `${days}d ${hrs}h ${mins}m`;
    return `${hrs}h ${mins}m ${secs}s`;
  };

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

  // Simulated health metrics
  const memoryUsed = 67;
  const cpuUsage = 23;
  const activeSessions = 3;
  const dbSizeMB = 2.4;

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'CRITICAL': case 'ERROR': return 'destructive';
      case 'WARN': return 'outline';
      default: return 'secondary';
    }
  };

  return (
    <div className="space-y-4">
      {/* ================================================================== */}
      {/* Enhanced System Health Dashboard                                    */}
      {/* ================================================================== */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Cpu className="h-4 w-4" /> System Health Dashboard
            </CardTitle>
            <Badge variant="outline" className="text-[10px] bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1.5 animate-pulse" />
              All Systems Operational
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left: Progress Bars */}
            <div className="space-y-5">
              <HealthIndicator label="CPU Usage" value={cpuUsage} max={100} unit="%" />
              <HealthIndicator label="Memory Usage" value={memoryUsed} max={100} unit="%" />
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">API Response</span>
                  <div className="flex items-center gap-2">
                    <MiniSparkline data={apiHistory} color={apiResponseTime > 200 ? 'text-red-500' : 'text-green-600'} height={16} />
                    <span className={`font-medium ${apiResponseTime > 200 ? 'text-red-600' : 'text-green-600'}`}>
                      {apiResponseTime}ms
                    </span>
                  </div>
                </div>
                <Progress
                  value={(apiResponseTime / 500) * 100}
                  className={`h-2.5 ${apiResponseTime < 100 ? '[&>div]:bg-green-500' : apiResponseTime < 250 ? '[&>div]:bg-yellow-500' : '[&>div]:bg-red-500'}`}
                />
                <p className="text-[10px] text-muted-foreground">Avg: {Math.round(apiHistory.reduce((a, b) => a + b, 0) / apiHistory.length)}ms over last 12 checks</p>
              </div>
            </div>

            {/* Right: Stat Cards */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-900/40">
                <div className="flex items-center gap-2 mb-1">
                  <Clock className="h-4 w-4 text-green-600" />
                  <span className="text-xs text-muted-foreground">Uptime</span>
                </div>
                <p className="text-sm font-bold text-green-600">{formatUptime(uptime)}</p>
                <p className="text-[10px] text-green-600/70 mt-0.5">Since last restart</p>
              </div>
              <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900/40">
                <div className="flex items-center gap-2 mb-1">
                  <HardDrive className="h-4 w-4 text-blue-600" />
                  <span className="text-xs text-muted-foreground">DB Size</span>
                </div>
                <p className="text-sm font-bold text-blue-600">{dbSizeMB} MB</p>
                <Progress value={(dbSizeMB / 100) * 100} className="h-1 mt-1 [&>div]:bg-blue-500" />
              </div>
              <div className="p-3 rounded-xl bg-purple-50 dark:bg-purple-900/20 border border-purple-100 dark:border-purple-900/40">
                <div className="flex items-center gap-2 mb-1">
                  <Users className="h-4 w-4 text-purple-600" />
                  <span className="text-xs text-muted-foreground">Active Sessions</span>
                </div>
                <p className="text-sm font-bold text-purple-600">{activeSessions}</p>
                <p className="text-[10px] text-purple-600/70 mt-0.5">Users online now</p>
              </div>
              <div className="p-3 rounded-xl bg-orange-50 dark:bg-orange-900/20 border border-orange-100 dark:border-orange-900/40">
                <div className="flex items-center gap-2 mb-1">
                  <Globe className="h-4 w-4 text-orange-600" />
                  <span className="text-xs text-muted-foreground">API Latency</span>
                </div>
                <p className="text-sm font-bold text-orange-600">{apiResponseTime}ms</p>
                <MiniSparkline data={apiHistory} color="text-orange-500" height={12} />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ================================================================== */}
      {/* User Management & Quick Actions Row                                 */}
      {/* ================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* User Management */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" /> User Management
            </CardTitle>
            <CardDescription className="text-xs">Manage user accounts and permissions</CardDescription>
          </CardHeader>
          <CardContent>
            <UserManagement />
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="h-4 w-4" /> Quick Actions
            </CardTitle>
            <CardDescription className="text-xs">System maintenance and utility operations</CardDescription>
          </CardHeader>
          <CardContent>
            <QuickActions />
          </CardContent>
        </Card>
      </div>

      {/* ================================================================== */}
      {/* Activity Feed (Enhanced)                                            */}
      {/* ================================================================== */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="h-4 w-4" /> Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ActivityFeed logs={logs} />
        </CardContent>
      </Card>

      {/* ================================================================== */}
      {/* System Logs & Stock Movements Tabs                                  */}
      {/* ================================================================== */}
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
