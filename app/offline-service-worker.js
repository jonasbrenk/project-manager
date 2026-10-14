const SHELL_CACHE = "project-manager-shell-v25";
const FILE_CACHE = "project-manager-files-v1";
const PAGES = new Set(["/", "/project"]);
const RUNTIME_ASSET_PATHS = new Set([
  "/static/app-shell.css",
  "/static/app-shell.js",
  "/static/pm-store.js",
  "/static/iconify-catalog.js",
]);
const SHELL_ASSETS = [
  "/",
  "/project",
  "/site.webmanifest?v=1",
  "/static/app-shell.css?v=47",
  "/static/app-shell.js?v=16",
  "/static/pm-store.js?v=1",
  "/static/iconify-catalog.js?v=1",
  "/static/icon-192.png?v=4",
  "/static/icon-512.png?v=4",
  "/static/apple-touch-icon.png?v=4",
  "/static/icon-placeholder.svg",
];

// Project data lives in the pages' local store (pm-store.js), so the worker
// only has to keep the app itself available. It never waits on the network
// for something it has cached: an unreachable server must not stall the UI.

async function refreshShell() {
  const cache = await caches.open(SHELL_CACHE);
  await Promise.all(SHELL_ASSETS.map(async url => {
    try {
      const response = await fetch(url, { cache: "reload" });
      if (response.ok) await cache.put(url, response);
    } catch { }
  }));
}

self.addEventListener("install", event => {
  event.waitUntil(caches.open(SHELL_CACHE)
    .then(cache => cache.addAll(SHELL_ASSETS.map(url => new Request(url, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key.startsWith("project-manager-") && ![SHELL_CACHE, FILE_CACHE].includes(key))
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", event => {
  if (event.data?.type !== "refresh-shell") return;
  event.waitUntil(refreshShell().then(() => event.ports[0]?.postMessage("done")));
});

// Answer from the cache immediately and refresh it in the background.
async function staleWhileRevalidate(event, cacheKey, fetchOptions) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(cacheKey);
  const update = fetch(event.request, fetchOptions).then(response => {
    if (response.ok) cache.put(cacheKey, response.clone());
    return response;
  });
  if (!cached) return update;
  event.waitUntil(update.catch(() => {}));
  return cached;
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === "opaque") cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Project icons come from Iconify; keep each SVG once it has loaded.
  if (url.origin === "https://api.iconify.design" && url.pathname.endsWith(".svg")) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate" && PAGES.has(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event, url.pathname));
    return;
  }

  if (RUNTIME_ASSET_PATHS.has(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event, request, { cache: "no-cache" }));
    return;
  }

  // Uploaded files never change under the same id. A copy saved for offline
  // use is therefore always current; everything else goes to the network.
  if (/^\/api\/projects\/[^/]+\/files\/[^/]+$/.test(url.pathname)) {
    event.respondWith(caches.open(FILE_CACHE)
      .then(cache => cache.match(request))
      .then(cached => cached || fetch(request)));
    return;
  }

  if (url.pathname.startsWith("/static/") || url.pathname === "/site.webmanifest") {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
  }
});
