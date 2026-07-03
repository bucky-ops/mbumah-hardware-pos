// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Request Context (AsyncLocalStorage)
// ─────────────────────────────────────────────────────────────────────────────
//
// This module provides a per-request context store backed by Node.js
// `AsyncLocalStorage`. It carries request-scoped metadata — the request ID,
// start time, method, path, authenticated user, store, client IP — through
// the entire async call chain WITHOUT requiring it to be passed as explicit
// arguments to every function.
//
// ── Why AsyncLocalStorage? ───────────────────────────────────────────────────
//
// In a Next.js API route, a single request triggers a deep call chain:
//
//   route handler → business logic (accounting-helpers.ts) → db query →
//   → audit log (systemLog) → Sentry capture (captureError)
//
// Every one of these functions may need the request ID (for log correlation),
// the user ID (for audit attribution), and the store ID (for tenant scoping).
// Threaded as explicit arguments, this pollutes every signature and is easy
// to forget. `AsyncLocalStorage` solves this: the store is automatically
// propagated through `await` boundaries, `setTimeout`, `setImmediate`, etc.
//
// ── Lifecycle ────────────────────────────────────────────────────────────────
//
//   1. Edge middleware (src/middleware.ts) extracts or generates `X-Request-ID`
//      and forwards it as a request header to the Node.js runtime.
//   2. The API route handler wraps its body in `withRequestContext(req, fn)`,
//      which:
//        a. Reads `X-Request-ID` from the request headers (set by middleware).
//        b. Falls back to generating a fresh UUID if absent.
//        c. Records `startTime` (via `process.hrtime.bigint()` for ns precision).
//        d. Creates a `RequestContext` object.
//        e. Runs `fn` inside the ALS store.
//   3. Any code running inside `fn` (or its async descendants) can call
//      `getRequestContext()`, `getRequestId()`, or `getRequestDuration()` to
//      read the current context — no arguments needed.
//   4. Auth middleware enriches the context with `userId` / `storeId` via
//      `enrichRequestContext()` after verifying the JWT.
//
// ── Integration with Sentry & logging ────────────────────────────────────────
//
// `captureError()` and `captureAPIError()` (src/lib/sentry.ts) automatically
// attach the request context to every Sentry event — so a single error in
// Sentry shows the request ID, duration, path, user, and store. This makes
// it trivial to pivot from a Sentry issue to the corresponding SystemLog
// rows (filter by requestId in the metadata column).
//
// ── Edge Runtime compatibility ───────────────────────────────────────────────
//
// `AsyncLocalStorage` is a Node.js core API. It is NOT available in the Edge
// Runtime (where middleware.ts runs). This module is therefore SERVER-ONLY:
// it must only be imported by API route handlers, server actions, and
// server-side lib code. The middleware itself does NOT import this module —
// it only sets the `X-Request-ID` header, which the Node.js side reads.
//
// ─────────────────────────────────────────────────────────────────────────────

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * The per-request context. All fields except `requestId` and `startTime`
 * are optional and enriched progressively as the request flows through
 * auth + business logic.
 */
export interface RequestContext {
  /** Stable UUID for log/Sentry correlation. Set once at request start. */
  readonly requestId: string;

  /** High-resolution start time (nanoseconds since arbitrary epoch). */
  readonly startTime: bigint;

  /** Wall-clock start time (ISO 8601) — for human-readable logs. */
  readonly startedAt: string;

  /** HTTP method (GET, POST, etc.). */
  readonly method: string;

  /** Request path (e.g. /api/transactions). Excludes query string. */
  readonly path: string;

  /** Full URL including query string (for debug context only). */
  readonly url: string;

  /** Client IP address (best-effort, may be 'unknown'). */
  ipAddress?: string;

  /** Client User-Agent string. */
  userAgent?: string;

  /** Authenticated user ID (set by auth middleware after JWT verification). */
  userId?: string;

  /** Authenticated user role (SUPER_ADMIN, CASHIER, etc.). */
  userRole?: string;

  /** Active store ID (set by auth / tenant middleware). */
  storeId?: string;

  /** Organization ID (multi-tenant scoping). */
  organizationId?: string;

  /** Whether the request is part of an offline-sync batch (relaxes some checks). */
  isOfflineSync?: boolean;
}

/**
 * A snapshot of the request context suitable for logging / Sentry. All
 * `bigint` / `Date` fields are converted to serialisable primitives.
 */
export interface RequestContextSnapshot {
  requestId: string;
  method: string;
  path: string;
  durationMs: number;
  startedAt: string;
  userId?: string;
  userRole?: string;
  storeId?: string;
  organizationId?: string;
  ipAddress?: string;
  userAgent?: string;
  isOfflineSync?: boolean;
}

