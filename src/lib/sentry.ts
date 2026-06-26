// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Sentry Error Tracking Integration
// ─────────────────────────────────────────────────────────────────────────────
//
// Sentry is initialised lazily on the server side ONLY when `SENTRY_DSN` is
// present in the environment. This keeps local dev zero-config and avoids
// importing `@sentry/nextjs` (which patches the Next.js runtime) when it's
// not configured.
//
// In production with SENTRY_DSN set:
//   • Unhandled exceptions in API routes are captured automatically via the
//     `captureAPIError()` helper (called from `withErrorBoundary`).
//   • The Next.js `error.tsx` boundary calls `captureError()` for client-side
//     rendering crashes.
//   • Performance monitoring is enabled with a 10% sample rate to stay within
//     Sentry's free tier.
//
// USAGE
//   import { captureError, captureAPIError, setSentryUser, clearSentryUser }
//   from '@/lib/sentry';
//
// RELATIONSHIP TO logger.ts
//   `logger.ts` → SystemLog table (DB-backed audit trail, always on)
//   `sentry.ts` → Sentry SaaS (crash aggregation, alerting, only when DSN set)
//   Both are complementary. The DB log is the system-of-record; Sentry is the
//  pager / aggregation layer.
//
// ─────────────────────────────────────────────────────────────────────────────

import { systemLog } from "./logger";
import { LogSeverity, LogComponent } from "./types";

// ── Lazy singleton ───────────────────────────────────────────────────────────

let sentryInitialized = false;
let sentryAvailable = false;

/**
 * Check whether Sentry is configured (SENTRY_DSN present). Does NOT import
 * the Sentry SDK — use this for feature-gating without the bundle cost.
 */
export function isSentryConfigured(): boolean {
  return Boolean(process.env.SENTRY_DSN);
}

/**
 * Lazily initialise Sentry on first use. We import `@sentry/nextjs`
 * dynamically so that local dev (no DSN) never pays the import cost.
 *
 * Returns true if Sentry is ready to capture, false if unconfigured or init
 * failed.
 */
