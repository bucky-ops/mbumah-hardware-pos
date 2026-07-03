// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Circuit Breaker (External Service Protection)
// ─────────────────────────────────────────────────────────────────────────────
//
// Phase 5 — Error Handling & Resilience Framework
//
// A circuit breaker prevents cascading failures when an external service
// (M-Pesa Daraja, Twilio, Resend) is down. Without it, every request that
// hits the failing service consumes a connection, waits for a timeout, and
// propagates the failure upstream — potentially taking down the whole app.
//
// ── The 3-state machine ──────────────────────────────────────────────────────
//
//   ┌─────────┐  failure rate ≥ threshold  ┌──────────┐
//   │ CLOSED  │ ─────────────────────────▶ │   OPEN   │
//   └─────────┘                             └──────────┘
//         ▲                                       │
//         │                                       │ cooldown elapsed
//         │                                       ▼
//         │   probe succeeds                ┌────────────┐
//         └──────────────────────────────── │ HALF_OPEN  │
//                                          └────────────┘
//                                                  │
//                                                  │ probe fails
//                                                  ▼
//                                          ┌──────────┐
//                                          │   OPEN   │
//                                          └──────────┘
//
//   • CLOSED    — Normal operation. All requests pass through. Failures are
//                 counted in a sliding window. When the failure rate (or
//                 count) exceeds the threshold, the breaker trips to OPEN.
//
//   • OPEN      — "Tripped". ALL requests fail IMMEDIATELY with a
//                 `CircuitOpenError` — no network call is made. This is the
//                 key protective behaviour: it stops hammering the dead
//                 service. After `cooldownMs`, the breaker transitions to
//                 HALF_OPEN to test if the service has recovered.
//
//   • HALF_OPEN — "Probe mode". A LIMITED number of trial requests are
//                 allowed through (`halfOpenMaxCalls`). If they succeed,
//                 the breaker closes. If ANY fails, it re-opens.
//
// ── Failure counting: sliding window ────────────────────────────────────────
//
// We use a sliding window of the last N requests (default 20). Each request
// records SUCCESS or FAILURE. The failure rate is `failures / total` within
// the window. When the rate exceeds `failureThreshold` (default 0.5 = 50%)
// AND the minimum number of calls (`minCalls`) has been reached, the breaker
// trips. This avoids tripping on the first failure of a brand-new service.
//
// ── Composing with retry (Phase 4) ──────────────────────────────────────────
//
// The circuit breaker wraps the OUTER boundary; retry wraps the INNER call:
//
//   withCircuitBreaker(name, () =>
//     executeWithRetry(() => callExternalService(), RETRY_PRESETS.EXTERNAL_API)
//   )
//
// This means:
//   • If the service is flaky (transient 503), RETRY handles it — the
//     breaker sees a SUCCESS (because the retry eventually succeeded).
//   • If the service is DOWN (all retries exhausted), the breaker sees a
//     FAILURE and counts it. After enough failures, it trips OPEN.
//   • When OPEN, the breaker short-circuits BEFORE retry runs — saving the
//     retry budget and connection pool.
//
// ── Registry & observability ─────────────────────────────────────────────────
//
// All breakers are registered in a global `CircuitBreakerRegistry` so the
// `/api/health/circuit-breaker` endpoint can report their state and an admin
// can manually reset them. Each breaker exposes:
//   • getState()           — CLOSED | OPEN | HALF_OPEN
//   • getMetrics()         — { failures, successes, trips, lastFailureAt, ... }
//   • reset()              — force back to CLOSED (admin action)
//   • forceOpen()          — force to OPEN (maintenance mode)
//
// ── Thread safety ────────────────────────────────────────────────────────────
//
// Node.js is single-threaded, so there are no true data races. However,
// concurrent async calls can interleave at `await` points. The HALF_OPEN
// "max calls" gate uses an atomic counter (incremented synchronously before
// the first `await`) to ensure only `halfOpenMaxCalls` probes run concurrently.
//
// ─────────────────────────────────────────────────────────────────────────────

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * The three states of a circuit breaker.
 *
 *   CLOSED    — normal operation, requests flow through
 *   OPEN      — tripped, all requests fail fast with CircuitOpenError
 *   HALF_OPEN — probe mode, limited trial requests allowed
 */
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/**
 * Configuration for a circuit breaker instance.
 */
