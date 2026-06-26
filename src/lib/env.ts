// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Environment-variable validation (Zod)
// ─────────────────────────────────────────────────────────────────────────────
//
// This module validates required environment variables at module-load time
// using the industry-standard `SKIP_ENV_VALIDATION` pattern (popularized by
// create-t3-app). This is the SAME pattern used by Vercel-deployed Next.js
// apps across the ecosystem.
//
// ## How it works
//
//   ┌──────────────────────────────────────────────────────────────────────┐
//   │  `SKIP_ENV_VALIDATION` is truthy?                                    │
//   │                                                                      │
//   │   YES (build phase / vercel-build script)                            │
//   │     → Skip Zod validation entirely.                                  │
//   │     → Export `process.env` cast to the schema type.                  │
//   │     → Lets `next build` collect page data for /api/* routes          │
//   │       WITHOUT crashing on missing runtime secrets.                   │
//   │                                                                      │
//   │   NO (runtime: Vercel serverless, `bun run dev`)                     │
//   │     → Run `envSchema.safeParse(process.env)`.                        │
//   │     → Throw a descriptive `EnvValidationError` listing ALL gaps.     │
//   │     → Fails fast & loud — long before a cryptic 500 surfaces.        │
//   └──────────────────────────────────────────────────────────────────────┘
//
// ## Why this pattern?
//
// Next.js `next build` statically analyzes route modules to collect page
// data. During this phase, runtime secrets (DATABASE_URL, NEXTAUTH_SECRET,
// etc.) are NOT injected on Vercel. Eagerly validating them at import time
// would crash the build with `Failed to collect page data for /api/auth/login`.
//
// The `SKIP_ENV_VALIDATION=1` flag is set in the `vercel-build` npm script
// (see package.json), so the build phase skips validation entirely. At
// runtime — when Vercel injects the real env vars — the flag is absent and
// the full Zod validation runs.
//
// ## Usage
//
//   import { env, requireEnv } from '@/lib/env';
//   const url = env.DATABASE_URL;            // validated at import (runtime)
//   const secret = requireEnv('JWT_SECRET'); // enforced at request time
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
const envSchema = z.object({
  // Database — required. The db.ts module does the richer Neon/Supabase
  // pooling validation; here we just confirm presence.
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required (use the Neon/Supabase POOLED connection string).'),

  // NextAuth — NEXTAUTH_URL is the canonical public URL of the deployment.
  NEXTAUTH_URL: z
    .string()
    .url('NEXTAUTH_URL must be a valid URL (e.g. https://mbumah-hardware-pos.vercel.app).')
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

// ── Build-phase detection (legacy compat, kept for downstream callers) ──────
//
// `isBuildTime` is still exported for any code that branched on the old
// NEXT_RUNTIME heuristic. Under the SKIP_ENV_VALIDATION pattern the build
// phase is determined by the env flag, but we keep this helper for
// backwards compatibility with existing call sites.
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

// ── Validation (eager, runs at import time — runtime only) ───────────────────

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
  //
  // The `vercel-build` npm script sets `SKIP_ENV_VALIDATION=1`, so during
  // `next build` we skip the Zod parse entirely and export `process.env`
  // cast to the schema type. This is what allows `next build` to collect
  // page data for /api/auth/login (and every other route that transitively
  // imports this module) WITHOUT crashing on missing runtime secrets.
  //
  // Layer 2: Next.js automatically sets `NEXT_PHASE=phase-production-build`
  // during `next build` and `phase-instrumentation` during instrumentation.
  // Detecting these makes `next build` work EVEN IF the caller forgets to
  // prefix `SKIP_ENV_VALIDATION=1` — Next.js itself signals the build phase.
  //
  // At runtime (Vercel serverless, `bun run dev`) both flags are absent, so
  // the full Zod `safeParse` runs and throws on any gap.
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

/**
 * The validated environment. Access properties directly:
 *   env.DATABASE_URL    // string (guaranteed present at runtime)
 *   env.NEXTAUTH_URL    // string | undefined
 *   env.NEXTAUTH_SECRET // string | undefined
 *   env.JWT_SECRET      // string | undefined
 *   env.NODE_ENV        // 'development' | 'test' | 'production'
 *
 * At build time (SKIP_ENV_VALIDATION=1) this is an unvalidated `process.env`
 * cast (see `validateEnv`). At runtime it is fully Zod-validated.
 */
export const env: Env = validateEnv();

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
  const value = env[key];
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
export const isProduction = env.NODE_ENV === 'production';

/**
 * True when running in the Vitest test suite. Used to relax eager env
 * validation in test contexts where the full env isn't set up.
 */
export const isTest = env.NODE_ENV === 'test';
