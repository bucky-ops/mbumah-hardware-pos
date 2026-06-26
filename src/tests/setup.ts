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

// Load environment variables from .env (same as the Next.js app) using a
// minimal manual parser so the test suite doesn't depend on `dotenv` being
// hoisted as a direct dependency.
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  const raw = readFileSync(envPath, 'utf-8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

// The dev database is SQLite at prisma/dev.db — confirm DATABASE_URL is set.
if (!process.env.DATABASE_URL) {
  // Fall back to the standard dev path so `vitest run` works out of the box.
  process.env.DATABASE_URL = 'file:./prisma/dev.db';
}

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
