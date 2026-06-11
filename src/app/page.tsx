'use client';

/**
 * MBUMAH HARDWARE POS & ERP System - Main Application Page
 * UI Overhaul: Dashboard stats, category chips, enhanced cards, improved cart, better login, footer fix, empty states, live clock
 */

import React, { useState, useEffect, useCallback, useMemo, lazy, Suspense, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import {
  ShoppingCart, Package, Users, KeyRound, BarChart3, FileText,
  Settings, LogOut, Search, Plus, Minus, Trash2, X, Menu, Sun, Moon,
  CheckCircle, Clock,
  ShoppingBag, CreditCard, Smartphone,
  AlertCircle, Loader2,
  Home, Store, Mail, ShieldCheck, Eye, EyeOff,
  Banknote, Wallet,
  TrendingUp, ArrowDownRight, AlertTriangle, DollarSign, Wrench, Hammer,
  CalendarDays, Printer, Bell, ChevronDown,
  BellRing, PackageX, AlertOctagon, CircleDollarSign, CheckCheck,
} from 'lucide-react';

import { useAuthStore, useCartStore, useAppStore, type AppTab } from '@/lib/stores';
import {
  productsApi, categoriesApi, customersApi, transactionsApi,
  paymentsApi, dashboardApi,
  rentalsApi, debtApi,
  formatKES, formatDate, formatDateTime,
  type ProductListItem, type CustomerItem,
  type CategoryItem, type TransactionItem,
  type RentalItem, type DebtLedgerItem,
} from '@/lib/api';
import type { PaymentMethod, CartItem, UnitType, DashboardStats } from '@/lib/types';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';

// ============================================================================
// LAZY-LOADED TAB COMPONENTS
// ============================================================================

const LazyInventoryTab = lazy(() => import('./tabs/inventory-tab'));
const LazyCustomersTab = lazy(() => import('./tabs/customers-tab'));
const LazyRentalsTab = lazy(() => import('./tabs/rentals-tab'));
const LazyFinancialTab = lazy(() => import('./tabs/financial-tab'));
const LazyReportsTab = lazy(() => import('./tabs/reports-tab'));
const LazyAdminTab = lazy(() => import('./tabs/admin-tab'));
const LazyTransactionsTab = lazy(() => import('./tabs/transactions-tab'));

function TabLoadingFallback() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

// ============================================================================
// CONSTANTS
// ============================================================================

const TAB_CONFIG: { id: AppTab; label: string; icon: React.ElementType }[] = [
  { id: 'pos', label: 'POS', icon: ShoppingCart },
  { id: 'inventory', label: 'Inventory', icon: Package },
  { id: 'customers', label: 'Customers', icon: Users },
  { id: 'rentals', label: 'Rentals', icon: KeyRound },
  { id: 'financial', label: 'Financial', icon: BarChart3 },
  { id: 'reports', label: 'Reports', icon: FileText },
  { id: 'transactions', label: 'Transactions', icon: ShoppingBag },
  { id: 'admin', label: 'Admin', icon: Settings },
];

const DEMO_ACCOUNTS = [
  { email: 'admin@mbumahhardware.co.ke', password: 'password123', role: 'Super Admin', icon: ShieldCheck, color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900 hover:bg-red-100 dark:hover:bg-red-950/50' },
  { email: 'cashier@mbumahhardware.co.ke', password: 'password123', role: 'Cashier', icon: ShoppingCart, color: 'text-green-500', bg: 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-900 hover:bg-green-100 dark:hover:bg-green-950/50' },
  { email: 'accountant@mbumahhardware.co.ke', password: 'password123', role: 'Accountant', icon: BarChart3, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900 hover:bg-amber-100 dark:hover:bg-amber-950/50' },
];

// Category image mapping
const CATEGORY_IMAGES: Record<string, string> = {
  cat_cement: '/categories/cat_cement.png',
  cat_iron_sheets: '/categories/cat_iron.png',
  cat_paints: '/categories/cat_paints.png',
  cat_iron_bars: '/categories/cat_rebar.png',
  cat_wheelbarrows: '/categories/cat_wheelbarrow.png',
  cat_mesh_wires: '/categories/cat_mesh.png',
  cat_tools: '/categories/cat_tools.png',
  cat_plumbing: '/categories/cat_plumbing.png',
  cat_electrical: '/categories/cat_electrical.png',
  cat_nails_screws: '/categories/cat_nails.png',
};

function getCategoryImage(categoryId: string | null | undefined): string | null {
  if (!categoryId) return null;
  return CATEGORY_IMAGES[categoryId] || null;
}

// ============================================================================
// LIVE CLOCK HOOK
// ============================================================================

function useLiveClock() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000); // every minute
    return () => clearInterval(timer);
  }, []);

  return now;
}

// ============================================================================
// LOGIN SCREEN
// ============================================================================

