// Global test setup for the Mbumah Hardware POS Vitest suite.
//
// Responsibilities:
//   1. Ensure the SQLite DATABASE_URL points at the dev database so tests
//      run against a real Prisma client (financial-accounting tests need
//      actual journal-entry persistence to verify double-entry correctness).
//   2. Stub browser-only globals (IntersectionObserver, matchMedia) that
//      jsdom doesn't provide but which some transitively-imported UI modules
//      reference at load time.
//   3. Provide a shared `orgId` + `storeId` + `cashierId` fixture for the
//      accounting tests (matches the seeded dev DB).

// Resolve the absolute path to the SQLite dev database.
// This avoids any ambiguity about relative-path resolution between
// the Prisma CLI (relative to schema dir) and the Prisma Client
// (also relative to schema dir, but can differ based on how the
// process was launched). An absolute path is always unambiguous.
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve the absolute path to the SQLite dev database.
// This avoids any ambiguity about relative-path resolution between
// the Prisma CLI (relative to schema dir) and the Prisma Client
// (also relative to schema dir, but can differ based on how the
// process was launched). An absolute path is always unambiguous.
const DB_PATH = resolve(__dirname, '../../prisma/prisma/dev.db');
const DB_URL = `file:${DB_PATH}`;

// Always force-set DATABASE_URL and DIRECT_URL for tests, regardless
// of what .env or the shell environment provides. This ensures the
// test suite always hits the seeded SQLite dev database.
process.env.DATABASE_URL = DB_URL;
process.env.DIRECT_URL = DB_URL;

// jsdom doesn't define IntersectionObserver, but some imported UI modules
// reference it at module-load time. Stub it to avoid crashes.
if (typeof globalThis.IntersectionObserver === 'undefined') {
  class IntersectionObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
    IntersectionObserverStub;
}

// matchMedia is required by some shadcn/ui components imported transitively.
if (typeof globalThis.matchMedia === 'undefined') {
  (globalThis as unknown as { matchMedia: unknown }).matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
