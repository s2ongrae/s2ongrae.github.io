/* ═══════════════════════════════════════════════════════════
   💬 AI 비서 회의실 — Service Worker
   · 하는 일 두 가지: ① 홈 화면 앱 설치 요건 ② 오프라인일 때 껍데기
   · 화면·코드는 **네트워크 먼저(no-store)** — 캐시가 예전 화면을 붙잡지 않게(포털 방침과 같음)
   · Apps Script(다른 주소) 요청은 건드리지 않습니다
   ═══════════════════════════════════════════════════════════ */
const ROOM_VER = 'room-v2';
const ROOM_SHELL = [
  './', './index.html', './app.css', './app.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(ROOM_VER).then(c => c.addAll(ROOM_SHELL)).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== ROOM_VER && k.indexOf('room-') === 0).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                         // 오더 접수(POST)는 그대로 통과
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // Apps Script 등 바깥은 손대지 않음
  let scopePath = '/room/';
  try { scopePath = new URL(self.registration.scope).pathname; } catch (_) {}
  if (url.pathname.indexOf(scopePath) !== 0) return;
  e.respondWith((async () => {
    const cache = await caches.open(ROOM_VER);
    try {
      // GitHub Pages 는 정적 파일을 10분 캐시한다 — no-store 로 항상 새 코드를 받아요
      const res = await fetch(req, {cache: 'no-store'});
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch (_) {
      const hit = await cache.match(req, {ignoreSearch: true});
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const shell = (await cache.match('./index.html')) || (await cache.match('./'));
        if (shell) return shell;
      }
      return new Response('오프라인 — 인터넷이 연결되면 다시 열려요', {
        status: 503, headers: {'Content-Type': 'text/plain; charset=utf-8'}
      });
    }
  })());
});
