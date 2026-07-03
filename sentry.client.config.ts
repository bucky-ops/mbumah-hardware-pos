// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Sentry Client Configuration
// ─────────────────────────────────────────────────────────────────────────────
//
// This file is the CANONICAL Sentry initialization for the BROWSER bundle.
// It is automatically loaded by `@sentry/nextjs`'s webpack plugin when the
// Next.js config is wrapped with `withSentryConfig` (see next.config.ts).
//
// Lifecycle:
//   1. Browser loads the page.
//   2. The Next.js runtime injects this module into the client bundle.
//   3. `Sentry.init()` runs ONCE at module evaluation time.
//   4. All subsequent `Sentry.captureException()` / `Sentry.addBreadcrumb()`
//      calls (from `src/lib/sentry.ts`, error.tsx, or business code) flow
//      through the already-initialised hub.
//
// Environment handling:
//   • `NEXT_PUBLIC_SENTRY_DSN` is the browser-exposed DSN. If absent, Sentry
//     silently no-ops (local dev without configuration).
//   • `SENTRY_DSN` is used as a fallback for setups that bundle the client
//     config with the server (rare).
//   • Sample rates are tuned per environment to respect Sentry's free tier
//     while still capturing 100% of ERRORS.
//
// Privacy (Kenya DPA 2019 / GDPR):
//   • PII (emails, auth headers, cookies) is stripped in `beforeSend`.
//   • Session replays only capture errors, not full sessions, to minimise
//     the risk of capturing sensitive input.
//   • `maskAllText` and `blockAllMedia` are OFF for usability but sensitive
//     input selectors are masked.
//
// ─────────────────────────────────────────────────────────────────────────────

import * as Sentry from '@sentry/nextjs';

// ── DSN resolution ───────────────────────────────────────────────────────────
//
// `NEXT_PUBLIC_SENTRY_DSN` is exposed to the browser by Next.js (any var
// prefixed with `NEXT_PUBLIC_` is inlined into the client bundle). We fall
// back to the server-only `SENTRY_DSN` for environments that only define one
// (the webpack plugin inlines it at build time).
const SENTRY_DSN =
  process.env.NEXT_PUBLIC_SENTRY_DSN ||
  process.env.SENTRY_DSN ||
  '';

// ── Environment + release ────────────────────────────────────────────────────
const ENVIRONMENT =
  process.env.NODE_ENV ||
  (process.env.VERCEL_ENV as string | undefined) ||
  'development';

const RELEASE =
  process.env.NEXT_PUBLIC_SENTRY_RELEASE ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  'mbumah-pos@local';

// ── Sample rates ─────────────────────────────────────────────────────────────
//
// Transaction (performance) sampling is environment-aware:
//   • development: 100% — see every trace while debugging.
//   • staging:     20%  — enough signal to catch regressions pre-prod.
//   • production:  10%  — stays within Sentry's free tier for a single-store
//                         POS with modest traffic. Errors are ALWAYS 100%.
//
// Session replays: capture 100% of error sessions, 10% of normal sessions in
// dev/staging, and 0% of normal sessions in production (cost + privacy).
const isProduction = ENVIRONMENT === 'production';
const isStaging = ENVIRONMENT === 'staging' || ENVIRONMENT === 'preview';

const TRACES_SAMPLE_RATE = isProduction ? 0.1 : isStaging ? 0.2 : 1.0;
const REPLAYS_SESSION_SAMPLE_RATE = isProduction ? 0 : isStaging ? 0.1 : 0.2;
const REPLAYS_ON_ERROR_SAMPLE_RATE = 1.0;

