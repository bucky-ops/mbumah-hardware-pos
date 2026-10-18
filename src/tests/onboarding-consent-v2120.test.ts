import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.120.0 — "the roster captures its consent".
 *
 * Task 134's option 1, fully realized: onboarding-time consent capture.
 * The discovery that shaped the round: POST /api/hr/employees existed since
 * v2.113.x with NO UI surface at all — hiring happened only through raw API
 * calls (another dead-surface pattern, same family as v2.119.0's consent
 * records). And a fresh hire onboarded without a ConsentRecord would block
 * the next payroll run on MISSING_CONSENT forever.
 *
 *  1. OUTCOME INTERPRETER (pure): describeOnboardConsent folds the route's
 *     `consent` field into the three sentences the dialog can show —
 *     emerald granted / amber not-asked (with the MISSING_CONSENT truth) /
 *     rose failed (with the reason code). Garbage degrades honestly.
 *  2. ROUTE CONTRACTS: the POST files the consent through the SAME audited
 *     grantConsent path the Privacy tab uses (vocabulary rides the lib —
 *     never re-declared in the route); a consent glitch must never lose the
 *     hire (the 201 keeps its employee, the outcome turns rose); the GET
 *     surfaces canCreate through the SAME key the POST guard pins (the
 *     server decides who sees the door); withdrawal is never reachable from
 *     onboarding.
 *  3. PAGE CONTRACTS: the dialog exists, names its fields for tests and
 *     screen readers, wears the schema's employment-type vocabulary (no
 *     client invention), and the consent panel says the honest sentence.
 */

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const codeOf = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

import {
  describeOnboardConsent,
  ONBOARD_CONSENT_TONE_CLASSES,
} from '@/lib/hr/onboard-consent';

describe('describeOnboardConsent — the outcome interpreter (v2.120.0)', () => {
  it('granted reads like paperwork: emerald, policy version, grant date', () => {
    const out = describeOnboardConsent({
      granted: true,
      consentId: 'crid-1',
      purpose: 'PAYROLL_PROCESSING',
      policyVersion: 'hr-policy-2026-01',
      grantedAt: '2026-10-19T04:00:00.000Z',
    });
    expect(out.tone).toBe('emerald');
    expect(out.headline).toBe('Consent captured');
    expect(out.detail).toContain('hr-policy-2026-01');
    expect(out.detail).toContain('2026-10-19');
  });

  it('NOT_REQUESTED tells the MISSING_CONSENT truth (amber) — never a quiet success look-alike', () => {
    const out = describeOnboardConsent({ granted: false, reason: 'NOT_REQUESTED' });
    expect(out.tone).toBe('amber');
    expect(out.headline).toBe('No consent on file');
    expect(out.detail).toContain('MISSING_CONSENT');
    expect(out.detail).toContain('Privacy tab');
  });

  it('a failed grant stays rose and names the reason — the hire is on file, the consent is not', () => {
    const out = describeOnboardConsent({ granted: false, reason: 'CONSENT_GRANT_FAILED' });
    expect(out.tone).toBe('rose');
    expect(out.headline).toBe('Consent not captured');
    expect(out.detail).toContain('CONSENT_GRANT_FAILED');
    expect(out.detail).toContain('Privacy tab');
  });

  it('garbage input degrades honestly to rose/UNKNOWN, never to granted', () => {
    for (const garbage of [undefined, null, 'yes', 42, {}, { granted: 'true' }]) {
      const out = describeOnboardConsent(garbage);
      expect(out.tone).toBe('rose');
      expect(out.headline).toBe('Consent not captured');
      expect(out.detail).toContain('UNKNOWN');
    }
  });

  it('every tone has Tailwind classes — the dialog stays dumb', () => {
    expect(ONBOARD_CONSENT_TONE_CLASSES.emerald).toContain('emerald');
    expect(ONBOARD_CONSENT_TONE_CLASSES.amber).toContain('amber');
    expect(ONBOARD_CONSENT_TONE_CLASSES.rose).toContain('rose');
  });
});

