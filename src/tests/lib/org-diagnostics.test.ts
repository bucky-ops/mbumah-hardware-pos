// ORGANIZATION DIAGNOSTICS TESTS - v2.18.4 feature release
//
// Two areas:
//   1. deriveSlugFromStoreName (src/lib/org/diagnostics.ts): the pure slug
//      derivation shared by the diagnostics surface and the slug repair
//      routes. No mocks.
//   2. computeBranchDiagnostics: the org-wide diagnostics batch, covered
//      with the same hoisted @/lib/db mock pattern as branch-workspace.test.ts
//      (every db entry point the data layer touches is mocked; the workspace
//      env keys are pinned per test for determinism).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  storeFindMany,
  salesGroupBy,
  salesFindFirst,
  productGroupBy,
  rentalGroupBy,
  debtGroupBy,
  mpesaGroupBy,
  shiftGroupBy,
  userFindFirst,
} = vi.hoisted(() => ({
  storeFindMany: vi.fn(),
  salesGroupBy: vi.fn(),
  salesFindFirst: vi.fn(),
  productGroupBy: vi.fn(),
  rentalGroupBy: vi.fn(),
  debtGroupBy: vi.fn(),
  mpesaGroupBy: vi.fn(),
  shiftGroupBy: vi.fn(),
  userFindFirst: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  // runWithoutTenant passes through in tests (nesting is a no-op here).
  runWithoutTenant: (fn: () => Promise<unknown>) => fn(),
  db: {
    store: { findMany: storeFindMany },
    salesTransaction: { groupBy: salesGroupBy, findFirst: salesFindFirst },
    product: { groupBy: productGroupBy, fields: { reorderLevel: 'reorderLevel' } },
    equipmentRental: { groupBy: rentalGroupBy },
    debtLedger: { groupBy: debtGroupBy },
    mpesaTransaction: { groupBy: mpesaGroupBy },
    shift: { groupBy: shiftGroupBy },
    user: { findFirst: userFindFirst },
  },
}));

import {
  computeBranchDiagnostics,
  deriveSlugFromStoreName,
  resetSchemaProbeCacheForTests,
} from '@/lib/org/diagnostics';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function storeRow(overrides: Partial<Record<string, string | null>> = {}) {
  return {
    id: 'store_thika',
    code: 'THI',
    name: 'MBUMAH HARDWARE - Thika',
    location: 'Thika',
    slug: 'thika' as string | null,
    subdomain: 'thika' as string | null,
    status: 'ACTIVE',
    ...overrides,
  };
}

const STORES_DEFAULT = [
  storeRow(),
  storeRow({
    id: 'store_juja',
    code: 'JUJ',
    name: 'MBUMAH HARDWARE - Juja Main',
    location: 'Juja',
    slug: null,
    subdomain: null,
  }),
  storeRow({
    id: 'store_ruiru',
    code: 'RUI',
    name: 'MBUMAH HARDWARE - Ruiru',
    location: 'Ruiru',
    slug: 'ruiru',
    subdomain: 'ruiru',
    status: 'CLOSED',
  }),
];

// Workspace env keys resolveBranchWorkspace reads; pinned per test.
const WORKSPACE_ENV_KEYS = [
  'NEXT_PUBLIC_ROOT_DOMAIN',
  'NEXT_PUBLIC_USE_SUBDOMAINS',
  'NEXT_PUBLIC_STORE_WORKSPACE_MODE',
] as const;

let savedEnv: Record<string, string | undefined> = {};