async function ensureSentry(): Promise<boolean> {
  if (sentryInitialized) return sentryAvailable;
  sentryInitialized = true;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    return false;
  }

  try {
    // Dynamic import — avoids loading @sentry/nextjs when DSN is absent.
    const Sentry = await import("@sentry/nextjs");

    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? "development",
      release: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
      // 10% transaction sample rate — stays within Sentry free tier for a
      // single-store POS with modest traffic. Increase to 1.0 for launch
      // debugging, then dial back.
      tracesSampleRate: 0.1,
      // Capture 100% of errors — errors are rare and high-value.
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 1.0,
      // Don't send PII to Sentry — Kenyan data protection law (DPA 2019).
      beforeSend(event: any) {
        if (event.request) {
          // Strip cookies and auth headers from the event.
          delete event.request.cookies;
          if (event.request.headers) {
            delete event.request.headers.cookie;
            delete event.request.headers.authorization;
            delete event.request.headers["x-api-key"];
          }
        }
        // Scrub email addresses from request bodies / extra context.
        if (event.extra) {
          for (const key of Object.keys(event.extra)) {
            const val = event.extra[key];
            if (typeof val === "string" && val.includes("@")) {
              event.extra[key] = val.replace(
                /[\w.+-]+@[\w-]+\.[\w.-]+/g,
                "[REDACTED_EMAIL]",
              );
            }
          }
        }
        return event;
      },
      // Ignore noisy, non-actionable errors.
      ignoreErrors: [
        "NEXT_NOT_FOUND",
        "NEXT_REDIRECT",
        "ResizeObserver loop limit exceeded",
        "Network request failed",
        "Failed to fetch",
      ],
    });

    sentryAvailable = true;
    return true;
  } catch (error) {
    // Sentry failed to init — log to SystemLog but never crash the app.
    await systemLog({
      action: "SENTRY_INIT_FAILED",
      component: LogComponent.SYSTEM,
      severity: LogSeverity.WARN,
      message: `Sentry initialisation failed: ${error instanceof Error ? error.message : "unknown error"}`,
    }).catch(() => {});
    sentryAvailable = false;
    return false;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Capture an exception in Sentry. Falls back silently to the DB system log
 * if Sentry is unconfigured. Never throws.
 *
 * @param error   The error to capture.
 * @param context Optional key-value metadata (tags / extra).
 * @param component The system component (e.g. "POS_CHECKOUT") for routing.
 */
export async function captureError(
  error: unknown,
  context?: Record<string, string | number | boolean>,
  component?: string,
): Promise<void> {
  // Always log to the DB audit trail.
  try {
    await systemLog({
      action: "EXCEPTION_CAPTURED",
      component: component ?? LogComponent.SYSTEM,
      severity: LogSeverity.ERROR,
      message: error instanceof Error ? error.message : String(error),
      stackTrace: error instanceof Error ? error.stack : undefined,
      metadata: context,
    });
  } catch {
    // DB logging failed — fall through to Sentry.
  }

  // Attempt Sentry capture.
  const ready = await ensureSentry();
  if (!ready) return;

  try {
    const Sentry = await import("@sentry/nextjs");
    if (context) {
      Sentry.withScope((scope: any) => {
        for (const [key, value] of Object.entries(context)) {
          scope.setTag(key, String(value));
        }
        Sentry.captureException(error);
      });
    } else {
      Sentry.captureException(error);
    }
  } catch {
    // Sentry capture failed — nothing more we can do. The DB log is the
    // fallback system-of-record.
  }
}

/**
 * Capture an API route error with structured context. This is the companion
 * to `withErrorBoundary` in logger.ts — call it from the catch block to send
 * the error to Sentry in addition to the DB log.
 */
export async function captureAPIError(
  error: unknown,
  options: {
    route: string;
    method: string;
    storeId?: string;
    userId?: string;
    statusCode?: number;
  },
): Promise<void> {
  await captureError(
    error,
    {
      route: options.route,
      method: options.method,
      storeId: options.storeId ?? "unknown",
      userId: options.userId ?? "unknown",
      statusCode: options.statusCode ?? 500,
    },
    LogComponent.API,
  );
}

/**
 * Set the active user context for Sentry. Call this after authentication so
 * that subsequent errors are attributed to the correct user. Pass `null` on
 * logout to clear.
 */
export async function setSentryUser(user: {
  id: string;
  email?: string;
  role?: string;
  storeId?: string;
} | null): Promise<void> {
  const ready = await ensureSentry();
  if (!ready) return;

  try {
    const Sentry = await import("@sentry/nextjs");
    if (user) {
      Sentry.setUser({
        id: user.id,
        // Email is PII — only include if explicitly provided and DPA consent
        // is on file. In most cases we send only the internal user ID.
        email: user.email,
        role: user.role,
        storeId: user.storeId,
      });
    } else {
      Sentry.setUser(null);
    }
  } catch {
    // Non-critical — user attribution is best-effort.
  }
}

/**
 * Clear the Sentry user context (call on logout).
 */
export async function clearSentryUser(): Promise<void> {
  await setSentryUser(null);
}

/**
 * Add a breadcrumb to the Sentry trail. Breadcrumbs are short events that
 * precede an error (e.g. "User clicked checkout", "API call to /api/transactions
 * returned 200"). They appear in the Sentry UI to help reproduce the path
 * that led to the error.
 */
export async function addBreadcrumb(
  message: string,
  category: string,
  level: "info" | "warning" | "error" = "info",
  data?: Record<string, unknown>,
): Promise<void> {
  const ready = await ensureSentry();
  if (!ready) return;

  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.addBreadcrumb({
      message,
      category,
      level,
      data,
      timestamp: Date.now() / 1000,
    });
  } catch {
    // Non-critical.
  }
}
