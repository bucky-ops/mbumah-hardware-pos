'use client';

import React from 'react';
import { AlertTriangle, ArrowLeft, Home, RefreshCw, X } from 'lucide-react';
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
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private autoNavigateTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, dismissed: false };
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

    // Auto-navigate back after 3 seconds
    this.autoNavigateTimer = setTimeout(() => {
      try {
        window.history.back();
      } catch {
        window.location.href = '/';
      }
    }, 3000);
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
    this.setState({ hasError: false, error: null, errorInfo: null, dismissed: false });
  };

  handleRetry = () => {
    if (this.autoNavigateTimer) {
      clearTimeout(this.autoNavigateTimer);
    }
    this.setState({ hasError: false, error: null, errorInfo: null, dismissed: false });
  };

  render() {
    if (this.state.hasError && !this.state.dismissed) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

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
              {this.state.error?.message || 'An unexpected error occurred'}
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
                  {this.state.error?.stack}
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
