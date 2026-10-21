// v2.210.0 — the currency wire finds its model, and the sweep law pins the class shut.
//
//   - The /api/currency/rates route has queried `db.currencyRate` since
//     birth while the model existed in NO schema — the db.ts
//     `as unknown as PrismaClient` cast hid the missing delegate from
//     tsc, the GET's try/catch masked it behind static fallbacks, and
//     POST was a guaranteed runtime 500. The v2.209 DeadLetterQueue
//     lesson, SECOND INSTANCE. This round: the CurrencyRate model lands
//     (schema + postgres migration), the sweep law is born, and the
//     switcher gains the honest-source chips.
//   - THE SWEEP LAW (the class-killer): every `db.<delegate>` access in
//     a file that imports the Prisma client must name a model the schema
//     declares. Comments and string literals are stripped before
//     matching (prose like `@db.Decimal` or "db.ts" can never read as a
//     delegate); client-side IndexedDB code never imports @/lib/db and
//     is out of scope by construction. This test re-implements the
//     sweep on the source of record so CI enforces it without the script.
//   - The route's GET is now requireAuth-wrapped — the header always
//     documented "any authenticated user", but the handler shipped
//     unauthenticated. POST stays SUPER_ADMIN-only.
//   - The switcher fetches the wire lazily on the FIRST open, overlays
//     DB rows on the static list, and speaks each rate's provenance
//     with measured chips (emerald admin-set 5.09, blue API 6.26, muted
//     built-in 6.00 on the popover ground; dark 9.67/8.58/5.71). A wire
//     that never answered renders NO chip — honest absence, never an
//     invented source.
//
// Every pin reads the SOURCE OF RECORD (source bytes, not memory) — the
// house rule since the verify scripts were born.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const SCHEMA_PATH = 'prisma/schema.prisma';
const ROUTE_PATH = 'src/app/api/currency/rates/route.ts';
const SWITCHER_PATH = 'src/components/currency-switcher.tsx';

// ── The sweep, re-implemented on the source of record ──────────────────────

function declaredModels(): Set<string> {
  const text = read(SCHEMA_PATH);
  const names = new Set<string>();
  for (const m of text.matchAll(/^model\s+([A-Za-z_][A-Za-z0-9_]*)/gm)) names.add(m[1]);
  return names;
}

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
    .replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

function stripStrings(text: string): string {
  return text.replace(
    /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g,
    (m) => (m.startsWith('`') ? '``' : m.charAt(0) + m.charAt(0)),
  );
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts|cts)$/.test(entry)) out.push(full);
  }
  return out;
}

function sweepPhantoms(): { name: string; sites: string[] }[] {
  const models = declaredModels();
  const camel = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
  const valid = new Set([...models].map(camel));
  const DB_CALL_RE = /\bdb\??\.([A-Za-z_$][\w$]*)/g;
  const phantoms = new Map<string, string[]>();
  for (const file of walk(join(process.cwd(), 'src'))) {
    const text = readFileSync(file, 'utf8');
    // SCOPE LAW: only files that import the Prisma client are scanned.
    if (!/(from\s*['"][^'"]*lib\/db['"]|require\(\s*['"][^'"]*lib\/db['"]\s*\))/.test(text)) continue;
    const lines = stripStrings(stripComments(text)).split('\n');
    lines.forEach((line, i) => {
      for (const m of line.matchAll(DB_CALL_RE)) {
        const name = m[1];
        if (name.startsWith('$')) continue;
        if (valid.has(name)) continue;
        const sites = phantoms.get(name) ?? [];
        sites.push(`${file}:${i + 1}`);
        phantoms.set(name, sites);
      }
    });
  }
  return [...phantoms.entries()].map(([name, sites]) => ({ name, sites }));
}

// ── 1. THE SWEEP LAW ────────────────────────────────────────────────────────

describe('v2.210.0 — the phantom-model sweep (the class-killer law)', () => {
  it('every db.<delegate> access in a Prisma-client file names a declared model', () => {
    const phantoms = sweepPhantoms();
    expect(
      phantoms.map((p) => `${p.name} at ${p.sites.slice(0, 3).join(', ')}`),
    ).toEqual([]);
  });

  it('the sweep machinery itself is sound: stripping prose, keeping code', () => {
    // Prose that LOOKS like a delegate must never read as one.
    expect(stripStrings(stripComments('// db.ghost.findMany()\nconst x = db.user.findMany();'))).not.toContain('db.ghost');
    expect(stripStrings(stripComments('/** @db.Decimal(12,2) prose */ const y = db.store.findFirst();'))).not.toContain('db.Decimal');
    expect(stripStrings(stripComments(`it('the db.ts contract', () => {})`))).not.toContain('db.ts');
    // Real code survives the strip.
    expect(stripStrings(stripComments('const rows = await db.currencyRate.findMany();'))).toContain('db.currencyRate');
    // String-keyed prose survives nothing; a bracketed identifier survives.
    expect(stripStrings(stripComments(`db['ghostModel']`))).not.toContain('ghostModel');
    expect(stripStrings(stripComments('db[dynamicKey].findMany()'))).toContain('db[dynamicKey]');
  });

  it('the sweep script exists for humans and asserts the same law', () => {
    const script = read('scripts/phantom-model-sweep.mjs');
    expect(script).toContain('PHANTOM-MODEL SWEEP');
    expect(script).toContain('validDelegates.has(name)');
    expect(script).toContain('process.exit(1)');
  });
});

