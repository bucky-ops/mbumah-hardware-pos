'use client';

import React, { useState, useEffect, useRef, useSyncExternalStore } from 'react';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { useAuthStore, useAppStore, type AppTab } from '@/lib/stores';
import { STORE_LIST } from '@/lib/store-info';
// v2.12.5 (RBAC): NAV_GROUPS × TAB_CONFIG - no-access tabs now render LOCKED
// (grayed row + lock icon + "Requires …" tooltip) instead of being silently
// hidden, so staff can see what exists and ask for it via LockedCard flows.
import { TAB_CONFIG, NAV_GROUPS, requiredRoleLabelFor } from '@/lib/app-config';
import { preloadTab } from '@/lib/tab-preload';
import { useNotificationCount } from '@/hooks/use-notification-count';
import { NotificationCenter } from '@/components/notification-center';
import { ProfileSettingsDialog } from '@/components/profile-settings-dialog';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import {
  Store, LogOut, Sun, Moon, Bell, X, ChevronDown, ChevronLeft, ChevronRight,
  ChevronsRight, Keyboard, ShieldCheck, CheckCircle, Lock, Maximize2,
} from 'lucide-react';

// v2.14.1 (fullscreen autohide): keyboard shortcut hints surfaced in
// icon-mode tooltips (spec: "tooltip on hover label + shortcut F2 F3 F4 F5").
const SHORTCUT_HINTS: Partial<Record<AppTab, string>> = {
  pos: 'F2',
  inventory: 'F3',
  customers: 'F4',
  financial: 'F5',
};

// Idle delay before the sidebar slides away in fullscreen (spec: 2s).
const FULLSCREEN_IDLE_HIDE_MS = 2000;

/** Get role-based avatar ring class */
function getAvatarRingClass(role?: string): string {
  if (!role) return '';
  const r = role.toUpperCase();
  if (r === 'SUPER_ADMIN' || r === 'STORE_OWNER') return 'avatar-ring-admin';
  if (r === 'BRANCH_MANAGER' || r === 'ACCOUNTANT') return 'avatar-ring-manager';
  if (r === 'CASHIER' || r === 'SALES_ASSOCIATE') return 'avatar-ring-cashier';
  return '';
}

