'use client';

import React from 'react';
import { AlertTriangle, ArrowLeft, Home, RefreshCw, X, Shield, Copy, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  showOverlay?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  dismissed: boolean;
  copiedToClipboard: boolean;
}

function isSuperAdmin(): boolean {
  try {
    const stored = localStorage.getItem('mbt_user');
    if (!stored) return false;
    const user = JSON.parse(stored);
    return user?.role === 'SUPER_ADMIN';
  } catch {
    return false;
  }
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private autoNavigateTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, dismissed: false, copiedToClipboard: false };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo });

    // Save error state to localStorage for recovery
    try {
      localStorage.setItem('mbt_last_error', JSON.stringify({
        message: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
        route: window.location.pathname,
      }));
    } catch { /* ignore */ }

    // Call custom error handler
    this.props.onError?.(error, errorInfo);

    // Only auto-navigate back for non-SUPER_ADMIN users
    if (!isSuperAdmin()) {
      this.autoNavigateTimer = setTimeout(() => {
        try {
          window.history.back();
        } catch {
          window.location.href = '/';
        }
      }, 3000);
    }
  }

  componentWillUnmount() {
    if (this.autoNavigateTimer) {
      clearTimeout(this.autoNavigateTimer);
    }
  }

  handleDismiss = () => {
    if (this.autoNavigateTimer) {
      clearTimeout(this.autoNavigateTimer);
    }
    this.setState({ dismissed: true });
  };

  handleGoHome = () => {
    if (this.autoNavigateTimer) {
      clearTimeout(this.autoNavigateTimer);
    }
    // Navigate to dashboard
    const event = new CustomEvent('navigate-to-dashboard');
    window.dispatchEvent(event);
    this.setState({ hasError: false, error: null, errorInfo: null, dismissed: false, copiedToClipboard: false });
  };

  handleRetry = () => {
    if (this.autoNavigateTimer) {
      clearTimeout(this.autoNavigateTimer);
    }
    this.setState({ hasError: false, error: null, errorInfo: null, dismissed: false, copiedToClipboard: false });
  };

  handleCopyError = () => {
    const { error, errorInfo } = this.state;
    const errorText = [
      `Error: ${error?.message || 'Unknown error'}`,
      `Time: ${new Date().toISOString()}`,
      `URL: ${typeof window !== 'undefined' ? window.location.href : 'N/A'}`,
      `User Agent: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'N/A'}`,
      ``,
      `Stack Trace:`,
      error?.stack || 'No stack trace available',
      ``,
      `Component Stack:`,
      errorInfo?.componentStack || 'No component stack available',
    ].join('\n');

    navigator.clipboard.writeText(errorText).then(() => {
      this.setState({ copiedToClipboard: true });
      setTimeout(() => this.setState({ copiedToClipboard: false }), 2000);
    }).catch(() => {
      // Fallback - ignore
    });
  };

  renderSuperAdminOverlay() {
    const { error, errorInfo, copiedToClipboard } = this.state;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-md">
        <div className="max-w-3xl w-full mx-4 max-h-[90vh] flex flex-col rounded-2xl border-2 border-destructive/30 bg-card shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-destructive/20 bg-destructive/5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-destructive/10">
                <AlertTriangle className="h-6 w-6 text-destructive" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-lg text-destructive">Runtime Error</h3>
                  <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-semibold">
                    <Shield className="h-3 w-3" /> SUPER_ADMIN
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">Detailed error information for debugging</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={this.handleDismiss}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Error message */}
          <div className="p-6 border-b border-border/50">
            <p className="text-sm font-mono bg-destructive/5 p-3 rounded-lg border border-destructive/20 break-all">
              {error?.message || 'An unexpected error occurred'}
            </p>
          </div>

          {/* Stack trace (scrollable) */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {/* Full Stack Trace */}
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <ExternalLink className="h-3 w-3" /> Stack Trace
              </h4>
              <pre className="text-[11px] bg-muted p-3 rounded-lg overflow-auto max-h-48 font-mono whitespace-pre-wrap break-all">
                {error?.stack || 'No stack trace available'}
              </pre>
            </div>

            {/* Component Stack */}
            {errorInfo && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <ExternalLink className="h-3 w-3" /> Component Stack
                </h4>
                <pre className="text-[11px] bg-muted p-3 rounded-lg overflow-auto max-h-48 font-mono whitespace-pre-wrap break-all">
                  {errorInfo.componentStack}
                </pre>
              </div>
            )}

            {/* Error metadata */}
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Error Metadata</h4>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-muted p-2 rounded">
                  <span className="text-muted-foreground">Time:</span>{' '}
                  <span className="font-mono">{new Date().toISOString()}</span>
                </div>
                <div className="bg-muted p-2 rounded">
                  <span className="text-muted-foreground">URL:</span>{' '}
                  <span className="font-mono break-all">{typeof window !== 'undefined' ? window.location.pathname : 'N/A'}</span>
                </div>
                <div className="bg-muted p-2 rounded">
                  <span className="text-muted-foreground">Error Type:</span>{' '}
                  <span className="font-mono">{error?.name || 'Error'}</span>
                </div>
                <div className="bg-muted p-2 rounded">
                  <span className="text-muted-foreground">Recovery:</span>{' '}
                  <span className="font-mono">ErrorBoundary</span>
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between p-6 border-t border-border/50 bg-muted/30">
            <Button
              variant="outline"
              size="sm"
              onClick={this.handleCopyError}
              className="text-xs"
            >
              <Copy className="h-3 w-3 mr-1.5" />
              {copiedToClipboard ? 'Copied!' : 'Copy Error Details'}
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={this.handleRetry}>
                <RefreshCw className="h-3 w-3 mr-1" /> Retry
              </Button>
              <Button variant="outline" size="sm" onClick={() => {
                if (this.autoNavigateTimer) clearTimeout(this.autoNavigateTimer);
                window.history.back();
              }}>
                <ArrowLeft className="h-3 w-3 mr-1" /> Go Back
              </Button>
              <Button size="sm" onClick={this.handleGoHome}>
                <Home className="h-3 w-3 mr-1" /> Return to Dashboard
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  renderStandardOverlay() {
    const { error } = this.state;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
        <div className="max-w-md w-full mx-4 p-6 rounded-2xl border bg-card shadow-2xl">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <h3 className="font-bold text-lg">Something went wrong</h3>
            </div>
            <Button variant="ghost" size="sm" onClick={this.handleDismiss}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <p className="text-sm text-muted-foreground mb-2">
            {error?.message || 'An unexpected error occurred'}
          </p>

          <p className="text-xs text-muted-foreground mb-4">
            Automatically navigating back in 3 seconds...
          </p>

          {process.env.NODE_ENV === 'development' && this.state.errorInfo && (
            <details className="mb-4">
              <summary className="text-xs cursor-pointer text-muted-foreground hover:text-foreground">
                Error Details
              </summary>
              <pre className="mt-2 text-[10px] bg-muted p-2 rounded overflow-auto max-h-32">
                {error?.stack}
                {'\n\nComponent Stack:\n'}
                {this.state.errorInfo.componentStack}
              </pre>
            </details>
          )}

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={this.handleRetry}>
              <RefreshCw className="h-3 w-3 mr-1" /> Retry
            </Button>
            <Button variant="outline" size="sm" onClick={() => {
              if (this.autoNavigateTimer) clearTimeout(this.autoNavigateTimer);
              window.history.back();
            }}>
              <ArrowLeft className="h-3 w-3 mr-1" /> Go Back
            </Button>
            <Button size="sm" onClick={this.handleGoHome}>
              <Home className="h-3 w-3 mr-1" /> Dashboard
            </Button>
          </div>
        </div>
      </div>
    );
  }

  render() {
    if (this.state.hasError && !this.state.dismissed) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Show detailed overlay for SUPER_ADMIN, simple overlay for others
      if (isSuperAdmin()) {
        return this.renderSuperAdminOverlay();
      }

      return this.renderStandardOverlay();
    }

    return this.props.children;
  }
}

// Custom error classes for API errors
export class AppError extends Error {
  code: string;
  statusCode: number;
  details?: Record<string, unknown>;

  constructor(message: string, code: string = 'APP_ERROR', statusCode: number = 500, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(`${resource}${id ? ` with id ${id}` : ''} not found`, 'NOT_FOUND', 404);
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super(message, 'UNAUTHORIZED', 401);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'You do not have permission to perform this action') {
    super(message, 'FORBIDDEN', 403);
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 'CONFLICT', 409);
    this.name = 'ConflictError';
  }
}
