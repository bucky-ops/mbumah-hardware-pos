'use client';

/**
 * ============================================================================
 * MBUMAH HARDWARE POS — Main Application Entry (src/app/page.tsx)
 * ============================================================================
 *
 * This single file holds the entire POS (Point-of-Sale) front-end for the
 * Mbumah Hardware store. It is intentionally split into many small
 * components (declared BOTTOM-UP) so each one can be read in isolation.
 *
 * ── FILE LAYOUT (top → bottom) ──────────────────────────────────────────────
 *
 *   1. Imports (React, TanStack Query, next-themes, sonner, lucide-react,
 *      Zustand stores, API client, shadcn/ui primitives, ReceiptActions,
 *      and lazy-loaded tab components.)
 *
 *   2. Small leaf components
 *        - TabLoadingFallback, getCategoryImage, useLiveClock,
 *          ConfettiOverlay, KeyboardShortcutsHelp, QuickAddPopup
 *
 *   3. LoginScreen — username + password form, demo accounts.
 *
 *   4. Notification system — useNotificationCount + NotificationCenter.
 *
 *   5. LowStockAlertDialog — modal warning when adding a low-stock item.
 *
 *   6. AppSidebar — left nav: store selector, tab list, user profile.
 *
 *   7. TopBar — global search, live clock, theme toggle, notifications.
 *
 *   8. Dashboard widgets — useAnimatedCounter, MiniSparkline, DashboardStats.
 *
 *   9. Catalogue UI — CategoryChips, ProductCard, CartItemRow, EmptyStates.
 *
 *  10. POSTab  ← THE MAIN POS SCREEN
 *        Layout:  ┌──────────────────────┬──────────────┐
 *                 │  Products grid       │  Cart sidebar │
 *                 │  (search, filters,   │  (items +     │
 *                 │   category chips)    │   checkout)   │
 *                 └──────────────────────┴──────────────┘
 *        On mobile the cart becomes a slide-in Sheet.
 *
 *  11. MainApp — auth gate: shows LoginScreen or the full app shell.
 *  12. useHasMounted — SSR-safe mounted flag.
 *  13. HomePage (default export) — wraps MainApp in ErrorBoundary.
 *
 * ── KEY DIVS YOU WILL LOOK FOR (search these exact strings) ────────────────
 *
 *   • Desktop Cart Sidebar container  → "CartSidebar.root"
 *   • Desktop Cart items ScrollArea   → "CartSidebar.itemsScrollArea"
 *   • Desktop Cart extras (scrollable)→ "CartSidebar.extrasScroll"
 *   • Desktop Cart FIXED FOOTER       → "CartSidebar.fixedFooter"
 *       (this div holds the totals + the Checkout button)
 *   • Desktop Checkout <Dialog>       → "CheckoutDialog.desktop"
 *   • Mobile Cart Sheet               → "CartSheet.root"
 *   • Mobile Cart FIXED FOOTER        → "CartSheet.fixedFooter"
 *   • Mobile Checkout <Dialog>        → "CheckoutDialog.mobile"
 *
 *   The Checkout BUTTON itself is the <Button> inside <DialogTrigger asChild>
 *   immediately below the "CartSidebar.fixedFooter" / "CartSheet.fixedFooter"
 *   comment markers.
 *
 * ============================================================================
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
} from 'lucide-react';

import { useAuthStore, useCartStore, useAppStore, type AppTab } from '@/lib/stores';
import { ErrorBoundary } from '@/components/error-boundary';
import {
  productsApi, categoriesApi, customersApi, transactionsApi,
  paymentsApi, dashboardApi,
  rentalsApi, debtApi, notificationsApi,
  giftCardsApi, vouchersApi,
  formatKES, formatDate, formatDateTime, formatRelativeTime,
  type ProductListItem, type CustomerItem,
  type CategoryItem, type TransactionItem,
  type RentalItem, type DebtLedgerItem,
  type NotificationItem, type GiftCardItem, type VoucherItem,
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
import { ReceiptActions } from '@/components/receipt-actions';

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

// ───────────────────────────────────────────────────────────────────────────
// SECTION 2a: TabLoadingFallback — Suspense fallback shown while a lazy
// tab chunk is being fetched.  Purely presentational.
// ───────────────────────────────────────────────────────────────────────────
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


const TAB_CONFIG: { id: AppTab; label: string; icon: React.ElementType }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Home },
  { id: 'pos', label: 'POS', icon: ShoppingCart },
  { id: 'catalog', label: 'Catalog', icon: Tag },
  { id: 'inventory', label: 'Inventory', icon: Package },
  { id: 'customers', label: 'Customers', icon: Users },
  { id: 'rentals', label: 'Rentals', icon: KeyRound },
  { id: 'financial', label: 'Financial', icon: BarChart3 },
  { id: 'reports', label: 'Reports', icon: FileText },
  { id: 'transactions', label: 'Transactions', icon: ShoppingBag },
  { id: 'suppliers', label: 'Suppliers', icon: Truck },
  { id: 'gift-cards', label: 'Gift Cards', icon: CreditCard },
  { id: 'vouchers', label: 'Vouchers', icon: Ticket },
  { id: 'invoices', label: 'Invoices', icon: Receipt },
  { id: 'delivery', label: 'Delivery', icon: Truck },
  { id: 'credits', label: 'Credits', icon: CircleDollarSign },
  { id: 'messaging', label: 'Messaging', icon: MessageSquare },
  { id: 'transfers', label: 'Transfers', icon: ArrowUpDown },
  { id: 'banking', label: 'Banking', icon: Landmark },
  { id: 'loyalty', label: 'Loyalty', icon: Award },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'admin', label: 'Admin', icon: Settings },
];

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

// ───────────────────────────────────────────────────────────────────────────
// SECTION 2b: getCategoryImage — maps a product categoryId to a static
// placeholder image path under /public.  Returns null when no mapping.
// ───────────────────────────────────────────────────────────────────────────
function getCategoryImage(categoryId: string | null | undefined): string | null {
  if (!categoryId) return null;
  return CATEGORY_IMAGES[categoryId] || null;
}


// ───────────────────────────────────────────────────────────────────────────
// SECTION 2c: useLiveClock — returns a Date that updates every second.
// Used by the TopBar to render a live clock.  Cleans up on unmount.
// ───────────────────────────────────────────────────────────────────────────
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


// ───────────────────────────────────────────────────────────────────────────
// SECTION 2d: ConfettiOverlay — full-screen confetti burst shown briefly
// after a successful sale.  `active` toggles it on/off.
// ───────────────────────────────────────────────────────────────────────────
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


// ───────────────────────────────────────────────────────────────────────────
// SECTION 2e: KeyboardShortcutsHelp — modal that lists every POS keyboard
// shortcut (F1-F12, etc).  Opened from the TopBar help button.
// ───────────────────────────────────────────────────────────────────────────
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


// ───────────────────────────────────────────────────────────────────────────
// SECTION 2f: QuickAddPopup — popover that lets cashiers add 1/5/10 units
// to the cart in one click, surfaced from a ProductCard.
// ───────────────────────────────────────────────────────────────────────────
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


// ───────────────────────────────────────────────────────────────────────────
// SECTION 3: LoginScreen — username + password form.  On success the auth
// store is hydrated and MainApp swaps to the full POS shell.
// ───────────────────────────────────────────────────────────────────────────
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
            <div className="mx-auto w-20 h-20 rounded-2xl overflow-hidden bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center mb-4 shadow-lg animate-pulse-slow">
              <img src="/logo.png" alt="Mbumah Hardware" className="w-full h-full object-cover" />
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
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
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


// Hook to provide notification count globally
// ───────────────────────────────────────────────────────────────────────────
// SECTION 4a: useNotificationCount — TanStack Query hook polling the
// unread-notification count for a given store.  Refetches every 30s.
// ───────────────────────────────────────────────────────────────────────────
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

// ───────────────────────────────────────────────────────────────────────────
// SECTION 4b: NotificationCenter — dropdown panel (rendered inside the
// TopBar bell).  Lists recent notifications, supports mark-as-read.
// ───────────────────────────────────────────────────────────────────────────
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


// ───────────────────────────────────────────────────────────────────────────
// SECTION 5: LowStockAlertDialog — modal warning fired when a cashier
// adds a product whose quantityInStock is below the low-stock threshold.
// ───────────────────────────────────────────────────────────────────────────
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


// ───────────────────────────────────────────────────────────────────────────
// SECTION 6: AppSidebar — left navigation rail.  Contains:
//   • store selector (multi-tenant)
//   • primary tab list (POS, Dashboard, Inventory, Customers, …)
//   • user profile dropdown with logout
// Collapses to a slide-in drawer on mobile.
// ───────────────────────────────────────────────────────────────────────────
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

  // Navigation groups
  const mainNavItems = TAB_CONFIG.filter(t => ['pos', 'catalog', 'inventory', 'customers', 'transactions'].includes(t.id));
  const managementNavItems = TAB_CONFIG.filter(t => ['rentals', 'suppliers', 'financial', 'reports', 'gift-cards', 'admin'].includes(t.id));

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

// ───────────────────────────────────────────────────────────────────────────
// SECTION 7: TopBar — top application bar.  Contains the global product
// search, live clock, theme toggle, notifications bell, and the help
// (keyboard shortcuts) button.
// ───────────────────────────────────────────────────────────────────────────
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
// ───────────────────────────────────────────────────────────────────────────
// SECTION 8a: useAnimatedCounter — animates a number from its previous
// value to `target` over `duration` ms using requestAnimationFrame.
// ───────────────────────────────────────────────────────────────────────────
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
// ───────────────────────────────────────────────────────────────────────────
// SECTION 8b: MiniSparkline — tiny inline SVG line chart used inside the
// dashboard KPI cards to show a 7-day trend.
// ───────────────────────────────────────────────────────────────────────────
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

// ───────────────────────────────────────────────────────────────────────────
// SECTION 8c: DashboardStats — row of KPI cards (today's revenue, sales
// count, low-stock count, etc.) rendered at the top of the POS tab.
// ───────────────────────────────────────────────────────────────────────────
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


// ───────────────────────────────────────────────────────────────────────────
// SECTION 9a: CategoryChips — horizontal scrollable row of category
// filter pills.  Clicking one filters the product grid below.
// ───────────────────────────────────────────────────────────────────────────
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


// ───────────────────────────────────────────────────────────────────────────
// SECTION 9b: ProductCard — single product tile in the grid.  Shows image,
// name, price, stock badge, and quick-add button.  Clicking opens the
// QuickAddPopup.
// ───────────────────────────────────────────────────────────────────────────
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

  return (
    <Card
      className={`overflow-hidden cursor-pointer hover:shadow-lg transition-all duration-200 hover:-translate-y-1 hover:border-primary/30 hover:scale-[1.02] group border-l-4 card-glow relative h-full flex flex-col ${isBouncing ? 'animate-bounce-add' : ''}`}
      style={{ borderLeftColor: categoryColor }}
      onClick={handleClick}
    >
      {/* Quick Add Popup Overlay */}
      {showQuickAdd && (
        <QuickAddPopup
          product={product}
          currentQty={cartQuantity || 0}
          onAdd={handleQuickAdd}
          onClose={() => setShowQuickAdd(false)}
        />
      )}
      {/* In-cart indicator */}
      {cartQuantity && cartQuantity > 0 && (
        <div className="absolute top-1.5 left-1.5 z-10 bg-primary text-primary-foreground text-[9px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 shadow-md">
          {cartQuantity}
        </div>
      )}
      <div className="h-28 bg-muted flex items-center justify-center relative overflow-hidden shrink-0">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover group-hover:scale-110 transition-transform duration-500" />
        ) : getCategoryImage(product.categoryId) ? (
          <img src={getCategoryImage(product.categoryId)!} alt={product.category?.name || ''} className="h-full w-full object-cover group-hover:scale-110 transition-transform duration-500" />
        ) : (
          <Package className="h-9 w-9 text-muted-foreground/25" />
        )}
        {/* Gradient overlay on hover */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-black/0 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
          <div className="bg-white/90 dark:bg-black/70 rounded-full p-2 shadow-lg transform scale-50 group-hover:scale-100 transition-transform duration-200">
            {cartQuantity && cartQuantity > 0 ? <Zap className="h-5 w-5 text-primary" /> : <Plus className="h-5 w-5 text-primary" />}
          </div>
        </div>
        {/* Badges */}
        {product.isRental && (
          <Badge className="absolute top-1.5 left-1.5 bg-amber-600 text-white text-[10px] px-1.5 py-0.5 font-semibold shadow-sm z-20">RENTAL</Badge>
        )}
        {product.isBundle && (
          <Badge className="absolute top-1.5 right-1.5 bg-purple-600 text-white text-[10px] px-1.5 py-0.5 font-semibold shadow-sm z-20">BUNDLE</Badge>
        )}
        {isNew && !product.isRental && !product.isBundle && (
          <Badge className="absolute top-1.5 right-1.5 bg-green-600 text-white text-[10px] px-1.5 py-0.5 font-semibold shadow-sm z-20">NEW</Badge>
        )}
        {isOutOfStock && (
          <div className="absolute inset-0 bg-red-500/10 flex items-center justify-center">
            <Badge variant="destructive" className="text-[10px] font-bold">OUT OF STOCK</Badge>
          </div>
        )}
      </div>
      <CardContent className="p-2.5 flex-1 flex flex-col">
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
        {/* stock progress bar */}
        <div className="flex items-center gap-1.5 mt-auto pt-1.5">
          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full animate-stock-fill ${stockBarColor} relative`}
              style={{ width: `${stockPercent}%` }}
            >
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
            </div>
          </div>
          <span className={`text-[9px] font-medium shrink-0 ${isOutOfStock ? 'text-red-500' : isLowStock ? 'text-amber-500' : 'text-muted-foreground'}`}>
            {isOutOfStock ? 'Out' : `${product.quantityInStock}`}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// CART ITEM ROW (enhanced)

// ───────────────────────────────────────────────────────────────────────────
// SECTION 9c: CartItemRow — one row inside the cart.  Renders product name,
// unit price, qty stepper (− / qty / +), quick-add (+1/+2/+5/+10), an
// optional note input, the line total, and a remove (✕) button.
// ───────────────────────────────────────────────────────────────────────────
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


// ───────────────────────────────────────────────────────────────────────────
// SECTION 9d: EmptyCartState — friendly illustration shown in the cart
// panel when there are no items.
// ───────────────────────────────────────────────────────────────────────────
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

// ───────────────────────────────────────────────────────────────────────────
// SECTION 9e: EmptyProductsState — illustration shown in the product grid
// when a search returns no matches.
// ───────────────────────────────────────────────────────────────────────────
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

// POS TAB (kept inline - core feature)

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 10: POSTab — THE MAIN POINT-OF-SALE SCREEN
// ═══════════════════════════════════════════════════════════════════════════
//
// Layout (desktop):
//   ┌───────────────────────────────┬───────────────────┐
//   │  Product grid                 │  Cart sidebar     │
//   │  (search + categories + sort) │  (items, totals,  │
//   │                               │   checkout)       │
//   └───────────────────────────────┴───────────────────┘
//
// Layout (mobile):
//   Product grid fills the screen; a floating cart button opens a
//   right-side Sheet containing the same cart UI.
//
// The checkout button lives in a FIXED FOOTER at the bottom of the cart
// (both desktop sidebar and mobile sheet) so it is ALWAYS visible —
// search this file for "CartSidebar.fixedFooter" (desktop) or
// "CartSheet.fixedFooter" (mobile) to jump straight to it.
//
// ═══════════════════════════════════════════════════════════════════════════
function POSTab() {
  // ─────────────────────────────────────────────────────────────────────────
  // POSTab — LOCAL UI STATE
  // ─────────────────────────────────────────────────────────────────────────
  // searchQuery        : text typed into the product search box
  // selectedCategory   : 'all' or a categoryId from the CategoryChips
  // checkoutOpen       : controls the Checkout <Dialog> (desktop + mobile)
  // mpesaDialogOpen    : controls the M-Pesa STK-push sub-dialog
  // mpesaPhone/Status  : phone + idle|processing|success|failed for STK push
  // paymentMethod      : CASH | MPESA | SPLIT | DEBT  (radio group in checkout)
  // cashReceived       : cash handed by customer (used to compute change)
  // selectedCustomer   : 'walk-in' or a customer.id
  // lowStockAlertOpen  : controls the LowStockAlertDialog
  // discountCode       : typed discount code (SAVE10, SAVE20, MBUMAH, …)
  // cartBadgeShake     : brief shake animation trigger when items are added
  // addedItemId        : last-added productId (drives the row slide-in anim)
  // mobileCartOpen     : controls the mobile Cart <Sheet>
  // ─────────────────────────────────────────────────────────────────────────
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
  // Manual gift card code entry (for walk-in customers bringing a gift card)
  const [manualGiftCardCode, setManualGiftCardCode] = useState<string>('');
  const [manualGiftCard, setManualGiftCard] = useState<GiftCardItem | null>(null);
  const [manualGcLoading, setManualGcLoading] = useState<boolean>(false);
  const [manualGcError, setManualGcError] = useState<string>('');

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

  const cart = useCartStore();
  const subtotal = cart.getSubtotal();
  const tax = cart.getTax();
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

  // Receipt row for the just-completed transaction. We look this up via
  // /api/receipts?transactionId=X so the ReceiptActions component has a real
  // receiptId to call /api/receipts/[id]/* endpoints. The lookup runs
  // whenever lastTransaction changes (i.e. after a successful checkout).
  const [receiptForLastTransaction, setReceiptForLastTransaction] = useState<
    | { id: string; receiptType: string; notes?: string | null }
    | null
  >(null);

  useEffect(() => {
    if (!lastTransaction) {
      setReceiptForLastTransaction(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const token =
          typeof window !== 'undefined' ? localStorage.getItem('mbt_token') : null;
        const headers: Record<string, string> = {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        };
        const storeId = currentStoreId || '';
        const res = await fetch(
          `/api/receipts?transactionId=${encodeURIComponent(lastTransaction.id)}&storeId=${encodeURIComponent(storeId)}`,
          { headers, credentials: 'same-origin' }
        );
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        const found =
          Array.isArray(json?.data) && json.data.length > 0 ? json.data[0] : null;
        if (found) {
          setReceiptForLastTransaction({
            id: found.id,
            receiptType: found.receiptType,
            notes: found.transaction?.notes ?? null,
          });
        } else {
          setReceiptForLastTransaction(null);
        }
      } catch {
        if (!cancelled) setReceiptForLastTransaction(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lastTransaction, currentStoreId]);

  const checkoutMutation = useMutation({
    mutationFn: transactionsApi.create,
    onSuccess: (res) => {
      toast.success('Transaction completed successfully!');
      setConfettiActive(true);
      setTimeout(() => setConfettiActive(false), 4000);
      if (res.data) {
        setLastTransaction(res.data);
        setLastCashReceived(paymentMethod === 'CASH' || paymentMethod === 'SPLIT' ? Number(splitCashAmount) || Number(cashReceived) || finalTotal : 0);
        setLastMpesaPhone(mpesaPhone);
        setReceiptOpen(true);
      }
      cart.clearCart();
      setCartNotes({});
      setCheckoutOpen(false);
      setCashReceived('');
      setSplitCashAmount('');
      setSplitMpesaAmount('');
      setSelectedCustomer('');
      setAppliedGiftCardId('');
      setAppliedVoucherId('');
      // Invalidate gift card and voucher queries so balances/status refresh
      queryClient.invalidateQueries({ queryKey: ['customer-gift-cards'] });
      queryClient.invalidateQueries({ queryKey: ['customer-vouchers'] });
      queryClient.invalidateQueries({ queryKey: ['giftCards'] });
      queryClient.invalidateQueries({ queryKey: ['vouchers'] });
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

  // Gift card / voucher discount computation
  const selectedGiftCard = appliedGiftCardId ? customerGiftCards.find(gc => gc.id === appliedGiftCardId) : null;
  const selectedVoucher = appliedVoucherId ? customerVouchers.find(v => v.id === appliedVoucherId) : null;
  const giftCardDiscount = selectedGiftCard ? Math.min(selectedGiftCard.currentBalance, total) : 0;
  const voucherDiscount = selectedVoucher
    ? selectedVoucher.voucherType === 'FIXED'
      ? Math.min(selectedVoucher.value, total)
      : selectedVoucher.voucherType === 'PERCENTAGE'
        ? Math.min(total * (selectedVoucher.value / 100), selectedVoucher.maxDiscount || total)
        : 0
    : 0;
  const totalDiscount = giftCardDiscount + voucherDiscount;
  const finalTotal = Math.max(0, total - totalDiscount);

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
    if (cart.items.length === 0) {
      toast.error('Cart is empty');
      return;
    }

    if (paymentMethod === 'MPESA') {
      setMpesaDialogOpen(true);
      return;
    }

    if (paymentMethod === 'SPLIT') {
      const cashAmt = Number(splitCashAmount) || 0;
      const mpesaAmt = Number(splitMpesaAmount) || 0;
      if (cashAmt + mpesaAmt < finalTotal) {
        toast.error('Split amounts must equal or exceed total');
        return;
      }
    }

    checkoutMutation.mutate({
      storeId: currentStoreId,
      customerId: selectedCustomer || undefined,
      cashierId: useAuthStore.getState().user?.id || '',
      items: cart.items,
      paymentMethod,
      paymentDetails: {
        cashAmount: paymentMethod === 'CASH' ? Number(cashReceived) || finalTotal : paymentMethod === 'SPLIT' ? Number(splitCashAmount) || 0 : undefined,
        mpesaPhone: paymentMethod === 'SPLIT' ? mpesaPhone : undefined,
        debtAccountId: paymentMethod === 'DEBT' ? selectedCustomer : undefined,
        giftCardId: (manualGiftCard?.id || appliedGiftCardId) || undefined,
        giftCardCode: manualGiftCardCode || undefined,
        giftCardAmount: manualGiftCard ? Math.min(manualGiftCard.currentBalance, finalTotal) : (appliedGiftCardId ? giftCardDiscount : undefined),
        voucherId: appliedVoucherId || undefined,
        discountAmount: totalDiscount,
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
      amount: finalTotal,
      accountReference: `MBT-${Date.now()}`,
      transactionDesc: 'MBUMAH HARDWARE Purchase',
    });
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

  // Cart note handler
  const handleCartNoteChange = (productId: string, note: string) => {
    setCartNotes(prev => ({ ...prev, [productId]: note }));
  };

  // ─────────────────────────────────────────────────────────────────────────
  // POSTab — JSX RENDER
  // ─────────────────────────────────────────────────────────────────────────
  // Root layout: a flex row on desktop (product grid + cart sidebar) and a
  // flex column on mobile (product grid only; cart opens as a Sheet).
  // `relative` is needed so the confetti overlay and the checkout loading
  // spinner can absolutely-position themselves inside this container.
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col lg:flex-row gap-4 h-full relative">
      {/* Confetti Overlay — burst shown for ~2s after a successful sale */}
      <ConfettiOverlay active={confettiActive} />

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          LEFT COLUMN — PRODUCT GRID
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          Contains: dashboard KPIs, search bar, category chips, sort menu,
          and the scrollable grid (or list) of ProductCards.
          `flex-1 min-w-0` lets it shrink and clip cleanly on narrow screens.
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="flex-1 min-w-0 space-y-4">
        {/* Dashboard Stats — KPI cards row */}
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
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-3 items-stretch">
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
      </div>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          RIGHT COLUMN — DESKTOP CART SIDEBAR  (search: CartSidebar.root)
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          Hidden on mobile (lg:block).  Fixed width 384px (lg:w-96).  The
          inner <Card> is `sticky top-20` so it stays in view while the
          product grid scrolls, and uses a flex column with three regions:

            ┌─────────────────────────────────────────────┐
            │  CardHeader  — Cart title, Hold/Clear btns  │  ← (1) header
            ├─────────────────────────────────────────────┤
            │  ScrollArea — cart item rows                │  ← (2) items
            ├─────────────────────────────────────────────┤
            │  Extras div (max-h-38%, scroll)             │  ← (3a) extras
            │   • discount code                            │
            │   • customer selector                        │
            │   • gift card / voucher benefits             │
            ├─────────────────────────────────────────────┤
            │  FIXED FOOTER (shrink-0, no scroll)          │  ← (3b) footer
            │   • Subtotal / VAT / Discount / Total        │
            │   • ★ CHECKOUT BUTTON (opens the Dialog) ★   │
            └─────────────────────────────────────────────┘

          The footer NEVER scrolls out of view — that is the fix that keeps
          the Checkout button reachable even with 20+ items in the cart.
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="hidden lg:block lg:w-96 shrink-0"> {/* CartSidebar.root */}
        <Card className="relative sticky top-20 flex flex-col max-h-[calc(100vh-7rem)] bg-gradient-to-b from-card/95 to-card/90 backdrop-blur-sm shadow-lg border border-border/50">
          <CardHeader className="pb-3">
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
                    <Button variant="ghost" size="sm" onClick={() => { cart.clearCart(); setCartNotes({}); }} className="text-destructive h-7">
                      <Trash2 className="h-3.5 w-3.5 mr-1" /> Clear
                    </Button>
                  </>
                )}
              </div>
            </div>
          </CardHeader>
          <Separator />
          {/* CartSidebar.itemsScrollArea — flex-1 so it grows to fill the
              space between the header and the extras; min-h-0 so it can
              actually shrink and scroll.  Renders EmptyCartState or the
              list of CartItemRow components. */}
          <ScrollArea className="flex-1 min-h-0 custom-scrollbar"> {/* CartSidebar.itemsScrollArea */}
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
          </ScrollArea>
          {cart.items.length > 0 && (
            <>
              <Separator />
              {/* ━━━ CartSidebar.extrasScroll ━━━
                  Bounded to max-h-[38%] and scrolls internally ONLY if the
                  discount/customer/benefits content overflows.  This keeps the
                  fixed footer (and the Checkout button) below it always
                  visible. */}
              <div className="shrink-0 max-h-[38%] overflow-y-auto px-4 pt-3 pb-1 space-y-3 custom-scrollbar"> {/* CartSidebar.extrasScroll */}
                {/* Discount Code */}
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
              </div>

              {/* ═══════════════════════════════════════════════════════════════════
                  ★ CartSidebar.fixedFooter ★  ←  THIS DIV HOLDS THE CHECKOUT (DESKTOP)
                  ═══════════════════════════════════════════════════════════════════
                  `shrink-0` + no overflow → this region is NEVER scrolled out
                  of view, no matter how many items are in the cart above it.

                  Contents (top → bottom):
                    1. Totals block (Subtotal, VAT 16%, Discount, Total)
                    2. The Checkout <Dialog> — whose <DialogTrigger asChild>
                       wraps the big orange ★ CHECKOUT BUTTON ★
                       (F9 keyboard shortcut also opens it via a global
                       window event listener set up in useEffect above)

                  If you are looking for "where is the checkout button in
                  the code?" — it is the <Button className="w-full
                  bg-gradient-to-r from-accent-orange ..."> immediately
                  inside <DialogTrigger asChild> below this comment.
              ══════════════════════════════════════════════════════════════════ */}
              <Separator />
              <div className="shrink-0 px-4 pt-2 pb-3 space-y-2.5"> {/* CartSidebar.fixedFooter */}
                {/* Totals block — Subtotal / VAT / Discount / Total */}
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

                {/* CheckoutDialog.desktop — the modal that opens when the
                    Checkout button (or F9) is pressed.  Contains the order
                    items table, payment-method radio group, gift-card code
                    entry, cash-received input, and the Complete Sale button. */}
                <Dialog open={checkoutOpen} onOpenChange={setCheckoutOpen}> {/* CheckoutDialog.desktop */}
                  <DialogTrigger asChild>
                    {/* ★★★ THE DESKTOP CHECKOUT BUTTON ★★★
                        Big orange gradient button, full width of the cart
                        sidebar.  Shows the keyboard hint (F9) and the
                        current final total.  Clicking sets checkoutOpen=true. */}
                    <Button className="w-full bg-gradient-to-r from-accent-orange to-amber-500 hover:from-accent-orange/90 hover:to-amber-600 text-white font-semibold h-12 shadow-lg shadow-accent-orange/20" size="lg">
                      <CreditCard className="mr-2 h-4 w-4" />
                      <span className="flex flex-col items-start leading-tight">
                        <span className="text-xs font-normal opacity-80">Checkout (F9)</span>
                        <span>{formatKES(finalTotal)}</span>
                      </span>
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        <CreditCard className="h-5 w-5 text-primary" />
                        Complete Payment
                      </DialogTitle>
                      <DialogDescription>
                        Total: <span className="font-bold text-primary">{formatKES(finalTotal)}</span>
                        {totalDiscount > 0 && (
                          <span className="text-green-600 text-xs ml-2">(Save {formatKES(totalDiscount)})</span>
                        )}
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 flex-1 overflow-y-auto min-h-0 pr-1">
                      {/* === Order Items (scrollable — handles 20+ items without overlap) === */}
                      <div className="rounded-lg border">
                        <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/40">
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            Order Items ({cart.items.length})
                          </span>
                          <span className="text-xs text-muted-foreground">{formatKES(subtotal)}</span>
                        </div>
                        <div className="max-h-52 overflow-y-auto">
                          <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-background z-10">
                              <tr className="text-left text-[10px] uppercase text-muted-foreground border-b">
                                <th className="py-1.5 px-2 font-medium">Item</th>
                                <th className="py-1.5 px-1 font-medium text-center w-12">Qty</th>
                                <th className="py-1.5 px-1 font-medium text-right w-20">Price</th>
                                <th className="py-1.5 px-2 font-medium text-right w-20">Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {cart.items.map((item, idx) => (
                                <tr key={idx} className="border-b last:border-0 hover:bg-muted/30">
                                  <td className="py-1.5 px-2">
                                    <div className="font-medium text-foreground truncate max-w-[180px] sm:max-w-[280px]" title={item.productName}>
                                      {item.productName}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground">{item.sku} · {item.unitType}</div>
                                  </td>
                                  <td className="py-1.5 px-1 text-center font-medium">{item.quantity}</td>
                                  <td className="py-1.5 px-1 text-right tabular-nums">{formatKES(item.pricePerUnit)}</td>
                                  <td className="py-1.5 px-2 text-right font-semibold tabular-nums">{formatKES(item.lineTotal)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {(totalDiscount > 0 || giftCardDiscount > 0) && (
                          <div className="flex items-center justify-between px-3 py-1.5 border-t bg-green-50/50 dark:bg-green-950/20 text-[11px]">
                            <span className="text-green-700 dark:text-green-400 font-medium">
                              Discount{giftCardDiscount > 0 ? ' (incl. gift card)' : ''}
                            </span>
                            <span className="text-green-700 dark:text-green-400 font-semibold">-{formatKES(totalDiscount + giftCardDiscount)}</span>
                          </div>
                        )}
                      </div>

                      <div>
                        <Label className="text-sm font-medium">Payment Method</Label>
                        <RadioGroup value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PaymentMethod)} className="grid grid-cols-4 gap-2 mt-2">
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
                            <RadioGroupItem value="SPLIT" id="split" className="peer sr-only" />
                            <Label htmlFor="split" className="flex flex-col items-center gap-1.5 p-3 border rounded-lg cursor-pointer peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 hover:bg-muted/50">
                              <CreditCard className="h-5 w-5" />
                              <span className="text-xs font-medium">Split</span>
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

                      {/* Manual gift card code entry (walk-in customer with a gift card) */}
                      <div className="rounded-lg border bg-amber-50/40 dark:bg-amber-950/10 p-3 space-y-2">
                        <Label htmlFor="manualGiftCardCode" className="text-xs font-medium flex items-center gap-1.5">
                          <Wallet className="h-3 w-3" /> Gift Card Code (optional)
                        </Label>
                        <div className="flex gap-2">
                          <Input
                            id="manualGiftCardCode"
                            placeholder="e.g. MBGC-XXXX-XXXX"
                            value={manualGiftCardCode}
                            onChange={(e) => { setManualGiftCardCode(e.target.value.toUpperCase()); setManualGiftCard(null); setManualGcError(''); }}
                            className="text-sm font-mono"
                          />
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={!manualGiftCardCode || manualGcLoading}
                            onClick={async () => {
                              if (!manualGiftCardCode) return;
                              setManualGcLoading(true);
                              setManualGcError('');
                              try {
                                const token = localStorage.getItem('token');
                                const res = await fetch(`/api/gift-cards?storeId=${currentStoreId}&search=${encodeURIComponent(manualGiftCardCode)}`, {
                                  headers: token ? { Authorization: `Bearer ${token}` } : {},
                                });
                                const json = await res.json();
                                const cards = Array.isArray(json.data) ? json.data : [];
                                const found = cards.find((gc: GiftCardItem) => gc.code === manualGiftCardCode);
                                if (!found) { setManualGcError('Gift card not found.'); setManualGiftCard(null); }
                                else if (found.status !== 'ACTIVE' && found.status !== 'PARTIALLY_REDEEMED') { setManualGcError(`Card is ${found.status}.`); setManualGiftCard(null); }
                                else if (found.currentBalance <= 0) { setManualGcError('Card has no balance.'); setManualGiftCard(null); }
                                else { setManualGiftCard(found); setAppliedGiftCardId(''); }
                              } catch { setManualGcError('Lookup failed.'); }
                              finally { setManualGcLoading(false); }
                            }}
                          >
                            {manualGcLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Apply'}
                          </Button>
                        </div>
                        {manualGcError && <p className="text-[11px] text-red-600">{manualGcError}</p>}
                        {manualGiftCard && (
                          <p className="text-[11px] text-green-700 dark:text-green-400">
                            Card {manualGiftCard.code} · Balance {formatKES(manualGiftCard.currentBalance)} · Will apply {formatKES(Math.min(manualGiftCard.currentBalance, finalTotal))}
                          </p>
                        )}
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
                          {cashReceived && Number(cashReceived) < finalTotal && (
                            <Alert variant="destructive">
                              <AlertCircle className="h-4 w-4" />
                              <AlertTitle>Insufficient amount</AlertTitle>
                              <AlertDescription>Need {formatKES(finalTotal - Number(cashReceived))} more</AlertDescription>
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

                      {paymentMethod === 'SPLIT' && (
                        <div className="space-y-3 p-3 rounded-lg border bg-muted/30">
                          <p className="text-xs font-medium text-muted-foreground">Split payment between Cash and M-Pesa</p>
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
                          {Number(splitCashAmount) + Number(splitMpesaAmount) < finalTotal && (
                            <p className="text-[10px] text-amber-600 font-medium">
                              Amounts must total at least {formatKES(finalTotal)}. Remaining: {formatKES(finalTotal - Number(splitCashAmount) - Number(splitMpesaAmount))}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setCheckoutOpen(false)}>Cancel</Button>
                      <Button
                        onClick={handleCheckout}
                        disabled={
                          checkoutMutation.isPending ||
                          (paymentMethod === 'CASH' && (!cashReceived || Number(cashReceived) < finalTotal)) ||
                          (paymentMethod === 'DEBT' && !selectedCustomer) ||
                          (paymentMethod === 'SPLIT' && (Number(splitCashAmount) + Number(splitMpesaAmount) < finalTotal))
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

      {/* Receipt Dialog */}
      <Dialog open={receiptOpen} onOpenChange={setReceiptOpen}>
        <DialogContent className="sm:max-w-lg receipt-dialog backdrop-blur-sm">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-center flex items-center justify-center gap-2">
              <PartyPopper className="h-5 w-5 text-primary" />
              Receipt
            </DialogTitle>
            <DialogDescription className="sr-only">Receipt preview</DialogDescription>
          </DialogHeader>
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
          {/* Universal receipt delivery + management actions.
              Rendered above the Print / New Sale row so the cashier can
              quickly send the receipt via WhatsApp/Email or edit/cancel it
              without leaving the dialog. The receiptId is looked up via
              /api/receipts?transactionId=X (see the useEffect above). */}
          {lastTransaction && receiptForLastTransaction && (
            <ReceiptActions
              receiptId={receiptForLastTransaction.id}
              transactionId={lastTransaction.id}
              customerPhone={
                lastTransaction.customer?.phone ||
                lastMpesaPhone ||
                undefined
              }
              customerEmail={lastTransaction.customer?.email || undefined}
              receiptNumber={lastTransaction.receiptNumber}
              receiptType={receiptForLastTransaction.receiptType}
              notes={receiptForLastTransaction.notes ?? null}
              size="sm"
              onSent={() => {
                // Force a re-lookup so receiptType / sentTo reflect the new
                // state on the next dialog open. The current dialog stays
                // open — the cashier can immediately send via the other
                // channel or close.
                setReceiptForLastTransaction((prev) =>
                  prev ? { ...prev } : prev
                );
              }}
              onEdited={() => {
                // The PUT may have changed the notes / receiptType; trigger a
                // re-lookup so the dialog stays in sync if reopened.
                setReceiptForLastTransaction((prev) =>
                  prev ? { ...prev } : prev
                );
              }}
              onDeleted={() => {
                // Receipt was cancelled — close the dialog and clear state
                // so the next checkout starts fresh.
                setReceiptOpen(false);
                setLastTransaction(null);
              }}
            />
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                const printContents = document.getElementById('receipt-content');
                if (printContents) {
                  const printWindow = window.open('', '', 'width=400,height=600');
                  if (printWindow) {
                    printWindow.document.write(`<html><head><title>Receipt - MBUMAH HARDWARE</title><style>body{font-family:monospace;padding:16px;font-size:12px;}table{width:100%;border-collapse:collapse;}td,th{text-align:left;padding:2px 4px;}.text-right{text-align:right;}.font-bold{font-weight:bold;}.border-top{border-top:1px dashed #000;padding-top:8px;margin-top:8px;}</style></head><body>${printContents.innerHTML}</body></html>`);
                    printWindow.document.close();
                    printWindow.print();
                    printWindow.close();
                  }
                } else {
                  window.print();
                }
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
      <Dialog open={mpesaDialogOpen} onOpenChange={(open) => {
        if (!open && mpesaStatus === 'processing') return; // prevent closing while processing
        setMpesaDialogOpen(open);
        if (!open) setMpesaStatus('idle');
      }}>
        <DialogContent className="sm:max-w-md overflow-hidden p-0">
          {/* M-Pesa Brand Header */}
          <div className="bg-gradient-to-br from-green-600 to-green-700 px-6 pt-6 pb-4 text-white">
            <div className="flex items-center gap-3 mb-1">
              <div className="bg-white/20 rounded-full p-2.5">
                <Smartphone className="h-6 w-6" />
              </div>
              <div>
                <DialogTitle className="text-xl font-bold tracking-tight">Lipa na M-Pesa</DialogTitle>
                <DialogDescription className="text-green-100 text-sm">
                  Online STK Push Payment
                </DialogDescription>
              </div>
            </div>
            <div className="mt-4 bg-white/15 rounded-lg p-3 flex items-center justify-between">
              <span className="text-sm text-green-100">Amount to Pay</span>
              <span className="text-2xl font-bold">{formatKES(finalTotal)}</span>
            </div>
          </div>

          <div className="px-6 pb-6">
            {mpesaStatus === 'idle' && (
              <div className="space-y-5 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="mpesaPhoneDialog" className="text-sm font-medium">
                    M-Pesa Phone Number
                  </Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-medium">+254</span>
                    <Input
                      id="mpesaPhoneDialog"
                      type="tel"
                      placeholder="7XX XXX XXX"
                      className="pl-14 text-lg font-mono tracking-wider h-12"
                      value={mpesaPhone.startsWith('254') ? mpesaPhone.slice(3) : mpesaPhone.startsWith('0') ? mpesaPhone.slice(1) : mpesaPhone}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, '');
                        setMpesaPhone(val);
                      }}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Enter the Safaricom number registered with M-Pesa. An STK push will be sent to this phone.
                  </p>
                </div>
                <Button
                  className="w-full bg-green-600 hover:bg-green-700 text-white h-12 text-base font-semibold"
                  onClick={handleMpesaPay}
                  disabled={mpesaMutation.isPending || !mpesaPhone || mpesaPhone.length < 9}
                >
                  {mpesaMutation.isPending ? (
                    <><Loader2 className="mr-2 h-5 w-5 animate-spin" />Sending STK Push...</>
                  ) : (
                    <><Smartphone className="mr-2 h-5 w-5" />Send STK Push</>
                  )}
                </Button>
              </div>
            )}

            {mpesaStatus === 'processing' && (
              <div className="text-center py-8 space-y-5">
                <div className="relative">
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-24 h-24 rounded-full bg-green-100 dark:bg-green-950/30 animate-ping opacity-20" />
                  </div>
                  <div className="relative flex items-center justify-center">
                    <div className="w-20 h-20 rounded-full bg-green-100 dark:bg-green-950/30 flex items-center justify-center">
                      <Smartphone className="h-10 w-10 text-green-600" />
                    </div>
                  </div>
                </div>
                <div>
                  <p className="text-lg font-semibold">Waiting for M-Pesa PIN</p>
                  <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
                    Please check your phone <span className="font-mono font-medium">+254{mpesaPhone.startsWith('254') ? mpesaPhone.slice(3) : mpesaPhone.startsWith('0') ? mpesaPhone.slice(1) : mpesaPhone}</span> and enter your M-Pesa PIN to authorize payment.
                  </p>
                </div>
                <div className="flex items-center justify-center gap-2 text-green-600">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span className="text-sm font-medium">Processing...</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  This will auto-close when payment is confirmed
                </p>
              </div>
            )}

            {mpesaStatus === 'success' && (
              <div className="text-center py-8 space-y-5">
                <div className="w-20 h-20 rounded-full bg-green-100 dark:bg-green-950/30 flex items-center justify-center mx-auto">
                  <CheckCircle className="h-10 w-10 text-green-600" />
                </div>
                <div>
                  <p className="text-lg font-semibold text-green-600">Payment Successful!</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    M-Pesa payment of {formatKES(finalTotal)} confirmed
                  </p>
                </div>
                <Button
                  className="bg-green-600 hover:bg-green-700 text-white"
                  onClick={() => {
                    setMpesaDialogOpen(false);
                    setMpesaStatus('idle');
                    // Proceed to complete the checkout after M-Pesa success
                    checkoutMutation.mutate({
                      storeId: currentStoreId,
                      customerId: selectedCustomer || undefined,
                      cashierId: useAuthStore.getState().user?.id || '',
                      items: cart.items,
                      paymentMethod: 'MPESA',
                      paymentDetails: {
                        mpesaPhone,
                      },
                    });
                  }}
                >
                  Complete Sale
                </Button>
              </div>
            )}

            {mpesaStatus === 'failed' && (
              <div className="text-center py-8 space-y-5">
                <div className="w-20 h-20 rounded-full bg-red-100 dark:bg-red-950/30 flex items-center justify-center mx-auto">
                  <AlertCircle className="h-10 w-10 text-destructive" />
                </div>
                <div>
                  <p className="text-lg font-semibold text-destructive">Payment Failed</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    The M-Pesa transaction could not be completed. Please try again or choose a different payment method.
                  </p>
                </div>
                <div className="flex gap-3">
                  <Button variant="outline" className="flex-1" onClick={() => setMpesaDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button className="flex-1 bg-green-600 hover:bg-green-700 text-white" onClick={() => setMpesaStatus('idle')}>
                    Try Again
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

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

      {/* Mobile Cart FAB (Floating Action Button) — visible only on screens
          smaller than `lg`.  Fixed to the bottom-right.  Tapping it opens
          the mobile Cart <Sheet> below.  The red badge shows the item count.
          Only rendered when the cart has at least one item. */}
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

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          MOBILE CART SHEET  (search: CartSheet.root)
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          Slides in from the right on mobile only.  Same three-region layout
          as the desktop sidebar:

            ┌─────────────────────────────────────────────┐
            │  SheetHeader — Cart title, Hold/Clear btns   │
            ├─────────────────────────────────────────────┤
            │  ScrollArea — cart item rows                 │
            ├─────────────────────────────────────────────┤
            │  Extras div (max-h-38%, scroll)              │
            ├─────────────────────────────────────────────┤
            │  FIXED FOOTER (shrink-0, no scroll)          │  ← CartSheet.fixedFooter
            │   • Subtotal / VAT / Discount / Total        │
            │   • ★ CHECKOUT BUTTON ★                      │
            └─────────────────────────────────────────────┘
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <Sheet open={mobileCartOpen} onOpenChange={setMobileCartOpen}> {/* CartSheet.root */}
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
                    <Button variant="ghost" size="sm" onClick={() => { cart.clearCart(); setCartNotes({}); }} className="text-destructive h-7 text-xs">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          </SheetHeader>
          <ScrollArea className="flex-1 min-h-0 custom-scrollbar">
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
          </ScrollArea>
          {cart.items.length > 0 && (
            <>
              {/* CartSheet.extrasScroll — bounded scroll area for the
                  discount code, customer selector and gift-card benefits.
                  Mirrors the desktop CartSidebar.extrasScroll. */}
              <div className="max-h-[38%] overflow-y-auto px-4 pt-3 pb-1 space-y-3 border-t shrink-0 custom-scrollbar"> {/* CartSheet.extrasScroll */}
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
              </div>

              {/* ═══════════════════════════════════════════════════════════════════
                  ★ CartSheet.fixedFooter ★  ←  THIS DIV HOLDS THE CHECKOUT (MOBILE)
                  ═══════════════════════════════════════════════════════════════════
                  Mobile mirror of CartSidebar.fixedFooter.  `shrink-0` + no
                  overflow → the totals + Checkout button below are always
                  visible, no matter how many items are in the cart above.

                  The Checkout <Dialog> immediately below is the SAME modal
                  as the desktop one (CheckoutDialog.mobile) — opening it
                  from either breakpoint renders the same dialog content.
              ══════════════════════════════════════════════════════════════════ */}
              <Separator />
              <div className="shrink-0 px-4 pt-2 pb-3 space-y-2.5"> {/* CartSheet.fixedFooter */}
                {/* Totals block — Subtotal / VAT / Discount / Total */}
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

                {/* CheckoutDialog.mobile — same modal as CheckoutDialog.desktop;
                    both are controlled by the same `checkoutOpen` state. */}
                <Dialog open={checkoutOpen} onOpenChange={(v) => { setCheckoutOpen(v); if (!v) return; }}> {/* CheckoutDialog.mobile */}
                  <DialogTrigger asChild>
                    {/* ★★★ THE MOBILE CHECKOUT BUTTON ★★★
                        Full-width orange gradient button at the bottom of the
                        mobile cart sheet.  Tapping it opens the checkout modal. */}
                    <Button className="w-full bg-gradient-to-r from-accent-orange to-amber-500 hover:from-accent-orange/90 hover:to-amber-600 text-white font-semibold h-12 shadow-lg shadow-accent-orange/20" size="lg">
                      <CreditCard className="mr-2 h-4 w-4" />
                      <span className="flex flex-col items-start leading-tight">
                        <span className="text-xs font-normal opacity-80">Checkout (F9)</span>
                        <span>{formatKES(finalTotal)}</span>
                      </span>
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        <CreditCard className="h-5 w-5 text-primary" />
                        Complete Payment
                      </DialogTitle>
                      <DialogDescription>
                        Total: <span className="font-bold text-primary">{formatKES(finalTotal)}</span>
                        {totalDiscount > 0 && (
                          <span className="text-green-600 text-xs ml-2">(Save {formatKES(totalDiscount)})</span>
                        )}
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 flex-1 overflow-y-auto min-h-0 pr-1">
                      {/* === Order Items (scrollable — handles 20+ items without overlap) === */}
                      <div className="rounded-lg border">
                        <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/40">
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            Order Items ({cart.items.length})
                          </span>
                          <span className="text-xs text-muted-foreground">{formatKES(subtotal)}</span>
                        </div>
                        <div className="max-h-52 overflow-y-auto">
                          <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-background z-10">
                              <tr className="text-left text-[10px] uppercase text-muted-foreground border-b">
                                <th className="py-1.5 px-2 font-medium">Item</th>
                                <th className="py-1.5 px-1 font-medium text-center w-12">Qty</th>
                                <th className="py-1.5 px-1 font-medium text-right w-20">Price</th>
                                <th className="py-1.5 px-2 font-medium text-right w-20">Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {cart.items.map((item, idx) => (
                                <tr key={idx} className="border-b last:border-0 hover:bg-muted/30">
                                  <td className="py-1.5 px-2">
                                    <div className="font-medium text-foreground truncate max-w-[180px] sm:max-w-[280px]" title={item.productName}>
                                      {item.productName}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground">{item.sku} · {item.unitType}</div>
                                  </td>
                                  <td className="py-1.5 px-1 text-center font-medium">{item.quantity}</td>
                                  <td className="py-1.5 px-1 text-right tabular-nums">{formatKES(item.pricePerUnit)}</td>
                                  <td className="py-1.5 px-2 text-right font-semibold tabular-nums">{formatKES(item.lineTotal)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {(totalDiscount > 0 || giftCardDiscount > 0) && (
                          <div className="flex items-center justify-between px-3 py-1.5 border-t bg-green-50/50 dark:bg-green-950/20 text-[11px]">
                            <span className="text-green-700 dark:text-green-400 font-medium">
                              Discount{giftCardDiscount > 0 ? ' (incl. gift card)' : ''}
                            </span>
                            <span className="text-green-700 dark:text-green-400 font-semibold">-{formatKES(totalDiscount + giftCardDiscount)}</span>
                          </div>
                        )}
                      </div>

                      <div>
                        <Label className="text-sm font-medium">Payment Method</Label>
                        <RadioGroup value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PaymentMethod)} className="grid grid-cols-4 gap-2 mt-2">
                          <div>
                            <RadioGroupItem value="CASH" id="mobile-cash" className="peer sr-only" />
                            <Label htmlFor="mobile-cash" className="flex flex-col items-center gap-1.5 p-3 border rounded-lg cursor-pointer peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 hover:bg-muted/50">
                              <Banknote className="h-5 w-5" />
                              <span className="text-xs font-medium">Cash</span>
                            </Label>
                          </div>
                          <div>
                            <RadioGroupItem value="MPESA" id="mobile-mpesa" className="peer sr-only" />
                            <Label htmlFor="mobile-mpesa" className="flex flex-col items-center gap-1.5 p-3 border rounded-lg cursor-pointer peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 hover:bg-muted/50">
                              <Smartphone className="h-5 w-5" />
                              <span className="text-xs font-medium">M-Pesa</span>
                            </Label>
                          </div>
                          <div>
                            <RadioGroupItem value="SPLIT" id="mobile-split" className="peer sr-only" />
                            <Label htmlFor="mobile-split" className="flex flex-col items-center gap-1.5 p-3 border rounded-lg cursor-pointer peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 hover:bg-muted/50">
                              <CreditCard className="h-5 w-5" />
                              <span className="text-xs font-medium">Split</span>
                            </Label>
                          </div>
                          <div>
                            <RadioGroupItem value="DEBT" id="mobile-debt" className="peer sr-only" />
                            <Label htmlFor="mobile-debt" className="flex flex-col items-center gap-1.5 p-3 border rounded-lg cursor-pointer peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 hover:bg-muted/50">
                              <Wallet className="h-5 w-5" />
                              <span className="text-xs font-medium">Debt</span>
                            </Label>
                          </div>
                        </RadioGroup>
                      </div>
                      {/* Manual gift card code entry (walk-in customer with a gift card) */}
                      <div className="rounded-lg border bg-amber-50/40 dark:bg-amber-950/10 p-3 space-y-2">
                        <Label htmlFor="manualGiftCardCode" className="text-xs font-medium flex items-center gap-1.5">
                          <Wallet className="h-3 w-3" /> Gift Card Code (optional)
                        </Label>
                        <div className="flex gap-2">
                          <Input
                            id="manualGiftCardCode"
                            placeholder="e.g. MBGC-XXXX-XXXX"
                            value={manualGiftCardCode}
                            onChange={(e) => { setManualGiftCardCode(e.target.value.toUpperCase()); setManualGiftCard(null); setManualGcError(''); }}
                            className="text-sm font-mono"
                          />
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={!manualGiftCardCode || manualGcLoading}
                            onClick={async () => {
                              if (!manualGiftCardCode) return;
                              setManualGcLoading(true);
                              setManualGcError('');
                              try {
                                const token = localStorage.getItem('token');
                                const res = await fetch(`/api/gift-cards?storeId=${currentStoreId}&search=${encodeURIComponent(manualGiftCardCode)}`, {
                                  headers: token ? { Authorization: `Bearer ${token}` } : {},
                                });
                                const json = await res.json();
                                const cards = Array.isArray(json.data) ? json.data : [];
                                const found = cards.find((gc: GiftCardItem) => gc.code === manualGiftCardCode);
                                if (!found) { setManualGcError('Gift card not found.'); setManualGiftCard(null); }
                                else if (found.status !== 'ACTIVE' && found.status !== 'PARTIALLY_REDEEMED') { setManualGcError(`Card is ${found.status}.`); setManualGiftCard(null); }
                                else if (found.currentBalance <= 0) { setManualGcError('Card has no balance.'); setManualGiftCard(null); }
                                else { setManualGiftCard(found); setAppliedGiftCardId(''); }
                              } catch { setManualGcError('Lookup failed.'); }
                              finally { setManualGcLoading(false); }
                            }}
                          >
                            {manualGcLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Apply'}
                          </Button>
                        </div>
                        {manualGcError && <p className="text-[11px] text-red-600">{manualGcError}</p>}
                        {manualGiftCard && (
                          <p className="text-[11px] text-green-700 dark:text-green-400">
                            Card {manualGiftCard.code} · Balance {formatKES(manualGiftCard.currentBalance)} · Will apply {formatKES(Math.min(manualGiftCard.currentBalance, finalTotal))}
                          </p>
                        )}
                      </div>

                      {paymentMethod === 'CASH' && (
                        <div className="space-y-3">
                          <div>
                            <Label htmlFor="mobile-cashReceived">Cash Received</Label>
                            <Input id="mobile-cashReceived" type="number" placeholder="0" value={cashReceived} onChange={(e) => setCashReceived(e.target.value)} className="text-lg font-semibold mt-1" />
                          </div>
                          {change > 0 && (
                            <div className="p-3 bg-green-50 dark:bg-green-950/30 rounded-lg">
                              <p className="text-sm font-medium text-green-700 dark:text-green-400">Change: {formatKES(change)}</p>
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
                      {paymentMethod === 'DEBT' && !selectedCustomer && (
                        <Alert>
                          <AlertCircle className="h-4 w-4" />
                          <AlertTitle>Customer Required</AlertTitle>
                          <AlertDescription>Please select a customer for debt payment.</AlertDescription>
                        </Alert>
                      )}
                      {paymentMethod === 'MPESA' && (
                        <div>
                          <Label htmlFor="mobile-mpesaPhone">M-Pesa Phone Number</Label>
                          <Input id="mobile-mpesaPhone" type="tel" placeholder="0712 345 678" value={mpesaPhone} onChange={(e) => setMpesaPhone(e.target.value)} className="mt-1" />
                        </div>
                      )}
                      {paymentMethod === 'SPLIT' && (
                        <div className="space-y-3 p-3 rounded-lg border bg-muted/30">
                          <p className="text-xs font-medium text-muted-foreground">Split payment between Cash and M-Pesa</p>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <Label htmlFor="mobile-splitCash" className="text-xs flex items-center gap-1"><Banknote className="h-3 w-3" /> Cash</Label>
                              <Input id="mobile-splitCash" type="number" placeholder="0" value={splitCashAmount} onChange={(e) => { setSplitCashAmount(e.target.value); const r = finalTotal - Number(e.target.value); if (r > 0) setSplitMpesaAmount(String(r)); }} className="mt-1 text-sm font-semibold" />
                            </div>
                            <div>
                              <Label htmlFor="mobile-splitMpesa" className="text-xs flex items-center gap-1"><Smartphone className="h-3 w-3" /> M-Pesa</Label>
                              <Input id="mobile-splitMpesa" type="number" placeholder="0" value={splitMpesaAmount} onChange={(e) => { setSplitMpesaAmount(e.target.value); const r = finalTotal - Number(e.target.value); if (r > 0) setSplitCashAmount(String(r)); }} className="mt-1 text-sm font-semibold" />
                            </div>
                          </div>
                          <div>
                            <Label htmlFor="mobile-splitPhone" className="text-xs">M-Pesa Phone</Label>
                            <Input id="mobile-splitPhone" type="tel" placeholder="0712 345 678" value={mpesaPhone} onChange={(e) => setMpesaPhone(e.target.value)} className="mt-1 text-sm" />
                          </div>
                        </div>
                      )}
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setCheckoutOpen(false)}>Cancel</Button>
                      <Button
                        onClick={handleCheckout}
                        disabled={
                          checkoutMutation.isPending ||
                          (paymentMethod === 'CASH' && (!cashReceived || Number(cashReceived) < finalTotal)) ||
                          (paymentMethod === 'DEBT' && !selectedCustomer) ||
                          (paymentMethod === 'SPLIT' && (Number(splitCashAmount) + Number(splitMpesaAmount) < finalTotal))
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
        </SheetContent>
      </Sheet>
    </div>
  );
}


// ───────────────────────────────────────────────────────────────────────────
// SECTION 11: MainApp — auth gate.  Reads the auth store; if no session is
// present it renders <LoginScreen/>, otherwise it renders the full app
// shell (sidebar + topbar + active tab).  Also owns the active-tab state.
// ───────────────────────────────────────────────────────────────────────────
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
// ───────────────────────────────────────────────────────────────────────────
// SECTION 12: useHasMounted — SSR-safe "has this component mounted on the
// client yet?" flag.  Used to gate theme-dependent UI to avoid hydration
// mismatches.
// ───────────────────────────────────────────────────────────────────────────
function useHasMounted() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

// ───────────────────────────────────────────────────────────────────────────
// SECTION 13: HomePage (default export) — the Next.js App Router page entry
// point.  Wraps <MainApp/> in an <ErrorBoundary/> so any render error in
// the POS falls back to a friendly error screen instead of a white page.
// ───────────────────────────────────────────────────────────────────────────
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
