// Airplane-mode tests for the Houston Survival Map.
// Downloads one area while "online", then turns the network OFF in the
// browser and runs the 10 required checks.
//
//   node tests/offline.test.mjs <cases.json> <dataFolder>
//
// Prints a PASS/FAIL table and writes the results next to the data folder.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const initSqlJs = require('sql.js');

const cases = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const dataDir = process.argv[3];
if (process.argv[4]) cases.area = process.argv[4]; // e.g. run the Houston cases against the metro area
const PORT = 8000 + Math.floor(Math.random() * 900);
const BASE = `http://localhost:${PORT}/`;
const results = [];
const record = (n, name, ok, detail) => { results.push({ n, name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}. ${name} — ${detail}`); };
const text = async (p, sel) => ((await p.textContent(sel)) || '').replace(/\s+/g, ' ').trim();
const meters = (a, b) => { const x = (b[0] - a[0]) * Math.cos(a[1] * Math.PI / 180), y = b[1] - a[1]; return Math.sqrt(x * x + y * y) * 111195; };

// pick real addresses straight from the built search index
async function sampleAddresses() {
  const SQL = await initSqlJs();
  const db = new SQL.Database(readFileSync(join(dataDir, cases.area, 'search.sqlite')));
  const out = [];
  for (const [pc, n] of Object.entries(cases.samplePostcodes || {})) {
    const r = db.exec(`SELECT label, lat, lon, hn FROM p WHERE kind='address' AND pc='${pc}' AND label NOT LIKE '%#%' ORDER BY random() LIMIT ${n}`);
    for (const row of (r[0] ? r[0].values : [])) out.push({ q: row[0], expect: row[0], lat: row[1], lon: row[2], from: `sampled from index, ZIP ${pc}` });
    if (!r[0]) out.push({ q: null, from: `ZIP ${pc}: no addresses in the data` });
  }
  return out;
}

async function searchAndPick(p, q) {
  await p.fill('#q', '');
  await p.fill('#q', q);
  await p.waitForSelector('#suggest:not([hidden])', { timeout: 8000 });
  await p.waitForTimeout(250);
  const suggestions = await text(p, '#suggest');
  const first = (await p.$('#suggest .item')) ? await text(p, '#suggest .item') : '';
  if (await p.$('#suggest .item')) await p.click('#suggest .item');
  return { suggestions, first };
}

async function closeIfOpen(p) {
  if (await p.isVisible('#sheet-close')) await p.click('#sheet-close');
}

async function routeShown(p, timeout = 30000) {
  await p.waitForFunction(() => {
    const r = document.querySelector('#dres');
    return r && (document.querySelector('#eta') || /No route|Waiting for a GPS/.test(r.textContent));
  }, null, { timeout });
  return text(p, '#dres');
}

const server = spawn(process.execPath, ['scripts/serve.mjs', String(PORT), 'app', dataDir], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));
const browser = await chromium.launch();
const ctx = await browser.newContext({
  geolocation: { latitude: cases.gps[0], longitude: cases.gps[1], accuracy: 10 },
  permissions: ['geolocation', 'accelerometer', 'gyroscope', 'magnetometer'], viewport: { width: 420, height: 860 },
});
const outside = [];
ctx.on('request', (r) => { if (!r.url().startsWith(BASE) && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) outside.push(r.url()); });
const errors = [];
let page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));

try {
  // ---- download while online
  await page.goto(BASE);
  await page.waitForSelector(`[data-dl="${cases.area}"]`, { timeout: 20000 });
  const t0 = Date.now();
  await page.click(`[data-dl="${cases.area}"]`);
  await page.waitForFunction(() => document.body.dataset.ready === 'area', null, { timeout: 600000 });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(500);
  console.log(`downloaded area "${cases.area}" in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  // ---- AIRPLANE MODE from here on
  await ctx.setOffline(true);

  // 1. opens offline
  await page.reload();
  await page.waitForFunction(() => document.body.dataset.ready, null, { timeout: 60000 });
  const ready = await page.evaluate(() => document.body.dataset.ready);
  const canvas = !!(await page.$('#map canvas'));
  const status = await text(page, '#status');
  const hasBase = await page.evaluate(() => !!(window.hsm.map.getStyle().sources.protomaps));
  if (hasBase) await page.waitForFunction(() => window.hsm.map.loaded(), null, { timeout: 30000 }).catch(() => {});
  await page.screenshot({ path: join(dataDir, `screen-${cases.area}-offline.png`) });
  record(1, 'Opens offline, map loads', ready === 'area' && canvas && /Offline/.test(status) && errors.length === 0,
    `ready=${ready}, map canvas=${canvas}, basemap=${hasBase ? 'yes' : 'NO (none in this data)'}, status="${status}", page errors=${errors.length}`);

  // 2. address search
  const addrCases = [...(cases.addressQueries || []), ...(await sampleAddresses())];
  const addrRes = [];
  for (const c of addrCases) {
    if (!c.q) { addrRes.push({ ok: false, d: c.from }); continue; }
    const { first } = await searchAndPick(page, c.q);
    const sel = await page.evaluate(() => window.hsm.selected && [window.hsm.selected.lon, window.hsm.selected.lat, window.hsm.selected.approx || false]);
    const okText = first.toLowerCase().includes(c.expect.toLowerCase());
    const okPos = c.lat == null || (sel && meters([c.lon, c.lat], sel) < 60);
    const ok = okText && okPos && sel && !sel[2];
    addrRes.push({ ok, d: `"${c.q}" → "${first.slice(0, 60)}"${sel ? ` pin ${sel[1].toFixed(5)},${sel[0].toFixed(5)}` : ''}${c.from ? ' [' + c.from + ']' : ''}` });
  }
  record(2, 'Address search (house number + street)', addrRes.every((r) => r.ok), addrRes.map((r) => `${r.ok ? 'ok' : 'MISS'} ${r.d}`).join(' | '));
  if (cases.closestQuery) {
    await page.fill('#q', cases.closestQuery);
    await page.waitForSelector('#suggest:not([hidden])', { timeout: 8000 });
    await page.waitForTimeout(250);
    const s = await text(page, '#suggest');
    record('2b', 'No exact match shows closest matches with a warning', /No exact match/.test(s) && /closest/i.test(s), `"${cases.closestQuery}" → "${s.slice(0, 140)}"`);
  }

  // 3. place name + route
  const pl = await searchAndPick(page, cases.placeQuery.q);
  await page.click('[data-a="go"]');
  const r3 = await routeShown(page);
  record(3, 'Place name search + route', pl.first.toLowerCase().includes(cases.placeQuery.expect.toLowerCase()) && /about \d/.test(r3),
    `"${cases.placeQuery.q}" → "${pl.first.slice(0, 70)}"; route: ${r3.slice(0, 80)}`);

  // 3b. scouted (verified) places are searchable
  if (cases.scoutedQueries) {
    const got = [];
    for (const c of cases.scoutedQueries) {
      const { first } = await searchAndPick(page, c.q);
      got.push({ ok: first.toLowerCase().includes(c.expect.toLowerCase()), d: `"${c.q}" → "${first.slice(0, 60)}"` });
    }
    record('3b', 'Scouted places can be searched', got.every((g) => g.ok), got.map((g) => `${g.ok ? 'ok' : 'MISS'} ${g.d}`).join(' | '));
    await closeIfOpen(page);
  }

  // 4. GPS → typed address, driving
  await closeIfOpen(page);
  await searchAndPick(page, cases.routeTo);
  await page.click('[data-a="go"]');
  await page.click('[data-mode="car"]');
  const r4 = await routeShown(page);
  const carTime = await page.evaluate(() => window.hsm.route && window.hsm.route.time);
  const note4 = /cannot know live traffic/.test(r4);
  record(4, 'GPS location → typed address, driving', /about \d/.test(r4) && / mi /.test(r4 + ' ') && note4 && /driving/.test(r4),
    r4.slice(0, 120) + (note4 ? ' [estimate note shown]' : ' [NO estimate note]'));

  // 5. walking
  await page.click('[data-mode="foot"]');
  await page.waitForFunction(() => window.hsm.route && window.hsm.route.mode === 'foot' || /No route/.test(document.querySelector('#dres').textContent), null, { timeout: 30000 });
  const r5 = await text(page, '#dres');
  const walkTime = await page.evaluate(() => window.hsm.route && window.hsm.route.time);
  record(5, 'Same route, walking', /walking/.test(r5) && walkTime > carTime, `${r5.slice(0, 90)} (walk ${Math.round(walkTime / 60)} min vs drive ${Math.round(carTime / 60)} min)`);
  await page.click('[data-mode="bike"]');
  await page.waitForFunction(() => window.hsm.route && window.hsm.route.mode === 'bike', null, { timeout: 30000 }).catch(() => {});
  const bikeTime = await page.evaluate(() => window.hsm.route && window.hsm.route.mode === 'bike' && window.hsm.route.time);
  record('5b', 'Same route, biking', bikeTime > 0 && bikeTime < walkTime, `bike ${Math.round(bikeTime / 60)} min`);
  if (cases.noWalkRoute) {
    await closeIfOpen(page);
    await searchAndPick(page, cases.noWalkRoute);
    await page.click('[data-a="go"]');
    await page.click('[data-mode="foot"]');
    await page.waitForTimeout(300);
    const r = await routeShown(page);
    record('5c', 'Unreachable on foot says "No route" (no wrong route)', /No route/.test(r), r.slice(0, 120));
    await page.click('[data-mode="car"]');
  }

  // 6. nearest hospital
  await closeIfOpen(page);
  await page.click('[data-act="hospital"]');
  await page.waitForSelector('[data-a="go"]');
  const h = await text(page, '#sheet-body');
  await page.click('[data-a="go"]');
  const r6 = await routeShown(page);
  record(6, 'Nearest hospital', /Nearest hospital: [\d.]+ (mi|ft)/.test(h) && /about \d/.test(r6), `${(await text(page, '#dto-s').catch(() => '')) || ''}${h.slice(0, 110)} → ${r6.slice(0, 50)}`);

  // F. flood warning (Houston-specific extra check)
  await closeIfOpen(page);
  await searchAndPick(page, cases.floodRoute);
  await page.click('[data-a="go"]');
  await page.click('[data-mode="car"]');
  let rF = await routeShown(page);
  if (!/Flood warning/.test(rF) && await page.isChecked('#avoidflood')) {
    await page.uncheck('#avoidflood');
    await page.waitForTimeout(500);
    rF = await routeShown(page);
  }
  const flood = rF.match(/Flood warning:.*?NOT a live flood report/);
  record('F', 'Flood warning on a flood-prone route', !!flood, flood ? flood[0].slice(0, 260) : rF.slice(0, 200));
  await page.check('#avoidflood');
  await page.waitForTimeout(500);

  // 7. POI toggles on the map
  await closeIfOpen(page);
  const groups = await page.$$eval('#layers [data-layer]', (els) => els.map((e) => e.dataset.layer));
  const t7 = [];
  for (const g of groups) {
    const res = await page.evaluate(async (g) => {
      const map = window.hsm.map;
      const pressed = () => document.querySelector(`#layers [data-layer="${g}"]`).getAttribute('aria-pressed') === 'true';
      const src = map.getSource('allpois')._data.features.filter((f) => f.properties.group === g);
      if (pressed()) document.querySelector(`#layers [data-layer="${g}"]`).click(); // start from "off"
      if (src.length) {
        const b = new maplibregl.LngLatBounds();
        src.slice(0, 50).forEach((f) => b.extend(f.geometry.coordinates));
        map.fitBounds(b, { padding: 80, duration: 0, maxZoom: 15 });
      }
      const wait = () => new Promise((r) => { map.once('idle', r); setTimeout(r, 3000); map.triggerRepaint(); });
      await wait();
      const offCount = map.queryRenderedFeatures({ layers: ['allpois'] }).filter((f) => f.properties.group === g).length;
      document.querySelector(`#layers [data-layer="${g}"]`).click();
      await wait();
      const onCount = map.queryRenderedFeatures({ layers: ['allpois'] }).filter((f) => f.properties.group === g).length;
      document.querySelector(`#layers [data-layer="${g}"]`).click();
      await wait();
      const offAgain = map.queryRenderedFeatures({ layers: ['allpois'] }).filter((f) => f.properties.group === g).length;
      return { total: src.length, offCount, onCount, offAgain };
    }, g);
    t7.push({ g, ...res, ok: res.total === 0 ? null : res.offCount === 0 && res.onCount > 0 && res.offAgain === 0 });
  }
  const t7ok = t7.every((x) => x.ok !== false) && t7.filter((x) => x.ok).length >= Math.min(5, t7.length);
  record(7, 'Place toggles show / hide Hospital, Shelter, Water, Food, Gas, Pharmacy, Police/Fire', t7ok,
    t7.map((x) => `${x.g}: ${x.total === 0 ? 'no places in data' : `${x.total} in data, off→${x.offCount} shown, on→${x.onCount} shown, off→${x.offAgain}`}`).join(' | '));

  // 8. saved place survives closing the app
  await searchAndPick(page, cases.homeQuery);
  await page.click('[data-a="save"]');
  await page.fill('#sname', 'Home');
  await page.click('[data-type="home"]');
  await page.close();
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE);
  await page.waitForFunction(() => document.body.dataset.ready === 'area', null, { timeout: 60000 });
  await page.click('[data-act="saved"]');
  await page.click('[data-go]');
  const r8 = await routeShown(page);
  record(8, 'Saved Home → reopen app offline → tap Home → route', /about \d/.test(r8), r8.slice(0, 80));

  // 9. waypoints + breadcrumb trail
  await closeIfOpen(page);
  await searchAndPick(page, cases.routeTo);
  await page.click('[data-a="go"]');
  await routeShown(page);
  const before = await page.evaluate(() => window.hsm.route.dist);
  await page.click('#addstop');
  await page.fill('#dstop', cases.stopQuery);
  await page.waitForSelector('#dstop-s:not([hidden]) .item', { timeout: 8000 });
  await page.click('#dstop-s .item');
  await page.waitForFunction(() => window.hsm.route && window.hsm.route.stopsAt && window.hsm.route.stopsAt.length === 1, null, { timeout: 30000 });
  const r9a = await text(page, '#dres');
  const withStop = await page.evaluate(() => window.hsm.route.dist);
  const stopOk = /Arrive at stop 1/.test(r9a) && /1 stop/.test(r9a) && withStop > before;
  // trail: start recording, then "walk" by moving the GPS position
  await closeIfOpen(page);
  await page.click('[data-act="more"]');
  await page.click('[data-m="trail"]');
  await page.click('#tstart');
  const [lat0, lon0] = cases.gps;
  for (let i = 1; i <= 6; i++) {
    await ctx.setGeolocation({ latitude: lat0 + i * 0.0004, longitude: lon0 + i * 0.0002, accuracy: 8 });
    await page.waitForTimeout(700);
  }
  const recorded = await page.evaluate(() => JSON.parse(localStorage.getItem('hsm.trails')).current.points.length);
  await page.click('[data-act="more"]');
  await page.click('[data-m="trail"]');
  await page.click('#tstop');
  await page.waitForSelector('[data-back]');
  await page.click('[data-back]');
  const r9b = await routeShown(page);
  const backTo = await page.evaluate(() => window.hsm.route && window.hsm.route.to);
  const backOk = recorded >= 5 && /about \d/.test(r9b) && backTo && Math.abs(backTo[1] - lat0) < 0.001;
  record(9, 'Waypoints (route stop) + breadcrumb trail records and routes back', stopOk && backOk,
    `stop: ${stopOk ? 'ok' : 'FAILED'} (${(before / 1609).toFixed(1)} mi → ${(withStop / 1609).toFixed(1)} mi with stop "${cases.stopQuery}"); trail: ${recorded} points recorded, back-route ${r9b.slice(0, 40)} to ${backTo ? backTo[1].toFixed(5) + ',' + backTo[0].toFixed(5) : 'none'}`);
  await ctx.setGeolocation({ latitude: lat0, longitude: lon0, accuracy: 10 });

  // 10. GPS + compass dashboard
  await closeIfOpen(page);
  await searchAndPick(page, cases.routeTo);
  await page.click('[data-a="go"]');
  await routeShown(page);
  await closeIfOpen(page);
  await page.click('#dashbtn');
  await page.waitForSelector('.tiles');
  if (await page.$('#compass')) {
    await page.click('#compass');
    await page.waitForTimeout(200);
  }
  await page.evaluate(() => window.dispatchEvent(Object.assign(new Event('deviceorientationabsolute'), { alpha: 90, absolute: true })));
  await page.waitForTimeout(1500);
  const d10 = await text(page, '#sheet-body');
  const coordsOk = d10.includes(cases.gps[0].toFixed(3));
  const headingOk = /270° west/.test(d10);
  const distOk = /Distance to destination\s*[\d.]+ (mi|ft)/.test(d10);
  const etaOk = /ETA \(estimate\)\s*about \d/.test(d10);
  const batOk = /Battery\s*(\d+%|—)/.test(d10);
  const helpOk = /Hospital: [\d.]+ (mi|ft)/.test(d10);
  await page.screenshot({ path: join(dataDir, `screen-${cases.area}-dashboard.png`) });
  record(10, 'GPS + compass dashboard (coordinates, compass, distance, battery, ETA)', coordsOk && headingOk && distOk && etaOk && batOk && helpOk,
    `coords=${coordsOk} compass=${headingOk} distance=${distOk} eta=${etaOk} battery=${(d10.match(/Battery\s*(\d+%|—)/) || [])[1]} nearest-help=${helpOk}`);

  // 11. battery saver
  await closeIfOpen(page);
  await page.click('[data-act="more"]');
  await page.check('#battery');
  await page.waitForTimeout(800);
  await closeIfOpen(page);
  const st11 = await text(page, '#status');
  const s11 = await searchAndPick(page, cases.routeTo);
  await page.click('[data-a="go"]');
  const r11 = await routeShown(page);
  const dark = await page.evaluate(() => document.documentElement.dataset.theme);
  record(11, 'Battery saver: still maps, searches, routes offline', /battery saver/.test(st11) && dark === 'dark' && /about \d/.test(r11) && !!s11.first,
    `status="${st11}", theme=${dark}, search→"${s11.first.slice(0, 40)}", route ${r11.slice(0, 40)}`);
  await page.screenshot({ path: join(dataDir, `screen-${cases.area}-battery.png`) });

  // 12. no reviews / no live claims
  const seen = [];
  for (const m of ['essentials', 'dash', 'trail', 'pins', 'guide', 'checklist', 'areas', 'about']) {
    await closeIfOpen(page);
    await page.click('[data-act="more"]');
    await page.click(`[data-m="${m}"]`);
    await page.waitForTimeout(300);
    seen.push(await text(page, '#sheet-body'));
  }
  const all = seen.join(' ') + ' ' + r4 + rF + (await text(page, 'body'));
  // Any mention of "live", "open now", etc. must be a NOT-statement ("cannot know live traffic").
  const chunks = all.split(/(?<=[.!?])\s+|\n/);
  const bad = [];
  for (const c of chunks) {
    if (/\b(reviews?|ratings?|★)/i.test(c)) bad.push(c.slice(0, 60));
    else if (/\b(live (traffic|status|flood|report|data|camera|information|update)s?|open now|closed now|open 24|hours:|in stock|currently flooded|road is clear|space available)\b/i.test(c)
      && !/\b(not|no|cannot|can't|never|NOT)\b/i.test(c)) bad.push(c.slice(0, 60));
  }
  const src = readdirSync('app/js').map((f) => readFileSync(join('app/js', f), 'utf8')).join('\n');
  const srcBad = src.match(/\b(review|rating|open now|opening_hours)\b/gi) || [];
  const poisTxt = readFileSync(join(dataDir, cases.area, 'pois.json'), 'utf8');
  const hoursInData = /opening_hours|"hours"|\d{1,2}:\d\d\s*(AM|PM)/i.test(poisTxt);
  record(12, 'No reviews, no live-status claims', bad.length === 0 && srcBad.length === 0 && !hoursInData,
    `forbidden words on screens: ${bad.length ? bad.join(', ') : 'none'}; in app code: ${srcBad.length ? srcBad.join(', ') : 'none'}; opening hours in place data: ${hoursInData ? 'YES' : 'none'}`);

  // 13. only the Houston metro pack exists in Phase 1
  const packs = JSON.parse(readFileSync(join(dataDir, 'areas.json'), 'utf8')).areas;
  const onDevice = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('hsm.downloadedAreas') || '{}')).map((a) => `${a.id}:${a.kind}`));
  const packsOk = packs.every((a) => (a.kind || 'metro') === 'metro') && !packs.some((a) => /texas|state|^us/i.test(a.id));
  record(13, 'No Texas or US pack built or downloaded (metro pack only)', packsOk && onDevice.length === 1,
    `packs offered: ${packs.map((a) => `${a.id} (${a.kind || 'metro'}, ${(a.bytes / 1e6).toFixed(1)} MB)`).join(', ')}; on device: ${onDevice.join(', ')}`);
  record('13b', 'No internet requests from the app', outside.length === 0, outside.length ? outside.slice(0, 5).join(' ') : 'zero requests left this computer');
} catch (err) {
  record('X', 'Test run crashed', false, err.message.split('\n')[0]);
  await page.screenshot({ path: join(dataDir, `screen-${cases.area}-crash.png`) }).catch(() => {});
} finally {
  await browser.close();
  server.kill();
}
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed for area "${cases.area}"`);
writeFileSync(join(dataDir, `test-results-${cases.area}.json`), JSON.stringify({ area: cases.area, when: new Date().toISOString(), results }, null, 1));
process.exit(passed === results.length ? 0 : 1);
