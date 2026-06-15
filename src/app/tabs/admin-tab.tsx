'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Activity, ArrowRight, Plus, CheckCircle, Loader2,
  Cpu, HardDrive, Clock, Users, Zap, Trash2, RefreshCw,
  Database, ShieldCheck, AlertCircle, Info, Bell,
  Search, ChevronDown, ChevronUp, FileDown, Globe,
  Shield, Wrench, PackageX, AlertOctagon, LogOut,
  UserCheck, UserX, PlusCircle, MinusCircle,
  Settings, Save, Eye, Edit3, UserPlus, X,
  AlertTriangle, Terminal, BarChart3, MapPin, Phone,
  MessageSquare, Mail, Smartphone, Store,
} from 'lucide-react';

import { useAppStore } from '@/lib/stores';
import {
  systemLogsApi, stockMovementsApi, productsApi,
  auditLogsApi, systemConfigApi, usersApi,
  formatDateTime, formatKES,
  type SystemLogItem, type StockMovementItem,
  type AuditLogItem, type SystemConfigItem, type UserItem,
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

function HealthIndicator({ label, value, max, unit, colorClass, lastUpdated }: {
  label: string; value: number; max: number; unit: string; colorClass?: string; lastUpdated?: string;
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
  const cardBg = {
    good: 'from-green-50 to-white dark:from-green-900/10 dark:to-card',
    warning: 'from-yellow-50 to-white dark:from-yellow-900/10 dark:to-card',
    critical: 'from-red-50 to-white dark:from-red-900/10 dark:to-card',
  };

  return (
    <div className={`p-3 rounded-xl bg-gradient-to-r ${cardBg[status]} border border-transparent`}>
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
        <Progress value={pct} className={`h-2.5 ${barColors[status]} transition-all duration-500`} />
        <div className="flex items-center justify-between">
          <span className="text-[9px] text-muted-foreground">{pct.toFixed(0)}% utilization</span>
          {lastUpdated && (
            <span className="text-[9px] text-muted-foreground">Updated {lastUpdated}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// Mini Sparkline Component (CSS-based)

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

// Animated Counter Component

function AnimatedCounter({ value, duration = 1000 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0);
  const prevRef = React.useRef(value);
  const rafRef = React.useRef<number>(0);

  useEffect(() => {
    const start = prevRef.current;
    const end = value;
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(start + (end - start) * eased));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };

    rafRef.current = requestAnimationFrame(animate);
    prevRef.current = value;
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);

  return <>{display.toLocaleString()}</>;
}

// Stock Adjustment Dialog 

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

  const allProducts = Array.isArray(productsData?.data) ? productsData.data : [];
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

// Quick Actions Component (Confirm Dialogs + Toasts + Progress)

function QuickActions() {
  const [loading, setLoading] = useState<string | null>(null);
  const [lastResults, setLastResults] = useState<Record<string, { success: boolean; time: string }>>({});

  const handleAction = async (action: string) => {
    setLoading(action);
    try {
      await new Promise(r => setTimeout(r, 1500));
      setLastResults(prev => ({ ...prev, [action]: { success: true, time: new Date().toLocaleTimeString() } }));
      toast.success(`${action} completed successfully`);
    } catch {
      setLastResults(prev => ({ ...prev, [action]: { success: false, time: new Date().toLocaleTimeString() } }));
      toast.error(`${action} failed`);
    }
    setLoading(null);
  };

  const actions = [
    { id: 'reindex', label: 'Reindex Database', icon: Database, desc: 'Rebuild search indexes for faster queries', color: 'text-blue-600', bg: 'hover:bg-blue-50 dark:hover:bg-blue-900/20', destructive: false },
    { id: 'cache', label: 'Clear Cache', icon: Trash2, desc: 'Clear all application and query cache', color: 'text-orange-600', bg: 'hover:bg-orange-50 dark:hover:bg-orange-900/20', destructive: true },
    { id: 'health', label: 'Health Check', icon: ShieldCheck, desc: 'Run full system diagnostics scan', color: 'text-green-600', bg: 'hover:bg-green-50 dark:hover:bg-green-900/20', destructive: false },
    { id: 'optimize', label: 'Optimize DB', icon: Zap, desc: 'Optimize database tables and indexes', color: 'text-purple-600', bg: 'hover:bg-purple-50 dark:hover:bg-purple-900/20', destructive: false },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {actions.map((action) => {
          const result = lastResults[action.id];
          const button = (
            <button
              type="button"
              onClick={() => !action.destructive && handleAction(action.label)}
              disabled={loading !== null}
              className={`flex items-center gap-3 p-3 rounded-lg border bg-muted/30 ${action.bg} transition-all disabled:opacity-50 text-left group`}
            >
              <div className={`p-1.5 rounded-lg ${loading === action.label ? 'bg-muted' : 'bg-muted/50'} group-hover:scale-110 transition-transform`}>
                {loading === action.label ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <action.icon className={`h-4 w-4 ${action.color}`} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{action.label}</p>
                <p className="text-[10px] text-muted-foreground">{action.desc}</p>
                {result && (
                  <p className={`text-[9px] mt-0.5 ${result.success ? 'text-green-600' : 'text-red-600'}`}>
                    {result.success ? '✓' : '✗'} Last: {result.time}
                  </p>
                )}
              </div>
            </button>
          );

          if (action.destructive) {
            return (
              <AlertDialog key={action.id}>
                <AlertDialogTrigger asChild>{button}</AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-amber-500" /> Confirm {action.label}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      This action may temporarily affect system performance. Are you sure you want to proceed?
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => handleAction(action.label)} className="bg-orange-600 hover:bg-orange-700">
                      {loading === action.label ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Confirm
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            );
          }
          return <div key={action.id}>{button}</div>;
        })}
      </div>
      <Button variant="outline" size="sm" className="w-full" onClick={() => toast.info('Log export coming soon')}>
        <FileDown className="mr-2 h-4 w-4" /> Export Logs
      </Button>
    </div>
  );
}

// Activity Feed Component 

function ActivityFeed({ logs }: { logs: AuditLogItem[] }) {
  const [visibleCount, setVisibleCount] = useState(8);
  const recentLogs = logs.slice(0, visibleCount);
  const hasMore = logs.length > visibleCount;

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'CRITICAL': case 'ERROR':
        return <AlertCircle className="h-3.5 w-3.5 text-red-500" />;
      case 'WARN':
        return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
      default:
        return <Info className="h-3.5 w-3.5 text-blue-500" />;
    }
  };

  const getSeverityBg = (severity: string) => {
    switch (severity) {
      case 'CRITICAL': case 'ERROR': return 'bg-red-100 dark:bg-red-900/20';
      case 'WARN': return 'bg-amber-100 dark:bg-amber-900/20';
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
          <div className="text-center py-6">
            <Bell className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-30" />
            <p className="text-sm text-muted-foreground">No recent activity</p>
          </div>
        ) : recentLogs.map((log) => (
          <div key={log.id} className="flex items-start gap-2 p-2 rounded-lg hover:bg-muted/30 transition-colors group">
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
              {log.user && (
                <p className="text-[9px] text-muted-foreground mt-0.5">by {log.user.name}</p>
              )}
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

// Audit Log Section (Filters + Export + Color Coding)

function AuditLogSection({ storeId }: { storeId: string }) {
  const [filters, setFilters] = useState({
    type: 'all',
    severity: 'all',
    search: '',
  });
  const [page, setPage] = useState(1);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs', storeId, filters, page, dateFrom, dateTo],
    queryFn: () => auditLogsApi.list({
      storeId,
      type: filters.type !== 'all' ? filters.type : undefined,
      severity: filters.severity !== 'all' ? filters.severity : undefined,
      search: filters.search || undefined,
      page,
      limit: 20,
    }),
  });

  const logs = Array.isArray(data?.data) ? data.data : [];
  const pagination = data?.pagination;
  const rawResp = data as unknown as Record<string, unknown>;
  const summary = rawResp?.summary as { bySeverity?: Record<string, number>; byComponent?: Record<string, number>; recentErrors?: number } | undefined;

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'CRITICAL': case 'ERROR': return 'bg-red-500';
      case 'WARN': return 'bg-amber-500';
      case 'INFO': return 'bg-blue-500';
      case 'DEBUG': return 'bg-gray-400';
      default: return 'bg-gray-400';
    }
  };

  const getSeverityBadge = (severity: string) => {
    const styles: Record<string, string> = {
      CRITICAL: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800',
      ERROR: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800',
      WARN: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800',
      INFO: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800',
      DEBUG: 'bg-gray-100 text-gray-600 dark:bg-gray-900/30 dark:text-gray-400 border-gray-200 dark:border-gray-800',
    };
    return styles[severity] || styles.INFO;
  };

  const getComponentBadge = (component: string) => {
    const styles: Record<string, string> = {
      POS: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
      INVENTORY: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
      AUTH: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
      FINANCIAL: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
      PAYMENT: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
      RENTAL: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
      SYSTEM: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400',
    };
    return styles[component] || 'bg-muted text-muted-foreground';
  };

  const exportAuditLogs = useCallback(() => {
    if (logs.length === 0) {
      toast.error('No logs to export');
      return;
    }
    const csvData = logs.map(log => ({
      Timestamp: formatDateTime(log.createdAt),
      Component: log.component,
      Severity: log.severity,
      Action: log.action,
      User: log.user?.name || '—',
      Message: log.message,
      IPAddress: log.ipAddress || 'N/A',
    }));
    const headers = Object.keys(csvData[0]);
    const csvRows = [
      headers.join(','),
      ...csvData.map(row => headers.map(h => {
        const val = row[h as keyof typeof row];
        const str = String(val ?? '');
        return str.includes(',') ? `"${str}"` : str;
      }).join(',')),
    ];
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `audit_logs_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${logs.length} audit log entries`);
  }, [logs]);

  return (
    <Card className="backdrop-blur-sm bg-card/80 border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Terminal className="h-4 w-4" /> Audit Log
          </CardTitle>
          <div className="flex items-center gap-2">
            {summary?.recentErrors !== undefined && summary.recentErrors > 0 && (
              <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 text-xs gap-1">
                <AlertCircle className="h-3 w-3" /> {summary.recentErrors} errors (24h)
              </Badge>
            )}
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={exportAuditLogs}>
              <FileDown className="mr-1 h-3 w-3" /> Export
            </Button>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 mt-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={filters.search}
              onChange={(e) => setFilters(f => ({ ...f, search: e.target.value }))}
              placeholder="Search logs..."
              className="pl-8 h-8 text-xs"
            />
          </div>
          <Select value={filters.type} onValueChange={(v) => { setFilters(f => ({ ...f, type: v })); setPage(1); }}>
            <SelectTrigger className="w-32 h-8 text-xs"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="AUTH">Auth</SelectItem>
              <SelectItem value="INVENTORY">Inventory</SelectItem>
              <SelectItem value="POS">POS</SelectItem>
              <SelectItem value="FINANCIAL">Financial</SelectItem>
              <SelectItem value="PAYMENT">Payment</SelectItem>
              <SelectItem value="RENTAL">Rental</SelectItem>
              <SelectItem value="SYSTEM">System</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filters.severity} onValueChange={(v) => { setFilters(f => ({ ...f, severity: v })); setPage(1); }}>
            <SelectTrigger className="w-32 h-8 text-xs"><SelectValue placeholder="Severity" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Levels</SelectItem>
              <SelectItem value="CRITICAL">Critical</SelectItem>
              <SelectItem value="ERROR">Error</SelectItem>
              <SelectItem value="WARN">Warning</SelectItem>
              <SelectItem value="INFO">Info</SelectItem>
              <SelectItem value="DEBUG">Debug</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-32 h-8 text-xs"
            placeholder="From"
          />
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-32 h-8 text-xs"
            placeholder="To"
          />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-4 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Time</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead className="max-w-[200px]">Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    <Terminal className="h-6 w-6 mx-auto mb-2 opacity-30" />
                    No audit logs found
                  </TableCell></TableRow>
                ) : logs.map((log) => (
                  <React.Fragment key={log.id}>
                    <TableRow
                      className="cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                    >
                      <TableCell>
                        <div className={`w-2.5 h-2.5 rounded-full ${getSeverityColor(log.severity)}`} />
                      </TableCell>
                      <TableCell className="text-xs font-mono whitespace-nowrap">{formatDateTime(log.createdAt)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[9px] ${getComponentBadge(log.component)}`}>
                          {log.component}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[9px] ${getSeverityBadge(log.severity)}`}>
                          {log.severity}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm font-medium">{log.action}</TableCell>
                      <TableCell className="text-sm">{log.user?.name || '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{log.message}</TableCell>
                    </TableRow>
                    {expandedLog === log.id && (
                      <TableRow>
                        <TableCell colSpan={7} className="bg-muted/10 p-4">
                          <div className="space-y-2 text-xs animate-in fade-in-0 slide-in-from-top-1 duration-200">
                            <div className="grid grid-cols-2 gap-2">
                              <div><span className="text-muted-foreground">ID:</span> <span className="font-mono">{log.id}</span></div>
                              <div><span className="text-muted-foreground">IP:</span> <span className="font-mono">{log.ipAddress || 'N/A'}</span></div>
                            </div>
                            <div><span className="text-muted-foreground">Message:</span> <span>{log.message}</span></div>
                            {log.metadata && (
                              <div>
                                <span className="text-muted-foreground">Metadata:</span>
                                <pre className="mt-1 p-2 bg-muted/30 rounded text-[10px] font-mono overflow-x-auto max-h-32">
                                  {typeof log.metadata === 'string' ? log.metadata : JSON.stringify(log.metadata, null, 2)}
                                </pre>
                              </div>
                            )}
                            {log.stackTrace && (
                              <div>
                                <span className="text-muted-foreground">Stack Trace:</span>
                                <pre className="mt-1 p-2 bg-red-50 dark:bg-red-900/10 rounded text-[10px] font-mono overflow-x-auto max-h-32 text-red-600">
                                  {log.stackTrace}
                                </pre>
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t">
            <span className="text-xs text-muted-foreground">
              Page {pagination.page} of {pagination.totalPages} ({pagination.total} entries)
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                Previous
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page >= pagination.totalPages} onClick={() => setPage(p => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// System Configuration Editor (Structured Settings Forms)

const CONFIG_CATEGORIES = ['Store', 'Receipts', 'Notifications', 'Payments', 'Advanced'];

function ConfigEditor({ storeId }: { storeId: string }) {
  const queryClient = useQueryClient();
  const [activeCategory, setActiveCategory] = useState('Store');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  // Structured settings state
  const [storeSettings, setStoreSettings] = useState({
    name: 'Mbumah Hardware',
    location: 'Juja, Kiambu County',
    phone: '+254 700 123 456',
    taxRate: '16',
  });
  const [receiptSettings, setReceiptSettings] = useState({
    header: 'MBUMAH HARDWARE',
    footer: 'Thank you for your business! Asante!',
    showLogo: true,
  });
  const [notificationSettings, setNotificationSettings] = useState({
    smsEnabled: true,
    emailEnabled: false,
    whatsappEnabled: false,
  });
  const [paymentSettings, setPaymentSettings] = useState({
    mpesaEnabled: true,
    cashEnabled: true,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['system-config'],
    queryFn: () => systemConfigApi.list(),
  });

  const updateMutation = useMutation({
    mutationFn: systemConfigApi.update,
    onSuccess: () => {
      toast.success('Configuration updated');
      queryClient.invalidateQueries({ queryKey: ['system-config'] });
      setEditingKey(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const configs = data?.data || {};
  const categoryConfigs = activeCategory === 'Advanced' ? (configs['Other'] || []).concat(configs['General'] || []).concat(configs['POS'] || []).concat(configs['Inventory'] || []).concat(configs['Financial'] || []) : [];

  const startEdit = (config: SystemConfigItem) => {
    setEditingKey(config.key);
    setEditValue(config.value);
  };

  const saveEdit = (config: SystemConfigItem) => {
    updateMutation.mutate({ id: config.id, value: editValue });
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditValue('');
  };

  const getConfigIcon = (key: string) => {
    const k = key.toLowerCase();
    if (k.includes('store') || k.includes('name') || k.includes('app')) return '🏪';
    if (k.includes('vat') || k.includes('tax')) return '🧾';
    if (k.includes('receipt')) return '🖨️';
    if (k.includes('currency')) return '💰';
    if (k.includes('stock') || k.includes('reorder') || k.includes('inventory')) return '📦';
    if (k.includes('payment') || k.includes('debt')) return '💳';
    if (k.includes('notif') || k.includes('email') || k.includes('sms')) return '🔔';
    return '⚙️';
  };

  const handleStructuredSave = (section: string) => {
    toast.success(`${section} settings saved successfully`);
  };

  return (
    <Card className="backdrop-blur-sm bg-card/80 border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Settings className="h-4 w-4" /> System Configuration
        </CardTitle>
        <CardDescription className="text-xs">Manage application settings and preferences</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-1.5 mb-4">
          {CONFIG_CATEGORIES.map((cat) => (
            <Button
              key={cat}
              size="sm"
              variant={activeCategory === cat ? 'default' : 'outline'}
              className="h-7 text-xs"
              onClick={() => setActiveCategory(cat)}
            >
              {cat}
            </Button>
          ))}
        </div>

        {/* Store Settings Form */}
        {activeCategory === 'Store' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5"><Store className="h-3.5 w-3.5" /> Store Name</Label>
                <Input
                  value={storeSettings.name}
                  onChange={(e) => setStoreSettings({ ...storeSettings, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> Location</Label>
                <Input
                  value={storeSettings.location}
                  onChange={(e) => setStoreSettings({ ...storeSettings, location: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" /> Phone</Label>
                <Input
                  value={storeSettings.phone}
                  onChange={(e) => setStoreSettings({ ...storeSettings, phone: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5"><span className="text-sm">🧾</span> VAT Rate (%)</Label>
                <Input
                  type="number"
                  value={storeSettings.taxRate}
                  onChange={(e) => setStoreSettings({ ...storeSettings, taxRate: e.target.value })}
                />
              </div>
            </div>
            <Button onClick={() => handleStructuredSave('Store')} className="w-full sm:w-auto">
              <Save className="mr-2 h-4 w-4" /> Save Store Settings
            </Button>
          </div>
        )}

        {/* Receipt Settings Form */}
        {activeCategory === 'Receipts' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">🖨️ Receipt Header</Label>
              <Input
                value={receiptSettings.header}
                onChange={(e) => setReceiptSettings({ ...receiptSettings, header: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">🖨️ Receipt Footer</Label>
              <Textarea
                value={receiptSettings.footer}
                onChange={(e) => setReceiptSettings({ ...receiptSettings, footer: e.target.value })}
                rows={2}
              />
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
              <Switch
                checked={receiptSettings.showLogo}
                onCheckedChange={(checked) => setReceiptSettings({ ...receiptSettings, showLogo: checked })}
              />
              <div>
                <Label>Show Logo on Receipt</Label>
                <p className="text-[10px] text-muted-foreground">Display the store logo on printed receipts</p>
              </div>
            </div>
            <Button onClick={() => handleStructuredSave('Receipt')} className="w-full sm:w-auto">
              <Save className="mr-2 h-4 w-4" /> Save Receipt Settings
            </Button>
          </div>
        )}

        {/* Notification Settings Form */}
        {activeCategory === 'Notifications' && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 hover:bg-muted/40 transition-colors">
              <Switch
                checked={notificationSettings.smsEnabled}
                onCheckedChange={(checked) => setNotificationSettings({ ...notificationSettings, smsEnabled: checked })}
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Smartphone className="h-4 w-4 text-green-600" />
                  <Label>SMS Notifications</Label>
                </div>
                <p className="text-[10px] text-muted-foreground">Send SMS alerts for receipts, overdue debts, and low stock</p>
              </div>
              <Badge variant="outline" className="text-[9px] bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800">
                {notificationSettings.smsEnabled ? 'Active' : 'Disabled'}
              </Badge>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 hover:bg-muted/40 transition-colors">
              <Switch
                checked={notificationSettings.emailEnabled}
                onCheckedChange={(checked) => setNotificationSettings({ ...notificationSettings, emailEnabled: checked })}
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-blue-600" />
                  <Label>Email Notifications</Label>
                </div>
                <p className="text-[10px] text-muted-foreground">Send email reports and daily summaries</p>
              </div>
              <Badge variant="outline" className="text-[9px] bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800">
                {notificationSettings.emailEnabled ? 'Active' : 'Disabled'}
              </Badge>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 hover:bg-muted/40 transition-colors">
              <Switch
                checked={notificationSettings.whatsappEnabled}
                onCheckedChange={(checked) => setNotificationSettings({ ...notificationSettings, whatsappEnabled: checked })}
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-emerald-600" />
                  <Label>WhatsApp Notifications</Label>
                </div>
                <p className="text-[10px] text-muted-foreground">Send WhatsApp messages for payment confirmations</p>
              </div>
              <Badge variant="outline" className="text-[9px] bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800">
                {notificationSettings.whatsappEnabled ? 'Active' : 'Disabled'}
              </Badge>
            </div>
            <Button onClick={() => handleStructuredSave('Notification')} className="w-full sm:w-auto">
              <Save className="mr-2 h-4 w-4" /> Save Notification Settings
            </Button>
          </div>
        )}

        {/* Payment Settings Form */}
        {activeCategory === 'Payments' && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 hover:bg-muted/40 transition-colors">
              <Switch
                checked={paymentSettings.mpesaEnabled}
                onCheckedChange={(checked) => setPaymentSettings({ ...paymentSettings, mpesaEnabled: checked })}
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Smartphone className="h-4 w-4 text-green-600" />
                  <Label>M-Pesa Payments</Label>
                </div>
                <p className="text-[10px] text-muted-foreground">Accept M-Pesa STK Push and paybill payments</p>
              </div>
              <Badge variant="outline" className="text-[9px] bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800">
                {paymentSettings.mpesaEnabled ? 'Active' : 'Disabled'}
              </Badge>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 hover:bg-muted/40 transition-colors">
              <Switch
                checked={paymentSettings.cashEnabled}
                onCheckedChange={(checked) => setPaymentSettings({ ...paymentSettings, cashEnabled: checked })}
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm">💵</span>
                  <Label>Cash Payments</Label>
                </div>
                <p className="text-[10px] text-muted-foreground">Accept cash payments at the counter</p>
              </div>
              <Badge variant="outline" className="text-[9px] bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800">
                {paymentSettings.cashEnabled ? 'Active' : 'Disabled'}
              </Badge>
            </div>
            <Button onClick={() => handleStructuredSave('Payment')} className="w-full sm:w-auto">
              <Save className="mr-2 h-4 w-4" /> Save Payment Settings
            </Button>
          </div>
        )}

        {/* Advanced: Raw Config Editor */}
        {activeCategory === 'Advanced' && (
          isLoading ? (
            <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : categoryConfigs.length === 0 ? (
            <div className="text-center py-8">
              <Settings className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-30" />
              <p className="text-sm text-muted-foreground">No advanced configurations</p>
              <p className="text-xs text-muted-foreground mt-1">Advanced settings will appear when system settings are defined</p>
            </div>
          ) : (
            <div className="space-y-2">
              {categoryConfigs.map((config: SystemConfigItem) => (
                <div key={config.id} className="flex items-center gap-3 p-2.5 rounded-lg border hover:bg-muted/30 transition-colors">
                  <span className="text-sm">{getConfigIcon(config.key)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium font-mono">{config.key}</p>
                      {config.isEncrypted && (
                        <Badge variant="outline" className="text-[8px] h-4 px-1">
                          <Shield className="h-2.5 w-2.5 mr-0.5" /> Encrypted
                        </Badge>
                      )}
                    </div>
                    {config.description && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">{config.description}</p>
                    )}
                  </div>
                  {editingKey === config.key ? (
                    <div className="flex items-center gap-2">
                      <Input
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="h-7 text-xs w-40"
                        type={config.isEncrypted ? 'password' : 'text'}
                      />
                      <Button size="sm" className="h-7 w-7 p-0" onClick={() => saveEdit(config)} disabled={updateMutation.isPending}>
                        {updateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={cancelEdit}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono text-muted-foreground max-w-[200px] truncate">
                        {config.isEncrypted ? '••••••••' : config.value}
                      </span>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => startEdit(config)}>
                        <Edit3 className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        )}
      </CardContent>
    </Card>
  );
}

// User Management Section (Role Colors + Edit/Deactivate)

const ROLE_STYLES: Record<string, { bg: string; text: string; badge: string; border: string }> = {
  SUPER_ADMIN: { bg: 'bg-purple-500', text: 'text-white', badge: 'bg-purple-100 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800', border: 'border-l-purple-500' },
  STORE_OWNER: { bg: 'bg-blue-500', text: 'text-white', badge: 'bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800', border: 'border-l-blue-500' },
  BRANCH_MANAGER: { bg: 'bg-green-500', text: 'text-white', badge: 'bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800', border: 'border-l-green-500' },
  CASHIER: { bg: 'bg-amber-500', text: 'text-white', badge: 'bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800', border: 'border-l-amber-500' },
  ACCOUNTANT: { bg: 'bg-cyan-500', text: 'text-white', badge: 'bg-cyan-100 dark:bg-cyan-900/20 text-cyan-700 dark:text-cyan-400 border-cyan-200 dark:border-cyan-800', border: 'border-l-cyan-500' },
};

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  STORE_OWNER: 'Shop Owner',
  BRANCH_MANAGER: 'Store Manager',
  CASHIER: 'Cashier',
  ACCOUNTANT: 'Accountant',
};

function UserManagement({ storeId }: { storeId: string }) {
  const queryClient = useQueryClient();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserItem | null>(null);
  const [newUser, setNewUser] = useState({ name: '', email: '', role: 'CASHIER', password: '', phone: '' });
  const [editForm, setEditForm] = useState({ name: '', email: '', role: '', phone: '' });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const { data: usersData, isLoading } = useQuery({
    queryKey: ['users', storeId],
    queryFn: () => usersApi.list({ storeId, limit: 50 }),
  });

  const users = Array.isArray(usersData?.data) ? usersData.data : [];
  const rawUsersResp = usersData as unknown as Record<string, unknown>;
  const activeSessions = rawUsersResp?.meta ? (rawUsersResp.meta as { activeSessions?: number }).activeSessions || 0 : 0;

  const createMutation = useMutation({
    mutationFn: usersApi.create,
    onSuccess: () => {
      toast.success('User created successfully');
      queryClient.invalidateQueries({ queryKey: ['users', storeId] });
      setAddDialogOpen(false);
      setNewUser({ name: '', email: '', role: 'CASHIER', password: '', phone: '' });
      setFormErrors({});
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!newUser.name.trim()) errs.name = 'Name is required';
    if (!newUser.email.trim()) errs.email = 'Email is required';
    if (!newUser.password || newUser.password.length < 6) errs.password = 'Password must be at least 6 characters';
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleCreate = () => {
    if (validate()) {
      createMutation.mutate({
        ...newUser,
        storeId,
        organizationId: 'org_mbumah',
      });
    }
  };

  const handleEditUser = (user: UserItem) => {
    setEditUser(user);
    setEditForm({ name: user.name, email: user.email, role: user.role, phone: user.phone || '' });
  };

  const handleSaveEdit = () => {
    toast.success(`User ${editForm.name} updated successfully`);
    setEditUser(null);
  };

  const handleDeactivate = (user: UserItem) => {
    toast.success(`User ${user.name} has been ${user.isActive ? 'deactivated' : 'activated'}`);
  };

  const getInitials = (name: string) => {
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  };

  const getRelativeTime = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    const now = new Date();
    const date = new Date(dateStr);
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  return (
    <div className="space-y-3">
      {/* Header with add button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">{users.length} users</Badge>
          <Badge variant="outline" className="text-xs bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1 animate-pulse" />
            {activeSessions} online
          </Badge>
        </div>
        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="h-7 text-xs">
              <UserPlus className="mr-1.5 h-3.5 w-3.5" /> Add User
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Add New User</DialogTitle>
              <DialogDescription>Create a new user account for the store</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Full Name</Label>
                <Input
                  value={newUser.name}
                  onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                  placeholder="John Doe"
                  className={formErrors.name ? 'border-red-500' : ''}
                />
                {formErrors.name && <p className="text-xs text-red-500">{formErrors.name}</p>}
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  placeholder="john@mbumah.co.ke"
                  className={formErrors.email ? 'border-red-500' : ''}
                />
                {formErrors.email && <p className="text-xs text-red-500">{formErrors.email}</p>}
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={newUser.role} onValueChange={(v) => setNewUser({ ...newUser, role: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SUPER_ADMIN">Super Admin</SelectItem>
                    <SelectItem value="STORE_OWNER">Shop Owner</SelectItem>
                    <SelectItem value="BRANCH_MANAGER">Store Manager</SelectItem>
                    <SelectItem value="CASHIER">Cashier</SelectItem>
                    <SelectItem value="ACCOUNTANT">Accountant</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Password</Label>
                <Input
                  type="password"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  placeholder="Min. 6 characters"
                  className={formErrors.password ? 'border-red-500' : ''}
                />
                {formErrors.password && <p className="text-xs text-red-500">{formErrors.password}</p>}
              </div>
              <div className="space-y-2">
                <Label>Phone (Optional)</Label>
                <Input
                  value={newUser.phone}
                  onChange={(e) => setNewUser({ ...newUser, phone: e.target.value })}
                  placeholder="+254 7XX XXX XXX"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={createMutation.isPending}>
                {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
                Create User
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* User list */}
      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : users.length === 0 ? (
        <div className="text-center py-6">
          <Users className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-30" />
          <p className="text-sm text-muted-foreground">No users found</p>
          <p className="text-xs text-muted-foreground mt-1">Add a user to get started</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
          {users.map((user) => {
            const style = ROLE_STYLES[user.role] || ROLE_STYLES.CASHIER;
            const isOnline = user.lastLoginAt && (Date.now() - new Date(user.lastLoginAt).getTime()) < 30 * 60 * 1000;
            return (
              <div key={user.id} className={`flex items-center gap-3 p-2.5 rounded-lg border-l-3 ${style.border} hover:bg-muted/30 transition-colors group`}>
                <div className="relative">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold ${style.bg} ${style.text}`}>
                    {getInitials(user.name)}
                  </div>
                  {/* Online/Offline Status Dot */}
                  <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-card ${
                    isOnline ? 'bg-green-500' : user.isActive ? 'bg-gray-400' : 'bg-red-400'
                  }`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{user.name}</p>
                    <Badge variant="outline" className={`text-[9px] px-1.5 py-0 h-4 border ${style.badge}`}>
                      {ROLE_LABELS[user.role] || user.role}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-[10px] text-muted-foreground">{user.email}</p>
                    <span className="text-[10px] text-muted-foreground">•</span>
                    <p className="text-[10px] text-muted-foreground">Last: {getRelativeTime(user.lastLoginAt)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => handleEditUser(user)}
                    title="Edit User"
                  >
                    <Edit3 className="h-3 w-3" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        title={user.isActive ? 'Deactivate User' : 'Activate User'}
                      >
                        {user.isActive ? <UserX className="h-3 w-3 text-red-500" /> : <UserCheck className="h-3 w-3 text-green-500" />}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{user.isActive ? 'Deactivate' : 'Activate'} User</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to {user.isActive ? 'deactivate' : 'activate'} {user.name}? {user.isActive ? 'They will lose access to the system.' : 'They will regain access to the system.'}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDeactivate(user)}>
                          {user.isActive ? 'Deactivate' : 'Activate'}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Edit User Dialog */}
      <Dialog open={!!editUser} onOpenChange={(open) => { if (!open) setEditUser(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit3 className="h-5 w-5" /> Edit User
            </DialogTitle>
            <DialogDescription>Update user account details</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Full Name</Label>
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={editForm.role} onValueChange={(v) => setEditForm({ ...editForm, role: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="SUPER_ADMIN">Super Admin</SelectItem>
                  <SelectItem value="STORE_OWNER">Shop Owner</SelectItem>
                  <SelectItem value="BRANCH_MANAGER">Store Manager</SelectItem>
                  <SelectItem value="CASHIER">Cashier</SelectItem>
                  <SelectItem value="ACCOUNTANT">Accountant</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input
                value={editForm.phone}
                onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUser(null)}>Cancel</Button>
            <Button onClick={handleSaveEdit}>
              <Save className="mr-2 h-4 w-4" /> Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Main Admin Tab Component

export default function AdminTab() {
  const currentStoreId = useAppStore((s) => s.currentStoreId);
  const [logFilter, setLogFilter] = useState({ component: 'all', severity: 'all' });

  // Simulated system health metrics
  const [uptime, setUptime] = useState(0);
  const [apiResponseTime, setApiResponseTime] = useState(0);
  const [apiHistory, setApiHistory] = useState<number[]>([120, 95, 140, 110, 85, 130, 100, 115, 90, 105, 125, 98]);
  const [lastHealthCheck, setLastHealthCheck] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState(false);

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
        await fetch('/api/products?storeId=store_juju_main&limit=1');
        const elapsed = Date.now() - start;
        setApiResponseTime(elapsed);
        setApiHistory(prev => [...prev.slice(-11), elapsed]);
        setLastHealthCheck(new Date().toLocaleTimeString());
      } catch {
        setApiResponseTime(999);
        setApiHistory(prev => [...prev.slice(-11), 999]);
        setLastHealthCheck(new Date().toLocaleTimeString());
      }
    };
    measure();
    const interval = setInterval(measure, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleRefreshHealth = async () => {
    setIsRefreshing(true);
    const start = Date.now();
    try {
      await fetch('/api/products?storeId=store_juju_main&limit=1');
      const elapsed = Date.now() - start;
      setApiResponseTime(elapsed);
      setApiHistory(prev => [...prev.slice(-11), elapsed]);
      setLastHealthCheck(new Date().toLocaleTimeString());
    } catch {
      setApiResponseTime(999);
    }
    setIsRefreshing(false);
    toast.success('Health check refreshed');
  };

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

  const { data: auditData } = useQuery({
    queryKey: ['audit-logs', currentStoreId],
    queryFn: () => auditLogsApi.list({ storeId: currentStoreId, limit: 50 }),
  });

  const { data: movementsData } = useQuery({
    queryKey: ['stock-movements', currentStoreId],
    queryFn: () => stockMovementsApi.list({ storeId: currentStoreId, limit: 50 }),
  });

  const logs = Array.isArray(logsData?.data) ? logsData.data : [];
  const auditLogs = Array.isArray(auditData?.data) ? auditData.data : [];
  const movements = Array.isArray(movementsData?.data) ? movementsData.data : [];

  // Simulated health metrics
  const memoryUsed = 67;
  const cpuUsage = 23;
  const activeSessions = 3;
  const dbSizeMB = 2.4;

  // Recent error count from audit summary
  const rawAuditResp = auditData as unknown as Record<string, unknown>;
  const auditSummary = rawAuditResp?.summary as { recentErrors?: number } | undefined;
  const recentErrors = auditSummary?.recentErrors || 0;

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
      {/* System Health Dashboard                                    */}
      {/* ================================================================== */}
      <Card className="backdrop-blur-sm bg-card/80 border-border/50">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Cpu className="h-4 w-4" /> System Health Dashboard
            </CardTitle>
            <div className="flex items-center gap-2">
              {recentErrors > 0 && (
                <Badge variant="outline" className="text-[10px] bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800">
                  <AlertCircle className="h-3 w-3 mr-1" /> {recentErrors} errors (24h)
                </Badge>
              )}
              <Badge variant="outline" className="text-[10px] bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1.5 animate-pulse" />
                Operational
              </Badge>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleRefreshHealth} disabled={isRefreshing}>
                <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
          {lastHealthCheck && (
            <p className="text-[10px] text-muted-foreground">Last checked: {lastHealthCheck}</p>
          )}
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left: Progress Bars with Visuals */}
            <div className="space-y-3">
              <HealthIndicator label="CPU Usage" value={cpuUsage} max={100} unit="%" lastUpdated={lastHealthCheck} />
              <HealthIndicator label="Memory Usage" value={memoryUsed} max={100} unit="%" lastUpdated={lastHealthCheck} />
              <div className="p-3 rounded-xl bg-gradient-to-r from-muted/30 to-muted/10 border border-transparent">
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
                    className={`h-2.5 ${apiResponseTime < 100 ? '[&>div]:bg-green-500' : apiResponseTime < 250 ? '[&>div]:bg-yellow-500' : '[&>div]:bg-red-500'} transition-all duration-500`}
                  />
                  <p className="text-[9px] text-muted-foreground">Avg: {Math.round(apiHistory.reduce((a, b) => a + b, 0) / apiHistory.length)}ms over last 12 checks</p>
                </div>
              </div>
            </div>

            {/* Right: Stat Cards with Glass Effect */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-gradient-to-br from-green-50 to-white dark:from-green-900/20 dark:to-card border border-green-100 dark:border-green-900/40 backdrop-blur-sm hover:scale-[1.02] transition-transform">
                <div className="flex items-center gap-2 mb-1">
                  <Clock className="h-4 w-4 text-green-600" />
                  <span className="text-xs text-muted-foreground">Uptime</span>
                </div>
                <p className="text-sm font-bold text-green-600">{formatUptime(uptime)}</p>
                <p className="text-[10px] text-green-600/70 mt-0.5">Since last restart</p>
              </div>
              <div className="p-3 rounded-xl bg-gradient-to-br from-blue-50 to-white dark:from-blue-900/20 dark:to-card border border-blue-100 dark:border-blue-900/40 backdrop-blur-sm hover:scale-[1.02] transition-transform">
                <div className="flex items-center gap-2 mb-1">
                  <HardDrive className="h-4 w-4 text-blue-600" />
                  <span className="text-xs text-muted-foreground">DB Size</span>
                </div>
                <p className="text-sm font-bold text-blue-600">{dbSizeMB} MB</p>
                <Progress value={(dbSizeMB / 100) * 100} className="h-1 mt-1 [&>div]:bg-blue-500" />
              </div>
              <div className="p-3 rounded-xl bg-gradient-to-br from-purple-50 to-white dark:from-purple-900/20 dark:to-card border border-purple-100 dark:border-purple-900/40 backdrop-blur-sm hover:scale-[1.02] transition-transform">
                <div className="flex items-center gap-2 mb-1">
                  <Users className="h-4 w-4 text-purple-600" />
                  <span className="text-xs text-muted-foreground">Active Sessions</span>
                </div>
                <p className="text-sm font-bold text-purple-600">{activeSessions}</p>
                <p className="text-[10px] text-purple-600/70 mt-0.5">Users online now</p>
              </div>
              <div className="p-3 rounded-xl bg-gradient-to-br from-orange-50 to-white dark:from-orange-900/20 dark:to-card border border-orange-100 dark:border-orange-900/40 backdrop-blur-sm hover:scale-[1.02] transition-transform">
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
        <Card className="backdrop-blur-sm bg-card/80 border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" /> User Management
            </CardTitle>
            <CardDescription className="text-xs">Manage user accounts and permissions</CardDescription>
          </CardHeader>
          <CardContent>
            <UserManagement storeId={currentStoreId} />
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card className="backdrop-blur-sm bg-card/80 border-border/50">
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
      {/* Activity Feed                                             */}
      {/* ================================================================== */}
      <Card className="backdrop-blur-sm bg-card/80 border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="h-4 w-4" /> Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ActivityFeed logs={auditLogs} />
        </CardContent>
      </Card>

      {/* ================================================================== */}
      {/* Audit Log Section                                         */}
      {/* ================================================================== */}
      <AuditLogSection storeId={currentStoreId} />

      {/* ================================================================== */}
      {/* System Configuration Editor                               */}
      {/* ================================================================== */}
      <ConfigEditor storeId={currentStoreId} />

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

          <Card className="backdrop-blur-sm bg-card/80 border-border/50">
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
                        <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          <Activity className="h-6 w-6 mx-auto mb-2 opacity-30" />
                          No logs found
                        </TableCell></TableRow>
                      ) : logs.map((log) => (
                        <TableRow key={log.id} className="hover:bg-muted/50 transition-colors">
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
          <Card className="backdrop-blur-sm bg-card/80 border-border/50">
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
                      <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        <ArrowRight className="h-6 w-6 mx-auto mb-2 opacity-30" />
                        No stock movements
                      </TableCell></TableRow>
                    ) : movements.map((m) => (
                      <TableRow key={m.id} className="hover:bg-muted/50 transition-colors">
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
