'use client';

/**
 * AlertPopupHost — renders the app's ALERT POPUPS (v2.5.0).
 *
 * Behaviour (per the product requirement):
 *   • every popup stays on screen for 45 SECONDS (ALERT_POPUP_DURATION_MS)
 *   • a countdown bar drains while the popup is visible
 *   • hovering a popup PAUSES its countdown (so staff can read calmly)
 *   • every popup has a Close (✕) button for instant dismissal
 *   • popups stack bottom-left and never exceed 4 on screen
 *
 * Sources of popups:
 *   1. any client module calling showAlert() from '@/lib/alert-bus'
 *   2. automatic: this host polls the notifications API every 60s and pops
 *      NEW critical/warning notifications exactly once (ids already alerted
 *      are remembered in localStorage), so urgent store events — out-of-stock
 *      items, overdue rentals, large debts — surface without anyone watching
 *      the bell menu.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Info, CheckCircle2, AlertTriangle, AlertOctagon } from 'lucide-react';
import { notificationsApi } from '@/lib/api';
import { useAppStore } from '@/lib/stores';
import {
  useAlertStore,
  showAlert,
  ALERT_POPUP_DURATION_MS,
  type AlertInstance,
  type AlertVariant,
} from '@/lib/alert-bus';

const VARIANT_STYLES: Record<
  AlertVariant,
  { ring: string; icon: React.ElementType; iconColor: string; bar: string }
> = {
  info: {
    ring: 'border-sky-300 dark:border-sky-800',
    icon: Info,
    iconColor: 'text-sky-600 dark:text-sky-400',
    bar: 'bg-sky-500',
  },
  success: {
    ring: 'border-emerald-300 dark:border-emerald-800',
    icon: CheckCircle2,
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    bar: 'bg-emerald-500',
  },
  warning: {
    ring: 'border-amber-300 dark:border-amber-800',
    icon: AlertTriangle,
    iconColor: 'text-amber-600 dark:text-amber-400',
    bar: 'bg-amber-500',
  },
  critical: {
    ring: 'border-red-300 dark:border-red-800',
    icon: AlertOctagon,
    iconColor: 'text-red-600 dark:text-red-400',
    bar: 'bg-red-500',
  },
};

/** One popup card with its own 45s countdown (pauses on hover). */
function AlertPopup({ alert }: { alert: AlertInstance }) {
  const dismissAlert = useAlertStore((s) => s.dismissAlert);
  const [paused, setPaused] = useState(false);
  const variant = VARIANT_STYLES[alert.variant ?? 'info'];
  const Icon = variant.icon;
  const remainingRef = useRef<number>(ALERT_POPUP_DURATION_MS);
  const startedAtRef = useRef<number>(Date.now());
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const armTimer = useCallback(() => {
    startedAtRef.current = Date.now();
    timeoutRef.current = setTimeout(
      () => dismissAlert(alert.id),
      remainingRef.current
    );
  }, [alert.id, dismissAlert]);

  // Arm on mount; disarm on unmount.
  useEffect(() => {
    armTimer();
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [armTimer]);

  const pause = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    remainingRef.current = Math.max(
      0,
      remainingRef.current - (Date.now() - startedAtRef.current)
    );
    setPaused(true);
  };

  const resume = () => {
    if (remainingRef.current <= 0) {
      dismissAlert(alert.id);
      return;
    }
    armTimer();
    setPaused(false);
  };

  return (
    <div
      role="alert"
      aria-live="assertive"
      onMouseEnter={pause}
      onMouseLeave={resume}
      className={`pointer-events-auto relative w-[min(92vw,360px)] overflow-hidden rounded-xl border bg-card/95 shadow-xl shadow-black/10 backdrop-blur-sm ${variant.ring}`}
    >
      <div className="flex items-start gap-3 p-4 pb-3">
        <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${variant.iconColor}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug">{alert.title}</p>
          {alert.message ? (
            <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
              {alert.message}
            </p>
          ) : null}
        </div>
        {/* Close option — always available (product requirement) */}
        <button
          type="button"
          onClick={() => dismissAlert(alert.id)}
          aria-label="Dismiss alert"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {/* 45-second countdown bar */}
      <div className="h-1 w-full bg-muted/60">
        <div
          className={`h-full ${variant.bar} alert-countdown-bar`}
          style={{
            animationDuration: `${ALERT_POPUP_DURATION_MS}ms`,
            animationPlayState: paused ? 'paused' : 'running',
          }}
        />
      </div>
    </div>
  );
}

/** Mount once (providers.tsx). Renders the popup stack + notification poller. */
export function AlertPopupHost() {
  const alerts = useAlertStore((s) => s.alerts);
  const alertedIdsRef = useRef<Set<string> | null>(null);
  // Live branch from the app store — re-renders on branch switch / hydration,
  // no setState-in-effect needed (react-hooks lint).
  const currentStoreId = useAppStore((s) => s.currentStoreId);

  // ── Load the "already alerted" memory before the first poll ──
  useEffect(() => {
    try {
      const stored = localStorage.getItem('mbt_alerted_notification_ids');
      alertedIdsRef.current = new Set<string>(stored ? JSON.parse(stored) : []);
    } catch {
      alertedIdsRef.current = new Set<string>();
    }
  }, []);

  // ── Poll store notifications; pop NEW critical/warning ones for 45s ──
  useQuery({
    queryKey: ['alert-popup-notifications', currentStoreId],
    queryFn: async () => {
      if (!currentStoreId) return null;
      const res = await notificationsApi.list(currentStoreId);
      const items = (res?.data ?? []).filter(
        (n) => (n.severity === 'critical' || n.severity === 'warning') && !n.isRead
      );
      const seen = alertedIdsRef.current ?? new Set<string>();
      const fresh = items.filter((n) => !seen.has(n.id)).slice(0, 3);
      if (fresh.length > 0) {
        fresh.forEach((n) => {
          seen.add(n.id);
          showAlert({
            title: n.title,
            message: n.description,
            variant: n.severity === 'critical' ? 'critical' : 'warning',
          });
        });
        try {
          localStorage.setItem(
            'mbt_alerted_notification_ids',
            JSON.stringify([...seen].slice(-200))
          );
        } catch {
          /* storage full — alerts will simply re-fire next session */
        }
      }
      return res?.data ?? null;
    },
    refetchInterval: 60_000,
    enabled: !!currentStoreId,
    staleTime: 30_000,
  });

  if (alerts.length === 0) return null;

  return (
    <div
      aria-label="Alert popups"
      className="pointer-events-none fixed bottom-4 left-4 z-[60] flex max-h-[70vh] flex-col-reverse gap-2"
    >
      {alerts.map((a) => (
        <AlertPopup key={a.id} alert={a} />
      ))}
    </div>
  );
}
