// APIやログインをキャッシュせず、自分のアプリの静的ファイルだけを保存する。
const VERSION = 'inquiry-complete-20261110-studio-v2';
self.addEventListener('install', (event) => event.waitUntil((async () => {
  const cache = await caches.open(VERSION);
  const manifest = await (await fetch(new URL('offline-files.json', self.registration.scope), { cache: 'no-store' })).json();
  // どれかの必須ファイルが欠ければ更新を有効にしない（古い完成版を維持）。
  await cache.addAll(manifest.files.map((p) => new URL(p, self.registration.scope).href));
  await self.skipWaiting();
})()));
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  for (const key of await caches.keys()) if ((key.startsWith('inquiry-complete-') && key !== VERSION) || key === 'inquiry-voice-assets-v1') await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url), scope = new URL(self.registration.scope);
  if (event.request.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const path = url.pathname.slice(scope.pathname.length);
  if (/^(api|relay)\//.test(path)) return;
  if (path && !/\.(html|js|json|css|gz|webmanifest|svg|png)$/.test(path)) return;
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const key = new URL(path || 'index.html', scope).href;
    try {
      const response = await fetch(event.request);
      if (response.ok) await cache.put(key, response.clone());
      return response;
    } catch {
      return (await cache.match(key)) ?? Response.error();
    }
  })());
});
