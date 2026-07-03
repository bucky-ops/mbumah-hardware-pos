'use client';

/**
 * Service Worker Registration — v1.2.0 Phase 3
 *
 * Registers /sw.js on the client. Handles:
 *   - Initial registration (production only — dev server has HMR which
 *     conflicts with cached assets).
 *   - Update detection: when a new SW takes over, prompts the user to reload.
 *   - Controller change: triggers a single window reload after the new SW
 *     activates.
 *
 * Renders null — this is a side-effect-only component. Mount it once near the
 * root of the app (we use it inside Providers so it's always mounted).
 */

import { useEffect, useState } from 'react';

declare global {
  interface Window {
    __mbumahSwRegistered?: boolean;
  }
}

export function RegisterSW() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    // Skip in development — Next.js HMR + cached assets = confusing reloads.
    if (process.env.NODE_ENV !== 'production') return;
    // Already registered (React StrictMode mounts effects twice).
    if (window.__mbumahSwRegistered) return;
    window.__mbumahSwRegistered = true;

    let registering = false;
    const register = async () => {
      if (registering) return;
      registering = true;
      try {
        const reg = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
          updateViaCache: 'none',
        });

        // New SW waiting to activate → show update prompt.
        if (reg.waiting) {
          setWaitingWorker(reg.waiting);
          setUpdateAvailable(true);
        }

        // A new SW is installing → track it.
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New version installed and an old one is controlling the page → update ready.
              setWaitingWorker(newWorker);
              setUpdateAvailable(true);
            }
          });
        });

        // The controlling SW changed (after skipWaiting) → reload once.
        let reloading = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (reloading) return;
          reloading = true;
          window.location.reload();
        });
      } catch (err) {
        console.warn('[RegisterSW] Failed to register service worker:', err);
      } finally {
        registering = false;
      }
    };

    // Register after window load so it doesn't compete with first paint.
    if (document.readyState === 'complete') {
      register();
    } else {
      window.addEventListener('load', register, { once: true });
    }
  }, []);

  const applyUpdate = () => {
    if (!waitingWorker) return;
    waitingWorker.postMessage('SKIP_WAITING');
  };

  // No visible UI when no update is pending.
  if (!updateAvailable) return null;

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-labelledby="sw-update-title"
      aria-describedby="sw-update-desc"
      className="fixed bottom-4 right-4 z-[100] max-w-sm rounded-lg border border-orange-200 bg-white p-4 shadow-2xl dark:border-orange-800 dark:bg-slate-900"
      style={{ animation: 'sw-slide-in 0.3s ease-out' }}
    >
      <style>{`
        @keyframes sw-slide-in {
          from { transform: translateY(1rem); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-100 text-lg dark:bg-orange-900/40">
          🔄
        </div>
        <div className="flex-1 min-w-0">
          <p id="sw-update-title" className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Update available
          </p>
          <p id="sw-update-desc" className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
            A new version of MBUMAH POS is ready. Reload to apply.
          </p>
          <div className="mt-2.5 flex gap-2">
            <button
              onClick={applyUpdate}
              className="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-1"
            >
              Reload now
            </button>
            <button
              onClick={() => setUpdateAvailable(false)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Later
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
