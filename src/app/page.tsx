'use client';

/**
 * MBUMAH HARDWARE - Main Application
 */

import React, { useState, useEffect, useCallback, useMemo, lazy, Suspense, useRef, createContext, useContext, useSyncExternalStore } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import {
  ShoppingCart, Package, Users, KeyRound, BarChart3, FileText,
  Settings, LogOut, Search, Plus, Minus, Trash2, X, Menu, Sun, Moon,
  CheckCircle, Clock,
  ShoppingBag, CreditCard, Smartphone,
  AlertCircle, Loader2,
  Home, Store, Mail, Shield, ShieldCheck, Eye, EyeOff,
  Banknote, Wallet,
  TrendingUp, ArrowDownRight, AlertTriangle, DollarSign, Wrench, Hammer,
  CalendarDays, Printer, Bell, ChevronDown,
  BellRing, PackageX, AlertOctagon, CircleDollarSign, CheckCheck,
  Truck, UserPlus, Receipt, Filter, Info, Tag,
  LayoutGrid, List, ArrowUpDown, ArrowUp, ArrowDown, Keyboard, Pause, MessageSquare, PartyPopper, Sparkles, Zap, Ticket, Landmark, Award, Gift,
  Lightbulb, Send, ExternalLink, RefreshCw, Split, ChevronRight,
  Wifi, WifiOff, CloudOff, CloudLightning,
} from 'lucide-react';

import { useAuthStore, useCartStore, useAppStore, type AppTab } from '@/lib/stores';
import { ErrorBoundary } from '@/components/error-boundary';
import {
  saveOfflineTransaction,
  buildOfflineReceipt,
  syncQueue,
  initOfflineSync,
  primeOfflineCount,
  onBackgroundSync,
  subscribeOfflineCount,
  getOfflineCountSnapshot,
} from '@/lib/offline-sync';
import {
  productsApi, categoriesApi, customersApi, transactionsApi,
  paymentsApi, dashboardApi,
  rentalsApi, debtApi, notificationsApi,
  giftCardsApi, vouchersApi, whatsappApi,
  formatKES, formatDate, formatDateTime, formatRelativeTime,
  type ProductListItem, type CustomerItem,
  type CategoryItem, type TransactionItem,
  type RentalItem, type DebtLedgerItem,
  type NotificationItem, type GiftCardItem, type VoucherItem,
} from '@/lib/api';
import type { PaymentMethod, CartItem, UnitType, DashboardStats, CheckoutPayload } from '@/lib/types';
import { handleError } from '@/lib/error-handler';
import { ResponsiveDialog } from '@/components/ui/responsive-dialog';

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

// LAZY-LOADED TAB COMPONENTS

const LazyDashboardTab = lazy(() => import('./tabs/dashboard-tab'));
const LazyInventoryTab = lazy(() => import('./tabs/inventory-tab'));
const LazyCustomersTab = lazy(() => import('./tabs/customers-tab'));
const LazyRentalsTab = lazy(() => import('./tabs/rentals-tab'));
const LazyFinancialTab = lazy(() => import('./tabs/financial-tab'));
const LazyReportsTab = lazy(() => import('./tabs/reports-tab'));
const LazyAdminTab = lazy(() => import('./tabs/admin-tab'));
const LazyTransactionsTab = lazy(() => import('./tabs/transactions-tab'));
const LazySuppliersTab = lazy(() => import('./tabs/suppliers-tab'));
const LazyCatalogTab = lazy(() => import('./tabs/catalog-tab'));
const LazyGiftCardsTab = lazy(() => import('./tabs/gift-cards-tab'));
const LazyVouchersTab = lazy(() => import('./tabs/vouchers-tab'));
const LazyInvoicesTab = lazy(() => import('./tabs/invoices-tab'));
const LazyDeliveryTab = lazy(() => import('./tabs/delivery-notes-tab'));
const LazyCreditsTab = lazy(() => import('./tabs/credits-tab'));
const LazyMessagingTab = lazy(() => import('./tabs/messaging-tab'));
const LazyTransfersTab = lazy(() => import('./tabs/transfers-tab'));
const LazyBankingTab = lazy(() => import('./tabs/banking-tab'));
const LazyLoyaltyTab = lazy(() => import('./tabs/loyalty-tab'));
const LazySecurityTab = lazy(() => import('./tabs/security-tab'));
const LazyPayrollTab = lazy(() => import('./tabs/payroll-tab'));

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


// Role-based access: every tab declares which roles may see it.
// SUPER_ADMIN implicitly has access to ALL tabs (enforced in filterTabsByRole).
// Roles: SUPER_ADMIN, STORE_OWNER, BRANCH_MANAGER, CASHIER, ACCOUNTANT
const ALL_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'CASHIER', 'ACCOUNTANT'];
const MGMT_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'];
const SENIOR_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER'];
const ADMIN_ROLES = ['SUPER_ADMIN', 'STORE_OWNER'];

const TAB_CONFIG: { id: AppTab; label: string; icon: React.ElementType; roles: string[] }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Home, roles: ALL_ROLES },
  { id: 'pos', label: 'POS', icon: ShoppingCart, roles: ALL_ROLES },
  { id: 'catalog', label: 'Catalog', icon: Tag, roles: MGMT_ROLES },
  { id: 'inventory', label: 'Inventory', icon: Package, roles: MGMT_ROLES },
  { id: 'customers', label: 'Customers', icon: Users, roles: ALL_ROLES },
  { id: 'transactions', label: 'Transactions', icon: ShoppingBag, roles: ALL_ROLES },
  { id: 'rentals', label: 'Rentals', icon: KeyRound, roles: SENIOR_ROLES },
  { id: 'suppliers', label: 'Suppliers', icon: Truck, roles: SENIOR_ROLES },
  { id: 'financial', label: 'Financial', icon: BarChart3, roles: MGMT_ROLES },
  { id: 'reports', label: 'Reports', icon: FileText, roles: MGMT_ROLES },
  { id: 'gift-cards', label: 'Gift Cards', icon: CreditCard, roles: SENIOR_ROLES },
  { id: 'vouchers', label: 'Vouchers', icon: Ticket, roles: SENIOR_ROLES },
  { id: 'invoices', label: 'Invoices', icon: Receipt, roles: MGMT_ROLES },
  { id: 'delivery', label: 'Delivery', icon: Truck, roles: SENIOR_ROLES },
  { id: 'credits', label: 'Credits', icon: CircleDollarSign, roles: MGMT_ROLES },
  { id: 'messaging', label: 'Messaging', icon: MessageSquare, roles: ALL_ROLES },
  { id: 'transfers', label: 'Transfers', icon: ArrowUpDown, roles: SENIOR_ROLES },
  { id: 'banking', label: 'Banking', icon: Landmark, roles: ['SUPER_ADMIN', 'STORE_OWNER', 'ACCOUNTANT'] },
  { id: 'loyalty', label: 'Loyalty', icon: Award, roles: SENIOR_ROLES },
  { id: 'payroll', label: 'Payroll', icon: Wallet, roles: MGMT_ROLES },
  { id: 'security', label: 'Security', icon: Shield, roles: ADMIN_ROLES },
  { id: 'admin', label: 'Admin', icon: Settings, roles: ADMIN_ROLES },
];

/**
 * Returns the tabs visible to the given role. SUPER_ADMIN sees everything;
 * every other role sees only tabs whose `roles` array includes them.
 */
function filterTabsByRole(role: string | undefined): typeof TAB_CONFIG {
  if (!role) return [];
  if (role === 'SUPER_ADMIN') return TAB_CONFIG;
  return TAB_CONFIG.filter((t) => t.roles.includes(role));
}

const DEMO_ACCOUNTS = [
  { email: 'admin@mbumahhardware.co.ke', password: 'password123', role: 'Super Admin', icon: ShieldCheck, color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900 hover:bg-red-100 dark:hover:bg-red-950/50' },
  { email: 'thika.manager@mbumahhardware.co.ke', password: 'password123', role: 'Branch Mgr (Thika)', icon: Store, color: 'text-purple-500', bg: 'bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-900 hover:bg-purple-100 dark:hover:bg-purple-950/50' },
  { email: 'cashier@mbumahhardware.co.ke', password: 'password123', role: 'Cashier', icon: ShoppingCart, color: 'text-green-500', bg: 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-900 hover:bg-green-100 dark:hover:bg-green-950/50' },
  { email: 'accountant@mbumahhardware.co.ke', password: 'password123', role: 'Accountant', icon: BarChart3, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900 hover:bg-amber-100 dark:hover:bg-amber-950/50' },
];

// Store list for branch selector
const STORE_LIST = [
  { id: 'store_juja_main', shortName: 'Juja Main', location: 'Salama M-Store, Juja', phone: '0795191909' },
  { id: 'store_thika', shortName: 'Thika', location: 'Thika Town Center, Kiambu County', phone: '0795191909' },
  { id: 'store_ruiru', shortName: 'Ruiru', location: 'Ruiru Town, Kiambu County', phone: '0795191909' },
  { id: 'store_nairobi_cbd', shortName: 'Nairobi CBD', location: 'Kenyatta Avenue, Nairobi', phone: '0795191909' },
  { id: 'store_nakuru', shortName: 'Nakuru', location: 'Nakuru Town, Nakuru County', phone: '0795191909' },
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


function useLiveClock() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000); // every second
    return () => clearInterval(timer);
  }, []);

  return now;
}


interface ShortcutCallbacks {
  onSearch?: () => void;
  onSwitchTab?: (tab: AppTab) => void;
  onCheckout?: () => void;
  onHoldCart?: () => void;
  onClearSearch?: () => void;
  onShowShortcuts?: () => void;
}

const ShortcutCallbacksContext = createContext<ShortcutCallbacks>({});


function ConfettiOverlay({ active }: { active: boolean }) {
  const [particles, setParticles] = useState<Array<{ id: number; x: number; color: string; delay: number; duration: number; size: number }>>([]);

  useEffect(() => {
    if (active) {
      const colors = ['#16a34a', '#dc2626', '#d97706', '#2563eb', '#9333ea', '#ec4899', '#f97316'];
      const newParticles = Array.from({ length: 50 }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        color: colors[Math.floor(Math.random() * colors.length)],
        delay: Math.random() * 0.5,
        duration: 1.5 + Math.random() * 2,
        size: 4 + Math.random() * 8,
      }));
      setParticles(newParticles);
      const timer = setTimeout(() => setParticles([]), 4000);
      return () => clearTimeout(timer);
    } else {
      setParticles([]);
    }
  }, [active]);

  if (particles.length === 0) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-[100] overflow-hidden" aria-hidden="true">
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute animate-confetti-fall"
          style={{
            left: `${p.x}%`,
            top: '-10px',
            width: `${p.size}px`,
            height: `${p.size}px`,
            backgroundColor: p.color,
            borderRadius: Math.random() > 0.5 ? '50%' : '2px',
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }}
        />
      ))}
    </div>
  );
}


function KeyboardShortcutsHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const shortcuts = [
    { keys: '⌘K / Ctrl+K', description: 'Focus search bar', icon: Search },
    { keys: 'F2', description: 'Switch to POS tab', icon: ShoppingCart },
    { keys: 'F3', description: 'Switch to Inventory tab', icon: Package },
    { keys: 'F4', description: 'Switch to Customers tab', icon: Users },
    { keys: 'F5', description: 'Switch to Financial tab', icon: BarChart3 },
    { keys: 'F9', description: 'Process checkout', icon: CreditCard },
    { keys: 'F10', description: 'Hold current cart', icon: Pause },
    { keys: 'Esc', description: 'Clear search / close dialogs', icon: X },
    { keys: '? / Ctrl+/', description: 'Show this help', icon: Keyboard },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5 text-primary" />
            Keyboard Shortcuts
          </DialogTitle>
          <DialogDescription>
            Use these shortcuts to navigate faster
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          {shortcuts.map((shortcut) => {
            const Icon = shortcut.icon;
            return (
              <div key={shortcut.keys} className="flex items-center gap-3 py-1.5 px-2 rounded-md hover:bg-muted/50 transition-colors">
                <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="flex-1 text-sm">{shortcut.description}</span>
                <kbd className="pointer-events-none inline-flex h-6 select-none items-center gap-1 rounded border bg-muted px-2 font-mono text-[11px] font-medium text-muted-foreground">
                  {shortcut.keys}
                </kbd>
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Got it!</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


function QuickAddPopup({
  product,
  currentQty,
  onAdd,
  onClose,
}: {
  product: ProductListItem;
  currentQty: number;
  onAdd: (qty: number) => void;
  onClose: () => void;
}) {
  const [qty, setQty] = useState(currentQty > 0 ? currentQty + 1 : 1);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  return (
    <div className="absolute inset-0 z-20 bg-black/40 backdrop-blur-[2px] rounded-lg flex items-center justify-center animate-in fade-in duration-150">
      <div className="bg-background rounded-xl shadow-xl border p-3 w-[85%] max-w-[200px] space-y-2 animate-in zoom-in-95 duration-150">
        <p className="text-xs font-semibold truncate">{product.name}</p>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setQty(Math.max(1, qty - 1))}>
            <Minus className="h-3 w-3" />
          </Button>
          <Input
            ref={inputRef}
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(Math.max(1, parseInt(e.target.value) || 1))}
            className="h-7 w-14 text-center text-sm font-semibold px-1"
            onKeyDown={(e) => { if (e.key === 'Enter') { onAdd(qty); onClose(); } if (e.key === 'Escape') onClose(); }}
          />
          <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setQty(qty + 1)}>
            <Plus className="h-3 w-3" />
          </Button>
        </div>
        <div className="flex gap-1.5">
          <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={onClose}>Cancel</Button>
          <Button size="sm" className="flex-1 h-7 text-xs bg-primary" onClick={() => { onAdd(qty); onClose(); }}>
            Add {qty}
          </Button>
        </div>
      </div>
    </div>
  );
}


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
        {/* Welcome tagline above card */}
        <div className="text-center mb-5 text-white">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/60 mb-1.5">
            Kenya's Hardware Trade · Powered by Mbumah
          </p>
          <h2 className="text-xl font-semibold text-white/90 flex items-center justify-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-300" />
            Run your store with confidence
          </h2>
        </div>

        <Card className="shadow-2xl border border-white/10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl">
          <CardHeader className="text-center pb-2">
            {/* Animated logo */}
            <div className="mx-auto w-20 h-20 rounded-2xl overflow-hidden bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center mb-4 shadow-lg ring-4 ring-white/20 animate-pulse-slow">
              <img src="/logo.png" alt="Mbumah Hardware" className="w-full h-full object-cover" />
            </div>
            <CardTitle className="text-2xl font-bold tracking-tight">MBUMAH HARDWARE</CardTitle>
            <CardDescription className="text-base font-medium text-foreground/70">
              Point of Sale &amp; ERP System
            </CardDescription>

            {/* Trust badges row */}
            <div className="flex flex-wrap items-center justify-center gap-1.5 mt-3">
              <span className="inline-flex items-center gap-1 rounded-full border border-green-200 dark:border-green-900/50 bg-green-50 dark:bg-green-950/30 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:text-green-400">
                <ShieldCheck className="h-3 w-3" /> Bank-grade security
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                <Smartphone className="h-3 w-3" /> M-Pesa Daraja ready
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                <Store className="h-3 w-3" /> 5 branches
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="email" className="text-sm font-medium">Email Address</Label>
                </div>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="cashier@mbumahhardware.co.ke"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10 h-11"
                    required
                    disabled={isLoading}
                    autoComplete="email"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-sm font-medium">Password</Label>
                  <button
                    type="button"
                    onClick={() => toast.info('Contact your branch manager on 0795 191 909 to reset your password.')}
                    className="text-[11px] font-medium text-primary/80 hover:text-primary underline-offset-2 hover:underline transition-colors"
                    tabIndex={-1}
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <ShieldCheck className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10 pr-10 h-11"
                    required
                    disabled={isLoading}
                    autoComplete="current-password"
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
                className="w-full bg-accent-orange hover:bg-accent-orange/90 text-accent-orange-foreground font-semibold h-11 shadow-md shadow-accent-orange/20"
                disabled={isLoading}
                size="lg"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing In...
                  </>
                ) : (
                  <>
                    <LogOut className="mr-2 h-4 w-4 rotate-180" />
                    Sign In to Dashboard
                  </>
                )}
              </Button>
            </form>

            {/* Demo Accounts — collapsible, lower visual weight */}
            <div className="mt-6">
              <div className="flex items-center gap-3 mb-3">
                <Separator className="flex-1" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                  Quick Demo Access
                </span>
                <Separator className="flex-1" />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {DEMO_ACCOUNTS.map((acct) => {
                  const Icon = acct.icon;
                  return (
                    <button
                      key={acct.email}
                      type="button"
                      onClick={() => fillDemo(acct)}
                      className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all text-center hover:scale-[1.03] active:scale-[0.98] ${acct.bg}`}
                      title={`Sign in as ${acct.role}`}
                    >
                      <Icon className={`h-5 w-5 ${acct.color}`} />
                      <span className="text-[10px] font-medium leading-tight">{acct.role}</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground/50 text-center mt-2.5">
                Tap a role to auto-fill credentials, then press Sign In
              </p>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3 text-sm text-muted-foreground">
            <div className="flex items-center justify-center gap-3 w-full text-[11px] text-muted-foreground/70">
              <a
                href="tel:+254795191909"
                className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
              >
                <Smartphone className="h-3 w-3" /> 0795 191 909
              </a>
              <span className="text-muted-foreground/30">·</span>
              <a
                href="mailto:info@mbumahhardware.co.ke"
                className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
              >
                <Mail className="h-3 w-3" /> Support
              </a>
              <span className="text-muted-foreground/30">·</span>
              <span className="inline-flex items-center gap-1">
                <ShieldCheck className="h-3 w-3" /> Privacy
              </span>
            </div>
          </CardFooter>
          {/* Subtle Kenyan flag accent at bottom */}
          <div className="flex h-1 rounded-b-xl overflow-hidden">
            <div className="flex-1 bg-black" />
            <div className="flex-1 bg-red-600" />
            <div className="flex-1 bg-green-600" />
            <div className="flex-1 bg-white" />
          </div>
        </Card>
        {/* Branding text */}
        <p className="text-center mt-4 text-xs text-white/40 font-medium tracking-wider">
          Powered by MBUMAH HARDWARE · Made in Kenya 🇰🇪
        </p>
      </div>
    </div>
  );
}


// Hook to provide notification count globally
function useNotificationCount(storeId: string) {
  const { data } = useQuery({
    queryKey: ['notification-count', storeId],
    queryFn: async () => {
      const res = await notificationsApi.list(storeId);
      return Array.isArray(res.data) ? res.data : [];
    },
    refetchInterval: 60000, // Refresh every minute
    select: (notifications) => {
      const stored = localStorage.getItem('mbt_read_notifications');
      const storedDismissed = localStorage.getItem('mbt_dismissed_notifications');
      const readIds: Set<string> = stored ? new Set(JSON.parse(stored)) : new Set();
      const dismissedIds: Set<string> = storedDismissed ? new Set(JSON.parse(storedDismissed)) : new Set();
      const active = notifications.filter((n) => !dismissedIds.has(n.id));
      const unread = active.filter((n) => !readIds.has(n.id));
      return {
        total: active.length,
        unread: unread.length,
        critical: unread.filter((n) => n.severity === 'critical').length,
        hasNew: unread.length > 0,
      };
    },
  });
  return data || { total: 0, unread: 0, critical: 0, hasNew: false };
}

type NotificationFilter = 'all' | 'critical' | 'warning' | 'info';

function NotificationCenter({
  open,
  onOpenChange,
  storeId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
}) {
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const { setActiveTab } = useAppStore();

  // Persist read/dismissed state in localStorage
  const [readIds, setReadIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const stored = localStorage.getItem('mbt_read_notifications');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });

  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const stored = localStorage.getItem('mbt_dismissed_notifications');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });

  // Save to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem('mbt_read_notifications', JSON.stringify([...readIds]));
    } catch { /* ignore */ }
  }, [readIds]);

  useEffect(() => {
    try {
      localStorage.setItem('mbt_dismissed_notifications', JSON.stringify([...dismissedIds]));
    } catch { /* ignore */ }
  }, [dismissedIds]);

  const { data: notificationsData, isLoading } = useQuery({
    queryKey: ['notifications', storeId],
    queryFn: async () => {
      const res = await notificationsApi.list(storeId);
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: open,
  });

  const allNotifications = notificationsData || [];

  // Filter out dismissed notifications
  const activeNotifications = useMemo(
    () => allNotifications.filter((n) => !dismissedIds.has(n.id)),
    [allNotifications, dismissedIds]
  );

  // Apply severity filter
  const filteredNotifications = useMemo(() => {
    if (filter === 'all') return activeNotifications;
    return activeNotifications.filter((n) => n.severity === filter);
  }, [activeNotifications, filter]);

  const unreadCount = activeNotifications.filter((n) => !readIds.has(n.id)).length;

  // Vibrate on new critical notifications
  useEffect(() => {
    if (open && activeNotifications.length > 0) {
      const criticalUnread = activeNotifications.filter(
        (n) => n.severity === 'critical' && !readIds.has(n.id)
      );
      if (criticalUnread.length > 0 && navigator.vibrate) {
        navigator.vibrate(200);
      }
    }
  }, [open, activeNotifications, readIds]);

  const markAllRead = () => {
    setReadIds(new Set([...readIds, ...activeNotifications.map((n) => n.id)]));
  };

  const handleNotificationClick = (notification: NotificationItem) => {
    setReadIds((prev) => new Set([...prev, notification.id]));
    const targetTab = notification.targetTab as AppTab | undefined;
    if (targetTab) {
      setActiveTab(targetTab);
      onOpenChange(false);
    }
  };

  const handleDismiss = (e: React.MouseEvent, notificationId: string) => {
    e.stopPropagation();
    setDismissedIds((prev) => new Set([...prev, notificationId]));
  };

  const getNotificationIcon = (type: NotificationItem['type']) => {
    switch (type) {
      case 'out_of_stock': return <PackageX className="h-4 w-4 text-red-500" />;
      case 'low_stock': return <AlertTriangle className="h-4 w-4 text-amber-500" />;
      case 'overdue_rental': return <AlertOctagon className="h-4 w-4 text-red-500" />;
      case 'large_debt': return <CircleDollarSign className="h-4 w-4 text-amber-500" />;
      case 'new_customer': return <UserPlus className="h-4 w-4 text-green-500" />;
      case 'recent_transaction': return <Receipt className="h-4 w-4 text-blue-500" />;
    }
  };

  const getSeverityBg = (severity: NotificationItem['severity']) => {
    switch (severity) {
      case 'critical': return 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900/40';
      case 'warning': return 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/40';
      case 'info': return 'bg-green-50/50 dark:bg-green-950/10 border-green-200 dark:border-green-900/30';
    }
  };

  const filterTabs: { id: NotificationFilter; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: activeNotifications.length },
    { id: 'critical', label: 'Critical', count: activeNotifications.filter((n) => n.severity === 'critical').length },
    { id: 'warning', label: 'Warnings', count: activeNotifications.filter((n) => n.severity === 'warning').length },
    { id: 'info', label: 'Info', count: activeNotifications.filter((n) => n.severity === 'info').length },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="p-4 pb-2 border-b shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <SheetTitle className="text-lg">Notifications</SheetTitle>
              {unreadCount > 0 && (
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0 animate-pulse-slow">
                  {unreadCount}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              {dismissedIds.size > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-7 text-muted-foreground"
                  onClick={() => setDismissedIds(new Set())}
                >
                  Show dismissed
                </Button>
              )}
              {unreadCount > 0 && (
                <Button variant="ghost" size="sm" className="text-xs h-7" onClick={markAllRead}>
                  <CheckCheck className="h-3.5 w-3.5 mr-1" />
                  Mark all read
                </Button>
              )}
            </div>
          </div>
          <SheetDescription>
            Stay updated on stock levels, rentals, debts, and more
          </SheetDescription>
        </SheetHeader>

        {/* Filter Tabs */}
        <div className="flex items-center gap-1 px-4 py-2 border-b shrink-0">
          <Filter className="h-3.5 w-3.5 text-muted-foreground mr-1" />
          {filterTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                filter === tab.id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {tab.label}
              {tab.count > 0 && (
                <span className="ml-1 opacity-70">({tab.count})</span>
              )}
            </button>
          ))}
        </div>

        <ScrollArea className="flex-1">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : filteredNotifications.length === 0 ? (
            <div className="p-8 text-center">
              <BellRing className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">
                {filter === 'all' ? 'No notifications' : `No ${filter} notifications`}
              </p>
              <p className="text-xs text-muted-foreground/60 mt-1">You&apos;re all caught up!</p>
            </div>
          ) : (
            <div className="p-3 space-y-2">
              {filteredNotifications.map((notification) => {
                const isUnread = !readIds.has(notification.id);
                return (
                  <div
                    key={notification.id}
                    onClick={() => handleNotificationClick(notification)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleNotificationClick(notification); } }}
                    tabIndex={0}
                    className={`w-full text-left p-3 rounded-lg border transition-all hover:shadow-sm cursor-pointer group ${getSeverityBg(notification.severity)} ${isUnread ? 'ring-1 ring-primary/20' : 'opacity-70'}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="shrink-0 mt-0.5">{getNotificationIcon(notification.type)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">{notification.title}</p>
                          {isUnread && (
                            <span className="w-2 h-2 rounded-full bg-primary shrink-0 animate-pulse" />
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                          {notification.description}
                        </p>
                        <p className="text-[10px] text-muted-foreground/60 mt-1" title={formatDateTime(notification.timestamp)}>
                          {formatRelativeTime(notification.timestamp)}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="shrink-0 p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-muted/80 transition-all"
                        onClick={(e) => handleDismiss(e, notification.id)}
                        aria-label="Dismiss notification"
                      >
                        <X className="h-3 w-3 text-muted-foreground" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}


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

  const products = Array.isArray(productsData?.data) ? productsData.data : [];

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


function AppSidebar() {
  const { activeTab, setActiveTab, sidebarOpen, setSidebarOpen, currentStoreId, setCurrentStoreId } = useAppStore();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { theme, setTheme } = useTheme();
  const [notificationOpen, setNotificationOpen] = useState(false);
  const notificationCount = useNotificationCount(currentStoreId);

  const handleNav = (tab: AppTab) => {
    setActiveTab(tab);
    setSidebarOpen(false);
  };

  const handleLogout = async () => {
    await logout();
    toast.success('Logged out successfully');
  };

  // Role-based tab visibility — SUPER_ADMIN sees all; others see only their allowed tabs
  const visibleTabs = filterTabsByRole(user?.role);
  // Navigation groups (filtered by role)
  const mainNavItems = visibleTabs.filter(t => ['pos', 'catalog', 'inventory', 'customers', 'transactions'].includes(t.id));
  const managementNavItems = visibleTabs.filter(t => ['rentals', 'suppliers', 'financial', 'reports', 'gift-cards', 'payroll', 'admin'].includes(t.id));

  const renderNavItem = ({ id, label, icon: Icon }: { id: AppTab; label: string; icon: React.ElementType }) => (
    <button
      key={id}
      onClick={() => handleNav(id)}
      className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-300 ease-out relative group ${
        activeTab === id
          ? 'bg-sidebar-primary/90 text-sidebar-primary-foreground shadow-md shadow-sidebar-primary/25'
          : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground hover:translate-x-1'
      }`}
    >
      {/* Active left border indicator with pulse */}
      {activeTab === id && (
        <div className="absolute left-0 top-0.5 bottom-0.5 w-1 rounded-r-full bg-sidebar-primary-foreground/90 transition-all duration-300 shadow-[0_0_6px] shadow-sidebar-primary-foreground/30" />
      )}
      <Icon className={`h-4 w-4 shrink-0 relative z-10 transition-transform duration-300 ${activeTab === id ? 'scale-110' : 'group-hover:scale-110'}`} />
      <span className="relative z-10">{label}</span>
      {/* Keyboard shortcut hint for main tabs */}
      {id === 'pos' && <kbd className="ml-auto text-[8px] opacity-40 hidden xl:inline">F2</kbd>}
      {id === 'inventory' && <kbd className="ml-auto text-[8px] opacity-40 hidden xl:inline">F3</kbd>}
      {id === 'customers' && <kbd className="ml-auto text-[8px] opacity-40 hidden xl:inline">F4</kbd>}
      {id === 'financial' && <kbd className="ml-auto text-[8px] opacity-40 hidden xl:inline">F5</kbd>}
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
        className={`fixed top-0 left-0 z-50 h-full w-64 bg-sidebar/95 backdrop-blur-md text-sidebar-foreground transform transition-transform duration-200 ease-in-out lg:translate-x-0 lg:static lg:z-auto border-r border-sidebar-border shadow-lg lg:shadow-none ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Logo + Notification Bell */}
          <div className="flex items-center gap-3 px-4 py-5 border-b border-sidebar-border">
            <div className="w-9 h-9 rounded-lg overflow-hidden bg-sidebar-primary flex items-center justify-center shrink-0">
              <img src="/logo.png" alt="MH" className="w-full h-full object-cover" />
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
              {notificationCount.unread > 0 ? (
                <span className={`absolute -top-0.5 -right-0.5 min-w-[16px] h-4 flex items-center justify-center rounded-full text-[9px] font-bold text-white px-1 ${notificationCount.critical > 0 ? 'bg-red-500 animate-pulse' : 'bg-amber-500'}`}>
                  {notificationCount.unread > 99 ? '99+' : notificationCount.unread}
                </span>
              ) : null}
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-sidebar-border bg-sidebar-accent/50 text-xs text-sidebar-foreground/80 hover:bg-sidebar-accent transition-colors">
                  <Store className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate font-medium">{STORE_LIST.find(s => s.id === currentStoreId)?.shortName || 'Select Branch'}</span>
                  <ChevronDown className="h-3 w-3 ml-auto shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="start" className="w-64">
                <DropdownMenuLabel className="text-xs text-muted-foreground">Switch Branch</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {STORE_LIST.map((s) => (
                  <DropdownMenuItem
                    key={s.id}
                    onClick={() => setCurrentStoreId(s.id)}
                    className={currentStoreId === s.id ? 'bg-primary/10 text-primary font-medium' : ''}
                  >
                    <Store className="h-3.5 w-3.5 mr-2 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{s.shortName}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{s.location}</div>
                    </div>
                    {currentStoreId === s.id && <CheckCircle className="h-3.5 w-3.5 text-primary ml-1 shrink-0" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-3 py-2 space-y-1 overflow-y-auto custom-scrollbar">
            {/* Main Section */}
            <div className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40 flex items-center gap-1.5">
              <span>Main</span>
              <Separator className="flex-1 bg-sidebar-border/50" />
            </div>
            {mainNavItems.map(renderNavItem)}

            {/* Management Section */}
            <div className="px-4 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40 flex items-center gap-1.5">
              <span>Management</span>
              <Separator className="flex-1 bg-sidebar-border/50" />
            </div>
            {managementNavItems.map(renderNavItem)}
          </nav>

          {/* Footer - User Profile Dropdown */}
          <div className="border-t border-sidebar-border px-3 py-3 space-y-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <div className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-sidebar-accent transition-colors text-left cursor-pointer" role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.currentTarget.click(); }}>
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
                </div>
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
                <DropdownMenuItem onClick={() => toast.info('Press ? or Ctrl+/ for keyboard shortcuts')}>
                  <Keyboard className="mr-2 h-4 w-4" />
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

// TOP BAR (with live Date/Time)

function TopBar({ searchBtnRef }: { searchBtnRef?: React.RefObject<HTMLButtonElement | null> }) {
  const { activeTab, toggleSidebar, setActiveTab } = useAppStore();
  const cartItems = useCartStore((s) => s.items);
  const cartItemCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const currentStoreId = useAppStore((s) => s.currentStoreId);
  const currentTab = TAB_CONFIG.find(t => t.id === activeTab);
  const TabIcon = currentTab?.icon || Home;
  const now = useLiveClock();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [notifDropdownOpen, setNotifDropdownOpen] = useState(false);
  const notificationCount = useNotificationCount(currentStoreId);

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
        products: Array.isArray(prodRes.data) ? prodRes.data : [],
        customers: Array.isArray(custRes.data) ? custRes.data : [],
      };
    },
    enabled: searchQuery.length >= 2,
  });

  return (
    <>
      <header className="sticky top-0 z-30 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b shadow-sm">
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
              ref={searchBtnRef}
              variant="outline"
              size="sm"
              className="hidden md:flex items-center gap-2 text-muted-foreground h-8 px-3 transition-all duration-200 hover:border-primary/40 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-primary/30"
              onClick={() => setSearchOpen(true)}
            >
              <Search className="h-3.5 w-3.5" />
              <span className="text-xs">Search...</span>
              <kbd className="ml-2 pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                ⌘K
              </kbd>
            </Button>
            {/* Help & Tips Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 relative" aria-label="Help and tips">
                  <Lightbulb className="h-4 w-4" />
                  <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse-slow" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel className="flex items-center gap-2 text-sm">
                  <Lightbulb className="h-4 w-4 text-amber-500" />
                  Help &amp; Quick Tips
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold">
                  Top Shortcuts
                </DropdownMenuLabel>
                <div className="px-2 py-1 space-y-1 text-xs">
                  <div className="flex items-center justify-between px-2 py-1 rounded hover:bg-muted/50">
                    <span>Open POS</span><kbd className="px-1.5 py-0.5 rounded border bg-muted text-[10px] font-mono">F2</kbd>
                  </div>
                  <div className="flex items-center justify-between px-2 py-1 rounded hover:bg-muted/50">
                    <span>Inventory</span><kbd className="px-1.5 py-0.5 rounded border bg-muted text-[10px] font-mono">F3</kbd>
                  </div>
                  <div className="flex items-center justify-between px-2 py-1 rounded hover:bg-muted/50">
                    <span>Customers</span><kbd className="px-1.5 py-0.5 rounded border bg-muted text-[10px] font-mono">F4</kbd>
                  </div>
                  <div className="flex items-center justify-between px-2 py-1 rounded hover:bg-muted/50">
                    <span>Checkout cart</span><kbd className="px-1.5 py-0.5 rounded border bg-muted text-[10px] font-mono">F9</kbd>
                  </div>
                  <div className="flex items-center justify-between px-2 py-1 rounded hover:bg-muted/50">
                    <span>Search anywhere</span><kbd className="px-1.5 py-0.5 rounded border bg-muted text-[10px] font-mono">⌘K</kbd>
                  </div>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => toast.info('Press the ? key on your keyboard to see all shortcuts.')}>
                  <Keyboard className="mr-2 h-4 w-4" />
                  All keyboard shortcuts
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setActiveTab('pos')}>
                  <ShoppingCart className="mr-2 h-4 w-4 text-green-600" />
                  Start a new sale
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => toast.info('📞 Call support: 0795 191 909\n📧 Email: info@mbumahhardware.co.ke')}>
                  <Smartphone className="mr-2 h-4 w-4" />
                  Contact support
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => toast.info('MBUMAH HARDWARE POS & ERP\nVersion 1.0.0\nMade in Kenya 🇰🇪')}>
                  <Info className="mr-2 h-4 w-4" />
                  About this system
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {/* Notification Bell Dropdown */}
            <DropdownMenu open={notifDropdownOpen} onOpenChange={setNotifDropdownOpen}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="relative h-8 w-8">
                  <Bell className="h-4 w-4" />
                  {notificationCount.unread > 0 && (
                    <span className={`absolute -top-0.5 -right-0.5 min-w-[16px] h-4 flex items-center justify-center rounded-full text-[9px] font-bold text-white px-1 ${notificationCount.critical > 0 ? 'bg-red-500 animate-pulse' : 'bg-amber-500'}`}>
                      {notificationCount.unread > 99 ? '99+' : notificationCount.unread}
                    </span>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80 p-0">
                <div className="p-3 border-b flex items-center justify-between">
                  <span className="text-sm font-semibold">Notifications</span>
                  {notificationCount.unread > 0 && (
                    <Button variant="ghost" size="sm" className="text-xs h-6" onClick={() => {
                      try {
                        const stored = localStorage.getItem('mbt_read_notifications');
                        const existing = stored ? new Set(JSON.parse(stored)) : new Set();
                        // We can't easily mark all as read from here without fetching,
                        // so we just dismiss the dropdown and tell user to use notification center
                      } catch { /* ignore */ }
                    }}>
                      <CheckCheck className="h-3 w-3 mr-1" />
                      Mark all read
                    </Button>
                  )}
                </div>
                <div className="max-h-64 overflow-y-auto custom-scrollbar">
                  {notificationCount.unread === 0 ? (
                    <div className="p-4 text-center">
                      <BellRing className="h-8 w-8 mx-auto text-muted-foreground/20 mb-2" />
                      <p className="text-xs text-muted-foreground">All caught up!</p>
                    </div>
                  ) : (
                    <div className="p-2 space-y-1">
                      <p className="text-xs text-muted-foreground text-center py-2">
                        {notificationCount.unread} unread notification{notificationCount.unread !== 1 ? 's' : ''}
                      </p>
                    </div>
                  )}
                </div>
                <div className="p-2 border-t">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-xs h-7"
                    onClick={() => { setNotifDropdownOpen(false); /* open notification center via sidebar */ }}
                  >
                    View all notifications
                  </Button>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
            {cartItemCount > 0 && (
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
              {now.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </Badge>
          </div>
        </div>
      </header>

      {/* Global Search Dialog */}
      <Dialog open={searchOpen} onOpenChange={(open) => { setSearchOpen(open); if (!open) setSearchQuery(''); }}>
        <DialogContent className="sm:max-w-lg p-0 gap-0">
          <DialogHeader className="sr-only">
            <DialogTitle>Global Search</DialogTitle>
            <DialogDescription>Search across products, customers, and more</DialogDescription>
          </DialogHeader>
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


// Animated counter hook
function useAnimatedCounter(target: number, duration = 800) {
  const [count, setCount] = useState(0);
  const prevTarget = useRef(0);

  useEffect(() => {
    if (target === prevTarget.current) return;
    const start = prevTarget.current;
    const diff = target - start;
    const startTime = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.round(start + diff * eased));
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        prevTarget.current = target;
      }
    };

    requestAnimationFrame(animate);
  }, [target, duration]);

  return count;
}

// Mini sparkline component
function MiniSparkline({ data, color, height = 24 }: { data: number[]; color: string; height?: number }) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const width = 60;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} className="opacity-50 shrink-0" aria-hidden="true">
      <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" points={points} />
    </svg>
  );
}

function DashboardStats({ storeId, onLowStockClick }: { storeId: string; onLowStockClick?: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', storeId],
    queryFn: async () => {
      const res = await dashboardApi.getStats(storeId);
      const d = res.data;
      // Defensive: ensure all array fields are actually arrays
      if (d && typeof d === 'object') {
        return {
          ...d,
          salesByHour: Array.isArray(d.salesByHour) ? d.salesByHour : [],
          paymentMethodBreakdown: Array.isArray(d.paymentMethodBreakdown) ? d.paymentMethodBreakdown : [],
          recentTransactions: Array.isArray(d.recentTransactions) ? d.recentTransactions : [],
          topProducts: Array.isArray(d.topProducts) ? d.topProducts : [],
          topSellingCategories: Array.isArray(d.topSellingCategories) ? d.topSellingCategories : [],
          recentActivities: Array.isArray(d.recentActivities) ? d.recentActivities : [],
        };
      }
      return d ?? null;
    },
    refetchInterval: 30000, // More frequent refresh
  });

  const animatedSales = useAnimatedCounter(data?.todaySales ?? 0);
  const animatedTransactions = useAnimatedCounter(data?.todayTransactions ?? 0);
  const animatedLowStock = useAnimatedCounter(data?.lowStockProducts ?? 0);
  const animatedDebt = useAnimatedCounter(data?.outstandingDebt ?? 0);

  // Generate fake sparkline data from salesByHour or random
  const sparkData = useMemo(() => {
    if (data && data.salesByHour && data.salesByHour.length > 1) {
      return data.salesByHour.map(h => h.amount);
    }
    return [20, 40, 30, 60, 50, 80, 70, 90];
  }, [data]);

  const stats = [
    {
      label: "Today's Sales",
      value: data?.todaySales ?? 0,
      animatedValue: animatedSales,
      format: 'kes' as const,
      icon: TrendingUp,
      color: 'text-green-600 dark:text-green-400',
      bg: 'bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/40 dark:to-emerald-950/30',
      borderColor: 'border-l-green-500',
      sparkColor: '#16a34a',
      trend: '+12%',
      trendUp: true,
      clickable: false,
    },
    {
      label: 'Transactions',
      value: data?.todayTransactions ?? 0,
      animatedValue: animatedTransactions,
      format: 'number' as const,
      icon: ShoppingCart,
      color: 'text-blue-600 dark:text-blue-400',
      bg: 'bg-gradient-to-br from-blue-50 to-sky-50 dark:from-blue-950/40 dark:to-sky-950/30',
      borderColor: 'border-l-blue-500',
      sparkColor: '#2563eb',
      trend: '+8%',
      trendUp: true,
      clickable: false,
    },
    {
      label: 'Low Stock',
      value: data?.lowStockProducts ?? 0,
      animatedValue: animatedLowStock,
      format: 'number' as const,
      icon: AlertTriangle,
      color: 'text-amber-600 dark:text-amber-400',
      bg: 'bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-amber-950/40 dark:to-yellow-950/30',
      borderColor: 'border-l-amber-500',
      sparkColor: '#d97706',
      trend: '-3%',
      trendUp: false,
      clickable: true,
    },
    {
      label: 'Outstanding Debt',
      value: data?.outstandingDebt ?? 0,
      animatedValue: animatedDebt,
      format: 'kes' as const,
      icon: DollarSign,
      color: 'text-red-600 dark:text-red-400',
      bg: 'bg-gradient-to-br from-red-50 to-rose-50 dark:from-red-950/40 dark:to-rose-950/30',
      borderColor: 'border-l-red-500',
      sparkColor: '#dc2626',
      trend: '+5%',
      trendUp: true,
      clickable: false,
    },
  ];

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="overflow-hidden">
            <CardContent className="p-3">
              <div className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-lg" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-5 w-24" />
                </div>
              </div>
            </CardContent>
          </Card>
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
            className={`border-l-4 ${stat.borderColor} py-0 ${stat.bg} backdrop-blur-sm ${
              isClickable ? 'cursor-pointer hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0' : 'transition-shadow duration-200 hover:shadow-sm'
            }`}
            onClick={isClickable ? onLowStockClick : undefined}
            role={isClickable ? 'button' : undefined}
            tabIndex={isClickable ? 0 : undefined}
            onKeyDown={isClickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onLowStockClick(); } } : undefined}
          >
            <CardContent className="p-3 flex items-center gap-3">
              <div className={`shrink-0 p-2 rounded-lg bg-white/70 dark:bg-black/20 backdrop-blur-sm`}>
                <Icon className={`h-4 w-4 ${stat.color}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight">{stat.label}</p>
                <div className="flex items-center gap-1.5">
                  <p className={`text-sm sm:text-base font-bold ${stat.color} whitespace-nowrap animate-count-up`}>
                    {stat.format === 'kes' ? formatKES(stat.animatedValue) : stat.animatedValue}
                  </p>
                  {isClickable && (
                    <span className="text-[9px] text-muted-foreground/50">→</span>
                  )}
                </div>
              </div>
              <div className="shrink-0 flex flex-col items-end gap-0.5">
                <MiniSparkline data={sparkData} color={stat.sparkColor} />
                <div className={`flex items-center gap-0.5 text-[9px] font-medium ${stat.trendUp ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  {stat.trendUp ? <TrendingUp className="h-2.5 w-2.5" /> : <ArrowDownRight className="h-2.5 w-2.5" />}
                  {stat.trend}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}


function CategoryChips({
  categories,
  selected,
  onSelect,
}: {
  categories: CategoryItem[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (el) {
      el.addEventListener('scroll', checkScroll);
      window.addEventListener('resize', checkScroll);
    }
    return () => {
      if (el) el.removeEventListener('scroll', checkScroll);
      window.removeEventListener('resize', checkScroll);
    };
  }, [checkScroll, categories]);

  const scrollBy = (direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (el) {
      el.scrollBy({ left: direction === 'left' ? -150 : 150, behavior: 'smooth' });
    }
  };

  return (
    <div className="relative flex items-center gap-1">
      {canScrollLeft && (
        <button
          onClick={() => scrollBy('left')}
          className="shrink-0 h-7 w-7 rounded-full border bg-background shadow-sm flex items-center justify-center hover:bg-muted transition-colors z-10"
          aria-label="Scroll categories left"
        >
          <ChevronDown className="h-3 w-3 rotate-90" />
        </button>
      )}
      <div ref={scrollRef} className="flex gap-2 overflow-x-auto scrollbar-none py-0.5 flex-1 px-1" style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <button
          onClick={() => onSelect('all')}
          className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-all whitespace-nowrap ${
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
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-all whitespace-nowrap flex items-center gap-1.5 min-w-fit ${
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
      {canScrollRight && (
        <button
          onClick={() => scrollBy('right')}
          className="shrink-0 h-7 w-7 rounded-full border bg-background shadow-sm flex items-center justify-center hover:bg-muted transition-colors z-10"
          aria-label="Scroll categories right"
        >
          <ChevronDown className="h-3 w-3 -rotate-90" />
        </button>
      )}
    </div>
  );
}


function ProductCard({
  product,
  onAdd,
  cartQuantity,
}: {
  product: ProductListItem;
  onAdd: (p: ProductListItem, qty?: number) => void;
  cartQuantity?: number;
}) {
  const [isBouncing, setIsBouncing] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const categoryColor = product.category?.color || '#6b7280';
  const stockPercent = product.reorderLevel > 0
    ? Math.min((product.quantityInStock / (product.reorderLevel * 3)) * 100, 100)
    : product.quantityInStock > 0 ? 100 : 0;
  const isLowStock = product.quantityInStock <= product.reorderLevel && product.quantityInStock > 0;
  const isOutOfStock = product.quantityInStock <= 0;

  // Check if product is new (created within last 7 days)
  const isNew = useMemo(() => {
    const created = new Date(product.createdAt || Date.now());
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    return created > sevenDaysAgo;
  }, [product.createdAt]);

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

  const handleClick = () => {
    // If already in cart, show Quick Add popup
    if (cartQuantity && cartQuantity > 0) {
      setShowQuickAdd(true);
      return;
    }
    setIsBouncing(true);
    onAdd(product);
    setTimeout(() => setIsBouncing(false), 400);
  };

  const handleQuickAdd = (qty: number) => {
    setIsBouncing(true);
    onAdd(product, qty);
    setTimeout(() => setIsBouncing(false), 400);
  };

  // Out-of-stock disables interaction (rentals can still be added)
  const disabled = isOutOfStock && !product.isRental;

  return (
    <Card
      className={`overflow-hidden transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:border-primary/40 group relative h-full flex flex-col min-h-[210px] ${isBouncing ? 'animate-bounce-add' : ''} ${disabled ? 'opacity-60 grayscale pointer-events-none' : 'cursor-pointer hover:scale-[1.02]'}`}
      style={{ borderTopColor: categoryColor, borderTopWidth: '4px' }}
      onClick={disabled ? undefined : handleClick}
      role="button"
      aria-label={`${product.name}, ${formatKES(product.pricePerUnit)}, ${isOutOfStock ? 'out of stock' : `${product.quantityInStock} in stock`}`}
      aria-disabled={disabled}
    >
      {/* Quick Add Popup Overlay */}
      {showQuickAdd && !disabled && (
        <QuickAddPopup
          product={product}
          currentQty={cartQuantity || 0}
          onAdd={handleQuickAdd}
          onClose={() => setShowQuickAdd(false)}
        />
      )}
      {/* In-cart indicator */}
      {cartQuantity && cartQuantity > 0 && (
        <div className="absolute top-1.5 right-1.5 z-10 bg-primary text-primary-foreground text-[11px] font-bold rounded-full min-w-[22px] h-[22px] flex items-center justify-center px-1.5 shadow-md ring-2 ring-background">
          {cartQuantity}
        </div>
      )}
      {/* Image area — taller & more readable */}
      <div className="h-32 bg-muted flex items-center justify-center relative overflow-hidden shrink-0">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover group-hover:scale-110 transition-transform duration-500" />
        ) : getCategoryImage(product.categoryId) ? (
          <img src={getCategoryImage(product.categoryId)!} alt={product.category?.name || ''} className="h-full w-full object-cover group-hover:scale-110 transition-transform duration-500" />
        ) : (
          <Package className="h-10 w-10 text-muted-foreground/25" />
        )}
        {/* Gradient overlay on hover */}
        {!disabled && (
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/0 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
            <div className="bg-white/95 dark:bg-black/80 rounded-full p-2.5 shadow-lg transform scale-50 group-hover:scale-100 transition-transform duration-200">
              {cartQuantity && cartQuantity > 0 ? <Zap className="h-5 w-5 text-primary" /> : <Plus className="h-5 w-5 text-primary" />}
            </div>
          </div>
        )}
        {/* Badges */}
        <div className="absolute top-1.5 left-1.5 flex flex-col gap-1 z-20">
          {product.isRental && (
            <Badge className="bg-amber-600 text-white text-[10px] px-1.5 py-0.5 font-semibold shadow-sm">RENTAL</Badge>
          )}
          {product.isBundle && (
            <Badge className="bg-purple-600 text-white text-[10px] px-1.5 py-0.5 font-semibold shadow-sm">BUNDLE</Badge>
          )}
          {isNew && !product.isRental && !product.isBundle && (
            <Badge className="bg-green-600 text-white text-[10px] px-1.5 py-0.5 font-semibold shadow-sm">NEW</Badge>
          )}
        </div>
        {/* Stock status badge (top-right when not in cart) */}
        {(!cartQuantity || cartQuantity === 0) && (
          <div className="absolute top-1.5 right-1.5 z-20">
            {isOutOfStock ? (
              <Badge variant="destructive" className="text-[10px] font-bold shadow-sm">OUT OF STOCK</Badge>
            ) : isLowStock ? (
              <Badge className="bg-amber-500 text-white text-[10px] font-semibold shadow-sm">LOW STOCK</Badge>
            ) : null}
          </div>
        )}
        {isOutOfStock && (
          <div className="absolute inset-0 bg-red-500/10 flex items-center justify-center pointer-events-none" />
        )}
      </div>
      <CardContent className="p-3 flex-1 flex flex-col gap-1">
        {/* Product name — wraps fully, never truncates words (no line-clamp so every word shows) */}
        <h3 className="font-semibold text-[15px] leading-snug break-words min-h-[2.6em]">{product.name}</h3>
        {product.category && (
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: categoryColor }} aria-hidden />
            <p className="text-[11px] text-muted-foreground/80 truncate">{product.category.name}</p>
          </div>
        )}
        <div className="flex items-end justify-between mt-1 gap-1.5">
          <div className="min-w-0">
            <p className="font-bold text-primary text-base leading-none break-words">{formatKES(product.pricePerUnit)}</p>
            <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium mt-1 inline-block ${unitBadgeColor[product.unitType] || 'bg-muted text-muted-foreground'}`}>
              per {product.unitType}
            </span>
          </div>
          {/* Quick add button — touch-friendly 44px target */}
          <Button
            type="button"
            size="icon"
            variant={disabled ? 'ghost' : 'default'}
            className="h-10 w-10 shrink-0 shadow-sm"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              if (cartQuantity && cartQuantity > 0) {
                setShowQuickAdd(true);
              } else {
                handleClick();
              }
            }}
            aria-label={`Add ${product.name} to cart`}
          >
            {cartQuantity && cartQuantity > 0 ? <Zap className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          </Button>
        </div>
        {/* Stock bar — clear low/out-of-stock visual */}
        <div className="flex items-center gap-2 mt-auto pt-1.5">
          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full animate-stock-fill ${stockBarColor} relative`}
              style={{ width: `${stockPercent}%` }}
            >
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
            </div>
          </div>
          <span className={`text-[10px] font-semibold shrink-0 ${isOutOfStock ? 'text-red-500' : isLowStock ? 'text-amber-500' : 'text-muted-foreground'}`}>
            {isOutOfStock ? 'Out' : `${product.quantityInStock} left`}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// CART ITEM ROW (enhanced)

function CartItemRow({
  item,
  onUpdateQty,
  onRemove,
  isNew,
  note,
  onNoteChange,
}: {
  item: CartItem;
  onUpdateQty: (productId: string, qty: number) => void;
  onRemove: (productId: string) => void;
  isNew?: boolean;
  note?: string;
  onNoteChange?: (productId: string, note: string) => void;
}) {
  const quickAddAmounts = [1, 2, 5, 10];
  const [showNote, setShowNote] = useState(!!note);

  return (
    <div className={`group flex gap-2 p-2 rounded-lg bg-muted/40 hover:bg-muted/60 transition-all duration-200 ${isNew ? 'animate-slide-in' : ''}`}>
      {/* Image placeholder */}
      <div className="shrink-0 w-9 h-9 rounded-md bg-muted flex items-center justify-center">
        <Package className="h-3.5 w-3.5 text-muted-foreground/40" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-1">
          <p className="text-sm font-medium truncate">{item.productName}</p>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 shrink-0 text-muted-foreground/50 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => onRemove(item.productId)}
            aria-label="Remove item"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-xs text-muted-foreground">{formatKES(item.pricePerUnit)}</span>
          <span className="text-[9px] px-1 py-0 rounded bg-muted text-muted-foreground font-medium">{item.unitType}</span>
          {item.discountPercent > 0 && (
            <span className="text-[9px] text-green-600 font-medium">{item.discountPercent}% off</span>
          )}
        </div>
        {/* Quick Add buttons - hidden on desktop, shown on hover; always visible on mobile */}
        <div className="flex items-center gap-0.5 mt-1 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity duration-200">
          {quickAddAmounts.map((amt) => (
            <button
              key={amt}
              type="button"
              onClick={() => onUpdateQty(item.productId, item.quantity + amt)}
              className="px-1 py-0 text-[8px] font-medium rounded border border-border/50 bg-background hover:bg-primary hover:text-primary-foreground transition-colors"
            >
              +{amt}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowNote(!showNote)}
            className={`px-1 py-0 text-[8px] font-medium rounded border transition-colors ${showNote ? 'border-primary bg-primary/10 text-primary' : 'border-border/50 bg-background hover:bg-muted'}`}
            title="Add note"
          >
            <MessageSquare className="h-2.5 w-2.5 inline" />
          </button>
        </div>
        {/* Note input */}
        {showNote && (
          <Input
            placeholder="Add a note..."
            value={note || ''}
            onChange={(e) => onNoteChange?.(item.productId, e.target.value)}
            className="h-6 text-[10px] mt-1 px-2 py-0"
            onClick={(e) => e.stopPropagation()}
          />
        )}
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <div className="flex items-center gap-0.5">
          <Button
            variant="outline"
            size="icon"
            className="h-6 w-6"
            onClick={() => onUpdateQty(item.productId, item.quantity - 1)}
            aria-label="Decrease quantity"
          >
            <Minus className="h-2.5 w-2.5" />
          </Button>
          <span className="w-7 text-center text-xs font-semibold">{item.quantity}</span>
          <Button
            variant="outline"
            size="icon"
            className="h-6 w-6"
            onClick={() => onUpdateQty(item.productId, item.quantity + 1)}
            aria-label="Increase quantity"
          >
            <Plus className="h-2.5 w-2.5" />
          </Button>
        </div>
        <p className="text-xs font-semibold text-primary">{formatKES(item.lineTotal)}</p>
      </div>
    </div>
  );
}


function EmptyCartState() {
  return (
    <div className="p-8 text-center">
      {/* empty cart illustration */}
      <div className="relative mx-auto w-32 h-32 mb-5">
        {/* Cart body */}
        <div className="absolute bottom-6 left-4 right-4 h-16 border-2 border-muted-foreground/12 rounded-b-xl bg-muted/15 backdrop-blur-sm">
          {/* Empty lines */}
          <div className="absolute top-4 left-4 right-4 space-y-2">
            <div className="h-1 bg-muted-foreground/6 rounded" />
            <div className="h-1 bg-muted-foreground/6 rounded w-3/4" />
          </div>
          {/* Sparkle icon */}
          <Sparkles className="absolute bottom-2 right-3 h-3.5 w-3.5 text-muted-foreground/12" />
        </div>
        {/* Cart handle */}
        <div className="absolute top-2 left-7 right-7 h-8 border-t-2 border-l-2 border-r-2 border-muted-foreground/12 rounded-t-full" />
        {/* Wheels */}
        <div className="absolute bottom-3 left-7 w-4 h-4 border-2 border-muted-foreground/12 rounded-full bg-background">
          <div className="absolute inset-0.5 border border-muted-foreground/8 rounded-full" />
        </div>
        <div className="absolute bottom-3 right-7 w-4 h-4 border-2 border-muted-foreground/12 rounded-full bg-background">
          <div className="absolute inset-0.5 border border-muted-foreground/8 rounded-full" />
        </div>
        {/* Animated arrow pointing to products */}
        <div className="absolute -top-1 -right-1 animate-bounce">
          <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center ring-2 ring-primary/5">
            <Plus className="h-4 w-4 text-primary/60" />
          </div>
        </div>
        {/* Subtle glow */}
        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-20 h-5 bg-primary/5 rounded-full blur-md" />
      </div>
      <p className="text-sm font-medium text-muted-foreground">Your cart is empty</p>
      <p className="text-xs text-muted-foreground/50 mt-1.5">Click on products to add them here</p>
      <div className="mt-4 flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground/35">
        <Keyboard className="h-3 w-3" />
        <span>Press <kbd className="px-1 py-0.5 rounded border bg-muted text-[9px]">F9</kbd> to checkout</span>
      </div>
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

// ─── Shared checkout dialog (ResponsiveDialog) ───────────────────────────────
// Used by both desktop & mobile POS so the payment flow stays consistent.
// Order: Cash → Debt → Either/Split → M-Pesa.

interface CheckoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalTotal: number;
  totalDiscount: number;
  paymentMethod: PaymentMethod;
  setPaymentMethod: (m: PaymentMethod) => void;
  cashReceived: string;
  setCashReceived: (v: string) => void;
  change: number;
  selectedCustomer: string;
  customers: CustomerItem[];
  splitCashAmount: string;
  setSplitCashAmount: (v: string) => void;
  splitMpesaAmount: string;
  setSplitMpesaAmount: (v: string) => void;
  mpesaPhone: string;
  setMpesaPhone: (v: string) => void;
  mpesaStatus: 'idle' | 'processing' | 'success' | 'failed';
  setMpesaStatus: (s: 'idle' | 'processing' | 'success' | 'failed') => void;
  stkCheckoutRequestId: string;
  stkResultDesc: string;
  stkPolling: boolean;
  mpesaMutation: { isPending: boolean; mutate: (data: { phoneNumber: string; amount: number; accountReference: string; transactionDesc: string }) => void };
  checkoutMutation: { isPending: boolean };
  onSendStkPush: () => void;
  onRetryStk: () => void;
  onCompleteSale: () => void;
}

const PAYMENT_METHODS: { value: PaymentMethod; label: string; icon: React.ElementType; desc: string }[] = [
  { value: 'CASH', label: 'Cash', icon: Banknote, desc: 'Receive cash & give change' },
  { value: 'DEBT', label: 'Debt', icon: Wallet, desc: 'Put it on a customer account' },
  { value: 'SPLIT', label: 'Either / Split', icon: Split, desc: 'Cash + M-Pesa combined' },
  { value: 'MPESA', label: 'M-Pesa', icon: Smartphone, desc: 'STK push to customer phone' },
];

function CheckoutDialog(props: CheckoutDialogProps) {
  const {
    open, onOpenChange, finalTotal, totalDiscount,
    paymentMethod, setPaymentMethod,
    cashReceived, setCashReceived, change,
    selectedCustomer, customers,
    splitCashAmount, setSplitCashAmount, splitMpesaAmount, setSplitMpesaAmount,
    mpesaPhone, setMpesaPhone, mpesaStatus, setMpesaStatus,
    stkCheckoutRequestId, stkResultDesc, stkPolling,
    mpesaMutation, checkoutMutation,
    onSendStkPush, onRetryStk, onCompleteSale,
  } = props;

  const customer = customers.find((c) => c.id === selectedCustomer);
  const debtAvailable = customer ? Math.max(0, customer.debtLimit - customer.currentDebtBalance) : 0;
  const exceedsDebt = customer ? finalTotal > debtAvailable : false;

  const cashValid = !!cashReceived && Number(cashReceived) >= finalTotal;
  const splitValid = (Number(splitCashAmount) || 0) + (Number(splitMpesaAmount) || 0) >= finalTotal && (Number(splitMpesaAmount) || 0) > 0 ? !!mpesaPhone && mpesaPhone.length >= 9 : true;
  const mpesaValid = !!mpesaPhone && mpesaPhone.length >= 9;

  // Reset M-Pesa status when payment method changes (away from MPESA)
  useEffect(() => {
    if (paymentMethod !== 'MPESA' && paymentMethod !== 'SPLIT' && mpesaStatus !== 'idle') {
      setMpesaStatus('idle');
    }
  }, [paymentMethod, mpesaStatus, setMpesaStatus]);

  const isProcessingMpesa = mpesaStatus === 'processing' || mpesaStatus === 'success' || mpesaStatus === 'failed';
  const showMpesaPanel = (paymentMethod === 'MPESA' || paymentMethod === 'SPLIT');

  // Build the footer buttons depending on state
  const renderFooter = () => {
    if (mpesaStatus === 'processing') {
      return (
        <>
          <Button variant="outline" onClick={() => { onRetryStk(); }} disabled={stkPolling}>
            Cancel
          </Button>
          <a
            href="https://daraja.safaricom.co.ke"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-input bg-background text-sm font-medium hover:bg-muted"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Open M-Pesa Daraja
          </a>
        </>
      );
    }
    if (mpesaStatus === 'success') {
      return (
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button
            onClick={onCompleteSale}
            disabled={checkoutMutation.isPending}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            {checkoutMutation.isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Completing…</>
            ) : (
              <><CheckCircle className="mr-2 h-4 w-4" />Complete Sale</>
            )}
          </Button>
        </>
      );
    }
    if (mpesaStatus === 'failed') {
      return (
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onRetryStk}>Try Again</Button>
        </>
      );
    }
    // Default: idle — show Cancel + Complete Sale / Send STK Push
    const canComplete =
      (paymentMethod === 'CASH' && cashValid) ||
      (paymentMethod === 'DEBT' && !!selectedCustomer && !exceedsDebt) ||
      (paymentMethod === 'SPLIT' && splitValid);

    if (showMpesaPanel && !isProcessingMpesa) {
      return (
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={onSendStkPush}
            disabled={mpesaMutation.isPending || !mpesaValid}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            {mpesaMutation.isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending STK…</>
            ) : (
              <><Smartphone className="mr-2 h-4 w-4" />Send STK Push</>
            )}
          </Button>
        </>
      );
    }
    return (
      <>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button
          onClick={onCompleteSale}
          disabled={checkoutMutation.isPending || !canComplete}
          className="bg-accent-orange hover:bg-accent-orange/90 text-accent-orange-foreground"
        >
          {checkoutMutation.isPending ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing…</>
          ) : (
            <><CheckCircle className="mr-2 h-4 w-4" />Complete Sale</>
          )}
        </Button>
      </>
    );
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => {
        // Prevent closing while STK push is actively processing
        if (!o && mpesaStatus === 'processing') return;
        onOpenChange(o);
      }}
      title={
        <span className="flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-primary" />
          Complete Payment
        </span>
      }
      description={
        <span className="break-words">
          Total: <span className="font-bold text-primary">{formatKES(finalTotal)}</span>
          {totalDiscount > 0 && (
            <span className="text-green-600 text-xs ml-2">(Save {formatKES(totalDiscount)})</span>
          )}
        </span>
      }
      size="md"
      footer={renderFooter()}
    >
      <div className="space-y-4">
        {/* Payment Method Selector — Cash, Debt, Either/Split, M-Pesa */}
        <div>
          <Label className="text-sm font-medium">Payment Method</Label>
          <RadioGroup
            value={paymentMethod}
            onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}
            className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2"
          >
            {PAYMENT_METHODS.map((m) => {
              const Icon = m.icon;
              return (
                <div key={m.value}>
                  <RadioGroupItem value={m.value} id={`pm-${m.value}`} className="peer sr-only" />
                  <Label
                    htmlFor={`pm-${m.value}`}
                    className="flex flex-col items-center gap-1.5 p-3 border-2 rounded-lg cursor-pointer peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 hover:bg-muted/50 transition-colors text-center min-h-[80px] justify-center"
                  >
                    <Icon className="h-5 w-5" />
                    <span className="text-xs font-semibold leading-tight">{m.label}</span>
                    <span className="text-[10px] text-muted-foreground leading-tight line-clamp-2 break-words">{m.desc}</span>
                  </Label>
                </div>
              );
            })}
          </RadioGroup>
        </div>

        {/* === CASH === */}
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
              {/* Quick cash buttons */}
              <div className="flex flex-wrap gap-1.5 mt-2">
                {[finalTotal, Math.ceil(finalTotal / 100) * 100, Math.ceil(finalTotal / 500) * 500, Math.ceil(finalTotal / 1000) * 1000].map((amt, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setCashReceived(String(amt))}
                    className="px-2.5 py-1 text-xs font-medium rounded border border-border bg-background hover:bg-muted transition-colors min-h-[36px]"
                  >
                    {formatKES(amt)}
                  </button>
                ))}
              </div>
            </div>
            {change > 0 && (
              <div className="p-3 bg-green-50 dark:bg-green-950/30 rounded-lg flex items-center justify-between">
                <span className="text-sm font-medium text-green-700 dark:text-green-400">Change Due</span>
                <span className="text-lg font-bold text-green-700 dark:text-green-400">{formatKES(change)}</span>
              </div>
            )}
            {cashReceived && Number(cashReceived) < finalTotal && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Insufficient amount</AlertTitle>
                <AlertDescription>Need {formatKES(finalTotal - Number(cashReceived))} more</AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* === DEBT === */}
        {paymentMethod === 'DEBT' && (
          <div className="space-y-3">
            {!selectedCustomer || selectedCustomer === 'walk-in' ? (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Customer Required</AlertTitle>
                <AlertDescription>
                  Please select a customer (not walk-in) from the cart sidebar before proceeding with debt payment.
                </AlertDescription>
              </Alert>
            ) : customer ? (
              <>
                <div className="p-3 rounded-lg border bg-muted/30 space-y-2">
                  <div className="flex items-center gap-2">
                    <Avatar className="h-9 w-9">
                      <AvatarFallback>{customer.name.charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{customer.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{customer.phone || 'No phone on file'}</p>
                    </div>
                  </div>
                  <Separator />
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Debt Limit</p>
                      <p className="font-semibold">{formatKES(customer.debtLimit)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Current Debt</p>
                      <p className="font-semibold">{formatKES(customer.currentDebtBalance)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Available</p>
                      <p className="font-semibold text-green-600">{formatKES(debtAvailable)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">This Sale</p>
                      <p className="font-semibold text-primary">{formatKES(finalTotal)}</p>
                    </div>
                  </div>
                </div>
                {exceedsDebt && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Exceeds Debt Limit</AlertTitle>
                    <AlertDescription>
                      This sale ({formatKES(finalTotal)}) exceeds the customer&rsquo;s available debt ({formatKES(debtAvailable)}).
                      Collect partial cash or increase the debt limit on the customer record.
                    </AlertDescription>
                  </Alert>
                )}
                <p className="text-xs text-muted-foreground">
                  On checkout, this sale will create a debt ledger entry against <span className="font-semibold">{customer.name}</span>&rsquo;s account.
                </p>
              </>
            ) : null}
          </div>
        )}

        {/* === SPLIT (Either) === */}
        {paymentMethod === 'SPLIT' && (
          <div className="space-y-3 p-3 rounded-lg border bg-muted/30">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Split className="h-3 w-3" /> Split payment between Cash and M-Pesa
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="splitCash" className="text-xs flex items-center gap-1">
                  <Banknote className="h-3 w-3" /> Cash Amount
                </Label>
                <Input
                  id="splitCash"
                  type="number"
                  placeholder="0"
                  value={splitCashAmount}
                  onChange={(e) => {
                    setSplitCashAmount(e.target.value);
                    const remaining = finalTotal - Number(e.target.value);
                    if (remaining > 0) setSplitMpesaAmount(String(remaining));
                  }}
                  className="mt-1 text-sm font-semibold"
                />
              </div>
              <div>
                <Label htmlFor="splitMpesa" className="text-xs flex items-center gap-1">
                  <Smartphone className="h-3 w-3" /> M-Pesa Amount
                </Label>
                <Input
                  id="splitMpesa"
                  type="number"
                  placeholder="0"
                  value={splitMpesaAmount}
                  onChange={(e) => {
                    setSplitMpesaAmount(e.target.value);
                    const remaining = finalTotal - Number(e.target.value);
                    if (remaining > 0) setSplitCashAmount(String(remaining));
                  }}
                  className="mt-1 text-sm font-semibold"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="splitMpesaPhone" className="text-xs">M-Pesa Phone</Label>
              <Input
                id="splitMpesaPhone"
                type="tel"
                placeholder="0712 345 678"
                value={mpesaPhone}
                onChange={(e) => setMpesaPhone(e.target.value)}
                className="mt-1 text-sm"
              />
            </div>
            <div className="text-xs flex justify-between">
              <span className="text-muted-foreground">Total Entered:</span>
              <span className={`font-semibold ${(Number(splitCashAmount) || 0) + (Number(splitMpesaAmount) || 0) >= finalTotal ? 'text-green-600' : 'text-amber-600'}`}>
                {formatKES((Number(splitCashAmount) || 0) + (Number(splitMpesaAmount) || 0))}
                {((Number(splitCashAmount) || 0) + (Number(splitMpesaAmount) || 0)) < finalTotal && (
                  <span className="ml-1">· short {formatKES(finalTotal - (Number(splitCashAmount) || 0) - (Number(splitMpesaAmount) || 0))}</span>
                )}
              </span>
            </div>
            {/* Show STK push state for split's mpesa portion */}
            {isProcessingMpesa && <StkStatusPanel
              status={mpesaStatus}
              stkCheckoutRequestId={stkCheckoutRequestId}
              stkResultDesc={stkResultDesc}
              stkPolling={stkPolling}
              amount={Number(splitMpesaAmount) || 0}
            />}
          </div>
        )}

        {/* === MPESA === */}
        {paymentMethod === 'MPESA' && (
          <div className="space-y-3">
            {mpesaStatus === 'idle' && (
              <>
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
                  <p className="text-[11px] text-muted-foreground mt-1">
                    An STK push will be sent to this number. The customer must enter their M-Pesa PIN to authorise the payment of <span className="font-semibold">{formatKES(finalTotal)}</span>.
                  </p>
                </div>
                <div className="flex items-center gap-2 p-2.5 rounded-md bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900">
                  <Smartphone className="h-4 w-4 text-green-600 shrink-0" />
                  <p className="text-[11px] text-green-700 dark:text-green-300">
                    Using Safaricom Daraja API. Need to check credentials or test callback?{' '}
                    <a href="https://daraja.safaricom.co.ke" target="_blank" rel="noopener noreferrer" className="font-semibold underline inline-flex items-center gap-0.5">
                      Open M-Pesa Daraja <ExternalLink className="h-3 w-3" />
                    </a>
                  </p>
                </div>
              </>
            )}
            {isProcessingMpesa && (
              <StkStatusPanel
                status={mpesaStatus}
                stkCheckoutRequestId={stkCheckoutRequestId}
                stkResultDesc={stkResultDesc}
                stkPolling={stkPolling}
                amount={finalTotal}
              />
            )}
          </div>
        )}
      </div>
    </ResponsiveDialog>
  );
}

// Inline STK status panel — used by CheckoutDialog for both MPESA and SPLIT methods
function StkStatusPanel({
  status, stkCheckoutRequestId, stkResultDesc, stkPolling, amount,
}: {
  status: 'processing' | 'success' | 'failed';
  stkCheckoutRequestId: string;
  stkResultDesc: string;
  stkPolling: boolean;
  amount: number;
}) {
  return (
    <div className="rounded-lg border overflow-hidden">
      <div className={`px-3 py-2 text-xs font-semibold flex items-center justify-between ${
        status === 'success' ? 'bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300'
        : status === 'failed' ? 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300'
        : 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300'
      }`}>
        <span className="flex items-center gap-1.5">
          {status === 'processing' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {status === 'success' && <CheckCircle className="h-3.5 w-3.5" />}
          {status === 'failed' && <AlertCircle className="h-3.5 w-3.5" />}
          {status === 'processing' ? 'STK Push Sent — Awaiting PIN' : status === 'success' ? 'Payment Confirmed' : 'Payment Failed'}
        </span>
        <span className="font-mono">{formatKES(amount)}</span>
      </div>
      <div className="p-3 space-y-2 text-xs">
        {stkCheckoutRequestId && (
          <div className="flex items-start justify-between gap-2">
            <span className="text-muted-foreground shrink-0">CheckoutRequestID:</span>
            <span className="font-mono break-all text-right">{stkCheckoutRequestId}</span>
          </div>
        )}
        {stkResultDesc && (
          <div className="flex items-start justify-between gap-2">
            <span className="text-muted-foreground shrink-0">Status:</span>
            <span className="break-words text-right">{stkResultDesc}</span>
          </div>
        )}
        {status === 'processing' && (
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-muted-foreground flex items-center gap-1">
              <RefreshCw className={`h-3 w-3 ${stkPolling ? 'animate-spin' : ''}`} />
              {stkPolling ? 'Polling Safaricom every 5s…' : 'Waiting…'}
            </span>
            <a
              href="https://daraja.safaricom.co.ke"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-primary hover:underline"
            >
              Daraja <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

// POS TAB (kept inline - core feature)

// Escape HTML special chars for safe inclusion in print-window HTML strings.
function escapeHtml(s: string | null | undefined): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function POSTab() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [mpesaPhone, setMpesaPhone] = useState('');
  const [mpesaStatus, setMpesaStatus] = useState<'idle' | 'processing' | 'success' | 'failed'>('idle');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [cashReceived, setCashReceived] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<string>('');
  const [lowStockAlertOpen, setLowStockAlertOpen] = useState(false);
  const [discountCode, setDiscountCode] = useState('');
  const [cartBadgeShake, setCartBadgeShake] = useState(false);
  const [addedItemId, setAddedItemId] = useState<string | null>(null);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const currentStoreId = useAppStore((s) => s.currentStoreId);

  // Add Customer dialog state
  const [addCustomerOpen, setAddCustomerOpen] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [newCustomerEmail, setNewCustomerEmail] = useState('');
  const [newCustomerDebtLimit, setNewCustomerDebtLimit] = useState('');

  // Gift card / Voucher state
  const [appliedGiftCardId, setAppliedGiftCardId] = useState<string>('');
  const [appliedVoucherId, setAppliedVoucherId] = useState<string>('');
  const [benefitsExpanded, setBenefitsExpanded] = useState<boolean>(true);

  // Cart-level flat discount (Ksh) input + Pay-with-Gift-Card dialog
  const [cartDiscountInput, setCartDiscountInput] = useState<string>('');
  const [payWithGiftCardOpen, setPayWithGiftCardOpen] = useState(false);
  const [giftCardPayCode, setGiftCardPayCode] = useState('');

  // View mode & sorting
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [sortField, setSortField] = useState<'name' | 'price' | 'stock' | 'category'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Cart item notes
  const [cartNotes, setCartNotes] = useState<Record<string, string>>({});

  // Confetti trigger
  const [confettiActive, setConfettiActive] = useState(false);

  // Split payment
  const [splitCashAmount, setSplitCashAmount] = useState('');
  const [splitMpesaAmount, setSplitMpesaAmount] = useState('');

  // M-Pesa Daraja STK Push state
  const [stkCheckoutRequestId, setStkCheckoutRequestId] = useState<string>('');
  const [stkPolling, setStkPolling] = useState<boolean>(false);
  const [stkResultDesc, setStkResultDesc] = useState<string>('');
  const stkPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Receipt send via WhatsApp state
  const [receiptSendOpen, setReceiptSendOpen] = useState(false);
  const [receiptSendPhone, setReceiptSendPhone] = useState('');
  const [receiptSending, setReceiptSending] = useState(false);

  // Sell-More recommendations collapse
  const [recommendationsOpen, setRecommendationsOpen] = useState(true);

  // ── Offline-first POS state ──
  // Tracks live browser connectivity so the cashier sees an "Offline" badge
  // and the checkout mutation knows to enqueue the sale locally instead of
  // attempting a doomed network request.
  const [isOnline, setIsOnline] = useState(true);
  // Pending offline-sales count (reactive via useSyncExternalStore).
  const offlineQueueCount = useSyncExternalStore(
    subscribeOfflineCount,
    getOfflineCountSnapshot,
    () => 0, // SSR snapshot — no queue on the server
  );
  const [isSyncing, setIsSyncing] = useState(false);

  const authUser = useAuthStore((s) => s.user);
  const cart = useCartStore();
  const subtotal = cart.getSubtotal();
  const tax = cart.getTax();
  // Pre-discount total (subtotal + tax). Used as the base for gift card /
  // voucher discount math so we don't double-count the cart-level discount.
  const preDiscountTotal = subtotal + tax;
  // Cart total after the cashier's flat discount has been applied.
  const total = cart.getTotal();

  // Listen for keyboard shortcut events from MainApp
  useEffect(() => {
    const handleCheckout = () => {
      if (cart.items.length > 0) setCheckoutOpen(true);
    };
    const handleHoldCart = () => { holdCart(); };
    window.addEventListener('pos-checkout', handleCheckout);
    window.addEventListener('pos-hold-cart', handleHoldCart);
    return () => {
      window.removeEventListener('pos-checkout', handleCheckout);
      window.removeEventListener('pos-hold-cart', handleHoldCart);
    };
  }, [cart.items.length]);

  // ── Offline-first POS: connectivity tracking + auto-sync ──
  // On mount: prime the cached queue count, register the online/offline
  // window listeners (which auto-fire syncQueue when connectivity returns),
  // and subscribe to background-sync results so we can toast the cashier.
  useEffect(() => {
    // Initialise connectivity from the live navigator value (handles the case
    // where the app was launched while already offline).
    if (typeof navigator !== 'undefined') {
      setIsOnline(navigator.onLine);
    }

    primeOfflineCount().catch(() => { /* non-fatal */ });
    const cleanupSync = initOfflineSync();

    const handleOnline = () => {
      setIsOnline(true);
      toast.success('Back online — syncing queued sales…', { duration: 3000 });
    };
    const handleOffline = () => {
      setIsOnline(false);
      toast.warning('You are offline. Sales will be saved locally and synced automatically.', {
        duration: 5000,
      });
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Toast the result of each automatic background sync.
    const unsubSync = onBackgroundSync((result) => {
      if (result.succeeded > 0) {
        toast.success(`Synced ${result.succeeded} offline sale${result.succeeded !== 1 ? 's' : ''} to the server.`, {
          duration: 4000,
        });
      }
      if (result.failed > 0) {
        toast.error(`${result.failed} sale${result.failed !== 1 ? 's' : ''} failed to sync and will retry.`, {
          duration: 5000,
        });
      }
    });

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      cleanupSync();
      unsubSync();
    };
  }, []);

  // Manual "Sync now" handler — triggered by the offline badge button.
  const handleManualSync = useCallback(async () => {
    if (isSyncing || offlineQueueCount === 0) return;
    setIsSyncing(true);
    try {
      const result = await syncQueue();
      if (result.succeeded > 0) {
        toast.success(`Synced ${result.succeeded} sale${result.succeeded !== 1 ? 's' : ''}.`);
      }
      if (result.failed > 0) {
        toast.error(`${result.failed} sale${result.failed !== 1 ? 's' : ''} still pending (will retry automatically).`);
      }
      if (result.attempted === 0) {
        toast.info('No queued sales to sync.');
      }
    } catch {
      toast.error('Sync failed — please check your connection and try again.');
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, offlineQueueCount]);

  const { data: productsData, isLoading: productsLoading } = useQuery({
    queryKey: ['products', currentStoreId, searchQuery, selectedCategory],
    queryFn: async () => {
      const res = await productsApi.list({
        storeId: currentStoreId,
        search: searchQuery || undefined,
        limit: 100,
        ...(selectedCategory !== 'all' ? { categoryId: selectedCategory } : {}),
      });
      return Array.isArray(res.data) ? res : { ...res, data: [] };
    },
  });

  const { data: categoriesData } = useQuery({
    queryKey: ['categories', currentStoreId],
    queryFn: async () => {
      const res = await categoriesApi.list(currentStoreId);
      return Array.isArray(res.data) ? res : { ...res, data: [] };
    },
  });

  const { data: customersData } = useQuery({
    queryKey: ['customers', currentStoreId],
    queryFn: async () => {
      const res = await customersApi.list({ storeId: currentStoreId, limit: 100 });
      return Array.isArray(res.data) ? res : { ...res, data: [] };
    },
  });

  // Auto-fetch active gift cards for selected customer
  const { data: customerGiftCardsData } = useQuery({
    queryKey: ['customer-gift-cards', currentStoreId, selectedCustomer],
    queryFn: async () => {
      if (!selectedCustomer || selectedCustomer === 'walk-in') return { data: [] };
      const res = await giftCardsApi.list({ storeId: currentStoreId, status: 'ACTIVE' });
      const allCards = Array.isArray(res.data) ? res.data : [];
      // Filter to cards belonging to the selected customer
      const customerCards = allCards.filter((gc: GiftCardItem) => gc.customerId === selectedCustomer || gc.recipientPhone === customers.find((c: CustomerItem) => c.id === selectedCustomer)?.phone);
      return { data: customerCards };
    },
    enabled: !!selectedCustomer && selectedCustomer !== 'walk-in',
    refetchInterval: 30000, // Auto-refresh every 30s to keep balances current
  });

  // Auto-fetch active vouchers for selected customer
  const { data: customerVouchersData } = useQuery({
    queryKey: ['customer-vouchers', currentStoreId, selectedCustomer],
    queryFn: async () => {
      if (!selectedCustomer || selectedCustomer === 'walk-in') return { data: [] };
      const res = await vouchersApi.list({ storeId: currentStoreId, status: 'ACTIVE' });
      const allVouchers = Array.isArray(res.data) ? res.data : [];
      return { data: allVouchers };
    },
    enabled: !!selectedCustomer && selectedCustomer !== 'walk-in',
    refetchInterval: 30000, // Auto-refresh every 30s to keep voucher status current
  });

  // Create customer mutation
  const createCustomerMutation = useMutation({
    mutationFn: (data: { storeId: string; name: string; phone?: string; email?: string; debtLimit?: number }) =>
      customersApi.create(data),
    onSuccess: (res) => {
      toast.success('Customer created successfully!');
      if (res.data) {
        setSelectedCustomer(res.data.id);
      }
      setAddCustomerOpen(false);
      setNewCustomerName('');
      setNewCustomerPhone('');
      setNewCustomerEmail('');
      setNewCustomerDebtLimit('');
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to create customer');
    },
  });

  const queryClient = useQueryClient();

  const [receiptOpen, setReceiptOpen] = useState(false);
  const [lastTransaction, setLastTransaction] = useState<TransactionItem | null>(null);
  const [lastCashReceived, setLastCashReceived] = useState(0);
  const [lastMpesaPhone, setLastMpesaPhone] = useState('');

  const checkoutMutation = useMutation({
    mutationFn: async (payload: CheckoutPayload) => {
      console.log('[MUTATION-FN] checkoutMutation.mutationFn CALLED, payload items=', payload?.items?.length);
      // ── Offline-first checkout ──
      // If the browser is known to be offline, skip the doomed network
      // request entirely and persist the sale to the IndexedDB queue. The
      // cashier gets an immediate synthetic receipt (with a client-generated
      // receipt number) so the customer can be handed paper proof right away.
      // The real server-side transaction is created when syncQueue() replays
      // the payload after connectivity returns.
      const currentlyOnline =
        typeof navigator === 'undefined' ? true : navigator.onLine;

      if (!currentlyOnline) {
        const row = await saveOfflineTransaction(payload);
        if (row) {
          const synthetic = buildOfflineReceipt(row, authUser?.name || 'Cashier');
          toast.warning('Offline Mode: Sale saved locally and will sync automatically.', {
            duration: 5000,
          });
          return { success: true, data: synthetic };
        }
        // If IndexedDB is unavailable for some reason, fall through to the
        // network attempt (which will fail and surface a real error).
      }

      try {
        return await transactionsApi.create(payload);
      } catch (err) {
        // Network-layer failure while "online" (e.g. DNS down, server
        // unreachable, connection dropped mid-request). `fetch` throws a
        // TypeError for these — distinguish from a genuine server-side 4xx/5xx
        // error (which `request()` rejects with a real Error carrying the
        // server message).
        const isNetworkError =
          err instanceof TypeError ||
          (err instanceof Error && /fetch|network|failed to fetch/i.test(err.message));

        if (isNetworkError) {
          const row = await saveOfflineTransaction(payload);
          if (row) {
            const synthetic = buildOfflineReceipt(row, authUser?.name || 'Cashier');
            toast.warning('Network error — Sale saved locally and will sync automatically.', {
              duration: 5000,
            });
            return { success: true, data: synthetic };
          }
        }
        // Genuine server error (4xx/5xx) or queue failure — surface to onError.
        throw err;
      }
    },
    onSuccess: (res) => {
      // Detect offline-queued sales via the PENDING_SYNC sentinel so we show
      // the correct messaging (the receipt is still rendered for the cashier).
      const wasOffline = res.data?.paymentStatus === 'PENDING_SYNC';
      if (wasOffline) {
        setConfettiActive(true);
        setTimeout(() => setConfettiActive(false), 4000);
      } else {
        toast.success('Transaction completed successfully!');
        setConfettiActive(true);
        setTimeout(() => setConfettiActive(false), 4000);
      }
      if (res.data) {
        setLastTransaction(res.data);
        setLastCashReceived(paymentMethod === 'CASH' || paymentMethod === 'SPLIT' ? Number(splitCashAmount) || Number(cashReceived) || finalTotal : 0);
        setLastMpesaPhone(mpesaPhone);
        setReceiptOpen(true);
      }
      cart.clearCart();
      setCartNotes({});
      setCartDiscountInput('');
      setCheckoutOpen(false);
      setCashReceived('');
      setSplitCashAmount('');
      setSplitMpesaAmount('');
      setSelectedCustomer('');
      setAppliedGiftCardId('');
      setAppliedVoucherId('');
      setMpesaStatus('idle');
      setStkCheckoutRequestId('');
      setStkResultDesc('');
      setStkPolling(false);
      // Invalidate gift card and voucher queries so balances/status refresh
      queryClient.invalidateQueries({ queryKey: ['customer-gift-cards'] });
      queryClient.invalidateQueries({ queryKey: ['customer-vouchers'] });
      queryClient.invalidateQueries({ queryKey: ['giftCards'] });
      queryClient.invalidateQueries({ queryKey: ['vouchers'] });
      // Offline sales don't hit the server immediately, so the dashboard /
      // transactions lists won't reflect them yet — skip invalidating those
      // (they'll refresh naturally when syncQueue completes).
    },
    onError: (err: unknown) => {
      toast.error(handleError(err, 'Checkout'));
    },
  });

  // M-Pesa Daraja STK Push mutation — uses paymentsApi.darajaStk if available, falls back to direct fetch
  const mpesaMutation = useMutation({
    mutationFn: async (data: { phoneNumber: string; amount: number; accountReference: string; transactionDesc: string }) => {
      // Prefer the typed client method if BE-1 added it
      const anyPayments = paymentsApi as unknown as {
        darajaStk?: (data: { phoneNumber: string; amount: number; accountReference: string; transactionDesc: string }) => Promise<{ data?: { checkoutRequestId?: string; CheckoutRequestID?: string; ResponseCode?: string; ResponseDescription?: string; resultCode?: string; resultDesc?: string } }>;
      };
      if (typeof anyPayments.darajaStk === 'function') {
        return anyPayments.darajaStk(data);
      }
      // Fallback: direct fetch to the Daraja STK endpoint
      const res = await fetch('/api/payments/mpesa/daraja-stk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(data),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error || json?.message || `Daraja STK push failed (HTTP ${res.status})`);
      }
      return { data: json?.data ?? json };
    },
    onSuccess: (res) => {
      const data = res?.data || (res as { data?: unknown } | undefined);
      const crId = (data as { checkoutRequestId?: string; CheckoutRequestID?: string } | undefined)?.checkoutRequestId
        || (data as { CheckoutRequestID?: string } | undefined)?.CheckoutRequestID
        || '';
      setStkCheckoutRequestId(crId);
      setMpesaStatus('processing');
      setStkResultDesc((data as { ResponseDescription?: string; resultDesc?: string } | undefined)?.ResponseDescription
        || (data as { resultDesc?: string } | undefined)?.resultDesc
        || 'STK push sent. Awaiting customer PIN entry.');
      toast.success('STK push sent to customer phone');
      // Begin polling status
      startStkPolling(crId);
    },
    onError: (err: unknown) => {
      setMpesaStatus('failed');
      toast.error(handleError(err, 'M-Pesa STK Push'));
    },
  });

  // Poll Daraja STK status — uses paymentsApi.checkStkStatus if available, falls back to direct fetch
  const startStkPolling = useCallback((checkoutRequestId: string) => {
    if (stkPollRef.current) clearInterval(stkPollRef.current);
    if (!checkoutRequestId) return;
    setStkPolling(true);
    let attempts = 0;
    stkPollRef.current = setInterval(async () => {
      attempts += 1;
      try {
        const anyPayments = paymentsApi as unknown as {
          checkStkStatus?: (id: string) => Promise<{ data?: { status?: string; resultCode?: string; resultDesc?: string; mpesaReceiptNumber?: string } }>;
        };
        let result: { status?: string; resultCode?: string; resultDesc?: string; mpesaReceiptNumber?: string } | undefined;
        if (typeof anyPayments.checkStkStatus === 'function') {
          const r = await anyPayments.checkStkStatus(checkoutRequestId);
          result = r?.data;
        } else {
          const res = await fetch(`/api/payments/mpesa/status/${encodeURIComponent(checkoutRequestId)}`, { credentials: 'same-origin' });
          const json = await res.json().catch(() => ({}));
          result = json?.data ?? json;
        }
        if (!result) return;
        const status = (result.status || '').toString().toUpperCase();
        const code = (result.resultCode || '').toString();
        if (status === 'COMPLETED' || status === 'SUCCESS' || code === '0') {
          clearStkPolling();
          setStkPolling(false);
          setMpesaStatus('success');
          setStkResultDesc(result.resultDesc || 'Payment confirmed.');
          toast.success('M-Pesa payment confirmed');
        } else if (status === 'FAILED' || status === 'CANCELLED' || (code && code !== '0')) {
          clearStkPolling();
          setStkPolling(false);
          setMpesaStatus('failed');
          setStkResultDesc(result.resultDesc || 'Payment failed or cancelled.');
        }
      } catch (err) {
        // Network blip — keep polling unless too many attempts
        console.warn('STK status poll error', err);
      }
      if (attempts >= 60) { // ~5 min @ 5s interval
        clearStkPolling();
        setStkPolling(false);
        setMpesaStatus('failed');
        setStkResultDesc('Timed out waiting for M-Pesa confirmation.');
      }
    }, 5000);
  }, []);

  const clearStkPolling = useCallback(() => {
    if (stkPollRef.current) {
      clearInterval(stkPollRef.current);
      stkPollRef.current = null;
    }
  }, []);

  // Cleanup polling on unmount
  useEffect(() => () => clearStkPolling(), [clearStkPolling]);

  // Sell-More: Frequently Bought Together recommendations
  const cartProductIds = useMemo(() => cart.items.map((i) => i.productId), [cart.items]);
  const { data: recommendationsData, isLoading: recommendationsLoading } = useQuery({
    queryKey: ['pos-recommendations', currentStoreId, cartProductIds.join(',')],
    queryFn: async () => {
      // Prefer the typed client method if BE-1 added it
      type RecommendationsApiShape = {
        recommendationsApi?: {
          frequentlyBought: (params: { productIds: string[]; storeId: string }) => Promise<{ data?: Array<{ product?: ProductListItem; productId?: string; productName?: string; pricePerUnit?: number; coOccurrence?: number; count?: number; imageUrl?: string; unitType?: string }> }>;
        };
      };
      const apiModule: RecommendationsApiShape = await import('@/lib/api') as unknown as RecommendationsApiShape;
      if (typeof apiModule.recommendationsApi?.frequentlyBought === 'function') {
        try {
          return await apiModule.recommendationsApi.frequentlyBought({ productIds: cartProductIds, storeId: currentStoreId });
        } catch {
          // fall back to fetch
        }
      }
      const url = `/api/recommendations/frequently-bought?storeId=${encodeURIComponent(currentStoreId)}&${cartProductIds.map((id) => `productId=${encodeURIComponent(id)}`).join('&')}`;
      const res = await fetch(url, { credentials: 'same-origin' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `Failed to load recommendations (HTTP ${res.status})`);
      return { data: Array.isArray(json?.data) ? json.data : (Array.isArray(json) ? json : []) };
    },
    enabled: cartProductIds.length > 0,
    staleTime: 30_000,
    retry: false,
  });

  const recommendations: Array<{ product?: ProductListItem; productId?: string; productName?: string; pricePerUnit?: number; coOccurrence?: number; count?: number; imageUrl?: string; unitType?: string; quantityInStock?: number }> =
    Array.isArray(recommendationsData?.data) ? (recommendationsData!.data as Array<{ product?: ProductListItem; productId?: string; productName?: string; pricePerUnit?: number; coOccurrence?: number; count?: number; imageUrl?: string; unitType?: string; quantityInStock?: number }>) : [];

  // Filter out products already in cart & out-of-stock recommendations
  const visibleRecommendations = useMemo(() => {
    return recommendations
      .filter((r) => {
        const id = r.product?.id || r.productId;
        if (!id) return false;
        if (cartProductIds.includes(id)) return false;
        const stock = r.product?.quantityInStock ?? r.quantityInStock ?? 0;
        if (stock <= 0) return false;
        return true;
      })
      .slice(0, 8);
  }, [recommendations, cartProductIds]);

  const handleAddRecommendation = (rec: { product?: ProductListItem; productId?: string; productName?: string; pricePerUnit?: number; imageUrl?: string; unitType?: string; quantityInStock?: number }) => {
    // If a full product is provided, use it; otherwise synthesise a minimal item
    if (rec.product) {
      handleAddToCart(rec.product);
      return;
    }
    // Fallback: try to find it in the loaded products list, else show a toast
    const match = products.find((p) => p.id === rec.productId);
    if (match) {
      handleAddToCart(match);
    } else {
      toast.error(`Could not add "${rec.productName || 'product'}" — try refreshing the catalog.`);
    }
  };

  const products = Array.isArray(productsData?.data) ? productsData.data : [];
  const categories = Array.isArray(categoriesData?.data) ? categoriesData.data : [];
  const customers = Array.isArray(customersData?.data) ? customersData.data : [];
  const customerGiftCards: GiftCardItem[] = Array.isArray(customerGiftCardsData?.data) ? customerGiftCardsData.data : [];
  const customerVouchers: VoucherItem[] = Array.isArray(customerVouchersData?.data) ? customerVouchersData.data : [];

  // Auto-apply highest value gift card/voucher when customer is selected
  useEffect(() => {
    if (!selectedCustomer || selectedCustomer === 'walk-in') {
      setAppliedGiftCardId('');
      setAppliedVoucherId('');
      return;
    }
    // Auto-select highest value gift card
    if (Array.isArray(customerGiftCards) && customerGiftCards.length > 0 && !appliedGiftCardId) {
      const highestGc = customerGiftCards.reduce((best, gc) =>
        gc.currentBalance > best.currentBalance ? gc : best, customerGiftCards[0]);
      setAppliedGiftCardId(highestGc.id);
    }
    // Auto-select highest value voucher
    if (Array.isArray(customerVouchers) && customerVouchers.length > 0 && !appliedVoucherId) {
      const highestV = customerVouchers.reduce((best, v) => {
        const bestVal = best.voucherType === 'PERCENTAGE' ? best.value : best.value;
        const vVal = v.voucherType === 'PERCENTAGE' ? v.value : v.value;
        return vVal > bestVal ? v : best;
      }, customerVouchers[0]);
      setAppliedVoucherId(highestV.id);
    }
  }, [selectedCustomer, customerGiftCards.length, customerVouchers.length]);

  // Gift card / voucher discount computation (caps against the pre-discount total)
  const selectedGiftCard = appliedGiftCardId ? customerGiftCards.find(gc => gc.id === appliedGiftCardId) : null;
  const selectedVoucher = appliedVoucherId ? customerVouchers.find(v => v.id === appliedVoucherId) : null;
  const giftCardDiscount = selectedGiftCard ? Math.min(selectedGiftCard.currentBalance, preDiscountTotal) : 0;
  const voucherDiscount = selectedVoucher
    ? selectedVoucher.voucherType === 'FIXED'
      ? Math.min(selectedVoucher.value, preDiscountTotal)
      : selectedVoucher.voucherType === 'PERCENTAGE'
        ? Math.min(preDiscountTotal * (selectedVoucher.value / 100), selectedVoucher.maxDiscount || preDiscountTotal)
        : 0
    : 0;
  // Cart-level flat discount (Ksh) set by the cashier via the cart footer input.
  // ISO 9001: totalDiscount is the sum of all contra-revenue adjustments.
  const cartDiscount = cart.discount;
  const totalDiscount = giftCardDiscount + voucherDiscount + cartDiscount;
  const finalTotal = Math.max(0, preDiscountTotal - totalDiscount);

  const handleAddToCart = (product: ProductListItem, qty?: number) => {
    if (product.quantityInStock <= 0 && !product.isRental) {
      toast.error('Product is out of stock');
      return;
    }
    const existingItem = cart.items.find(i => i.productId === product.id);
    if (existingItem && qty !== undefined) {
      // Update quantity directly from Quick Add popup
      cart.updateQuantity(product.id, qty);
    } else {
      cart.addItem({
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        quantity: qty ?? 1,
        unitType: product.unitType as UnitType,
        pricePerUnit: product.pricePerUnit,
        costPrice: product.costPrice,
        discountPercent: 0,
        taxRate: product.taxRate,
        isRentalItem: product.isRental,
        isBundle: product.isBundle,
      });
    }
    // Trigger animations
    setAddedItemId(product.id);
    setCartBadgeShake(true);
    setTimeout(() => { setAddedItemId(null); setCartBadgeShake(false); }, 500);
    toast.success(`${product.name} added to cart`);
  };

  // Hold/Recall cart functionality
  const holdCart = () => {
    if (cart.items.length === 0) {
      toast.error('Cart is empty - nothing to hold');
      return;
    }
    const heldCarts = JSON.parse(localStorage.getItem('mbt_held_carts') || '[]');
    const holdId = `hold_${Date.now()}`;
    heldCarts.push({ id: holdId, items: cart.items, customer: selectedCustomer, notes: cartNotes, timestamp: new Date().toISOString() });
    localStorage.setItem('mbt_held_carts', JSON.stringify(heldCarts));
    cart.clearCart();
    setCartNotes({});
    setCartDiscountInput('');
    setSelectedCustomer('');
    toast.success('Cart held successfully');
  };

  const recallCart = () => {
    const heldCarts = JSON.parse(localStorage.getItem('mbt_held_carts') || '[]');
    if (heldCarts.length === 0) {
      toast.info('No held carts to recall');
      return;
    }
    const lastHeld = heldCarts.pop();
    if (lastHeld && lastHeld.items) {
      // Clear current cart first
      cart.clearCart();
      setCartNotes({});
      // Add all items from held cart
      lastHeld.items.forEach((item: CartItem) => {
        cart.addItem({
          productId: item.productId,
          productName: item.productName,
          sku: item.sku,
          quantity: item.quantity,
          unitType: item.unitType,
          pricePerUnit: item.pricePerUnit,
          costPrice: item.costPrice,
          discountPercent: item.discountPercent,
          taxRate: item.taxRate,
          isRentalItem: item.isRentalItem,
          isBundle: item.isBundle,
        });
      });
      if (lastHeld.customer) setSelectedCustomer(lastHeld.customer);
      if (lastHeld.notes) setCartNotes(lastHeld.notes);
      localStorage.setItem('mbt_held_carts', JSON.stringify(heldCarts));
      toast.success('Cart recalled successfully');
    }
  };

  const heldCartCount = (() => {
    try {
      return JSON.parse(localStorage.getItem('mbt_held_carts') || '[]').length;
    } catch { return 0; }
  })();

  const applyDiscountCode = () => {
    if (!discountCode.trim()) {
      toast.error('Enter a discount code');
      return;
    }
    // Simple discount code validation for demo
    const validCodes: Record<string, number> = {
      'SAVE10': 10,
      'SAVE20': 20,
      'MBUMAH': 15,
      'HARDWARE': 5,
    };
    const discount = validCodes[discountCode.toUpperCase()];
    if (discount) {
      cart.items.forEach((item) => {
        if (item.discountPercent === 0) {
          cart.applyDiscount(item.productId, discount);
        }
      });
      toast.success(`${discount}% discount applied!`);
      setDiscountCode('');
    } else {
      toast.error('Invalid discount code. Try: SAVE10, SAVE20, MBUMAH, or HARDWARE');
    }
  };

  const handleCheckout = () => {
    console.log('[HANDLE-CHECKOUT] called, online=', navigator.onLine, 'items=', cart.items.length);
    if (cart.items.length === 0) {
      toast.error('Cart is empty');
      return;
    }

    // For MPESA-only, the STK push must have been confirmed first
    if (paymentMethod === 'MPESA' && mpesaStatus !== 'success') {
      toast.error('Send the STK push and wait for confirmation before completing the sale.');
      return;
    }

    if (paymentMethod === 'SPLIT') {
      const cashAmt = Number(splitCashAmount) || 0;
      const mpesaAmt = Number(splitMpesaAmount) || 0;
      if (cashAmt + mpesaAmt < finalTotal) {
        toast.error('Split amounts must equal or exceed total');
        return;
      }
      // If there's an M-Pesa portion, the STK push must have been confirmed
      if (mpesaAmt > 0 && mpesaStatus !== 'success') {
        toast.error('Send the M-Pesa STK push for the split portion and wait for confirmation.');
        return;
      }
    }

    if (paymentMethod === 'DEBT') {
      if (!selectedCustomer || selectedCustomer === 'walk-in') {
        toast.error('Select a customer to put the sale on their debt account');
        return;
      }
      const cust = customers.find((c) => c.id === selectedCustomer);
      if (cust && finalTotal > (cust.debtLimit - cust.currentDebtBalance)) {
        toast.error('Sale exceeds the customer\'s available debt limit');
        return;
      }
    }

    console.log('[HANDLE-CHECKOUT] about to call checkoutMutation.mutate()');
    checkoutMutation.mutate({
      storeId: currentStoreId,
      customerId: selectedCustomer || undefined,
      cashierId: useAuthStore.getState().user?.id || '',
      items: cart.items,
      paymentMethod,
      // Cart-level flat discount (from the discount input in the cart footer).
      // This is separate from line-level discounts (which are baked into each
      // item's discountPercent) and from gift-card / voucher redemptions
      // (which are handled as payment-method side effects). The API subtracts
      // this from the pre-discount total and routes it to the SALES_DISCOUNTS
      // contra-revenue account in the journal entry.
      discountAmount: cartDiscount || undefined,
      paymentDetails: {
        cashAmount: paymentMethod === 'CASH' ? Number(cashReceived) || finalTotal : paymentMethod === 'SPLIT' ? Number(splitCashAmount) || 0 : undefined,
        mpesaPhone: (paymentMethod === 'MPESA' || paymentMethod === 'SPLIT') ? mpesaPhone : undefined,
        debtAccountId: paymentMethod === 'DEBT' ? selectedCustomer : undefined,
        giftCardId: appliedGiftCardId || undefined,
        giftCardCode: paymentMethod === 'GIFT_CARD' ? giftCardPayCode || undefined : undefined,
        voucherId: appliedVoucherId || undefined,
      },
    });
  };

  const handleMpesaPay = () => {
    if (!mpesaPhone || mpesaPhone.length < 9) {
      toast.error('Enter a valid phone number');
      return;
    }
    // For SPLIT, use the M-Pesa portion amount; for MPESA, use finalTotal
    const amount = paymentMethod === 'SPLIT' ? (Number(splitMpesaAmount) || 0) : finalTotal;
    if (amount <= 0) {
      toast.error('Enter an M-Pesa amount greater than zero');
      return;
    }
    mpesaMutation.mutate({
      phoneNumber: mpesaPhone.startsWith('0') ? `254${mpesaPhone.slice(1)}` : mpesaPhone,
      amount,
      accountReference: `MBT-${Date.now()}`,
      transactionDesc: 'MBUMAH HARDWARE Purchase',
    });
  };

  // Send receipt via WhatsApp — uses whatsappApi.sendDocument with a fetch fallback
  const handleSendReceiptWhatsApp = async () => {
    if (!lastTransaction) return;
    if (!receiptSendPhone || receiptSendPhone.length < 9) {
      toast.error('Enter a valid WhatsApp phone number');
      return;
    }
    setReceiptSending(true);
    try {
      const phone = receiptSendPhone.startsWith('0') ? `254${receiptSendPhone.slice(1)}` : receiptSendPhone;
      let result: { waLink?: string; phone?: string; message?: string; documentTitle?: string } | undefined;
      try {
        const r = await whatsappApi.sendDocument({
          type: 'receipt',
          documentId: lastTransaction.id,
          storeId: currentStoreId,
          phone,
        });
        result = r?.data;
      } catch (e) {
        // Fall back to direct fetch
        const res = await fetch('/api/whatsapp/send-document', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ type: 'receipt', documentId: lastTransaction.id, storeId: currentStoreId, phone }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || json?.message || `HTTP ${res.status}`);
        result = json?.data ?? json;
      }
      const waLink = result?.waLink;
      toast.success('Receipt prepared for WhatsApp');
      if (waLink) {
        window.open(waLink, '_blank', 'noopener,noreferrer');
      } else {
        // Fallback: deep link
        const msg = `Hello, your receipt for ${formatKES(lastTransaction.totalAmount)} from MBUMAH HARDWARE (Receipt #${lastTransaction.receiptNumber}) is ready. Thank you for shopping with us!`;
        const normalized = phone.startsWith('+') ? phone.slice(1) : phone;
        window.open(`https://wa.me/${normalized}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener,noreferrer');
      }
      setReceiptSendOpen(false);
    } catch (err) {
      toast.error(handleError(err, 'Send receipt via WhatsApp'));
    } finally {
      setReceiptSending(false);
    }
  };

  // Print receipt — opens a new window with a clean printable layout
  const handlePrintReceipt = () => {
    if (!lastTransaction) return;
    const store = STORE_LIST.find((s) => s.id === currentStoreId);
    const itemsHtml = (lastTransaction.items || []).map((item) => `
      <tr>
        <td class="name">${escapeHtml(item.productName)}</td>
        <td class="qty">${item.quantity}</td>
        <td class="unit">${item.unitType}</td>
        <td class="price">${formatKES(item.pricePerUnit ?? 0)}</td>
        <td class="total">${formatKES(item.lineTotal)}</td>
      </tr>
    `).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt ${escapeHtml(lastTransaction.receiptNumber)}</title>
      <style>
        * { box-sizing: border-box; }
        body { font-family: 'Courier New', monospace; padding: 12px; max-width: 320px; margin: 0 auto; color: #000; }
        h1, h2, h3, p { margin: 0; }
        .center { text-align: center; }
        .store-name { font-size: 18px; font-weight: bold; letter-spacing: 1px; margin-bottom: 2px; }
        .store-info { font-size: 11px; color: #444; }
        .meta { font-size: 11px; margin: 8px 0; }
        .meta-row { display: flex; justify-content: space-between; }
        hr { border: none; border-top: 1px dashed #000; margin: 8px 0; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        th { text-align: left; font-size: 10px; text-transform: uppercase; padding: 2px 0; border-bottom: 1px solid #000; }
        td { padding: 2px 0; vertical-align: top; }
        td.name { width: 45%; }
        td.qty, td.unit { text-align: center; width: 12%; }
        td.price { text-align: right; width: 15%; }
        td.total { text-align: right; width: 16%; font-weight: bold; }
        .totals { font-size: 12px; margin: 8px 0; }
        .totals .meta-row { padding: 1px 0; }
        .totals .grand { font-size: 14px; font-weight: bold; padding-top: 4px; }
        .footer { text-align: center; margin-top: 12px; font-size: 11px; }
        @media print { body { padding: 0; } }
      </style></head><body>
      <div class="center">
        <div class="store-name">MBUMAH HARDWARE</div>
        <div class="store-info">${escapeHtml(store?.shortName || 'Juja Main Branch')}</div>
        <div class="store-info">${escapeHtml(store?.location || '')}</div>
        <div class="store-info">Tel: ${escapeHtml(store?.phone || '+254 700 123 456')}</div>
      </div>
      <hr/>
      <div class="meta">
        <div class="meta-row"><span>Receipt #:</span><strong>${escapeHtml(lastTransaction.receiptNumber)}</strong></div>
        <div class="meta-row"><span>Date:</span><span>${escapeHtml(formatDateTime(lastTransaction.createdAt))}</span></div>
        <div class="meta-row"><span>Cashier:</span><span>${escapeHtml(lastTransaction.cashier?.name || useAuthStore.getState().user?.name || 'N/A')}</span></div>
        <div class="meta-row"><span>Customer:</span><span>${escapeHtml(lastTransaction.customer?.name || 'Walk-in')}</span></div>
      </div>
      <hr/>
      <table>
        <thead><tr><th>Item</th><th class="qty">Qty</th><th class="unit">Unit</th><th class="price">Price</th><th class="total">Total</th></tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <hr/>
      <div class="totals">
        <div class="meta-row"><span>Subtotal</span><span>${formatKES(lastTransaction.subtotal)}</span></div>
        <div class="meta-row"><span>VAT (16%)</span><span>${formatKES(lastTransaction.taxAmount)}</span></div>
        ${lastTransaction.discountAmount > 0 ? `<div class="meta-row"><span>Discount</span><span>-${formatKES(lastTransaction.discountAmount)}</span></div>` : ''}
        <div class="meta-row grand"><span>TOTAL</span><span>${formatKES(lastTransaction.totalAmount)}</span></div>
      </div>
      <hr/>
      <div class="meta">
        <div class="meta-row"><span>Payment</span><span>${escapeHtml(lastTransaction.paymentMethod)}</span></div>
        ${lastTransaction.paymentMethod === 'CASH' && lastCashReceived > 0 ? `<div class="meta-row"><span>Cash Received</span><span>${formatKES(lastCashReceived)}</span></div>` : ''}
        ${lastTransaction.paymentMethod === 'CASH' && (lastCashReceived - lastTransaction.totalAmount) > 0 ? `<div class="meta-row"><span>Change</span><span>${formatKES(lastCashReceived - lastTransaction.totalAmount)}</span></div>` : ''}
        ${lastTransaction.paymentMethod === 'MPESA' && lastMpesaPhone ? `<div class="meta-row"><span>M-Pesa Phone</span><span>${escapeHtml(lastMpesaPhone)}</span></div>` : ''}
      </div>
      <div class="footer">
        <p><strong>Thank you for shopping at MBUMAH HARDWARE!</strong></p>
        <p>Asante sana!</p>
      </div>
      <script>window.onload = function() { window.print(); }</script>
      </body></html>`;
    const printWindow = window.open('', '_blank', 'width=400,height=600');
    if (printWindow) {
      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
    } else {
      // Popup blocked — fall back to inline print
      window.print();
    }
  };

  const change = paymentMethod === 'CASH' && cashReceived ? Number(cashReceived) - finalTotal : 0;

  // Sorted products
  const sortedProducts = useMemo(() => {
    const sorted = [...products].sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'name': comparison = a.name.localeCompare(b.name); break;
        case 'price': comparison = a.pricePerUnit - b.pricePerUnit; break;
        case 'stock': comparison = a.quantityInStock - b.quantityInStock; break;
        case 'category': comparison = (a.category?.name || '').localeCompare(b.category?.name || ''); break;
      }
      return sortOrder === 'desc' ? -comparison : comparison;
    });
    return sorted;
  }, [products, sortField, sortOrder]);

  // Auto-adjust grid columns based on number of products visible:
  //  - Very few (≤8): fewer cols, bigger cards
  //  - Medium (9–24): standard grid
  //  - Many (>24): denser grid
  const gridColsClass = useMemo(() => {
    const n = sortedProducts.length;
    if (n <= 8) return 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4';
    if (n <= 24) return 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3';
    return 'grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2.5';
  }, [sortedProducts.length]);

  // Cart note handler
  const handleCartNoteChange = (productId: string, note: string) => {
    setCartNotes(prev => ({ ...prev, [productId]: note }));
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 h-full relative">
      {/* Confetti Overlay */}
      <ConfettiOverlay active={confettiActive} />

      {/* Product Grid — Catalog (3 of 5 columns on desktop) */}
      <div className="col-span-1 lg:col-span-3 min-w-0 space-y-4">
        {/* ── Online / Offline status indicator ──
            Shows the cashier live connectivity + the count of sales queued
            locally for sync. When offline or when there are pending sales,
            the badge becomes a button that triggers a manual sync attempt. */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div
            role="status"
            aria-live="polite"
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              isOnline
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300'
                : 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300'
            }`}
          >
            {isOnline ? (
              <>
                <Wifi className="h-3.5 w-3.5" />
                <span>Online</span>
              </>
            ) : (
              <>
                <WifiOff className="h-3.5 w-3.5 animate-pulse" />
                <span>Offline Mode</span>
              </>
            )}
            {offlineQueueCount > 0 && (
              <span className="inline-flex items-center gap-1 ml-1 pl-2 border-l border-current/30">
                <CloudOff className="h-3 w-3" />
                <span>{offlineQueueCount} pending sync{offlineQueueCount !== 1 ? 's' : ''}</span>
              </span>
            )}
          </div>

          {offlineQueueCount > 0 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleManualSync}
              disabled={isSyncing || !isOnline}
              className="h-7 gap-1.5 text-xs"
              title={isOnline ? 'Sync queued sales to the server now' : 'Reconnect to sync queued sales'}
            >
              {isSyncing ? (
                <RefreshCw className="h-3 w-3 animate-spin" />
              ) : (
                <CloudLightning className="h-3 w-3" />
              )}
              {isSyncing ? 'Syncing…' : 'Sync now'}
            </Button>
          )}
        </div>

        {/* Dashboard Stats */}
        <DashboardStats storeId={currentStoreId} onLowStockClick={() => setLowStockAlertOpen(true)} />

        {/* Search, View Toggle, and Category Chips */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 animate-pulse-search rounded-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search products by name, SKU, or barcode..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            {/* View Mode Toggle */}
            <div className="flex items-center border rounded-md overflow-hidden shrink-0">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={`p-1.5 transition-colors ${viewMode === 'grid' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}
                title="Grid view"
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`p-1.5 transition-colors ${viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}
                title="List view"
              >
                <List className="h-4 w-4" />
              </button>
            </div>
            {/* Sort Button */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="shrink-0 h-9 w-9" title="Sort products">
                  <ArrowUpDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="text-xs">Sort by</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => { setSortField('name'); setSortOrder(sortField === 'name' && sortOrder === 'asc' ? 'desc' : 'asc'); }}>
                  Name {sortField === 'name' && (sortOrder === 'asc' ? <ArrowUp className="h-3 w-3 ml-auto" /> : <ArrowDown className="h-3 w-3 ml-auto" />)}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setSortField('price'); setSortOrder(sortField === 'price' && sortOrder === 'asc' ? 'desc' : 'asc'); }}>
                  Price {sortField === 'price' && (sortOrder === 'asc' ? <ArrowUp className="h-3 w-3 ml-auto" /> : <ArrowDown className="h-3 w-3 ml-auto" />)}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setSortField('stock'); setSortOrder(sortField === 'stock' && sortOrder === 'asc' ? 'desc' : 'asc'); }}>
                  Stock {sortField === 'stock' && (sortOrder === 'asc' ? <ArrowUp className="h-3 w-3 ml-auto" /> : <ArrowDown className="h-3 w-3 ml-auto" />)}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setSortField('category'); setSortOrder(sortField === 'category' && sortOrder === 'asc' ? 'desc' : 'asc'); }}>
                  Category {sortField === 'category' && (sortOrder === 'asc' ? <ArrowUp className="h-3 w-3 ml-auto" /> : <ArrowDown className="h-3 w-3 ml-auto" />)}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <CategoryChips
            categories={categories}
            selected={selectedCategory}
            onSelect={setSelectedCategory}
          />
        </div>

        {/* Products Grid / List View */}
        {productsLoading ? (
          <div className={viewMode === 'grid' ? "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-3" : "space-y-2"}>
            {Array.from({ length: 8 }).map((_, i) => (
              viewMode === 'grid' ? (
                <Card key={i} className="overflow-hidden border-l-4 border-l-muted">
                  <div className="h-28 bg-muted relative">
                    <div className="absolute inset-0 animate-shimmer" />
                  </div>
                  <CardContent className="p-2.5 space-y-2">
                    <div className="relative"><Skeleton className="h-4 w-3/4" /><div className="absolute inset-0 animate-shimmer" /></div>
                    <div className="relative"><Skeleton className="h-3 w-1/2" /><div className="absolute inset-0 animate-shimmer" /></div>
                    <div className="relative"><Skeleton className="h-5 w-2/3" /><div className="absolute inset-0 animate-shimmer" /></div>
                  </CardContent>
                </Card>
              ) : (
                <Card key={i} className="p-3"><div className="flex items-center gap-3"><Skeleton className="h-10 w-10 rounded" /><div className="flex-1 space-y-1.5"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-3 w-1/4" /></div><Skeleton className="h-5 w-16" /></div></Card>
              )
            ))}
          </div>
        ) : products.length === 0 ? (
          <EmptyProductsState searchQuery={searchQuery} />
        ) : viewMode === 'grid' ? (
          <div className={`grid ${gridColsClass} items-stretch`}>
            {sortedProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onAdd={handleAddToCart}
                cartQuantity={cart.items.find(i => i.productId === product.id)?.quantity}
              />
            ))}
          </div>
        ) : (
          /* List View */
          <Card className="overflow-hidden backdrop-blur-sm bg-card/80">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left p-2.5 font-medium text-muted-foreground text-xs">Name</th>
                    <th className="text-left p-2.5 font-medium text-muted-foreground text-xs hidden sm:table-cell">SKU</th>
                    <th className="text-left p-2.5 font-medium text-muted-foreground text-xs hidden md:table-cell">Category</th>
                    <th className="text-right p-2.5 font-medium text-muted-foreground text-xs">Price</th>
                    <th className="text-center p-2.5 font-medium text-muted-foreground text-xs">Stock</th>
                    <th className="text-right p-2.5 font-medium text-muted-foreground text-xs">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedProducts.map((product) => {
                    const inCart = cart.items.find(i => i.productId === product.id);
                    const isLowStock = product.quantityInStock <= product.reorderLevel && product.quantityInStock > 0;
                    const isOutOfStock = product.quantityInStock <= 0;
                    return (
                      <tr key={product.id} className="border-b hover:bg-muted/30 transition-colors">
                        <td className="p-2.5">
                          <div className="flex items-center gap-2">
                            <div className="shrink-0 w-8 h-8 rounded-md bg-muted flex items-center justify-center">
                              {product.imageUrl || getCategoryImage(product.categoryId) ? (
                                <img src={product.imageUrl || getCategoryImage(product.categoryId)!} alt="" className="h-8 w-8 rounded-md object-cover" />
                              ) : (
                                <Package className="h-4 w-4 text-muted-foreground/40" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-sm truncate">{product.name}</p>
                              <p className="text-[10px] text-muted-foreground sm:hidden">{product.sku}</p>
                            </div>
                            {inCart && (
                              <Badge variant="secondary" className="text-[9px] shrink-0">{inCart.quantity} in cart</Badge>
                            )}
                          </div>
                        </td>
                        <td className="p-2.5 text-xs text-muted-foreground font-mono hidden sm:table-cell">{product.sku}</td>
                        <td className="p-2.5 hidden md:table-cell">
                          {product.category && (
                            <Badge variant="outline" className="text-[10px]" style={{ borderColor: product.category.color || undefined }}>{product.category.name}</Badge>
                          )}
                        </td>
                        <td className="p-2.5 text-right font-semibold text-primary">{formatKES(product.pricePerUnit)}</td>
                        <td className="p-2.5 text-center">
                          <span className={`text-xs font-medium ${isOutOfStock ? 'text-red-500' : isLowStock ? 'text-amber-500' : 'text-foreground'}`}>
                            {isOutOfStock ? 'Out' : product.quantityInStock}
                          </span>
                        </td>
                        <td className="p-2.5 text-right">
                          <Button
                            size="sm"
                            variant={isOutOfStock ? 'ghost' : 'outline'}
                            disabled={isOutOfStock && !product.isRental}
                            onClick={() => handleAddToCart(product)}
                            className="h-7 text-xs"
                          >
                            <Plus className="h-3 w-3 mr-1" />
                            Add
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* Sell More — Frequently Bought Together recommendations */}
        {cart.items.length > 0 && (
          <Card className="border-primary/30 bg-gradient-to-br from-primary/5 via-card to-card overflow-hidden">
            <button
              type="button"
              onClick={() => setRecommendationsOpen(!recommendationsOpen)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors"
              aria-expanded={recommendationsOpen}
            >
              <div className="flex items-center gap-2 min-w-0">
                <div className="shrink-0 h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center">
                  <Lightbulb className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold flex items-center gap-2">
                    Sell More — Customers also bought
                    <Badge variant="secondary" className="text-[10px] h-5 px-1.5">{visibleRecommendations.length}</Badge>
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate">Tap a chip to add it to the cart</p>
                </div>
              </div>
              <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${recommendationsOpen ? 'rotate-180' : ''}`} />
            </button>
            {recommendationsOpen && (
              <div className="px-4 pb-4 pt-1">
                {recommendationsLoading ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Finding related products…
                  </div>
                ) : visibleRecommendations.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">
                    No frequent add-on suggestions yet for this cart. Sell more of these items and recommendations will appear here.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {visibleRecommendations.map((rec) => {
                      const name = rec.product?.name || rec.productName || 'Product';
                      const price = rec.product?.pricePerUnit ?? rec.pricePerUnit ?? 0;
                      const unit = rec.product?.unitType || rec.unitType || 'PIECE';
                      const img = rec.product?.imageUrl || rec.imageUrl || getCategoryImage(rec.product?.categoryId);
                      const co = rec.coOccurrence ?? rec.count ?? 0;
                      const stock = rec.product?.quantityInStock ?? rec.quantityInStock ?? 0;
                      return (
                        <button
                          key={rec.product?.id || rec.productId}
                          type="button"
                          onClick={() => handleAddRecommendation(rec)}
                          className="group flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full border border-border bg-background hover:border-primary/40 hover:bg-primary/5 transition-all min-h-[44px] focus:outline-none focus:ring-2 focus:ring-ring"
                          title={`Add ${name} to cart`}
                        >
                          <div className="h-8 w-8 rounded-full bg-muted overflow-hidden flex items-center justify-center shrink-0">
                            {img ? (
                              <img src={img} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <Package className="h-4 w-4 text-muted-foreground/40" />
                            )}
                          </div>
                          <div className="flex flex-col items-start leading-tight min-w-0">
                            <span className="text-xs font-medium line-clamp-1 break-words max-w-[160px]">{name}</span>
                            <span className="text-[10px] text-muted-foreground">
                              {formatKES(price)} · {unit}
                              {co > 0 && <span className="text-primary/80"> · bought together {co}×</span>}
                              {stock > 0 && stock <= 5 && <span className="text-amber-600"> · {stock} left</span>}
                            </span>
                          </div>
                          <Plus className="h-3.5 w-3.5 text-primary shrink-0 group-hover:scale-110 transition-transform" />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </Card>
        )}
      </div>

      {/* Cart Sidebar - Desktop only (2 of 5 columns) */}
      <div className="hidden lg:block lg:col-span-2">
        <Card className="relative sticky top-20 flex flex-col h-[calc(100vh-120px)] overflow-hidden bg-gradient-to-b from-card/95 to-card/90 backdrop-blur-sm shadow-lg border border-border/50">
          <CardHeader className="pb-3 shrink-0">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <ShoppingCart className="h-4 w-4" />
                Cart
                {cart.items.length > 0 && (
                  <Badge variant="secondary" className={cartBadgeShake ? 'animate-shake' : ''}>{cart.getItemCount()}</Badge>
                )}
                {heldCartCount > 0 && (
                  <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">
                    <Pause className="h-2.5 w-2.5 mr-0.5" />{heldCartCount} held
                  </Badge>
                )}
              </CardTitle>
              <div className="flex items-center gap-1">
                {heldCartCount > 0 && (
                  <Button variant="ghost" size="sm" onClick={recallCart} className="text-blue-600 h-7" title="Recall held cart">
                    <ShoppingBag className="h-3.5 w-3.5 mr-1" /> Recall
                  </Button>
                )}
                {cart.items.length > 0 && (
                  <>
                    <Button variant="ghost" size="sm" onClick={holdCart} className="text-amber-600 h-7" title="Hold current cart (F10)">
                      <Pause className="h-3.5 w-3.5 mr-1" /> Hold
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => { cart.clearCart(); setCartNotes({}); setCartDiscountInput(''); }} className="text-destructive h-7">
                      <Trash2 className="h-3.5 w-3.5 mr-1" /> Clear
                    </Button>
                  </>
                )}
              </div>
            </div>
          </CardHeader>
          <Separator className="shrink-0" />
          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
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
                    isNew={addedItemId === item.productId}
                    note={cartNotes[item.productId]}
                    onNoteChange={handleCartNoteChange}
                  />
                ))}
              </div>
            )}
          </div>
          {cart.items.length > 0 && (
            <>
              <Separator className="shrink-0" />
              <div className="shrink-0 max-h-[42%] overflow-y-auto custom-scrollbar border-t px-4 pt-3 pb-2 space-y-3">
                {/* Discount Code (voucher/promo) */}
                <div className="flex gap-1.5">
                  <Input
                    placeholder="Discount code"
                    value={discountCode}
                    onChange={(e) => setDiscountCode(e.target.value)}
                    className="h-8 text-xs"
                    onKeyDown={(e) => { if (e.key === 'Enter') applyDiscountCode(); }}
                  />
                  <Button variant="outline" size="sm" onClick={applyDiscountCode} className="h-8 text-xs shrink-0">
                    Apply
                  </Button>
                </div>

                {/* Cart-level flat discount (Ksh) — cashier manual override */}
                <div className="flex gap-1.5 items-center">
                  <Tag className="h-3.5 w-3.5 text-green-600 shrink-0" />
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    placeholder="Cart discount (Ksh)"
                    value={cartDiscountInput}
                    onChange={(e) => {
                      setCartDiscountInput(e.target.value);
                      const amt = Number(e.target.value);
                      if (!Number.isNaN(amt)) {
                        cart.setDiscount(amt);
                      } else if (e.target.value === '') {
                        cart.setDiscount(0);
                      }
                    }}
                    className="h-8 text-xs"
                    aria-label="Cart discount amount in Kenyan Shillings"
                  />
                  {cart.discount > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs text-destructive shrink-0"
                      onClick={() => { cart.setDiscount(0); setCartDiscountInput(''); }}
                      title="Clear cart discount"
                    >
                      Clear
                    </Button>
                  )}
                </div>

                {/* Pay with Gift Card — opens dedicated dialog */}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-8 text-xs border-amber-300 text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-700 dark:hover:bg-amber-950/30"
                  onClick={() => setPayWithGiftCardOpen(true)}
                  disabled={cart.items.length === 0}
                >
                  <Gift className="h-3.5 w-3.5 mr-1.5" />
                  Pay with Gift Card
                </Button>

                {/* Customer Selection */}
                <div className="flex gap-1.5">
                  <Select value={selectedCustomer} onValueChange={(v) => { setSelectedCustomer(v); setAppliedGiftCardId(''); setAppliedVoucherId(''); }}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Walk-in Customer" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="walk-in">Walk-in Customer</SelectItem>
                      {customers.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}{c.phone ? ` - ${c.phone}` : ''}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 shrink-0 text-xs"
                    onClick={() => setAddCustomerOpen(true)}
                    title="Add new customer"
                  >
                    <UserPlus className="h-3.5 w-3.5 mr-1" />
                    Add
                  </Button>
                </div>

                {/* Gift Cards / Vouchers for selected customer - Collapsible */}
                {selectedCustomer && selectedCustomer !== 'walk-in' && (customerGiftCards.length > 0 || customerVouchers.length > 0) && (
                  <div className="rounded-md border border-border/60">
                    <button
                      type="button"
                      onClick={() => setBenefitsExpanded(!benefitsExpanded)}
                      className="w-full flex items-center justify-between p-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <span className="flex items-center gap-1.5">
                        <Award className="h-3 w-3" />
                        Customer Benefits
                        <Badge variant="secondary" className="text-[9px] h-4 px-1">
                          {customerGiftCards.length + customerVouchers.length}
                        </Badge>
                        {(appliedGiftCardId || appliedVoucherId) && (
                          <Badge className="text-[9px] h-4 px-1 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-0">
                            Auto-applied
                          </Badge>
                        )}
                      </span>
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${benefitsExpanded ? 'rotate-180' : ''}`} />
                    </button>
                    {benefitsExpanded && (
                      <div className="px-2 pb-2 space-y-1.5">
                        {Array.isArray(customerGiftCards) && customerGiftCards.length > 0 && (
                          <div className="space-y-1">
                            <p className="text-[10px] text-muted-foreground font-medium">Gift Cards</p>
                            {customerGiftCards.map((gc) => (
                              <button
                                key={gc.id}
                                type="button"
                                onClick={() => setAppliedGiftCardId(appliedGiftCardId === gc.id ? '' : gc.id)}
                                className={`w-full text-left p-1.5 rounded-md border text-xs transition-colors ${
                                  appliedGiftCardId === gc.id
                                    ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                                    : 'border-border hover:border-primary/30 hover:bg-muted/30'
                                }`}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-1.5">
                                    <Gift className="h-3 w-3 text-amber-500" />
                                    <span className="font-medium">{gc.code}</span>
                                  </div>
                                  <span className="font-semibold text-primary">{formatKES(gc.currentBalance)}</span>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                        {Array.isArray(customerVouchers) && customerVouchers.length > 0 && (
                          <div className="space-y-1">
                            <p className="text-[10px] text-muted-foreground font-medium">Vouchers</p>
                            {customerVouchers.map((v) => (
                              <button
                                key={v.id}
                                type="button"
                                onClick={() => setAppliedVoucherId(appliedVoucherId === v.id ? '' : v.id)}
                                className={`w-full text-left p-1.5 rounded-md border text-xs transition-colors ${
                                  appliedVoucherId === v.id
                                    ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                                    : 'border-border hover:border-primary/30 hover:bg-muted/30'
                                }`}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-1.5">
                                    <Ticket className="h-3 w-3 text-emerald-500" />
                                    <span className="font-medium">{v.name}</span>
                                    <Badge variant="outline" className="text-[8px] h-3.5 px-1">{v.voucherType}</Badge>
                                  </div>
                                  <span className="font-semibold text-primary">
                                    {v.voucherType === 'PERCENTAGE' ? `${v.value}%` : formatKES(v.value)}
                                  </span>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>{formatKES(subtotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">VAT (16%)</span>
                    <span>{formatKES(tax)}</span>
                  </div>
                  {totalDiscount > 0 && (
                    <div className="flex justify-between text-green-600">
                      <span className="flex items-center gap-1">
                        <Tag className="h-3 w-3" />
                        Discount
                      </span>
                      <span>-{formatKES(totalDiscount)}</span>
                    </div>
                  )}
                  <Separator />
                  <div className="flex justify-between font-bold text-base">
                    <span>Total</span>
                    <span className="gradient-text">{formatKES(finalTotal)}</span>
                  </div>
                </div>
              </div>

              {/* Checkout button — always pinned at the bottom, never scrolled out of view */}
              <div className="shrink-0 p-3 border-t bg-card/80 backdrop-blur-sm space-y-1.5">
                <Button
                  className="w-full bg-gradient-to-r from-accent-orange to-amber-500 hover:from-accent-orange/90 hover:to-amber-600 text-white font-semibold h-12 shadow-lg shadow-accent-orange/20"
                  size="lg"
                  onClick={() => setCheckoutOpen(true)}
                >
                  <CreditCard className="mr-2 h-4 w-4" />
                  <span className="flex flex-col items-start leading-tight">
                    <span className="text-xs font-normal opacity-80">Checkout (F9)</span>
                    <span>{formatKES(finalTotal)}</span>
                  </span>
                </Button>
                <p className="text-center text-[10px] text-muted-foreground">
                  {cart.getItemCount()} item{cart.getItemCount() !== 1 ? 's' : ''} in cart · Total {formatKES(finalTotal)}
                </p>
              </div>
            </>
          )}
          {/* Loading overlay during checkout */}
          {checkoutMutation.isPending && (
            <div className="absolute inset-0 bg-background/60 backdrop-blur-sm z-10 flex items-center justify-center rounded-lg">
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm font-medium text-muted-foreground">Processing payment...</p>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Checkout Dialog (shared — desktop & mobile) */}
      <CheckoutDialog
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        finalTotal={finalTotal}
        totalDiscount={totalDiscount}
        paymentMethod={paymentMethod}
        setPaymentMethod={setPaymentMethod}
        cashReceived={cashReceived}
        setCashReceived={setCashReceived}
        change={change}
        selectedCustomer={selectedCustomer}
        customers={customers}
        splitCashAmount={splitCashAmount}
        setSplitCashAmount={setSplitCashAmount}
        splitMpesaAmount={splitMpesaAmount}
        setSplitMpesaAmount={setSplitMpesaAmount}
        mpesaPhone={mpesaPhone}
        setMpesaPhone={setMpesaPhone}
        mpesaStatus={mpesaStatus}
        setMpesaStatus={setMpesaStatus}
        stkCheckoutRequestId={stkCheckoutRequestId}
        stkResultDesc={stkResultDesc}
        stkPolling={stkPolling}
        mpesaMutation={mpesaMutation}
        checkoutMutation={checkoutMutation}
        onSendStkPush={handleMpesaPay}
        onRetryStk={() => { setMpesaStatus('idle'); setStkCheckoutRequestId(''); setStkResultDesc(''); clearStkPolling(); }}
        onCompleteSale={handleCheckout}
      />

      {/* Receipt Dialog (ResponsiveDialog) — Print + WhatsApp + New Sale */}
      <ResponsiveDialog
        open={receiptOpen}
        onOpenChange={setReceiptOpen}
        title={
          <span className="flex items-center gap-2 justify-center">
            <PartyPopper className="h-5 w-5 text-primary" />
            Receipt
          </span>
        }
        description="Sale completed successfully. Print, send via WhatsApp, or start a new sale."
        size="sm"
        footer={
          <div className="flex flex-wrap gap-2 w-full">
            <Button variant="outline" onClick={handlePrintReceipt} className="flex-1 min-w-[120px]">
              <Printer className="mr-2 h-4 w-4" />
              Print
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                // Pre-fill phone from selected customer (now cleared) or lastMpesaPhone
                setReceiptSendPhone(lastMpesaPhone || lastTransaction?.customer?.phone || '');
                setReceiptSendOpen(true);
              }}
              className="flex-1 min-w-[120px] text-green-700 dark:text-green-400 border-green-300 dark:border-green-800 hover:bg-green-50 dark:hover:bg-green-950/30"
            >
              <Send className="mr-2 h-4 w-4" />
              Send via WhatsApp
            </Button>
            <Button
              onClick={() => { setReceiptOpen(false); setLastTransaction(null); }}
              className="flex-1 min-w-[120px] bg-accent-orange hover:bg-accent-orange/90 text-accent-orange-foreground"
            >
              <ShoppingCart className="mr-2 h-4 w-4" />
              New Sale
            </Button>
          </div>
        }
      >
        {lastTransaction && (
          <div className="receipt-content receipt-printable space-y-4 text-sm" id="receipt-content">
            {/* Store Header */}
            <div className="text-center space-y-0.5">
              <h2 className="text-lg font-bold">MBUMAH HARDWARE</h2>
              <p className="text-xs text-muted-foreground">{STORE_LIST.find(s => s.id === currentStoreId)?.shortName || 'Juja Main Branch'}</p>
              <p className="text-xs text-muted-foreground">Tel: +254 700 123 456</p>
            </div>
            <Separator />
            {/* Receipt Meta */}
            <div className="space-y-1 text-xs">
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground shrink-0">Receipt #:</span>
                <span className="font-mono font-semibold break-all text-right">{lastTransaction.receiptNumber}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground shrink-0">Date:</span>
                <span className="text-right break-words">{formatDateTime(lastTransaction.createdAt)}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground shrink-0">Cashier:</span>
                <span className="text-right break-words">{lastTransaction.cashier?.name || useAuthStore.getState().user?.name || 'N/A'}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground shrink-0">Customer:</span>
                <span className="text-right break-words">{lastTransaction.customer?.name || 'Walk-in'}</span>
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
                  <span className="col-span-5 break-words pr-1">{item.productName}</span>
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
      </ResponsiveDialog>

      {/* Send Receipt via WhatsApp Dialog */}
      <ResponsiveDialog
        open={receiptSendOpen}
        onOpenChange={setReceiptSendOpen}
        title={<span className="flex items-center gap-2"><Send className="h-4 w-4 text-green-600" /> Send Receipt via WhatsApp</span>}
        description="Enter the customer's WhatsApp number. We'll generate the receipt and open WhatsApp with the document ready to send."
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setReceiptSendOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSendReceiptWhatsApp}
              disabled={receiptSending || !receiptSendPhone || receiptSendPhone.length < 9}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {receiptSending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Preparing…</>
              ) : (
                <><Send className="mr-2 h-4 w-4" />Send</>
              )}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <Label htmlFor="receiptPhone">WhatsApp Phone Number</Label>
            <div className="relative mt-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-medium">+254</span>
              <Input
                id="receiptPhone"
                type="tel"
                placeholder="7XX XXX XXX"
                className="pl-14"
                value={receiptSendPhone.startsWith('254') ? receiptSendPhone.slice(3) : receiptSendPhone.startsWith('0') ? receiptSendPhone.slice(1) : receiptSendPhone}
                onChange={(e) => setReceiptSendPhone(e.target.value.replace(/\D/g, ''))}
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5">
              Receipt will be sent from the MBUMAH HARDWARE WhatsApp Business account. The customer must have WhatsApp installed on this number.
            </p>
          </div>
          {lastTransaction && (
            <div className="rounded-md border bg-muted/30 p-2.5 text-xs space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Receipt #</span><span className="font-mono font-semibold">{lastTransaction.receiptNumber}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Amount</span><span className="font-semibold">{formatKES(lastTransaction.totalAmount)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Customer</span><span>{lastTransaction.customer?.name || 'Walk-in'}</span></div>
            </div>
          )}
        </div>
      </ResponsiveDialog>

      {/* Add Customer Dialog */}
      <Dialog open={addCustomerOpen} onOpenChange={setAddCustomerOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary" />
              Add New Customer
            </DialogTitle>
            <DialogDescription>
              Create a new customer record. They will be auto-selected for this order.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="newCustomerName">Full Name *</Label>
              <Input
                id="newCustomerName"
                placeholder="e.g. John Kamau"
                value={newCustomerName}
                onChange={(e) => setNewCustomerName(e.target.value)}
                className="mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="newCustomerPhone">Phone</Label>
                <Input
                  id="newCustomerPhone"
                  type="tel"
                  placeholder="0712 345 678"
                  value={newCustomerPhone}
                  onChange={(e) => setNewCustomerPhone(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="newCustomerEmail">Email</Label>
                <Input
                  id="newCustomerEmail"
                  type="email"
                  placeholder="john@example.com"
                  value={newCustomerEmail}
                  onChange={(e) => setNewCustomerEmail(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="newCustomerDebtLimit">Debt Limit (KES)</Label>
              <Input
                id="newCustomerDebtLimit"
                type="number"
                placeholder="0"
                value={newCustomerDebtLimit}
                onChange={(e) => setNewCustomerDebtLimit(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddCustomerOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!newCustomerName.trim()) {
                  toast.error('Customer name is required');
                  return;
                }
                createCustomerMutation.mutate({
                  storeId: currentStoreId,
                  name: newCustomerName.trim(),
                  phone: newCustomerPhone.trim() || undefined,
                  email: newCustomerEmail.trim() || undefined,
                  debtLimit: Number(newCustomerDebtLimit) || 0,
                });
              }}
              disabled={createCustomerMutation.isPending || !newCustomerName.trim()}
              className="bg-accent-orange hover:bg-accent-orange/90 text-accent-orange-foreground"
            >
              {createCustomerMutation.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating...</>
              ) : (
                <><UserPlus className="mr-2 h-4 w-4" />Create Customer</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Low Stock Alert Dialog */}
      <LowStockAlertDialog
        open={lowStockAlertOpen}
        onOpenChange={setLowStockAlertOpen}
        storeId={currentStoreId}
      />

      {/* Pay with Gift Card Dialog — redeem a gift card code against the cart */}
      <Dialog open={payWithGiftCardOpen} onOpenChange={setPayWithGiftCardOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Gift className="h-5 w-5 text-amber-500" />
              Pay with Gift Card
            </DialogTitle>
            <DialogDescription>
              Enter the gift card code printed on the card. The available balance will be applied as a discount to this sale. Any unused balance remains on the card for future purchases.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <label htmlFor="gift-card-code" className="text-xs font-medium text-muted-foreground">
                Gift Card Code
              </label>
              <Input
                id="gift-card-code"
                placeholder="e.g. MBT-GC-XXXX-XXXX"
                value={giftCardPayCode}
                onChange={(e) => setGiftCardPayCode(e.target.value.toUpperCase())}
                className="font-mono tracking-wider"
                onKeyDown={(e) => { if (e.key === 'Enter' && giftCardPayCode.trim()) {
                  void (async () => {
                    try {
                      const res = await giftCardsApi.redeemByCode({
                        code: giftCardPayCode.trim(),
                        storeId: currentStoreId,
                        amount: finalTotal,
                      });
                      if (res.data) {
                        cart.setDiscount(res.data.discountAmount);
                        setCartDiscountInput(String(res.data.discountAmount));
                        toast.success(`Gift card applied: ${formatKES(res.data.discountAmount)} discount`);
                        setPayWithGiftCardOpen(false);
                        setGiftCardPayCode('');
                      } else {
                        toast.error(res.error || 'Invalid gift card code');
                      }
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : 'Failed to redeem gift card');
                    }
                  })();
                }}}
                aria-label="Gift card code"
              />
            </div>
            <div className="rounded-md border border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20 p-2.5 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Sale Total (pre-discount)</span>
                <span className="font-medium">{formatKES(preDiscountTotal)}</span>
              </div>
              {cart.discount > 0 && (
                <div className="flex justify-between text-green-600">
                  <span className="flex items-center gap-1"><Tag className="h-3 w-3" />Current Discount</span>
                  <span className="font-medium">-{formatKES(cart.discount)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold border-t border-amber-200 dark:border-amber-900/50 pt-1">
                <span>Balance Due</span>
                <span>{formatKES(finalTotal)}</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPayWithGiftCardOpen(false); setGiftCardPayCode(''); }}>
              Cancel
            </Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              disabled={!giftCardPayCode.trim()}
              onClick={async () => {
                try {
                  const res = await giftCardsApi.redeemByCode({
                    code: giftCardPayCode.trim(),
                    storeId: currentStoreId,
                    amount: finalTotal,
                  });
                  if (res.data) {
                    cart.setDiscount(res.data.discountAmount);
                    setCartDiscountInput(String(res.data.discountAmount));
                    toast.success(`Gift card applied: ${formatKES(res.data.discountAmount)} discount`);
                    setPayWithGiftCardOpen(false);
                    setGiftCardPayCode('');
                  } else {
                    toast.error(res.error || 'Invalid gift card code');
                  }
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Failed to redeem gift card');
                }
              }}
            >
              <Gift className="h-4 w-4 mr-2" />
              Apply Gift Card
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mobile Cart FAB (Floating Action Button) */}
      {cart.items.length > 0 && (
        <button
          type="button"
          className="lg:hidden fixed bottom-20 right-4 z-40 h-14 w-14 rounded-full bg-gradient-to-r from-accent-orange to-amber-500 text-white shadow-xl shadow-accent-orange/30 flex items-center justify-center hover:scale-110 transition-transform"
          onClick={() => setMobileCartOpen(true)}
          aria-label="Open cart"
        >
          <ShoppingCart className="h-6 w-6" />
          <span className="absolute -top-1 -right-1 min-w-[20px] h-5 flex items-center justify-center rounded-full bg-red-500 text-[10px] font-bold px-1">
            {cart.getItemCount()}
          </span>
        </button>
      )}

      {/* Mobile Cart Sheet */}
      <Sheet open={mobileCartOpen} onOpenChange={setMobileCartOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
          <SheetHeader className="p-4 pb-2 border-b shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <SheetTitle className="text-lg flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4" /> Cart
                  {cart.items.length > 0 && (
                    <Badge variant="secondary" className={cartBadgeShake ? 'animate-shake' : ''}>{cart.getItemCount()}</Badge>
                  )}
                </SheetTitle>
              </div>
              <div className="flex items-center gap-1">
                {heldCartCount > 0 && (
                  <Button variant="ghost" size="sm" onClick={recallCart} className="text-blue-600 h-7 text-xs">
                    <ShoppingBag className="h-3.5 w-3.5 mr-1" /> Recall
                  </Button>
                )}
                {cart.items.length > 0 && (
                  <>
                    <Button variant="ghost" size="sm" onClick={holdCart} className="text-amber-600 h-7 text-xs">
                      <Pause className="h-3.5 w-3.5 mr-1" /> Hold
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => { cart.clearCart(); setCartNotes({}); setCartDiscountInput(''); }} className="text-destructive h-7 text-xs">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          </SheetHeader>
          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
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
                    isNew={addedItemId === item.productId}
                    note={cartNotes[item.productId]}
                    onNoteChange={handleCartNoteChange}
                  />
                ))}
              </div>
            )}
          </div>
          {cart.items.length > 0 && (
            <>
              <div className="max-h-[42%] overflow-y-auto custom-scrollbar border-t shrink-0 px-4 pt-3 pb-2 space-y-3">
                <div className="flex gap-1.5">
                  <Input
                    placeholder="Discount code"
                    value={discountCode}
                    onChange={(e) => setDiscountCode(e.target.value)}
                    className="h-8 text-xs"
                    onKeyDown={(e) => { if (e.key === 'Enter') applyDiscountCode(); }}
                  />
                  <Button variant="outline" size="sm" onClick={applyDiscountCode} className="h-8 text-xs shrink-0">
                    Apply
                  </Button>
                </div>
                <div className="flex gap-1.5">
                  <Select value={selectedCustomer} onValueChange={(v) => { setSelectedCustomer(v); setAppliedGiftCardId(''); setAppliedVoucherId(''); }}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Walk-in Customer" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="walk-in">Walk-in Customer</SelectItem>
                      {customers.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}{c.phone ? ` - ${c.phone}` : ''}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 shrink-0 text-xs"
                    onClick={() => setAddCustomerOpen(true)}
                    title="Add new customer"
                  >
                    <UserPlus className="h-3.5 w-3.5 mr-1" />
                    Add
                  </Button>
                </div>

                {/* Gift Cards / Vouchers for selected customer (mobile) - Collapsible */}
                {selectedCustomer && selectedCustomer !== 'walk-in' && (customerGiftCards.length > 0 || customerVouchers.length > 0) && (
                  <div className="rounded-md border border-border/60">
                    <button
                      type="button"
                      onClick={() => setBenefitsExpanded(!benefitsExpanded)}
                      className="w-full flex items-center justify-between p-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <span className="flex items-center gap-1.5">
                        <Award className="h-3 w-3" />
                        Customer Benefits
                        <Badge variant="secondary" className="text-[9px] h-4 px-1">
                          {customerGiftCards.length + customerVouchers.length}
                        </Badge>
                        {(appliedGiftCardId || appliedVoucherId) && (
                          <Badge className="text-[9px] h-4 px-1 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-0">
                            Auto-applied
                          </Badge>
                        )}
                      </span>
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${benefitsExpanded ? 'rotate-180' : ''}`} />
                    </button>
                    {benefitsExpanded && (
                      <div className="px-2 pb-2 space-y-1.5">
                        {Array.isArray(customerGiftCards) && customerGiftCards.length > 0 && (
                          <div className="space-y-1">
                            <p className="text-[10px] text-muted-foreground font-medium">Gift Cards</p>
                            {customerGiftCards.map((gc) => (
                              <button
                                key={gc.id}
                                type="button"
                                onClick={() => setAppliedGiftCardId(appliedGiftCardId === gc.id ? '' : gc.id)}
                                className={`w-full text-left p-1.5 rounded-md border text-xs transition-colors ${
                                  appliedGiftCardId === gc.id
                                    ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                                    : 'border-border hover:border-primary/30 hover:bg-muted/30'
                                }`}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-1.5">
                                    <Gift className="h-3 w-3 text-amber-500" />
                                    <span className="font-medium">{gc.code}</span>
                                  </div>
                                  <span className="font-semibold text-primary">{formatKES(gc.currentBalance)}</span>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                        {Array.isArray(customerVouchers) && customerVouchers.length > 0 && (
                          <div className="space-y-1">
                            <p className="text-[10px] text-muted-foreground font-medium">Vouchers</p>
                            {customerVouchers.map((v) => (
                              <button
                                key={v.id}
                                type="button"
                                onClick={() => setAppliedVoucherId(appliedVoucherId === v.id ? '' : v.id)}
                                className={`w-full text-left p-1.5 rounded-md border text-xs transition-colors ${
                                  appliedVoucherId === v.id
                                    ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                                    : 'border-border hover:border-primary/30 hover:bg-muted/30'
                                }`}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-1.5">
                                    <Ticket className="h-3 w-3 text-emerald-500" />
                                    <span className="font-medium">{v.name}</span>
                                    <Badge variant="outline" className="text-[8px] h-3.5 px-1">{v.voucherType}</Badge>
                                  </div>
                                  <span className="font-semibold text-primary">
                                    {v.voucherType === 'PERCENTAGE' ? `${v.value}%` : formatKES(v.value)}
                                  </span>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>{formatKES(subtotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">VAT (16%)</span>
                    <span>{formatKES(tax)}</span>
                  </div>
                  {totalDiscount > 0 && (
                    <div className="flex justify-between text-green-600">
                      <span className="flex items-center gap-1">
                        <Tag className="h-3 w-3" />
                        Discount
                      </span>
                      <span>-{formatKES(totalDiscount)}</span>
                    </div>
                  )}
                  <Separator />
                  <div className="flex justify-between font-bold text-base">
                    <span>Total</span>
                    <span className="gradient-text">{formatKES(finalTotal)}</span>
                  </div>
                </div>
              </div>

              {/* Checkout button — always pinned at the bottom of the sheet */}
              <div className="shrink-0 p-3 border-t bg-card/80 backdrop-blur-sm space-y-1.5">
                <Button
                  className="w-full bg-gradient-to-r from-accent-orange to-amber-500 hover:from-accent-orange/90 hover:to-amber-600 text-white font-semibold h-12 shadow-lg shadow-accent-orange/20"
                  size="lg"
                  onClick={() => { setMobileCartOpen(false); setCheckoutOpen(true); }}
                >
                  <CreditCard className="mr-2 h-4 w-4" />
                  <span className="flex flex-col items-start leading-tight">
                    <span className="text-xs font-normal opacity-80">Checkout (F9)</span>
                    <span>{formatKES(finalTotal)}</span>
                  </span>
                </Button>
                <p className="text-center text-[10px] text-muted-foreground">
                  {cart.getItemCount()} item{cart.getItemCount() !== 1 ? 's' : ''} in cart · Total {formatKES(finalTotal)}
                </p>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}


function MainApp() {
  const { activeTab, setActiveTab, currentStoreId } = useAppStore();
  const user = useAuthStore((s) => s.user);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const searchBtnRef = useRef<HTMLButtonElement | null>(null);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+K or Cmd+K: Focus search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchBtnRef.current?.click();
        return;
      }

      // F2-F5: Switch tabs (prevent default)
      if (e.key === 'F2') { e.preventDefault(); setActiveTab('pos'); return; }
      if (e.key === 'F3') { e.preventDefault(); setActiveTab('inventory'); return; }
      if (e.key === 'F4') { e.preventDefault(); setActiveTab('customers'); return; }
      if (e.key === 'F5') { e.preventDefault(); setActiveTab('financial'); return; }

      // F9: Checkout (dispatch custom event that POSTab listens for)
      if (e.key === 'F9') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('pos-checkout'));
        return;
      }

      // F10: Hold cart
      if (e.key === 'F10') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('pos-hold-cart'));
        return;
      }

      // ? or Ctrl+/: Show keyboard shortcuts
      if (e.key === '?' || ((e.metaKey || e.ctrlKey) && e.key === '/')) {
        e.preventDefault();
        setShortcutsOpen(true);
        return;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [setActiveTab]);

  const renderTab = () => {
    switch (activeTab) {
      case 'dashboard': return <Suspense fallback={<TabLoadingFallback />}><LazyDashboardTab /></Suspense>;
      case 'pos': return <POSTab />;
      case 'catalog': return <Suspense fallback={<TabLoadingFallback />}><LazyCatalogTab /></Suspense>;
      case 'inventory': return <Suspense fallback={<TabLoadingFallback />}><LazyInventoryTab /></Suspense>;
      case 'customers': return <Suspense fallback={<TabLoadingFallback />}><LazyCustomersTab /></Suspense>;
      case 'rentals': return <Suspense fallback={<TabLoadingFallback />}><LazyRentalsTab /></Suspense>;
      case 'financial': return <Suspense fallback={<TabLoadingFallback />}><LazyFinancialTab /></Suspense>;
      case 'reports': return <Suspense fallback={<TabLoadingFallback />}><LazyReportsTab /></Suspense>;
      case 'transactions': return <Suspense fallback={<TabLoadingFallback />}><LazyTransactionsTab /></Suspense>;
      case 'admin': return <Suspense fallback={<TabLoadingFallback />}><LazyAdminTab /></Suspense>;
      case 'suppliers': return <Suspense fallback={<TabLoadingFallback />}><LazySuppliersTab /></Suspense>;
      case 'gift-cards': return <Suspense fallback={<TabLoadingFallback />}><LazyGiftCardsTab storeId={currentStoreId} userRole={user?.role || 'CASHIER'} userId={user?.id || ''} /></Suspense>;
      case 'vouchers': return <Suspense fallback={<TabLoadingFallback />}><LazyVouchersTab /></Suspense>;
      case 'invoices': return <Suspense fallback={<TabLoadingFallback />}><LazyInvoicesTab /></Suspense>;
      case 'delivery': return <Suspense fallback={<TabLoadingFallback />}><LazyDeliveryTab /></Suspense>;
      case 'credits': return <Suspense fallback={<TabLoadingFallback />}><LazyCreditsTab /></Suspense>;
      case 'messaging': return <Suspense fallback={<TabLoadingFallback />}><LazyMessagingTab /></Suspense>;
      case 'transfers': return <Suspense fallback={<TabLoadingFallback />}><LazyTransfersTab /></Suspense>;
      case 'banking': return <Suspense fallback={<TabLoadingFallback />}><LazyBankingTab /></Suspense>;
      case 'loyalty': return <Suspense fallback={<TabLoadingFallback />}><LazyLoyaltyTab /></Suspense>;
      case 'security': return <Suspense fallback={<TabLoadingFallback />}><LazySecurityTab /></Suspense>;
      case 'payroll': return <Suspense fallback={<TabLoadingFallback />}><LazyPayrollTab /></Suspense>;
      default: return <POSTab />;
    }
  };

  return (
    <ErrorBoundary>
      <div className="flex h-screen overflow-hidden">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0 min-h-screen">
          <TopBar searchBtnRef={searchBtnRef} />
          <main className="flex-1 overflow-y-auto p-4 custom-scrollbar">
            <div className="animate-tab-enter" key={activeTab}>
              {renderTab()}
            </div>
          </main>
          <footer className="border-t bg-background/95 backdrop-blur-sm px-4 py-2 text-center shrink-0 mt-auto">
            <div className="flex items-center justify-between max-w-7xl mx-auto">
              <div className="flex items-center gap-3">
                <p className="text-xs text-muted-foreground">
                  MBUMAH HARDWARE POS & ERP &copy; {new Date().getFullYear()}
                </p>
                <span className="text-[10px] text-muted-foreground/50 hidden sm:inline">v1.0.0</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
                  <div className="h-1.5 w-1.5 rounded-full bg-green-500 shadow-[0_0_4px] shadow-green-500/50" />
                  <span className="hidden sm:inline">Connected</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShortcutsOpen(true)}
                  className="text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors flex items-center gap-1"
                >
                  <Keyboard className="h-3 w-3" />
                  <span className="hidden sm:inline">Shortcuts</span>
                </button>
              </div>
            </div>
          </footer>
        </div>
        <KeyboardShortcutsHelp open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      </div>
    </ErrorBoundary>
  );
}


// Hydration-safe client-only mount detection
const emptySubscribe = () => () => {};
function useHasMounted() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

export default function HomePage() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hasMounted = useHasMounted();

  if (!hasMounted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return isAuthenticated ? <MainApp /> : <LoginScreen />;
}
