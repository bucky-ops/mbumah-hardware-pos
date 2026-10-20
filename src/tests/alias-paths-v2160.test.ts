import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * alias-paths-v2160 — v2.160.0 — the spec's own paths.
 *
 * Phase 4.6 literal spec-path parity closes: the EMS spec's
 * `/api/payroll/exports/p10`, `/api/payroll/exports/statutory`, and
 * `/api/payroll/liability-report` routes exist as RE-EXPORTS of their
 * canonical handlers (zero duplicated logic — they cannot drift), and
 * `scripts/verify-spec-paths.mjs` is the mechanical gate over every
 * Phase 4.6/4.7 path in the spec's "Create:" lists.
 *
 * The same round closes the login front door's last a11y finding: the axe
 * best-practice "region" rule flagged all nine content blocks (tagline,
 * card header, form fields, footer) as living outside every landmark —
 * the content column becomes a <main> landmark, the decorative background
 * layers are honestly aria-hidden, and the input focus pulse rises from
 * ambient-glow alphas (0.15/0.25 — a soft halo, ~1.6:1 vs the glass card)
 * to a visible keyboard beacon (0.35/0.5 + border 0.7).
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const p10Alias = readRepo('src/app/api/payroll/exports/p10/route.ts');
const statutoryAlias = readRepo('src/app/api/payroll/exports/statutory/route.ts');
const liabilityAlias = readRepo('src/app/api/payroll/liability-report/route.ts');
const loginScreen = readRepo('src/components/login-screen.tsx');
const globalsCss = readRepo('src/app/globals.css');
const specScript = readRepo('scripts/verify-spec-paths.mjs');
const payrollDoc = readRepo('docs/payroll-run-lifecycle.md');

describe('the spec-path aliases re-export their canonical handlers', () => {
  it('/api/payroll/exports/p10 re-exports /api/hr/reports/p10 (GET + local dynamic)', () => {
    expect(p10Alias).toMatch(
      /export\s*\{\s*GET\s*\}\s*from\s*'[^']*hr\/reports\/p10\/route'/,
    );
    expect(p10Alias).toMatch(/export\s*const\s*dynamic\s*=\s*'force-dynamic'/);
  });

  it('/api/payroll/exports/statutory re-exports /api/hr/reports/statutory-liability', () => {
    expect(statutoryAlias).toMatch(
      /export\s*\{\s*GET\s*\}\s*from\s*'[^']*hr\/reports\/statutory-liability\/route'/,
    );
    expect(statutoryAlias).toMatch(/export\s*const\s*dynamic\s*=\s*'force-dynamic'/);
  });

  it('/api/payroll/liability-report re-exports /api/hr/reports/statutory-liability', () => {
    expect(liabilityAlias).toMatch(
      /export\s*\{\s*GET\s*\}\s*from\s*'[^']*hr\/reports\/statutory-liability\/route'/,
    );
    expect(liabilityAlias).toMatch(/export\s*const\s*dynamic\s*=\s*'force-dynamic'/);
  });

  it('the alias files contain no handler logic of their own (pure re-export)', () => {
    for (const [name, src] of [
      ['exports/p10', p10Alias],
      ['exports/statutory', statutoryAlias],
      ['liability-report', liabilityAlias],
    ] as const) {
      // A pure re-export must not build responses, call guards, or read
      // query params — the canonical handler is the ONLY behavior.
      expect(src, name).not.toMatch(/hrGuard|new Response|searchParams/);
      expect(src, name).toContain('SPEC-PATH ALIAS');
    }
  });

  it('the alias files resolve their relative import to the canonical module', () => {
    // Depth check mirrors scripts/verify-spec-paths.mjs: the specifier,
    // joined to the alias file's directory, must land on the canonical.
    const cases = [
      ['src/app/api/payroll/exports/p10/route.ts', p10Alias, 'src/app/api/hr/reports/p10/route'],
      ['src/app/api/payroll/exports/statutory/route.ts', statutoryAlias, 'src/app/api/hr/reports/statutory-liability/route'],
      ['src/app/api/payroll/liability-report/route.ts', liabilityAlias, 'src/app/api/hr/reports/statutory-liability/route'],
    ] as const;
    for (const [file, src, canonical] of cases) {
      const m = src.match(/from\s+'([^']+)'/);
      if (!m) throw new Error(`${file}: no import specifier found`);
      const resolved = resolve(join(process.cwd(), file, '..', m[1]));
      expect(resolved.endsWith(canonical), `${file} -> ${resolved}`).toBe(true);
    }
  });
});