export function AppSidebar() {
  const { activeTab, setActiveTab, sidebarOpen, setSidebarOpen, currentStoreId, setCurrentStoreId, isSidebarCollapsed, toggleSidebarCollapse, setSidebarCollapsed, getSidebarState } = useAppStore();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { theme, setTheme } = useTheme();
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  // v2.14.1 (fullscreen autohide): when the app is fullscreen on desktop the
  // sidebar slides away after 2s of pointer/keyboard inactivity and peeks
  // back via the left-edge sensor, the top-bar toggle, or keyboard focus.
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [peek, setPeek] = useState(false);
  const peekRef = useRef(false);
  const notificationCount = useNotificationCount(currentStoreId);
  const sidebarRef = useRef<HTMLElement>(null);
  // Track previous notification count for bounce animation
  const prevNotifCount = useRef(0);
  const [notifBadgeKey, setNotifBadgeKey] = useState(0);

  // Bounce notification badge when count changes
  useEffect(() => {
    const prev = prevNotifCount.current;
    prevNotifCount.current = notificationCount.unread;
    if (notificationCount.unread > prev && prev >= 0) {
      // Use requestAnimationFrame to defer setState outside the synchronous effect
      requestAnimationFrame(() => setNotifBadgeKey((k) => k + 1));
    }
  }, [notificationCount.unread]);

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

  // Mirror peek into a ref so the inactivity timer can read it without
  // re-subscribing listeners on every peek change.
  useEffect(() => {
    peekRef.current = peek;
  }, [peek]);

  // Track Fullscreen API state. Native F11 fullscreen also fires
  // fullscreenchange in Chromium/Firefox, so both entry paths are covered.
  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
      setPeek(false);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  // Derive the sidebar visual state
  const sidebarState = getSidebarState(isDesktop);
  const fullscreenAutohide = isFullscreen && isDesktop;
  // In fullscreen the rail is icons-only (64px) per the autohide spec.
  const collapsed = fullscreenAutohide || sidebarState === 'collapsed';

  // Fullscreen autohide: hide after 2s of inactivity. Activity re-arms the
  // timer; while the rail is peeked (hover/focus) it stays pinned until the
  // pointer leaves. The top-bar toggle raises mbumah:sidebar-peek-toggle.
  useEffect(() => {
    if (!fullscreenAutohide) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const armTimer = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!peekRef.current) setPeek(false);
      }, FULLSCREEN_IDLE_HIDE_MS);
    };
    const onActivity = () => {
      if (!peekRef.current) armTimer();
    };
    const onPeekToggle = () => setPeek((p) => !p);
    armTimer();
    window.addEventListener('mousemove', onActivity);
    window.addEventListener('keydown', onActivity);
    window.addEventListener('mbumah:sidebar-peek-toggle', onPeekToggle);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('mousemove', onActivity);
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('mbumah:sidebar-peek-toggle', onPeekToggle);
    };
  }, [fullscreenAutohide]);

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

  // Role-based tab visibility - v2.12.5: inaccessible tabs are flagged LOCKED
  // (rendered grayed-out with a lock) rather than filtered out of the nav.
  const userRole = user?.role;
  const navGroups = NAV_GROUPS.map((g) => ({
    label: g.label,
    items: g.ids
      .map((id) => TAB_CONFIG.find((t) => t.id === id))
      .filter((t): t is (typeof TAB_CONFIG)[number] => Boolean(t))
      .map((t) => ({
        ...t,
        locked: userRole !== 'SUPER_ADMIN' && !t.roles.includes(userRole ?? ''),
      })),
  })).filter((g) => g.items.length > 0);

  const renderNavItem = ({ id, label, icon: Icon, roles, locked }: (typeof TAB_CONFIG)[number] & { locked?: boolean }) => {
    const isActive = activeTab === id;
    // Sidebar LOCKED row (v2.12.5): grayed out, 14px lock, non-clickable
    // (aria-disabled), tooltip names the role that unlocks it. Collapsed
    // mode renders just the lock icon.
    if (locked) {
      const requiresLabel = requiredRoleLabelFor(roles);
      const lockedRow = (
        <button
          key={id}
          type="button"
          aria-disabled="true"
          tabIndex={-1}
          data-locked="true"
          aria-label={`${label} - requires ${requiresLabel}`}
          onClick={(e) => e.preventDefault()}
          className={`w-full flex items-center gap-3 rounded-lg text-sm font-medium transition-all duration-300 ease-out relative group cursor-not-allowed select-none opacity-50 ${
            collapsed ? 'px-0 py-2.5 justify-center' : 'px-4 py-2.5'
          } text-slate-500`}
        >
          {collapsed ? (
            <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <>
              <Icon className="h-4 w-4 shrink-0 relative z-10" aria-hidden="true" />
              <span className="relative z-10 flex-1 text-left">{label}</span>
              <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            </>
          )}
        </button>
      );
      return (
        <Tooltip key={id}>
          <TooltipTrigger asChild>{lockedRow}</TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            Requires {requiresLabel}
          </TooltipContent>
        </Tooltip>
      );
    }
    const btn = (
      <button
        key={id}
        onClick={() => handleNav(id)}
        // AUDIT FIX (Finding 2.2): prefetch the tab's chunk on hover/focus so
        // the first switch to a tab doesn't wait on a cold chunk fetch.
        // Fire-and-forget (see preloadTab) - safe to call repeatedly.
        onPointerEnter={() => preloadTab(id)}
        onFocus={() => preloadTab(id)}
        className={`w-full flex items-center gap-3 rounded-lg text-sm font-medium transition-all duration-300 ease-out relative group sidebar-nav-item ${
          collapsed ? 'px-0 py-2.5 justify-center' : 'px-4 py-2.5'
        } ${
          isActive
            ? 'bg-orange-500/15 text-orange-400'
            : 'text-slate-300 hover:bg-white/5 hover:text-white'
        }`}
      >
        {/* Active item left border accent indicator (orange #f97316) */}
        {isActive && (
          <div className="absolute left-0 top-0.5 bottom-0.5 w-0.5 rounded-r-full bg-orange-500 transition-all duration-300" />
        )}
        <Icon className={`h-4 w-4 shrink-0 relative z-10 transition-transform duration-300 ${isActive ? 'scale-110' : 'group-hover:scale-110'}`} />
        {!collapsed && <span className="relative z-10">{label}</span>}
        {!collapsed && id === 'pos' && <kbd className="ml-auto rounded border border-white/10 px-1 text-[8px] text-slate-500 hidden xl:inline">F2</kbd>}
        {!collapsed && id === 'inventory' && <kbd className="ml-auto rounded border border-white/10 px-1 text-[8px] text-slate-500 hidden xl:inline">F3</kbd>}
        {!collapsed && id === 'customers' && <kbd className="ml-auto rounded border border-white/10 px-1 text-[8px] text-slate-500 hidden xl:inline">F4</kbd>}
        {!collapsed && id === 'financial' && <kbd className="ml-auto rounded border border-white/10 px-1 text-[8px] text-slate-500 hidden xl:inline">F5</kbd>}
        {/* Ripple effect overlay on click */}
        <span className="absolute inset-0 overflow-hidden rounded-lg pointer-events-none" />
      </button>
    );

    if (collapsed) {
      // Icon-mode tooltip: label + keyboard shortcut hint (v2.14.1).
      const shortcutHint = SHORTCUT_HINTS[id];
      return (
        <Tooltip key={id}>
          <TooltipTrigger asChild>{btn}</TooltipTrigger>
          <TooltipContent side="right" sideOffset={8} className="flex items-center gap-1.5">
            <span>{label}</span>
            {shortcutHint && (
              <kbd className="rounded border border-white/20 bg-white/10 px-1 font-sans text-[9px] font-semibold text-slate-300">
                {shortcutHint}
              </kbd>
            )}
          </TooltipContent>
        </Tooltip>
      );
    }
    return btn;
  };

  const avatarRingClass = getAvatarRingClass(user?.role);

  return (
    <TooltipProvider delayDuration={0}>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Fullscreen edge sensor (v2.14.1): a 20px left-edge strip that peeks
          the autohidden rail on hover, click, or keyboard focus. */}
      {fullscreenAutohide && !peek && (
        <div className="fixed left-0 top-0 z-40 flex h-full w-5 items-center" aria-hidden="false">
          <button
            type="button"
            aria-label="Show navigation"
            onMouseEnter={() => setPeek(true)}
            onFocus={() => setPeek(true)}
            onClick={() => setPeek(true)}
            className="flex h-16 w-5 items-center justify-center rounded-r-lg border border-l-0 border-white/10 bg-[#0f172a]/80 text-slate-400 shadow-md backdrop-blur-sm transition-colors hover:text-white"
          >
            <ChevronsRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Sidebar */}
      <aside
        ref={sidebarRef}
        role="navigation"
        aria-label="Main navigation"
        // `aria-collapsed` is not a valid ARIA attribute - the collapsible
        // state is conveyed through data-sidebar-state (React logged a
        // console error for the invalid prop).
        data-collapsed={collapsed}
        data-sidebar-state={fullscreenAutohide ? 'collapsed' : sidebarState}
        tabIndex={sidebarState === 'mobile-overlay' ? -1 : undefined}
        onMouseLeave={() => { if (fullscreenAutohide) setPeek(false); }}
        className={`fixed top-0 left-0 z-50 h-full bg-[#0f172a] text-slate-300 transform transition-all duration-300 ease-in-out lg:static lg:z-auto border-r border-white/10 shadow-lg lg:shadow-none ${
          collapsed ? 'lg:w-16 w-64' : 'w-64'
        } ${
          fullscreenAutohide
            ? peek
              ? 'lg:translate-x-0 lg:ml-0'
              : 'lg:-translate-x-full lg:-ml-16 lg:overflow-x-hidden'
            : `${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Logo + Collapse Toggle - v2.13.3 brand refresh: the 3D Mbumah logo
              (navy gear · orange house · silver trowel) sits in a WHITE rounded-xl
              container with drop shadow so it pops on the dark #0f172a sidebar
              (spec PART 1). Replaces the old flat green "MH" initials square. */}
          <div className={`flex items-center gap-3 border-b border-white/10 relative ${collapsed ? 'px-2 py-4 justify-center' : 'px-4 py-4'}`}>
            <div
              className={`shrink-0 rounded-xl bg-white shadow-lg shadow-black/30 flex items-center justify-center overflow-hidden ${collapsed ? 'w-9 h-9' : 'w-[132px]'}`}
            >
              {/* Light/white background: full-colour logo as-is (spec PART 1) */}
              <img
                src={collapsed ? '/logo3d-gear-256.png' : '/logo3d-200.webp'}
                alt="MBUMAH HARDWARE - Your Building Partner in Juja"
                className={collapsed ? 'w-full h-full object-cover' : 'w-full h-auto'}
                width={collapsed ? 36 : 132}
                height={collapsed ? 36 : 132}
              />
            </div>
            {!collapsed && (
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 text-slate-400 hover:text-white relative"
                onClick={() => setNotificationOpen(true)}
              >
                <Bell className="h-4 w-4" />
                {notificationCount.unread > 0 ? (
                  <span key={notifBadgeKey} className={`absolute -top-0.5 -right-0.5 min-w-[16px] h-4 flex items-center justify-center rounded-full text-[9px] font-bold text-white px-1 animate-badge-bounce-in ${notificationCount.critical > 0 ? 'bg-red-500 animate-pulse' : 'bg-amber-500'}`}>
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
                className="shrink-0 lg:hidden text-slate-400 hover:text-white"
                onClick={() => setSidebarOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
            {/* Collapse/expand toggle button (hidden in fullscreen: the
                rail is managed by the autohide peek instead) */}
            <button
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              onClick={toggleSidebarCollapse}
              className={`${fullscreenAutohide ? 'hidden' : 'hidden lg:flex'} absolute -right-3 top-1/2 -translate-y-1/2 z-50 h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-[#0f172a] text-slate-400 hover:text-white hover:bg-white/10 shadow-sm transition-all duration-200`}
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
                    className="text-slate-400 hover:text-white relative h-8 w-8"
                    onClick={() => setNotificationOpen(true)}
                  >
                    <Bell className="h-4 w-4" />
                    {notificationCount.unread > 0 && (
                      <span key={`collapsed-${notifBadgeKey}`} className={`absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 flex items-center justify-center rounded-full text-[8px] font-bold text-white px-0.5 animate-badge-bounce-in ${notificationCount.critical > 0 ? 'bg-red-500 animate-pulse' : 'bg-amber-500'}`}>
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
                      <button className="w-full flex items-center justify-center px-2 py-2 rounded-lg border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 transition-colors">
                        <Store className="h-3.5 w-3.5 shrink-0" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" sideOffset={8}>
                      {(() => { const s = STORE_LIST.find(x => x.id === currentStoreId); return s ? `${s.code} · ${s.shortName}` : 'Select Branch'; })()}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-xs text-slate-300 hover:bg-white/10 transition-colors">
                    <Store className="h-3.5 w-3.5 shrink-0" />
                    {/* Branch code surfacing (v2.3.0 codes: JUJ/THI/RUI/NAI/NAK) */}
                    <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-400 tracking-wide">
                      {STORE_LIST.find(s => s.id === currentStoreId)?.code || '-'}
                    </span>
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
                      <div className="text-sm font-medium truncate flex items-center gap-1.5">
                        <span className="rounded bg-primary/10 px-1 py-0.5 font-mono text-[10px] font-semibold text-primary tracking-wide">{s.code}</span>
                        {s.shortName}
                      </div>
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
                  <div className={`px-4 ${idx === 0 ? 'pt-2' : 'pt-4'} pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5`}>
                    <span>{group.label}</span>
                    <Separator className="flex-1 bg-white/10" />
                  </div>
                )}
                {collapsed && idx > 0 && (
                  <Separator className="my-2 mx-2 bg-white/10" />
                )}
                {group.items.map(renderNavItem)}
              </div>
            ))}
          </nav>

          {/* Footer - User Profile Dropdown - role-based avatar ring */}
          <div className={`border-t border-white/10 py-3 space-y-2 ${collapsed ? 'px-1' : 'px-3'}`}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                {collapsed ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="w-full flex justify-center px-1 py-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer" role="button" tabIndex={0}>
                        <div className="relative">
                          <Avatar className={`h-8 w-8 ring-2 ring-emerald-500/30 ${avatarRingClass}`}>
                            <AvatarFallback className="bg-gradient-to-br from-emerald-600 to-emerald-500 text-white text-[10px] font-semibold">
                              {user?.name?.split(' ').map(n => n[0]).join('') || 'U'}
                            </AvatarFallback>
                          </Avatar>
                          <span className="absolute bottom-0 right-0 w-2 h-2 bg-green-500 border-2 border-[#0f172a] rounded-full" />
                        </div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="right" sideOffset={8}>
                      {user?.name || 'User'} &mdash; {user?.role === 'SUPER_ADMIN' ? 'Super Admin' : user?.role === 'CASHIER' ? 'Cashier' : user?.role || 'User'}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <div className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors text-left cursor-pointer" role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.currentTarget.click(); }}>
                    <div className="relative">
                      <Avatar className={`h-9 w-9 ring-2 ring-emerald-500/30 ${avatarRingClass}`}>
                        <AvatarFallback className="bg-gradient-to-br from-emerald-600 to-emerald-500 text-white text-xs font-semibold">
                          {user?.name?.split(' ').map(n => n[0]).join('') || 'U'}
                        </AvatarFallback>
                      </Avatar>
                      <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-[#0f172a] rounded-full" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate text-white">{user?.name || 'User'}</p>
                      <p className="text-xs text-slate-400 truncate">{user?.role === 'SUPER_ADMIN' ? 'Super Admin' : user?.role === 'CASHIER' ? 'Cashier' : user?.role || 'User'}</p>
                    </div>
                    <ChevronDown className="h-3.5 w-3.5 text-slate-500 shrink-0" />
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
                {/* v2.7.0: real Profile & Settings dialog - replaces the
                    "coming soon" toast that lived here since the redesign. */}
                <DropdownMenuItem onClick={() => setProfileOpen(true)} data-testid="profile-settings-menu">
                  <ShieldCheck className="mr-2 h-4 w-4" />
                  Profile & Settings
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => toast.info('Press ? or Ctrl+/ for keyboard shortcuts')}>
                  <Keyboard className="mr-2 h-4 w-4" />
                  Keyboard Shortcuts
                </DropdownMenuItem>
                {/* v2.14.1 (fullscreen autohide): Fullscreen API entry point
                    alongside native F11; in fullscreen the sidebar autohides. */}
                <DropdownMenuItem
                  onClick={() => {
                    if (document.fullscreenElement) {
                      void document.exitFullscreen();
                    } else {
                      document.documentElement.requestFullscreen().catch(() => toast.error('Fullscreen is not available here'));
                    }
                  }}
                >
                  <Maximize2 className="mr-2 h-4 w-4" />
                  Toggle Fullscreen
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
      <ProfileSettingsDialog open={profileOpen} onOpenChange={setProfileOpen} />
    </TooltipProvider>
  );
}
