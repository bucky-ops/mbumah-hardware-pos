'use client';

// MBUMAH HARDWARE POS - self-service idle watch (v2.162.0)
//
// The CLIENT half of the portal's thirty-minute contract. The till surface
// has protected unattended screens since v2.6.0 with useIdleTimeout (30 min
// → clear tokens → login screen); the spec's follow-up question (843.6 /
// 1068.7) asks whether the self-service portal REUSES that mechanism
// safely. This component is the literal answer: it imports the SAME hook
// with the SAME default window, and on timeout it
//   1. POSTs /api/auth/logout so the SERVER session row is deleted too
//      (matching the server-side enforcement in selfServiceGuard /
//      loadSelfPortal — client and server agree, the cookie cannot
//      outlive the row), then
//   2. renders an alertdialog overlay explaining the sign-out, whose only
//      action is Sign in (a security affordance, not a dismissible toast).
//
// The overlay is the safety net for the client path; the server-side idle
// check remains the real enforcement (a script or a re-opened tab cannot
// dodge it). Offline: the logout POST may fail — the overlay still renders
// and the expired server session is dead on the next request anyway.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Clock, LogIn } from 'lucide-react';
import { useIdleTimeout } from '@/hooks/use-idle-timeout';

export function SelfServiceIdleWatch() {
  const [timedOut, setTimedOut] = useState(false);
  const headingRef = useRef<HTMLParagraphElement | null>(null);

  const handleIdleTimeout = useCallback(() => {
    // Kill the server session (row + cookie) — the same endpoint the
    // portal's future explicit sign-out uses. Fire-and-forget: the overlay
    // must render even if the network is gone.
    fetch('/api/auth/logout', { method: 'POST', keepalive: true }).catch(
      () => {},
    );
    setTimedOut(true);
  }, []);

  // LITERAL REUSE of the till's idle hook (spec 1068.7: "Can self-service
  // reuse auth and idle timeout safely?") — same 30-minute default window.
  useIdleTimeout(handleIdleTimeout);

  // Move focus into the dialog when it opens (alertdialog contract).
  useEffect(() => {
    if (timedOut) headingRef.current?.focus();
  }, [timedOut]);

  if (!timedOut) return null;

  return (
    <div
      data-testid="self-idle-overlay"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="self-idle-title"
        aria-describedby="self-idle-hint"
        data-testid="self-idle-dialog"
        className="w-full max-w-md rounded-2xl border border-amber-500/30 bg-card p-6 text-center shadow-2xl"
      >
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15 text-amber-700 dark:bg-amber-400/15 dark:text-amber-400">
          <Clock className="h-6 w-6" aria-hidden />
        </div>
        <p
          id="self-idle-title"
          ref={headingRef}
          tabIndex={-1}
          data-testid="self-idle-title"
          className="text-base font-semibold text-foreground outline-none"
        >
          Signed out for your safety
        </p>
        <p
          id="self-idle-hint"
          data-testid="self-idle-hint"
          className="mt-2 text-sm leading-relaxed text-muted-foreground"
        >
          This portal closes after 30 minutes of inactivity. Your payslips,
          leave and goals stay private — sign in again to continue.
        </p>
        <Link
          href="/"
          data-testid="self-idle-signin"
          className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <LogIn className="h-4 w-4" aria-hidden /> Sign in
        </Link>
      </div>
    </div>
  );
}
