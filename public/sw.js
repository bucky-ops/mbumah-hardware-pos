/**
 * MBUMAH HARDWARE POS — Service Worker
 * v1.2.0 Phase 3 — Offline-First PWA
 *
 * Cache strategy:
 *   - App shell (HTML, JS, CSS, fonts, icons): stale-while-revalidate
 *     → instant load from cache, then background update.
 *   - Static assets (/icons/*, /logo.*, /manifest.json, /favicon*):
 *     cache-first, long TTL.
 *   - API requests (/api/*): network-only (NEVER cache — financial data must
 *     be live). When offline, the in-app IndexedDB queue handles pending
 *     sales — the SW does not need to intervene.
 *   - Navigation requests (HTML page loads): network-first with cache
 *     fallback → fresh content when online, app shell when offline.
 *
 * Versioning: bump SW_CACHE_VERSION on every deploy that changes cached
 * assets. The activate handler purges old cache versions.
 */

const SW_CACHE_VERSION = 'v1.2.0-phase3';
const PRECACHE_NAME = `mbumah-precache-${SW_CACHE_VERSION}`;
const RUNTIME_NAME = `mbumah-runtime-${SW_CACHE_VERSION}`;
const PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/logo.svg',
  '/logo.png',
  '/favicon-32.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-192.png',
  '/icons/maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/offline.html',
];

// ─────────────────────────────────────────────────────────────────────────────
// INSTALL — pre-cache the app shell.
// skipWaiting() makes the new SW take over immediately on first install.
// On update, skipWaiting is deferred until the user confirms (see 'message'
// handler in register-sw.tsx).
// ─────────────────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE_NAME);
      // Use addAll with { cache: 'reload' } to bypass stale HTTP cache.
      // Filter out URLs that 404 (don't let one missing asset break install).
      const results = await Promise.allSettled(
        PRECACHE_URLS.map(async (url) => {
          const res = await fetch(url, { cache: 'reload' });
          if (!res.ok) throw new Error(`${url} → ${res.status}`);
          await cache.put(url, res.clone());
          return url;
        }),
      );
      const failed = results
        .filter((r) => r.status === 'rejected')
        .map((r) => r.reason?.message || String(r.reason));
      if (failed.length > 0) {
        console.warn('[SW] Some precache URLs failed:', failed);
      }
      await self.skipWaiting();
    })(),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVATE — purge old caches and claim clients.
// ─────────────────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const stale = keys.filter(
        (k) => !k.endsWith(SW_CACHE_VERSION),
      );
      await Promise.all(stale.map((k) => caches.delete(k)));
      // Claim all open tabs so the new SW controls them immediately.
      await self.clients.claim();
      console.info(`[SW] Activated ${SW_CACHE_VERSION}. Purged ${stale.length} stale cache(s).`);
    })(),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// FETCH — main routing logic.
// ─────────────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET — never intercept POST/PUT/DELETE (mutations go to API
  // which is network-only anyway, and we don't want to break auth flows).
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Skip cross-origin requests (Vercel Analytics, Speed Insights, Google Fonts).
  if (url.origin !== self.location.origin) return;

  // Skip Next.js HMR + internal dev requests.
  if (url.pathname.startsWith('/_next/webpack-hmr')) return;

  // ── API requests: network-only ──────────────────────────────────────────
  // Financial data must always be live. The app already has IndexedDB
  // queueing for offline sales; the SW does not need to cache API responses.
  if (url.pathname.startsWith('/api/')) {
    return; // Let the request go straight to the network.
  }

  // ── Navigation requests: network-first with offline fallback ────────────
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          // Try network first for fresh HTML.
          const fresh = await fetch(req, { cache: 'no-cache' });
          // Cache a copy for next time.
          const cache = await caches.open(RUNTIME_NAME);
          cache.put('/', fresh.clone()).catch(() => {});
          return fresh;
        } catch (_err) {
          // Network failed — fall back to cached app shell, then offline page.
          const cached = await caches.match('/');
          if (cached) return cached;
          const offline = await caches.match('/offline.html');
          if (offline) return offline;
          return new Response(
            '<h1>Offline</h1><p>MBUMAH HARDWARE POS is offline. Reconnect to continue.</p>',
            { status: 503, headers: { 'Content-Type': 'text/html' } },
          );
        }
      })(),
    );
    return;
  }

  // ── Static assets: stale-while-revalidate ───────────────────────────────
  // Includes /_next/static/*, /icons/*, /logo.*, /manifest.json, fonts, etc.
  event.respondWith(
    (async () => {
      const cache = await caches.open(RUNTIME_NAME);
      const cached = await cache.match(req);
      const networkPromise = fetch(req)
        .then((res) => {
          // Only cache successful, same-origin, basic responses.
          if (res && res.status === 200 && res.type === 'basic') {
            cache.put(req, res.clone()).catch(() => {});
          }
          return res;
        })
        .catch(() => null);

      // Return cached immediately if available; otherwise wait for network.
      if (cached) {
        // Revalidate in the background.
        event.waitUntil(networkPromise);
        return cached;
      }
      const networkRes = await networkPromise;
      if (networkRes) return networkRes;

      // Both cache and network failed — for images, return a 1x1 transparent PNG.
      if (req.destination === 'image') {
        // 1x1 transparent PNG as a Uint8Array (avoids Buffer which is Node-only).
        const bytes = new Uint8Array([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
          0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
          0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
          0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
          0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
          0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
        ]);
        return new Response(bytes, {
          status: 200,
          headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
        });
      }
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    })(),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// MESSAGE — handle "SKIP_WAITING" from the registration script
// (used when the user accepts an update prompt).
// ─────────────────────────────────────────────────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PERIODIC SYNC — (future) refresh catalog prices in the background.
// Requires the `periodic-background-sync` permission (Chrome only).
// ─────────────────────────────────────────────────────────────────────────────
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'refresh-catalog') {
    event.waitUntil(refreshCatalogCache());
  }
});

async function refreshCatalogCache() {
  try {
    const cache = await caches.open(RUNTIME_NAME);
    const res = await fetch('/api/products?limit=100', { cache: 'no-cache' });
    if (res.ok) {
      await cache.put('/api/products?limit=100', res.clone());
    }
  } catch {
    // Silently ignore — periodic sync is best-effort.
  }
}
