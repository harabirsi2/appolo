/**
 * Appolo service worker.
 *
 * Three jobs, deliberately kept in one file with no build step:
 *   1. app shell + static assets survive going offline,
 *   2. cover art is served from cache immediately (stale-while-revalidate),
 *   3. a vote taken offline is queued and replayed with its idempotency key,
 *      so the rating never gets applied twice.
 *
 * API responses are network-first and are NOT cached: they are per-account and
 * a shared device must never show the previous user's feed.
 */

const VERSION = "appolo-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const IMG_CACHE = `${VERSION}-img`;
const STATIC_CACHE = `${VERSION}-static`;
const IMG_MAX_ENTRIES = 240;
const SHELL_ASSETS = ["/offline", "/icons/icon-192.png", "/icons/icon-512.png", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

/* ------------------------------- strategies ------------------------------- */

/** Hashed Next assets never change: cache-first and forget about them. */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

/** Serve what we have, refresh in the background, trim the cache afterwards. */
async function staleWhileRevalidate(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone()).then(() => trim(cache, maxEntries));
      }
      return response;
    })
    .catch(() => null);
  return hit ?? (await network) ?? Response.error();
}

async function trim(cache, maxEntries) {
  if (!maxEntries) return;
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  // Oldest inserted first: Cache API keys are in insertion order.
  for (const key of keys.slice(0, keys.length - maxEntries)) await cache.delete(key);
}

/** Network first, cache only as an offline fallback for public GETs. */
async function networkFirst(request, cacheName, timeoutMs) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetchWithTimeout(request, timeoutMs);
    if (response.ok && isCacheableApi(request)) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw error;
  }
}

function fetchWithTimeout(request, timeoutMs) {
  if (!timeoutMs) return fetch(request);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(request, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

/** Only public, account-independent reads are allowed into the cache. */
function isCacheableApi(request) {
  const url = new URL(request.url);
  return url.pathname === "/api/catalog" || url.pathname === "/api/health";
}

function isImage(request) {
  const url = new URL(request.url);
  return (
    url.pathname.startsWith("/_next/image") ||
    url.pathname.startsWith("/covers/") ||
    url.pathname.startsWith("/cache/covers/") ||
    url.pathname.startsWith("/icons/")
  );
}

function isVote(request) {
  return request.method === "POST" && /^\/api\/rankings\/[^/]+\/vote$/.test(new URL(request.url).pathname);
}

/* ------------------------------ offline votes ----------------------------- */

const DB_NAME = "appolo-outbox";
const STORE = "votes";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function queueVote(entry) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(entry);
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function queuedVotes() {
  const db = await openDb();
  const rows = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return rows;
}

async function dropVote(key) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/**
 * Replay queued votes in order.
 *
 * Every entry carries the idempotency key the client generated, so a vote that
 * actually reached the server before the connection dropped (and was applied)
 * comes back as a replay instead of moving Elo twice.
 */
async function flushVotes() {
  const entries = await queuedVotes();
  if (entries.length === 0) return 0;
  let flushed = 0;
  for (const entry of entries) {
    try {
      const response = await fetch(entry.url, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": entry.key },
        body: entry.body,
      });
      // 4xx means the vote can never succeed (item deleted, kind mismatch);
      // dropping it prevents an endless retry loop.
      if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
        await dropVote(entry.key);
        if (response.ok) flushed += 1;
      }
    } catch {
      break; // still offline: keep the rest queued
    }
  }
  if (flushed > 0) {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clients) client.postMessage({ type: "votes-flushed", count: flushed });
  }
  return flushed;
}

self.addEventListener("sync", (event) => {
  if (event.tag === "flush-votes") event.waitUntil(flushVotes());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "flush-votes") event.waitUntil(flushVotes());
});

/* --------------------------------- fetch --------------------------------- */

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isVote(request)) {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request.clone());
        } catch {
          const body = await request.clone().text();
          const key = request.headers.get("idempotency-key");
          if (!key) return Response.error();
          await queueVote({ key, url: request.url, body, createdAt: Date.now() });
          try {
            const registration = await self.registration;
            if (registration.sync) await registration.sync.register("flush-votes");
          } catch {
            /* background sync unsupported: the page will ask us to flush on reconnect */
          }
          return new Response(JSON.stringify({ queued: true }), {
            status: 202,
            headers: { "content-type": "application/json" },
          });
        }
      })(),
    );
    return;
  }

  if (request.method !== "GET") return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetchWithTimeout(request, 4000);
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          const offline = await cache.match("/offline");
          return offline ?? Response.error();
        }
      })(),
    );
    return;
  }

  if (isImage(request)) {
    event.respondWith(staleWhileRevalidate(request, IMG_CACHE, IMG_MAX_ENTRIES));
    return;
  }

  if (url.pathname.startsWith("/_next/static")) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(request, SHELL_CACHE, 5000));
  }
});

/* ---------------------------------- push --------------------------------- */

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const title = payload.title || "Appolo";
  const options = {
    body: payload.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: payload.tag || "appolo",
    data: { url: payload.url || "/app" },
    vibrate: [12, 60],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/app";
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(target);
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
