import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Vitest configuration for the Mbumah Hardware POS project.
//
// Test isolation strategy: financial-accounting tests exercise
// `recordSaleJournalEntry` against the real Prisma + SQLite stack. To keep
// tests hermetic without a per-test ephemeral database, we use a
// rollback-transaction pattern inside each test (see src/tests/setup.ts).
// The jsdom environment is required by @testing-library/react for any
// future component tests; pure-logic tests are unaffected.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/tests/setup.ts'],
    include: [
      'src/tests/**/*.test.{ts,tsx}',
      'src/__tests__/**/*.test.{ts,tsx}',
    ],
    // Financial tests touch the filesystem SQLite DB; allow generous time.
    testTimeout: 30000,
    hookTimeout: 30000,
    reporters: ['default'],
    // AUDIT FIX (Finding 4.1 — no coverage measurement): wire the v8
    // coverage provider so `vitest run --coverage` produces text/lcov
    // reports over first-party source. Thresholds are INTENTIONALLY not
    // enforced yet — the current suite covers lib logic, not the 60+ API
    // routes, so a hard gate would go red immediately. Revisit once route
    // tests land (audit recommendation: 70% lines/functions/statements,
    // 60% branches); uncomment and raise progressively.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/lib/**', 'src/app/api/**'],
      exclude: [
        'src/tests/**',
        'src/__tests__/**',
        '**/*.d.ts',
        // OpenAPI doc is a static data module — exclude from coverage.
        'src/lib/openapi.ts',
      ],
      // thresholds: { lines: 70, functions: 70, branches: 60, statements: 70 },
    },
  },
  resolve: {
    // Native tsconfig path resolution (replaces the deprecated
    // vite-tsconfig-paths plugin). Resolves `@/*` → `./src/*`.
    tsconfigPaths: true,
  },
});
