// ════════════════════════════════════════════════════════════════════════════
// src/lib/socket-client.ts
// ════════════════════════════════════════════════════════════════════════════
//
// Browser-safe Socket.io client for the MBUMAH real-time notification service.
// Connects through the Caddy gateway using XTransformPort=3003.
//
// IMPORTANT: Never use `io('http://localhost:3003')` or any direct port-based
// connection. Always use `io('/?XTransformPort=3003')` so the Caddy gateway
// can forward the request to the correct port.

import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'

// ── Types ────────────────────────────────────────────────────────────────────

export type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting'

export interface RealtimeNotification {
  id: string
  type: string
  title: string
  message: string
  data?: Record<string, unknown>
  timestamp: string
  storeId?: string
}

// ── Singleton socket instance ────────────────────────────────────────────────

let socket: Socket | null = null
let connectionStatus: ConnectionStatus = 'disconnected'
const MAX_RECONNECT_ATTEMPTS = 20

// Status change listeners
type StatusListener = (status: ConnectionStatus) => void
const statusListeners = new Set<StatusListener>()

function updateStatus(status: ConnectionStatus) {
  connectionStatus = status
  statusListeners.forEach((listener) => listener(status))
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialize the socket connection to the notification service.
 * Connects through the Caddy gateway using XTransformPort=3003.
 *
 * @param storeId - The store ID to join (e.g., 'juja_main')
 * @param userId - Optional user ID for user-specific room
 */
export function initSocket(storeId: string, userId?: string): Socket {
  if (socket?.connected) {
    // Already connected — just update rooms
    if (storeId) socket.emit('join-store', storeId)
    if (userId) socket.emit('join-user', userId)
    return socket
  }

  // Create a new socket connection
  // MUST use relative path with XTransformPort for Caddy gateway
  socket = io('/?XTransformPort=3003', {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
    timeout: 10000,
    forceNew: true,
  })

  // ── Connection events ────────────────────────────────────────────────────

  socket.on('connect', () => {
    updateStatus('connected')

    // Auto-join rooms on connect / reconnect
    if (storeId) socket.emit('join-store', storeId)
    if (userId) socket.emit('join-user', userId)

    console.info(`[SocketClient] Connected to notification service (storeId=${storeId})`)
  })

  socket.on('disconnect', (reason) => {
    updateStatus('disconnected')
    console.info(`[SocketClient] Disconnected: ${reason}`)
  })

  socket.on('reconnecting', (attempt) => {
    updateStatus('reconnecting')
    console.info(`[SocketClient] Reconnecting... attempt ${attempt}`)
  })

  socket.on('reconnect_failed', () => {
    updateStatus('disconnected')
    console.error('[SocketClient] Reconnection failed after max attempts')
  })

  socket.on('connect_error', (err) => {
    console.error('[SocketClient] Connection error:', err.message)
  })

  return socket
}

/**
 * Disconnect from the notification service.
 */
export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect()
    socket = null
    updateStatus('disconnected')
    console.info('[SocketClient] Disconnected and cleaned up')
  }
}

/**
 * Get the current socket instance (or null if not connected).
 */
export function getSocket(): Socket | null {
  return socket
}

/**
 * Get the current connection status.
 */
export function getConnectionStatus(): ConnectionStatus {
  return connectionStatus
}

/**
 * Subscribe to connection status changes.
 * Returns an unsubscribe function.
 */
export function onStatusChange(listener: StatusListener): () => void {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

// ── Event listeners ──────────────────────────────────────────────────────────

/**
 * Listen for general notifications.
 */
export function onNotification(callback: (data: RealtimeNotification) => void): () => void {
  socket?.on('notification', callback)
  return () => socket?.off('notification', callback)
}

/**
 * Listen for low stock alerts.
 */
export function onLowStockAlert(callback: (data: RealtimeNotification) => void): () => void {
  socket?.on('low-stock-alert', callback)
  return () => socket?.off('low-stock-alert', callback)
}

/**
 * Listen for new transaction notifications.
 */
export function onNewTransaction(callback: (data: RealtimeNotification) => void): () => void {
  socket?.on('new-transaction', callback)
  return () => socket?.off('new-transaction', callback)
}

/**
 * Listen for payment received notifications.
 */
export function onPaymentReceived(callback: (data: RealtimeNotification) => void): () => void {
  socket?.on('payment-received', callback)
  return () => socket?.off('payment-received', callback)
}

/**
 * Listen for loyalty tier upgrade notifications.
 */
export function onLoyaltyUpgrade(callback: (data: RealtimeNotification) => void): () => void {
  socket?.on('loyalty-tier-upgrade', callback)
  return () => socket?.off('loyalty-tier-upgrade', callback)
}

/**
 * Listen for stock movement notifications.
 */
export function onStockMovement(callback: (data: RealtimeNotification) => void): () => void {
  socket?.on('stock-movement', callback)
  return () => socket?.off('stock-movement', callback)
}

// ── Emit helpers ─────────────────────────────────────────────────────────────

/**
 * Send a notification to a store room.
 */
export function emitNotification(storeId: string, data: Omit<RealtimeNotification, 'id' | 'timestamp'>): void {
  if (!socket?.connected) {
    console.warn('[SocketClient] Cannot emit notification — not connected')
    return
  }
  socket.emit('notification', {
    storeId,
    payload: {
      ...data,
      id: data.id || `client_${Date.now()}`,
      timestamp: new Date().toISOString(),
      storeId,
    },
  })
}
