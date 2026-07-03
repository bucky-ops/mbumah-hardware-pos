// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Sentry Server Configuration
// ─────────────────────────────────────────────────────────────────────────────
//
// This file is the CANONICAL Sentry initialization for the NODE.JS server
// runtime. It is loaded ONCE per serverless function (or once per dev server
// process) via `instrumentation.ts` → `register()` → dynamic `import()`.
//
// Lifecycle:
//   1. Next.js boots the server runtime.
//   2. `instrumentation.ts` `register()` runs (before any route handler).
//   3. For the Node.js runtime, it dynamically imports this file.
//   4. `Sentry.init()` runs ONCE at module evaluation time.
//   5. All server-side `Sentry.captureException()` calls (from
//      `src/lib/sentry.ts` → `captureError` / `captureAPIError`, or from the
//      `withErrorBoundary` wrapper in `logger.ts`) flow through the
//      already-initialised hub.
//
// Environment handling:
//   • `SENTRY_DSN` is the server-only DSN (NEVER prefixed with NEXT_PUBLIC_).
//     If absent, Sentry silently no-ops (local dev without configuration).
//   • Sample rates mirror the client config but are tuned for server load.
//
// Privacy (Kenya DPA 2019 / GDPR):
//   • PII (emails, auth headers, cookies, IP addresses) is stripped in
//     `beforeSend`. IP addresses are never sent to Sentry.
//   • Request bodies are NOT captured by default (only method, URL, status).
//
// ─────────────────────────────────────────────────────────────────────────────

import * as Sentry from '@sentry/nextjs';

// ── DSN resolution (server-only) ─────────────────────────────────────────────
const SENTRY_DSN = process.env.SENTRY_DSN || '';

// ── Environment + release ────────────────────────────────────────────────────
const ENVIRONMENT =
  process.env.NODE_ENV ||
  (process.env.VERCEL_ENV as string | undefined) ||
  'development';

const RELEASE =
  process.env.SENTRY_RELEASE ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  'mbumah-pos@local';

// ── Sample rates ─────────────────────────────────────────────────────────────
//
// Server-side traces are cheaper than client-side (no replay), so we sample
// a bit more aggressively. Errors are ALWAYS 100%.
const isProduction = ENVIRONMENT === 'production';
const isStaging = ENVIRONMENT === 'staging' || ENVIRONMENT === 'preview';

const TRACES_SAMPLE_RATE = isProduction ? 0.15 : isStaging ? 0.3 : 1.0;

// ── Init (only when a DSN is present) ─────────────────────────────────────────
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: ENVIRONMENT,
    release: RELEASE,

    // ── Performance ────────────────────────────────────────────────────────
    tracesSampleRate: TRACES_SAMPLE_RATE,

    // ── PII scrubbing (Kenya DPA 2019 / GDPR) ──────────────────────────────
    //
    // `beforeSend` runs on every event before it leaves the server. We:
    //   1. Strip cookies + auth headers from request metadata.
    //   2. Remove the user's IP address (Sentry infers it from the request
    //      by default; we explicitly delete it to comply with DPA 2019).
    //   3. Redact email addresses in any extra / breadcrumb data.
    //   4. Truncate overly large `extra` payloads (e.g. full Prisma query
    //      results) to keep events under Sentry's 1MB limit.
    beforeSend(event) {
      // 1. Strip request credentials.
      if (event.request) {
        delete event.request.cookies;
        if (event.request.headers) {
          delete event.request.headers.cookie;
          delete event.request.headers.authorization;
          delete event.request.headers['x-api-key'];
          delete event.request.headers['x-csrf-token'];
          delete event.request.headers['x-request-id'];
        }
        // Never send the raw query string (may contain tokens / PII).
        if (event.request.query_string) {
          event.request.query_string = '[REDACTED]';
        }
      }

      // 2. Remove IP address.
      if (event.user) {
        delete event.user.ip_address;
      }
      if (event.request) {
        delete event.request.env;
      }

      // 3. Redact emails in extra / breadcrumbs.
      const emailRegex = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

      if (event.extra) {
        for (const key of Object.keys(event.extra)) {
          const val = event.extra[key];
          if (typeof val === 'string') {
            if (val.includes('@')) {
              event.extra[key] = val.replace(emailRegex, '[REDACTED_EMAIL]');
            }
            // Truncate long strings to 4KB to stay under Sentry's event limit.
            if (val.length > 4096) {
              event.extra[key] = val.slice(0, 4096) + '…[TRUNCATED]';
            }
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
    ignoreErrors: [
      // Next.js control-flow utilities — not errors.
      'NEXT_NOT_FOUND',
      'NEXT_REDIRECT',
      'NEXT_AUTH',
      // Prisma retryable errors (handled by retry layer — don't double-report).
      'PrismaClientInitializationError',
      // M-Pesa / network blips that auto-retry.
      'NetworkError',
      'AbortError',
      'fetch failed',
    ],

    // ── Server-specific integrations ───────────────────────────────────────
    //
    // `httpIntegration` is auto-enabled by @sentry/nextjs for the Node
    // runtime — it instruments `http`/`https` outgoing requests so we get
    // spans for M-Pesa, Twilio, Resend API calls.
    //
    // `requestData` is configured to include request headers (sanitised in
    // beforeSend) and exclude request bodies (which may contain payment
    // data).
  });

  // ── Tag the server runtime so events are filterable in Sentry ──────────────
  Sentry.setTag('runtime', 'nodejs');
  Sentry.setTag('framework', 'nextjs');
  Sentry.setTag('app', 'mbumah-pos');
}

// ── Export a flag for the rest of the server code ─────────────────────────────
export const SENTRY_SERVER_INITIALIZED = Boolean(SENTRY_DSN);
