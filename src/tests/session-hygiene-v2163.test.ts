// MBUMAH HARDWARE POS - session hygiene v2.163.0
//
// Two contracts, one release:
//   1. THE SESSION REAPER - /api/cron/session-reaper deletes auth sessions
//      whose expiresAt has passed, folded into the hourly dispatcher as the
//      sixth sub-job. Idle-expiry deletion stays the portal guard's own
//      enforcement path (v2.162.0); the reaper only owns sessions nobody
//      will ever present again.
//   2. THE DOOR SWINGS BACK - the idle sign-out's ?next= return path:
//      validated end-to-end (overlay → login screen), the same-origin
//      validator is pure, and the promise is spoken where the click
//      happens.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildPortalReturnHref,
  safeReturnPath,
} from '@/lib/session-idle';
import {
  sessionReaperSummary,
} from '@/lib/session-reaper';

const repo = (p: string) =>
  readFileSync(join(process.cwd(), p), 'utf8');

const reaperRoute = repo('src/app/api/cron/session-reaper/route.ts');
const dispatcher = repo('src/app/api/cron/hourly/route.ts');
const overlay = repo('src/components/hr/self-service-idle-watch.tsx');
const loginScreen = repo('src/components/login-screen.tsx');
const selfPortal = repo('src/app/(selfservice)/employees/me/self-portal.tsx');
const mathDoc = repo('docs/a11y/contrast-math.md');

describe('safeReturnPath - the paranoid ?next= validator', () => {
  it('accepts honest same-origin relative paths unchanged', () => {
    expect(safeReturnPath('/employees/me/payslips')).toBe(
      '/employees/me/payslips',
    );
    expect(safeReturnPath('/')).toBe('/');
    expect(safeReturnPath('/employees/me/goals?tab=history')).toBe(
      '/employees/me/goals?tab=history',
    );
  });

  it('rejects the classic open-redirect doors', () => {
    // Protocol-relative URLs leave the origin.
    expect(safeReturnPath('//evil.example/payslips')).toBeNull();
    // Scheme-like paths (javascript:, http:, data:) never pass - a colon
    // before the first slash is always a scheme in a path.
    expect(safeReturnPath('javascript:alert(1)')).toBeNull();
    expect(safeReturnPath('https://evil.example')).toBeNull();
    // Backslash tricks (some servers treat \ as /).
    expect(safeReturnPath('/\\evil.example')).toBeNull();
    expect(safeReturnPath('/employees\\me')).toBeNull();
  });

  it('rejects control characters and absurd lengths', () => {
    expect(safeReturnPath('/employees\r\nX-Injected: 1')).toBeNull();
    expect(safeReturnPath('/employees\x00')).toBeNull();
    expect(safeReturnPath(`/${'a'.repeat(600)}`)).toBeNull();
  });

  it('nothing offered is nothing returned - null is never an error', () => {
    expect(safeReturnPath(null)).toBeNull();
    expect(safeReturnPath(undefined)).toBeNull();
    expect(safeReturnPath('')).toBeNull();
  });
});

describe('buildPortalReturnHref - the sign-in link builder', () => {
  it('carries a safe path as the encoded ?next= parameter', () => {
    expect(buildPortalReturnHref('/employees/me/payslips')).toBe(
      '/?next=%2Femployees%2Fme%2Fpayslips',
    );
  });

  it('falls back to the plain login root when nothing safe was offered', () => {
    expect(buildPortalReturnHref(null)).toBe('/');
    expect(buildPortalReturnHref(undefined)).toBe('/');
    expect(buildPortalReturnHref('//evil.example')).toBe('/');
    expect(buildPortalReturnHref('javascript:alert(1)')).toBe('/');
  });
});

describe('sessionReaperSummary - the honest sweep summary', () => {
  it('speaks the count with honest plurals', () => {
    expect(sessionReaperSummary(1).message).toBe(
      'Reaped 1 expired session (its expiresAt had passed).',
    );
    expect(sessionReaperSummary(7).message).toBe(
      'Reaped 7 expired sessions (their expiresAt had passed).',
    );
    expect(sessionReaperSummary(7).ok).toBe(true);
  });

  it('a reaped-zero sweep is a SUCCESS and says so', () => {
    const zero = sessionReaperSummary(0);
    expect(zero.ok).toBe(true);
    expect(zero.message).toBe(
      'No expired sessions to reap - the session table is clean.',
    );
  });

  it('garbage counts degrade to the zero case - never an invented count', () => {
    expect(sessionReaperSummary(NaN).message).toBe(
      'No expired sessions to reap - the session table is clean.',
    );
    expect(sessionReaperSummary(-3).ok).toBe(true);
    expect(sessionReaperSummary(Infinity).message).not.toContain('Infinity');
  });
});

