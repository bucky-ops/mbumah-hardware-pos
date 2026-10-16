import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.44.0 FIRST SIGN-IN PASSWORD ROTATION.
 *
 * Server gate (assertPasswordRotation, dependency-free): a session whose
 * user still owes a rotation may only reach the exempt allowlist; every
 * other path answers 403 PASSWORD_CHANGE_REQUIRED. `undefined` (legacy
 * session constructions) is treated as "no rotation pending".
 *
 * Strength rules (pure module): the four shop-floor rules the forced screen
 * renders as a live checklist and gates the submit button on.
 *
 * Wiring (static contracts): all three wrapper gates, login/me payload
 * surfacing, rotation semantics on create/reset/self-change, the four client
 * gates (root page, workspace gateway, login redirect skip, portal guard),
 * the mid-session flip event, and the admin surface.
 */

const db = vi.hoisted(() => ({
  session: { findUnique: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
  user: { findUnique: vi.fn() },
  securityEvent: { create: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
  systemLog: { create: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ db }));

import {
  assertPasswordRotation,
  isPasswordRotationExemptPath,
  PASSWORD_ROTATION_EXEMPT_PATHS,
  PASSWORD_CHANGE_REQUIRED_CODE,
  type AuthSession,
} from '@/lib/auth';
import { evaluatePasswordStrength, MIN_PASSWORD_LENGTH } from '@/lib/password-strength';

const ROOT = join(process.cwd(), 'src');

function fakeRequest(path: string): { url: string } {
  return { url: `http://localhost:3200${path}` };
}

function session(patch: Partial<AuthSession> = {}): AuthSession {
  return {
    userId: 'u1',
    email: 'cashier@mbumahhardware.co.ke',
    role: 'CASHIER',
    storeId: 'store-1',
    organizationId: 'org_mbumah',
    ...patch,
  };
}

describe('isPasswordRotationExemptPath', () => {
  it('allowlists the rotation endpoint itself + auth essentials', () => {
    expect(PASSWORD_ROTATION_EXEMPT_PATHS).toContain('/api/profile/password');
    expect(PASSWORD_ROTATION_EXEMPT_PATHS).toContain('/api/auth/me');
    expect(PASSWORD_ROTATION_EXEMPT_PATHS).toContain('/api/auth/logout');
    expect(PASSWORD_ROTATION_EXEMPT_PATHS).toContain('/api/security/csrf-token');
    expect(PASSWORD_ROTATION_EXEMPT_PATHS).toContain('/api/auth/verify');
    expect(PASSWORD_ROTATION_EXEMPT_PATHS).toContain('/api/client-error');
  });

  it('matches exact paths and suffixes but not prefixes of other routes', () => {
    expect(isPasswordRotationExemptPath('/api/auth/me')).toBe(true);
    expect(isPasswordRotationExemptPath('/api/auth/logout')).toBe(true);
    expect(isPasswordRotationExemptPath('/api/auth/me/sub')).toBe(true);
    // A path that merely STARTS with an allowlisted prefix must NOT pass.
    expect(isPasswordRotationExemptPath('/api/auth/metrics')).toBe(false);
    expect(isPasswordRotationExemptPath('/api/auth/login')).toBe(false);
    expect(isPasswordRotationExemptPath('/api/leaves')).toBe(false);
    expect(isPasswordRotationExemptPath('/api/users')).toBe(false);
  });
});

describe('assertPasswordRotation', () => {
  it('passes any route for a session with no rotation pending', () => {
    expect(assertPasswordRotation(fakeRequest('/api/leaves'), session())).toBeNull();
    expect(assertPasswordRotation(fakeRequest('/api/pos/checkout'), session({ mustChangePassword: false }))).toBeNull();
  });

  it('treats undefined (legacy session constructions) as no rotation pending', () => {
    const legacy = session();
    delete (legacy as Partial<AuthSession>).mustChangePassword;
    expect(assertPasswordRotation(fakeRequest('/api/leaves'), legacy)).toBeNull();
  });

  it('blocks non-exempt routes with 403 + PASSWORD_CHANGE_REQUIRED', () => {
    for (const path of ['/api/leaves', '/api/users', '/api/pos/checkout', '/api/me/store-context']) {
      const res = assertPasswordRotation(fakeRequest(path), session({ mustChangePassword: true }));
      if (!res) throw new Error(`expected a 403 response for ${path}`);
      expect(res.status).toBe(403);
    }
  });

  it('lets the rotation itself + auth essentials through while flagged', () => {
    for (const path of PASSWORD_ROTATION_EXEMPT_PATHS) {
      expect(assertPasswordRotation(fakeRequest(path), session({ mustChangePassword: true })), path).toBeNull();
    }
  });

  it('the 403 body carries the exact code the client listens for', async () => {
    const res = assertPasswordRotation(fakeRequest('/api/leaves'), session({ mustChangePassword: true }));
    if (!res) throw new Error('expected a 403 response for /api/leaves');
    const body = (await res.json()) as { code?: string; success?: boolean };
    expect(body.code).toBe(PASSWORD_CHANGE_REQUIRED_CODE);
    expect(body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect(body.success).toBe(false);
  });
});

describe('evaluatePasswordStrength', () => {
  it('enforces the four shop-floor rules in order', () => {
    const s = evaluatePasswordStrength('Ab1!');
    expect(s.score).toBe(3); // short: length rule fails, other three pass
    expect(s.label).toBe('Too short');
    expect(s.rules.map((r) => r.ok)).toEqual([false, true, true, true]);
    expect(MIN_PASSWORD_LENGTH).toBe(8);
  });

  it('scores monotonic passwords from weak to strong', () => {
    expect(evaluatePasswordStrength('passwor').label).toBe('Too short'); // 7 chars
    expect(evaluatePasswordStrength('passwordlong').score).toBe(1);
    expect(evaluatePasswordStrength('Passwordlong').score).toBe(2);
    expect(evaluatePasswordStrength('Passwordlong1').score).toBe(3);
    expect(evaluatePasswordStrength('Passwordlong1!').score).toBe(4);
    expect(evaluatePasswordStrength('Passwordlong1!').label).toBe('Strong'); // 14 chars, all rules
  });

  it('labels 12+ char all-rules passwords as Strong', () => {
    expect(evaluatePasswordStrength('Str0ng!Passphrase').label).toBe('Strong');
    expect(evaluatePasswordStrength('Str0ng!Pa55').label).toBe('Good'); // 11 chars
  });

  it('gates exactly what the screen requires (all four rules)', () => {
    const good = evaluatePasswordStrength('Harbor-Ember-42');
    expect(good.score).toBe(4);
    // The v2.41.0 temp-password shape always satisfies every rule.
    const temp = evaluatePasswordStrength('Cedar-Wilow-83');
    expect(temp.score).toBe(4);
  });
});

describe('wiring: server payloads + rotation semantics (static contracts)', () => {
  const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

  it('all three wrappers gate on assertPasswordRotation', () => {
    const auth = read('lib/auth.ts');
    const sites = auth.split('assertPasswordRotation(request, session)').length - 1;
    expect(sites).toBeGreaterThanOrEqual(3); // requireAuth + withSessionAuth + requireStoreAccess
  });

  it('login and me surface the flag to the client', () => {
    expect(read('app/api/auth/login/route.ts')).toContain('mustChangePassword: user.mustChangePassword');
    expect(read('app/api/auth/me/route.ts')).toContain('mustChangePassword: user.mustChangePassword');
  });

  it('create user defaults rotation ON; self-change clears it; admin reset forces it', () => {
    expect(read('app/api/users/route.ts')).toContain('mustChangePassword: mustChangePassword ?? true');
    expect(read('app/api/profile/password/route.ts')).toContain('mustChangePassword: false');
    expect(read('app/api/users/[id]/route.ts')).toContain('data.mustChangePassword = mustChangePassword ?? true');
  });

  it('the schema column + migration exist', () => {
    expect(readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')).toContain('mustChangePassword');
    const mig = readFileSync(
      join(process.cwd(), 'prisma/migrations/20261017210000_add_user_must_change_password/migration.sql'),
      'utf8',
    );
    expect(mig).toContain('ADD COLUMN "mustChangePassword"');
  });
});

describe('wiring: client gates (static contracts)', () => {
  const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

  it('root page renders the forced screen before any shell', () => {
    const page = read('app/(shell)/page.tsx');
    expect(page).toContain('if (rotationPending) return <ChangePasswordScreen />;');
    // The gate must sit BEFORE the MainApp return in the file.
    expect(page.indexOf('rotationPending) return')).toBeLessThan(page.indexOf('return isAuthenticated ? <MainApp />'));
  });

  it('branch workspace gateway mirrors the root gate', () => {
    const wg = read('components/workspace/workspace-gateway.tsx');
    expect(wg).toContain('if (isAuthenticated && rotationPending) return <ChangePasswordScreen />;');
    expect(wg.indexOf('isAuthenticated && rotationPending) return')).toBeLessThan(wg.indexOf("phase === 'login'"));
  });

  it('login screen skips the post-login redirect for flagged users', () => {
    expect(read('components/login-screen.tsx')).toContain('if (flaggedUser?.mustChangePassword) return;');
  });

  it('employee portal guard (RSC) renders the forced screen', () => {
    const sp = read('app/(selfservice)/employees/me/self-portal.tsx');
    expect(sp).toContain('if (session.mustChangePassword)');
    expect(sp).toContain('<ChangePasswordScreen />');
  });

  it('api.ts dispatches the flip event on the 403 code; the store listens', () => {
    const api = read('lib/api.ts');
    expect(api).toContain("rotationBody?.code === 'PASSWORD_CHANGE_REQUIRED'");
    expect(api).toContain("new CustomEvent('mbt:password-change-required')");
    expect(read('lib/stores.ts')).toContain("window.addEventListener('mbt:password-change-required'");
  });

  it('AuthUser type carries the optional flag', () => {
    expect(read('lib/types.ts')).toContain('mustChangePassword?: boolean');
  });

  it('admin surface: switch, force-reset action, violet badge', () => {
    const admin = read('app/(shell)/tabs/admin-tab.tsx');
    expect(admin).toContain('Require password change at first sign-in');
    expect(admin).toContain('forceResetMutation');
    expect(admin).toContain('Rotation due');
  });

  it('create-&-link dialog sends the flag and the desk chip got its tooltip', () => {
    const payroll = read('app/(shell)/tabs/payroll-tab.tsx');
    expect(payroll).toContain('mustChangePassword: form.mustChangePassword !== false');
    expect(payroll).toContain('Corrected by {l.editedByName}');
    expect(payroll).toContain('{l.editNote ? (');
  });
});
