'use client';

/**
 * FloatingHomeButton — a floating action button (FAB) that appears when the
 * user is authenticated and is NOT already on the dashboard tab. Clicking it
 * navigates to the dashboard (the app's "home").
 *
 * Positioned bottom-right, above the footer, with a subtle pulse + tooltip.
 * Hidden on the login screen (parent conditionally renders it).
 */

import React from 'react';
import { Home } from 'lucide-react';
import { useAppStore } from '@/lib/stores';

export function FloatingHomeButton() {
  const activeTab = useAppStore((s) => s.activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);

  // Hide when already on dashboard — no need to show a "go home" button on home
  if (activeTab === 'dashboard') return null;

  return (
    <button
      onClick={() => setActiveTab('dashboard')}
      aria-label="Go to Dashboard"
      title="Back to Dashboard (Home)"
      className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 hover:shadow-xl hover:shadow-primary/40 hover:scale-110 active:scale-95 flex items-center justify-center transition-all duration-300 group animate-in fade-in slide-in-from-bottom-4 duration-300"
    >
      {/* Pulse ring */}
      <span className="absolute inset-0 rounded-full bg-primary/40 animate-ping opacity-30" />
      <Home className="h-6 w-6 relative z-10 transition-transform group-hover:scale-110" />
      {/* Tooltip */}
      <span className="absolute right-full mr-3 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-popover px-2.5 py-1.5 text-xs font-medium text-popover-foreground shadow-md border opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        Dashboard
      </span>
    </button>
  );
}
