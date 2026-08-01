'use client'

// ════════════════════════════════════════════════════════════════════════════
// src/components/realtime/notification-toast.tsx
// ════════════════════════════════════════════════════════════════════════════
//
// Toast notifications for real-time events. Different styles per type:
//   - Low stock:        amber warning
//   - New transaction:  emerald success
//   - Payment received: blue info
//   - Loyalty upgrade:  purple celebration
//   - Stock movement:   teal info
//
// Auto-dismiss after 5 seconds. Click to navigate to relevant tab.

import { useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { Package, Receipt, CreditCard, Award, ArrowRightLeft, Bell } from 'lucide-react'
import {
  initSocket,
  disconnectSocket,
  onLowStockAlert,
  onNewTransaction,
  onPaymentReceived,
  onLoyaltyUpgrade,
  onStockMovement,
  onNotification,
  type RealtimeNotification,
} from '@/lib/socket-client'

// ── Toast style configuration per type ───────────────────────────────────────

interface ToastStyle {
  icon: React.ReactNode
  className: string
  label: string
  targetTab?: string
}

const TOAST_STYLES: Record<string, ToastStyle> = {
  'low-stock': {
    icon: <Package className="h-4 w-4" />,
    className: 'bg-amber-50 border-amber-300 text-amber-900 dark:bg-amber-950/30 dark:border-amber-700 dark:text-amber-200',
    label: 'Low Stock',
    targetTab: 'inventory',
  },
  'new-transaction': {
    icon: <Receipt className="h-4 w-4" />,
    className: 'bg-emerald-50 border-emerald-300 text-emerald-900 dark:bg-emerald-950/30 dark:border-emerald-700 dark:text-emerald-200',
    label: 'Transaction',
    targetTab: 'transactions',
  },
  'payment-received': {
    icon: <CreditCard className="h-4 w-4" />,
    className: 'bg-blue-50 border-blue-300 text-blue-900 dark:bg-blue-950/30 dark:border-blue-700 dark:text-blue-200',
    label: 'Payment',
    targetTab: 'financial',
  },
  'loyalty-tier-upgrade': {
    icon: <Award className="h-4 w-4" />,
    className: 'bg-purple-50 border-purple-300 text-purple-900 dark:bg-purple-950/30 dark:border-purple-700 dark:text-purple-200',
    label: 'Loyalty',
    targetTab: 'loyalty',
  },
  'stock-movement': {
    icon: <ArrowRightLeft className="h-4 w-4" />,
    className: 'bg-teal-50 border-teal-300 text-teal-900 dark:bg-teal-950/30 dark:border-teal-700 dark:text-teal-200',
    label: 'Stock Move',
    targetTab: 'inventory',
  },
}

const DEFAULT_STYLE: ToastStyle = {
  icon: <Bell className="h-4 w-4" />,
  className: 'bg-muted border-border text-foreground',
  label: 'Notification',
}

// ── Tab navigation helper ────────────────────────────────────────────────────

// Import the store setter lazily to avoid circular deps
let tabNavigateFn: ((tab: string) => void) | null = null

/**
 * Register a function to navigate to a tab when a toast is clicked.
 * Call this once from the root layout / page component.
 */
export function registerTabNavigator(fn: (tab: string) => void) {
  tabNavigateFn = fn
}

// ── Component ────────────────────────────────────────────────────────────────

interface NotificationToastProps {
  storeId: string
  userId?: string
}

export function NotificationToast({ storeId, userId }: NotificationToastProps) {
  const showToast = useCallback((data: RealtimeNotification) => {
    const style = TOAST_STYLES[data.type] || DEFAULT_STYLE

    toast.custom(
      () => (
        <button
          type="button"
          onClick={() => {
            if (style.targetTab && tabNavigateFn) {
              tabNavigateFn(style.targetTab)
            }
          }}
          className={`w-full flex items-start gap-3 p-3 rounded-lg border shadow-lg cursor-pointer transition-all hover:shadow-xl ${style.className}`}
        >
          <div className="shrink-0 mt-0.5">{style.icon}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider opacity-70">
                {style.label}
              </span>
            </div>
            <p className="text-sm font-medium mt-0.5">{data.title}</p>
            <p className="text-xs opacity-80 mt-0.5 line-clamp-2">{data.message}</p>
          </div>
        </button>
      ),
      {
        duration: 5000,
        position: 'top-right',
        // Use a unique ID to prevent duplicate toasts
        id: data.id,
      },
    )
  }, [])

  useEffect(() => {
    if (!storeId) return

    // Connect to the notification service
    initSocket(storeId, userId)

    // Subscribe to all notification types
    const unsubNotification = onNotification(showToast)
    const unsubLowStock = onLowStockAlert(showToast)
    const unsubNewTransaction = onNewTransaction(showToast)
    const unsubPayment = onPaymentReceived(showToast)
    const unsubLoyalty = onLoyaltyUpgrade(showToast)
    const unsubStock = onStockMovement(showToast)

    return () => {
      unsubNotification()
      unsubLowStock()
      unsubNewTransaction()
      unsubPayment()
      unsubLoyalty()
      unsubStock()
      disconnectSocket()
    }
  }, [storeId, userId, showToast])

  // This component doesn't render anything — it only shows toasts
  return null
}
