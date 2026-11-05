// Service worker: keeps the app itself (not the map data) saved on the device
// so it opens with no internet. Map areas are stored separately (js/areas.js).
const VERSION = 'hsm-app-v2';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/main.js', 'js/areas.js', 'js/search.js', 'js/routing.js', 'js/route-worker.js', 'js/places.js',
  'js/guide.js', 'js/normalize.js', 'js/abbrev.js',
  'vendor/maplibre-gl.js', 'vendor/maplibre-gl.css', 'vendor/pmtiles.js', 'vendor/basemaps.js',
  'vendor/sql-wasm.js', 'vendor/sql-wasm.wasm',
  'assets/icon.svg', 'assets/icon-192.png', 'assets/icon-512.png',
  'assets/sprites/light.json', 'assets/sprites/light.png', 'assets/sprites/light@2x.json', 'assets/sprites/light@2x.png',
  'assets/sprites/dark.json', 'assets/sprites/dark.png', 'assets/sprites/dark@2x.json', 'assets/sprites/dark@2x.png',
];
for (const font of ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic']) {
  for (const r of ['0-255', '256-511', '8192-8447']) SHELL.push(`assets/fonts/${font}/${r}.pbf`);
}

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((k) => k.startsWith('hsm-app-') && k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const scope = new URL(self.registration.scope);
  const rel = url.pathname.slice(scope.pathname.length);
  if (rel.startsWith('data/')) return; // map data is handled by the app itself
  // Font ranges we did not pre-save: answer with an empty glyph set instead of an error
  e.respondWith((async () => {
    const hit = await caches.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(e.request);
      if (res.ok) (await caches.open(VERSION)).put(e.request, res.clone());
      return res;
    } catch {
      if (rel.startsWith('assets/fonts/')) return new Response(new Uint8Array(0), { headers: { 'Content-Type': 'application/x-protobuf' } });
      if (e.request.mode === 'navigate') return (await caches.match('index.html')) || Response.error();
      return Response.error();
    }
  })());
});
