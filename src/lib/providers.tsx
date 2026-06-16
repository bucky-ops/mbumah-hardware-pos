'use client';

// App-wide providers (React Query, Theme, Toast, Error Boundary)

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { ErrorBoundary } from '@/components/error-boundary';
import { useState, useEffect, type ReactNode } from 'react';

function GlobalErrorHandler({ children }: { children: ReactNode }) {
  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      // Prevent the default browser handling
      event.preventDefault();

      const message = event.reason?.message || String(event.reason) || 'An unhandled promise rejection occurred';

      console.error('[Unhandled Promise Rejection]', event.reason);

      toast.error('Unexpected Error', {
        description: message,
        duration: 6000,
      });
    };

    const handleWindowError = (event: ErrorEvent) => {
      // Prevent the default browser handling
      event.preventDefault();

      const message = event.message || 'An unexpected error occurred';

      console.error('[Window Error]', event.error);

      toast.error('Runtime Error', {
        description: message,
        duration: 6000,
      });
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    window.addEventListener('error', handleWindowError);

    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      window.removeEventListener('error', handleWindowError);
    };
  }, []);

  return <>{children}</>;
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000,
            retry: 1,
            refetchOnWindowFocus: false,
            // Auto-refresh server data every 1 minute so dashboards, POS stock,
            // inventory and reports stay current without manual reloads.
            refetchInterval: 60 * 1000,
            refetchIntervalInBackground: false,
          },
        },
      })
  );

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <GlobalErrorHandler>
            {children}
          </GlobalErrorHandler>
          <Toaster position="top-right" richColors closeButton />
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
