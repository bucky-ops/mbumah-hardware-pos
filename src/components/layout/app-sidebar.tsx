'use client';

import React, { useState, useEffect, useRef, useSyncExternalStore } from 'react';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { useAuthStore, useAppStore, type AppTab } from '@/lib/stores';
import { STORE_LIST } from '@/lib/store-info';
import { filterTabsByRole, NAV_GROUPS } from '@/lib/app-config';
import { useNotificationCount } from '@/hooks/use-notification-count';
import { NotificationCenter } from '@/components/notification-center';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import {
  Store, LogOut, Sun, Moon, Bell, X, ChevronDown, ChevronLeft, ChevronRight,
  Keyboard, ShieldCheck, CheckCircle,
} from 'lucide-react';

export function AppSidebar() {
  const { activeTab, setActiveTab, sidebarOpen, setSidebarOpen, currentStoreId, setCurrentStoreId, isSidebarCollapsed, toggleSidebarCollapse, setSidebarCollapsed, getSidebarState } = useAppStore();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { theme, setTheme } = useTheme();
  const [notificationOpen, setNotificationOpen] = useState(false);
  const notificationCount = useNotificationCount(currentStoreId);
  const sidebarRef = useRef<HTMLElement>(null);

  // Track whether viewport is desktop (≥ lg breakpoint)
  const isDesktop = useSyncExternalStore(
    (callback) => {
      const mql = window.matchMedia('(min-width: 1024px)');
      mql.addEventListener('change', callback);
      return () => mql.removeEventListener('change', callback);
    },
    () => window.matchMedia('(min-width: 1024px)').matches,
    () => false,
  );

  // Derive the sidebar visual state
  const sidebarState = getSidebarState(isDesktop);
  const collapsed = sidebarState === 'collapsed';

  // Auto-expand sidebar when transitioning from mobile to desktop while collapsed
  useEffect(() => {
    if (isDesktop && isSidebarCollapsed) {
      setSidebarCollapsed(false);
    }
  }, [isDesktop, isSidebarCollapsed, setSidebarCollapsed]);

  // Close mobile overlay on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && sidebarOpen && !isDesktop) {
        setSidebarOpen(false);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [sidebarOpen, isDesktop, setSidebarOpen]);

  // Trap focus inside sidebar when mobile overlay is open
  useEffect(() => {
    if (sidebarState !== 'mobile-overlay') return;
    const timer = setTimeout(() => {
      sidebarRef.current?.focus();
    }, 300);
    return () => clearTimeout(timer);
  }, [sidebarState]);

  const handleNav = (tab: AppTab) => {
    setActiveTab(tab);
    setSidebarOpen(false);
  };

  const handleLogout = async () => {
    await logout();
    toast.success('Logged out successfully');
  };

  // Role-based tab visibility
  const visibleTabs = filterTabsByRole(user?.role);
  const navGroups = NAV_GROUPS
    .map(g => ({ label: g.label, items: visibleTabs.filter(t => g.ids.includes(t.id)) }))
    .filter(g => g.items.length > 0);

  const renderNavItem = ({ id, label, icon: Icon }: { id: AppTab; label: string; icon: React.ElementType }) => {
    const btn = (
      <button
        key={id}
        onClick={() => handleNav(id)}
        className={`w-full flex items-center gap-3 rounded-lg text-sm font-medium transition-all duration-300 ease-out relative group ${
          collapsed ? 'px-0 py-2.5 justify-center' : 'px-4 py-2.5'
        } ${
          activeTab === id
            ? 'bg-sidebar-primary/90 text-sidebar-primary-foreground shadow-md shadow-sidebar-primary/25'
            : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground hover:translate-x-1'
        }`}
      >
        {activeTab === id && (
          <div className="absolute left-0 top-0.5 bottom-0.5 w-1 rounded-r-full bg-sidebar-primary-foreground/90 transition-all duration-300 shadow-[0_0_6px] shadow-sidebar-primary-foreground/30" />
        )}
        <Icon className={`h-4 w-4 shrink-0 relative z-10 transition-transform duration-300 ${activeTab === id ? 'scale-110' : 'group-hover:scale-110'}`} />
        {!collapsed && <span className="relative z-10">{label}</span>}
        {!collapsed && id === 'pos' && <kbd className="ml-auto text-[8px] opacity-40 hidden xl:inline">F2</kbd>}
        {!collapsed && id === 'inventory' && <kbd className="ml-auto text-[8px] opacity-40 hidden xl:inline">F3</kbd>}
        {!collapsed && id === 'customers' && <kbd className="ml-auto text-[8px] opacity-40 hidden xl:inline">F4</kbd>}
        {!collapsed && id === 'financial' && <kbd className="ml-auto text-[8px] opacity-40 hidden xl:inline">F5</kbd>}
      </button>
    );

    if (collapsed) {
      return (
        <Tooltip key={id}>
          <TooltipTrigger asChild>{btn}</TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>{label}</TooltipContent>
        </Tooltip>
      );
    }
    return btn;
  };

  return (
    <TooltipProvider delayDuration={0}>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        ref={sidebarRef}
        role="navigation"
        aria-label="Main navigation"
        aria-expanded={!collapsed}
        aria-collapsed={collapsed}
        data-sidebar-state={sidebarState}
        tabIndex={sidebarState === 'mobile-overlay' ? -1 : undefined}
        className={`fixed top-0 left-0 z-50 h-full bg-sidebar/95 backdrop-blur-md text-sidebar-foreground transform transition-all duration-300 ease-in-out lg:translate-x-0 lg:static lg:z-auto border-r border-sidebar-border shadow-lg lg:shadow-none ${
          sidebarState === 'expanded' ? 'w-64' : sidebarState === 'collapsed' ? 'lg:w-16 w-64' : 'w-64'
        } ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Logo + Collapse Toggle */}
          <div className={`flex items-center gap-3 border-b border-sidebar-border relative ${collapsed ? 'px-2 py-4 justify-center' : 'px-4 py-5'}`}>
            <div className={`rounded-lg overflow-hidden bg-sidebar-primary flex items-center justify-center shrink-0 ${collapsed ? 'w-8 h-8' : 'w-9 h-9'}`}>
              <img src="/logo.png" alt="MH" className="w-full h-full object-cover" />
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <h1 className="font-bold text-sm leading-tight">MBUMAH HARDWARE</h1>
                <p className="text-xs text-sidebar-foreground/60">POS & ERP</p>
              </div>
            )}
            {!collapsed && (
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
            )}
            {/* Mobile close button */}
            {!collapsed && (
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 lg:hidden text-sidebar-foreground/60 hover:text-sidebar-foreground"
                onClick={() => setSidebarOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
            {/* Collapse/expand toggle button */}
            <button
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              onClick={toggleSidebarCollapse}
              className="hidden lg:flex absolute -right-3 top-1/2 -translate-y-1/2 z-50 h-6 w-6 items-center justify-center rounded-full border border-sidebar-border bg-sidebar text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent shadow-sm transition-all duration-200"
            >
              {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronLeft className="h-3 w-3" />}
            </button>
          </div>

          {/* Collapsed notification bell */}
          {collapsed && (
            <div className="flex justify-center px-2 pt-2 pb-0">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-sidebar-foreground/60 hover:text-sidebar-foreground relative h-8 w-8"
                    onClick={() => setNotificationOpen(true)}
                  >
                    <Bell className="h-4 w-4" />
                    {notificationCount.unread > 0 && (
                      <span className={`absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 flex items-center justify-center rounded-full text-[8px] font-bold text-white px-0.5 ${notificationCount.critical > 0 ? 'bg-red-500 animate-pulse' : 'bg-amber-500'}`}>
                        {notificationCount.unread > 99 ? '99+' : notificationCount.unread}
                      </span>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>Notifications</TooltipContent>
              </Tooltip>
            </div>
          )}

          {/* Store Selector */}
          <div className={`${collapsed ? 'px-1 pt-2 pb-1' : 'px-3 pt-3 pb-1'}`}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                {collapsed ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button className="w-full flex items-center justify-center px-2 py-2 rounded-lg border border-sidebar-border bg-sidebar-accent/50 text-sidebar-foreground/80 hover:bg-sidebar-accent transition-colors">
                        <Store className="h-3.5 w-3.5 shrink-0" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" sideOffset={8}>
                      {STORE_LIST.find(s => s.id === currentStoreId)?.shortName || 'Select Branch'}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-sidebar-border bg-sidebar-accent/50 text-xs text-sidebar-foreground/80 hover:bg-sidebar-accent transition-colors">
                    <Store className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate font-medium">{STORE_LIST.find(s => s.id === currentStoreId)?.shortName || 'Select Branch'}</span>
                    <ChevronDown className="h-3 w-3 ml-auto shrink-0" />
                  </button>
                )}
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
          <nav className={`flex-1 py-2 space-y-1 overflow-y-auto overflow-x-hidden custom-scrollbar ${collapsed ? 'px-1' : 'px-3'}`}>
            {navGroups.map((group, idx) => (
              <div key={group.label}>
                {!collapsed && (
                  <div className={`px-4 ${idx === 0 ? 'pt-2' : 'pt-4'} pb-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40 flex items-center gap-1.5`}>
                    <span>{group.label}</span>
                    <Separator className="flex-1 bg-sidebar-border/50" />
                  </div>
                )}
                {collapsed && idx > 0 && (
                  <Separator className="my-2 mx-2 bg-sidebar-border/50" />
                )}
                {group.items.map(renderNavItem)}
              </div>
            ))}
          </nav>

          {/* Footer - User Profile Dropdown */}
          <div className={`border-t border-sidebar-border py-3 space-y-2 ${collapsed ? 'px-1' : 'px-3'}`}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                {collapsed ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="w-full flex justify-center px-1 py-2 rounded-lg hover:bg-sidebar-accent transition-colors cursor-pointer" role="button" tabIndex={0}>
                        <div className="relative">
                          <Avatar className="h-8 w-8 ring-2 ring-sidebar-primary/20">
                            <AvatarFallback className="bg-gradient-to-br from-sidebar-primary to-sidebar-primary/70 text-sidebar-primary-foreground text-[10px] font-semibold">
                              {user?.name?.split(' ').map(n => n[0]).join('') || 'U'}
                            </AvatarFallback>
                          </Avatar>
                          <span className="absolute bottom-0 right-0 w-2 h-2 bg-green-500 border-2 border-sidebar rounded-full" />
                        </div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="right" sideOffset={8}>
                      {user?.name || 'User'} &mdash; {user?.role === 'SUPER_ADMIN' ? 'Super Admin' : user?.role === 'CASHIER' ? 'Cashier' : user?.role || 'User'}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <div className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-sidebar-accent transition-colors text-left cursor-pointer" role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.currentTarget.click(); }}>
                    <div className="relative">
                      <Avatar className="h-9 w-9 ring-2 ring-sidebar-primary/20">
                        <AvatarFallback className="bg-gradient-to-br from-sidebar-primary to-sidebar-primary/70 text-sidebar-primary-foreground text-xs font-semibold">
                          {user?.name?.split(' ').map(n => n[0]).join('') || 'U'}
                        </AvatarFallback>
                      </Avatar>
                      <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-sidebar rounded-full" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{user?.name || 'User'}</p>
                      <p className="text-xs text-sidebar-foreground/60 truncate">{user?.role === 'SUPER_ADMIN' ? 'Super Admin' : user?.role === 'CASHIER' ? 'Cashier' : user?.role || 'User'}</p>
                    </div>
                    <ChevronDown className="h-3.5 w-3.5 text-sidebar-foreground/40 shrink-0" />
                  </div>
                )}
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
    </TooltipProvider>
  );
}