// ── AsyncLocalStorage singleton ──────────────────────────────────────────────
//
// The store is created ONCE at module load. `als.enterWith(store)` and
// `als.run(store, fn)` propagate the store through the async chain. We use
// `run()` (not `enterWith()`) because `run()` guarantees the store is
// cleared when `fn` returns — `enterWith()` leaks the store across requests
// in serverless environments (a known footgun).
//
// NOTE: This singleton is process-scoped. In Vercel serverless, each
// function invocation gets a fresh process, so there's no cross-request
// leakage. In `bun run dev` (long-running), `run()` ensures the store is
// scoped to each request.
const requestContextStorage = new AsyncLocalStorage<RequestContext>();

// ── Initialisation ───────────────────────────────────────────────────────────

/**
 * Initialise the request context subsystem. Idempotent — safe to call
 * multiple times. Currently a no-op (the ALS singleton is created at module
 * load), but exported so that `instrumentation.ts` can call it explicitly
 * in the future (e.g. to register telemetry hooks).
 *
 * @returns A dispose function (currently a no-op, but follows the
 *          `Symbol.dispose` convention for future resource management).
 */
export function initRequestContext(): () => void {
  // The ALS singleton is already created at module load. This function
  // exists as a stable initialisation seam for future extensibility
  // (e.g. registering OpenTelemetry context managers).
  return () => {
    // No-op for now.
  };
}

// ── ID generation ────────────────────────────────────────────────────────────

/**
 * Generate a new request ID. Uses `crypto.randomUUID()` (Node 19+) which
 * produces a v4 UUID — globally unique, URL-safe, and sortable-ish (v4 is
 * random, but the format is fixed-length and lexicographically comparable).
 *
 * Exposed so tests / middleware can generate IDs deterministically.
 */
export function generateRequestId(): string {
  // `randomUUID` is available in Node 16.7+ and in all modern browsers.
  // We use the node:crypto version (not the Web Crypto API) because this
  // module is server-only.
  return randomUUID();
}

/**
 * The canonical request-ID header name. Exported so middleware, API routes,
 * and client code all reference the same constant (no magic strings).
 */
export const REQUEST_ID_HEADER = 'X-Request-ID';

// ── Context creation ─────────────────────────────────────────────────────────

/**
 * Extract the request ID from a Request's headers, or generate a new one if
 * absent. Also captures method, path, URL, IP, and User-Agent.
 *
 * This is called by `withRequestContext()` and may be called directly by
 * route handlers that need to inspect the ID before the context is entered.
 *
 * @param req Any standard `Request` (Next.js `NextRequest` extends this).
 */
export function createRequestContextFromRequest(req: Request): RequestContext {
  // ── Request ID ────────────────────────────────────────────────────────────
  // Read the X-Request-ID header (set by edge middleware). If absent (e.g.
  // a direct server-to-server call that bypassed middleware), generate one.
  const incomingId = req.headers.get(REQUEST_ID_HEADER.toLowerCase());
  const requestId =
    typeof incomingId === 'string' && incomingId.trim().length > 0
      ? incomingId.trim()
      : generateRequestId();

  // ── Method + URL ──────────────────────────────────────────────────────────
  let path = 'unknown';
  let url = 'unknown';
  try {
    const parsed = new URL(req.url);
    path = parsed.pathname;
    url = parsed.href;
  } catch {
    // req.url may not be a valid URL in some test contexts. Fall back to
    // the raw string so we at least have SOMETHING in the logs.
    url = req.url || 'unknown';
    path = url;
  }

  // ── Client IP (best-effort) ───────────────────────────────────────────────
  // On Vercel, the client IP is in `x-forwarded-for` (first entry) or
  // `x-real-ip`. On local dev, both are absent — we record 'unknown'.
  const forwardedFor = req.headers.get('x-forwarded-for');
  let ipAddress: string | undefined;
  if (forwardedFor) {
    const ips = forwardedFor.split(',').map((s) => s.trim());
    ipAddress = ips[0];
  }
  if (!ipAddress) {
    const realIp = req.headers.get('x-real-ip');
    if (realIp) ipAddress = realIp.trim();
  }

  // ── User-Agent ────────────────────────────────────────────────────────────
  const userAgent = req.headers.get('user-agent') ?? undefined;

  return {
    requestId,
    startTime: process.hrtime.bigint(),
    startedAt: new Date().toISOString(),
    method: req.method,
    path,
    url,
    ipAddress,
    userAgent,
  };
}

// ── Context runner ───────────────────────────────────────────────────────────

/**
 * Run `fn` inside a request context. The context is automatically
 * propagated through all `await` boundaries and async descendants (timers,
 * callbacks, etc.) within `fn`.
 *
 * This is the PRIMARY entry point — API route handlers should wrap their
 * body in this. The `apiHandler()` and `withErrorBoundary()` wrappers in
 * `api-error.ts` / `logger.ts` call this automatically, so most route
 * handlers do NOT need to call it directly.
 *
 * @param req    The incoming Request (used to extract ID, method, path, etc.)
 * @param fn     The async function to run inside the context.
 * @returns      Whatever `fn` returns.
 *
 * @example
 *   export async function POST(req: NextRequest) {
 *     return withRequestContext(req, async () => {
 *       // Inside here, getRequestId() returns the current request's ID.
 *       await db.transaction.create({ ... });
 *       return Response.json({ success: true });
 *     });
 *   }
 */
