'use client';

/**
 * MBUMAH HARDWARE POS & ERP System - Main Application Page
 * Optimized: recharts removed, tab components lazy-loaded via React.lazy
 */

import React, { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import {
  ShoppingCart, Package, Users, KeyRound, BarChart3, FileText,
  Settings, LogOut, Search, Plus, Minus, Trash2, X, Menu, Sun, Moon,
  CheckCircle, Clock,
  ShoppingBag, CreditCard, Smartphone,
  AlertCircle, Loader2,
  Home, Store, Mail, ShieldCheck, Eye,
  Banknote, Wallet
} from 'lucide-react';

import { useAuthStore, useCartStore, useAppStore, type AppTab } from '@/lib/stores';
import {
  productsApi, categoriesApi, customersApi, transactionsApi,
  paymentsApi,
  formatKES, formatDate, formatDateTime,
  type ProductListItem, type CustomerItem,
  type CategoryItem,
} from '@/lib/api';
import type { PaymentMethod, CartItem, UnitType } from '@/lib/types';

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

// ============================================================================
// LAZY-LOADED TAB COMPONENTS
// ============================================================================

const LazyInventoryTab = lazy(() => import('./tabs/inventory-tab'));
const LazyCustomersTab = lazy(() => import('./tabs/customers-tab'));
const LazyRentalsTab = lazy(() => import('./tabs/rentals-tab'));
const LazyFinancialTab = lazy(() => import('./tabs/financial-tab'));
const LazyReportsTab = lazy(() => import('./tabs/reports-tab'));
const LazyAdminTab = lazy(() => import('./tabs/admin-tab'));

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
  { id: 'admin', label: 'Admin', icon: Settings },
];

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

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[oklch(0.22_0.07_260)] via-[oklch(0.295_0.1_260)] to-[oklch(0.22_0.06_260)] p-4">
      <div className="w-full max-w-md">
        <Card className="shadow-2xl border-0">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto w-16 h-16 rounded-xl bg-primary flex items-center justify-center mb-4">
              <Store className="h-8 w-8 text-primary-foreground" />
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
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
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
          </CardContent>
          <CardFooter className="flex flex-col gap-2 text-sm text-muted-foreground">
            <p>Demo: cashier@mbumahhardware.co.ke / password123</p>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}

// ============================================================================
// SIDEBAR
// ============================================================================