export interface CircuitBreakerOptions {
  /**
   * Unique name for this breaker (e.g. 'mpesa-daraja', 'twilio-sms').
   * Used in logs, metrics, and the registry. Must be unique across the app.
   */
  name: string;

  /**
   * Failure rate threshold (0–1) at which the breaker trips from CLOSED to
   * OPEN. Default: 0.5 (50% of requests in the window fail).
   *
   * Example: with a window of 20 and threshold 0.5, the breaker trips when
   * 10+ of the last 20 requests failed.
   */
  failureThreshold?: number;

  /**
   * Minimum number of calls in the sliding window BEFORE the failure rate
   * is evaluated. Prevents tripping on the first failure of a cold service.
   * Default: 10.
   */
  minCalls?: number;

  /**
   * Size of the sliding window (number of recent calls to track). Default: 20.
   */
  slidingWindowSize?: number;

  /**
   * Time in milliseconds the breaker stays OPEN before transitioning to
   * HALF_OPEN. Default: 30_000 (30s).
   */
  cooldownMs?: number;

  /**
   * Number of trial requests allowed in HALF_OPEN. If ALL succeed, the
   * breaker closes. If ANY fails, it re-opens. Default: 3.
   */
  halfOpenMaxCalls?: number;

  /**
   * Predicate that decides whether a thrown error counts as a "failure"
   * for breaker purposes. Defaults to treating ALL errors as failures
   * (the breaker doesn't know about HTTP semantics — that's retry's job).
   *
   * Override this to, e.g., NOT count 4xx as failures (client errors
   * don't indicate the service is down).
   */
  isFailure?: (err: unknown) => boolean;

  /**
   * Called when the breaker transitions OPEN. Useful for alerting (e.g.
   * send a Slack message, page on-call). Receives the metrics snapshot.
   */
  onOpen?: (metrics: CircuitBreakerMetrics) => void;

  /**
   * Called when the breaker transitions back to CLOSED (recovered).
   * Receives the metrics snapshot.
   */
  onClose?: (metrics: CircuitBreakerMetrics) => void;

  /**
   * Called when the breaker transitions from OPEN to HALF_OPEN (probe
   * phase started).
   */
  onHalfOpen?: (metrics: CircuitBreakerMetrics) => void;
}

/**
 * Observable metrics for a circuit breaker. Returned by `getMetrics()` and
 * surfaced via `/api/health/circuit-breaker`.
 */
export interface CircuitBreakerMetrics {
  /** Current state. */
  state: CircuitState;

  /** Breaker name. */
  name: string;

  /** Total calls recorded since the breaker was created (resets on `reset()`). */
  totalCalls: number;

  /** Total successful calls. */
  totalSuccesses: number;

  /** Total failed calls. */
  totalFailures: number;

  /** Total times the breaker has tripped to OPEN. */
  totalTrips: number;

  /** Number of calls in the current sliding window. */
  windowSize: number;

  /** Number of failures in the current sliding window. */
  windowFailures: number;

  /** Current failure rate in the window (0–1). */
  failureRate: number;

  /** ISO timestamp of the last failure, or null. */
  lastFailureAt: string | null;

  /** ISO timestamp of the last success, or null. */
  lastSuccessAt: string | null;

  /** ISO timestamp of when the breaker opened (if OPEN/HALF_OPEN), else null. */
  openedAt: string | null;

  /** Milliseconds until the breaker transitions OPEN → HALF_OPEN. 0 if not OPEN. */
  msUntilHalfOpen: number;

  /** Number of probe calls currently in flight (HALF_OPEN). */
  halfOpenInFlight: number;
}

// ── Errors ───────────────────────────────────────────────────────────────────

/**
 * Thrown when a request is rejected because the circuit is OPEN.
 *
 * This is a CONTROL-FLOW error, not a real failure. Callers should catch it
 * and degrade gracefully (e.g. fall back to a cached value, queue for later,
 * or show the user a "service temporarily unavailable" message).
 *
 * IMPORTANT: `CircuitOpenError` is NOT counted as a failure by the breaker
 * (it never reaches the service). It's purely a signal to the caller.
 */
export class CircuitOpenError extends Error {
  readonly circuitName: string;
  readonly metrics: CircuitBreakerMetrics;

  constructor(name: string, metrics: CircuitBreakerMetrics) {
    super(`Circuit "${name}" is OPEN — requests are failing fast. ` +
      `Last failure: ${metrics.lastFailureAt ?? 'unknown'}. ` +
      `Retry in ${metrics.msUntilHalfOpen}ms.`);
    this.name = 'CircuitOpenError';
    this.circuitName = name;
    this.metrics = metrics;
  }
}