describe('the spec-parity gate script', () => {
  it('exists and covers both phases plus the alias bindings', () => {
    expect(existsSync(join(process.cwd(), 'scripts/verify-spec-paths.mjs'))).toBe(true);
    expect(specScript).toContain('/api/payroll/exports/p10');
    expect(specScript).toContain('/api/payroll/exports/statutory');
    expect(specScript).toContain('/api/payroll/liability-report');
    expect(specScript).toContain('/api/self-service/me/documents');
    expect(specScript).toContain('/employees/me/documents');
    expect(specScript).toContain('/api/hr/performance/cycles');
  });

  it('asserts the re-export shape so aliases cannot silently drift', () => {
    expect(specScript).toContain('re-exports');
    expect(specScript).toContain('export');
  });
});

describe('the login front door is a landmark (region ×9 closed)', () => {
  it('the content column is a motion.main landmark', () => {
    expect(loginScreen).toContain('<motion.main');
    expect(loginScreen).toContain('</motion.main>');
    expect(loginScreen).not.toContain('<motion.div\n        className="w-full max-w-md');
  });

  it('the decorative background layers are aria-hidden', () => {
    // Particles root, dot grid, and the hardware pattern field.
    expect(loginScreen).toContain('aria-hidden="true" className="absolute inset-0 pointer-events-none overflow-hidden"');
    expect(loginScreen).toContain('aria-hidden="true" className="absolute inset-0 dot-grid-pattern pointer-events-none"');
    expect(loginScreen).toContain('aria-hidden="true" className="absolute inset-0 opacity-[0.03] pointer-events-none"');
  });

  it('keeps the form contract intact (email + password + submit)', () => {
    expect(loginScreen).toContain('id="email"');
    expect(loginScreen).toContain('id="password"');
    expect(loginScreen).toContain('type="submit"');
    expect(loginScreen).toContain('aria-label={showPassword ? \'Hide password\' : \'Show password\'}');
  });
});

describe('the keyboard beacon (login focus glow)', () => {
  it('the focus pulse is visible, not ambient (0.35/0.5 alpha ring)', () => {
    expect(globalsCss).toContain('box-shadow: 0 0 0 2px oklch(0.68 0.18 55 / 0.35);');
    expect(globalsCss).toContain('box-shadow: 0 0 0 3px oklch(0.68 0.18 55 / 0.5);');
    expect(globalsCss).not.toContain('box-shadow: 0 0 0 2px oklch(0.68 0.18 55 / 0.15);');
  });

  it('the focused border rises with the ring (0.7 alpha)', () => {
    expect(globalsCss).toMatch(/\.login-input:focus\s*\{[^}]*border-color:\s*oklch\(0\.68 0\.18 55 \/ 0\.7\)/);
  });

  it('the login inputs still carry the login-input class', () => {
    expect(loginScreen.match(/login-input/g)?.length).toBe(2);
  });
});

describe('the docs fold', () => {
  it('payroll-run-lifecycle.md points the B2C sweep at cron-operations.md', () => {
    expect(payrollDoc).toContain('docs/cron-operations.md');
    expect(payrollDoc).toContain('dispatched hourly');
  });

  it('the doc records the spec-path completion and the alias re-export shape', () => {
    expect(payrollDoc).toContain("The spec's own paths (v2.160.0)");
    expect(payrollDoc).toContain('/api/payroll/exports/p10');
    expect(payrollDoc).toContain('RE-EXPORT');
  });
});