function AppSidebar() {
  const { activeTab, setActiveTab, sidebarOpen, setSidebarOpen } = useAppStore();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { theme, setTheme } = useTheme();

  const handleNav = (tab: AppTab) => {
    setActiveTab(tab);
    setSidebarOpen(false);
  };

  const handleLogout = async () => {
    await logout();
    toast.success('Logged out successfully');
  };

  const navItems = TAB_CONFIG.map(({ id, label, icon: Icon }) => (
    <button
      key={id}
      onClick={() => handleNav(id)}
      className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
        activeTab === id
          ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-sm'
          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span>{label}</span>
    </button>
  ));

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
        className={`fixed top-0 left-0 z-50 h-full w-64 bg-sidebar text-sidebar-foreground transform transition-transform duration-200 ease-in-out lg:translate-x-0 lg:static lg:z-auto ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center gap-3 px-4 py-5 border-b border-sidebar-border">
            <div className="w-9 h-9 rounded-lg bg-sidebar-primary flex items-center justify-center">
              <Store className="h-5 w-5 text-sidebar-primary-foreground" />
            </div>
            <div>
              <h1 className="font-bold text-sm leading-tight">MBUMAH HARDWARE</h1>
              <p className="text-xs text-sidebar-foreground/60">POS & ERP</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto lg:hidden text-sidebar-foreground/60 hover:text-sidebar-foreground"
              onClick={() => setSidebarOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto custom-scrollbar">
            {navItems}
          </nav>

          {/* Footer */}
          <div className="border-t border-sidebar-border px-3 py-3 space-y-2">
            <div className="flex items-center gap-3 px-3 py-2">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-sidebar-accent text-sidebar-accent-foreground text-xs">
                  {user?.name?.split(' ').map(n => n[0]).join('') || 'U'}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{user?.name || 'User'}</p>
                <p className="text-xs text-sidebar-foreground/60 truncate">{user?.role || 'Cashier'}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 px-2">
              <Button
                variant="ghost"
                size="sm"
                className="flex-1 text-sidebar-foreground/70 hover:text-sidebar-foreground"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              >
                {theme === 'dark' ? <Sun className="h-4 w-4 mr-2" /> : <Moon className="h-4 w-4 mr-2" />}
                {theme === 'dark' ? 'Light' : 'Dark'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-sidebar-foreground/70 hover:text-destructive"
                onClick={handleLogout}
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

// ============================================================================
// TOP BAR
// ============================================================================

function TopBar() {
  const { activeTab, toggleSidebar } = useAppStore();
  const cartItemCount = useCartStore((s) => s.getItemCount());
  const currentTab = TAB_CONFIG.find(t => t.id === activeTab);
  const TabIcon = currentTab?.icon || Home;

  return (
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
          {activeTab === 'pos' && (
            <Badge variant="secondary" className="flex items-center gap-1">
              <ShoppingCart className="h-3 w-3" />
              {cartItemCount}
            </Badge>
          )}
          <Badge variant="outline" className="hidden sm:flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {new Date().toLocaleDateString('en-KE', { weekday: 'short', month: 'short', day: 'numeric' })}
          </Badge>
        </div>
      </div>
    </header>
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

  const checkoutMutation = useMutation({
    mutationFn: transactionsApi.create,
    onSuccess: () => {
      toast.success('Transaction completed successfully!');
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
        const poll = setInterval(async () => {
          try {
            const statusRes = await paymentsApi.getMpesaStatus(res.data!.checkoutRequestId);
            if (statusRes.data?.resultCode === '0') {
              setMpesaStatus('success');
              clearInterval(poll);
            } else if (statusRes.data?.resultCode && statusRes.data.resultCode !== '0') {
              setMpesaStatus('failed');
              clearInterval(poll);
            }
          } catch {
            // keep polling
          }
        }, 3000);
        setTimeout(() => clearInterval(poll), 120000);
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
    if (product.quantityInStock <= 0 && !product.isRentalItem) {
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
        {/* Search and Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search products by name, SKU, or barcode..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Products Grid */}
        {productsLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Card key={i} className="overflow-hidden">
                <Skeleton className="h-28" />
                <CardContent className="p-3 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-5 w-2/3" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="text-center py-16">
            <Package className="h-12 w-12 mx-auto text-muted-foreground/40" />
            <p className="mt-4 text-muted-foreground">No products found</p>
            <p className="text-sm text-muted-foreground/60">Try adjusting your search or filters</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {products.map((product) => (
              <Card
                key={product.id}
                className="overflow-hidden cursor-pointer hover:shadow-md transition-all hover:border-primary/30 group"
                onClick={() => handleAddToCart(product)}
              >
                <div className="h-28 bg-muted flex items-center justify-center relative">
                  {product.imageUrl ? (
                    <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" />
                  ) : (
                    <Package className="h-10 w-10 text-muted-foreground/30" />
                  )}
                  {product.isRental && (
                    <Badge className="absolute top-2 left-2 bg-blue-600 text-white text-[10px]">RENTAL</Badge>
                  )}
                  {product.isBundle && (
                    <Badge className="absolute top-2 right-2 bg-purple-600 text-white text-[10px]">BUNDLE</Badge>
                  )}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors flex items-center justify-center">
                    <Plus className="h-8 w-8 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
                  </div>
                </div>
                <CardContent className="p-3">
                  <h3 className="font-medium text-sm truncate">{product.name}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">SKU: {product.sku}</p>
                  <div className="flex items-center justify-between mt-2">
                    <span className="font-bold text-primary text-sm">{formatKES(product.pricePerUnit)}</span>
                    <Badge
                      variant={product.quantityInStock <= product.reorderLevel ? 'destructive' : 'secondary'}
                      className="text-[10px]"
                    >
                      {product.quantityInStock <= 0 ? 'Out' : `${product.quantityInStock} left`}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Cart Sidebar */}
      <div className="lg:w-96 shrink-0">
        <Card className="sticky top-20 flex flex-col max-h-[calc(100vh-7rem)]">
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
              <div className="p-8 text-center">
                <ShoppingBag className="h-10 w-10 mx-auto text-muted-foreground/30" />
                <p className="mt-3 text-sm text-muted-foreground">Cart is empty</p>
                <p className="text-xs text-muted-foreground/60">Click products to add them</p>
              </div>
            ) : (
              <div className="p-4 space-y-3">
                {cart.items.map((item) => (
                  <div key={item.productId} className="flex gap-3 p-2 rounded-lg bg-muted/50">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.productName}</p>
                      <p className="text-xs text-muted-foreground">{formatKES(item.pricePerUnit)} x {item.quantity}</p>
                      {item.discountPercent > 0 && (
                        <p className="text-xs text-green-600">{item.discountPercent}% off</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => cart.updateQuantity(item.productId, item.quantity - 1)}
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="w-6 text-center text-sm font-medium">{item.quantity}</span>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => cart.updateQuantity(item.productId, item.quantity + 1)}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={() => cart.removeItem(item.productId)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
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
                    <Button className="w-full bg-accent-orange hover:bg-accent-orange/90 text-accent-orange-foreground font-semibold" size="lg">
                      <CreditCard className="mr-2 h-4 w-4" />
                      Checkout {formatKES(total)}
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
      case 'admin': return <Suspense fallback={<TabLoadingFallback />}><LazyAdminTab /></Suspense>;
      default: return <POSTab />;
    }
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <AppSidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          {renderTab()}
        </main>
        <footer className="border-t bg-background px-4 py-2 text-center">
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
