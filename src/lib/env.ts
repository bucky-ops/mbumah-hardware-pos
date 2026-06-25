// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Build-aware environment-variable validation (Zod)
// ─────────────────────────────────────────────────────────────────────────────
//
// This module validates required environment variables at module-load time,
// BUT it is **build-aware**: during `next build` (when `NEXT_RUNTIME` is
// undefined), validation is SKIPPED so the build doesn't crash on missing
// runtime secrets (NEXTAUTH_SECRET, DATABASE_URL, etc.).
//
// At runtime (Vercel serverless, `bun run dev`), a full `envSchema.safeParse`
// runs and throws a descriptive `EnvValidationError` on failure — long before
// a cryptic 500 surfaces in the logs.
//
// ## Why skip at build time?
//
// Next.js sets `process.env.NEXT_RUNTIME` to `'nodejs'` or `'edge'` ONLY inside
// the actual server runtime. During `next build` (static page-data collection,
// route analysis, type-checking), `NEXT_RUNTIME` is `undefined`. Runtime
// secrets are NOT injected at build time on Vercel, so eagerly validating them
// during the build phase would always fail and crash the deployment.
//
// Usage:
//   import { env, requireEnv } from '@/lib/env';
//   const url = env.DATABASE_URL;            // validated at import time (runtime)
//   const secret = requireEnv('JWT_SECRET'); // enforced at request time
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
        '  • NEXTAUTH_URL: the canonical app URL (e.g. https://mbumah-hardware-pos-one.vercel.app).',
        '  • DATABASE_URL: Neon/Supabase POOLED connection string',
        '                (append ?pgbouncer=true&connection_limit=1).',
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
    .url('NEXTAUTH_URL must be a valid URL (e.g. https://mbumah-hardware-pos-one.vercel.app).')
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
// Next.js sets `process.env.NEXT_RUNTIME` to `'nodejs'` or `'edge'` ONLY inside
// the actual server runtime. During `next build` (static page-data collection,
// route analysis), `NEXT_RUNTIME` is `undefined`. We use this to skip eager
// validation at build time — otherwise a missing `NEXTAUTH_SECRET` would crash
// the Vercel build even though the secret IS present at runtime.
export const isBuildTime = typeof process.env.NEXT_RUNTIME === 'undefined';

// ── Validation (eager, runs at import time — runtime only) ───────────────────

function validateEnv(): Env {
  // Client bundle guard — this module is server-only, but prevent a
  // confusing crash if a client component accidentally imports it.
  if (typeof window !== 'undefined') {
    return {
      DATABASE_URL: '',
      NODE_ENV: 'development',
    } as Env;
  }

  // ── BUILD PHASE: skip validation. ──────────────────────────────────────────
  //
  // Runtime secrets (DATABASE_URL, NEXTAUTH_SECRET, etc.) are NOT available
  // during `next build` on Vercel. Validating here would always fail and
  // crash the build. We export `process.env` cast to the schema type so
  // TypeScript stays satisfied; the real validation runs at runtime when
  // `NEXT_RUNTIME` is defined.
  if (isBuildTime) {
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
 * At build time this is an unvalidated `process.env` cast (see `validateEnv`).
 * At runtime it is fully Zod-validated.
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
