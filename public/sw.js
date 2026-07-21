const VERSION = "2.16.1";
const SHELL_CACHE = `tigre-shell-${VERSION}`;
const MEDIA_CACHE = `tigre-media-${VERSION}`;
const CACHE_PREFIX = "tigre-";
const SHELL_URLS = [
  "/player.js",
  "/player.css",
  "/config.js",
  "/images/icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith(CACHE_PREFIX) && ![SHELL_CACHE, MEDIA_CACHE].includes(key))
        .map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

const networkFirst = async (request, cacheName) => {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok && response.status === 200) await cache.put(request, response.clone());
    return response;
  } catch (_error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw _error;
  }
};

const parseRange = (header, size) => {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header || "");
  if (!match) return null;
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
};

const cachedRangeResponse = async (request, cached) => {
  const buffer = await cached.arrayBuffer();
  const range = parseRange(request.headers.get("range"), buffer.byteLength);
  if (!range) return cached;
  const sliced = buffer.slice(range.start, range.end + 1);
  const headers = new Headers(cached.headers);
  headers.set("Content-Range", `bytes ${range.start}-${range.end}/${buffer.byteLength}`);
  headers.set("Content-Length", `${sliced.byteLength}`);
  headers.set("Accept-Ranges", "bytes");
  return new Response(sliced, { status: 206, statusText: "Partial Content", headers });
};

const serveMedia = async (request) => {
  const cache = await caches.open(MEDIA_CACHE);
  const cached = await cache.match(request.url);
  if (cached) {
    if (request.headers.has("range")) return cachedRangeResponse(request, cached.clone());
    return cached;
  }
  const response = await fetch(request);
  if (response.ok && response.status === 200 && !request.headers.has("range")) {
    await cache.put(request.url, response.clone()).catch(() => {});
  }
  return response;
};

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/media/")) {
    event.respondWith(serveMedia(request));
    return;
  }
  if (url.pathname === "/api/media/manifest") {
    event.respondWith(networkFirst(request, MEDIA_CACHE));
    return;
  }
  if (request.mode === "navigate" || SHELL_URLS.includes(url.pathname)) {
    event.respondWith(networkFirst(request, SHELL_CACHE));
  }
});

const cachePlaylist = async (urls = []) => {
  const cache = await caches.open(MEDIA_CACHE);
  const unique = [...new Set(urls)].filter((url) => {
    try {
      const parsed = new URL(url, self.location.origin);
      return parsed.origin === self.location.origin && parsed.pathname.startsWith("/media/");
    } catch (_error) {
      return false;
    }
  });
  let cachedCount = 0;
  for (const url of unique) {
    try {
      const request = new Request(url, { cache: "no-cache" });
      const existing = await cache.match(request.url);
      if (existing) {
        cachedCount += 1;
        continue;
      }
      const response = await fetch(request);
      if (!response.ok || response.status !== 200) continue;
      await cache.put(request.url, response);
      cachedCount += 1;
    } catch (_error) {}
  }
  if (unique.length > 0 && cachedCount === unique.length) {
    const desired = new Set(unique.map((url) => new URL(url, self.location.origin).href));
    const keys = await cache.keys();
    await Promise.all(keys.map((request) => {
      const parsed = new URL(request.url);
      if (!parsed.pathname.startsWith("/media/") || desired.has(parsed.href)) return Promise.resolve(false);
      return cache.delete(request);
    }));
  }
  return { requested: unique.length, cached: cachedCount };
};

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type !== "CACHE_PLAYLIST") return;
  event.waitUntil(
    cachePlaylist(event.data.urls || []).then((result) => {
      event.source?.postMessage({ type: "CACHE_PLAYLIST_RESULT", ...result });
    })
  );
});
