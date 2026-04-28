const CACHE_NAME = 'kintai-v2';
const ASSET_CACHE = 'kintai-assets-v2';
const NAV_FALLBACK = '/index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add(NAV_FALLBACK)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  const keep = new Set([CACHE_NAME, ASSET_CACHE]);
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('kintai-') && !keep.has(k))
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // sw.js 自身は素通り
  if (url.pathname === '/sw.js') return;

  // Supabase API は network-only（既存挙動温存）
  if (url.pathname.includes('/rest/') || url.pathname.includes('/auth/')) {
    event.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  // ナビゲーション (HTML) は network-first
  const isNavigation =
    req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');
  if (isNavigation) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(NAV_FALLBACK, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(NAV_FALLBACK))
    );
    return;
  }

  // /assets/* は cache-first（ハッシュ付きで一意）
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(ASSET_CACHE).then((cache) =>
        cache.match(req).then((cached) => {
          if (cached) return cached;
          return fetch(req).then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          });
        })
      )
    );
    return;
  }

  // その他は network-first
  event.respondWith(fetch(req).catch(() => caches.match(req)));
});
