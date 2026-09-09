import { createServer, IncomingMessage, ServerResponse } from 'http'
import { Server, Socket } from 'socket.io'

// ── AUDIT FIX (Findings 3.3 + 2.3 — structured logging & heartbeat lifecycle) ─
//
// The service previously mixed console.log/console.error with ad-hoc
// [TAG] prefixes, emitted a heartbeat from an anonymous setInterval that was
// never cleared on shutdown, and logged disconnect reasons without
// classification. That made production issues hard to correlate and risked
// leaking intervals across dev HMR reloads.
//
// Everything below now goes through `log()` — one JSON object per line
// (level, component, message + queryable context fields) that Vercel/Docker
// log drains can parse and filter — and the heartbeat interval is owned by
// startHeartbeat()/stopHeartbeat() so SIGTERM/SIGINT clears it.

// ── Structured logger ────────────────────────────────────────────────────

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LOG_LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

const activeLogLevel: LogLevel =
  (process.env.LOG_LEVEL as LogLevel | undefined) &&
  LOG_LEVEL_WEIGHT[process.env.LOG_LEVEL as LogLevel] !== undefined
    ? (process.env.LOG_LEVEL as LogLevel)
    : 'info'

/**
 * Emit ONE structured JSON log line. Context fields are spread at the top
 * level (not nested) so log aggregators can index them directly.
 */
function log(level: LogLevel, component: string, message: string, context: Record<string, unknown> = {}): void {
  if (LOG_LEVEL_WEIGHT[level] < LOG_LEVEL_WEIGHT[activeLogLevel]) return
  const entry = {
    ts: new Date().toISOString(),
    level,
    component,
    message,
    ...context,
  }
  // JSON.stringify guards against accidental prototype pollution from
  // untrusted payloads re-logged as context.
  const line = JSON.stringify(entry)
  if (level === 'error') console.error(line)
  else console.log(line)
}

// ── Types ────────────────────────────────────────────────────────────────────

interface NotificationPayload {
  id: string
  type: string
  title: string
  message: string
  data?: Record<string, unknown>
  timestamp: string
  storeId?: string
}

interface LowStockProduct {
  productId: string
  productName: string
  sku: string
  currentStock: number
  reorderLevel: number
  category?: string
}

interface TransactionPayload {
  transactionId: string
  type: string
  total: number
  currency: string
  customerName?: string
  paymentMethod?: string
  items: number
}

interface PaymentPayload {
  paymentId: string
  transactionId: string
  amount: number
  currency: string
  method: string
  customerName?: string
  reference?: string
}

interface LoyaltyUpgradePayload {
  customerId: string
  customerName: string
  oldTier: string
  newTier: string
  points: number
}

interface StockMovementPayload {
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

// ── Health check data (shared with socket.io handler) ────────────────────────

let ioInstance: Server | null = null

function sendHealthCheck(res: ServerResponse) {
  const connectedSockets = ioInstance?.sockets.sockets.size ?? 0
  const rooms = ioInstance ? Array.from(ioInstance.sockets.adapter.rooms.keys()) : []
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(
    JSON.stringify({
      status: 'ok',
      service: 'mbumah-notification-service',
      version: '1.0.0',
      uptime: Math.floor(process.uptime()),
      connections: connectedSockets,
      rooms: rooms.filter((r) => !r.startsWith('socket:')),
      timestamp: new Date().toISOString(),
    }),
  )
}

// ── HTTP Server ──────────────────────────────────────────────────────────────
// We use createServer with a callback so our handler runs BEFORE socket.io
// can intercept the request. When we respond and call res.end(), the socket.io
// handler sees the response is already finished and skips.

const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  // Health check endpoint
  if (req.method === 'GET' && req.url && req.url.split('?')[0] === '/health') {
    sendHealthCheck(res)
    return
  }
})

// ── Socket.io Server ─────────────────────────────────────────────────────────

const io = new Server(httpServer, {
  // Using default path /socket.io/ so that health check at /health works.
  // Engine.IO intercepts all requests matching the path option. With path: '/',
  // ALL requests are intercepted and the health check handler never runs.
  // The default /socket.io/ path allows non-socket.io requests to pass through.
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
})

ioInstance = io

// ── Helper to generate unique IDs ───────────────────────────────────────────