// ── Default options ──────────────────────────────────────────────────────────

const DEFAULT_CB_OPTIONS: Required<
  Omit<CircuitBreakerOptions, 'name' | 'onOpen' | 'onClose' | 'onHalfOpen' | 'isFailure'>
> = {
  failureThreshold: 0.5,
  minCalls: 10,
  slidingWindowSize: 20,
  cooldownMs: 30_000,
  halfOpenMaxCalls: 3,
};

// ── Sliding window ───────────────────────────────────────────────────────────

/**
 * A fixed-size sliding window of boolean outcomes (true = success,
 * false = failure). Used to compute the recent failure rate.
 *
 * Implemented as a circular buffer for O(1) push and O(1) failure counting.
 */
class SlidingWindow {
  private readonly buffer: boolean[];
  private count = 0;
  private failures = 0;
  private head = 0; // index of the OLDEST entry (next to be overwritten)

  constructor(private readonly size: number) {
    this.buffer = new Array(size).fill(false);
  }

  /** Push a new outcome. Evicts the oldest if the window is full. */
  push(success: boolean): void {
    // If the window is full, evict the oldest entry before writing.
    if (this.count >= this.size) {
      const oldSuccess = this.buffer[this.head];
      if (!oldSuccess) this.failures--;
    } else {
      this.count++;
    }
    // Write the new entry at the head position and advance.
    this.buffer[this.head] = success;
    if (!success) this.failures++;
    this.head = (this.head + 1) % this.size;
  }

  /** Current number of entries in the window (≤ size). */
  get length(): number {
    return this.count;
  }

  /** Number of failures in the window. */
  get failureCount(): number {
    return this.failures;
  }

  /** Failure rate (0–1). Returns 0 if the window is empty. */
  get failureRate(): number {
    return this.count === 0 ? 0 : this.failures / this.count;
  }

  /** Reset the window (used when the breaker is manually reset). */
  reset(): void {
    this.buffer.fill(false);
    this.count = 0;
    this.failures = 0;
    this.head = 0;
  }
}

// ── CircuitBreaker ───────────────────────────────────────────────────────────

/**
 * A single circuit breaker instance. Created via `new CircuitBreaker(opts)` or
 * retrieved from the global registry via `getCircuitBreaker(name)`.
 *
 * Most callers should use the `withCircuitBreaker` HOF from
 * `src/lib/circuit-breaker-decorator.ts` rather than calling `execute` directly.
 */
export class CircuitBreaker {
  readonly name: string;
  private state: CircuitState = 'CLOSED';
  private readonly window: SlidingWindow;
  private readonly opts: Required<
    Omit<CircuitBreakerOptions, 'onOpen' | 'onClose' | 'onHalfOpen' | 'isFailure'>
  > & Pick<CircuitBreakerOptions, 'onOpen' | 'onClose' | 'onHalfOpen' | 'isFailure'>;

  // ── Counters (since creation or last reset) ──────────────────────────────
  private totalCalls = 0;
  private totalSuccesses = 0;
  private totalFailures = 0;
  private totalTrips = 0;

  // ── Timestamps ───────────────────────────────────────────────────────────
  private lastFailureAt: number | null = null;
  private lastSuccessAt: number | null = null;
  private openedAt: number | null = null;

  // ── HALF_OPEN probe gating ───────────────────────────────────────────────
  // Synchronous counter — incremented BEFORE any await, so concurrent calls
  // can't both grab the last probe slot.
  private halfOpenInFlight = 0;

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name;
    const size = options.slidingWindowSize ?? DEFAULT_CB_OPTIONS.slidingWindowSize;
    this.window = new SlidingWindow(size);
    this.opts = {
      ...DEFAULT_CB_OPTIONS,
      ...options,
    } as typeof this.opts;

