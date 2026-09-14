// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Cart IndexedDB persistence (zustand PersistStorage)
// ─────────────────────────────────────────────────────────────────────────────
//
// v2.6.0: the POS cart must survive logout, idle timeouts, tab refreshes and
// browser restarts. Previously the cart lived ONLY in memory — any session
// expiry wiped a cashier's carefully-built sale. (The offline-sales queue in
// offline-sync.ts already proved the pattern: IndexedDB via the `idb`
// Promise wrapper.)
//
// CONTRACT: this module exposes a zustand `StateStorage` (string-based)
// adapter so it can be wrapped with `createJSONStorage(() => idbCartStorage)`
// in stores.ts. zustand hands us the ALREADY-JSON-stringified envelope
// `{ state, version? }`; we simply store/retrieve that string in IndexedDB.
//
// SSR-safety: every accessor no-ops (returns null) when `window`/`indexedDB`
// are unavailable, so importing this module from a client component can never
// break the server render.
// ─────────────────────────────────────────────────────────────────────────────

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { StateStorage } from 'zustand/middleware';

const CART_DB_NAME = 'mbumah-pos-cart';
const CART_DB_VERSION = 1;
const CART_STORE = 'cart';

interface CartPersistDB extends DBSchema {
  cart: {
    key: string;
    /** zustand createJSONStorage envelope: JSON.stringify({ state, version }). */
    value: string;
  };
}

// ── Singleton DB handle (lazy) ────────────────────────────────────────────────

let cartDbPromise: Promise<IDBPDatabase<CartPersistDB>> | null = null;

function getCartDB(): Promise<IDBPDatabase<CartPersistDB>> | null {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
    return null;
  }
  if (!cartDbPromise) {
    cartDbPromise = openDB<CartPersistDB>(CART_DB_NAME, CART_DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(CART_STORE)) {
          db.createObjectStore(CART_STORE);
        }
      },
    });
  }
  return cartDbPromise;
}

/**
 * String-based storage adapter for zustand's createJSONStorage.
 * Reads/writes the `{ state, version }` JSON envelope under the store's
 * persistence name ('mbt_cart_v1') inside IndexedDB — durable across
 * logout, refresh and restart (unlike localStorage-per-tab memory).
 */
export const idbCartStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      const db = await getCartDB();
      if (!db) return null;
      const row = await db.get(CART_STORE, name);
      return typeof row === 'string' ? row : null;
    } catch {
      // Corrupted / blocked IndexedDB must never break the POS — start fresh.
      return null;
    }
  },

  setItem: async (name: string, value: string): Promise<void> => {
    try {
      const db = await getCartDB();
      if (!db) return;
      await db.put(CART_STORE, value, name);
    } catch {
      // Quota exceeded / private mode — cart persistence degrades silently;
      // the in-memory cart keeps working for the current session.
    }
  },

  removeItem: async (name: string): Promise<void> => {
    try {
      const db = await getCartDB();
      if (!db) return;
      await db.delete(CART_STORE, name);
    } catch {
      // Ignore — nothing to clean up if the DB is unreachable.
    }
  },
};
