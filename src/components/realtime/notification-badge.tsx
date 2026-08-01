'use client'

// ════════════════════════════════════════════════════════════════════════════
// src/components/realtime/notification-badge.tsx
// ════════════════════════════════════════════════════════════════════════════
//
// Real-time notification badge with:
// - Bounce animation on new items
// - Green pulse when connected, red when disconnected
// - Click to open notification panel
// - Shows last 5 notifications as dropdown

import React, { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Bell, Wifi, WifiOff, Package, Receipt, CreditCard, Award, ArrowRightLeft, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useRealtimeNotifications } from '@/hooks/use-realtime'
import type { RealtimeNotification } from '@/lib/socket-client'

// ── Notification icon by type ────────────────────────────────────────────────

function getNotificationIcon(type: string) {
  switch (type) {
    case 'low-stock':
      return <Package className="h-3.5 w-3.5 text-amber-500" />
    case 'new-transaction':
      return <Receipt className="h-3.5 w-3.5 text-emerald-500" />
    case 'payment-received':
      return <CreditCard className="h-3.5 w-3.5 text-blue-500" />
    case 'loyalty-tier-upgrade':
      return <Award className="h-3.5 w-3.5 text-purple-500" />
    case 'stock-movement':
      return <ArrowRightLeft className="h-3.5 w-3.5 text-teal-500" />
    default:
      return <Bell className="h-3.5 w-3.5 text-muted-foreground" />
  }
}

function getNotificationBg(type: string) {
  switch (type) {
    case 'low-stock':
      return 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/40'
    case 'new-transaction':
      return 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/40'
    case 'payment-received':
      return 'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800/40'
    case 'loyalty-tier-upgrade':
      return 'bg-purple-50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-800/40'
    case 'stock-movement':
      return 'bg-teal-50 dark:bg-teal-950/20 border-teal-200 dark:border-teal-800/40'
    default:
      return 'bg-muted border-border'
  }
}

// ── Props ────────────────────────────────────────────────────────────────────

interface NotificationBadgeProps {
  storeId: string
  userId?: string
  /** Optional callback when a notification is clicked — e.g., navigate to a tab */
  onNotificationClick?: (notification: RealtimeNotification) => void
}

// ── Component ────────────────────────────────────────────────────────────────

export function NotificationBadge({ storeId, userId, onNotificationClick }: NotificationBadgeProps) {
  const { notifications, connectionStatus, unreadCount, markAllRead } = useRealtimeNotifications(storeId, userId)
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Bounce animation: use the unreadCount as an animation key so the
  // CSS animation restarts each time it changes. This avoids setState in effects.
  const bounceKey = unreadCount

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Close on Escape key
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false)
    }
    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      return () => document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen])

  const lastFive = notifications.slice(0, 5)

  const isConnected = connectionStatus === 'connected'
  const isReconnecting = connectionStatus === 'reconnecting'

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell button */}
      <motion.button
        key={`bell-${bounceKey}`}
        animate={bounceKey > 0 ? { scale: [1, 1.3, 0.9, 1.1, 1] } : { scale: 1 }}
        transition={{ duration: 0.5 }}
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-lg hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <Bell className="h-5 w-5 text-muted-foreground" />

        {/* Connection status indicator */}
        <span
          className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-background ${
            isConnected
              ? 'bg-green-500 animate-pulse'
              : isReconnecting
                ? 'bg-amber-500 animate-pulse'
                : 'bg-red-500'
          }`}
          title={isConnected ? 'Connected' : isReconnecting ? 'Reconnecting...' : 'Disconnected'}
        />

        {/* Unread count badge */}
        {unreadCount > 0 && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold px-1"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </motion.span>
        )}
      </motion.button>

      {/* Dropdown panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-2 w-80 rounded-lg border bg-background shadow-lg z-50"
            role="menu"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">Live Notifications</span>
                {isConnected ? (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-green-600 border-green-300">
                    <Wifi className="h-3 w-3 mr-0.5" /> Live
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-red-600 border-red-300">
                    <WifiOff className="h-3 w-3 mr-0.5" /> Offline
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1">
                {unreadCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-[10px] h-6 px-1.5"
                    onClick={markAllRead}
                  >
                    Mark all read
                  </Button>
                )}
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="p-1 rounded hover:bg-muted transition-colors"
                  aria-label="Close notifications"
                >
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>
            </div>

            {/* Notifications list */}
            <ScrollArea className="max-h-80">
              {lastFive.length === 0 ? (
                <div className="p-6 text-center">
                  <Bell className="h-8 w-8 mx-auto text-muted-foreground/30 mb-2" />
                  <p className="text-xs text-muted-foreground">No real-time notifications yet</p>
                  <p className="text-[10px] text-muted-foreground/60 mt-1">
                    Alerts will appear here as they happen
                  </p>
                </div>
              ) : (
                <div className="p-2 space-y-1.5">
                  {lastFive.map((notif) => (
                    <button
                      key={notif.id}
                      type="button"
                      onClick={() => {
                        onNotificationClick?.(notif)
                        setIsOpen(false)
                      }}
                      className={`w-full text-left p-2.5 rounded-md border text-xs transition-all hover:shadow-sm cursor-pointer ${getNotificationBg(notif.type)}`}
                    >
                      <div className="flex items-start gap-2">
                        <div className="shrink-0 mt-0.5">{getNotificationIcon(notif.type)}</div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-[11px]">{notif.title}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
                            {notif.message}
                          </p>
                          <p className="text-[9px] text-muted-foreground/50 mt-1">
                            {formatRelativeTime(notif.timestamp)}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>

            {/* Footer */}
            {notifications.length > 5 && (
              <div className="p-2 border-t text-center">
                <p className="text-[10px] text-muted-foreground">
                  +{notifications.length - 5} more notification{notifications.length - 5 !== 1 ? 's' : ''}
                </p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Helper ───────────────────────────────────────────────────────────────────

function formatRelativeTime(timestamp: string): string {
  const now = Date.now()
  const then = new Date(timestamp).getTime()
  const diffMs = now - then
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHr = Math.floor(diffMin / 60)

  if (diffSec < 10) return 'Just now'
  if (diffSec < 60) return `${diffSec}s ago`
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  return new Date(timestamp).toLocaleDateString()
}
