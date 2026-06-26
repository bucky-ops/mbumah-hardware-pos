// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Environment-variable validation (Zod)
// ─────────────────────────────────────────────────────────────────────────────
//
// This module validates required environment variables using the
// `SKIP_ENV_VALIDATION` pattern (popularized by create-t3-app).
//
// ## CRITICAL DESIGN DECISION: LAZY validation (non-throwing at import)
//
// Previous versions of this module threw `EnvValidationError` EAGERLY at
// module-import time. This caused OPAQUE 500 errors on Vercel when ANY single
// env var was malformed — e.g. if `NEXTAUTH_URL` was set to a random string
// instead of a URL, the ENTIRE `/api/auth/login` route would crash during
// module evaluation, BEFORE the route handler ever ran. The `withErrorBoundary`
// wrapper could NOT catch this (it only wraps the handler, not module init),
// so Vercel returned the default Next.js 500 HTML page with NO diagnostic info.
//
// The fix: validation is now LAZY. The `env` export returns a Proxy that
// validates on FIRST property access (not at import). This means:
//   • Importing `@/lib/env` NEVER throws — routes always load successfully.
//   • Validation runs once on the first `env.DATABASE_URL` access.
//   • If validation fails, the error is thrown at the call site (inside the
//     route handler), where `withErrorBoundary` CAN catch it and return a
//     proper JSON error response with the full diagnostic detail.
//   • `requireEnv('KEY')` validates that specific key on-demand.
//
// ## How it works
//
//   ┌──────────────────────────────────────────────────────────────────────┐
//   │  `SKIP_ENV_VALIDATION` is truthy OR NEXT_PHASE=phase-production-build?│
//   │                                                                      │
//   │   YES (build phase / vercel-build script)                            │
//   │     → Skip Zod validation entirely.                                  │
//   │     → Export `process.env` cast to the schema type.                  │
//   │     → Lets `next build` collect page data for /api/* routes          │
//   │       WITHOUT crashing on missing runtime secrets.                   │
//   │                                                                      │
//   │   NO (runtime: Vercel serverless, `bun run dev`)                     │
//   │     → Return a LAZY proxy.                                           │
//   │     → First property access triggers Zod `safeParse`.                │
//   │     → If validation fails, throws `EnvValidationError` at call site. │
//   │     → `withErrorBoundary` catches it → JSON 500 with details.        │
//   └──────────────────────────────────────────────────────────────────────┘
//
// ## Usage
//
//   import { env, requireEnv } from '@/lib/env';
//   const url = env.DATABASE_URL;            // validates on first access
//   const secret = requireEnv('JWT_SECRET'); // enforces specific key
//
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';

/**
 * Thrown when a required environment variable is missing or malformed.
 * The `missing` array lists every offending key so a single deployment can
 * surface all gaps at once (not one-by-one across restarts).
 */
export class EnvValidationError extends Error {
  readonly code = 'ENV_VALIDATION_FAILED';
  readonly missing: string[];
  constructor(missing: string[]) {
    super(
      [
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        ' FATAL: Environment variable validation failed.',
        '',
        ` Missing / invalid: ${missing.join(', ')}`,
        '',
        ' Remediation:',
        '  • Local dev:  create a .env file in the project root (see .env.example).',
        '  • Vercel:     Project Settings → Environment Variables → add the keys',
        '                for the Production / Preview / Development environments.',
        '  • NEXTAUTH_SECRET / JWT_SECRET: generate with `openssl rand -base64 32`.',
        '  • NEXTAUTH_URL: the canonical app URL (e.g. https://mbumah-hardware-pos.vercel.app).',
        '  • DATABASE_URL: Neon/Supabase POOLED connection string',
        '                (append ?pgbouncer=true&connect_timeout=15).',
        '  • Build phase: the `vercel-build` script sets SKIP_ENV_VALIDATION=1,',
        '                so this error should NEVER appear during `next build`.',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      ].join('\n'),
    );
    this.name = 'EnvValidationError';
    this.missing = missing;
  }
}

// ── Schema ───────────────────────────────────────────────────────────────────
//
// `DATABASE_URL` is required — the app cannot function without a database.
// The auth secrets (NEXTAUTH_SECRET, JWT_SECRET, NEXTAUTH_URL) are optional at
// import time; they are enforced lazily via `requireEnv()` in the routes that
// actually need them, so a dev env that hasn't set up auth can still boot.
//
// NOTE: NEXTAUTH_URL uses `.min(1)` instead of `.url()` so that a malformed
// value (e.g. a random string accidentally pasted into the Vercel env var)
// does NOT crash the entire app. The URL format is validated lazily by the
// routes that actually need a valid URL (e.g. NextAuth callbacks).
const envSchema = z.object({
  // Database — required. The db.ts module does the richer Neon/Supabase
  // pooling validation; here we just confirm presence.
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required (use the Neon/Supabase POOLED connection string).'),

  // NextAuth — NEXTAUTH_URL is the canonical public URL of the deployment.
  // Uses .min(1) NOT .url() — a malformed value should not crash the app.
  // Routes that need a valid URL validate it explicitly.
  NEXTAUTH_URL: z
    .string()
    .min(1, 'NEXTAUTH_URL is set but empty.')
    .optional(),

  // NEXTAUTH_SECRET signs session JWTs. Min 16 chars (use `openssl rand -base64 32`).
  NEXTAUTH_SECRET: z
    .string()
    .min(16, 'NEXTAUTH_SECRET should be at least 16 characters (use `openssl rand -base64 32`).')
    .optional(),

  // JWT_SECRET — used by the custom token-based auth in login/route.ts.
  JWT_SECRET: z
    .string()
    .min(16, 'JWT_SECRET should be at least 16 characters (use `openssl rand -base64 32`).')
    .optional(),

  // NODE_ENV — typed enum so downstream code can branch safely.
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .optional()
    .default('development'),
});