function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const login = useAuthStore((s) => s.login);
  const isLoading = useAuthStore((s) => s.isLoading);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login(email, password);
      toast.success('Welcome to MBUMAH HARDWARE POS!');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Login failed';
      toast.error(message);
    }
  };

  const fillDemo = (acct: typeof DEMO_ACCOUNTS[number]) => {
    setEmail(acct.email);
    setPassword(acct.password);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Animated gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-[oklch(0.22_0.07_260)] via-[oklch(0.295_0.1_260)] to-[oklch(0.22_0.06_260)]" />
      <div className="absolute inset-0 bg-gradient-to-tr from-[oklch(0.22_0.08_30)] via-transparent to-[oklch(0.25_0.09_150)] animate-gradient-shift" />

      {/* Decorative hardware pattern */}
      <div className="absolute inset-0 opacity-[0.04] pointer-events-none">
        <div className="absolute top-10 left-10"><Wrench className="h-24 w-24 text-white" /></div>
        <div className="absolute top-32 right-20"><Hammer className="h-16 w-16 text-white" /></div>
        <div className="absolute bottom-20 left-1/4"><Package className="h-20 w-20 text-white" /></div>
        <div className="absolute bottom-32 right-1/3"><Store className="h-28 w-28 text-white" /></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"><Wrench className="h-40 w-40 text-white" /></div>
        <div className="absolute top-60 left-1/2"><Hammer className="h-12 w-12 text-white rotate-45" /></div>
        <div className="absolute bottom-60 right-10"><Package className="h-14 w-14 text-white -rotate-12" /></div>
      </div>

      <div className="w-full max-w-md relative z-10">
        <Card className="shadow-2xl border border-white/10 bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl">
          <CardHeader className="text-center pb-2">
            {/* Animated logo */}
            <div className="mx-auto w-20 h-20 rounded-2xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center mb-4 shadow-lg animate-pulse-slow">
              <Store className="h-10 w-10 text-primary-foreground" />
            </div>
            <CardTitle className="text-2xl font-bold tracking-tight">MBUMAH HARDWARE</CardTitle>
            <CardDescription className="text-base">POS & ERP System</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="cashier@mbumahhardware.co.ke"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10"
                    required
                    disabled={isLoading}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <ShieldCheck className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10 pr-10"
                    required
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <Button
                type="submit"
                className="w-full bg-accent-orange hover:bg-accent-orange/90 text-accent-orange-foreground font-semibold"
                disabled={isLoading}
                size="lg"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing In...
                  </>
                ) : (
                  'Sign In'
                )}
              </Button>
            </form>

            {/* Demo Accounts */}
            <div className="mt-6">
              <Separator className="mb-4" />
              <p className="text-xs text-muted-foreground text-center mb-3">Quick Demo Access</p>
              <div className="grid grid-cols-3 gap-2">
                {DEMO_ACCOUNTS.map((acct) => {
                  const Icon = acct.icon;
                  return (
                    <button
                      key={acct.email}
                      type="button"
                      onClick={() => fillDemo(acct)}
                      className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all text-center ${acct.bg}`}
                    >
                      <Icon className={`h-5 w-5 ${acct.color}`} />
                      <span className="text-[10px] font-medium leading-tight">{acct.role}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-2 text-sm text-muted-foreground">
            <p className="text-xs">Select a demo account above or enter credentials manually</p>
          </CardFooter>
          {/* Kenyan flag accent at bottom */}
          <div className="flex h-1.5 rounded-b-xl overflow-hidden">
            <div className="flex-1 bg-black" />
            <div className="flex-1 bg-red-600" />
            <div className="flex-1 bg-green-600" />
            <div className="flex-1 bg-white" />
          </div>
        </Card>
        {/* Branding text */}
        <p className="text-center mt-4 text-xs text-white/40 font-medium tracking-wider">
          Powered by MBUMAH HARDWARE
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// NOTIFICATION CENTER
// ============================================================================

interface NotificationItem {
  id: string;
  type: 'low_stock' | 'out_of_stock' | 'overdue_rental' | 'large_debt';
  title: string;
  description: string;
  timestamp: string;
  severity: 'critical' | 'warning' | 'info';
  targetTab?: AppTab;
}

function NotificationCenter({
  open,
  onOpenChange,
  storeId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
}) {
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const { setActiveTab } = useAppStore();

  const { data: productsData } = useQuery({
    queryKey: ['products-notifications', storeId],
    queryFn: () => productsApi.list({ storeId, limit: 200 }),
    enabled: open,
  });

  const { data: rentalsData } = useQuery({
    queryKey: ['rentals-notifications', storeId],
    queryFn: () => rentalsApi.list({ storeId, limit: 100 }),
    enabled: open,
  });

  const { data: debtData } = useQuery({
    queryKey: ['debt-notifications', storeId],
    queryFn: () => debtApi.list({ storeId, limit: 100 }),
    enabled: open,
  });

  const products = productsData?.data || [];
  const rentals = rentalsData?.data || [];
  const debts = debtData?.data || [];

  const notifications = useMemo<NotificationItem[]>(() => {
    const items: NotificationItem[] = [];

    // Out of stock products
    products
      .filter((p) => p.quantityInStock <= 0)
      .forEach((p) => {
        items.push({
          id: `oos-${p.id}`,
          type: 'out_of_stock',
          title: 'Out of Stock',
          description: `${p.name} is completely out of stock`,
          timestamp: p.updatedAt,
          severity: 'critical',
          targetTab: 'inventory',
        });
      });

    // Low stock products
    products
      .filter((p) => p.quantityInStock > 0 && p.quantityInStock <= p.reorderLevel)
      .forEach((p) => {
        items.push({
          id: `low-${p.id}`,
          type: 'low_stock',
          title: 'Low Stock Alert',
          description: `${p.name} has only ${p.quantityInStock} ${p.unitType.toLowerCase()}s left (reorder at ${p.reorderLevel})`,
          timestamp: p.updatedAt,
          severity: 'warning',
          targetTab: 'inventory',
        });
      });

    // Overdue rentals
    rentals
      .filter((r) => r.status === 'OVERDUE')
      .forEach((r) => {
        items.push({
          id: `rental-${r.id}`,
          type: 'overdue_rental',
          title: 'Overdue Rental',
          description: `${r.product?.name || 'Equipment'} rented by ${r.customer?.name || 'Customer'} is overdue`,
          timestamp: r.expectedReturnDate,
          severity: 'critical',
          targetTab: 'rentals',
        });
      });

    // Large outstanding debts (>50,000 KES)
    debts
      .filter((d) => d.balance > 50000 && d.status !== 'SETTLED')
      .forEach((d) => {
        items.push({
          id: `debt-${d.id}`,
          type: 'large_debt',
          title: 'Large Outstanding Debt',
          description: `${d.customer?.name || 'Customer'} owes ${formatKES(d.balance)}`,
          timestamp: d.dueDate,
          severity: 'warning',
          targetTab: 'customers',
        });
      });

    // Sort by severity (critical first), then by timestamp (newest first)
    items.sort((a, b) => {
      const sevOrder = { critical: 0, warning: 1, info: 2 };
      const sevDiff = sevOrder[a.severity] - sevOrder[b.severity];
      if (sevDiff !== 0) return sevDiff;
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });

    return items;
  }, [products, rentals, debts]);

  const unreadCount = notifications.filter((n) => !readIds.has(n.id)).length;

  const markAllRead = () => {
    setReadIds(new Set(notifications.map((n) => n.id)));
  };

  const handleNotificationClick = (notification: NotificationItem) => {
    setReadIds((prev) => new Set([...prev, notification.id]));
    if (notification.targetTab) {
      setActiveTab(notification.targetTab);
      onOpenChange(false);
    }
  };

  const getSeverityIcon = (type: NotificationItem['type']) => {
    switch (type) {
      case 'out_of_stock': return <PackageX className="h-4 w-4 text-red-500" />;
      case 'low_stock': return <AlertTriangle className="h-4 w-4 text-amber-500" />;
      case 'overdue_rental': return <AlertOctagon className="h-4 w-4 text-red-500" />;
      case 'large_debt': return <CircleDollarSign className="h-4 w-4 text-amber-500" />;
    }
  };

  const getSeverityBg = (severity: NotificationItem['severity']) => {
    switch (severity) {
      case 'critical': return 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900/40';
      case 'warning': return 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/40';
      case 'info': return 'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900/40';
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0">
        <SheetHeader className="p-4 pb-2 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <SheetTitle className="text-lg">Notifications</SheetTitle>
              {unreadCount > 0 && (
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                  {unreadCount}
                </Badge>
              )}
            </div>
            {unreadCount > 0 && (
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={markAllRead}>
                <CheckCheck className="h-3.5 w-3.5 mr-1" />
                Mark all read
              </Button>
            )}
          </div>
          <SheetDescription>
            Stay updated on stock levels, overdue rentals, and outstanding debts
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="flex-1 h-[calc(100vh-120px)]">
          {notifications.length === 0 ? (
            <div className="p-8 text-center">
              <BellRing className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">No notifications</p>
              <p className="text-xs text-muted-foreground/60 mt-1">You&apos;re all caught up!</p>
            </div>
          ) : (
            <div className="p-3 space-y-2">
              {notifications.map((notification) => {
                const isUnread = !readIds.has(notification.id);
                return (
                  <button
                    key={notification.id}
                    type="button"
                    onClick={() => handleNotificationClick(notification)}
                    className={`w-full text-left p-3 rounded-lg border transition-all hover:shadow-sm cursor-pointer ${getSeverityBg(notification.severity)} ${isUnread ? 'ring-1 ring-primary/20' : 'opacity-70'}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="shrink-0 mt-0.5">{getSeverityIcon(notification.type)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">{notification.title}</p>
                          {isUnread && (
                            <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                          {notification.description}
                        </p>
                        <p className="text-[10px] text-muted-foreground/60 mt-1">
                          {formatDate(notification.timestamp)}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

// ============================================================================
// LOW STOCK ALERT DIALOG
// ============================================================================

function LowStockAlertDialog({
  open,
  onOpenChange,
  storeId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
}) {
  const { data: productsData, isLoading } = useQuery({
    queryKey: ['products-lowstock', storeId],
    queryFn: () => productsApi.list({ storeId, limit: 200 }),
    enabled: open,
  });

  const products = productsData?.data || [];

  const outOfStockProducts = useMemo(
    () => products.filter((p) => p.quantityInStock <= 0),
    [products]
  );

  const lowStockProducts = useMemo(
    () => products.filter((p) => p.quantityInStock > 0 && p.quantityInStock <= p.reorderLevel),
    [products]
  );

  const totalAffected = outOfStockProducts.length + lowStockProducts.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Low Stock Alert
          </DialogTitle>
          <DialogDescription>
            {totalAffected} product{totalAffected !== 1 ? 's' : ''} need attention
            — {outOfStockProducts.length} out of stock, {lowStockProducts.length} low stock
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : totalAffected === 0 ? (
          <div className="p-8 text-center">
            <CheckCircle className="h-12 w-12 mx-auto text-green-500 mb-3" />
            <p className="text-sm font-medium">All products are well stocked!</p>
            <p className="text-xs text-muted-foreground mt-1">No items require restocking at this time</p>
          </div>
        ) : (
          <ScrollArea className="flex-1 min-h-0 max-h-[60vh]">
            <div className="space-y-4 p-1">
              {/* Out of Stock Section */}
              {outOfStockProducts.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <PackageX className="h-4 w-4 text-red-500" />
                    <h4 className="text-sm font-semibold text-red-600 dark:text-red-400">
                      Out of Stock ({outOfStockProducts.length})
                    </h4>
                  </div>
                  <div className="space-y-2">
                    {outOfStockProducts.map((product) => (
                      <div
                        key={product.id}
                        className="p-3 rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50/50 dark:bg-red-950/10"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{product.name}</p>
                            {product.category && (
                              <p className="text-[10px] text-muted-foreground">{product.category.name}</p>
                            )}
                          </div>
                          <Badge variant="destructive" className="text-[10px] shrink-0">
                            0 in stock
                          </Badge>
                        </div>
                        <div className="mt-2">
                          <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                            <span>Reorder level: {product.reorderLevel}</span>
                            <span className="text-red-500 font-medium">Needs immediate restock</span>
                          </div>
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-red-500 rounded-full" style={{ width: '2%' }} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Low Stock Section */}
              {lowStockProducts.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    <h4 className="text-sm font-semibold text-amber-600 dark:text-amber-400">
                      Low Stock ({lowStockProducts.length})
                    </h4>
                  </div>
                  <div className="space-y-2">
                    {lowStockProducts.map((product) => {
                      const stockPercent = product.reorderLevel > 0
                        ? Math.min((product.quantityInStock / (product.reorderLevel * 3)) * 100, 100)
                        : product.quantityInStock > 0 ? 50 : 0;
                      const restockQty = Math.max(product.reorderLevel * 2 - product.quantityInStock, product.reorderLevel);
                      return (
                        <div
                          key={product.id}
                          className="p-3 rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-950/10"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium">{product.name}</p>
                              {product.category && (
                                <p className="text-[10px] text-muted-foreground">{product.category.name}</p>
                              )}
                            </div>
                            <Badge className="text-[10px] shrink-0 bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-800">
                              {product.quantityInStock} left
                            </Badge>
                          </div>
                          <div className="mt-2">
                            <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                              <span>Current: {product.quantityInStock} / Reorder at: {product.reorderLevel}</span>
                              <span className="text-amber-600 dark:text-amber-400 font-medium">
                                Restock ~{restockQty} {product.unitType.toLowerCase()}s
                              </span>
                            </div>
                            <div className="h-2 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full bg-amber-500 rounded-full transition-all"
                                style={{ width: `${stockPercent}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {totalAffected > 0 && (
                <div className="p-3 rounded-lg border bg-muted/30">
                  <p className="text-xs text-muted-foreground">
                    💡 <strong>Tip:</strong> Consider restocking to at least 2× the reorder level to maintain healthy inventory.
                    Use the <strong>Admin → Stock Adjustment</strong> tool to update stock levels.
                  </p>
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// SIDEBAR
// ============================================================================

function AppSidebar() {
  const { activeTab, setActiveTab, sidebarOpen, setSidebarOpen, currentStoreId } = useAppStore();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { theme, setTheme } = useTheme();
  const [notificationOpen, setNotificationOpen] = useState(false);

  const handleNav = (tab: AppTab) => {
    setActiveTab(tab);
    setSidebarOpen(false);
  };

  const handleLogout = async () => {
    await logout();
    toast.success('Logged out successfully');
  };

  // Navigation groups
  const mainNavItems = TAB_CONFIG.filter(t => ['pos', 'inventory', 'customers', 'transactions'].includes(t.id));
  const managementNavItems = TAB_CONFIG.filter(t => ['rentals', 'financial', 'reports', 'admin'].includes(t.id));

  const renderNavItem = ({ id, label, icon: Icon }: { id: AppTab; label: string; icon: React.ElementType }) => (
    <button
      key={id}
      onClick={() => handleNav(id)}
      className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all relative ${
        activeTab === id
          ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-sm'
          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
      }`}
    >
      {/* Active left border indicator */}
      {activeTab === id && (
        <div className="absolute left-0 top-1 bottom-1 w-1 rounded-r-full bg-sidebar-primary-foreground/80" />
      )}
      <Icon className="h-4 w-4 shrink-0" />
      <span>{label}</span>
    </button>
  );

  return (
    <>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 z-50 h-full w-64 bg-sidebar text-sidebar-foreground transform transition-transform duration-200 ease-in-out lg:translate-x-0 lg:static lg:z-auto border-r border-sidebar-border ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Logo + Notification Bell */}
          <div className="flex items-center gap-3 px-4 py-5 border-b border-sidebar-border">
            <div className="w-9 h-9 rounded-lg bg-sidebar-primary flex items-center justify-center">
              <Store className="h-5 w-5 text-sidebar-primary-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="font-bold text-sm leading-tight">MBUMAH HARDWARE</h1>
              <p className="text-xs text-sidebar-foreground/60">POS & ERP</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 text-sidebar-foreground/60 hover:text-sidebar-foreground relative"
              onClick={() => setNotificationOpen(true)}
            >
              <Bell className="h-4 w-4" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 lg:hidden text-sidebar-foreground/60 hover:text-sidebar-foreground"
              onClick={() => setSidebarOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Store Selector */}
          <div className="px-3 pt-3 pb-1">
            <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-sidebar-border bg-sidebar-accent/50 text-xs text-sidebar-foreground/80 hover:bg-sidebar-accent transition-colors">
              <Store className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate font-medium">Juja Main Branch</span>
              <ChevronDown className="h-3 w-3 ml-auto shrink-0" />
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-3 py-2 space-y-1 overflow-y-auto custom-scrollbar">
            {/* Main Section */}
            <p className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">Main</p>
            {mainNavItems.map(renderNavItem)}

            {/* Management Section */}
            <p className="px-4 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">Management</p>
            {managementNavItems.map(renderNavItem)}
          </nav>

          {/* Footer - User Profile Dropdown */}
          <div className="border-t border-sidebar-border px-3 py-3 space-y-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-sidebar-accent transition-colors text-left">
                  <div className="relative">
                    <Avatar className="h-9 w-9 ring-2 ring-sidebar-primary/20">
                      <AvatarFallback className="bg-gradient-to-br from-sidebar-primary to-sidebar-primary/70 text-sidebar-primary-foreground text-xs font-semibold">
                        {user?.name?.split(' ').map(n => n[0]).join('') || 'U'}
                      </AvatarFallback>
                    </Avatar>
                    {/* Online dot */}
                    <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-sidebar rounded-full" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{user?.name || 'User'}</p>
                    <p className="text-xs text-sidebar-foreground/60 truncate">{user?.role === 'SUPER_ADMIN' ? 'Super Admin' : user?.role === 'CASHIER' ? 'Cashier' : user?.role || 'User'}</p>
                  </div>
                  <ChevronDown className="h-3.5 w-3.5 text-sidebar-foreground/40 shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" className="w-56 mb-2">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium">{user?.name || 'User'}</p>
                    <p className="text-xs text-muted-foreground">{user?.email || ''}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
                  {theme === 'dark' ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
                  {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => toast.info('Profile settings coming soon')}>
                  <ShieldCheck className="mr-2 h-4 w-4" />
                  Profile & Settings
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => toast.info('Keyboard shortcuts: Ctrl+K for search')}>
                  <Search className="mr-2 h-4 w-4" />
                  Keyboard Shortcuts
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={handleLogout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </aside>
      <NotificationCenter
        open={notificationOpen}
        onOpenChange={setNotificationOpen}
        storeId={currentStoreId}
      />
    </>
  );
}

// ============================================================================
// TOP BAR (with live Date/Time)
// ============================================================================

function TopBar() {
  const { activeTab, toggleSidebar, setActiveTab } = useAppStore();
  const cartItemCount = useCartStore((s) => s.getItemCount());
  const currentStoreId = useAppStore((s) => s.currentStoreId);
  const currentTab = TAB_CONFIG.find(t => t.id === activeTab);
  const TabIcon = currentTab?.icon || Home;
  const now = useLiveClock();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Global search with Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const { data: searchResults } = useQuery({
    queryKey: ['globalSearch', searchQuery, currentStoreId],
    queryFn: async () => {
      if (!searchQuery || searchQuery.length < 2) return { products: [] as ProductListItem[], customers: [] as CustomerItem[] };
      const [prodRes, custRes] = await Promise.all([
        productsApi.list({ storeId: currentStoreId, search: searchQuery, limit: 5 }),
        customersApi.list({ storeId: currentStoreId, search: searchQuery, limit: 5 }),
      ]);
      return {
        products: prodRes.data || [],
        customers: custRes.data || [],
      };
    },
    enabled: searchQuery.length >= 2,
  });

  return (
    <>
      <header className="sticky top-0 z-30 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
        <div className="flex items-center gap-3 px-4 py-3">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={toggleSidebar}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            <TabIcon className="h-5 w-5 text-primary" />
            <h2 className="font-semibold text-lg">{currentTab?.label || 'Dashboard'}</h2>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {/* Quick Search Button */}
            <Button
              variant="outline"
              size="sm"
              className="hidden md:flex items-center gap-2 text-muted-foreground h-8 px-3"
              onClick={() => setSearchOpen(true)}
            >
              <Search className="h-3.5 w-3.5" />
              <span className="text-xs">Search...</span>
              <kbd className="ml-2 pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                ⌘K
              </kbd>
            </Button>
            {activeTab === 'pos' && (
              <Badge variant="secondary" className="flex items-center gap-1">
                <ShoppingCart className="h-3 w-3" />
                {cartItemCount}
              </Badge>
            )}
            <Badge variant="outline" className="hidden sm:flex items-center gap-1.5">
              <CalendarDays className="h-3 w-3" />
              {now.toLocaleDateString('en-KE', { weekday: 'short', month: 'short', day: 'numeric' })}
              <span className="text-muted-foreground">|</span>
              <Clock className="h-3 w-3" />
              {now.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}
            </Badge>
          </div>
        </div>
      </header>

      {/* Global Search Dialog */}
      <Dialog open={searchOpen} onOpenChange={(open) => { setSearchOpen(open); if (!open) setSearchQuery(''); }}>
        <DialogContent className="sm:max-w-lg p-0 gap-0">
          <div className="flex items-center border-b px-4 py-3">
            <Search className="h-4 w-4 text-muted-foreground shrink-0 mr-2" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search products, customers..."
              className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0 px-0 h-8"
              autoFocus
            />
            <kbd className="ml-2 pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
              ESC
            </kbd>
          </div>
          <div className="max-h-80 overflow-y-auto custom-scrollbar">
            {searchQuery.length < 2 ? (
              <div className="p-6 text-center">
                <Search className="h-8 w-8 mx-auto text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">Type at least 2 characters to search</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Search across products and customers</p>
              </div>
            ) : searchResults && (searchResults.products.length > 0 || searchResults.customers.length > 0) ? (
              <div className="py-2">
                {searchResults.products.length > 0 && (
                  <div>
                    <p className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Products</p>
                    {searchResults.products.map((p) => (
                      <button
                        key={p.id}
                        className="w-full flex items-center gap-3 px-4 py-2 hover:bg-muted/50 transition-colors text-left"
                        onClick={() => { setActiveTab('inventory'); setSearchOpen(false); setSearchQuery(''); }}
                      >
                        <div className="shrink-0 w-8 h-8 rounded-md bg-muted flex items-center justify-center">
                          <Package className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{p.name}</p>
                          <p className="text-xs text-muted-foreground">{p.sku} · {p.category?.name || 'No category'}</p>
                        </div>
                        <span className="text-sm font-semibold text-primary whitespace-nowrap">{formatKES(p.pricePerUnit)}</span>
                      </button>
                    ))}
                  </div>
                )}
                {searchResults.customers.length > 0 && (
                  <div>
                    <p className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-t mt-1 pt-2">Customers</p>
                    {searchResults.customers.map((c) => (
                      <button
                        key={c.id}
                        className="w-full flex items-center gap-3 px-4 py-2 hover:bg-muted/50 transition-colors text-left"
                        onClick={() => { setActiveTab('customers'); setSearchOpen(false); setSearchQuery(''); }}
                      >
                        <Avatar className="h-8 w-8 shrink-0">
                          <AvatarFallback className="text-xs">{c.name.split(' ').map(n => n[0]).join('').slice(0, 2)}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{c.name}</p>
                          <p className="text-xs text-muted-foreground">{c.phone || c.email || 'No contact'}</p>
                        </div>
                        {c.currentDebtBalance > 0 && (
                          <Badge variant="destructive" className="text-[10px]">{formatKES(c.currentDebtBalance)}</Badge>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : searchQuery.length >= 2 ? (
              <div className="p-6 text-center">
                <Package className="h-8 w-8 mx-auto text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">No results found</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Try a different search term</p>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ============================================================================
// DASHBOARD STATS ROW
// ============================================================================

function DashboardStats({ storeId, onLowStockClick }: { storeId: string; onLowStockClick?: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', storeId],
    queryFn: async () => {
      const res = await dashboardApi.getStats(storeId);
      return res.data;
    },
    refetchInterval: 60000,
  });

  const stats = [
    {
      label: "Today's Sales",
      value: data?.todaySales ?? 0,
      format: 'kes' as const,
      icon: TrendingUp,
      color: 'text-green-600 dark:text-green-400',
      bg: 'bg-green-50 dark:bg-green-950/30',
      borderColor: 'border-l-green-500',
      clickable: false,
    },
    {
      label: 'Transactions',
      value: data?.todayTransactions ?? 0,
      format: 'number' as const,
      icon: ShoppingCart,
      color: 'text-blue-600 dark:text-blue-400',
      bg: 'bg-blue-50 dark:bg-blue-950/30',
      borderColor: 'border-l-blue-500',
      clickable: false,
    },
    {
      label: 'Low Stock',
      value: data?.lowStockProducts ?? 0,
      format: 'number' as const,
      icon: AlertTriangle,
      color: 'text-amber-600 dark:text-amber-400',
      bg: 'bg-amber-50 dark:bg-amber-950/30',
      borderColor: 'border-l-amber-500',
      clickable: true,
    },
    {
      label: 'Outstanding Debt',
      value: data?.outstandingDebt ?? 0,
      format: 'kes' as const,
      icon: DollarSign,
      color: 'text-red-600 dark:text-red-400',
      bg: 'bg-red-50 dark:bg-red-950/30',
      borderColor: 'border-l-red-500',
      clickable: false,
    },
  ];

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {stats.map((stat) => {
        const Icon = stat.icon;
        const isClickable = stat.clickable && onLowStockClick;
        return (
          <Card
            key={stat.label}
            className={`border-l-4 ${stat.borderColor} py-0 bg-gradient-to-br from-card to-muted/30 ${
              isClickable ? 'cursor-pointer hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0' : ''
            }`}
            onClick={isClickable ? onLowStockClick : undefined}
            role={isClickable ? 'button' : undefined}
            tabIndex={isClickable ? 0 : undefined}
            onKeyDown={isClickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onLowStockClick(); } } : undefined}
          >
            <CardContent className="p-3 flex items-center gap-3">
              <div className={`shrink-0 p-2 rounded-lg bg-gradient-to-br ${stat.bg}`}>
                <Icon className={`h-4 w-4 ${stat.color}`} />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] sm:text-xs text-muted-foreground truncate">{stat.label}</p>
                <div className="flex items-center gap-1.5">
                  <p className={`text-sm sm:text-base font-bold ${stat.color} whitespace-nowrap`}>
                    {stat.format === 'kes' ? formatKES(stat.value) : stat.value}
                  </p>
                  {isClickable && (
                    <span className="text-[9px] text-muted-foreground/50">→</span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ============================================================================
// CATEGORY FILTER CHIPS
// ============================================================================

function CategoryChips({
  categories,
  selected,
  onSelect,
}: {
  categories: CategoryItem[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
      <button
        onClick={() => onSelect('all')}
        className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
          selected === 'all'
            ? 'bg-primary text-primary-foreground border-primary shadow-sm'
            : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted hover:text-foreground'
        }`}
      >
        All
      </button>
      {categories.map((cat) => {
        const catColor = cat.color || '#6b7280';
        const isActive = selected === cat.id;
        const catImage = getCategoryImage(cat.id);
        return (
          <button
            key={cat.id}
            onClick={() => onSelect(cat.id)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-all whitespace-nowrap flex items-center gap-1.5 ${
              isActive
                ? 'text-white border-transparent shadow-sm'
                : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted hover:text-foreground'
            }`}
            style={isActive ? { backgroundColor: catColor, borderColor: catColor } : { borderLeftColor: catColor, borderLeftWidth: '3px' }}
          >
            {catImage && (
              <img src={catImage} alt="" className="h-4 w-4 rounded-full object-cover" />
            )}
            {cat.name}
          </button>
        );
      })}
    </div>
  );
}

// ============================================================================
// PRODUCT CARD
// ============================================================================

function ProductCard({
  product,
  onAdd,
}: {
  product: ProductListItem;
  onAdd: (p: ProductListItem) => void;
}) {
  const categoryColor = product.category?.color || '#6b7280';
  const stockPercent = product.reorderLevel > 0
    ? Math.min((product.quantityInStock / (product.reorderLevel * 3)) * 100, 100)
    : product.quantityInStock > 0 ? 100 : 0;
  const isLowStock = product.quantityInStock <= product.reorderLevel && product.quantityInStock > 0;
  const isOutOfStock = product.quantityInStock <= 0;

  const stockBarColor = isOutOfStock
    ? 'bg-red-500'
    : isLowStock
      ? 'bg-amber-500'
      : 'bg-green-500';

  const unitBadgeColor: Record<string, string> = {
    PIECE: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    KILOGRAM: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
    METER: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300',
    LITER: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
    BAG: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
    BOX: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300',
    SET: 'bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300',
  };

  return (
    <Card
      className="overflow-hidden cursor-pointer hover:shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 group border-l-4"
      style={{ borderLeftColor: categoryColor }}
      onClick={() => onAdd(product)}
    >
      <div className="h-24 bg-muted flex items-center justify-center relative overflow-hidden">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300" />
        ) : getCategoryImage(product.categoryId) ? (
          <img src={getCategoryImage(product.categoryId)!} alt={product.category?.name || ''} className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300" />
        ) : (
          <Package className="h-9 w-9 text-muted-foreground/25" />
        )}
        {product.isRental && (
          <Badge className="absolute top-1.5 left-1.5 bg-blue-600 text-white text-[10px] px-1.5">RENTAL</Badge>
        )}
        {product.isBundle && (
          <Badge className="absolute top-1.5 right-1.5 bg-purple-600 text-white text-[10px] px-1.5">BUNDLE</Badge>
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors flex items-center justify-center">
          <Plus className="h-7 w-7 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
        </div>
      </div>
      <CardContent className="p-2.5">
        <h3 className="font-medium text-sm line-clamp-2 leading-tight">{product.name}</h3>
        {product.category && (
          <p className="text-[10px] text-muted-foreground/70 truncate mt-0.5">{product.category.name}</p>
        )}
        <div className="flex items-center justify-between mt-1.5 gap-1">
          <span className="font-bold text-primary text-sm truncate">{formatKES(product.pricePerUnit)}</span>
          <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${unitBadgeColor[product.unitType] || 'bg-muted text-muted-foreground'}`}>
            {product.unitType}
          </span>
        </div>
        {/* Mini stock progress bar */}
        <div className="mt-1.5 flex items-center gap-1.5">
          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${stockBarColor}`}
              style={{ width: `${stockPercent}%` }}
            />
          </div>
          <span className={`text-[9px] font-medium shrink-0 ${isOutOfStock ? 'text-red-500' : isLowStock ? 'text-amber-500' : 'text-muted-foreground'}`}>
            {isOutOfStock ? 'Out' : `${product.quantityInStock}`}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// CART ITEM ROW (enhanced)
// ============================================================================

function CartItemRow({
  item,
  onUpdateQty,
  onRemove,
}: {
  item: CartItem;
  onUpdateQty: (productId: string, qty: number) => void;
  onRemove: (productId: string) => void;
}) {
  const quickAddAmounts = [1, 2, 5, 10];

  return (
    <div className="flex gap-2 p-2 rounded-lg bg-muted/40 hover:bg-muted/60 transition-colors">
      {/* Image placeholder */}
      <div className="shrink-0 w-10 h-10 rounded-md bg-muted flex items-center justify-center">
        <Package className="h-4 w-4 text-muted-foreground/40" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{item.productName}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-xs text-muted-foreground">{formatKES(item.pricePerUnit)}</span>
          <span className="text-[9px] px-1 py-0 rounded bg-muted text-muted-foreground font-medium">{item.unitType}</span>
          {item.discountPercent > 0 && (
            <span className="text-[9px] text-green-600 font-medium">{item.discountPercent}% off</span>
          )}
        </div>
        {/* Quick Add buttons */}
        <div className="flex items-center gap-1 mt-1.5">
          {quickAddAmounts.map((amt) => (
            <button
              key={amt}
              type="button"
              onClick={() => onUpdateQty(item.productId, item.quantity + amt)}
              className="px-1.5 py-0 text-[9px] font-medium rounded border border-border/50 bg-background hover:bg-primary hover:text-primary-foreground transition-colors"
            >
              +{amt}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-muted-foreground hover:text-destructive"
          onClick={() => onRemove(item.productId)}
        >
          <X className="h-3 w-3" />
        </Button>
        <div className="flex items-center gap-0.5">
          <Button
            variant="outline"
            size="icon"
            className="h-6 w-6"
            onClick={() => onUpdateQty(item.productId, item.quantity - 1)}
          >
            <Minus className="h-2.5 w-2.5" />
          </Button>
          <span className="w-7 text-center text-xs font-semibold">{item.quantity}</span>
          <Button
            variant="outline"
            size="icon"
            className="h-6 w-6"
            onClick={() => onUpdateQty(item.productId, item.quantity + 1)}
          >
            <Plus className="h-2.5 w-2.5" />
          </Button>
        </div>
        <p className="text-xs font-semibold text-primary">{formatKES(item.lineTotal)}</p>
      </div>
    </div>
  );
}

// ============================================================================
// EMPTY STATE COMPONENTS
// ============================================================================

function EmptyCartState() {
  return (
    <div className="p-8 text-center">
      <div className="relative mx-auto w-16 h-16 mb-4">
        <div className="absolute inset-0 bg-primary/10 rounded-full animate-pulse" />
        <ShoppingBag className="absolute inset-0 m-auto h-8 w-8 text-primary/40" />
      </div>
      <p className="text-sm font-medium text-muted-foreground">Your cart is empty</p>
      <p className="text-xs text-muted-foreground/60 mt-1">Click on products to add them here</p>
    </div>
  );
}

function EmptyProductsState({ searchQuery }: { searchQuery: string }) {
  return (
    <div className="text-center py-16">
      <div className="relative mx-auto w-20 h-20 mb-4">
        <div className="absolute inset-0 bg-muted rounded-2xl" />
        <Package className="absolute inset-0 m-auto h-10 w-10 text-muted-foreground/30" />
      </div>
      <p className="text-base font-medium text-muted-foreground">No products found</p>
      {searchQuery ? (
        <p className="text-sm text-muted-foreground/60 mt-1">
          No results for &ldquo;{searchQuery}&rdquo;. Try a different search term.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground/60 mt-1">Try adjusting your search or filters</p>
      )}
    </div>
  );
}

// ============================================================================
// POS TAB (kept inline - core feature)
// ============================================================================

function POSTab() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [mpesaDialogOpen, setMpesaDialogOpen] = useState(false);
  const [mpesaPhone, setMpesaPhone] = useState('');
  const [mpesaStatus, setMpesaStatus] = useState<'idle' | 'processing' | 'success' | 'failed'>('idle');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [cashReceived, setCashReceived] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<string>('');
  const [lowStockAlertOpen, setLowStockAlertOpen] = useState(false);
  const currentStoreId = useAppStore((s) => s.currentStoreId);

  const cart = useCartStore();
  const subtotal = cart.getSubtotal();
  const tax = cart.getTax();
  const total = cart.getTotal();

  const { data: productsData, isLoading: productsLoading } = useQuery({
    queryKey: ['products', currentStoreId, searchQuery, selectedCategory],
    queryFn: () => productsApi.list({
      storeId: currentStoreId,
      search: searchQuery || undefined,
      limit: 100,
      ...(selectedCategory !== 'all' ? { categoryId: selectedCategory } : {}),
    }),
  });

  const { data: categoriesData } = useQuery({
    queryKey: ['categories', currentStoreId],
    queryFn: () => categoriesApi.list(currentStoreId),
  });

  const { data: customersData } = useQuery({
    queryKey: ['customers', currentStoreId],
    queryFn: () => customersApi.list({ storeId: currentStoreId, limit: 100 }),
  });

  const [receiptOpen, setReceiptOpen] = useState(false);
  const [lastTransaction, setLastTransaction] = useState<TransactionItem | null>(null);
  const [lastCashReceived, setLastCashReceived] = useState(0);
  const [lastMpesaPhone, setLastMpesaPhone] = useState('');

  const checkoutMutation = useMutation({
    mutationFn: transactionsApi.create,
    onSuccess: (res) => {
      toast.success('Transaction completed successfully!');
      if (res.data) {
        setLastTransaction(res.data);
        setLastCashReceived(paymentMethod === 'CASH' ? Number(cashReceived) || total : 0);
        setLastMpesaPhone(mpesaPhone);
        setReceiptOpen(true);
      }
      cart.clearCart();
      setCheckoutOpen(false);
      setCashReceived('');
      setSelectedCustomer('');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Checkout failed');
    },
  });

  const mpesaMutation = useMutation({
    mutationFn: paymentsApi.initiateMpesa,
    onSuccess: (res) => {
      if (res.data) {
        setMpesaStatus('processing');
        // Simulate M-Pesa processing (in production, this would poll a status endpoint)
        setTimeout(() => {
          if (res.data?.resultCode === '0') {
            setMpesaStatus('success');
          } else {
            setMpesaStatus('success'); // Default to success for demo
          }
        }, 5000);
      }
    },
    onError: () => {
      setMpesaStatus('failed');
    },
  });

  const products = productsData?.data || [];
  const categories = categoriesData?.data || [];
  const customers = customersData?.data || [];

  const handleAddToCart = (product: ProductListItem) => {
    if (product.quantityInStock <= 0 && !product.isRental) {
      toast.error('Product is out of stock');
      return;
    }
    cart.addItem({
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      quantity: 1,
      unitType: product.unitType as UnitType,
      pricePerUnit: product.pricePerUnit,
      costPrice: product.costPrice,
      discountPercent: 0,
      taxRate: product.taxRate,
      isRentalItem: product.isRental,
      isBundle: product.isBundle,
    });
    toast.success(`${product.name} added to cart`);
  };

  const handleCheckout = () => {
    if (cart.items.length === 0) {
      toast.error('Cart is empty');
      return;
    }

    if (paymentMethod === 'MPESA') {
      setMpesaDialogOpen(true);
      return;
    }

    checkoutMutation.mutate({
      storeId: currentStoreId,
      customerId: selectedCustomer || undefined,
      cashierId: useAuthStore.getState().user?.id || '',
      items: cart.items,
      paymentMethod,
      paymentDetails: {
        cashAmount: paymentMethod === 'CASH' ? Number(cashReceived) || total : undefined,
        debtAccountId: paymentMethod === 'DEBT' ? selectedCustomer : undefined,
      },
    });
  };

  const handleMpesaPay = () => {
    if (!mpesaPhone || mpesaPhone.length < 10) {
      toast.error('Enter a valid phone number');
      return;
    }
    mpesaMutation.mutate({
      phoneNumber: mpesaPhone.startsWith('0') ? `254${mpesaPhone.slice(1)}` : mpesaPhone,
      amount: total,
      accountReference: `MBT-${Date.now()}`,
      transactionDesc: 'MBUMAH HARDWARE Purchase',
    });
  };

  const change = paymentMethod === 'CASH' && cashReceived ? Number(cashReceived) - total : 0;

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-full">
      {/* Product Grid */}
      <div className="flex-1 min-w-0 space-y-4">
        {/* Dashboard Stats */}
        <DashboardStats storeId={currentStoreId} onLowStockClick={() => setLowStockAlertOpen(true)} />

        {/* Search and Category Chips */}
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search products by name, SKU, or barcode..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <CategoryChips
            categories={categories}
            selected={selectedCategory}
            onSelect={setSelectedCategory}
          />
        </div>

        {/* Products Grid */}
        {productsLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Card key={i} className="overflow-hidden border-l-4 border-l-muted">
                <Skeleton className="h-24" />
                <CardContent className="p-2.5 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-5 w-2/3" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : products.length === 0 ? (
          <EmptyProductsState searchQuery={searchQuery} />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {products.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onAdd={handleAddToCart}
              />
            ))}
          </div>
        )}
      </div>

      {/* Cart Sidebar */}
      <div className="lg:w-96 shrink-0">
        <Card className="sticky top-20 flex flex-col max-h-[calc(100vh-7rem)] bg-gradient-to-b from-card to-card/95">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <ShoppingCart className="h-4 w-4" />
                Cart
                {cart.items.length > 0 && (
                  <Badge variant="secondary">{cart.getItemCount()}</Badge>
                )}
              </CardTitle>
              {cart.items.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => cart.clearCart()} className="text-destructive h-7">
                  <Trash2 className="h-3.5 w-3.5 mr-1" /> Clear
                </Button>
              )}
            </div>
          </CardHeader>
          <Separator />
          <ScrollArea className="flex-1 min-h-0">
            {cart.items.length === 0 ? (
              <EmptyCartState />
            ) : (
              <div className="p-3 space-y-2">
                {cart.items.map((item) => (
                  <CartItemRow
                    key={item.productId}
                    item={item}
                    onUpdateQty={cart.updateQuantity}
                    onRemove={cart.removeItem}
                  />
                ))}
              </div>
            )}
          </ScrollArea>
          {cart.items.length > 0 && (
            <>
              <Separator />
              <div className="p-4 space-y-3">
                {/* Customer Selection */}
                <Select value={selectedCustomer} onValueChange={setSelectedCustomer}>
                  <SelectTrigger>
                    <SelectValue placeholder="Walk-in Customer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="walk-in">Walk-in Customer</SelectItem>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}{c.phone ? ` - ${c.phone}` : ''}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>{formatKES(subtotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">VAT (16%)</span>
                    <span>{formatKES(tax)}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between font-bold text-base">
                    <span>Total</span>
                    <span className="text-primary">{formatKES(total)}</span>
                  </div>
                </div>

                <Dialog open={checkoutOpen} onOpenChange={setCheckoutOpen}>
                  <DialogTrigger asChild>
                    <Button className="w-full bg-accent-orange hover:bg-accent-orange/90 text-accent-orange-foreground font-semibold h-12" size="lg">
                      <CreditCard className="mr-2 h-4 w-4" />
                      <span className="flex flex-col items-start leading-tight">
                        <span className="text-xs font-normal opacity-80">Checkout</span>
                        <span>{formatKES(total)}</span>
                      </span>
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle>Complete Payment</DialogTitle>
                      <DialogDescription>
                        Total: <span className="font-bold text-primary">{formatKES(total)}</span>
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <Label className="text-sm font-medium">Payment Method</Label>
                        <RadioGroup value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PaymentMethod)} className="grid grid-cols-3 gap-2 mt-2">
                          <div>
                            <RadioGroupItem value="CASH" id="cash" className="peer sr-only" />
                            <Label htmlFor="cash" className="flex flex-col items-center gap-1.5 p-3 border rounded-lg cursor-pointer peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 hover:bg-muted/50">
                              <Banknote className="h-5 w-5" />
                              <span className="text-xs font-medium">Cash</span>
                            </Label>
                          </div>
                          <div>
                            <RadioGroupItem value="MPESA" id="mpesa" className="peer sr-only" />
                            <Label htmlFor="mpesa" className="flex flex-col items-center gap-1.5 p-3 border rounded-lg cursor-pointer peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 hover:bg-muted/50">
                              <Smartphone className="h-5 w-5" />
                              <span className="text-xs font-medium">M-Pesa</span>
                            </Label>
                          </div>
                          <div>
                            <RadioGroupItem value="DEBT" id="debt" className="peer sr-only" />
                            <Label htmlFor="debt" className="flex flex-col items-center gap-1.5 p-3 border rounded-lg cursor-pointer peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 hover:bg-muted/50">
                              <Wallet className="h-5 w-5" />
                              <span className="text-xs font-medium">Debt</span>
                            </Label>
                          </div>
                        </RadioGroup>
                      </div>

                      {paymentMethod === 'CASH' && (
                        <div className="space-y-3">
                          <div>
                            <Label htmlFor="cashReceived">Cash Received</Label>
                            <Input
                              id="cashReceived"
                              type="number"
                              placeholder="0"
                              value={cashReceived}
                              onChange={(e) => setCashReceived(e.target.value)}
                              className="text-lg font-semibold mt-1"
                            />
                          </div>
                          {change > 0 && (
                            <div className="p-3 bg-green-50 dark:bg-green-950/30 rounded-lg">
                              <p className="text-sm font-medium text-green-700 dark:text-green-400">
                                Change: {formatKES(change)}
                              </p>
                            </div>
                          )}
                          {cashReceived && Number(cashReceived) < total && (
                            <Alert variant="destructive">
                              <AlertCircle className="h-4 w-4" />
                              <AlertTitle>Insufficient amount</AlertTitle>
                              <AlertDescription>Need {formatKES(total - Number(cashReceived))} more</AlertDescription>
                            </Alert>
                          )}
                        </div>
                      )}

                      {paymentMethod === 'DEBT' && !selectedCustomer && (
                        <Alert>
                          <AlertCircle className="h-4 w-4" />
                          <AlertTitle>Customer Required</AlertTitle>
                          <AlertDescription>Please select a customer before proceeding with debt payment.</AlertDescription>
                        </Alert>
                      )}

                      {paymentMethod === 'MPESA' && (
                        <div>
                          <Label htmlFor="mpesaPhone">M-Pesa Phone Number</Label>
                          <Input
                            id="mpesaPhone"
                            type="tel"
                            placeholder="0712 345 678"
                            value={mpesaPhone}
                            onChange={(e) => setMpesaPhone(e.target.value)}
                            className="mt-1"
                          />
                        </div>
                      )}
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setCheckoutOpen(false)}>Cancel</Button>
                      <Button
                        onClick={handleCheckout}
                        disabled={
                          checkoutMutation.isPending ||
                          (paymentMethod === 'CASH' && (!cashReceived || Number(cashReceived) < total)) ||
                          (paymentMethod === 'DEBT' && !selectedCustomer)
                        }
                        className="bg-accent-orange hover:bg-accent-orange/90 text-accent-orange-foreground"
                      >
                        {checkoutMutation.isPending ? (
                          <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing...</>
                        ) : (
                          <><CheckCircle className="mr-2 h-4 w-4" />Complete Sale</>
                        )}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </>
          )}
        </Card>
      </div>

      {/* Receipt Dialog */}
      <Dialog open={receiptOpen} onOpenChange={setReceiptOpen}>
        <DialogContent className="sm:max-w-lg receipt-dialog">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-center">Receipt</DialogTitle>
          </DialogHeader>
          {lastTransaction && (
            <div className="receipt-content receipt-printable space-y-4 text-sm" id="receipt-content">
              {/* Store Header */}
              <div className="text-center space-y-0.5">
                <h2 className="text-lg font-bold">MBUMAH HARDWARE</h2>
                <p className="text-xs text-muted-foreground">Juja Main Branch</p>
                <p className="text-xs text-muted-foreground">Tel: +254 700 123 456</p>
              </div>
              <Separator />
              {/* Receipt Meta */}
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Receipt #:</span>
                  <span className="font-mono font-semibold">{lastTransaction.receiptNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Date:</span>
                  <span>{formatDateTime(lastTransaction.createdAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Cashier:</span>
                  <span>{lastTransaction.cashier?.name || useAuthStore.getState().user?.name || 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Customer:</span>
                  <span>{lastTransaction.customer?.name || 'Walk-in'}</span>
                </div>
              </div>
              <Separator />
              {/* Line Items */}
              <div className="space-y-1">
                <div className="grid grid-cols-12 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  <span className="col-span-5">Item</span>
                  <span className="col-span-2 text-center">Qty</span>
                  <span className="col-span-2 text-center">Unit</span>
                  <span className="col-span-3 text-right">Total</span>
                </div>
                {(lastTransaction.items || []).map((item) => (
                  <div key={item.id} className="grid grid-cols-12 text-xs py-0.5">
                    <span className="col-span-5 truncate">{item.productName}</span>
                    <span className="col-span-2 text-center">{item.quantity}</span>
                    <span className="col-span-2 text-center">{item.unitType}</span>
                    <span className="col-span-3 text-right">{formatKES(item.lineTotal)}</span>
                  </div>
                ))}
              </div>
              <Separator />
              {/* Totals */}
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>{formatKES(lastTransaction.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">VAT (16%)</span>
                  <span>{formatKES(lastTransaction.taxAmount)}</span>
                </div>
                {lastTransaction.discountAmount > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Discount</span>
                    <span>-{formatKES(lastTransaction.discountAmount)}</span>
                  </div>
                )}
                <Separator />
                <div className="flex justify-between font-bold text-base">
                  <span>Total</span>
                  <span className="text-primary">{formatKES(lastTransaction.totalAmount)}</span>
                </div>
              </div>
              <Separator />
              {/* Payment Details */}
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Payment Method</span>
                  <Badge variant="secondary" className="text-[10px]">
                    {lastTransaction.paymentMethod === 'CASH' && <Banknote className="h-3 w-3 mr-1" />}
                    {lastTransaction.paymentMethod === 'MPESA' && <Smartphone className="h-3 w-3 mr-1" />}
                    {lastTransaction.paymentMethod === 'DEBT' && <Wallet className="h-3 w-3 mr-1" />}
                    {lastTransaction.paymentMethod}
                  </Badge>
                </div>
                {lastTransaction.paymentMethod === 'CASH' && lastCashReceived > 0 && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Cash Received</span>
                      <span>{formatKES(lastCashReceived)}</span>
                    </div>
                    {lastCashReceived - lastTransaction.totalAmount > 0 && (
                      <div className="flex justify-between text-green-600 font-semibold">
                        <span>Change</span>
                        <span>{formatKES(lastCashReceived - lastTransaction.totalAmount)}</span>
                      </div>
                    )}
                  </>
                )}
                {lastTransaction.paymentMethod === 'MPESA' && lastMpesaPhone && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">M-Pesa Phone</span>
                    <span>{lastMpesaPhone}</span>
                  </div>
                )}
              </div>
              <Separator />
              {/* Footer */}
              <div className="text-center space-y-1">
                <p className="font-semibold text-xs">Thank you for shopping at MBUMAH HARDWARE!</p>
                <p className="text-xs text-muted-foreground italic">Asante sana!</p>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                window.print();
              }}
            >
              <Printer className="mr-2 h-4 w-4" />
              Print Receipt
            </Button>
            <Button
              onClick={() => {
                setReceiptOpen(false);
                setLastTransaction(null);
              }}
              className="bg-accent-orange hover:bg-accent-orange/90 text-accent-orange-foreground"
            >
              <ShoppingCart className="mr-2 h-4 w-4" />
              New Sale
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* M-Pesa STK Push Dialog */}
      <Dialog open={mpesaDialogOpen} onOpenChange={setMpesaDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Smartphone className="h-5 w-5 text-green-600" />
              M-Pesa Payment
            </DialogTitle>
            <DialogDescription>
              Amount: <span className="font-bold">{formatKES(total)}</span>
            </DialogDescription>
          </DialogHeader>
          {mpesaStatus === 'idle' && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="mpesaPhoneDialog">Phone Number</Label>
                <Input
                  id="mpesaPhoneDialog"
                  type="tel"
                  placeholder="0712 345 678"
                  value={mpesaPhone}
                  onChange={(e) => setMpesaPhone(e.target.value)}
                />
              </div>
              <Button
                className="w-full bg-green-600 hover:bg-green-700 text-white"
                onClick={handleMpesaPay}
                disabled={mpesaMutation.isPending}
              >
                {mpesaMutation.isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending STK Push...</>
                ) : (
                  'Send STK Push'
                )}
              </Button>
            </div>
          )}
          {mpesaStatus === 'processing' && (
            <div className="text-center py-8 space-y-4">
              <div className="animate-pulse">
                <Smartphone className="h-16 w-16 mx-auto text-green-600" />
              </div>
              <div>
                <p className="font-semibold">Waiting for M-Pesa Confirmation</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Please enter your M-Pesa PIN on your phone
                </p>
              </div>
              <Loader2 className="h-6 w-6 animate-spin mx-auto text-green-600" />
            </div>
          )}
          {mpesaStatus === 'success' && (
            <div className="text-center py-8 space-y-4">
              <CheckCircle className="h-16 w-16 mx-auto text-green-600" />
              <p className="font-semibold text-green-600">Payment Successful!</p>
              <Button onClick={() => { setMpesaDialogOpen(false); setMpesaStatus('idle'); }}>
                Close
              </Button>
            </div>
          )}
          {mpesaStatus === 'failed' && (
            <div className="text-center py-8 space-y-4">
              <AlertCircle className="h-16 w-16 mx-auto text-destructive" />
              <p className="font-semibold text-destructive">Payment Failed</p>
              <Button variant="outline" onClick={() => setMpesaStatus('idle')}>Try Again</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Low Stock Alert Dialog */}
      <LowStockAlertDialog
        open={lowStockAlertOpen}
        onOpenChange={setLowStockAlertOpen}
        storeId={currentStoreId}
      />
    </div>
  );
}

// ============================================================================
// MAIN APP
// ============================================================================

function MainApp() {
  const { activeTab } = useAppStore();

  const renderTab = () => {
    switch (activeTab) {
      case 'pos': return <POSTab />;
      case 'inventory': return <Suspense fallback={<TabLoadingFallback />}><LazyInventoryTab /></Suspense>;
      case 'customers': return <Suspense fallback={<TabLoadingFallback />}><LazyCustomersTab /></Suspense>;
      case 'rentals': return <Suspense fallback={<TabLoadingFallback />}><LazyRentalsTab /></Suspense>;
      case 'financial': return <Suspense fallback={<TabLoadingFallback />}><LazyFinancialTab /></Suspense>;
      case 'reports': return <Suspense fallback={<TabLoadingFallback />}><LazyReportsTab /></Suspense>;
      case 'transactions': return <Suspense fallback={<TabLoadingFallback />}><LazyTransactionsTab /></Suspense>;
      case 'admin': return <Suspense fallback={<TabLoadingFallback />}><LazyAdminTab /></Suspense>;
      default: return <POSTab />;
    }
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <AppSidebar />
      <div className="flex-1 flex flex-col min-w-0 min-h-screen overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          {renderTab()}
        </main>
        <footer className="border-t bg-background px-4 py-2 text-center mt-auto shrink-0">
          <p className="text-xs text-muted-foreground">
            MBUMAH HARDWARE POS & ERP System &copy; {new Date().getFullYear()} &mdash; All rights reserved
          </p>
        </footer>
      </div>
    </div>
  );
}

// ============================================================================
// PAGE EXPORT
// ============================================================================

export default function HomePage() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return isAuthenticated ? <MainApp /> : <LoginScreen />;
}
