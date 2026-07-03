// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Next.js Instrumentation Hook
// ─────────────────────────────────────────────────────────────────────────────
//
// Next.js 16 calls `register()` ONCE per server runtime, BEFORE any route
// handler or page is rendered. This is the canonical place to initialise
// server-side observability:
//
//   • Sentry (server config) — error aggregation + performance traces.
//   • (Future) OpenTelemetry — distributed tracing to Grafana / Honeycomb.
//   • (Future) APM agents — Datadog / New Relic.
//
// Runtime detection:
//   Next.js sets `process.env.NEXT_RUNTIME` to either:
//     - 'nodejs' → the standard Node.js serverless runtime.
//     - 'edge'   → the Vercel Edge Runtime (limited APIs, no Node core).
//   We branch on this so the Node-only Sentry SDK isn't imported in the
//   Edge runtime (which would crash the build).
//
// Why dynamic import()?
//   Static `import './sentry.server.config'` would bundle the config into
//   EVERY route — bloating cold-start. Dynamic `import()` is code-split:
//   the config loads once, lazily, on first server boot. Next.js caches
//   the resolved promise so subsequent calls are free.
//
// Client-side Sentry:
//   The CLIENT config (`sentry.client.config.ts`) is NOT loaded here. It is
//   auto-injected into the browser bundle by `@sentry/nextjs`'s webpack
//   plugin (configured in next.config.ts via `withSentryConfig`). The
//   browser never executes this `register()` function.
//
// ─────────────────────────────────────────────────────────────────────────────

export async function register(): Promise<void> {
  const runtime = process.env.NEXT_RUNTIME;

  // ── Node.js runtime ────────────────────────────────────────────────────────
  // Load the full server Sentry config (Node SDK + integrations).
  if (runtime === 'nodejs') {
    try {
      // Dynamic import → code-split, runs once, cached.
      await import('./sentry.server.config');
    } catch (error) {
      // Sentry init must NEVER block the server from booting. If it fails,
      // log to stderr and continue — the DB-backed SystemLog is the
      // fallback system-of-record.
      console.error(
        '[instrumentation] Failed to initialise server Sentry:',
        error instanceof Error ? error.message : String(error),
      );
    }
    return;
  }

  // ── Edge runtime ───────────────────────────────────────────────────────────
  // The Edge runtime supports a subset of the Sentry SDK. We reuse the same
  // config file — `@sentry/nextjs` detects the runtime and enables only the
  // compatible integrations. (Edge middleware runs here too.)
  if (runtime === 'edge') {
    try {
      await import('./sentry.server.config');
    } catch (error) {
      console.error(
        '[instrumentation] Failed to initialise edge Sentry:',
        error instanceof Error ? error.message : String(error),
      );
    }
    return;
  }

  // ── Unknown runtime (build phase) ──────────────────────────────────────────
  // During `next build`, `NEXT_RUNTIME` is undefined. We skip Sentry init —
  // the build doesn't need a live error reporter, and env vars may not be
  // injected yet.
  //
  // This also covers `NEXT_PHASE === 'phase-production-build'`, where
  // importing Sentry would pull the full SDK into the build process for no
  // benefit.
}
