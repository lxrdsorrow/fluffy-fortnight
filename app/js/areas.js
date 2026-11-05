// Downloaded map areas live in the browser's Cache Storage, on the device.
// Nothing here is needed at runtime except what is already downloaded.

const FILES = ['meta.json', 'basemap.pmtiles', 'search.sqlite', 'graph.bin', 'pois.json', 'flood.geojson'];
const LIST_KEY = 'hsm.downloadedAreas';

export const cacheName = (id) => 'hsm-area-' + id;
export const fileUrl = (id, file) => new URL(`data/${id}/${file}`, location.href).href;

function readList() {
  try { return JSON.parse(localStorage.getItem(LIST_KEY) || '{}'); } catch { return {}; }
}
function writeList(list) {
  try { localStorage.setItem(LIST_KEY, JSON.stringify(list)); } catch { /* storage full or blocked */ }
}

/** Areas already saved on this device: {id: meta} */
export function downloadedAreas() { return readList(); }

// Packs this app version knows about. Used if the pack list (areas.json) cannot
// be read, so the Houston pack can still be found from its own meta.json.
export const KNOWN_PACKS = ['houston-metro'];

/**
 * Packs offered by the server. Returns {ok, areas, error}.
 * ok=false with navigator.onLine=true means "online, but the download server
 * did not answer" — that is NOT the same as being offline.
 */
export async function availableAreas() {
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(new URL('data/areas.json', location.href).href + '?t=' + Date.now(), { cache: 'no-store' });
      if (r.ok) {
        const list = (await r.json()).areas || [];
        if (list.length) return { ok: true, areas: list };
        lastError = 'the pack list is empty';
      } else lastError = `the pack list answered ${r.status}`;
    } catch (e) {
      lastError = navigator.onLine ? 'the download server could not be reached' : 'no internet connection';
    }
  }
  // Fallback: ask each known pack directly.
  const found = [];
  for (const id of KNOWN_PACKS) {
    try {
      const r = await fetch(fileUrl(id, 'meta.json') + '?t=' + Date.now(), { cache: 'no-store' });
      if (r.ok) found.push(await r.json());
    } catch { /* keep trying others */ }
  }
  if (found.length) return { ok: true, areas: found };
  return { ok: false, areas: [], error: lastError };
}

/** True when this device can actually reach the internet / download server right now. */
export async function canReachServer() {
  if (!navigator.onLine) return false;
  try {
    // data/ is never answered from the offline cache, so this really goes to the server
    const r = await fetch(new URL('data/areas.json', location.href).href + '?ping=' + Date.now(), { method: 'HEAD', cache: 'no-store' });
    return r.ok || r.status === 404;
  } catch { return false; }
}

/** Download every file of an area. onProgress(doneBytes, totalBytes, fileName) */
export async function downloadArea(area, onProgress) {
  if (navigator.storage && navigator.storage.persist) {
    try { await navigator.storage.persist(); } catch { /* ignore */ }
  }
  const cache = await caches.open(cacheName(area.id) + '-tmp');
  const total = area.bytes || 0;
  let done = 0;
  for (const file of FILES) {
    if (!(file in (area.files || {})) && file !== 'meta.json') continue;
    const url = fileUrl(area.id, file);
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Could not download ${file} (${res.status})`);
    const reader = res.body.getReader();
    const chunks = [];
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      chunks.push(value);
      done += value.length;
      onProgress && onProgress(done, total, file);
    }
    const blob = new Blob(chunks);
    await cache.put(url, new Response(blob, { headers: { 'Content-Length': String(blob.size) } }));
  }
  // Swap in the new copy only after everything downloaded (an old copy keeps working until then).
  await caches.delete(cacheName(area.id));
  const finalCache = await caches.open(cacheName(area.id));
  for (const req of await cache.keys()) await finalCache.put(req, await cache.match(req));
  await caches.delete(cacheName(area.id) + '-tmp');
  const meta = await (await finalCache.match(fileUrl(area.id, 'meta.json'))).json();
  const list = readList();
  list[area.id] = { ...meta, savedAt: new Date().toISOString() };
  writeList(list);
  return meta;
}

export async function deleteArea(id) {
  await caches.delete(cacheName(id));
  await caches.delete(cacheName(id) + '-tmp');
  const list = readList();
  delete list[id];
  writeList(list);
}

/** Read one downloaded file as a Blob (or null if it is not on the device). */
export async function getFile(id, file) {
  const cache = await caches.open(cacheName(id));
  const res = await cache.match(fileUrl(id, file));
  return res ? res.blob() : null;
}

export async function storageEstimate() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  try { return await navigator.storage.estimate(); } catch { return null; }
}

export function formatBytes(b) {
  if (!b) return '0 MB';
  if (b < 1e6) return Math.max(1, Math.round(b / 1e3)) + ' KB';
  if (b < 1e9) return (b / 1e6).toFixed(b < 1e7 ? 1 : 0) + ' MB';
  return (b / 1e9).toFixed(2) + ' GB';
}