describe('route contracts — POST /api/hr/employees files its consent (v2.120.0)', () => {
  const route = src('src/app/api/hr/employees/route.ts');
  const routeCode = codeOf(route);

  it('rides the SAME audited grantConsent path — vocabulary pinned in the lib, never re-declared', () => {
    expect(routeCode.includes("from '@/lib/hr/data-protection'")).toBe(true);
    expect(routeCode.includes('grantConsent(')).toBe(true);
    // the payroll vocabulary lives in data-protection.ts — the route must not
    // re-declare it (one source of truth for policy versions)
    expect(routeCode.includes('PAYROLL_PROCESSING')).toBe(false);
    expect(routeCode.includes('hr-policy-2026-01')).toBe(false);
  });

  it('withdrawal is never reachable from onboarding — the decision surface stays on the Privacy tab', () => {
    expect(routeCode.includes('withdrawConsent')).toBe(false);
    // the boundary is a written contract, not an accident
    expect(route.includes('withdrawal is never reachable from onboarding')).toBe(true);
  });

  it('consent gating: only the strict boolean fires the grant; a glitch keeps the 201 with an honest outcome', () => {
    expect(routeCode.includes('body.consentPayrollProcessing === true')).toBe(true);
    expect(routeCode.includes("reason: consentRequested ? 'CONSENT_GRANT_FAILED' : 'NOT_REQUESTED'")).toBe(true);
    // the grant failure is caught INSIDE the success path — 201 stands
    const catchArm = routeCode.slice(routeCode.indexOf('if (consentRequested)'), routeCode.indexOf('return Response.json({ success: true, data: result.employee'));
    expect(catchArm.includes('error instanceof StageGError ? error.code')).toBe(true);
    expect(routeCode.includes("data: result.employee, id: result.id, consent }, { status: 201 }")).toBe(true);
  });

  it('GET surfaces canCreate through the SAME key the POST guard pins', () => {
    expect(routeCode.includes("canCreate: hasHrPermission(session.role, 'hr.employee.create')")).toBe(true);
    expect(routeCode.includes("hrGuard('hr.employee.create'")).toBe(true);
  });
});

describe('page contracts — the onboarding dialog (v2.120.0)', () => {
  const page = src('src/app/(shell)/hr/employees/page.tsx');
  const pageCode = codeOf(page);

  it('the dialog names every part for tests and screen readers', () => {
    for (const tid of [
      'hr-employees-onboard-open',
      'hr-employees-onboard-dialog',
      'hr-employees-onboard-first',
      'hr-employees-onboard-last',
      'hr-employees-onboard-type',
      'hr-employees-onboard-hire-date',
      'hr-employees-onboard-salary',
      'hr-employees-onboard-consent-checkbox',
      'hr-employees-onboard-consent-outcome',
      'hr-employees-onboard-submit',
    ]) {
      expect(page.includes(`data-testid="${tid}"`)).toBe(true);
    }
    expect(page.includes("aria-label=\"File the employee's signed payroll-processing consent\"")).toBe(true);
  });

  it('employment types are the schema vocabulary, exactly — no client invention', () => {
    expect(page.includes("['PERMANENT', 'CONTRACT', 'CASUAL', 'PROBATION', 'INTERN']")).toBe(true);
  });

  it('the consent panel says the honest sentence and the outcome renders through the pure interpreter', () => {
    expect(page.includes('The employee signed the payroll consent form during hiring')).toBe(true);
    expect(page.includes('MISSING_CONSENT')).toBe(true);
    expect(page.includes('hr-policy-2026-01')).toBe(true);
    expect(pageCode.includes('describeOnboardConsent(obResult.consent)')).toBe(true);
    expect(pageCode.includes('ONBOARD_CONSENT_TONE_CLASSES[outcome.tone]')).toBe(true);
  });

  it('the door only exists when the server says so — canCreate gates the button', () => {
    expect(pageCode.includes('{canCreate && (')).toBe(true);
    expect(pageCode.includes('setCanCreate(json.canCreate === true)')).toBe(true);
  });
});
