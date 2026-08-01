'use client'

// ════════════════════════════════════════════════════════════════════════════
// src/hooks/use-realtime.ts
// ════════════════════════════════════════════════════════════════════════════
//
// React hook for real-time notification management.
// Auto-connects on mount, disconnects on unmount, accumulates notifications
// in state, and provides unread count with markAllRead().

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  initSocket,
  disconnectSocket,
  onStatusChange,
  onNotification,
  onLowStockAlert,
  onNewTransaction,
  onPaymentReceived,
  onLoyaltyUpgrade,
  onStockMovement,
  type ConnectionStatus,
  type RealtimeNotification,
} from '@/lib/socket-client'

// ── Return type ──────────────────────────────────────────────────────────────

export interface UseRealtimeNotificationsReturn {
  /** Accumulated real-time notifications (most recent first) */
  notifications: RealtimeNotification[]
  /** Current WebSocket connection status */
  connectionStatus: ConnectionStatus
  /** Number of unread notifications */
  unreadCount: number
  /** Mark all accumulated notifications as read */
  markAllRead: () => void
}

// ── Max notifications to keep in state ───────────────────────────────────────

const MAX_NOTIFICATIONS = 100

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useRealtimeNotifications(
  storeId: string,
  userId?: string,
): UseRealtimeNotificationsReturn {
  const [notifications, setNotifications] = useState<RealtimeNotification[]>([])
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected')
  const [unreadCount, setUnreadCount] = useState(0)
  const readIdsRef = useRef<Set<string>>(new Set())

  // ── Initialize socket on mount ───────────────────────────────────────────

  useEffect(() => {
    if (!storeId) return

    // Connect to the notification service
    initSocket(storeId, userId)

    // Subscribe to connection status changes
    const unsubStatus = onStatusChange((status) => {
      setConnectionStatus(status)
    })

    // ── Subscribe to all notification events ────────────────────────────────

    const addNotification = (notif: RealtimeNotification) => {
      // Skip if already seen (dedup by id)
      setNotifications((prev) => {
        if (prev.some((n) => n.id === notif.id)) return prev
        const updated = [notif, ...prev].slice(0, MAX_NOTIFICATIONS)
        return updated
      })
      // Increment unread count if not already read
      if (!readIdsRef.current.has(notif.id)) {
        setUnreadCount((prev) => prev + 1)
      }
    }

    const unsubNotification = onNotification(addNotification)
    const unsubLowStock = onLowStockAlert(addNotification)
    const unsubNewTransaction = onNewTransaction(addNotification)
    const unsubPayment = onPaymentReceived(addNotification)
    const unsubLoyalty = onLoyaltyUpgrade(addNotification)
    const unsubStock = onStockMovement(addNotification)

    // ── Cleanup on unmount ──────────────────────────────────────────────────

    return () => {
      unsubStatus()
      unsubNotification()
      unsubLowStock()
      unsubNewTransaction()
      unsubPayment()
      unsubLoyalty()
      unsubStock()
      disconnectSocket()
    }
  }, [storeId, userId])

  // ── Mark all as read ─────────────────────────────────────────────────────

  const markAllRead = useCallback(() => {
    setNotifications((prev) => {
      prev.forEach((n) => readIdsRef.current.add(n.id))
      return prev
    })
    setUnreadCount(0)
  }, [])

  return {
    notifications,
    connectionStatus,
    unreadCount,
    markAllRead,
  }
}