describe('the reaper route - the cron contract', () => {
  it('deletes ONLY by the indexed expiresAt column', () => {
    // lesson 49: strip comments before the scope assertion - the docstring
    // legitimately NAMES the idle column to explain why it is out of scope.
    const body = reaperRoute.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(body).toContain('db.session.deleteMany({');
    expect(body).toContain('where: { expiresAt: { lt: new Date() } }');
    // Idle expiry (lastActiveAt) stays the portal guard's contract - the
    // reaper must never grow a second opinion about who is idle.
    expect(body).not.toContain('lastActiveAt');
  });

  it('is a cross-tenant sweep behind the shared cron-secret gate', () => {
    expect(reaperRoute).toContain('runWithoutTenant(()');
    expect(reaperRoute).toContain("headers.get('x-cron-secret')");
    expect(reaperRoute).toContain('CRON_SECRET_UNSET');
    expect(reaperRoute).toContain('maxDuration = 60');
  });

  it('leaves an INFO ledger row on every completed sweep', () => {
    // The route carries the action by NAME (the literal lives in the lib).
    expect(reaperRoute).toContain('SESSION_REAPER_LOG_ACTION');
    expect(reaperRoute).toContain('LogSeverity.INFO');
    expect(reaperRoute).toContain('sessionReaperSummary(result.count)');
  });

  it('is folded into the hourly dispatcher as the sixth sub-job', () => {
    expect(dispatcher).toContain("import { GET as sessionReaperGET } from '@/app/api/cron/session-reaper/route';");
    expect(dispatcher).toContain("{ name: 'session-reaper', run: () => sessionReaperGET(request) }");
    // The dispatcher's ledger counts the reaper like any sibling.
    expect(dispatcher).toContain("'b2c-recovery'");
    expect(dispatcher).toContain("'session-reaper'");
  });
});

describe('the idle overlay - the client half of the return path', () => {
  it('remembers where the colleague was reading, at timeout time', () => {
    expect(overlay).toContain('setReturnPath(window.location.pathname)');
    // Safe by construction: only ever set from the client timer callback.
    expect(overlay.split('handleIdleTimeout = useCallback')[1]).toContain(
      'setReturnPath(window.location.pathname)',
    );
  });

  it('builds the sign-in href through the validated builder', () => {
    expect(overlay).toContain('href={buildPortalReturnHref(returnPath)}');
    expect(overlay).toContain("import {\n  buildPortalReturnHref,\n} from '@/lib/session-idle';");
  });

  it('speaks the promise where the click happens', () => {
    expect(overlay).toContain('data-testid="self-idle-return-hint"');
    expect(overlay).toContain('Signing in brings you straight back to this page.');
  });
});

describe('the portal notes - the server half of the return path', () => {
  it('PortalNote carries returnPath and the same hint', () => {
    expect(selfPortal).toContain('returnPath?: string;');
    expect(selfPortal).toContain('href={buildPortalReturnHref(returnPath)}');
    expect(selfPortal).toContain('Signing in brings you straight back to this page.');
  });

  it('loadSelfPortal accepts the page path and feeds both sign-in notes', () => {
    expect(selfPortal).toContain('portalPath?: string,');
    const body = selfPortal.split('export async function loadSelfPortal')[1];
    expect(body).toContain('returnPath={portalPath}');
  });

  it('every portal page caller names its own path', () => {
    const pages: Array<[string, string]> = [
      ['payslips/page.tsx', "loadSelfPortal('hr.payroll.read.own', '/employees/me/payslips')"],
      ['attendance/page.tsx', "loadSelfPortal('hr.attendance.record.own', '/employees/me/attendance')"],
      ['leave/page.tsx', "loadSelfPortal('hr.leave.read.own', '/employees/me/leave')"],
      ['goals/page.tsx', "loadSelfPortal('hr.performance.read.own', '/employees/me/goals')"],
      ['documents/page.tsx', "loadSelfPortal('hr.documents.read.own', '/employees/me/documents')"],
      ['page.tsx', "loadSelfPortal('hr.payroll.read.own', '/employees/me')"],
    ];
    for (const [file, pin] of pages) {
      expect(repo(`src/app/(selfservice)/employees/me/${file}`)).toContain(pin);
    }
  });
});

describe('the login screen - next wins, safely', () => {
  it('reads ?next= at submit time from the real location', () => {
    expect(loginScreen).toContain("new URLSearchParams(window.location.search).get('next')");
    expect(loginScreen).toContain('safeReturnPath(nextParam) ?? postLoginRedirect(flaggedUser)');
    expect(loginScreen).toContain("import { safeReturnPath } from '@/lib/session-idle';");
  });

  it('the rotation checkpoint still gates before any redirect', () => {
    const handler = loginScreen.split('handleSubmit')[1].split('catch (err')[0];
    expect(handler.indexOf('mustChangePassword')).toBeGreaterThan(-1);
    expect(handler.indexOf('mustChangePassword')).toBeLessThan(
      handler.indexOf('safeReturnPath(nextParam)'),
    );
  });
});

describe('the contrast-math doc - the recipe lives in the repo', () => {
  it('names the three steps and the false-fail families', () => {
    expect(mathDoc).toContain('oklchToSrgb()');
    expect(mathDoc).toContain('scripts/contrast-audit-login.mjs');
    expect(mathDoc).toContain('Badges ignore the glass');
    expect(mathDoc).toContain('Outside-card text sits on the page');
  });

  it('the reference implementation is committed and parses', () => {
    const script = repo('scripts/contrast-audit-login.mjs');
    expect(script).toContain('function oklchToSrgb');
    expect(script).toContain('function contrast');
    expect(script).toContain('Exit 1 if any family fails its threshold.');
  });
});