export type Env = z.infer<typeof envSchema>;

// ── Build-phase detection ────────────────────────────────────────────────────
//
// `isBuildTime` is true during `next build` (when env vars aren't injected)
// so that eager validation is skipped and page-data collection succeeds.
export const isBuildTime =
  typeof process.env.NEXT_RUNTIME === 'undefined' ||
  process.env.SKIP_ENV_VALIDATION === '1' ||
  process.env.SKIP_ENV_VALIDATION === 'true' ||
  process.env.SKIP_ENV_VALIDATION === 'yes' ||
  // Layer 2: Next.js sets NEXT_PHASE automatically during `next build`
  // (value: 'phase-production-build') and instrumentation. This makes
  // `next build` work even if SKIP_ENV_VALIDATION=1 isn't prefixed on
  // the command line — Next.js itself signals the build phase.
  process.env.NEXT_PHASE === 'phase-production-build' ||
  process.env.NEXT_PHASE === 'phase-instrumentation';

// ── Validation (lazy — runs on first access, NOT at import) ──────────────────

/**
 * Run the full Zod safeParse and return the validated env (or throw).
 * Called lazily on first `env.X` access so that module import NEVER throws.
 */
function validateEnv(): Env {
  // Client bundle guard — this module is server-only, but prevent a
  // confusing crash if a client component accidentally imports it.
  if (typeof window !== 'undefined') {
    return {
      DATABASE_URL: '',
      NODE_ENV: 'development',
    } as unknown as Env;
  }

  // ── BUILD PHASE: skip validation when SKIP_ENV_VALIDATION is truthy OR ──
  // ── when Next.js signals the build phase via NEXT_PHASE. ──────────────────
  const NEXT_PHASE_BUILD = 'phase-production-build';
  const NEXT_PHASE_INSTRUMENT = 'phase-instrumentation';
  if (
    process.env.SKIP_ENV_VALIDATION === '1' ||
    process.env.SKIP_ENV_VALIDATION === 'true' ||
    process.env.SKIP_ENV_VALIDATION === 'yes' ||
    process.env.NEXT_PHASE === NEXT_PHASE_BUILD ||
    process.env.NEXT_PHASE === NEXT_PHASE_INSTRUMENT
  ) {
    return process.env as unknown as Env;
  }

  // ── RUNTIME: run the full Zod safeParse and throw on failure. ──────────────
  //
  // `safeParse` (not `parse`) so we can collect ALL issues into a single
  // descriptive `EnvValidationError` rather than throwing on the first one.
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (i) => `${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    throw new EnvValidationError(issues);
  }

  return parsed.data;
}

// ── Lazy proxy: validates on first property access ───────────────────────────
//
// This is the KEY change. Instead of `export const env = validateEnv()` (which
// runs validation at import time and can crash module loading), we return a
// Proxy that defers validation until the first property is accessed.
//
// Benefits:
//   1. Importing `@/lib/env` NEVER throws — all routes load successfully.
//   2. Validation runs exactly once (cached after first access).
//   3. If validation fails, the error is thrown at the CALL SITE (inside a
//      route handler), where withErrorBoundary CAN catch it → JSON 500.
//   4. Build phase (SKIP_ENV_VALIDATION / NEXT_PHASE) still skips entirely.
//
let cachedEnv: Env | null = null;

function getEnv(): Env {
  if (cachedEnv === null) {
    cachedEnv = validateEnv();
  }
  return cachedEnv;
}

export const env: Env = new Proxy({} as Env, {
  get(_target, prop: string) {
    return getEnv()[prop as keyof Env];
  },
  ownKeys() {
    return Reflect.ownKeys(getEnv());
  },
  getOwnPropertyDescriptor(_target, prop: string) {
    return Reflect.getOwnPropertyDescriptor(getEnv(), prop);
  },
});

/**
 * Assert that a specific environment variable is present at request time.
 * Use this in API routes that need a secret which may be optional in some
 * environments (e.g. NEXTAUTH_SECRET isn't needed for the health-check
 * route, but IS needed for login).
 *
 * Throws EnvValidationError if the variable is missing.
 *
 * @example
 *   import { requireEnv } from '@/lib/env';
 *   const secret = requireEnv('JWT_SECRET');
 */
export function requireEnv(key: 'NEXTAUTH_SECRET' | 'JWT_SECRET' | 'NEXTAUTH_URL'): string {
  const value = getEnv()[key];
  if (!value || value.trim() === '') {
    throw new EnvValidationError([key]);
  }
  return value;
}

/**
 * True when running in production (Vercel prod or `NODE_ENV=production`).
 * Convenience accessor so callers don't need to import `env` directly for
 * a simple boolean check.
 */
export const isProduction = process.env.NODE_ENV === 'production';

/**
 * True when running in the Vitest test suite. Used to relax eager env
 * validation in test contexts where the full env isn't set up.
 */
export const isTest = process.env.NODE_ENV === 'test';