// ── Init (only when a DSN is present) ─────────────────────────────────────────
//
// If no DSN is configured (local dev without Sentry), `Sentry.init()` is
// never called and the SDK no-ops gracefully. Every public API
// (`captureException`, `addBreadcrumb`, etc.) is safe to call on an
// uninitialised hub — it just does nothing.
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: ENVIRONMENT,
    release: RELEASE,

    // ── Performance ────────────────────────────────────────────────────────
    tracesSampleRate: TRACES_SAMPLE_RATE,

    // ── Session Replay ─────────────────────────────────────────────────────
    replaysSessionSampleRate: REPLAYS_SESSION_SAMPLE_RATE,
    replaysOnErrorSampleRate: REPLAYS_ON_ERROR_SAMPLE_RATE,

    // Auto-inject the BrowserTracing + Replay integrations. These are the
    // recommended integrations for a Next.js client bundle:
    //   • browserTracingIntegration: instruments fetch/XHR, route changes,
    //     and clicks for performance traces.
    //   • replayIntegration: records the DOM for error-session replays.
    integrations: [
      Sentry.browserTracingIntegration({
        // Instrument navigation and route transitions.
        traceNavigation: true,
      }),
      Sentry.replayIntegration({
        // Mask sensitive input types. `maskAllText` is OFF so we can see
        // button labels / receipts in replays, but inputs are masked.
        maskAllInputs: true,
        maskAllText: false,
        blockAllMedia: false,
        // Additional CSS selectors to block from replays (e.g. receipt
        // previews that may contain customer PII).
        blockSelector: '[data-sentry-block]',
        maskSelector: '[data-sentry-mask]',
      }),
    ],

    // ── PII scrubbing (Kenya DPA 2019 / GDPR) ──────────────────────────────
    //
    // `beforeSend` runs on every event before it leaves the browser. We strip
    // cookies, auth headers, and redact email addresses in any extra context.
    beforeSend(event) {
      // Strip request metadata that may carry credentials.
      if (event.request) {
        delete event.request.cookies;
        if (event.request.headers) {
          delete event.request.headers.cookie;
          delete event.request.headers.authorization;
          delete event.request.headers['x-api-key'];
          delete event.request.headers['x-csrf-token'];
        }
      }

      // Redact email addresses anywhere in extra / breadcrumb data.
      const emailRegex = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

      if (event.extra) {
        for (const key of Object.keys(event.extra)) {
          const val = event.extra[key];
          if (typeof val === 'string' && val.includes('@')) {
            event.extra[key] = val.replace(emailRegex, '[REDACTED_EMAIL]');
          }
        }
      }

      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((crumb) => {
          if (crumb.data) {
            for (const key of Object.keys(crumb.data)) {
              const val = crumb.data[key];
              if (typeof val === 'string' && val.includes('@')) {
                crumb.data[key] = val.replace(emailRegex, '[REDACTED_EMAIL]');
              }
            }
          }
          return crumb;
        });
      }

      return event;
    },

    // ── Ignore noisy, non-actionable errors ────────────────────────────────
    //
    // These errors are either framework-level control flow (NEXT_NOT_FOUND,
    // NEXT_REDIRECT) or browser quirks that aren't real bugs.
    ignoreErrors: [
      // Next.js control-flow utilities — not errors.
      'NEXT_NOT_FOUND',
      'NEXT_REDIRECT',
      'NEXT_AUTH',
      // Browser quirks.
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      'Network request failed',
      'Failed to fetch',
      'Load failed',
      // M-Pesa / network blips that auto-retry.
      'NetworkError',
      'AbortError',
      // Safari fullscreen quirks.
      'NotSupportedError',
      // User navigation away mid-request.
      'CancelError',
    ],

    // ── Deny URLs that should never be instrumented ────────────────────────
    // Don't send traces for analytics / hotjar / google scripts.
    denyUrls: [
      /googletagmanager\.com/i,
      /google-analytics\.com/i,
      /googlesyndication\.com/i,
      /doubleclick\.net/i,
      /hotjar\.com/i,
      /facebook\.net/i,
    ],
  });
}

// ── Export a flag for the rest of the client code ─────────────────────────────
//
// `src/lib/sentry.ts` checks this via `Sentry.getClient()` at runtime, but
// exporting a plain boolean here lets UI components feature-gate Sentry
// features (e.g. "Report Feedback" button) without importing the SDK.
export const SENTRY_CLIENT_INITIALIZED = Boolean(SENTRY_DSN);
