// MBUMAH HARDWARE POS - self-service server-format import guard (v2.29.1)
//
// REGRESSION GUARD for the v2.29.0 QA-caught production bug: the SSR
// payslips page imported formatKes() from '@/components/hr/self-service-ui'
// — a 'use client' module. On the server, plain-function exports from a
// client module are client REFERENCES, not functions, so calling one during
// the server render crashed the whole route ("Something went wrong") for
// every employee with payslips.
//
// The formatters deliberately live in '@/components/hr/self-service-format'
// (a directive-free pure module importable from BOTH graphs — see its
// header). This test statically enforces that every self-service SERVER
// page imports them only from the pure module, so the boundary violation
// can never ship again.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ME_DIR = join(process.cwd(), 'src/app/(selfservice)/employees/me');

// Server components in the portal (page.tsx files must never carry 'use
// client'); anything imported from self-service-ui in these files must be
// a component (client refs are fine for JSX), never a CALLED function.
const SERVER_PAGES = [
  'page.tsx',
  'payslips/page.tsx',
  'attendance/page.tsx',
  'leave/page.tsx',
  'goals/page.tsx',
  'documents/page.tsx',
];

const FORMATTER_NAMES = ['formatKes', 'formatDate'];

describe('self-service server pages import formatters from the pure module', () => {
  it('the payslips page imports formatKes from self-service-format (not self-service-ui)', () => {
    const src = readFileSync(join(ME_DIR, 'payslips/page.tsx'), 'utf8');
    expect(src).toContain("from '@/components/hr/self-service-format'");
    expect(src).not.toMatch(/import\s*{[^}]*formatKes[^}]*from\s*'@\/components\/hr\/self-service-ui'/);
  });

  for (const page of SERVER_PAGES) {
    it(`${page}: no formatter is imported from the client module self-service-ui`, () => {
      const src = readFileSync(join(ME_DIR, page), 'utf8');
      // The import line, if any, must not pull formatters out of the
      // client module (client refs of COMPONENTS are fine).
      const uiImport = src.match(/import\s*{([^}]*)}\s*from\s*'@\/components\/hr\/self-service-ui'/);
      if (uiImport) {
        const names = uiImport[1].split(',').map((s) => s.trim().replace(/^type\s+/, ''));
        for (const name of FORMATTER_NAMES) {
          expect(names).not.toContain(name);
        }
      }
    });
  }

  it('the pure format module stays directive-free (importable from both graphs)', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/hr/self-service-format.ts'), 'utf8');
    expect(src).not.toMatch(/^\s*['"]use client['"]/m);
    expect(src).not.toMatch(/^\s*import\s+['"]server-only['"]/m);
  });
});
