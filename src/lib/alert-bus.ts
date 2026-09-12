'use client';

/**
 * alert-bus — app-wide ALERT POPUP system (v2.5.0, Feature: alert popups).
 *
 * Unlike sonner toasts (transient, ~4s, top-right), ALERT POPUPS are
 * high-visibility cards that:
 *   • stay on screen for **45 seconds** by default (configurable),
 *   • show a live countdown bar so staff can see how long they have,
 *   • can always be dismissed immediately with a Close (✕) button,
 *   • pause their countdown while hovered (reading ≠ racing),
 *   • stack bottom-left (away from the sonner toasts at top-right and the
 *     mobile cart FAB at bottom-right).
 *
 * Any client module can raise one:
 *   import { showAlert } from '@/lib/alert-bus';
 *   showAlert({ title: 'Low stock alert', message: 'Cement 32.5N is below minimum', variant: 'warning' });
 *
 * The <AlertPopupHost /> (mounted in providers.tsx) renders the stack and
 * also polls the notifications API so NEW critical/warning notifications
 * pop automatically — see alert-popup-host.tsx.
 */

import { create } from 'zustand';

/** Default time a popup stays on screen before auto-dismissing. */
export const ALERT_POPUP_DURATION_MS = 45_000;

export type AlertVariant = 'info' | 'success' | 'warning' | 'critical';

export interface AlertPayload {
  title: string;
  message?: string;
  variant?: AlertVariant;
  /** Override the 45s default (ms). Use Infinity to require manual close. */
  durationMs?: number;
}

export interface AlertInstance extends AlertPayload {
  id: string;
  createdAt: number;
}

interface AlertState {
  alerts: AlertInstance[];
  showAlert: (payload: AlertPayload) => string;
  dismissAlert: (id: string) => void;
  clearAll: () => void;
}

let alertSeq = 0;

export const useAlertStore = create<AlertState>((set) => ({
  alerts: [],

  showAlert: (payload) => {
    const id = `alert-${Date.now().toString(36)}-${(alertSeq++).toString(36)}`;
    set((state) => ({
      // Cap the visible stack so a burst can't flood the screen — oldest
      // popups are dropped first (they have already had screen time).
      alerts: [
        ...state.alerts.slice(-3),
        { ...payload, id, createdAt: Date.now() },
      ],
    }));
    return id;
  },

  dismissAlert: (id) =>
    set((state) => ({ alerts: state.alerts.filter((a) => a.id !== id) })),

  clearAll: () => set({ alerts: [] }),
}));

/** Imperative helper — fire an alert popup from anywhere in the client. */
export function showAlert(payload: AlertPayload): string {
  return useAlertStore.getState().showAlert(payload);
}
