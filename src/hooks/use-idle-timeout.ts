'use client';

import { useEffect, useRef, useCallback } from 'react';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];

export function useIdleTimeout(onTimeout: () => void, timeoutMs: number = IDLE_TIMEOUT_MS) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef<number>(Date.now());

  const resetTimer = useCallback(() => {
    lastActivityRef.current = Date.now();

    // Save current state to localStorage for recovery
    try {
      localStorage.setItem('mbt_last_activity', new Date().toISOString());
    } catch { /* ignore */ }

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      // Save state before timeout
      try {
        const state = {
          timestamp: new Date().toISOString(),
          reason: 'idle_timeout',
        };
        localStorage.setItem('mbt_session_state', JSON.stringify(state));
      } catch { /* ignore */ }

      onTimeout();
    }, timeoutMs);
  }, [onTimeout, timeoutMs]);

  useEffect(() => {
    // Check if we have a saved state to recover
    try {
      const savedState = localStorage.getItem('mbt_session_state');
      const lastActivity = localStorage.getItem('mbt_last_activity');
      if (savedState && lastActivity) {
        const parsed = JSON.parse(savedState);
        const lastTime = new Date(lastActivity).getTime();
        const elapsed = Date.now() - lastTime;

        if (elapsed < timeoutMs && parsed.reason === 'idle_timeout') {
          // Session can be recovered - clear the saved state
          localStorage.removeItem('mbt_session_state');
        }
      }
    } catch { /* ignore */ }

    resetTimer();

    const handleActivity = () => {
      resetTimer();
    };

    ACTIVITY_EVENTS.forEach(event => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      ACTIVITY_EVENTS.forEach(event => {
        window.removeEventListener(event, handleActivity);
      });
    };
  }, [resetTimer, timeoutMs]);

  return { lastActivity: lastActivityRef };
}
