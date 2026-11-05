// Offline address and place search using the SQLite index built from OSM.
// sql.js (SQLite compiled for the browser) is loaded by index.html.
import { normalize } from './normalize.js';
import { getFile } from './areas.js';

let SQL = null;
let db = null;
let dbArea = null;

const DROP = new Set(['tx', 'texas', 'usa', 'united', 'states']);

export async function openSearch(areaId) {
  if (dbArea === areaId && db) return true;
  if (!SQL) SQL = await window.initSqlJs({ locateFile: (f) => 'vendor/' + f });
  const blob = await getFile(areaId, 'search.sqlite');
  if (!blob) return false;
  if (db) db.close();
  db = new SQL.Database(new Uint8Array(await blob.arrayBuffer()));
  dbArea = areaId;
  return true;
}

function rows(sql, params) {
  const st = db.prepare(sql);
  st.bind(params);
  const out = [];
  while (st.step()) out.push(st.getAsObject());
  st.free();
  return out;
}

function ftsQuery(tokens) {
  // every word must match; the last word may be unfinished (prefix match)
  return tokens.map((t, i) => (i === tokens.length - 1 || /^\d+$/.test(t) ? t + '*' : t)).join(' ');
}

function match(tokens, limit = 400) {
  if (!tokens.length) return [];
  return rows(
    'SELECT p.* FROM p WHERE p.id IN (SELECT docid FROM f WHERE f MATCH ? LIMIT ?)',
    [ftsQuery(tokens), limit]);
}

function km(a, b) {
  const R = 6371, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function score(r, tokens, hn, near) {
  let s = 0;
  const words = new Set(normalize(r.label + ' ' + (r.sub || '')).split(' '));
  for (const t of tokens) if (words.has(t)) s += 6;
  if (hn) {
    if (r.kind === 'address' && r.hn === hn) s += 100;
    else if (r.kind === 'street') s += 20;
  } else {
    s += { place: 12, street: 10, zip: 8, address: 0 }[r.kind] || 0;
  }
  if (near) s -= Math.min(15, km(near, r) / 2);
  return s;
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((r) => {
    const k = r.label + '|' + r.sub + '|' + (r.kind === 'street' ? '' : r.lat.toFixed(4));
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Returns {results: [...], note: string|null}. A note means "no exact match,
 * these are the closest" — the app must show it, never jump silently.
 */
export function search(query, near, limit = 8) {
  if (!db) return { results: [], note: 'No map area downloaded yet.' };
  let tokens = normalize(query).split(' ').filter((t) => t && !DROP.has(t));
  const hn = tokens.length > 1 && /^\d+[a-z]?$/.test(tokens[0]) ? tokens[0] : null;
  if (hn && tokens.length > 2) tokens = tokens.filter((t, i) => i === 0 || t !== 'houston');
  if (!tokens.length) return { results: [], note: null };

  let found = match(tokens);
  let note = null;

  if (hn && !found.some((r) => r.kind === 'address' && r.hn === hn)) {
    // No exact house number: show the nearest numbers on that street instead.
    const streetTokens = tokens.slice(1);
    const want = parseInt(hn, 10);
    const onStreet = match(streetTokens, 3000).filter((r) => r.kind === 'address');
    const nums = onStreet
      .map((r) => ({ r, d: Math.abs(parseInt(r.hn, 10) - want) }))
      .filter((x) => !Number.isNaN(x.d))
      .sort((a, b) => a.d - b.d)
      .slice(0, limit - 2)
      .map((x) => ({ ...x.r, approx: true }));
    const streets = match(streetTokens, 50).filter((r) => r.kind === 'street').slice(0, 2);
    found = [...nums, ...streets.map((r) => ({ ...r, approx: true }))];
    note = found.length
      ? `No exact match for house number ${hn}. These are the closest addresses we have on that street — check before you go.`
      : null;
  }
  if (!found.length) {
    // Drop words from the end until something matches, and say so.
    for (let n = tokens.length - 1; n >= 1 && !found.length; n--) found = match(tokens.slice(0, n));
    if (found.length) note = 'No exact match. These are the closest matches — check the address before you go.';
    found = found.map((r) => ({ ...r, approx: true }));
  }
  if (!found.length) return { results: [], note: 'No matches in the downloaded map area.' };

  const ranked = dedupe(found.map((r) => ({ ...r, _s: r.approx ? 0 : score(r, tokens, hn, near) }))
    .sort((a, b) => b._s - a._s));
  return { results: ranked.slice(0, limit), note };
}

/** Sample addresses straight from the index (used by tests and the "test search" helper). */
export function sampleAddresses(postcode, n = 5) {
  if (!db) return [];
  return rows("SELECT * FROM p WHERE kind='address' AND pc=? ORDER BY random() LIMIT ?", [postcode, n]);
}
