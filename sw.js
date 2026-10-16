/* 账迹 PWA · Service Worker
   策略：自己托管的文件用 stale-while-revalidate（保证离线可开），用户导入的数据永不进缓存。 */
const V = 'zhangji-v2';
const CORE = ['index.html', 'styles.css', 'app.js', 'parser.js', 'gbk-table.js', 'manifest.webmanifest'];
const ICONS = [
  './', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png',
  'icons/apple-touch-icon.png', 'icons/icon-152.png', 'icons/icon-167.png',
  'icons/favicon-32.png', 'icons/favicon-16.png'
];

/* 逐个请求 + 单项超时：慢速主机（免费隧道/移动网络）上并发 15 个请求会排队到超时，
   只要有一个永不返回，Promise.all 就会把 install 永远卡在 installing 状态。 */
function timed(u, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(new Request(u, { cache: 'reload', signal: ctrl.signal })).then(r => {
    clearTimeout(t); return r;
  }).finally(() => clearTimeout(t));
}

async function precache() {
  const c = await caches.open(V);
  for (const u of CORE.concat(ICONS)) {
    try {
      const r = await timed(u, 8000);
      if (r && r.ok) await c.put(u, r);
    } catch (e) { /* 单项失败不影响离线主流程 */ }
  }
}

self.addEventListener('install', e => {
  e.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;              // 不碰外部请求
  if (url.pathname.endsWith('/sw.js')) return;
  e.respondWith(
    caches.match(req).then(hit => {
      const fresh = fetch(req).then(res => {
        if (res && res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(req, cp)); }
        return res;
      }).catch(() => hit);
      return hit || fresh;
    })
  );
});
