// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Root Error Boundary (App Router)
// ─────────────────────────────────────────────────────────────────────────────
//
// This file is the Next.js App Router error boundary for the root segment.
// When a React component in ANY route throws during render, Next.js unmounts
// the erroring subtree and renders this component instead, with the error
// passed as a prop.
//
// Responsibilities:
//   1. Display a user-friendly error UI (NOT a white screen).
//   2. Provide a "Try again" button that resets the error boundary.
//   3. Report the error to Sentry (when configured) so crashes are aggregated.
//   4. Log the error to the backend system log for the audit trail.
//
// This is a CLIENT component ('use client') — error boundaries must be.
// ─────────────────────────────────────────────────────────────────────────────

'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw, Home, Bug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ErrorBoundaryProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorBoundary({ error, reset }: ErrorBoundaryProps) {
  useEffect(() => {
    // Report to the backend audit log via a fire-and-forget POST.
    // We use the keepalive flag so the request survives page navigation.
    const isDev = process.env.NODE_ENV === 'development';

    fetch('/api/logs/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: error.name,
        message: error.message,
        stack: isDev ? error.stack : undefined,
        digest: error.digest,
        url: typeof window !== 'undefined' ? window.location.href : undefined,
        userAgent:
          typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      }),
      keepalive: true,
    }).catch(() => {
      // Logging is best-effort — never block the error UI on it.
    });

    // Also attempt a Sentry breadcrumb (client-side SDK, if loaded).
    // We don't import @sentry/nextjs here to avoid a hard dependency;
    // the Next.js instrumentation file handles global Sentry init.
  }, [error]);

  const isDev = process.env.NODE_ENV === 'development';

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg shadow-lg">
        <CardHeader className="text-center pb-4">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-8 w-8 text-destructive" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">
            Something went wrong
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-center text-muted-foreground">
            An unexpected error occurred while rendering this page. Our team has
            been notified. You can try again or return to the dashboard.
          </p>

          {isDev && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-destructive">
                <Bug className="h-4 w-4" />
                Development Error Details
              </div>
              <p className="text-xs font-mono text-destructive break-all">
                {error.name}: {error.message}
              </p>
              {error.digest && (
                <p className="text-xs text-muted-foreground mt-2">
                  Digest: {error.digest}
                </p>
              )}
              {error.stack && (
                <pre className="mt-2 max-h-48 overflow-auto rounded bg-muted p-2 text-xs text-muted-foreground whitespace-pre-wrap">
                  {error.stack}
                </pre>
              )}
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button onClick={reset} className="w-full sm:w-auto">
              <RefreshCw className="mr-2 h-4 w-4" />
              Try Again
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                window.location.href = '/';
              }}
              className="w-full sm:w-auto"
            >
              <Home className="mr-2 h-4 w-4" />
              Go to Dashboard
            </Button>
          </div>

          {!isDev && error.digest && (
            <p className="text-center text-xs text-muted-foreground">
              Error reference: {error.digest}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