function setWorkspaceEnv(values: Record<string, string | undefined>): void {
  for (const key of WORKSPACE_ENV_KEYS) {
    if (values[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = values[key];
    }
  }
}

// ---------------------------------------------------------------------------
// deriveSlugFromStoreName (pure)
// ---------------------------------------------------------------------------

describe('deriveSlugFromStoreName', () => {
  it('maps the five canonical store names to their slugs', () => {
    expect(deriveSlugFromStoreName('MBUMAH HARDWARE - Juja Main')).toBe('juja-main');
    expect(deriveSlugFromStoreName('MBUMAH HARDWARE - Thika')).toBe('thika');
    expect(deriveSlugFromStoreName('MBUMAH HARDWARE - Ruiru')).toBe('ruiru');
    expect(deriveSlugFromStoreName('MBUMAH HARDWARE - Nairobi CBD')).toBe('nairobi-cbd');
    expect(deriveSlugFromStoreName('MBUMAH HARDWARE - Nakuru')).toBe('nakuru');
  });

  it('tolerates the prefix being present or absent', () => {
    expect(deriveSlugFromStoreName('MBUMAH HARDWARE - Juja Main')).toBe('juja-main');
    expect(deriveSlugFromStoreName('Juja Main')).toBe('juja-main');
    expect(deriveSlugFromStoreName('mbumah hardware - thika')).toBe('thika');
    expect(deriveSlugFromStoreName('MBUMAH HARDWARE -  Nakuru')).toBe('nakuru');
    expect(deriveSlugFromStoreName('MBUMAH HARDWARE Thika')).toBe('thika');
  });

  it('normalizes spacing and punctuation variants', () => {
    expect(deriveSlugFromStoreName('  Ruiru  ')).toBe('ruiru');
    expect(deriveSlugFromStoreName('Nairobi // CBD')).toBe('nairobi-cbd');
    expect(deriveSlugFromStoreName('Thika!!!Town')).toBe('thika-town');
    expect(deriveSlugFromStoreName('A -- B')).toBe('a-b');
    expect(deriveSlugFromStoreName('-x-')).toBe('x');
    expect(deriveSlugFromStoreName('Nakuru  Town')).toBe('nakuru-town');
  });

  it('returns an empty string for empty or unusable names', () => {
    expect(deriveSlugFromStoreName('')).toBe('');
    expect(deriveSlugFromStoreName('   ')).toBe('');
    expect(deriveSlugFromStoreName('!!!')).toBe('');
    expect(deriveSlugFromStoreName('MBUMAH HARDWARE - ')).toBe('');
    expect(deriveSlugFromStoreName('///')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// computeBranchDiagnostics (mocked db)
// ---------------------------------------------------------------------------

describe('computeBranchDiagnostics', () => {
  beforeEach(() => {
    savedEnv = {};
    for (const key of WORKSPACE_ENV_KEYS) savedEnv[key] = process.env[key];
    resetSchemaProbeCacheForTests();
    vi.clearAllMocks();

    setWorkspaceEnv({
      NEXT_PUBLIC_ROOT_DOMAIN: undefined,
      NEXT_PUBLIC_USE_SUBDOMAINS: 'true',
      NEXT_PUBLIC_STORE_WORKSPACE_MODE: 'auto',
    });

    storeFindMany.mockResolvedValue(STORES_DEFAULT);
    salesGroupBy.mockResolvedValue([]);
    salesFindFirst.mockResolvedValue(null);
    productGroupBy.mockResolvedValue([]);
    rentalGroupBy.mockResolvedValue([]);
    debtGroupBy.mockResolvedValue([]);
    mpesaGroupBy.mockResolvedValue([]);
    shiftGroupBy.mockResolvedValue([]);
    userFindFirst.mockResolvedValue(null);
  });

  afterEach(() => {
    setWorkspaceEnv(savedEnv);
  });

  it('classifies an active store with a slug as ready and openable (path mode)', async () => {
    const branches = await computeBranchDiagnostics('');
    const thika = branches.find((b) => b.storeId === 'store_thika');
    expect(thika).toBeDefined();
    expect(thika?.reasonCode).toBe('ready');
    expect(thika?.canOpenWorkspace).toBe(true);
    expect(thika?.href).toBe('/stores/thika/dashboard');
    expect(thika?.schemaStatus).toBe('ok');
    expect(thika?.missingColumns).toEqual([]);
    expect(thika?.remediation.length).toBeGreaterThan(0);
  });

  it('reports missing-slug for an active store without a slug', async () => {
    const branches = await computeBranchDiagnostics('');
    const juja = branches.find((b) => b.storeId === 'store_juja');
    expect(juja?.reasonCode).toBe('missing-slug');
    expect(juja?.href).toBeNull();
    expect(juja?.canOpenWorkspace).toBe(false);
  });

  it('reports store-inactive for a non-ACTIVE store, ahead of other reasons', async () => {
    const branches = await computeBranchDiagnostics('');
    const ruiru = branches.find((b) => b.storeId === 'store_ruiru');
    expect(ruiru?.reasonCode).toBe('store-inactive');
    expect(ruiru?.href).toBeNull();
    expect(ruiru?.canOpenWorkspace).toBe(false);
  });

  it('reports workspace-disabled when routing is configured off', async () => {
    setWorkspaceEnv({ NEXT_PUBLIC_STORE_WORKSPACE_MODE: 'off' });
    const branches = await computeBranchDiagnostics('');
    const thika = branches.find((b) => b.storeId === 'store_thika');
    expect(thika?.reasonCode).toBe('workspace-disabled');
    expect(thika?.href).toBeNull();
  });

  it('reports schema drift from a P2022 probe failure and flags the branch', async () => {
    userFindFirst.mockRejectedValue({ code: 'P2022', message: 'column does not exist' });
    const branches = await computeBranchDiagnostics('');
    expect(branches[0]?.schemaStatus).toBe('drift');
    expect(branches[0]?.missingColumns).toEqual(['users.isEngraved']);
    const thika = branches.find((b) => b.storeId === 'store_thika');
    expect(thika?.reasonCode).toBe('schema-drift');
  });

  it('degrades to schemaStatus unknown on a non-P2022 probe failure', async () => {
    userFindFirst.mockRejectedValue(new Error('database is locked'));
    const branches = await computeBranchDiagnostics('');
    expect(branches[0]?.schemaStatus).toBe('unknown');
    expect(branches[0]?.missingColumns).toEqual([]);
    const thika = branches.find((b) => b.storeId === 'store_thika');
    expect(thika?.reasonCode).toBe('ready');
  });

  it('caches the schema probe for 60 seconds and bypasses it on forceFresh', async () => {
    await computeBranchDiagnostics('');
    expect(salesFindFirst).toHaveBeenCalledTimes(1);
    expect(userFindFirst).toHaveBeenCalledTimes(1);

    // Second call inside the TTL: no new probes.
    await computeBranchDiagnostics('');
    expect(salesFindFirst).toHaveBeenCalledTimes(1);

    // forceFresh re-runs the probes and picks up the new state.
    userFindFirst.mockRejectedValue({ code: 'P2022', message: 'column does not exist' });
    const refreshed = await computeBranchDiagnostics('', { forceFresh: true });
    expect(salesFindFirst).toHaveBeenCalledTimes(2);
    expect(userFindFirst).toHaveBeenCalledTimes(2);
    expect(refreshed[0]?.schemaStatus).toBe('drift');

    // The fresh result is now the cached one.
    const cached = await computeBranchDiagnostics('');
    expect(userFindFirst).toHaveBeenCalledTimes(2);
    expect(cached[0]?.schemaStatus).toBe('drift');
  });

  it('maps batched aggregates onto the matching store rows', async () => {
    salesGroupBy.mockImplementation((arg: { where?: Record<string, unknown> }) => {
      if (arg?.where && 'etimsStatus' in arg.where) {
        return Promise.resolve([
          { storeId: 'store_thika', _count: { _all: 2 } },
        ]);
      }
      return Promise.resolve([
        {
          storeId: 'store_thika',
          _sum: { totalAmount: 1500 },
          _count: { _all: 3 },
        },
      ]);
    });
    productGroupBy.mockResolvedValue([{ storeId: 'store_thika', _count: { _all: 4 } }]);
    rentalGroupBy.mockResolvedValue([{ storeId: 'store_thika', _count: { _all: 1 } }]);
    debtGroupBy.mockResolvedValue([
      { storeId: 'store_thika', _sum: { balance: 250.5 } },
    ]);
    mpesaGroupBy.mockResolvedValue([{ storeId: 'store_thika', _count: { _all: 1 } }]);
    shiftGroupBy.mockResolvedValue([{ storeId: 'store_thika', _count: { _all: 1 } }]);

    const branches = await computeBranchDiagnostics('');
    const thika = branches.find((b) => b.storeId === 'store_thika');
    expect(thika?.revenueToday).toBe(1500);
    expect(thika?.transactionsToday).toBe(3);
    expect(thika?.lowStockCount).toBe(4);
    expect(thika?.overdueRentalsCount).toBe(1);
    expect(thika?.debtTotal).toBe(250.5);
    expect(thika?.mpesaPendingCount).toBe(1);
    expect(thika?.etimsPendingCount).toBe(2);
    expect(thika?.shiftStatus).toBe('open');

    const juja = branches.find((b) => b.storeId === 'store_juja');
    expect(juja?.revenueToday).toBe(0);
    expect(juja?.shiftStatus).toBe('closed');
  });

  it('degrades failed aggregates to zeros and unknown shift state', async () => {
    salesGroupBy.mockRejectedValue(new Error('boom'));
    productGroupBy.mockRejectedValue(new Error('boom'));
    shiftGroupBy.mockRejectedValue(new Error('boom'));

    const branches = await computeBranchDiagnostics('');
    const thika = branches.find((b) => b.storeId === 'store_thika');
    expect(thika?.revenueToday).toBe(0);
    expect(thika?.transactionsToday).toBe(0);
    expect(thika?.lowStockCount).toBe(0);
    expect(thika?.shiftStatus).toBe('unknown');
    // A diagnostics layer must never throw because an aggregate failed.
    expect(branches.length).toBe(STORES_DEFAULT.length);
  });

  it('returns an empty list when the store query itself fails', async () => {
    storeFindMany.mockRejectedValue(new Error('unreachable'));
    const branches = await computeBranchDiagnostics('');
    expect(branches).toEqual([]);
  });

  it('never returns a reason code outside the documented vocabulary', async () => {
    userFindFirst.mockRejectedValue({ code: 'P2022', message: 'column does not exist' });
    salesGroupBy.mockRejectedValue(new Error('boom'));
    const branches = await computeBranchDiagnostics('');
    const vocabulary = [
      'ready',
      'missing-slug',
      'missing-subdomain',
      'store-inactive',
      'workspace-disabled',
      'invalid-host',
      'reserved-subdomain',
      'path-route-missing',
      'schema-drift',
      'permission-denied',
      'unknown',
    ];
    for (const branch of branches) {
      expect(vocabulary).toContain(branch.reasonCode);
    }
  });
});