    // Register in the global registry (throws on duplicate name).
    circuitBreakerRegistry.register(this);
  }

  // ── Public state accessors ───────────────────────────────────────────────

  /** Current state of the breaker. */
  getState(): CircuitState {
    // Lazily transition OPEN → HALF_OPEN if the cooldown has elapsed.
    // This is checked here (rather than via a timer) so we don't hold a
    // long-lived timer that prevents clean shutdown.
    if (this.state === 'OPEN' && this.openedAt !== null) {
      const elapsed = Date.now() - this.openedAt;
      if (elapsed >= this.opts.cooldownMs) {
        this.transitionToHalfOpen();
      }
    }
    return this.state;
  }

  /** Get a metrics snapshot (for /api/health/circuit-breaker). */
  getMetrics(): CircuitBreakerMetrics {
    const state = this.getState();
    const openedAtIso = this.openedAt ? new Date(this.openedAt).toISOString() : null;
    const msUntilHalfOpen =
      state === 'OPEN' && this.openedAt !== null
        ? Math.max(0, this.opts.cooldownMs - (Date.now() - this.openedAt))
        : 0;

    return {
      state,
      name: this.name,
      totalCalls: this.totalCalls,
      totalSuccesses: this.totalSuccesses,
      totalFailures: this.totalFailures,
      totalTrips: this.totalTrips,
      windowSize: this.window.length,
      windowFailures: this.window.failureCount,
      failureRate: this.window.failureRate,
      lastFailureAt: this.lastFailureAt ? new Date(this.lastFailureAt).toISOString() : null,
      lastSuccessAt: this.lastSuccessAt ? new Date(this.lastSuccessAt).toISOString() : null,
      openedAt: openedAtIso,
      msUntilHalfOpen,
      halfOpenInFlight: this.halfOpenInFlight,
    };
  }

  // ── Admin actions ────────────────────────────────────────────────────────

  /** Force the breaker back to CLOSED and reset all counters. */
  reset(): void {
    this.state = 'CLOSED';
    this.window.reset();
    this.totalCalls = 0;
    this.totalSuccesses = 0;
    this.totalFailures = 0;
    this.totalTrips = 0;
    this.lastFailureAt = null;
    this.lastSuccessAt = null;
    this.openedAt = null;
    this.halfOpenInFlight = 0;
  }

  /** Force the breaker to OPEN (e.g. for planned maintenance). */
  forceOpen(): void {
    if (this.state !== 'OPEN') {
      this.transitionToOpen();
    }
  }

  // ── Core execution ───────────────────────────────────────────────────────

  /**
   * Execute `fn` through the circuit breaker.
   *
   * Behaviour by state:
   *   • CLOSED    — call fn. Record success/failure. Maybe trip to OPEN.
   *   • OPEN      — throw CircuitOpenError IMMEDIATELY (no call to fn).
   *   • HALF_OPEN — allow up to halfOpenMaxCalls concurrent probes.
   *                 On success → close. On failure → re-open.
   *
   * @returns The return value of `fn`.
   * @throws  `CircuitOpenError` if the circuit is OPEN (or HALF_OPEN and
   *          the probe budget is exhausted), or any error thrown by `fn`.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.getState();

    // ── OPEN: fail fast ──────────────────────────────────────────────────
    if (state === 'OPEN') {
      throw new CircuitOpenError(this.name, this.getMetrics());
    }

    // ── HALF_OPEN: gate concurrent probes ────────────────────────────────
    if (state === 'HALF_OPEN') {
      if (this.halfOpenInFlight >= this.opts.halfOpenMaxCalls) {
        // Too many probes already in flight — fail fast (treat like OPEN).
        throw new CircuitOpenError(this.name, this.getMetrics());
      }
      this.halfOpenInFlight++;
      try {
        const result = await this.runAndRecord(fn);
        // Probe succeeded — if all in-flight probes are done, close.
        // We check by decrementing; if 0 after decrement, close.
        return result;
      } finally {
        // The finally runs AFTER runAndRecord has recorded the outcome.
        // Decrement in-flight and check for close transition.
        this.halfOpenInFlight = Math.max(0, this.halfOpenInFlight - 1);
        // If all probes completed and the last one was a success, runAndRecord
        // already transitioned to CLOSED (see onSuccess in HALF_OPEN mode).
        // If the last probe failed, runAndRecord re-opened. Either way, no
        // action needed here.
      }
    }

    // ── CLOSED: normal execution ─────────────────────────────────────────
    return this.runAndRecord(fn);
  }

  /**
   * Run `fn`, record the outcome, and possibly transition state.
   * Shared by CLOSED and HALF_OPEN paths.
   */
  private async runAndRecord<T>(fn: () => Promise<T>): Promise<T> {
    this.totalCalls++;
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure(err);
      throw err;
    }
  }

  // ── Outcome handlers ─────────────────────────────────────────────────────

  private onSuccess(): void {
    this.lastSuccessAt = Date.now();
    this.totalSuccesses++;
    this.window.push(true);

    // ── In HALF_OPEN, a successful probe closes the breaker ──────────────
    // (only if this was the LAST in-flight probe — others may still be running)
    if (this.state === 'HALF_OPEN' && this.halfOpenInFlight <= 1) {
      this.transitionToClosed();
    }
  }

  private onFailure(err: unknown): void {
    // ── Filter: some errors don't count as "service failures" ─────────────
    // E.g. a 400 Bad Request is the CLIENT's fault, not the service being
    // down. The isFailure predicate lets callers exclude these.
    //
    // Filtered errors are still counted as CALLS (so operators can see "we
    // made N calls") but NOT as FAILURES (so they don't push to the sliding
    // window or affect the failure rate). This keeps totalCalls and
    // totalFailures consistent: a call that returned 400 increments
    // totalCalls but leaves totalFailures unchanged.
    if (this.opts.isFailure && !this.opts.isFailure(err)) {
      // totalCalls was already incremented in runAndRecord — keep it.
      // Do NOT increment totalFailures, do NOT push to the window.
      return;
    }

    this.lastFailureAt = Date.now();
    this.totalFailures++;
    this.window.push(false);

    // ── In HALF_OPEN, ANY failure re-opens the breaker ───────────────────
    if (this.state === 'HALF_OPEN') {
      this.transitionToOpen();
      return;
    }

    // ── In CLOSED, check if we should trip ───────────────────────────────
    if (this.state === 'CLOSED' && this.shouldTrip()) {
      this.transitionToOpen();
    }
  }

  /**
   * Decide whether the breaker should trip based on the sliding window.
   * Returns true if:
   *   • The window has at least `minCalls` entries, AND
   *   • The failure rate exceeds `failureThreshold`.
   */
  private shouldTrip(): boolean {
    if (this.window.length < this.opts.minCalls) return false;
    return this.window.failureRate >= this.opts.failureThreshold;
  }

  // ── State transitions ────────────────────────────────────────────────────

  private transitionToOpen(): void {
    const wasHalfOpen = this.state === 'HALF_OPEN';
    this.state = 'OPEN';
    this.openedAt = Date.now();
    if (!wasHalfOpen) {
      // Only count "trips" when going CLOSED → OPEN (not HALF_OPEN → OPEN,
      // which is a re-trip of an already-broken service).
      this.totalTrips++;
    }
    this.opts.onOpen?.(this.getMetrics());
  }

  private transitionToHalfOpen(): void {
    this.state = 'HALF_OPEN';
    this.halfOpenInFlight = 0;
    this.opts.onHalfOpen?.(this.getMetrics());
  }

  private transitionToClosed(): void {
    this.state = 'CLOSED';
    this.openedAt = null;
    this.halfOpenInFlight = 0;
    // Reset the sliding window so the recovered service starts fresh.
    // Old failures from the outage shouldn't immediately re-trip it.
    this.window.reset();
    this.opts.onClose?.(this.getMetrics());
  }
}

