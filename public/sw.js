/*
 * Mbumah Hardware POS — Service Worker (plain JS, no imports).
 *
 * Purpose: make the app shell + read-mostly API traffic survive flaky shop
 * connectivity, so the offline Dexie queue (see src/lib/offline-db.ts) can
 * keep taking sales even when the SPA itself fails to load.
 *
 * Caching strategies (one per route class):
 *  - install:        precache the minimal app shell ("/", "/logo.svg").
 *  - activate:       delete stale caches from old versions, take control.
 *  - non-GET:        pass-through — mutations are NEVER cached; they go to
 *                    the network (and the Dexie queue handles offline replay).
 *  - GET /api/*:     network-first with cache fallback; only successful JSON
 *                    responses land in API_CACHE (never error pages).
 *  - navigations:    network-first, fallback to cached page, then to "/".
 *  - /_next/static   cache-first (immutable, content-hashed assets) —
 *    + images        instant repeat loads, zero revalidation cost.
 */

const SHELL_CACHE = "mbumah-shell-v1";
const API_CACHE = "mbumah-api-v1";
const PRECACHE_URLS = ["/", "/logo.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== API_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Mutations (POST/PUT/PATCH/DELETE) are never intercepted or cached.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // let cross-origin pass through

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirstApi(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (
    url.pathname.startsWith("/_next/static") ||
    /\.(png|jpe?g|gif|svg|webp|ico|woff2?)$/i.test(url.pathname)
  ) {
    event.respondWith(cacheFirstStatic(request));
  }
});

/** GET /api/* — network-first: fresh data wins, cache rescues offline reads. */
async function networkFirstApi(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const contentType = response.headers.get("Content-Type") || "";
      if (contentType.includes("application/json")) {
        // Cache a clone — the original body is consumed by the page.
        const clone = response.clone();
        caches
          .open(API_CACHE)
          .then((cache) => cache.put(request, clone))
          .catch(() => {});
      }
      return response;
    }
    // Non-2xx: prefer a cached copy over surfacing the error, if we have one.
    const cached = await caches.match(request);
    return cached || response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    console.warn("[sw] API unreachable and uncached:", request.url);
    return new Response(JSON.stringify({ error: "offline" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/** Page navigations — network-first, then cache, then the precached shell. */
async function networkFirstNavigation(request) {
  try {
    return await fetch(request);
  } catch (err) {
    const cached = (await caches.match(request)) || (await caches.match("/"));
    if (cached) return cached;
    console.warn("[sw] navigation offline without cache:", request.url);
    return new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
  }
}

/** Immutable static assets — cache-first: the content hash IS the version. */
async function cacheFirstStatic(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const clone = response.clone();
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.put(request, clone))
      .catch(() => {});
  }
  return response;
}
