'use client';

/**
 * MBUMAH HARDWARE POS — POS Tab
 * Sub-components extracted to src/components/pos/ for maintainability.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuthStore, useCartStore, useAppStore } from '@/lib/stores';
import { getCategoryImage, safeMap } from '@/lib/app-config';
import { STORE_LIST } from '@/lib/store-info';
import { ConfettiOverlay } from '@/components/confetti-overlay';
import {
  productsApi, categoriesApi, customersApi, transactionsApi,
  paymentsApi, giftCardsApi, vouchersApi, whatsappApi,
  formatKES, formatDateTime,
  type ProductListItem, type CustomerItem, type TransactionItem, type GiftCardItem, type VoucherItem,
} from '@/lib/api';
import type { PaymentMethod, CartItem, UnitType, CheckoutPayload } from '@/lib/types';
import { handleError } from '@/lib/error-handler';
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
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ResponsiveDialog } from '@/components/ui/responsive-dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ReceiptPrintPreview } from '@/components/receipt-print';
import {
  ShoppingCart, ShoppingBag, Package, Search, Plus, Trash2, CreditCard,
  Smartphone, Loader2, Banknote, Wallet, Gift,
  Printer, ChevronDown, Tag, LayoutGrid, List, ArrowUpDown,
  ArrowUp, ArrowDown, RefreshCw, Wifi, WifiOff, CloudOff, CloudLightning,
  Send, Pause, UserPlus, Award, Ticket,
  Lightbulb, PartyPopper,
} from 'lucide-react';

// Extracted sub-components
import { EmptyCartState } from '@/components/pos/empty-cart-state';
import { EmptyProductsState } from '@/components/pos/empty-products-state';
import { LowStockAlertDialog } from '@/components/pos/low-stock-alert-dialog';
import { CategoryChips } from '@/components/pos/category-chips';
import { ProductCard } from '@/components/pos/product-card';
import { CartItemRow } from '@/components/pos/cart-item-row';
import { DashboardStats } from '@/components/pos/dashboard-stats';
import { CheckoutDialog } from '@/components/pos/checkout-dialog';
import { HeldCartsDialog, type HeldCartRecord } from '@/components/pos/held-carts-dialog';

// POS TAB (kept inline - core feature)

// Escape HTML special chars for safe inclusion in print-window HTML strings.
export default function POSTab() {
  // AUDIT FIX (Task 3-e): search input value is decoupled from the query that
  // drives the products fetch/grid. searchInput updates instantly (keeps typing
  // + scanning responsive); searchQuery is debounced (200ms) so rapid barcode
  // scans don't thrash the products query and grid re-renders.
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const [clearCartConfirmOpen, setClearCartConfirmOpen] = useState(false);
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

  // AUDIT FIX (Task 3-e): held carts (localStorage 'mbt_held_carts') mirrored in
  // state so the picker is reactive. Replaces the blind LIFO `pop()` recall —
  // any held cart can now be resumed out of order or deleted.
  const [heldCarts, setHeldCarts] = useState<HeldCartRecord[]>([]);
  const [heldCartsOpen, setHeldCartsOpen] = useState(false);
  const refreshHeldCarts = useCallback(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('mbt_held_carts') || '[]');
      setHeldCarts(Array.isArray(raw) ? raw : []);
    } catch {
      setHeldCarts([]);
    }
  }, []);

  useEffect(() => { refreshHeldCarts(); }, [refreshHeldCarts]);

  const authUser = useAuthStore((s) => s.user);
  const cart = useCartStore();
  const subtotal = cart.getSubtotal();
  const tax = cart.getTax();
  // Pre-discount total (subtotal + tax). Used as the base for gift card /
  // voucher discount math so we don't double-count the cart-level discount.
  const preDiscountTotal = subtotal + tax;
  // Cart total after the cashier's flat discount has been applied.
  const _total = cart.getTotal();

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
  const [receiptPrintOpen, setReceiptPrintOpen] = useState(false);
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
        setReceiptPrintOpen(true);
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
        pricePerUnit: Number(product.pricePerUnit) || 0,
        costPrice: Number(product.costPrice) || 0,
        discountPercent: 0,
        taxRate: Number(product.taxRate) || 16,
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

  // AUDIT FIX (Task 3-e): debounce the query that drives the products fetch/grid
  // (200ms) so rapid typing or a burst of scans doesn't thrash re-renders; the
  // input itself stays instantly responsive.
  const handleSearchInput = (value: string) => {
    setSearchInput(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => setSearchQuery(value), 200);
  };

  // AUDIT FIX (Task 3-e): barcode scanner hardening — thermal scanners emit
  // <code>\n, so Enter means "scan finished". An exact (case-insensitive) match
  // on barcode OR SKU goes straight to the cart and the input is cleared, making
  // scan → in-cart deterministic and preventing concatenation between scans.
  // Non-matches fall through to the normal search/filter behaviour.
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const code = e.currentTarget.value.trim();
    if (!code) return;
    const needle = code.toLowerCase();
    const matches = products.filter((p) =>
      (p.barcode || '').toLowerCase() === needle || p.sku.toLowerCase() === needle
    );
    if (matches.length === 1) {
      e.preventDefault();
      handleAddToCart(matches[0]);
      // Cancel any pending debounce so the cleared input doesn't re-filter.
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      setSearchInput('');
      setSearchQuery('');
      return;
    }
    if (matches.length === 0) {
      // Exact-match miss: non-blocking feedback; the typed/scanned value stays
      // in the box and the debounced filter proceeds as before.
      toast.error(`No product matched "${code}" — check the code or add the item manually.`);
    }
    // >1 match (duplicate barcode/SKU): keep the filter results for a manual pick.
  };

  useEffect(() => () => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
  }, []);

  // Hold/Recall cart functionality
  const holdCart = () => {
    if (cart.items.length === 0) {
      toast.error('Cart is empty - nothing to hold');
      return;
    }
    let heldList: HeldCartRecord[] = [];
    try {
      heldList = JSON.parse(localStorage.getItem('mbt_held_carts') || '[]');
    } catch {
      heldList = [];
    }
    const holdId = `hold_${Date.now()}`;
    // AUDIT FIX (Task 3-e): append picker metadata — unit count + pre-tax total
    // (Σ lineTotal, after line discounts) at hold time, so the picker can render
    // rows without rebuilding the cart.
    const heldTotal = cart.items.reduce(
      (sum, item) => sum + (Number(item.lineTotal) || item.pricePerUnit * item.quantity),
      0,
    );
    heldList.push({
      id: holdId,
      items: cart.items,
      customer: selectedCustomer,
      notes: cartNotes,
      timestamp: new Date().toISOString(),
      count: cart.getItemCount(),
      total: heldTotal,
    });
    localStorage.setItem('mbt_held_carts', JSON.stringify(heldList));
    cart.clearCart();
    setCartNotes({});
    setCartDiscountInput('');
    setSelectedCustomer('');
    refreshHeldCarts();
    toast.success('Cart held successfully');
  };

  // AUDIT FIX (Task 3-e): out-of-order resume — restore a specific held cart by
  // id (was a blind `heldCarts.pop()` LIFO-only recall). Restore logic unchanged.
  const resumeHeldCart = (holdId: string) => {
    let heldList: HeldCartRecord[] = [];
    try {
      heldList = JSON.parse(localStorage.getItem('mbt_held_carts') || '[]');
    } catch {
      heldList = [];
    }
    const record = heldList.find((c) => c.id === holdId);
    if (!record || !Array.isArray(record.items)) {
      toast.error('Held cart not found — it may have been deleted on another device.');
      refreshHeldCarts();
      return;
    }
    // Clear current cart first
    cart.clearCart();
    setCartNotes({});
    // Add all items from held cart
    record.items.forEach((item: CartItem) => {
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
    if (record.customer) setSelectedCustomer(record.customer);
    if (record.notes) setCartNotes(record.notes);
    localStorage.setItem('mbt_held_carts', JSON.stringify(heldList.filter((c) => c.id !== holdId)));
    refreshHeldCarts();
    setHeldCartsOpen(false);
    toast.success('Cart resumed successfully');
  };

  // AUDIT FIX (Task 3-e): drop a held cart. Stock is never reserved while a cart
  // is held (hold is localStorage-only, no server call), so nothing needs to be
  // released — deleting just discards the record.
  const deleteHeldCart = (holdId: string) => {
    let heldList: HeldCartRecord[] = [];
    try {
      heldList = JSON.parse(localStorage.getItem('mbt_held_carts') || '[]');
    } catch {
      heldList = [];
    }
    localStorage.setItem('mbt_held_carts', JSON.stringify(heldList.filter((c) => c.id !== holdId)));
    refreshHeldCarts();
    toast.success('Held cart deleted');
  };

  // AUDIT FIX (Task 3-e): reactive count from the picker state (was re-read from
  // localStorage on every render).
  const heldCartCount = heldCarts.length;

  const applyDiscountCode = () => {
    if (!discountCode.trim()) {
      toast.error('Enter a discount code');
      return;
    }
    // Discount codes are validated server-side in production.
    // This client-side handler provides basic UX feedback only.
    toast.info('Discount code validation requires server verification. Please apply via the discount management panel.');
    setDiscountCode('');
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
      // Ensure all numeric fields are properly typed as numbers before sending
      // to the API — prevents 400 validation errors from string-type values.
      items: cart.items.map(item => ({
        ...item,
        pricePerUnit: Number(item.pricePerUnit) || 0,
        costPrice: Number(item.costPrice) || 0,
        quantity: Number(item.quantity) || 1,
        discountPercent: Number(item.discountPercent) || 0,
        taxRate: Number(item.taxRate) || 16,
        lineTotal: Number(item.lineTotal) || 0,
      })),
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
      } catch (_e) {
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
  // ── HTML escape helper (for receipt print) ─────────────────────
  function escapeHtml(str: unknown): string {
    return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  const handlePrintReceipt = () => {
    if (!lastTransaction) return;
    const store = STORE_LIST.find((s) => s.id === currentStoreId);
    const itemsHtml = safeMap<TransactionItem, string>(lastTransaction?.items, (item) => `
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

  // Compute product counts per category for the category chips badges
  const categoryProductCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of products) {
      if (p.categoryId) {
        counts[p.categoryId] = (counts[p.categoryId] || 0) + 1;
      }
    }
    return counts;
  }, [products]);

  // Best seller IDs from dashboard topProducts (if available) — passed to ProductCard
  const bestSellerIds = useMemo(() => {
    // Fallback heuristic: products that are recently updated AND have low stock
    // (low stock + recent activity = popular). This is purely a visual cue.
    // Real integration: caller can pass topProducts from dashboard query.
    return new Set<string>();
  }, []);

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
                value={searchInput}
                onChange={(e) => handleSearchInput(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                className="pl-10"
                aria-label="Product search or barcode scanner input"
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
            productCounts={categoryProductCounts}
            totalCount={products.length}
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
            {safeMap(sortedProducts, (product) => (
              <ProductCard
                key={product.id}
                product={product}
                onAdd={handleAddToCart}
                cartQuantity={cart.items.find(i => i.productId === product.id)?.quantity}
                isBestSeller={bestSellerIds.has(product.id)}
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
                  {safeMap(sortedProducts, (product) => {
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
                    {safeMap(visibleRecommendations, (rec) => {
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
                  <Badge variant="secondary" className={cartBadgeShake ? 'animate-shake' : 'animate-badge-pop'}>
                    {cart.getItemCount()}
                  </Badge>
                )}
                {heldCartCount > 0 && (
                  <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">
                    <Pause className="h-2.5 w-2.5 mr-0.5" />{heldCartCount} held
                  </Badge>
                )}
              </CardTitle>
              <div className="flex items-center gap-1">
                {heldCartCount > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => setHeldCartsOpen(true)} className="text-blue-600 h-7" title="View held carts (resume any)">
                    <ShoppingBag className="h-3.5 w-3.5 mr-1" /> Recall
                  </Button>
                )}
                {cart.items.length > 0 && (
                  <>
                    <Button variant="ghost" size="sm" onClick={holdCart} className="text-amber-600 h-7 btn-press" title="Hold current cart (F10)">
                      <Pause className="h-3.5 w-3.5 mr-1" /> Hold
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setClearCartConfirmOpen(true)} className="text-destructive h-7 btn-press" title="Clear cart (with confirmation)">
                      <Trash2 className="h-3.5 w-3.5 mr-1" /> Clear
                    </Button>
                  </>
                )}
              </div>
            </div>
            {/* Cart total value sub-header */}
            {cart.items.length > 0 && (
              <div className="flex items-center justify-between mt-1 pt-2 border-t border-dashed text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="status-pulse" aria-hidden />
                  <span>Live cart</span>
                </span>
                <span>
                  {cart.getItemCount()} item{cart.getItemCount() !== 1 ? 's' : ''} · <span className="font-bold text-foreground">{formatKES(finalTotal)}</span>
                </span>
              </div>
            )}
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
                      {safeMap(customers, (c) => (
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
                            {safeMap<GiftCardItem, JSX.Element>(customerGiftCards, (gc) => (
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
                            {safeMap<VoucherItem, JSX.Element>(customerVouchers, (v) => (
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
                  <div className="flex justify-between animate-total-row">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>{formatKES(subtotal)}</span>
                  </div>
                  <div className="flex justify-between animate-total-row" style={{ animationDelay: '60ms' }}>
                    <span className="text-muted-foreground">VAT (16%)</span>
                    <span>{formatKES(tax)}</span>
                  </div>
                  {totalDiscount > 0 && (
                    <div className="flex justify-between text-green-600 animate-total-row" style={{ animationDelay: '120ms' }}>
                      <span className="flex items-center gap-1">
                        <Tag className="h-3 w-3" />
                        Discount
                      </span>
                      <span>-{formatKES(totalDiscount)}</span>
                    </div>
                  )}
                  <Separator />
                  <div className="flex justify-between font-bold text-base animate-total-row" style={{ animationDelay: '180ms' }}>
                    <span>Total</span>
                    <span className="text-gradient">{formatKES(finalTotal)}</span>
                  </div>
                </div>
              </div>

              {/* Checkout button — always pinned at the bottom, never scrolled out of view */}
              <div className="shrink-0 p-3 border-t bg-card/80 backdrop-blur-sm space-y-1.5">
                <Button
                  className="w-full bg-gradient-to-r from-accent-orange to-amber-500 hover:from-accent-orange/90 hover:to-amber-600 text-white font-semibold h-12 shadow-lg shadow-accent-orange/20 checkout-glow checkout-glow-pulse micro-click btn-press"
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
        cartItems={cart.items}
        subtotal={subtotal}
        taxAmount={tax}
      />

      {/* AUDIT FIX (Task 3-e): held-carts picker — resume any parked cart out of
          order, or delete it. Replaces the blind LIFO recall. */}
      <HeldCartsDialog
        open={heldCartsOpen}
        onOpenChange={setHeldCartsOpen}
        heldCarts={heldCarts}
        customers={customers}
        onResume={resumeHeldCart}
        onDelete={deleteHeldCart}
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
              {safeMap<TransactionItem, JSX.Element>(lastTransaction?.items, (item) => (
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

      {/* Receipt Print Preview — enhanced receipt dialog with Print, PDF, WhatsApp, New Sale */}
      <ReceiptPrintPreview
        open={receiptPrintOpen}
        onOpenChange={setReceiptPrintOpen}
        transaction={lastTransaction}
        cashReceived={lastCashReceived}
        mpesaPhone={lastMpesaPhone}
        storeId={currentStoreId}
        onNewSale={() => { setReceiptPrintOpen(false); setLastTransaction(null); }}
      />

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
                  <Button variant="ghost" size="sm" onClick={() => setHeldCartsOpen(true)} className="text-blue-600 h-7 text-xs" title="View held carts (resume any)">
                    <ShoppingBag className="h-3.5 w-3.5 mr-1" /> Recall
                  </Button>
                )}
                {cart.items.length > 0 && (
                  <>
                    <Button variant="ghost" size="sm" onClick={holdCart} className="text-amber-600 h-7 text-xs btn-press">
                      <Pause className="h-3.5 w-3.5 mr-1" /> Hold
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setClearCartConfirmOpen(true)} className="text-destructive h-7 text-xs btn-press" title="Clear cart (with confirmation)">
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
                      {safeMap(customers, (c) => (
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
                            {safeMap<GiftCardItem, JSX.Element>(customerGiftCards, (gc) => (
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
                            {safeMap<VoucherItem, JSX.Element>(customerVouchers, (v) => (
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
                  <div className="flex justify-between animate-total-row">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>{formatKES(subtotal)}</span>
                  </div>
                  <div className="flex justify-between animate-total-row" style={{ animationDelay: '60ms' }}>
                    <span className="text-muted-foreground">VAT (16%)</span>
                    <span>{formatKES(tax)}</span>
                  </div>
                  {totalDiscount > 0 && (
                    <div className="flex justify-between text-green-600 animate-total-row" style={{ animationDelay: '120ms' }}>
                      <span className="flex items-center gap-1">
                        <Tag className="h-3 w-3" />
                        Discount
                      </span>
                      <span>-{formatKES(totalDiscount)}</span>
                    </div>
                  )}
                  <Separator />
                  <div className="flex justify-between font-bold text-base animate-total-row" style={{ animationDelay: '180ms' }}>
                    <span>Total</span>
                    <span className="text-gradient">{formatKES(finalTotal)}</span>
                  </div>
                </div>
              </div>

              {/* Checkout button — always pinned at the bottom of the sheet */}
              <div className="shrink-0 p-3 border-t bg-card/80 backdrop-blur-sm space-y-1.5">
                <Button
                  className="w-full bg-gradient-to-r from-accent-orange to-amber-500 hover:from-accent-orange/90 hover:to-amber-600 text-white font-semibold h-12 shadow-lg shadow-accent-orange/20 checkout-glow checkout-glow-pulse micro-click btn-press"
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

      {/* Clear Cart Confirmation Dialog (shared — desktop & mobile) */}
      <AlertDialog open={clearCartConfirmOpen} onOpenChange={setClearCartConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" />
              Clear cart?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will remove all {cart.getItemCount()} item{cart.getItemCount() !== 1 ? 's' : ''} (total {formatKES(finalTotal)}) from the current cart.
              Cart notes and discounts will also be cleared. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="btn-press">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 btn-press"
              onClick={() => {
                cart.clearCart();
                setCartNotes({});
                setCartDiscountInput('');
                setClearCartConfirmOpen(false);
                toast.success('Cart cleared');
              }}
            >
              <Trash2 className="h-4 w-4 mr-1.5" />
              Clear Cart
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}


