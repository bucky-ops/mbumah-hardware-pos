'use client';

import { useCallback } from 'react';

export function useStatePersistence() {
  const saveState = useCallback((key: string, state: unknown) => {
    try {
      localStorage.setItem(`mbt_state_${key}`, JSON.stringify({
        data: state,
        savedAt: new Date().toISOString(),
      }));
    } catch {
      // Storage full or unavailable
      console.warn('Failed to save state to localStorage');
    }
  }, []);

  const loadState = useCallback((key: string): { data: unknown; savedAt: string } | null => {
    try {
      const stored = localStorage.getItem(`mbt_state_${key}`);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch {
      // Corrupted data
      localStorage.removeItem(`mbt_state_${key}`);
    }
    return null;
  }, []);

  const clearState = useCallback((key: string) => {
    try {
      localStorage.removeItem(`mbt_state_${key}`);
    } catch { /* ignore */ }
  }, []);

  const saveBeforeError = useCallback(() => {
    try {
      const state = {
        url: window.location.href,
        timestamp: new Date().toISOString(),
        reason: 'error_recovery',
      };
      localStorage.setItem('mbt_recovery_state', JSON.stringify(state));
    } catch { /* ignore */ }
  }, []);

  const recoverState = useCallback(() => {
    try {
      const stored = localStorage.getItem('mbt_recovery_state');
      if (stored) {
        const state = JSON.parse(stored);
        localStorage.removeItem('mbt_recovery_state');
        return state;
      }
    } catch { /* ignore */ }
    return null;
  }, []);

  return { saveState, loadState, clearState, saveBeforeError, recoverState };
}
