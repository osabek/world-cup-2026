/* ⚽ Road to the Cup 2026 — service worker (offline + installable).
   Strategy chosen to AVOID stale-content traps:
   - same-origin app shell & code  -> network-first, fall back to cache offline
   - same-origin static data (JSON) -> stale-while-revalidate (fast + self-updating)
   - cross-origin (Firebase SDK/API, ESPN, Firestore) -> not handled (straight to network)
   Bump CACHE_VERSION to retire old caches on deploy. */
const CACHE_VERSION = "rtc-2026-v3";
const SHELL = [
  ".", "index.html", "styles.css", "app.js", "cloud.js",
  "firebase-config.js?v=20260611a", "manifest.webmanifest",
  "data/teams.json", "data/schedule.json",
  "data/squads-ab.json", "data/squads-cd.json", "data/squads-ef.json",
  "data/squads-gh.json", "data/squads-ij.json", "data/squads-kl.json",
  "icons/icon-192.png", "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(SHELL).catch(() => {})));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // cross-origin -> network (Firebase, ESPN, etc.)

  const isData = url.pathname.includes("/data/") && url.pathname.endsWith(".json");

  if (isData) {
    // stale-while-revalidate
    e.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(req);
      const network = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
      return cached || (await network) || new Response("[]", { headers: { "Content-Type": "application/json" } });
    })());
    return;
  }

  // app shell & code: network-first so updates always win when online
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok) { const cache = await caches.open(CACHE_VERSION); cache.put(req, res.clone()); }
      return res;
    } catch {
      const cached = await caches.match(req);
      if (cached) return cached;
      if (req.mode === "navigate") return (await caches.match("index.html")) || (await caches.match("."));
      throw new Error("offline and uncached");
    }
  })());
});
