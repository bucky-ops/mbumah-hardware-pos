'use client';

/**
 * Global Error Boundary for MBUMAH HARDWARE POS & ERP
 *
 * Catches rendering errors and:
 * - Shows a dismissible error toast/message
 * - For regular users: auto-navigates back after 3 seconds
 * - For super admins: shows a dedicated error overlay with "Return to Dashboard"
 * - Saves current route and state to localStorage before any error
 * - On page reload/power loss, restores state from localStorage
 */

import React from 'react';
import { isSuperAdmin, saveAppState, saveCurrentRoute, type PersistedAppState } from '@/lib/state-persistence';
import type { AppTab } from '@/lib/stores';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Function to get the current active tab from the app store */
  getActiveTab: () => AppTab;
  /** Function to get the current cart items from the cart store */
  getCartItems: () => unknown[];
  /** Function to get the current store ID from the app store */
  getStoreId: () => string;
  /** Callback to restore app state after error recovery */
  onRestoreState?: (state: PersistedAppState) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  isSuperAdminUser: boolean;
  dismissTimer: ReturnType<typeof setTimeout> | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      isSuperAdminUser: false,
      dismissTimer: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('[ErrorBoundary] Caught rendering error:', error, errorInfo);

    // Save current state to localStorage before the error causes data loss
    try {
      saveAppState(
        this.props.getActiveTab(),
        this.props.getCartItems(),
        this.props.getStoreId(),
      );
      saveCurrentRoute();
    } catch {
      // Best effort save
    }

    // Check if user is super admin
    const admin = isSuperAdmin();

    this.setState({ isSuperAdminUser: admin });

    if (!admin) {
      // For non-admin users: auto-navigate back after 3 seconds
      const timer = setTimeout(() => {
        window.history.back();
      }, 3000);
      this.setState({ dismissTimer: timer });
    }
  }

  componentWillUnmount(): void {
    if (this.state.dismissTimer) {
      clearTimeout(this.state.dismissTimer);
    }
  }

  handleDismiss = (): void => {
    if (this.state.dismissTimer) {
      clearTimeout(this.state.dismissTimer);
      this.setState({ dismissTimer: null });
    }
    this.setState({ hasError: false, error: null });
  };

  handleReturnToDashboard = (): void => {
    this.setState({ hasError: false, error: null });
    // Navigate to dashboard by setting the tab
    const { onRestoreState } = this.props;
    if (onRestoreState) {
      onRestoreState({
        activeTab: 'dashboard',
        cartItems: this.props.getCartItems(),
        storeId: this.props.getStoreId(),
        savedAt: Date.now(),
        currentRoute: '/',
      });
    }
  };

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      const { isSuperAdminUser } = this.state;

      if (isSuperAdminUser) {
        // Super admin: dedicated error overlay with "Return to Dashboard" button
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <div className="max-w-md w-full mx-4 p-6 rounded-lg border bg-card shadow-lg">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
                  <svg
                    className="h-5 w-5 text-destructive"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
                    />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-card-foreground">
                    Application Error
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    An unexpected error occurred in the application.
                  </p>
                </div>
              </div>

              {this.state.error && (
                <div className="mb-4 p-3 rounded-md bg-muted text-xs font-mono text-muted-foreground overflow-x-auto max-h-32 overflow-y-auto">
                  {this.state.error.message}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={this.handleReturnToDashboard}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1h-2z" />
                  </svg>
                  Return to Dashboard
                </button>
                <button
                  type="button"
                  onClick={this.handleRetry}
                  className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  Retry
                </button>
              </div>

              <p className="mt-3 text-xs text-muted-foreground text-center">
                App state has been saved. You can safely return to dashboard.
              </p>
            </div>
          </div>
        );
      }

      // Regular users: short dismissible error toast/message
      return (
        <div className="fixed bottom-4 right-4 z-50 max-w-sm animate-in slide-in-from-bottom-2">
          <div className="flex items-start gap-3 p-4 rounded-lg border bg-card shadow-lg">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
              <svg
                className="h-4 w-4 text-amber-600 dark:text-amber-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-card-foreground">
                Something went wrong
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Returning to previous page...
              </p>
            </div>
            <button
              type="button"
              onClick={this.handleDismiss}
              className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Dismiss error"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {/* Progress bar for auto-navigation */}
          <div className="mt-1 h-1 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-full"
              style={{
                animation: 'shrink 3s linear forwards',
              }}
            />
          </div>
          <style>{`
            @keyframes shrink {
              from { width: 100%; }
              to { width: 0%; }
            }
          `}</style>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
