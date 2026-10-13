'use client';

// ============================================================================
// UPDATER PROGRESS BAR (v2.17.9 - staged updates)
// ============================================================================
// Polls GET /api/update/status every 2.5 s and renders an iPhone-style
// progress bar while a staged update is running (maintenance true) or for
// five minutes after a failure. Renders null at all other times, so the
// surfaces that include it (the login screen) are unchanged between updates.
//
// Failure posture: every fetch error is swallowed and the last known state is
// kept - a restart window or a rate limit must never break the page this
// banner lives on. The interval pauses while the tab is hidden.
// ============================================================================

import { useEffect, useState } from 'react';

interface UpdateStatusData {
  phase: string;
  percent: number;
  message: string;
  targetVersion: string | null;
  updatedAt: string | null;
  maintenance: boolean;
}

const POLL_INTERVAL_MS = 2500;
const FAILURE_VISIBLE_MS = 5 * 60 * 1000;

export function UpdateProgressBar() {
  const [status, setStatus] = useState<UpdateStatusData | null>(null);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      // Visibility guard: a hidden tab neither needs live progress nor
      // should it spend the request budget.
      if (document.visibilityState !== 'visible') return;
      try {
        const response = await fetch('/api/update/status', { cache: 'no-store' });
        if (!response.ok) return; // keep last known state
        const payload: unknown = await response.json();
        const data =
          payload && typeof payload === 'object' && 'data' in payload
            ? (payload as { data?: unknown }).data
            : null;
        if (cancelled || !data || typeof data !== 'object') return;
        setStatus(data as UpdateStatusData);
      } catch {
        // Network errors are expected around a server restart; keep last state.
      }
    };

    void poll();
    const interval = setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  if (!status) return null;

  const failedRecently =
    status.phase === 'failed' &&
    typeof status.updatedAt === 'string' &&
    Number.isFinite(new Date(status.updatedAt).getTime()) &&
    Date.now() - new Date(status.updatedAt).getTime() < FAILURE_VISIBLE_MS;

  if (!status.maintenance && !failedRecently) return null;

  const percent = Math.min(100, Math.max(0, Math.round(status.percent)));

  return (
    <div className="rounded-xl border bg-card p-4 space-y-2" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {failedRecently ? 'Update needs attention' : 'System update'}
        </span>
        <span className="text-sm font-medium">{percent}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-600 transition-all duration-500 motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </div>
      {status.message ? <p className="text-xs text-muted-foreground">{status.message}</p> : null}
      <p className="text-xs text-muted-foreground">
        A system update is being prepared. Your data is safe and this page stays usable.
      </p>
    </div>
  );
}
