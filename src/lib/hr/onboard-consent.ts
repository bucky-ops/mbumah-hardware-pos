/**
 * ONBOARDING CONSENT OUTCOME (v2.120.0) — the honest interpreter for the
 * `consent` field that POST /api/hr/employees returns alongside the new hire.
 *
 * The route files a new hire's payroll-processing consent through the SAME
 * audited grantConsent path the Privacy tab uses — but a form speaks in
 * outcomes, not codes. This pure module folds the route's response into one
 * of three sentences the onboarding dialog can show:
 *   • granted    → "Consent captured" (emerald) with the policy version and
 *                  the grant date, so the paperwork reads like paperwork.
 *   • not asked  → "No consent on file" (amber) — and the MISSING_CONSENT
 *                  truth: the next payroll run will flag this hire until
 *                  their consent is granted on the Privacy tab.
 *   • failed     → "Consent not captured" (rose) with the route's reason
 *                  code — the hire is on file, the consent is not, and the
 *                  dialog says both out loud.
 *
 * Kept out of the page so the vocabulary is unit-testable — the same shape
 * as the v2.115.0 case-list and v2.118.0 ledger CSV serializers. Garbage in
 * (an older server, a reshaped response) degrades honestly to the rose
 * outcome with reason UNKNOWN, never to a silent success look-alike.
 */

export interface OnboardConsentGranted {
  granted: true;
  consentId?: string;
  purpose?: string;
  policyVersion?: string;
  grantedAt?: string;
}

export interface OnboardConsentAbsent {
  granted: false;
  reason: string;
}

export type OnboardConsentPayload = OnboardConsentGranted | OnboardConsentAbsent;

export type OnboardConsentTone = 'emerald' | 'amber' | 'rose';

export interface OnboardConsentOutcome {
  tone: OnboardConsentTone;
  headline: string;
  detail: string;
}

const REASON_UNKNOWN = 'UNKNOWN';

export function describeOnboardConsent(raw: unknown): OnboardConsentOutcome {
  const payload = (
    typeof raw === 'object' && raw !== null ? raw : {}
  ) as Partial<OnboardConsentPayload> & Record<string, unknown>;

  if (payload.granted === true) {
    const policy =
      typeof payload.policyVersion === 'string' && payload.policyVersion
        ? payload.policyVersion
        : 'the current policy';
    const when =
      typeof payload.grantedAt === 'string' &&
      payload.grantedAt &&
      !Number.isNaN(Date.parse(payload.grantedAt))
        ? new Date(payload.grantedAt).toISOString().slice(0, 10)
        : '';
    return {
      tone: 'emerald',
      headline: 'Consent captured',
      detail: `Payroll-processing consent filed under ${policy}${when ? ` — granted ${when}.` : '.'}`,
    };
  }

  const reason = typeof payload.reason === 'string' && payload.reason ? payload.reason : REASON_UNKNOWN;
  if (reason === 'NOT_REQUESTED') {
    return {
      tone: 'amber',
      headline: 'No consent on file',
      detail:
        'The next payroll run will report MISSING_CONSENT for this hire until their consent is granted on the Privacy tab.',
    };
  }
  return {
    tone: 'rose',
    headline: 'Consent not captured',
    detail: `The grant failed (${reason}). The hire is on file — file their consent from the Privacy tab once the issue is resolved.`,
  };
}

/** Tailwind classes per tone — one map so the dialog stays dumb. */
export const ONBOARD_CONSENT_TONE_CLASSES: Record<OnboardConsentTone, string> = {
  emerald:
    'border-emerald-200 bg-emerald-50/70 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
  amber:
    'border-amber-200 bg-amber-50/70 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
  rose: 'border-rose-200 bg-rose-50/70 text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200',
};
