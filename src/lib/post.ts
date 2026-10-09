// MBUMAH HARDWARE POS - Power-On Self-Test (POST, v2.14.0)
//
// A dependency-free, SSR-safe boot diagnostic battery. Every check is
// individually try/catch wrapped so one failure never prevents the remaining
// checks (or the caller) from running. Nothing is cached: every call probes
// live state so the report is always current.
//
//   c1 database connectivity (raw SELECT 1)
//   c2 core tables exist (User/Organization/Store/Product counts, P2021/P2022 aware)
//   c3 prisma client operational (model query executes end to end)
//   c4 required env vars (auth secrets WARN in development, FAIL in production)
//   c5 at least one store exists
//   c6 product catalog present (WARN when empty so a fresh DB is not "PASS")
//   c7 engraved bootstrap admin resolvable (self-heal probe)
//
// Overall: FAIL when a required check fails, DEGRADED on any WARN (or an
// optional failure), PASS otherwise.

import { db, runWithoutTenant } from '@/lib/db';
import { APP_VERSION } from '@/lib/version';
import { ensureEngravedAdminExists, ENGRAVED_ADMIN } from '@/lib/engraved-admin';

export type PostCheckStatus = 'PASS' | 'FAIL' | 'WARN';
export type PostOverallStatus = 'PASS' | 'FAIL' | 'DEGRADED';

export interface PostCheck {
  id: string;
  label: string;
  status: PostCheckStatus;
  detail?: string;
  required: boolean;
}

export interface PostReport {
  status: PostOverallStatus;
  version: string;
  timestamp: string;
  durationMs: number;
  checks: PostCheck[];
}

interface CheckOutcome {
  status: PostCheckStatus;
  detail: string;
}

/** True when the process boots in production (stricter gates apply). */
function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/** Extract a Prisma known-error code (P2021 = table missing, P2022 = column missing). */
function prismaErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return '';
}

/** Bounded, single-line error detail (never leaks more than 160 chars). */
function errorDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, ' ').slice(0, 160);
}

/**
 * Run one check inside its own try/catch. A throwing check degrades to FAIL
 * (or WARN when optional) with the error text as detail - it never rejects.
 */
async function safeCheck(
  id: string,
  label: string,
  required: boolean,
  fn: () => Promise<CheckOutcome>
): Promise<PostCheck> {
  try {
    const outcome = await fn();
    return { id, label, status: outcome.status, detail: outcome.detail, required };
  } catch (error) {
    const code = prismaErrorCode(error);
    const schemaDrift = code === 'P2021' || code === 'P2022';
    const detail = schemaDrift
      ? `Schema drift detected (Prisma ${code}): run prisma db push / migrations.`
      : errorDetail(error);
    return { id, label, status: required ? 'FAIL' : 'WARN', detail, required };
  }
}

export async function runPostChecks(): Promise<PostReport> {
  const startedAt = Date.now();
  const checks: PostCheck[] = [];
  const production = isProduction();

  // c1 - database connectivity (raw query, provider-agnostic).
  checks.push(
    await safeCheck('database', 'Database connectivity', true, async () => {
      const started = Date.now();
      await db.$queryRaw`SELECT 1`;
      const ms = Date.now() - started;
      return { status: 'PASS', detail: `Raw query ok (${ms}ms).` };
    })
  );

  // c2 - core tables exist. Row counts prove the tables (and columns) are
  // really there; P2021/P2022 mean the deployed schema is behind the code.
  checks.push(
    await safeCheck('core-tables', 'Core tables (User, Organization, Store, Product)', true, async () => {
      const [users, organizations, stores, products] = await runWithoutTenant(() =>
        Promise.all([
          db.user.count(),
          db.organization.count(),
          db.store.count(),
          db.product.count(),
        ])
      );
      return {
        status: 'PASS',
        detail: `users=${users}, organizations=${organizations}, stores=${stores}, products=${products}.`,
      };
    })
  );

  // c3 - prisma client operational (a real model round-trip).
  checks.push(
    await safeCheck('prisma-client', 'Prisma client operational', true, async () => {
      const users = await db.user.count();
      return { status: 'PASS', detail: `Client query executed (users=${users}).` };
    })
  );

  // c4 - required environment. DATABASE_URL missing is always fatal; auth
  // secrets are FAIL in production, WARN in development.
  checks.push(
    await safeCheck('env-vars', 'Environment configuration', true, async () => {
      const missing: string[] = [];
      const warnings: string[] = [];
      if (!process.env.DATABASE_URL) missing.push('DATABASE_URL');
      if (!process.env.DIRECT_URL) warnings.push('DIRECT_URL (needed for PostgreSQL production)');
      const hasAuthSecret = Boolean(process.env.NEXTAUTH_SECRET || process.env.JWT_SECRET);
      if (!hasAuthSecret) {
        if (production) missing.push('NEXTAUTH_SECRET or JWT_SECRET');
        else warnings.push('NEXTAUTH_SECRET or JWT_SECRET (auth secrets unset in development)');
      }
      if (missing.length > 0) {
        return { status: 'FAIL', detail: `Missing required: ${missing.join(', ')}.` };
      }
      if (warnings.length > 0) {
        return { status: 'WARN', detail: `Missing optional: ${warnings.join('; ')}.` };
      }
      return { status: 'PASS', detail: 'DATABASE_URL, DIRECT_URL and auth secrets are set.' };
    })
  );

  // c5 - at least one store exists (the POS cannot operate storeless).
  checks.push(
    await safeCheck('store-exists', 'At least one store exists', true, async () => {
      const storeCount = await runWithoutTenant(() => db.store.count());
      if (storeCount === 0) {
        return { status: 'FAIL', detail: 'No stores found. Run the seed or create a store.' };
      }
      return { status: 'PASS', detail: `${storeCount} store(s) present.` };
    })
  );

  // c6 - product catalog. Zero products is a WARN (fresh install), not a FAIL.
  checks.push(
    await safeCheck('product-count', 'Product catalog present', true, async () => {
      const productCount = await runWithoutTenant(() => db.product.count());
      if (productCount === 0) {
        return { status: 'WARN', detail: '0 products. Run the seed so the POS has a catalog.' };
      }
      return { status: 'PASS', detail: `${productCount} products in the catalog.` };
    })
  );

  // c7 - engraved bootstrap admin resolvable (probes the self-heal path).
  // A heal failure WARNs (the /api/system/heal endpoint can retry) instead of
  // hard-failing the whole boot report.
  checks.push(
    await safeCheck('engraved-admin', 'Engraved bootstrap admin resolvable', false, async () => {
      const result = await ensureEngravedAdminExists();
      if (result.reason.startsWith('error')) {
        return { status: 'WARN', detail: `Self-heal probe failed: ${result.reason}` };
      }
      const verb =
        result.reason === 'created'
          ? 'created'
          : result.reason === 'repaired'
            ? 'repaired'
            : 'found';
      return { status: 'PASS', detail: `${ENGRAVED_ADMIN.email} ${verb}.` };
    })
  );

  const requiredFail = checks.some((c) => c.required && c.status === 'FAIL');
  const anyFail = checks.some((c) => c.status === 'FAIL');
  const anyWarn = checks.some((c) => c.status === 'WARN');
  const status: PostOverallStatus = requiredFail ? 'FAIL' : anyFail || anyWarn ? 'DEGRADED' : 'PASS';

  return {
    status,
    version: APP_VERSION,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    checks,
  };
}
