'use client';

// Slim provider set for the self-service portal (v2.24.0).
//
// Deliberately EXCLUDES everything the POS shell needs: React Query (the
// /employees/me pages fetch with plain fetch + local state), the zustand
// auth/app stores (they pull the whole API layer + cart persistence +
// Decimal into the client bundle), the alert popup host and its 60 s
// notification poll, and the sonner toaster (no toast usage on the portal).
//
// Kept: theme (dark mode must still work), a crash boundary, and global
// error/rejection LOGGING (console only - the shell version toasts for
// authenticated users, which needs the auth store).

import { useEffect, type ReactNode } from 'react';
import { ThemeProvider } from 'next-themes';
import { ErrorBoundary } from '@/components/error-boundary';

function SelfServiceErrorLogging({ children }: { children: ReactNode }) {
  useEffect(() => {
    const logRejection = (event: PromiseRejectionEvent) => {
      // No toast here (would need the auth store) - the portal surfaces its
      // own inline error notes per fetch; this only keeps diagnostics.
      console.error('[Unhandled Promise Rejection]', event.reason);
    };
    const logError = (event: ErrorEvent) => {
      console.error('[Window Error]', event.error ?? event.message);
    };
    window.addEventListener('unhandledrejection', logRejection);
    window.addEventListener('error', logError);
    return () => {
      window.removeEventListener('unhandledrejection', logRejection);
      window.removeEventListener('error', logError);
    };
  }, []);
  return <>{children}</>;
}

export function SelfServiceProviders({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
        <SelfServiceErrorLogging>{children}</SelfServiceErrorLogging>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
