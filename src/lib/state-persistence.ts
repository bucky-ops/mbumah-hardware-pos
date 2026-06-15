/**
 * State Persistence System for MBUMAH HARDWARE POS & ERP
 *
 * Saves and restores application state to localStorage for recovery
 * after errors, page reloads, or power loss. Includes idle timer
 * that saves state periodically but does NOT logout.
 */

import type { AppTab } from './stores';

// localStorage key constants
export const STORAGE_KEYS = {
  APP_STATE: 'mbt_app_state',
  USER: 'mbt_user',
  TOKEN: 'mbt_token',
  ROUTE: 'mbt_current_route',
} as const;

// Shape of the persisted app state
export interface PersistedAppState {
  activeTab: AppTab;
  cartItems: unknown[];
  storeId: string;
  savedAt: number;
  currentRoute: string;
}

// Idle timer configuration
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

let idleTimerId: ReturnType<typeof setTimeout> | null = null;

/**
 * Save the current app state to localStorage.
 * Called on errors, idle timeout, and before critical operations.
 */
export function saveAppState(
  activeTab: AppTab,
  cartItems: unknown[],
  storeId: string,
): void {
  if (typeof window === 'undefined') return;

  try {
    const state: PersistedAppState = {
      activeTab,
      cartItems,
      storeId,
      savedAt: Date.now(),
      currentRoute: window.location.pathname + window.location.search,
    };
    localStorage.setItem(STORAGE_KEYS.APP_STATE, JSON.stringify(state));
  } catch {
    // localStorage may be full or unavailable — silently fail
  }
}

/**
 * Save the current route to localStorage.
 */
export function saveCurrentRoute(): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(
      STORAGE_KEYS.ROUTE,
      window.location.pathname + window.location.search,
    );
  } catch {
    // silently fail
  }
}

/**
 * Restore previously saved app state from localStorage.
 * Returns null if no saved state exists or if it's expired (>24h old).
 */
export function restoreAppState(): PersistedAppState | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = localStorage.getItem(STORAGE_KEYS.APP_STATE);
    if (!raw) return null;

    const state: PersistedAppState = JSON.parse(raw);

    // Expire saved state after 24 hours
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    if (Date.now() - state.savedAt > TWENTY_FOUR_HOURS) {
      localStorage.removeItem(STORAGE_KEYS.APP_STATE);
      return null;
    }

    return state;
  } catch {
    return null;
  }
}

/**
 * Clear the saved app state from localStorage.
 * Called after successful state restoration to avoid stale data.
 */
export function clearSavedAppState(): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.removeItem(STORAGE_KEYS.APP_STATE);
    localStorage.removeItem(STORAGE_KEYS.ROUTE);
  } catch {
    // silently fail
  }
}

/**
 * Check if the current user is a super admin by reading from localStorage.
 */
export function isSuperAdmin(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const raw = localStorage.getItem(STORAGE_KEYS.USER);
    if (!raw) return false;
    const user = JSON.parse(raw);
    return user?.role === 'SUPER_ADMIN';
  } catch {
    return false;
  }
}

/**
 * Start the idle timer. After IDLE_TIMEOUT_MS of inactivity,
 * the app state is saved to localStorage (but user is NOT logged out).
 */
export function startIdleTimer(
  getActiveTab: () => AppTab,
  getCartItems: () => unknown[],
  getStoreId: () => string,
): void {
  clearIdleTimer();

  idleTimerId = setTimeout(() => {
    saveAppState(getActiveTab(), getCartItems(), getStoreId());
    saveCurrentRoute();
    // Restart the timer so it keeps saving on each idle period
    startIdleTimer(getActiveTab, getCartItems, getStoreId);
  }, IDLE_TIMEOUT_MS);
}

/**
 * Reset the idle timer. Should be called on user activity
 * (mousemove, keydown, click, scroll).
 */
export function resetIdleTimer(
  getActiveTab: () => AppTab,
  getCartItems: () => unknown[],
  getStoreId: () => string,
): void {
  startIdleTimer(getActiveTab, getCartItems, getStoreId);
}

/**
 * Clear the current idle timer (e.g., on unmount).
 */
export function clearIdleTimer(): void {
  if (idleTimerId !== null) {
    clearTimeout(idleTimerId);
    idleTimerId = null;
  }
}
