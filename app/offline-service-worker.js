const SHELL_CACHE = "project-manager-shell-v2";
const OFFLINE_API_CACHE = "project-manager-api-v2";
const SHELL_ASSETS = [
  "/",
  "/project",
  "/site.webmanifest?v=1",
  "/static/app-shell.css?v=38",
  "/static/app-shell.js?v=13",
  "/static/offline-data.js?v=1",
  "/static/iconify-catalog.js?v=1",
  "/static/icon-192.png?v=4",
  "/static/icon-512.png?v=4",
  "/static/apple-touch-icon.png?v=4",
  "/static/icon-placeholder.svg",
];

const isCachedApiRequest = url => {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname === "/api/deleted-items") return true;
  return /^\/api\/projects\/(?![^/]+\/files\/)/.test(url.pathname)
    || url.pathname === "/api/projects";
};

self.addEventListener("install", event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key.startsWith("project-manager-") && ![SHELL_CACHE, OFFLINE_API_CACHE].includes(key))
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error("No cached response available");
  }
}

self.addEventListener("fetch", event => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.method !== "GET") {
    if (url.pathname.startsWith("/api/")) {
      event.waitUntil(caches.delete(OFFLINE_API_CACHE));
    }
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, SHELL_CACHE).catch(async () => {
      const cache = await caches.open(SHELL_CACHE);
      return cache.match(url.pathname === "/project" ? "/project" : "/");
    }));
    return;
  }

  if (isCachedApiRequest(url)) {
    // navigator.onLine is not a guarantee, but when it says offline never
    // wait for a network timeout before showing an already cached project.
    event.respondWith((async () => {
      const cache = await caches.open(OFFLINE_API_CACHE);
      if (!self.navigator.onLine) {
        const cached = await cache.match(request);
        if (cached) return cached;
      }
      return networkFirst(request, OFFLINE_API_CACHE);
    })());
    return;
  }

  if (url.pathname.startsWith("/static/") || url.pathname === "/site.webmanifest") {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok) caches.open(SHELL_CACHE).then(cache => cache.put(request, response.clone()));
      return response;
    })));
  }
});
