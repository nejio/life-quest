const CACHE_NAME = 'lifequest-v5';
const ASSETS = [
  './',
  './index.html',
  './bundle.js',
  // プレイヤーアバター（bundle.jsから外部化した進化段階別画像）
  './avatars/wanderer.png',
  './avatars/acolyte.png',
  './avatars/knight.png',
  './avatars/archon.png',
  './avatars/sovereign.png',
];

// インストール時にキャッシュ
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// 古いキャッシュを削除
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ネットワーク優先、失敗時はキャッシュ
self.addEventListener('fetch', event => {
  // GET以外（Firestore同期のPATCH等）はService Workerの介入対象外にする
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request, { cache: 'no-store' }) // ブラウザ/CDNのHTTPキャッシュを確実に迂回
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
