import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.121.0 — "the roster reads the room" (the consent overlay).
 *
 * Task 135's option 1: the consent ledger (v2.119.0) and the onboarding
 * capture (v2.120.0) both exist — but the roster, the surface HR lives in
 * all day, still answered nothing about consent. This release overlays the
 * ledger onto /hr/employees: a "Payroll consent" column (desktop) and a
 * compact chip (mobile cards), tones mirroring the Privacy tab's consent
 * card EXACTLY so a color never means two things, plus a counts strip that
 * tints the without-consent phrase rose when nonzero — the same honesty the
 * card's counts line wears.
 *
 * The overlay degrades HONESTLY: the ledger GET is hr.report.branch +
 * VIEW_ROLES (deliberately excluding ACCOUNTANT, who may still see the
 * roster), so when the fetch 403s — or fails at all — the column and the
 * counts hide WHOLESALE. Absence of the view is never rendered as absence
 * of consent: no dash, chip, or count can masquerade as "no consent on
 * file". Only the three known statuses map; an invented one never renders.
 */

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const codeOf = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the consent overlay fetch (v2.121.0)', () => {
  const page = src('src/app/(shell)/hr/employees/page.tsx');
  const pageCode = codeOf(page);

  it('reads the SAME ledger the Privacy tab reads — one source of consent truth', () => {
    expect(pageCode.includes("fetch('/api/hr/privacy/consent', { credentials: 'include' })")).toBe(true);
    // strict success gate — a partial payload can never look like a ledger
    expect(pageCode.includes('!res.ok || !json.success || !json.data || !Array.isArray(json.data.records)')).toBe(true);
  });

  it('only the three known statuses map — an invented one never renders', () => {
    expect(pageCode.includes("r.status === 'ACTIVE' || r.status === 'WITHDRAWN' || r.status === 'NONE'")).toBe(true);
    expect(pageCode.includes("if (!chip) return null; // an unknown or absent status never renders a look-alike")).toBe(true);
  });

  it('absence of the view is never rendered as absence of consent', () => {
    expect(pageCode.includes('setConsentLedger(null)')).toBe(true);
    expect(page.includes('absence of\n  // the view is not absence of consent')).toBe(true);
    // the dash (out-of-window row) never claims a consent state
    expect(page.includes("Outside the consent view's first 200 in scope")).toBe(true);
  });

  it('the fetch rides its own effect with cleanup — a late answer cannot land', () => {
    expect(pageCode.includes('let alive = true;')).toBe(true);
    expect(pageCode.includes('alive = false;')).toBe(true);
    expect(pageCode.includes('}, [reloadKey]);')).toBe(true);
  });
});

describe('the consent chips — one vocabulary across the two surfaces (v2.121.0)', () => {
  const page = src('src/app/(shell)/hr/employees/page.tsx');

  it('tones mirror the Privacy tab card exactly: emerald Active / amber Withdrawn / slate None', () => {
    for (const tone of ['emerald-200 bg-emerald-50', 'amber-200 bg-amber-50', 'slate-200 bg-slate-100']) {
      expect(page.includes(tone)).toBe(true);
    }
    expect(page.includes("label: 'Active'")).toBe(true);
    expect(page.includes("label: 'Withdrawn'")).toBe(true);
    expect(page.includes("label: 'None on file'")).toBe(true);
  });

  it('each tone says its MISSING_CONSENT truth aloud in the tooltip', () => {
    const chipBlock = page.slice(page.indexOf('const CONSENT_CHIP'), page.indexOf('function ConsentChip'));
    const titles = chipBlock.match(/title: '[^']+'/g) ?? [];
    expect(titles.length).toBe(3);
    expect(chipBlock.includes('the payroll run passes this hire')).toBe(true);
    expect(chipBlock.includes('MISSING_CONSENT')).toBe(true);
    expect(chipBlock.includes('Privacy tab')).toBe(true);
  });

  it('the chip names itself for tests and renders in both densities', () => {
    expect(page.includes('data-testid="hr-employees-consent-chip"')).toBe(true);
    expect(page.includes('compact = false')).toBe(true);
    expect(page.includes('<ConsentChip status={consentLedger.byId.get(r.id)} compact />')).toBe(true);
    // no non-null assertions — an absent status degrades to the null render
    expect(page.includes("byId.get(r.id)!")).toBe(false);
  });

  it('the roster column is server-decided, not hardcoded — it renders only when the ledger loaded', () => {
    expect(page.includes('data-testid="hr-employees-consent-col"')).toBe(true);
    expect((page.match(/\{consentLedger && \(/g) ?? []).length >= 3).toBe(true);
  });
});

describe('the counts strip — the card honesty, carried to the roster (v2.121.0)', () => {
  const page = src('src/app/(shell)/hr/employees/page.tsx');

  it('counts line reads the card sentence and tints the blockers rose', () => {
    const strip = page.slice(page.indexOf('hr-employees-consent-counts'), page.indexOf('hr-employees-count'));
    expect(strip.includes('{consentLedger.summary.active} active')).toBe(true);
    expect(strip.includes('{consentLedger.summary.withdrawn} withdrawn')).toBe(true);
    expect(strip.includes('{consentLedger.summary.none} without consent')).toBe(true);
    expect(strip.includes('text-rose-600 dark:text-rose-400')).toBe(true);
    expect(strip.includes('summary.none > 0')).toBe(true);
  });

  it('the strip admits it counts the whole view, not the filtered list', () => {
    expect(page.includes("Across the whole consent view — not the filtered list")).toBe(true);
    expect(page.includes("MISSING_CONSENT blockers")).toBe(true);
  });
});
