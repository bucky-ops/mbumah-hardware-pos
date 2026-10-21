#!/usr/bin/env node
// voice-lint.mjs — the v2.201.1 lesson made mechanical.
//
// v2.201.0 shipped a spoken-figure bug the E2E caught AFTER the merge: the
// debt book's risk lines and the movers' meta prefixed "KES" in front of
// formatKES's own "Ksh" — "KES Ksh 88,400.00" on every lifetime-spend line.
// The class: a hardcoded currency word wrapped around a formatter that
// already speaks one. This lint greps the UI sources for that class (and a
// few sibling traps) so it can never merge again. Wire it into the round
// verify and treat a finding as a release blocker.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['src/components', 'src/app'];
const SKIP = ['node_modules', '.next'];
const findings = [];

// The double-currency class: a literal currency voice around a formatter
// that already speaks one (formatKES → "Ksh …").
const PATTERNS = [
  [/KES\s*\$\{formatKES/, 'KES prefix around formatKES (formatKES already speaks "Ksh")'],
  [/Ksh\s*\$\{formatKES/, 'Ksh prefix around formatKES (double voice)'],
  [/KES\s*\{formatKES/, 'KES prefix around formatKES (JSX form)'],
  [/Ksh\s*\{formatKES/, 'Ksh prefix around formatKES (JSX form)'],
];

const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (SKIP.includes(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(tsx?|mjs|jsx)$/.test(name)) {
      const src = readFileSync(p, 'utf8');
      for (const [re, why] of PATTERNS) {
        if (re.test(src)) findings.push(`${p}: ${why}`);
      }
    }
  }
};

for (const root of ROOTS) walk(root);

if (findings.length) {
  console.error(`VOICE LINT: ${findings.length} finding(s) — one currency voice only:`);
  for (const f of findings) console.error(`  ${f}`);
  process.exit(1);
}
console.log('VOICE LINT: clean — no double-currency voices in the UI sources.');