export async function withRequestContext<T>(
  req: Request,
  fn: () => Promise<T>,
): Promise<T> {
  const context = createRequestContextFromRequest(req);
  return requestContextStorage.run(context, fn);
}

/**
 * Run `fn` inside a PRE-BUILT context (e.g. for testing or for server
 * actions that don't have a Request object). Most production code should
 * use `withRequestContext(req, fn)` instead.
 */
export async function withRequestContextValue<T>(
  context: RequestContext,
  fn: () => Promise<T>,
): Promise<T> {
  return requestContextStorage.run(context, fn);
}

// ── Context accessors ────────────────────────────────────────────────────────

/**
 * Get the current request context, or `null` if not running inside one.
 *
 * Returns `null` (not throws) so callers can use it in defensive code
 * paths that may run outside a request (e.g. background jobs, scripts).
 */
export function getRequestContext(): RequestContext | null {
  return requestContextStorage.getStore() ?? null;
}

/**
 * Get the current request ID, or `'unknown'` if not in a request context.
 *
 * This is the most-used accessor — safe to call from anywhere, including
 * code that may run outside a request (it returns 'unknown' rather than
 * throwing).
 */
export function getRequestId(): string {
  return requestContextStorage.getStore()?.requestId ?? 'unknown';
}

/**
 * Get the elapsed duration of the current request in milliseconds, or `0`
 * if not in a request context.
 *
 * Uses `process.hrtime.bigint()` for nanosecond precision (no drift from
 * system clock changes). The result is rounded to the nearest millisecond
 * for human readability; sub-ms precision is rarely useful in logs.
 */
export function getRequestDuration(): number {
  const ctx = requestContextStorage.getStore();
  if (!ctx) return 0;
  const elapsedNs = process.hrtime.bigint() - ctx.startTime;
  // BigInt → ms. 1ms = 1_000_000ns.
  return Number(elapsedNs / 1_000_000n);
}

/**
 * Get the authenticated user ID from the current context, or `undefined`.
 */
export function getRequestUserId(): string | undefined {
  return requestContextStorage.getStore()?.userId;
}

/**
 * Get the active store ID from the current context, or `undefined`.
 */
export function getRequestStoreId(): string | undefined {
  return requestContextStorage.getStore()?.storeId;
}

// ── Context enrichment ───────────────────────────────────────────────────────
//
// The context is created at request ENTRY (before auth runs), so `userId`
// and `storeId` are initially undefined. After the JWT is verified, the
// auth layer calls `enrichRequestContext()` to add them.
//
// Because `AsyncLocalStorage` returns a reference to the store object, we
// can mutate it in place — all downstream readers (via `getRequestContext()`)
// will see the updated fields. This is safe because:
//   1. The store is scoped to a single request (no cross-request sharing).
//   2. Mutation happens synchronously before any downstream async work
//      reads the enriched fields (the auth check is the first thing a
//      route does).
//
// We intentionally do NOT replace the store object (which would require
// `als.enterWith()` and break the `run()` scoping). We mutate in place.

/**
 * Enrich the current request context with additional fields (userId,
 * storeId, role, etc.). Mutates the active context in place.
 *
 * If no context is active (called outside a request), this is a no-op.
 *
 * @example
 *   // After verifying the JWT:
 *   enrichRequestContext({
 *     userId: decoded.userId,
 *     userRole: decoded.role,
 *     storeId: decoded.storeId,
 *     organizationId: decoded.organizationId,
 *   });
 */
export function enrichRequestContext(
  updates: Partial<Omit<RequestContext, 'requestId' | 'startTime' | 'startedAt' | 'method' | 'path' | 'url'>>,
): void {
  const ctx = requestContextStorage.getStore();
  if (!ctx) return;
  // Mutate in place — downstream readers see the updates immediately.
  // The `readonly` modifier on RequestContext fields prevents accidental
  // reassignment elsewhere, but we bypass it here via a cast because
  // enrichment is a sanctioned mutation point.
  Object.assign(ctx as Record<string, unknown>, updates);
}

// ── Snapshot (for logging / Sentry) ──────────────────────────────────────────

/**
 * Produce a serialisable snapshot of the current request context for
 * inclusion in log entries and Sentry events. Converts `bigint` startTime
 * to a duration in ms.
 *
 * Returns `null` if not in a request context (so callers can conditionally
 * include it).
 */
export function getRequestContextSnapshot(): RequestContextSnapshot | null {
  const ctx = requestContextStorage.getStore();
  if (!ctx) return null;
  const elapsedNs = process.hrtime.bigint() - ctx.startTime;
  return {
    requestId: ctx.requestId,
    method: ctx.method,
    path: ctx.path,
    durationMs: Number(elapsedNs / 1_000_000n),
    startedAt: ctx.startedAt,
    userId: ctx.userId,
    userRole: ctx.userRole,
    storeId: ctx.storeId,
    organizationId: ctx.organizationId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    isOfflineSync: ctx.isOfflineSync,
  };
}
