'use client';

import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAppStore, useCartStore } from '@/lib/stores';
import { TAB_CONFIG, safeMap } from '@/lib/app-config';
import { useLiveClock } from '@/hooks/use-live-clock';
import { useNotificationCount } from '@/hooks/use-notification-count';
import { productsApi, customersApi, formatKES, type ProductListItem, type CustomerItem } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  Menu, Home, Search, Bell, ShoppingCart, Package, Clock, CalendarDays,
  PanelLeftClose, PanelLeftOpen, Lightbulb, Keyboard, Smartphone, Info,
  CheckCheck, BellRing,
} from 'lucide-react';

export function TopBar({ searchBtnRef }: { searchBtnRef?: React.RefObject<HTMLButtonElement | null> }) {
  const { activeTab, toggleSidebar, setActiveTab, isSidebarCollapsed, toggleSidebarCollapse } = useAppStore();
  const cartItems = useCartStore((s) => s.items);
  const cartItemCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const currentStoreId = useAppStore((s) => s.currentStoreId);
  const queryClient = useQueryClient();
  const currentTab = TAB_CONFIG.find(t => t.id === activeTab);
  const TabIcon = currentTab?.icon || Home;
  const now = useLiveClock();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [notifDropdownOpen, setNotifDropdownOpen] = useState(false);
  const notificationCount = useNotificationCount(currentStoreId);

  const handleMarkAllRead = async () => {
    try {
      const res = await (await import('@/lib/api')).notificationsApi.list(currentStoreId);
      const all = Array.isArray(res?.data) ? res.data : [];
      if (all.length === 0) {
        setNotifDropdownOpen(false);
        return;
      }
      const stored = localStorage.getItem('mbt_read_notifications');
      const existing: string[] = stored ? JSON.parse(stored) : [];
      const merged = Array.from(new Set([...existing, ...all.map((n) => n.id)]));
      localStorage.setItem('mbt_read_notifications', JSON.stringify(merged));
      await queryClient.invalidateQueries({ queryKey: ['notification-count', currentStoreId] });
      await queryClient.invalidateQueries({ queryKey: ['notifications', currentStoreId] });
      setNotifDropdownOpen(false);
      toast.success('All notifications marked as read');
    } catch {
      toast.error('Could not mark notifications as read. Please try again.');
    }
  };

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
          {/* Desktop sidebar collapse/expand toggle */}
          <Button
            variant="ghost"
            size="icon"
            className="hidden lg:flex"
            onClick={toggleSidebarCollapse}
            aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isSidebarCollapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
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
                    <span>Toggle sidebar</span><kbd className="px-1.5 py-0.5 rounded border bg-muted text-[10px] font-mono">⌘B</kbd>
                  </div>
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
                    <Button variant="ghost" size="sm" className="text-xs h-6" onClick={handleMarkAllRead}>
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
                    onClick={() => { setNotifDropdownOpen(false); }}
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
            ) : searchResults && ((Array.isArray(searchResults.products) && searchResults.products.length > 0) || (Array.isArray(searchResults.customers) && searchResults.customers.length > 0)) ? (
              <div className="py-2">
                {Array.isArray(searchResults.products) && searchResults.products.length > 0 && (
                  <div>
                    <p className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Products</p>
                    {safeMap<ProductListItem, JSX.Element>(searchResults.products, (p) => (
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
                {Array.isArray(searchResults.customers) && searchResults.customers.length > 0 && (
                  <div>
                    <p className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-t mt-1 pt-2">Customers</p>
                    {safeMap<CustomerItem, JSX.Element>(searchResults.customers, (c) => (
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
