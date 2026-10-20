import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.150.0 — the header wraps too (the v2.149.0 re-audit's follow-up).
 *
 * Lesson 64 in its purest form: the fix round's first live re-audit found
 * what the pre-release audit could not see, because it was MASKED by the
 * bigger failure it fixed:
 *  - the org console header's right group (role Badge + Global Chat) was a
 *    no-wrap flex row whose min-content measured 419px — it pushed the page
 *    to 435 at 390 even after the shell fix, because at v2.148.0 the table's
 *    1012px had dominated and hidden it;
 *  - the two new scroll wrappers carried aria-label on a bare div — axe
 *    aria-prohibited-attr (the generic role may not be named); a scroller
 *    that is named needs role="region" to carry the name legally.
 *
 * Pinned here (the live re-audit numbers live in the worklog):
 *  - the header right group wraps and cannot push (max-w-full min-w-0 flex-wrap),
 *  - the role Badge wraps inside itself (whitespace-normal),
 *  - both scroll wrappers are role="region" (named, legally),
 *  - the release surfaces speak 2.150.0.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const ORG = 'src/components/workspace/org-console.tsx';

describe('the header right group can never push the page again', () => {
  it('wraps (flex-wrap), never grows (min-w-0), never exceeds (max-w-full)', () => {
    const org = readRepo(ORG);
    expect(org).toContain('flex max-w-full min-w-0 flex-wrap items-center gap-2');
  });

  it('the role Badge wraps inside itself instead of forcing its width', () => {
    expect(readRepo(ORG)).toContain('max-w-full whitespace-normal text-xs');
  });
});

describe('a named scroller needs a role that may carry a name', () => {
  it('the named regions of the org console (3 since v2.159.0)', () => {
    const org = readRepo(ORG);
    // v2.159.0: the Automation pulse card joins the two scroll wrappers as a
    // third named region (the v2.147.0 naming contract: a region carries its
    // own aria-label via an explicit role).
    expect((org.match(/role="region"/g) || []).length).toBe(3);
    expect(org).toContain('role="region"\n            tabIndex={0}\n            aria-label="Branches, scrollable table"');
    expect(org).toContain('role="region"\n                    tabIndex={0}\n                    aria-label="People and payroll by branch, scrollable table"');
  });
});
