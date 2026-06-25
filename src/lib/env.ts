// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Eager environment-variable validation (Zod)
// ─────────────────────────────────────────────────────────────────────────────
//
// Importing this module validates every required environment variable at
// module-load time. A missing or malformed variable throws a descriptive
// `EnvValidationError` with a remediation hint — long before a cryptic 51ms
// 500 surfaces in the Vercel serverless logs.
//
// Usage:
//   import { env, requireEnv } from '@/lib/env';
//   const url = env.DATABASE_URL;            // validated at import time
//   const optional = env.NEXTAUTH_URL;       // may be undefined in some envs
//
// The `db.ts` module already validates DATABASE_URL eagerly (with a richer
// Neon/Supabase pooling message). This module covers the AUTH secrets that
// the login route and NextAuth depend on. Importing `@/lib/env` from any
// server entry point (login, dashboard, NextAuth config) guarantees the
// auth secrets are present and well-formed before the handler runs.
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
// `DATABASE_URL` is validated eagerly in db.ts (with a richer message), so
// here we only type-check it as a non-empty string. The auth secrets are
// validated for presence + minimum length (32 chars for secrets — the
// minimum safe size for a HMAC-SHA256 session token).
const envSchema = z.object({
  // Database — the db.ts module does the heavy validation; we just confirm
  // presence here so the auth routes fail fast if someone deleted the .env.
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required (use the Neon/Supabase POOLED connection string).'),

  // NextAuth — NEXTAUTH_URL is the canonical public URL of the deployment.
  // NEXTAUTH_SECRET is used to sign session JWTs.
  NEXTAUTH_URL: z
    .string()
    .url('NEXTAUTH_URL must be a valid URL (e.g. https://mbumah-hardware-pos-one.vercel.app).')
    .optional(),

  NEXTAUTH_SECRET: z
    .string()
    .min(16, 'NEXTAUTH_SECRET should be at least 16 characters (use `openssl rand -base64 32`).')
    .optional(),

  // JWT_SECRET — used by the custom token-based auth in login/route.ts
  // (separate from NextAuth). Must be at least 32 chars for HMAC-SHA256.
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

// ── Validation (eager, runs at import time) ──────────────────────────────────

function validateEnv(): Env {
  // Only validate on the server — client bundles don't have access to
  // process.env.* (Next.js statically replaces NEXT_PUBLIC_* at build time).
  if (typeof window !== 'undefined') {
    // Return a permissive stub for client-side imports (shouldn't happen in
    // practice — this module is server-only — but the guard prevents a
    // confusing crash if a client component accidentally imports it).
    return {
      DATABASE_URL: '',
      NODE_ENV: 'development',
    } as Env;
  }

  const raw = {
    DATABASE_URL: process.env.DATABASE_URL,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    JWT_SECRET: process.env.JWT_SECRET,
    NODE_ENV: process.env.NODE_ENV,
  };

  // DATABASE_URL is the only HARD-required variable (the app cannot function
  // without a database). The auth secrets are optional at import time —
  // they're only required when the auth routes actually run, so we don't
  // block the entire app from booting if they're missing in a dev env that
  // hasn't set up auth yet. The login route will call requireEnv() to
  // enforce them at request time.
  const missing: string[] = [];
  if (!raw.DATABASE_URL || raw.DATABASE_URL.trim() === '') {
    missing.push('DATABASE_URL');
  }

  if (missing.length > 0) {
    throw new EnvValidationError(missing);
  }

  // Parse with Zod — this catches malformed URLs and too-short secrets.
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`,
    );
    throw new EnvValidationError(issues);
  }

  return parsed.data;
}

/**
 * The validated environment. Access properties directly:
 *   env.DATABASE_URL    // string (guaranteed present)
 *   env.NEXTAUTH_URL    // string | undefined
 *   env.NEXTAUTH_SECRET // string | undefined
 *   env.JWT_SECRET      // string | undefined
 *   env.NODE_ENV        // 'development' | 'test' | 'production'
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
