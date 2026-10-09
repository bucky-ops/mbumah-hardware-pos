// MBUMAH HARDWARE POS - Offline queue module (canonical entry point)
//
// The offline queue engine lives in src/lib/offline-sync.ts (IndexedDB queue,
// idempotent replay, reactive pending count). This folder is the canonical
// import path going forward:
//
//   import { syncQueue, getQueueCount, subscribeOfflineCount } from '@/lib/offline';
//
// The flat module is kept at its original location so every existing import
// from '@/lib/offline-sync' keeps resolving to the same implementation. Both
// paths share one module instance, one IndexedDB handle and one subscriber
// list, so the reactive count stays consistent no matter which path a caller
// imports from.

export * from '../offline-sync';
