// ════════════════════════════════════════════════════════════════════════════
// src/lib/notify.ts
// ════════════════════════════════════════════════════════════════════════════
//
// Backend notification helper — sends real-time notifications to store rooms
// and user-specific rooms via Socket.io. Used by API routes to push events
// (low stock alerts, new transactions, payment confirmations, etc.) to
// connected clients.
//
// IMPORTANT: This module uses the socket.io CLIENT from the server side to
// emit events to the notification service running on port 3003. It connects
// through the Caddy gateway using XTransformPort=3003.

import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'

// ── Types ────────────────────────────────────────────────────────────────────

export interface LowStockProduct {
  productId: string
  productName: string
  sku: string
  currentStock: number
  reorderLevel: number
  category?: string
}

export interface TransactionNotification {
  transactionId: string
  type: string
  total: number
  currency: string
  customerName?: string
  paymentMethod?: string
  items: number
}

export interface PaymentNotification {
  paymentId: string
  transactionId: string
  amount: number
  currency: string
  method: string
  customerName?: string
  reference?: string
}

export interface LoyaltyUpgradeNotification {
  customerId: string
  customerName: string
  oldTier: string
  newTier: string
  points: number
}

export interface StockMovementNotification {
  movementId: string
  productId: string
  productName: string
  type: 'IN' | 'OUT' | 'TRANSFER' | 'ADJUSTMENT' | 'RETURN'
  quantity: number
  previousStock: number
  newStock: number
  performedBy: string
  reason?: string
}

// ── Singleton server-side socket ─────────────────────────────────────────────

let serverSocket: Socket | null = null

/**
 * Get or create a server-side socket.io client connection to the
 * notification service. This is used by API routes to emit events.
 *
 * The connection is lazy — it only connects on first use.
 */
function getServerSocket(): Socket {
  if (serverSocket?.connected) return serverSocket

  // Connect through the Caddy gateway
  // For server-side connections, we use localhost directly since
  // we're connecting from the Next.js server process
  serverSocket = io('http://localhost:3003', {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    timeout: 5000,
    forceNew: true,
  })

  serverSocket.on('connect', () => {
    console.info('[NotifyHelper] Connected to notification service')
  })

  serverSocket.on('disconnect', (reason) => {
    console.info(`[NotifyHelper] Disconnected from notification service: ${reason}`)
  })

  serverSocket.on('connect_error', (err) => {
    console.error('[NotifyHelper] Connection error:', err.message)
  })

  return serverSocket
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Send a generic notification to a store room.
 *
 * @param storeId - The store ID (e.g., 'juja_main')
 * @param type - Notification type (e.g., 'low-stock', 'custom-alert')
 * @param data - Notification payload
 */
export function notifyStore(
  storeId: string,
  type: string,
  data: {
    title?: string
    message?: string
    payload?: Record<string, unknown>
  },
): void {
  try {
    const socket = getServerSocket()
    socket.emit('notification', {
      storeId,
      payload: {
        type,
        title: data.title || type,
        message: data.message || '',
        data: data.payload,
        timestamp: new Date().toISOString(),
        storeId,
      },
    })
  } catch (err) {
    console.error('[NotifyHelper] Failed to notify store:', err)
  }
}

/**
 * Send a notification to a specific user room.
 *
 * @param userId - The user ID
 * @param type - Notification type
 * @param data - Notification payload
 */
export function notifyUser(
  userId: string,
  type: string,
  data: {
    title?: string
    message?: string
    payload?: Record<string, unknown>
  },
): void {
  try {
    const socket = getServerSocket()
    // Join the user room and emit
    socket.emit('join-user', userId)
    socket.emit('notification', {
      storeId: '__user__',
      payload: {
        type,
        title: data.title || type,
        message: data.message || '',
        data: { ...data.payload, userId },
        timestamp: new Date().toISOString(),
      },
    })
  } catch (err) {
    console.error('[NotifyHelper] Failed to notify user:', err)
  }
}

/**
 * Push a low stock alert to a store room.
 *
 * @param storeId - The store ID
 * @param products - Array of products below reorder level
 */
export function notifyLowStock(storeId: string, products: LowStockProduct[]): void {
  try {
    const socket = getServerSocket()
    socket.emit('low-stock-alert', {
      storeId,
      products,
    })
  } catch (err) {
    console.error('[NotifyHelper] Failed to send low stock alert:', err)
  }
}

/**
 * Push a new transaction notification to a store room.
 *
 * @param storeId - The store ID
 * @param transaction - Transaction details
 */
export function notifyNewTransaction(storeId: string, transaction: TransactionNotification): void {
  try {
    const socket = getServerSocket()
    socket.emit('new-transaction', {
      storeId,
      transaction,
    })
  } catch (err) {
    console.error('[NotifyHelper] Failed to send transaction notification:', err)
  }
}

/**
 * Push a payment received notification to a store room.
 *
 * @param storeId - The store ID
 * @param payment - Payment details
 */
export function notifyPaymentReceived(storeId: string, payment: PaymentNotification): void {
  try {
    const socket = getServerSocket()
    socket.emit('payment-received', {
      storeId,
      payment,
    })
  } catch (err) {
    console.error('[NotifyHelper] Failed to send payment notification:', err)
  }
}

/**
 * Disconnect the server-side socket (useful for cleanup on server shutdown).
 */
export function disconnectNotifyHelper(): void {
  if (serverSocket) {
    serverSocket.disconnect()
    serverSocket = null
  }
}
