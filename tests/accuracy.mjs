// Test 14 — accuracy check of the built map data.
//
// Google Maps cannot be used for this: its terms forbid using Google data to
// check or correct another map, and OpenStreetMap forbids copying from Google.
// So addresses are checked against the official, public-domain US Census
// Bureau geocoder instead (street name + spelling, ZIP code, location), and
// routes / names are checked for shape and garbling.
//
//   node tests/accuracy.mjs <cases.json> <dataFolder> [--no-census]
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalize } from '../app/js/normalize.js';

const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');
const cases = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const dataDir = process.argv[3];
const useCensus = !process.argv.includes('--no-census');
const dir = join(dataDir, cases.area);
const results = [];
const record = (n, name, ok, detail) => { results.push({ n, name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}. ${name} — ${detail}`); };
const meters = (a, b) => { const x = (b[0] - a[0]) * Math.cos(a[1] * Math.PI / 180), y = b[1] - a[1]; return Math.sqrt(x * x + y * y) * 111195; };
const GARBLED = /�|Ã[\u0080-¿]|â€|[\u0000-\u001F]/;

const SQL = await initSqlJs();
const db = new SQL.Database(readFileSync(join(dir, 'search.sqlite')));
const q = (sql) => { const r = db.exec(sql); return r[0] ? r[0].values : []; };

// ---- addresses to check: fixed ones + random real ones from each part of Houston
const picks = [];
for (const { q: text } of cases.addressQueries || []) {
  const t = normalize(text).split(' ');
  const row = q(`SELECT label, lat, lon, pc, street FROM p WHERE kind='address' AND hn='${t[0]}' AND street='${t.slice(1).join(' ').replace(/'/g, "''")}' LIMIT 1`)[0]
    || q(`SELECT label, lat, lon, pc, street FROM p WHERE kind='address' AND hn='${t[0]}' AND street LIKE '${t.slice(1, 2).join(' ')}%' LIMIT 1`)[0];
  if (row) picks.push({ label: row[0], lat: row[1], lon: row[2], pc: row[3], street: row[4], from: 'fixed test address' });
}
for (const [pc, n] of Object.entries(cases.accuracyPostcodes || cases.samplePostcodes || {})) {
  for (const row of q(`SELECT label, lat, lon, pc, street FROM p WHERE kind='address' AND pc='${pc}' AND label NOT LIKE '%#%' ORDER BY random() LIMIT ${n}`)) {
    picks.push({ label: row[0], lat: row[1], lon: row[2], pc: row[3], street: row[4], from: `ZIP ${pc}` });
  }
}

// ---- 14a. Census geocoder comparison
// street-type and frontage/service-road words are ignored when comparing names
const IGNORE = ['street', 'road', 'drive', 'avenue', 'boulevard', 'lane', 'court', 'circle', 'parkway', 'place', 'way', 'trail', 'service', 'svc', 'frontage', 'feeder'];
const STREET_WORDS = (s) => normalize(s).split(' ').filter((w) => !IGNORE.includes(w));
const DIRS = ['north', 'south', 'east', 'west', 'northeast', 'northwest', 'southeast', 'southwest'];
async function census(addr) {
  const url = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=' + encodeURIComponent(addr);
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (r.ok) return (await r.json()).result.addressMatches[0] || null;
    } catch { /* retry */ }
    await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
  }
  throw new Error('Census geocoder did not answer');
}
if (useCensus) {
  const rows = [];
  for (const p of picks) {
    try {
      const m = await census(`${p.label}, Houston, TX ${p.pc || ''}`.trim());
      if (!m) { rows.push({ ...p, status: 'unverified', note: 'Census has no match' }); continue; }
      const c = m.addressComponents || {};
      const cStreet = [c.preDirection, c.preType, c.streetName, c.suffixType, c.suffixDirection].filter(Boolean).join(' ');
      const ours = STREET_WORDS(p.street || p.label.replace(/^\S+\s/, '')).join(' ');
      const theirs = STREET_WORDS(cStreet).join(' ');
      const d = meters([p.lon, p.lat], [m.coordinates.x, m.coordinates.y]);
      const streetOk = ours === theirs || ours.endsWith(theirs) || theirs.endsWith(ours);
      // The Census sometimes drops a direction word and answers for a different street
      // (e.g. "South Gessner" 77036 -> "Gessner" 77041, 15 km away). That is not our error.
      const dropped = DIRS.filter((w) => ours.split(' ').includes(w) && !theirs.split(' ').includes(w));
      if (dropped.length && c.zip !== p.pc && d > 2000) {
        rows.push({ ...p, status: 'unverified', note: `Census matched a different street ("${m.matchedAddress}", ${Math.round(d / 1000)} km away, without "${dropped.join(' ')}")` });
        continue;
      }
      const zipOk = !p.pc || p.pc === c.zip;
      const placeOk = d < 300; // Census places addresses along the street by number ranges, so allow some distance
      rows.push({ ...p, status: streetOk && zipOk && placeOk ? 'match' : 'mismatch', d: Math.round(d), census: m.matchedAddress, streetOk, zipOk, placeOk });
    } catch (e) {
      rows.push({ ...p, status: 'error', note: e.message });
    }
  }
  const checked = rows.filter((r) => r.status === 'match' || r.status === 'mismatch');
  const matched = checked.filter((r) => r.status === 'match');
  const bad = rows.filter((r) => r.status === 'mismatch');
  const errs = rows.filter((r) => r.status === 'error').length;
  record('14a', 'Addresses match official Census data (street spelling, ZIP, location)',
    checked.length >= Math.min(10, picks.length) && matched.length >= 0.9 * checked.length,
    `${matched.length}/${checked.length} match; ${rows.filter((r) => r.status === 'unverified').length} could not be verified (${rows.filter((r) => r.status === 'unverified').map((r) => `${r.label}: ${r.note}`).join('; ') || 'none'}); ${errs} lookup errors. ` +
    (bad.length ? 'Mismatches: ' + bad.slice(0, 8).map((r) => `"${r.label} ${r.pc}" vs Census "${r.census}" (${[!r.streetOk && 'street', !r.zipOk && 'ZIP', !r.placeOk && `${r.d} m apart`].filter(Boolean).join(', ')})`).join(' / ') : 'No mismatches.') +
    ' Examples: ' + matched.slice(0, 4).map((r) => `${r.label} ${r.pc} ≈ ${r.census} (${r.d} m)`).join(' / '));
  writeFileSync(join(dataDir, `accuracy-addresses-${cases.area}.json`), JSON.stringify(rows, null, 1));
}

