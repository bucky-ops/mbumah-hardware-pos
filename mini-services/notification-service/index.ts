import { createServer, IncomingMessage, ServerResponse } from 'http'
import { Server, Socket } from 'socket.io'

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
  console.log(`[CONNECT] Socket ${socket.id} connected at ${connectedAt}`)

  // ── Room management ──────────────────────────────────────────────────────

  socket.on('join-store', (storeId: string) => {
    if (!storeId || typeof storeId !== 'string') {
      socket.emit('error', { message: 'Invalid storeId' })
      return
    }
    const room = `store_${storeId}`
    socket.join(room)
    console.log(`[ROOM] Socket ${socket.id} joined room: ${room}`)
    socket.emit('room-joined', { room, type: 'store' })
  })

  socket.on('leave-store', (storeId: string) => {
    if (!storeId || typeof storeId !== 'string') return
    const room = `store_${storeId}`
    socket.leave(room)
    console.log(`[ROOM] Socket ${socket.id} left room: ${room}`)
    socket.emit('room-left', { room, type: 'store' })
  })

  socket.on('join-user', (userId: string) => {
    if (!userId || typeof userId !== 'string') {
      socket.emit('error', { message: 'Invalid userId' })
      return
    }
    const room = `user_${userId}`
    socket.join(room)
    console.log(`[ROOM] Socket ${socket.id} joined room: ${room}`)
    socket.emit('room-joined', { room, type: 'user' })
  })

  socket.on('leave-user', (userId: string) => {
    if (!userId || typeof userId !== 'string') return
    const room = `user_${userId}`
    socket.leave(room)
    console.log(`[ROOM] Socket ${socket.id} left room: ${room}`)
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
    console.log(`[NOTIFY] Notification sent to store_${storeId}: ${notification.type}`)
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
    console.log(`[LOW-STOCK] ${products.length} product(s) alert sent to store_${storeId}`)
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
    console.log(`[TRANSACTION] New ${transaction.type} (${transaction.currency} ${transaction.total}) notified to store_${storeId}`)
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
    console.log(`[PAYMENT] ${payment.method} ${payment.currency} ${payment.amount} received for store_${storeId}`)
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
    console.log(`[LOYALTY] ${upgrade.customerName} upgraded to ${upgrade.newTier} in store_${storeId}`)
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
    console.log(`[STOCK-MOVE] ${movement.type} ${movement.productName} × ${movement.quantity} in store_${storeId}`)
  })

  // ── Disconnect ───────────────────────────────────────────────────────────

  socket.on('disconnect', (reason) => {
    console.log(`[DISCONNECT] Socket ${socket.id} disconnected: ${reason}`)
  })

  socket.on('error', (error) => {
    console.error(`[ERROR] Socket ${socket.id} error:`, error)
  })
})

// ── Heartbeat / ping every 30s ──────────────────────────────────────────────

setInterval(() => {
  const connectedSockets = io.sockets.sockets.size
  if (connectedSockets > 0) {
    io.emit('heartbeat', {
      timestamp: new Date().toISOString(),
      connections: connectedSockets,
    })
  }
}, 30000)

// ── Start server ────────────────────────────────────────────────────────────

const PORT = 3003
httpServer.listen(PORT, () => {
  console.log(`[MBUMAH] Notification service running on port ${PORT}`)
  console.log(`[MBUMAH] Health check: http://localhost:${PORT}/health`)
  console.log(`[MBUMAH] WebSocket path: /`)
})

// ── Graceful shutdown ───────────────────────────────────────────────────────

const shutdown = (signal: string) => {
  console.log(`[SHUTDOWN] Received ${signal}, closing server...`)
  io.disconnectSockets(true)
  httpServer.close(() => {
    console.log('[SHUTDOWN] Notification service stopped')
    process.exit(0)
  })
  // Force exit after 5s if graceful shutdown hangs
  setTimeout(() => {
    console.error('[SHUTDOWN] Forced exit after timeout')
    process.exit(1)
  }, 5000)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