const generateId = () => `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

// ── Socket connection handling ───────────────────────────────────────────────

io.on('connection', (socket: Socket) => {
  const connectedAt = new Date().toISOString()
  log('info', 'WebSocket', 'Socket connected', {
    socketId: socket.id,
    connectedAt,
    handshakeAddress: socket.handshake.address,
  })

  // ── Room management ──────────────────────────────────────────────────────

  socket.on('join-store', (storeId: string) => {
    if (!storeId || typeof storeId !== 'string') {
      socket.emit('error', { message: 'Invalid storeId' })
      return
    }
    const room = `store_${storeId}`
    socket.join(room)
    log('debug', 'WebSocket', 'Socket joined store room', { socketId: socket.id, room })
    socket.emit('room-joined', { room, type: 'store' })
  })

  socket.on('leave-store', (storeId: string) => {
    if (!storeId || typeof storeId !== 'string') return
    const room = `store_${storeId}`
    socket.leave(room)
    log('debug', 'WebSocket', 'Socket left store room', { socketId: socket.id, room })
    socket.emit('room-left', { room, type: 'store' })
  })

  socket.on('join-user', (userId: string) => {
    if (!userId || typeof userId !== 'string') {
      socket.emit('error', { message: 'Invalid userId' })
      return
    }
    const room = `user_${userId}`
    socket.join(room)
    log('debug', 'WebSocket', 'Socket joined user room', { socketId: socket.id, room })
    socket.emit('room-joined', { room, type: 'user' })
  })

  socket.on('leave-user', (userId: string) => {
    if (!userId || typeof userId !== 'string') return
    const room = `user_${userId}`
    socket.leave(room)
    log('debug', 'WebSocket', 'Socket left user room', { socketId: socket.id, room })
    socket.emit('room-left', { room, type: 'user' })
  })

  // ── Notification events ──────────────────────────────────────────────────

  socket.on('notification', (data: { storeId: string; payload: NotificationPayload }) => {
    const { storeId, payload } = data
    if (!storeId) {
      socket.emit('error', { message: 'storeId is required' })
      return
    }
    const notification: NotificationPayload = {
      ...payload,
      id: payload.id || generateId(),
      timestamp: payload.timestamp || new Date().toISOString(),
      storeId,
    }
    io.to(`store_${storeId}`).emit('notification', notification)
    log('info', 'Notification', 'Notification delivered to store room', {
      storeId,
      type: notification.type,
      notificationId: notification.id,
    })
  })

  // ── Low stock alert ──────────────────────────────────────────────────────

  socket.on('low-stock-alert', (data: { storeId: string; products: LowStockProduct[] }) => {
    const { storeId, products } = data
    if (!storeId) {
      socket.emit('error', { message: 'storeId is required' })
      return
    }
    const notification: NotificationPayload = {
      id: generateId(),
      type: 'low-stock',
      title: 'Low Stock Alert',
      message: `${products.length} product(s) below reorder level`,
      data: { products },
      timestamp: new Date().toISOString(),
      storeId,
    }
    io.to(`store_${storeId}`).emit('low-stock-alert', notification)
    log('warn', 'LowStock', 'Low stock alert delivered', {
      storeId,
      productCount: products.length,
    })
  })

  // ── New transaction ──────────────────────────────────────────────────────

  socket.on('new-transaction', (data: { storeId: string; transaction: TransactionPayload }) => {
    const { storeId, transaction } = data
    if (!storeId) {
      socket.emit('error', { message: 'storeId is required' })
      return
    }
    const notification: NotificationPayload = {
      id: generateId(),
      type: 'new-transaction',
      title: 'New Transaction',
      message: `${transaction.type} — ${transaction.currency} ${transaction.total.toFixed(2)}`,
      data: { transaction },
      timestamp: new Date().toISOString(),
      storeId,
    }
    io.to(`store_${storeId}`).emit('new-transaction', notification)
    log('info', 'Transaction', 'New transaction broadcast', {
      storeId,
      transactionId: transaction.transactionId,
      type: transaction.type,
      total: transaction.total,
      currency: transaction.currency,
    })
  })

  // ── Payment received ─────────────────────────────────────────────────────

  socket.on('payment-received', (data: { storeId: string; payment: PaymentPayload }) => {
    const { storeId, payment } = data
    if (!storeId) {
      socket.emit('error', { message: 'storeId is required' })
      return
    }
    const notification: NotificationPayload = {
      id: generateId(),
      type: 'payment-received',
      title: 'Payment Received',
      message: `${payment.method} payment of ${payment.currency} ${payment.amount.toFixed(2)}`,
      data: { payment },
      timestamp: new Date().toISOString(),
      storeId,
    }
    io.to(`store_${storeId}`).emit('payment-received', notification)
    log('info', 'Payment', 'Payment received broadcast', {
      storeId,
      paymentId: payment.paymentId,
      transactionId: payment.transactionId,
      method: payment.method,
      amount: payment.amount,
      currency: payment.currency,
    })
  })

  // ── Loyalty tier upgrade ─────────────────────────────────────────────────

  socket.on('loyalty-tier-upgrade', (data: { storeId: string; upgrade: LoyaltyUpgradePayload }) => {
    const { storeId, upgrade } = data
    if (!storeId) {
      socket.emit('error', { message: 'storeId is required' })
      return
    }
    const notification: NotificationPayload = {
      id: generateId(),
      type: 'loyalty-tier-upgrade',
      title: 'Loyalty Tier Upgrade',
      message: `${upgrade.customerName} upgraded from ${upgrade.oldTier} to ${upgrade.newTier}`,
      data: { upgrade },
      timestamp: new Date().toISOString(),
      storeId,
    }
    io.to(`store_${storeId}`).emit('loyalty-tier-upgrade', notification)
    log('info', 'Loyalty', 'Loyalty tier upgrade broadcast', {
      storeId,
      customerId: upgrade.customerId,
      oldTier: upgrade.oldTier,
      newTier: upgrade.newTier,
      points: upgrade.points,
    })
  })

  // ── Stock movement ───────────────────────────────────────────────────────

  socket.on('stock-movement', (data: { storeId: string; movement: StockMovementPayload }) => {
    const { storeId, movement } = data
    if (!storeId) {
      socket.emit('error', { message: 'storeId is required' })
      return
    }
    const notification: NotificationPayload = {
      id: generateId(),
      type: 'stock-movement',
      title: 'Stock Movement',
      message: `${movement.type}: ${movement.productName} × ${movement.quantity} (${movement.previousStock} → ${movement.newStock})`,
      data: { movement },
      timestamp: new Date().toISOString(),
      storeId,
    }
    io.to(`store_${storeId}`).emit('stock-movement', notification)
    log('info', 'StockMovement', 'Stock movement broadcast', {
      storeId,
      movementId: movement.movementId,
      productId: movement.productId,
      type: movement.type,
      quantity: movement.quantity,
      previousStock: movement.previousStock,
      newStock: movement.newStock,
    })
  })

  // ── Disconnect ───────────────────────────────────────────────────────────

  socket.on('disconnect', (reason: string) => {
    // AUDIT FIX (Finding 3.3): classify disconnect reasons so log drains can
    // separate routine lifecycle events from network trouble.
    //   • clean:  transport close / server-namespace disconnect / client ping
    //     timeout by explicit client close — normal churn, logged at debug.
    //   • error:  transport errors, ping timeouts, everything else — warn.
    const cleanReasons = new Set([
      'transport close',
      'server namespace disconnect',
      'client namespace disconnect',
    ])
    const isClean = cleanReasons.has(reason)
    log(isClean ? 'debug' : 'warn', 'WebSocket', 'Socket disconnected', {
      socketId: socket.id,
      reason,
      clean: isClean,
    })
  })

  socket.on('error', (error: Error) => {
    log('error', 'WebSocket', 'Socket error', {
      socketId: socket.id,
      errorName: error?.name,
      errorMessage: error?.message,
      stack: error?.stack,
    })
  })
})

// ── Heartbeat / ping every 30s ──────────────────────────────────────────────
// AUDIT FIX (Finding 2.3): the interval handle is now owned and CLEARED on
// shutdown (previous anonymous setInterval kept firing across dev HMR
// reloads and could never be stopped). Emission skips instantly when no
// clients are connected.

const HEARTBEAT_INTERVAL_MS = 30000
let heartbeatTimer: ReturnType<typeof setInterval> | null = null

function startHeartbeat(): void {
  if (heartbeatTimer !== null) return // idempotent — never double-schedule
  heartbeatTimer = setInterval(() => {
    const connectedSockets = io.sockets.sockets.size
    if (connectedSockets === 0) return // nothing to heartbeat — cheap no-op
    io.emit('heartbeat', {
      timestamp: new Date().toISOString(),
      connections: connectedSockets,
    })
    log('debug', 'Heartbeat', 'Heartbeat emitted', { connections: connectedSockets })
  }, HEARTBEAT_INTERVAL_MS)
}

function stopHeartbeat(): void {
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

startHeartbeat()

// ── Start server ────────────────────────────────────────────────────────────

const PORT = 3003
httpServer.listen(PORT, () => {
  log('info', 'Server', 'Notification service listening', {
    port: PORT,
    healthCheckPath: '/health',
    webSocketPath: '/',
    logLevel: activeLogLevel,
  })
})

// ── Graceful shutdown ───────────────────────────────────────────────────────

const shutdown = (signal: string) => {
  log('info', 'Server', 'Shutdown requested', { signal })
  stopHeartbeat() // AUDIT FIX (Finding 2.3): no lingering interval after exit
  io.disconnectSockets(true)
  httpServer.close(() => {
    log('info', 'Server', 'Notification service stopped')
    process.exit(0)
  })
  // Force exit after 5s if graceful shutdown hangs
  setTimeout(() => {
    log('error', 'Server', 'Forced exit after shutdown timeout')
    process.exit(1)
  }, 5000)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