// ── 2. THE MODEL (the contract the code always assumed) ────────────────────

describe('v2.210.0 — the CurrencyRate model exists in every schema', () => {
  const schema = read(SCHEMA_PATH);
  const model = schema.slice(schema.indexOf('model CurrencyRate'));

  it('the model block exists with the full field contract', () => {
    expect(schema).toMatch(/^model CurrencyRate \{/m);
    for (const field of ['id', 'base', 'quote', 'rate', 'source', 'createdAt', 'updatedAt']) {
      expect(model).toContain(field);
    }
    expect(model).toContain('rate      Decimal');
    expect(model).toContain('source    String   @default("MANUAL")');
  });

  it('the compound unique the route demands is declared (base_quote)', () => {
    // The route's `where: { base_quote: ... }` only compiles against a
    // @@unique([base, quote]) — without it the upsert was unwritable.
    expect(model).toContain('@@unique([base, quote])');
    expect(model).toContain('@@map("currency_rates")');
  });

  it('the model is deliberately NOT store-scoped', () => {
    // Global financial configuration: no storeId field, and absent from
    // STORE_SCOPED_MODELS (the routes read it inside runWithoutTenant).
    const block = model.slice(0, model.indexOf('}'));
    expect(block).not.toMatch(/storeId/);
    const dbSrc = read('src/lib/db.ts');
    const setBlock = dbSrc.slice(
      dbSrc.indexOf('STORE_SCOPED_MODELS'),
      dbSrc.indexOf(']);'),
    );
    expect(setBlock).not.toContain('CurrencyRate');
  });

  it('the postgres migration exists and creates the compound-unique table', () => {
    const migrationPath = 'prisma/migrations/20261022040000_add_currency_rates/migration.sql';
    expect(existsSync(join(process.cwd(), migrationPath))).toBe(true);
    const migration = read(migrationPath);
    expect(migration).toContain('CREATE TABLE "currency_rates"');
    expect(migration).toContain('"rate" DECIMAL NOT NULL');
    expect(migration).toContain(`CREATE UNIQUE INDEX "currency_rates_base_quote_key" ON "currency_rates"("base", "quote");`);
    expect(migration).toContain(`"source" TEXT NOT NULL DEFAULT 'MANUAL'`);
  });
});

// ── 3. THE ROUTE (the wire stands on real ground) ──────────────────────────

describe('v2.210.0 — the rates route speaks its own history', () => {
  const route = read(ROUTE_PATH);

  it('GET is requireAuth-wrapped (the documented contract, now enforced)', () => {
    expect(route).toContain("export const GET = withErrorBoundary(requireAuth(getHandler), 'CURRENCY_RATES');");
  });

  it('POST stays SUPER_ADMIN-only', () => {
    expect(route).toContain("export const POST = requireAuth(postHandler, { roles: ['SUPER_ADMIN'] });");
  });

  it('the header names the phantom honestly; the catch is outage-only', () => {
    expect(route).toContain('the model landed in v2.210.0');
    expect(route).toContain('POST was a guaranteed runtime 500');
    // The old lie ("table doesn't exist yet") is dead — the table exists.
    expect(route).not.toContain("table doesn't exist yet");
    expect(route).toContain('this catch now covers genuine DB');
  });

  it('the wire still reads the model the honest way', () => {
    expect(route).toContain('db.currencyRate.findMany({');
    expect(route).toContain('where: { base_quote: { base: r.base, quote: r.quote } }');
    // The static fallback stays labeled, never mistaken for a DB row.
    expect(route).toContain("source: dbRate?.source ?? 'STATIC'");
  });
});

// ── 4. THE SWITCHER (the wire's consumer, honestly sourced) ────────────────

describe('v2.210.0 — the currency switcher speaks each rate\u2019s source', () => {
  const sw = read(SWITCHER_PATH);

  it('the wire is fetched lazily on the FIRST open — never on mount', () => {
    expect(sw).toContain('<DropdownMenu onOpenChange={handleOpenChange}>');
    // v2.212.0: the lazy gate rides the shared query cache now — the query
    // stays DISABLED until the first open (same law, new machinery).
    expect(sw).toContain('enabled: opened,');
    expect(sw).toContain('const [opened, setOpened] = useState(false);');
    expect(sw).toContain("authedFetch('/api/currency/rates')");
    // No mount-time fetch: no useEffect around the fetch in this component.
    const fn = sw.slice(sw.indexOf('const handleOpenChange'), sw.indexOf('const handleSelect'));
    expect(fn).not.toContain('useEffect');
  });

  it('a wire that never answered renders NO chip (honest absence)', () => {
    expect(sw).toContain('dbRate={rates?.get(c.code)}');
    expect(sw).toContain('{dbRate && sourcePhrase && (');
    // v2.212.0: the silence lives in the map builder now — an empty or
    // failed wire builds an EMPTY map, and an empty map renders nothing
    // (no toast, no invented provenance).
    const mapBlock = sw.slice(sw.indexOf('const rates = useMemo'), sw.indexOf('const handleOpenChange'));
    expect(mapBlock).toContain('return map.size > 0 ? map : null;');
    expect(mapBlock).not.toContain('toast');
  });

  it('the three provenance chips ride their measured literals', () => {
    // Light pairs measured on the popover ground: emerald 5.09, blue 6.26,
    // muted 6.00 — every one clears the 4.5:1 small-text bar.
    expect(sw).toContain("'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'");
    expect(sw).toContain("'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'");
    expect(sw).toContain("dbRate.source === 'STATIC' && 'text-muted-foreground'");
    // The measurement script is the source of the numbers.
    const math = read('scripts/contrast-math-switcher-chips-v2210.mjs');
    expect(math).toContain('POPOVER_LIGHT');
    expect(math).toContain('4.5:1 small-text bar');
  });

  it('the aria names the provenance where the numbers are', () => {
    expect(sw).toContain("MANUAL: 'admin-set rate'");
    expect(sw).toContain("API: 'API rate'");
    expect(sw).toContain("STATIC: 'built-in rate'");
    expect(sw).toContain('aria-label={`Switch display currency to ${meta.name} (${meta.code})${sourcePhrase');
    expect(sw).toContain("'admin-set' : dbRate.source === 'API' ? 'API' : 'built-in'");
  });

  it('the rate line rides tabular-nums and the footer names the chips', () => {
    expect(sw).toContain('text-[10px] text-muted-foreground tabular-nums truncate');
    expect(sw).toContain('Each chip names its source: admin-set, API, or built-in.');
  });
});

// ── 4b. THE EXPERT-TABLE CHIP AUDIT (the sweep's final third) ───────────────

describe('v2.210.0 — the expert-table chips finish the badge sweep', () => {
  const src = read('src/components/org/experts.tsx');

  it('the banned -500/-600 stragglers are gone (measured 2.05\u20133.82 on their grounds)', () => {
    // Measured by scripts/contrast-math-expert-chips-v2210.mjs BEFORE the fix:
    // red-500 text 3.82, orange-500 2.89, orange-600 3.59, amber-500 icon 2.05.
    expect(src).not.toContain('text-red-500');
    expect(src).not.toContain('text-orange-500');
    expect(src).not.toContain('text-orange-600');
    expect(src).not.toContain('text-amber-500');
  });

  it('the adopted family rides the measured literals (6.42 / 5.23 / 3.05)', () => {
    // Ten text sites re-voiced red-700 / orange-700 (6.42 / 5.23 on white).
    expect((src.match(/text-red-700/g) ?? []).length).toBeGreaterThanOrEqual(8);
    expect((src.match(/text-orange-700/g) ?? []).length).toBe(2);
    // The Unavailable panel's icon is GRAPHICS — amber-600 clears 3:1 at 3.05.
    expect(src).toContain('text-amber-600');
  });

  it('the honest passers were left alone (4.76 / 5.05 / 5.37 / 4.77)', () => {
    // red-600 badges, amber-700 WARN, emerald-700 healthy, slate-500 muted —
    // already above the bar; the audit does not churn what passes.
    expect(src).toContain("a.severity === 'ERROR' ? 'border-red-200 text-red-600'");
    expect(src).toContain("'border-amber-200 text-amber-700'");
    expect(src).toContain("'border-emerald-200 text-emerald-700'");
    expect(src).toContain("v >= 90 ? 'text-emerald-700' : v >= 70 ? 'text-amber-700' : 'text-red-600'");
  });

  it('the measurement script is the source of the numbers', () => {
    const math = read('scripts/contrast-math-expert-chips-v2210.mjs');
    expect(math).toContain('ADOPTED');
    expect(math).toContain('BANNED');
    expect(math).toContain('bg-white');
  });
});

// ── 5. THE TREADMILL (this suite rides at the head) ────────────────────────

describe('v2.210.0 — the suite rides at the head', () => {
  const pkg = JSON.parse(read('package.json')) as {
    version: string;
    mbumah: { releaseVersion: string; baseVersion: string };
  };

  it('the release is 2.210.0 in all three version fields', () => {
    expect(pkg.version).toBe('2.212.0');
    expect(pkg.mbumah.releaseVersion).toBe('2.212.0');
    expect(pkg.mbumah.baseVersion).toBe('2.212.0');
  });

  it('the What\u2019s New feed heads this release', () => {
    // Source-of-record read: the feed\u2019s first entry must be this round.
    const feed = read('src/lib/whats-new.ts');
    const head = feed.slice(feed.indexOf('export const WHATS_NEW'));
    expect(head).toMatch(/version: '2\.210\.0'/);
    expect(head.indexOf("version: '2.212.0'")).toBeLessThan(head.indexOf("version: '2.209.0'"));
  });
});