// ---- 14b. ZIP codes present and well-formed
const zipStats = q("SELECT count(*), sum(pc GLOB '[0-9][0-9][0-9][0-9][0-9]'), sum(pc='' OR pc IS NULL) FROM p WHERE kind='address'")[0];
const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
const zc = meta.zipCheck;
record('14b', 'Every address has a proper 5-digit ZIP code', zipStats[2] <= 0.02 * zipStats[0],
  `${zipStats[1]} of ${zipStats[0]} addresses have a 5-digit ZIP, ${zipStats[2]} have none` +
  (zc ? `; Census filled in ${zc.filled}, agreed with ${zc.agree}, disagreed with ${zc.disagree} (e.g. ${(zc.disagreeSamples || []).slice(0, 3).join('; ')})` : '; no Census ZIP data in this build'));

// ---- 14c. no garbled names
const badNames = q('SELECT label FROM p').map((r) => r[0]).filter((t) => GARBLED.test(t));
globalThis.self = globalThis;
await import('../app/js/route-worker.js');
const buf = readFileSync(join(dir, 'graph.bin'));
self.hsmRouteForTests.load(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const badRoads = self.hsmRouteForTests.names().filter((t) => GARBLED.test(t));
record('14c', 'No garbled street or place names', badNames.length === 0 && badRoads.length === 0,
  `search names with broken characters: ${badNames.length}${badNames.length ? ' (' + badNames.slice(0, 5).join(' | ') + ')' : ''}; road names: ${badRoads.length}`);

// ---- 14d. routes follow real roads
const routes = [];
const pts = picks.filter((p, i) => i % 2 === 0).slice(0, 8);
for (let i = 0; i + 1 < pts.length; i++) {
  for (const mode of ['car', 'foot']) {
    const a = pts[i], b = pts[i + 1];
    const r = self.hsmRouteForTests.route({ from: [a.lon, a.lat], to: [b.lon, b.lat], mode, avoidFlood: false, blocked: [] });
    if (!r.ok) { routes.push({ a: a.label, b: b.label, mode, ok: false, why: r.reason }); continue; }
    let maxJump = 0;
    for (let k = 1; k < r.coords.length; k++) maxJump = Math.max(maxJump, meters(r.coords[k - 1], r.coords[k]));
    const straight = meters([a.lon, a.lat], [b.lon, b.lat]);
    const ratio = r.dist / Math.max(straight, 1);
    const ok = r.gapStart < 250 && r.gapEnd < 250 && maxJump < 2000 && ratio >= 0.95 && ratio < 3;
    routes.push({ a: a.label, b: b.label, mode, ok, miles: (r.dist / 1609).toFixed(1), ratio: ratio.toFixed(2), maxJump: Math.round(maxJump), gaps: `${Math.round(r.gapStart)}/${Math.round(r.gapEnd)} m`, steps: r.steps.length });
  }
}
const badRoutes = routes.filter((r) => !r.ok);
record('14d', 'Routes follow real roads (start/end on the road, no jumps across blocks, sensible length)', routes.length > 0 && badRoutes.length === 0,
  `${routes.length - badRoutes.length}/${routes.length} routes ok. ` + routes.slice(0, 6).map((r) => r.ok
    ? `${r.mode} ${r.a} → ${r.b}: ${r.miles} mi, ${r.ratio}× straight line, longest straight piece ${r.maxJump} m, ends ${r.gaps} from points`
    : `FAILED ${r.mode} ${r.a} → ${r.b}: ${r.why || `ratio ${r.ratio}, jump ${r.maxJump} m, gaps ${r.gaps}`}`).join(' / '));

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} accuracy checks passed for "${cases.area}"`);
writeFileSync(join(dataDir, `test-results-accuracy-${cases.area}.json`), JSON.stringify({ area: cases.area, when: new Date().toISOString(), results }, null, 1));
process.exit(passed === results.length ? 0 : 1);
