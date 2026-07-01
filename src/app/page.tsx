'use client';

/**
 * MBUMAH HARDWARE - Main Application Page
 * Refactored: components extracted into separate files for maintainability.
 */

import React, { useState, useEffect, useRef, lazy, Suspense, useSyncExternalStore } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Loader2, Keyboard } from 'lucide-react';

import { useAuthStore, useAppStore } from '@/lib/stores';
import { ErrorBoundary, SectionErrorBoundary } from '@/components/error-boundary';
import { FloatingHomeButton } from '@/components/floating-home-button';
import { LoginScreen } from '@/components/login-screen';
import { AppSidebar } from '@/components/layout/app-sidebar';
import { TopBar } from '@/components/layout/top-bar';
import { KeyboardShortcutsHelp } from '@/components/keyboard-shortcuts-help';

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
const LazyEtimsTab = lazy(() => import('./tabs/etims-tab'));
const LazyDebtManagementTab = lazy(() => import('./tabs/debt-management-tab'));
const LazyConversationsTab = lazy(() => import('./tabs/conversations-tab'));
const LazyPurchaseOrdersTab = lazy(() => import('./tabs/purchase-orders-tab'));
const LazyPOSTab = lazy(() => import('./tabs/pos-tab'));

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

function MainApp() {
  const { activeTab, setActiveTab, currentStoreId } = useAppStore();
  const user = useAuthStore((s) => s.user);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const searchBtnRef = useRef<HTMLButtonElement | null>(null);

  // Global keyboard shortcuts
  useEffect(() => {
    const { toggleSidebarCollapse } = useAppStore.getState();

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+K or Cmd+K: Focus search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchBtnRef.current?.click();
        return;
      }

      // Ctrl+B or Cmd+B: Toggle sidebar collapse/expand
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        toggleSidebarCollapse();
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
      case 'dashboard': return <SectionErrorBoundary sectionName="Dashboard"><Suspense fallback={<TabLoadingFallback />}><LazyDashboardTab /></Suspense></SectionErrorBoundary>;
      case 'pos': return <SectionErrorBoundary sectionName="POS"><Suspense fallback={<TabLoadingFallback />}><LazyPOSTab /></Suspense></SectionErrorBoundary>;
      case 'catalog': return <SectionErrorBoundary sectionName="Catalog"><Suspense fallback={<TabLoadingFallback />}><LazyCatalogTab /></Suspense></SectionErrorBoundary>;
      case 'inventory': return <SectionErrorBoundary sectionName="Inventory"><Suspense fallback={<TabLoadingFallback />}><LazyInventoryTab /></Suspense></SectionErrorBoundary>;
      case 'customers': return <SectionErrorBoundary sectionName="Customers"><Suspense fallback={<TabLoadingFallback />}><LazyCustomersTab /></Suspense></SectionErrorBoundary>;
      case 'rentals': return <SectionErrorBoundary sectionName="Rentals"><Suspense fallback={<TabLoadingFallback />}><LazyRentalsTab /></Suspense></SectionErrorBoundary>;
      case 'financial': return <SectionErrorBoundary sectionName="Financial"><Suspense fallback={<TabLoadingFallback />}><LazyFinancialTab /></Suspense></SectionErrorBoundary>;
      case 'reports': return <SectionErrorBoundary sectionName="Reports"><Suspense fallback={<TabLoadingFallback />}><LazyReportsTab /></Suspense></SectionErrorBoundary>;
      case 'transactions': return <SectionErrorBoundary sectionName="Transactions"><Suspense fallback={<TabLoadingFallback />}><LazyTransactionsTab /></Suspense></SectionErrorBoundary>;
      case 'admin': return <SectionErrorBoundary sectionName="Admin"><Suspense fallback={<TabLoadingFallback />}><LazyAdminTab /></Suspense></SectionErrorBoundary>;
      case 'suppliers': return <SectionErrorBoundary sectionName="Suppliers"><Suspense fallback={<TabLoadingFallback />}><LazySuppliersTab /></Suspense></SectionErrorBoundary>;
      case 'gift-cards': return <SectionErrorBoundary sectionName="Gift Cards"><Suspense fallback={<TabLoadingFallback />}><LazyGiftCardsTab storeId={currentStoreId} userRole={user?.role || 'CASHIER'} userId={user?.id || ''} /></Suspense></SectionErrorBoundary>;
      case 'vouchers': return <SectionErrorBoundary sectionName="Vouchers"><Suspense fallback={<TabLoadingFallback />}><LazyVouchersTab /></Suspense></SectionErrorBoundary>;
      case 'invoices': return <SectionErrorBoundary sectionName="Invoices"><Suspense fallback={<TabLoadingFallback />}><LazyInvoicesTab /></Suspense></SectionErrorBoundary>;
      case 'delivery': return <SectionErrorBoundary sectionName="Delivery"><Suspense fallback={<TabLoadingFallback />}><LazyDeliveryTab /></Suspense></SectionErrorBoundary>;
      case 'credits': return <SectionErrorBoundary sectionName="Credits"><Suspense fallback={<TabLoadingFallback />}><LazyCreditsTab /></Suspense></SectionErrorBoundary>;
      case 'messaging': return <SectionErrorBoundary sectionName="Messaging"><Suspense fallback={<TabLoadingFallback />}><LazyMessagingTab /></Suspense></SectionErrorBoundary>;
      case 'transfers': return <SectionErrorBoundary sectionName="Transfers"><Suspense fallback={<TabLoadingFallback />}><LazyTransfersTab /></Suspense></SectionErrorBoundary>;
      case 'banking': return <SectionErrorBoundary sectionName="Banking"><Suspense fallback={<TabLoadingFallback />}><LazyBankingTab /></Suspense></SectionErrorBoundary>;
      case 'loyalty': return <SectionErrorBoundary sectionName="Loyalty"><Suspense fallback={<TabLoadingFallback />}><LazyLoyaltyTab /></Suspense></SectionErrorBoundary>;
      case 'security': return <SectionErrorBoundary sectionName="Security"><Suspense fallback={<TabLoadingFallback />}><LazySecurityTab /></Suspense></SectionErrorBoundary>;
      case 'payroll': return <SectionErrorBoundary sectionName="Payroll"><Suspense fallback={<TabLoadingFallback />}><LazyPayrollTab /></Suspense></SectionErrorBoundary>;
      case 'etims': return <SectionErrorBoundary sectionName="eTIMS"><Suspense fallback={<TabLoadingFallback />}><LazyEtimsTab /></Suspense></SectionErrorBoundary>;
      case 'debt-management': return <SectionErrorBoundary sectionName="Debt Management"><Suspense fallback={<TabLoadingFallback />}><LazyDebtManagementTab /></Suspense></SectionErrorBoundary>;
      case 'conversations': return <SectionErrorBoundary sectionName="Conversations"><Suspense fallback={<TabLoadingFallback />}><LazyConversationsTab /></Suspense></SectionErrorBoundary>;
      case 'purchase-orders': return <SectionErrorBoundary sectionName="Purchase Orders"><Suspense fallback={<TabLoadingFallback />}><LazyPurchaseOrdersTab /></Suspense></SectionErrorBoundary>;
      default: return <SectionErrorBoundary sectionName="POS"><Suspense fallback={<TabLoadingFallback />}><LazyPOSTab /></Suspense></SectionErrorBoundary>;
    }
  };

  return (
    <ErrorBoundary>
      <div className="flex h-screen overflow-hidden">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0 min-h-screen transition-all duration-300 ease-in-out">
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
                <span className="text-[10px] text-muted-foreground/50 hidden sm:inline">v2.2.0</span>
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
        <FloatingHomeButton />
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

/**
 * Loading watchdog — if the app remains on the "Loading…" screen for more
 * than 5 seconds, log a diagnostic error. After 10 seconds, surface a retry UI.
 */
const LOADING_WARN_MS = 5000;
const LOADING_RETRY_MS = 10000;

function useLoadingWatchdog(hasMounted: boolean) {
  const [showRetry, setShowRetry] = useState(false);

  useEffect(() => {
    if (hasMounted) return;

    const warnTimer = setTimeout(() => {
      console.error(
        '[MbumahBoot] App has been on the "Loading…" screen for >5s. ' +
          'Hydration may have failed. Diagnostics:',
        {
          href: window.location.href,
          origin: window.location.origin,
          userAgent: navigator.userAgent,
          hasToken: !!localStorage.getItem('mbt_token'),
          scripts: Array.from(document.querySelectorAll('script[src]')).map(
            (s) => s.getAttribute('src'),
          ),
          readyState: document.readyState,
          timeOnLoad: Date.now(),
        },
      );
    }, LOADING_WARN_MS);

    const retryTimer = setTimeout(() => {
      setShowRetry(true);
    }, LOADING_RETRY_MS);

    return () => {
      clearTimeout(warnTimer);
      clearTimeout(retryTimer);
    };
  }, [hasMounted]);

  return showRetry;
}

export default function HomePage() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hydrateFromStorage = useAuthStore((s) => s.hydrateFromStorage);
  const hasMounted = useHasMounted();
  const showRetry = useLoadingWatchdog(hasMounted);

  // Hydrate auth state from localStorage on first client mount.
  // Also rehydrate the persisted app store (sidebar state, active tab, etc.)
  // Defensive checks ensure this never crashes even if persist middleware
  // is removed or the store structure changes.
  useEffect(() => {
    hydrateFromStorage();
    try {
      if (useAppStore?.persist?.rehydrate) {
        useAppStore.persist.rehydrate();
      }
    } catch (err) {
      console.error('[MbumahBoot] Failed to rehydrate app store:', err);
    }
  }, [hydrateFromStorage]);

  if (!hasMounted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading...</p>
          {showRetry && (
            <div className="flex flex-col items-center gap-2 mt-4">
              <p className="text-xs text-muted-foreground max-w-xs text-center">
                The app is taking longer than expected to load. This may be a
                network issue or a deployment still warming up.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.location.reload()}
                className="mt-1"
              >
                <Loader2 className="h-3 w-3 mr-1.5" />
                Retry
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return isAuthenticated ? <MainApp /> : <ErrorBoundary><LoginScreen /></ErrorBoundary>;
}
