/**
 * v2.44.0: password strength evaluation for the forced first sign-in
 * rotation screen (and any future password UI).
 *
 * PURE module — no DOM, no imports. The screen renders the four rules as a
 * live checklist; the same rules gate the submit button (all four must pass,
 * which also satisfies the API's min-8 rule with margin).
 */

export const MIN_PASSWORD_LENGTH = 8;

export interface StrengthRule {
  label: string;
  ok: boolean;
}

export interface PasswordStrength {
  /** 0..4 — how many rules pass. */
  score: number;
  label: 'Too short' | 'Weak' | 'Fair' | 'Good' | 'Strong';
  rules: StrengthRule[];
}

/** Evaluate a candidate password against the four shop-floor rules. */
export function evaluatePasswordStrength(pw: string): PasswordStrength {
  const rules: StrengthRule[] = [
    { label: `At least ${MIN_PASSWORD_LENGTH} characters`, ok: pw.length >= MIN_PASSWORD_LENGTH },
    { label: 'Upper and lower case letters', ok: /[a-z]/.test(pw) && /[A-Z]/.test(pw) },
    { label: 'At least one number', ok: /\d/.test(pw) },
    { label: 'At least one symbol (e.g. !@#)', ok: /[^A-Za-z0-9]/.test(pw) },
  ];
  const score = rules.filter((r) => r.ok).length;
  const label: PasswordStrength['label'] =
    pw.length < MIN_LENGTH_SENTINEL
      ? 'Too short'
      : score <= 2
        ? 'Weak'
        : score === 3
          ? 'Fair'
          : pw.length >= 12
            ? 'Strong'
            : 'Good';
  return { score, label, rules };
}

const MIN_LENGTH_SENTINEL = MIN_PASSWORD_LENGTH;