// ── Global registry ──────────────────────────────────────────────────────────

/**
 * A process-wide registry of all circuit breakers. This allows the
 * `/api/health/circuit-breaker` endpoint to enumerate all breakers and
 * the admin to reset them by name.
 *
 * In serverless environments (Vercel), each function invocation gets a fresh
 * process, so the registry is per-invocation. In `bun run dev` (long-running),
 * the registry persists across requests — which is what we want for observing
 * breaker state over time.
 */
class CircuitBreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();

  /** Register a breaker. Throws on duplicate name. */
  register(breaker: CircuitBreaker): void {
    if (this.breakers.has(breaker.name)) {
      // Already registered — return the existing one silently in dev to
      // avoid hot-reload errors. In production, this would indicate a bug.
      return;
    }
    this.breakers.set(breaker.name, breaker);
  }

  /** Get a breaker by name, or undefined. */
  get(name: string): CircuitBreaker | undefined {
    return this.breakers.get(name);
  }

  /**
   * Get OR CREATE a breaker with the given options. If a breaker with the
   * same name already exists, returns it (ignoring the new options — the
   * first registration wins). This is the recommended way to obtain a
   * breaker in module code, because it's idempotent across hot reloads.
   */
  getOrCreate(options: CircuitBreakerOptions): CircuitBreaker {
    const existing = this.breakers.get(options.name);
    if (existing) return existing;
    return new CircuitBreaker(options);
  }

  /** List all registered breakers. */
  list(): CircuitBreaker[] {
    return Array.from(this.breakers.values());
  }

  /** Get metrics for all breakers (for the health endpoint). */
  getAllMetrics(): CircuitBreakerMetrics[] {
    return this.list().map((b) => b.getMetrics());
  }

  /** Reset a specific breaker by name. Returns true if found. */
  reset(name: string): boolean {
    const breaker = this.breakers.get(name);
    if (!breaker) return false;
    breaker.reset();
    return true;
  }

  /** Reset ALL breakers (admin "panic" button). */
  resetAll(): number {
    let count = 0;
    for (const breaker of this.breakers.values()) {
      breaker.reset();
      count++;
    }
    return count;
  }
}

