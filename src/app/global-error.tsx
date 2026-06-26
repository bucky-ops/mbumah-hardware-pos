// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Global Error Boundary
// ─────────────────────────────────────────────────────────────────────────────
//
// This file catches errors that error.tsx CANNOT — specifically, errors thrown
// by the root layout.tsx itself. When the root layout fails to render, Next.js
// falls back to global-error.tsx, which must render its own <html> and <body>.
//
// See: https://nextjs.org/docs/app/api-reference/file-conventions/error
// ─────────────────────────────────────────────────────────────────────────────

'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    // Best-effort error report.
    fetch('/api/logs/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: error.name,
        message: error.message,
        digest: error.digest,
        url: typeof window !== 'undefined' ? window.location.href : undefined,
        userAgent:
          typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        severity: 'CRITICAL',
      }),
      keepalive: true,
    }).catch(() => {});
  }, [error]);

  const isDev = process.env.NODE_ENV === 'development';

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          padding: 0,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          background: '#0a0a0a',
          color: '#fafafa',
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            maxWidth: '480px',
            width: '100%',
            padding: '32px',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              width: '64px',
              height: '64px',
              margin: '0 auto 24px',
              borderRadius: '50%',
              background: 'rgba(239, 68, 68, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <AlertTriangle
              size={32}
              color="#ef4444"
              strokeWidth={2}
            />
          </div>
          <h1
            style={{
              fontSize: '24px',
              fontWeight: 700,
              marginBottom: '12px',
              color: '#fafafa',
            }}
          >
            Application Error
          </h1>
          <p
            style={{
              fontSize: '14px',
              color: '#a1a1aa',
              marginBottom: '24px',
              lineHeight: 1.6,
            }}
          >
            A critical error occurred and the application could not load. Our
            team has been notified. Please try again, or refresh the page.
          </p>

          {isDev && (
            <pre
              style={{
                background: 'rgba(239, 68, 68, 0.05)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                borderRadius: '8px',
                padding: '12px',
                fontSize: '12px',
                color: '#fca5a5',
                textAlign: 'left',
                overflow: 'auto',
                maxHeight: '200px',
                marginBottom: '24px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {error.name}: {error.message}
              {error.digest ? `\nDigest: ${error.digest}` : ''}
            </pre>
          )}

          <button
            onClick={reset}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 24px',
              background: '#fafafa',
              color: '#0a0a0a',
              border: 'none',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'opacity 0.2s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.9')}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
          >
            <RefreshCw size={16} strokeWidth={2} />
            Try Again
          </button>

          {!isDev && error.digest && (
            <p
              style={{
                marginTop: '24px',
                fontSize: '12px',
                color: '#71717a',
              }}
            >
              Error reference: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
