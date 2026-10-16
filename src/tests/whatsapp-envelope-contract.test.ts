import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// v2.32.0 REGRESSION GUARD (same pattern as self-service-server-format.test.ts):
// request<T> returns the ApiResponse ENVELOPE ({ success, data? }), but five
// tabs read sendDocument fields FLAT off the envelope (res.waLink etc.) -
// always undefined at runtime, so five WhatsApp-share buttons were silently
// dead until v2.32.0. This guard statically forbids the flat reads and
// requires every sendDocument consumer to read the payload through .data.

const TABS_DIR = join(process.cwd(), 'src/app/(shell)/tabs');

const FORBIDDEN: Array<[RegExp, string]> = [
  [/res\??\.waLink\b/, 'flat res.waLink read (payload lives on res.data.waLink)'],
  [/res\??\.documentTitle\b/, 'flat res.documentTitle read (payload lives on res.data.documentTitle)'],
  [/\(\s*res\s+as\s*\{[^}]*waLink/, 'res-as-cast flat waLink read'],
  [/\(\s*res\s+as\s*\{[^}]*documentTitle/, 'res-as-cast flat documentTitle read'],
  [/\(\s*res\s+as\s*\{[^}]*message/, 'res-as-cast flat message read'],
];

/** Strip line comments so explanatory text ("the flat res.waLink read was
 *  always undefined") cannot trip the patterns - same lesson as the
 *  verify-script "'use client' in comments" false positive. */
function stripComments(src: string): string {
  return src
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

function tabFiles(): string[] {
  return readdirSync(TABS_DIR).filter((f) => f.endsWith('.tsx'));
}

describe('whatsapp sendDocument envelope contract (tabs)', () => {
  it('no tab reads sendDocument fields flat off the ApiResponse envelope', () => {
    const violations: string[] = [];
    for (const file of tabFiles()) {
      const src = stripComments(readFileSync(join(TABS_DIR, file), 'utf8'));
      for (const [pattern, why] of FORBIDDEN) {
        if (pattern.test(src)) violations.push(`${file}: ${why}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('every sendDocument consumer reads the payload through the envelope', () => {
    const offenders: string[] = [];
    for (const file of tabFiles()) {
      const src = stripComments(readFileSync(join(TABS_DIR, file), 'utf8'));
      if (!src.includes('whatsappApi.sendDocument')) continue;
      // pos-tab aliases r?.data; the rest read res.data. Any consumer that
      // touches neither is a candidate flat reader.
      if (!/res\.data|r\?\.data|res\?\.data/.test(src)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('the corrected consumers keep their envelope reads (spot checks)', () => {
    const gift = readFileSync(join(TABS_DIR, 'gift-cards-tab.tsx'), 'utf8');
    expect(gift).toMatch(/const payload = res\.data;\s*\n\s*if \(payload\?\.waLink\)/);
    const invoices = readFileSync(join(TABS_DIR, 'invoices-tab.tsx'), 'utf8');
    expect(invoices).toMatch(/const payload = res\.data;/);
    expect(invoices).toContain('payload?.waLink');
    const customers = readFileSync(join(TABS_DIR, 'customers-tab.tsx'), 'utf8');
    expect(customers).toContain('res?.data?.waLink');
  });
});
