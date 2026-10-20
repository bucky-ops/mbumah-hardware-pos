import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * session-idle-v2162 — v2.162.0 — the portal's thirty minutes.
 *
 * The spec's two idle-timeout questions are finally BOTH answered:
 *   line 843.6 "Does idle timeout protect unattended tills AND potentially
 *   employee self-service sessions?" — the till half shipped in v2.6.0,
 *   the portal half ships here.
 *   line 1068.7 "Can self-service REUSE auth and idle timeout safely?" —
 *   yes: the same 30-minute cadence, the same client hook (literally
 *   imported), enforced server-side where a client timer can be dodged,
 *   and scoped to the self-service surface so till behaviour is untouched.
 *
 * Layers under test:
 *  1. src/lib/session-idle.ts — the pure contract (idleExpired degrades
 *     honestly: no stamp / garbage stamp → NOT expired, never a lockout
 *     invented from missing data; boundary is >= the window, matching the
 *     till's setTimeout which fires AT 30 minutes).
 *  2. The API guard (selfServiceGuard) — 401 SESSION_IDLE_EXPIRED +
 *     session-row DELETE when expired; lastActiveAt SLIDE when fresh.
 *  3. The SSR guard (loadSelfPortal) — the idle note renders instead of
 *     employee data, same delete, same slide.
 *  4. The client watch (SelfServiceIdleWatch) — imports the SAME
 *     useIdleTimeout hook, POSTs /api/auth/logout, alertdialog overlay
 *     with Sign in as the only action.
 *  5. The auth readers now surface sessionId + lastActiveAt (optional, the
 *     mustChangePassword legacy-mock precedent).
 *  6. The till is UNTOUCHED — main-app keeps its v2.6.0 contract and never
 *     imports the new module (surface-scoped by construction).
 *  7. The docs answer the spec questions in the contract's own words.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

import { idleExpired, SELF_SERVICE_IDLE_MS } from '@/lib/session-idle';

const idleModule = readRepo('src/lib/session-idle.ts');
const authLib = readRepo('src/lib/auth.ts');
const selfService = readRepo('src/lib/hr/self-service.ts');
const selfPortal = readRepo('src/app/(selfservice)/employees/me/self-portal.tsx');
const idleWatch = readRepo('src/components/hr/self-service-idle-watch.tsx');
const providers = readRepo('src/lib/providers-selfservice.tsx');
const mainApp = readRepo('src/components/app/main-app.tsx');
const selfServiceDoc = readRepo('docs/hr/self-service.md');

const MIN = 60 * 1000;

describe('the pure idle contract', () => {
  it('keeps the SAME 30-minute cadence the till has used since v2.6.0', () => {
    expect(SELF_SERVICE_IDLE_MS).toBe(30 * MIN);
    expect(idleModule).toMatch(/export const SELF_SERVICE_IDLE_MS = 30 \* 60 \* 1000/);
  });

  it('is NOT expired before the window', () => {
    const now = new Date('2026-10-20T10:00:00Z');
    expect(idleExpired(new Date('2026-10-20T09:59:59Z'), now)).toBe(false);
    expect(idleExpired(new Date(now.getTime() - 29 * MIN), now)).toBe(false);
  });

  it('IS expired at exactly the window (>= boundary, like the till timer firing AT 30 min)', () => {
    const now = new Date('2026-10-20T10:00:00Z');
    expect(idleExpired(new Date(now.getTime() - 30 * MIN), now)).toBe(true);
    expect(idleExpired(new Date(now.getTime() - 31 * MIN), now)).toBe(true);
  });

  it('degrades honestly: no stamp or garbage stamp never invents a lockout', () => {
    const now = new Date('2026-10-20T10:00:00Z');
    // Legacy rows (pre-v2.162.0) carry no stamp — degrade to absolute-expiry behaviour.
    expect(idleExpired(null, now)).toBe(false);
    expect(idleExpired(undefined, now)).toBe(false);
    // Garbage dates are unreadable, not ancient — the attendance-desk posture.
    expect(idleExpired(new Date('not-a-date'), now)).toBe(false);
    expect(idleExpired('garbage', now)).toBe(false);
  });

  it('accepts ISO strings (the serialization the wire uses) and honours a custom window', () => {
    const now = new Date('2026-10-20T10:00:00Z');
    expect(idleExpired('2026-10-20T09:00:00Z', now)).toBe(true); // 60 min idle
    expect(idleExpired('2026-10-20T09:30:00Z', now)).toBe(true); // exactly 30 min
    expect(idleExpired('2026-10-20T09:45:00Z', now)).toBe(false); // 15 min — still fresh
    // A 15-minute surface window (if a future caller needs a tighter lens).
    expect(idleExpired(new Date(now.getTime() - 16 * MIN), now, 15 * MIN)).toBe(true);
    expect(idleExpired(new Date(now.getTime() - 14 * MIN), now, 15 * MIN)).toBe(false);
  });

  it('is pure: takes now as a parameter (zero clock reads in the module)', () => {
    expect(idleModule).toMatch(/export function idleExpired\(/);
    expect(idleModule).not.toMatch(/Date\.now\(/);
    expect(idleModule).not.toMatch(/new Date\(\)/);
    expect(idleModule).toContain("export const SESSION_IDLE_EXPIRED_CODE = 'SESSION_IDLE_EXPIRED'");
  });

  it('ships the 401 shape: stable code, human sentence', () => {
    expect(idleModule).toMatch(/SESSION_IDLE_EXPIRED_CODE = 'SESSION_IDLE_EXPIRED'/);
    expect(idleModule).toMatch(/Signed out after 30 minutes of inactivity/);
    expect(idleModule).toMatch(/status: 401/);
  });
});

describe('the auth readers surface the idle fields', () => {
  it('AuthSession gains optional sessionId + lastActiveAt (the mustChangePassword precedent)', () => {
    expect(authLib).toMatch(/sessionId\?: string;/);
    expect(authLib).toMatch(/lastActiveAt\?: Date;/);
  });

  it('BOTH real readers populate them from the Session row', () => {
    const populated = authLib.match(/mustChangePassword: session\.user\.mustChangePassword,\n    sessionId: session\.id,\n    lastActiveAt: session\.lastActiveAt,/g);
    expect(populated?.length ?? 0).toBe(2); // getSessionFromRequest + getSessionFromCookies
  });
});

describe('the API guard enforces the window server-side', () => {
  it('checks idleExpired with the shared constant BEFORE any data flows', () => {
    expect(selfService).toMatch(
      /idleExpired\(session\.lastActiveAt, new Date\(\), SELF_SERVICE_IDLE_MS\)/,
    );
  });

  it('deletes the session row on expiry (the cookie cannot be replayed)', () => {
    const guard = selfService.slice(selfService.indexOf('export function selfServiceGuard'));
    expect(guard).toMatch(/db\.session\s*\n\s*\.delete\(\{\s*where:\s*\{\s*id:\s*session\.sessionId\s*\}\s*\}\)/);
    expect(guard).toMatch(/sessionIdleExpiredResponse\(\)/);
  });

  it('slides lastActiveAt on every fresh self-service request (a sliding window)', () => {
    const guard = selfService.slice(selfService.indexOf('export function selfServiceGuard'));
    expect(guard).toMatch(/data:\s*\{\s*lastActiveAt:\s*new Date\(\)\s*\}/);
  });
});

describe('the SSR portal guard renders the honest idle note', () => {
  it('idle-expired page render shows "Signed out for your safety" instead of employee data', () => {
    expect(selfPortal).toContain('Signed out for your safety');
    expect(selfPortal).toMatch(/This portal closes after 30 minutes of inactivity/);
    expect(selfPortal).toMatch(/idleExpired\(session\.lastActiveAt, new Date\(\), SELF_SERVICE_IDLE_MS\)/);
  });

  it('deletes the row AND slides it on the same terms as the API guard', () => {
    expect(selfPortal).toMatch(/db\.session\s*\n\s*\.delete\(\{\s*where:\s*\{\s*id:\s*session\.sessionId\s*\}\s*\}\)/);
    expect(selfPortal).toMatch(/data:\s*\{\s*lastActiveAt:\s*new Date\(\)\s*\}/);
  });

  it('the note offers Sign in (the PortalNote affordance, consistent with the other gates)', () => {
    const idleBlock = selfPortal.slice(selfPortal.indexOf('THE THIRTY-MINUTE CONTRACT'));
    expect(idleBlock).toContain('showSignIn');
    expect(idleBlock).toContain('<Clock');
  });
});

describe('the client watch reuses the till hook literally', () => {
  it('imports the SAME useIdleTimeout the POS shell uses', () => {
    expect(idleWatch).toContain("import { useIdleTimeout } from '@/hooks/use-idle-timeout';");
    expect(idleWatch).toMatch(/useIdleTimeout\(handleIdleTimeout\)/);
  });

  it('kills the server session on timeout (client and server agree — no zombie cookie)', () => {
    expect(idleWatch).toMatch(/fetch\('\/api\/auth\/logout',\s*\{\s*method:\s*'POST',\s*keepalive:\s*true\s*\}\)/);
  });

  it('the overlay is an alertdialog whose only action is Sign in', () => {
    expect(idleWatch).toMatch(/role="alertdialog"/);
    expect(idleWatch).toMatch(/aria-modal="true"/);
    expect(idleWatch).toMatch(/aria-labelledby="self-idle-title"/);
    expect(idleWatch).toMatch(/aria-describedby="self-idle-hint"/);
    expect(idleWatch).toMatch(/data-testid="self-idle-signin"/);
  });

  it('moves focus into the dialog when it opens', () => {
    expect(idleWatch).toMatch(/headingRef\.current\?\.focus\(\)/);
  });
});

describe('mounting + surface scoping (the "safely" part)', () => {
  it('the watch is mounted ONCE in the slim portal providers', () => {
    expect(providers).toContain('<SelfServiceIdleWatch />');
    expect(providers).toContain("from '@/components/hr/self-service-idle-watch'");
  });

  it('the till keeps its v2.6.0 contract and NEVER imports the new module', () => {
    expect(mainApp).toContain("useIdleTimeout(handleIdleTimeout)");
    expect(mainApp).toContain("mbt:session-expired");
    expect(mainApp).not.toContain('session-idle');
    expect(mainApp).not.toContain('SELF_SERVICE_IDLE_MS');
  });

  it('the self-service guard is the only API surface with the idle check (till API untouched)', () => {
    // The idle check lives in selfServiceGuard only — not in getSessionFromRequest
    // (which serves every surface) and not in any till-side guard.
    const authGuardSection = authLib.slice(authLib.indexOf('export async function getSessionFromRequest'));
    expect(authGuardSection).not.toMatch(/idleExpired/);
    expect(selfService).toMatch(/export function selfServiceGuard/);
  });
});

describe('the docs answer the spec in the contract section', () => {
  it('docs/hr/self-service.md carries the thirty-minute contract', () => {
    expect(selfServiceDoc).toContain('## The thirty-minute contract (v2.162.0)');
    expect(selfServiceDoc).toMatch(/843\.6/);
    expect(selfServiceDoc).toMatch(/1068\.7/);
    expect(selfServiceDoc).toMatch(/SELF_SERVICE_IDLE_MS/);
    expect(selfServiceDoc).toMatch(/SESSION_IDLE_EXPIRED/);
    expect(selfServiceDoc).toMatch(/surface-scoped/i);
  });

  it('the legacy-stamp degradation is documented (no stamp → not expired)', () => {
    expect(selfServiceDoc).toMatch(/missing or unparseable stamp as NOT/);
  });
});
