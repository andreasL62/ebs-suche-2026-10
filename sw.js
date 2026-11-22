// Offline-Start der App: App-Dateien kommen aus dem Gerätespeicher, Updates werden im Hintergrund geholt.
// PDF und Suchdaten liegen nicht hier, sondern im Dateispeicher der App (siehe store.js).
const CACHE = 'ebs2-v22';
const SHELL = ['./', 'index.html', 'app.js', 'store.js', 'opfs-worker.js', 'style.css', 'olreg.js', 'olreg.css', 'manifest.webmanifest',
  'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'lib/pdf.min.js', 'lib/pdf.worker.min.js'];
const NO_CACHE = ['/doc.pdf', '/ebs-daten.bin', '/info', '/ca.cer'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('ebs2-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || NO_CACHE.some(p => url.pathname.endsWith(p))) return;
  const key = req.mode === 'navigate' ? 'index.html' : req;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const hit = await cache.match(key, { ignoreSearch: true });
    const net = fetch(req).then(res => {
      if (res.ok && res.type === 'basic') cache.put(key, res.clone());
      return res;
    }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    return (await net) || new Response('Offline', { status: 503 });
  }));
});