/** The singleton registry. Import this to access breakers by name. */
export const circuitBreakerRegistry = new CircuitBreakerRegistry();

// ── Presets ──────────────────────────────────────────────────────────────────

/**
 * Pre-configured circuit breaker options for common external services.
 * These encode operational knowledge (e.g. M-Pesa Daraja tolerates a 30s
 * cooldown; Twilio is more sensitive so we use a smaller window).
 */
export const CIRCUIT_BREAKER_PRESETS: Record<string, Omit<CircuitBreakerOptions, 'name'>> = {
  /**
   * M-Pesa Daraja (Safaricom STK Push API).
   *   • 50% failure rate over 20 calls → trip
   *   • 30s cooldown before probing
   *   • 3 probe calls in HALF_OPEN
   *
   * Daraja is critical for payments — we want to trip reasonably fast (so we
   * don't hold up the checkout) but recover quickly (Safaricom outages are
   * usually brief).
   */
  MPESA_DARAJA: {
    failureThreshold: 0.5,
    minCalls: 10,
    slidingWindowSize: 20,
    cooldownMs: 30_000,
    halfOpenMaxCalls: 3,
    // 4xx (except 429) are client errors — the service is UP, the request
    // was bad. Don't count these as failures.
    isFailure: (err) => {
      if (err && typeof err === 'object' && 'status' in err) {
        const status = (err as { status: number }).status;
        // Count 5xx, 429, and network errors as failures.
        // 4xx (non-429) = client error = service is fine.
        return status >= 500 || status === 429 || typeof status !== 'number';
      }
      // Network errors (TypeError, AbortError) count as failures.
      return true;
    },
  },

  /**
   * Twilio (SMS + WhatsApp).
   *   • 50% failure rate over 20 calls → trip
   *   • 60s cooldown (Twilio outages tend to be longer)
   *   • 2 probe calls
   *
   * When Twilio is down, notifications queue (the app continues working —
   * notifications are async). A longer cooldown avoids hammering Twilio
   * during an outage.
   */
  TWILIO: {
    failureThreshold: 0.5,
    minCalls: 10,
    slidingWindowSize: 20,
    cooldownMs: 60_000,
    halfOpenMaxCalls: 2,
    isFailure: (err) => {
      if (err && typeof err === 'object' && 'status' in err) {
        const status = (err as { status: number }).status;
        return status >= 500 || status === 429 || typeof status !== 'number';
      }
      return true;
    },
  },

  /**
   * Resend (Email).
   *   • 60% failure rate over 15 calls → trip (slightly more lenient —
   *     email is lower priority than payments)
   *   • 45s cooldown
   *   • 2 probe calls
   */
  RESEND: {
    failureThreshold: 0.6,
    minCalls: 8,
    slidingWindowSize: 15,
    cooldownMs: 45_000,
    halfOpenMaxCalls: 2,
    isFailure: (err) => {
      if (err && typeof err === 'object' && 'status' in err) {
        const status = (err as { status: number }).status;
        return status >= 500 || status === 429 || typeof status !== 'number';
      }
      return true;
    },
  },

  /**
   * Generic external API. Use this for any third-party service that doesn't
   * have a specific preset.
   */
  EXTERNAL_API: {
    failureThreshold: 0.5,
    minCalls: 10,
    slidingWindowSize: 20,
    cooldownMs: 30_000,
    halfOpenMaxCalls: 3,
  },

  /**
   * Strict preset — trips fast, recovers slow. Use for services where calling
   * them when down is very expensive (e.g. a paid API that charges per
   * request even on errors).
   */
  STRICT: {
    failureThreshold: 0.3,
    minCalls: 5,
    slidingWindowSize: 10,
    cooldownMs: 120_000,
    halfOpenMaxCalls: 1,
  },
};
