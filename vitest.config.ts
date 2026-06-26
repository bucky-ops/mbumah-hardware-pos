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
  },
  resolve: {
    // Native tsconfig path resolution (replaces the deprecated
    // vite-tsconfig-paths plugin). Resolves `@/*` → `./src/*`.
    tsconfigPaths: true,
  },
});
