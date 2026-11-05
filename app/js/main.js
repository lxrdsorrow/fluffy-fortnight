// Houston Survival Map — main screen logic.
import * as areas from './areas.js';
import { openSearch, search } from './search.js';
import { loadRoads, getRoute, miles, aboutTime, clockAt, bearingDeg, compassWord, metersBetween, FLOOD_WORDS } from './routing.js';
import { saved, pins, trails, settings, checklist, SAVED_TYPES, PIN_TYPES } from './places.js';
import { GUIDE, CHECKLIST, DISCLAIMER } from './guide.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const HOUSTON = [-95.3698, 29.7604];
const HOME_77088 = [-95.45, 29.885];
const NOT_LIVE = 'Location only. This app cannot tell if a place is open, has supplies or has space — that would need live information.';
const ETA_NOTE = 'Estimate only, from speed limits and distance. Offline, this app cannot know live traffic, accidents, road closures or flooding.';

const CATS = {
  hospital: { label: 'Hospital', icon: '🏥' },
  shelter: { label: 'Shelter', icon: '🏠' },
  water: { label: 'Water', icon: '💧' },
  clinic: { label: 'Clinic / urgent care', icon: '🩺' },
  pharmacy: { label: 'Pharmacy', icon: '💊' },
  police: { label: 'Police', icon: '🚓' },
  fire: { label: 'Fire station', icon: '🚒' },
  grocery: { label: 'Food / grocery', icon: '🛒' },
  fuel: { label: 'Gas station', icon: '⛽' },
  foodbank: { label: 'Food bank / pantry', icon: '🥫', hidden: true },
  emergency: { label: 'Emergency management', icon: '🚨', hidden: true },
};

// Map toggles (each turns one kind of survival place on/off on the map)
const GROUPS = {
  hospital: { label: 'Hospital', icon: '🏥', cats: ['hospital', 'clinic'], color: '#d32f2f' },
  shelter: { label: 'Shelter', icon: '🏠', cats: ['shelter', 'community'], color: '#7b1fa2' },
  water: { label: 'Water', icon: '💧', cats: ['water'], color: '#0288d1' },
  food: { label: 'Food', icon: '🛒', cats: ['grocery', 'foodbank'], color: '#2e7d32' },
  gas: { label: 'Gas', icon: '⛽', cats: ['fuel'], color: '#ef6c00' },
  pharmacy: { label: 'Pharmacy', icon: '💊', cats: ['pharmacy'], color: '#00897b' },
  safety: { label: 'Police / Fire', icon: '🚒', cats: ['police', 'fire', 'emergency'], color: '#283593' },
};

const state = {
  area: null, meta: null, pois: [], flood: null, map: null,
  me: null, heading: null, gpsError: null,
  selected: null, route: null, dir: { from: null, to: null, mode: settings.get().mode || 'car' },
  sheetStack: [],
};
window.hsm = state; // handy for debugging and automated tests

// ------------------------------------------------------------------ map
let pmProtocol = null;
const markers = { me: null, sel: null, pins: [] };

function flavor() {
  const s = settings.get();
  if (s.battery) return 'dark';
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

async function buildStyle() {
  const fl = flavor();
  const base = new URL('.', location.href).href;
  const style = {
    version: 8,
    glyphs: base + 'assets/fonts/{fontstack}/{range}.pbf',
    sprite: base + 'assets/sprites/' + fl,
    sources: {},
    layers: [{ id: 'bg', type: 'background', paint: { 'background-color': fl === 'dark' ? '#1b232b' : '#e9edf0' } }],
  };
  if (state.area && state.meta && state.meta.files && state.meta.files['basemap.pmtiles']) {
    const blob = await areas.getFile(state.area, 'basemap.pmtiles');
    if (blob) {
      const key = 'basemap-' + state.area + '-' + (state.meta.savedAt || '');
      if (!pmProtocol.get(key)) pmProtocol.add(new pmtiles.PMTiles(new pmtiles.FileSource(new File([blob], key))));
      style.sources.protomaps = { type: 'vector', url: 'pmtiles://' + key, attribution: '© OpenStreetMap contributors · Protomaps' };
      style.layers = basemaps.layers('protomaps', basemaps.namedFlavor(fl), { lang: 'en' });
    }
  }
  return style;
}

function addOverlays() {
  const map = state.map;
  const dark = flavor() === 'dark';
  const empty = { type: 'FeatureCollection', features: [] };
  map.addSource('flood', { type: 'geojson', data: state.flood || empty });
  map.addLayer({ id: 'flood-fill', type: 'fill', source: 'flood', layout: { visibility: settings.get().showFlood ? 'visible' : 'none' },
    paint: { 'fill-color': ['match', ['get', 'level'], '100', '#1565c0', '#4fc3f7'], 'fill-opacity': ['match', ['get', 'level'], '100', 0.28, 0.12] } });
  map.addSource('route', { type: 'geojson', data: empty });
  map.addLayer({ id: 'route-casing', type: 'line', source: 'route', filter: ['==', ['get', 'part'], 'main'],
    layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': dark ? '#0b1420' : '#ffffff', 'line-width': 10 } });
  map.addLayer({ id: 'route-line', type: 'line', source: 'route', filter: ['==', ['get', 'part'], 'main'],
    layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#1e88e5', 'line-width': 6 } });
  map.addLayer({ id: 'route-gap', type: 'line', source: 'route', filter: ['==', ['get', 'part'], 'gap'],
    paint: { 'line-color': '#1e88e5', 'line-width': 3, 'line-dasharray': [1, 2] } });
  map.addSource('spots', { type: 'geojson', data: empty });
  map.addLayer({ id: 'spots', type: 'circle', source: 'spots',
    paint: { 'circle-radius': 8, 'circle-color': '#ffb300', 'circle-stroke-color': '#6b4b00', 'circle-stroke-width': 2 } });
  map.addSource('trail', { type: 'geojson', data: empty });
  map.addLayer({ id: 'trail-line', type: 'line', source: 'trail', filter: ['==', ['get', 'part'], 'line'],
    layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ff6d00', 'line-width': 4, 'line-dasharray': [2, 1] } });
  map.addLayer({ id: 'trail-start', type: 'circle', source: 'trail', filter: ['==', ['get', 'part'], 'start'],
    paint: { 'circle-radius': 7, 'circle-color': '#ff6d00', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
  map.addLayer({ id: 'route-stops', type: 'circle', source: 'route', filter: ['==', ['get', 'part'], 'stop'],
    paint: { 'circle-radius': 8, 'circle-color': '#ffa000', 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } });
  map.addSource('allpois', { type: 'geojson', data: poiFeatures() });
  const lf = ['in', ['get', 'group'], ['literal', enabledLayers()]];
  map.addLayer({ id: 'allpois', type: 'circle', source: 'allpois', filter: lf,
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 4, 15, 8], 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
  map.addLayer({ id: 'allpois-label', type: 'symbol', source: 'allpois', filter: lf, minzoom: 13,
    layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-max-width': 9 },
    paint: { 'text-color': dark ? '#e8edf2' : '#16202a', 'text-halo-color': dark ? '#0b1420' : '#ffffff', 'text-halo-width': 1.5 } });
  drawTrail();
  map.addSource('pois', { type: 'geojson', data: empty });
  map.addLayer({ id: 'pois', type: 'circle', source: 'pois',
    paint: { 'circle-radius': 7, 'circle-color': '#c62828', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
  if (state.route) drawRoute(state.route, false);
}

async function setupMap() {
  pmProtocol = new pmtiles.Protocol();
  maplibregl.addProtocol('pmtiles', pmProtocol.tile);
  const center = state.meta ? [(state.meta.bbox[0] + state.meta.bbox[2]) / 2, (state.meta.bbox[1] + state.meta.bbox[3]) / 2] : HOUSTON;
  state.map = new maplibregl.Map({
    container: 'map', style: await buildStyle(), center, zoom: state.meta ? 12 : 9,
    attributionControl: { compact: true }, fadeDuration: 0, maxPitch: 0,
  });
  state.styleKey = state.area + '|' + flavor();
  state.map.touchZoomRotate.disableRotation();
  state.map.on('style.load', addOverlays);
  state.map.on('click', (e) => {
    const f = state.map.queryRenderedFeatures(e.point, { layers: ['pois', 'spots', 'allpois'].filter((l) => state.map.getLayer(l)) })[0];
    if (f && (f.layer.id === 'pois' || f.layer.id === 'allpois')) {
      const pl = JSON.parse(f.properties.place);
      return showPlace(pl.sub !== undefined ? pl : poiPlace(pl));
    }
    if (f && f.layer.id === 'spots') return showSheet('Flood-prone spot', `<p>${esc(f.properties.text)}</p><p class="note">Based on floodplain maps and road shape, not a live flood report. It cannot tell if the road is flooded now.</p>`);
    showPlace({ label: 'Dropped pin', sub: `${e.lngLat.lat.toFixed(5)}, ${e.lngLat.lng.toFixed(5)}`, lon: e.lngLat.lng, lat: e.lngLat.lat, dropped: true });
  });
  if (state.meta) state.map.setMaxBounds(padBounds(state.meta.bbox, 0.25));
}

function padBounds(b, p) {
  const dx = (b[2] - b[0]) * p, dy = (b[3] - b[1]) * p;
  return [[b[0] - dx, b[1] - dy], [b[2] + dx, b[3] + dy]];
}

async function restyle(force) {
  const key = state.area + '|' + flavor();
  if (!force && key === state.styleKey) return;
  state.styleKey = key;
  state.map.setStyle(await buildStyle());
  document.documentElement.dataset.theme = settings.get().battery ? 'dark' : '';
}

function setMarker(kind, lngLat, cls) {
  if (!lngLat) { if (markers[kind]) { markers[kind].remove(); markers[kind] = null; } return; }
  if (!markers[kind]) {
    const el = document.createElement('div');
    el.className = 'marker ' + cls;
    markers[kind] = new maplibregl.Marker({ element: el, anchor: kind === 'sel' ? 'bottom-left' : 'center' }).setLngLat(lngLat).addTo(state.map);
  } else markers[kind].setLngLat(lngLat);
}

function drawPins() {
  markers.pins.forEach((m) => m.remove());
  markers.pins = pins.all().map((p) => {
    const el = document.createElement('div');
    el.className = 'marker pin';
    el.style.background = (PIN_TYPES[p.type] || PIN_TYPES.note).color;
    el.title = (PIN_TYPES[p.type] || PIN_TYPES.note).label;
    el.addEventListener('click', (ev) => { ev.stopPropagation(); showPin(p.id); });
    return new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(state.map);
  });
}

function showPois(list) {
  const src = state.map.getSource('pois');
  if (src) src.setData({ type: 'FeatureCollection', features: list.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { place: JSON.stringify(p) } })) });
}

// ------------------------------------------------------------------ status + GPS
function setStatus() {
  const parts = [];
  parts.push(navigator.onLine ? 'Online' : 'Offline');
  parts.push(state.meta ? 'map: ' + state.meta.name.split(':')[0] : 'no map downloaded');
  if (settings.get().battery) parts.push('battery saver');
  if (state.me) parts.push(`GPS ±${Math.round(state.me.acc * 3.28)} ft`);
  else if (state.gpsError) parts.push('no GPS fix');
  $('#status').textContent = parts.join(' · ');
}

let gpsWatch = null, gpsTimer = null;
function startGps() {
  stopGps();
  if (!navigator.geolocation) { state.gpsError = 'This device has no location support.'; return setStatus(); }
  const ok = (pos) => {
    state.me = { lon: pos.coords.longitude, lat: pos.coords.latitude, acc: pos.coords.accuracy, t: pos.timestamp,
      speed: pos.coords.speed, alt: pos.coords.altitude };
    if (pos.coords.heading != null && !Number.isNaN(pos.coords.heading) && pos.coords.speed > 1 && state.headingSrc !== 'compass') {
      state.heading = pos.coords.heading; state.headingSrc = 'gps';
    }
    recordPoint(state.me);
    state.gpsError = null;
    setMarker('me', [state.me.lon, state.me.lat], 'me');
    setStatus();
    if ($('#sheet').dataset.view === 'dash') renderDash();
  };
  const bad = (err) => { state.gpsError = err.message || 'Location unavailable'; setStatus(); };
  if (settings.get().battery) {
    // battery saver: one reading every 2 minutes instead of constant tracking
    const once = () => navigator.geolocation.getCurrentPosition(ok, bad, { enableHighAccuracy: true, maximumAge: 60000, timeout: 30000 });
    once();
    gpsTimer = setInterval(once, 120000);
  } else {
    gpsWatch = navigator.geolocation.watchPosition(ok, bad, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  }
}
function stopGps() {
  if (gpsWatch != null) navigator.geolocation.clearWatch(gpsWatch);
  if (gpsTimer) clearInterval(gpsTimer);
  gpsWatch = gpsTimer = null;
}

function origin() {
  if (state.me) return { lon: state.me.lon, lat: state.me.lat, label: 'your location', gps: true };
  const c = state.map.getCenter();
  return { lon: c.lng, lat: c.lat, label: 'the map center (no GPS fix yet)', gps: false };
}

// ------------------------------------------------------------------ bottom sheet
function showSheet(title, html, view = '', push = false) {
  const sheet = $('#sheet');
  if (push && !sheet.hidden) state.sheetStack.push({ title: $('#sheet-title').textContent, html: $('#sheet-body').innerHTML, view: sheet.dataset.view, render: state.sheetRender });
  else if (!push) state.sheetStack = [];
  state.sheetRender = null;
  $('#sheet-title').textContent = title;
  $('#sheet-body').innerHTML = html;
  sheet.dataset.view = view;
  sheet.hidden = false;
  sheet.classList.remove('min');
  $('#sheet-back').hidden = state.sheetStack.length === 0;
  sheet.scrollTop = 0;
  return $('#sheet-body');
}
function closeSheet() {
  $('#sheet').hidden = true;
  $('#sheet').dataset.view = '';
  state.sheetStack = [];
}
$('#sheet-close').onclick = closeSheet;
$('#sheet-min').onclick = () => $('#sheet').classList.toggle('min');
$('#sheet-back').onclick = () => {
  const prev = state.sheetStack.pop();
  if (!prev) return closeSheet();
  if (prev.render) { prev.render(); $('#sheet-back').hidden = state.sheetStack.length === 0; return; }
  showSheet(prev.title, prev.html, prev.view, false);
};

// ------------------------------------------------------------------ search box
function attachSearch(input, box, onPick) {
  let timer = null, current = [];
  const render = () => {
    const q = input.value.trim();
    if (q.length < 2) { box.hidden = true; return; }
    if (!state.area) { box.innerHTML = '<div class="note">Download a map area first (More → Map areas).</div>'; box.hidden = false; return; }
    const near = state.me ? { lat: state.me.lat, lon: state.me.lon } : null;
    const { results, note } = search(q, near);
    current = results;
    box.innerHTML = (note ? `<div class="note">${esc(note)}</div>` : '') + results.map((r, i) =>
      `<button class="item" data-i="${i}" role="option"><div>${esc(r.label)}${r.approx ? ' <small>(closest match)</small>' : ''}</div><small>${esc(r.sub || r.kind)}</small></button>`).join('');
    box.hidden = !note && !results.length;
  };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(render, 120); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { clearTimeout(timer); render(); if (current[0] && !current[0].approx) pick(current[0]); }
    if (e.key === 'Escape') box.hidden = true;
  });
  const pick = (r) => { box.hidden = true; input.blur(); onPick(r); };
  box.addEventListener('click', (e) => {
    const b = e.target.closest('.item');
    if (b) pick(current[+b.dataset.i]);
  });
}

attachSearch($('#q'), $('#suggest'), (r) => {
  $('#q').value = r.label;
  $('#qclear').hidden = false;
  showPlace(r);
});
$('#q').addEventListener('input', () => { $('#qclear').hidden = !$('#q').value; });
$('#qclear').onclick = () => { $('#q').value = ''; $('#qclear').hidden = true; $('#suggest').hidden = true; setMarker('sel', null); };

// ------------------------------------------------------------------ place card
function distanceLine(p) {
  const o = origin();
  const d = metersBetween([o.lon, o.lat], [p.lon, p.lat]);
  return `${miles(d)} ${compassWord(bearingDeg([o.lon, o.lat], [p.lon, p.lat]))} of ${o.label} (straight line)`;
}

function showPlace(p, extraHtml = '') {
  state.selected = p;
  setMarker('sel', [p.lon, p.lat], 'sel');
  state.map.easeTo({ center: [p.lon, p.lat], zoom: Math.max(state.map.getZoom(), 15), duration: settings.get().battery ? 0 : 500 });
  const body = showSheet(p.label, `
    ${p.approx ? '<div class="note">Closest match — not an exact match for what you typed. Check before you go.</div>' : ''}
    <div>${esc(p.sub || '')}</div>
    ${p.note ? `<div class="small">${esc(p.note)}</div>` : ''}
    <div class="muted small">${esc(distanceLine(p))}${p.src === 'scouted' ? ' · scouted location' : ''}</div>
    ${extraHtml}
    <button class="primary big" data-a="go">Directions</button>
    <div class="row">
      <button data-a="from">Start from here</button>
      <button data-a="save">Save place</button>
      <button data-a="pin">Add pin / note</button>
    </div>
    <p class="muted small">${NOT_LIVE}</p>`, 'place');
  body.onclick = (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'go') openDirections({ to: endpoint(p) });
    if (a === 'from') openDirections({ from: endpoint(p) });
    if (a === 'save') saveForm(p);
    if (a === 'pin') pinForm({ lon: p.lon, lat: p.lat });
  };
}

const endpoint = (p) => ({ label: p.label, lon: p.lon, lat: p.lat });
const MY_LOCATION = { label: 'My location (GPS)', gps: true };

// ------------------------------------------------------------------ directions (with stops / waypoints)
function openDirections({ from, to, run } = {}) {
  if (from) state.dir.from = from;
  if (to) state.dir.to = to;
  if (!state.dir.stops) state.dir.stops = [];
  if (!state.dir.from) state.dir.from = MY_LOCATION;
  if (!state.dir.to && state.selected) state.dir.to = endpoint(state.selected);
  renderDirections();
  if (run || (state.dir.from && state.dir.to)) runRoute();
}

function endpointChips() {
  return `<button data-pick="gps">📍 My location</button><button data-pick="center">✛ Map center</button>` + saved.all().map((s) =>
    `<button data-pick="saved" data-id="${s.id}">⭐ ${esc(s.name)}</button>`).join('');
}

function renderDirections() {
  const d = state.dir;
  const body = showSheet('Directions', `
    <div class="field"><label>From (Point A)</label>
      <input id="dfrom" type="search" value="${esc(d.from ? d.from.label : '')}" placeholder="My location, or type an address">
      <div class="suggest" id="dfrom-s" hidden></div>
      <div class="chips" data-for="from">${endpointChips()}</div></div>
    ${d.stops.map((s, i) => `<div class="stop"><span>🔸 Stop ${i + 1}: ${esc(s.label)}</span><button class="icon" data-delstop="${i}" aria-label="Remove stop ${i + 1}">✕</button></div>`).join('')}
    <div class="field" id="addstop-field" hidden><label>Add a stop (waypoint)</label>
      <input id="dstop" type="search" placeholder="Type an address or place for the stop">
      <div class="suggest" id="dstop-s" hidden></div>
      <div class="chips" data-for="stop">${endpointChips()}</div></div>
    <button id="addstop">+ Add stop on the way</button>
    <div class="field"><label>To (Point B)</label>
      <input id="dto" type="search" value="${esc(d.to ? d.to.label : '')}" placeholder="Type an address or place">
      <div class="suggest" id="dto-s" hidden></div>
      <div class="chips" data-for="to">${endpointChips()}</div></div>
    <div class="seg" role="group" aria-label="Travel mode">
      <button data-mode="car" aria-pressed="${d.mode === 'car'}">🚗 Drive</button>
      <button data-mode="foot" aria-pressed="${d.mode === 'foot'}">🚶 Walk</button>
      <button data-mode="bike" aria-pressed="${d.mode === 'bike'}">🚲 Bike</button>
    </div>
    <label class="check"><input type="checkbox" id="avoidflood" ${settings.get().avoidFlood ? 'checked' : ''}> Prefer routes away from flood-prone roads</label>
    <button class="primary big" id="dgo">Get route</button>
    <div id="dres"></div>`, 'directions');
  state.sheetRender = renderDirections;
  const addStop = (ep) => { d.stops.push(ep); renderDirections(); runRoute(); };
  attachSearch($('#dfrom'), $('#dfrom-s'), (r) => { d.from = endpoint(r); $('#dfrom').value = r.label; runRoute(); });
  attachSearch($('#dto'), $('#dto-s'), (r) => { d.to = endpoint(r); $('#dto').value = r.label; runRoute(); });
  attachSearch($('#dstop'), $('#dstop-s'), (r) => addStop(endpoint(r)));
  body.addEventListener('click', (e) => {
    const m = e.target.closest('[data-mode]');
    if (m) { d.mode = m.dataset.mode; settings.set({ mode: d.mode }); body.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', b === m)); runRoute(); }
    const c = e.target.closest('[data-pick]');
    if (c) {
      const which = c.parentElement.dataset.for;
      let ep;
      if (c.dataset.pick === 'gps') ep = MY_LOCATION;
      else if (c.dataset.pick === 'center') { const mc = state.map.getCenter(); ep = { label: 'Map center', lon: mc.lng, lat: mc.lat }; }
      else ep = nameSaved(saved.all().find((s) => s.id === c.dataset.id));
      if (which === 'stop') return addStop(ep);
      d[which] = ep;
      $(which === 'from' ? '#dfrom' : '#dto').value = ep.label;
      runRoute();
    }
    const ds = e.target.closest('[data-delstop]');
    if (ds) { d.stops.splice(+ds.dataset.delstop, 1); renderDirections(); runRoute(); }
    if (e.target.id === 'addstop') { $('#addstop-field').hidden = false; e.target.hidden = true; $('#dstop').focus(); }
    if (e.target.id === 'dgo') runRoute();
  });
  $('#avoidflood').onchange = (e) => { settings.set({ avoidFlood: e.target.checked }); runRoute(); };
}
const nameSaved = (s) => ({ label: s.name, lon: s.lon, lat: s.lat });

function resolve(ep) {
  if (!ep) return null;
  if (ep.gps) return state.me ? [state.me.lon, state.me.lat] : null;
  return [ep.lon, ep.lat];
}

// Join the legs A → stop 1 → stop 2 → … → B into one route.
function combineLegs(legs, stopLabels) {
  if (legs.length === 1) return { ...legs[0], gaps: [[legs[0].from, legs[0].coords[0], legs[0].gapStart], [legs[0].coords.at(-1), legs[0].to, legs[0].gapEnd]], stopsAt: [] };
  const r = { ok: true, mode: legs[0].mode, coords: [], dist: 0, time: 0, steps: [], flood: { spots: [], counts: {} }, gaps: [], stopsAt: [],
    from: legs[0].from, to: legs.at(-1).to, gapStart: legs[0].gapStart, gapEnd: legs.at(-1).gapEnd };
  legs.forEach((l, i) => {
    r.coords.push(...l.coords);
    r.dist += l.dist; r.time += l.time;
    const steps = l.steps.slice();
    if (i < legs.length - 1) { steps[steps.length - 1] = { text: `Arrive at stop ${i + 1}: ${stopLabels[i]}`, dist: 0, time: 0 }; r.stopsAt.push(l.to); }
    r.steps.push(...steps);
    r.flood.spots.push(...l.flood.spots);
    for (const [k, v] of Object.entries(l.flood.counts)) r.flood.counts[k] = (r.flood.counts[k] || 0) + v;
    r.gaps.push([l.from, l.coords[0], l.gapStart], [l.coords.at(-1), l.to, l.gapEnd]);
  });
  if (legs.some((l) => l.alt && l.alt.picked === 'safer')) {
    r.alt = { picked: 'safer', fastestTime: legs.reduce((t, l) => t + (l.alt && l.alt.picked === 'safer' ? l.alt.fastestTime : l.time), 0) };
  } else if (legs.some((l) => l.alt)) r.alt = { picked: 'fastest', saferTime: null };
  return r;
}

async function runRoute() {
  const res = $('#dres');
  if (!res) return;
  const d = state.dir;
  if (!state.area) { res.innerHTML = '<div class="note">Download a map area first (More → Map areas).</div>'; return; }
  if (!d.to) { res.innerHTML = '<p class="muted">Pick where you want to go.</p>'; return; }
  const eps = [d.from, ...(d.stops || []), d.to];
  const pts = eps.map(resolve);
  if (pts.some((p) => !p)) {
    res.innerHTML = `<div class="note">Waiting for a GPS fix. GPS works without internet — it may take a minute, best outside or near a window.
      ${state.gpsError ? '<br>(' + esc(state.gpsError) + ')' : ''}</div>
      <button class="big" id="usecenter">Start from the map center instead</button>`;
    $('#usecenter').onclick = () => { const c = state.map.getCenter(); d.from = { label: 'Map center', lon: c.lng, lat: c.lat }; $('#dfrom').value = 'Map center'; runRoute(); };
    return;
  }
  res.innerHTML = '<p class="muted">Finding a route…</p>';
  const avoid = settings.get().avoidFlood;
  const legs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const r = await getRoute(pts[i], pts[i + 1], d.mode, avoid, pins.blockedPoints());
    if (!$('#dres')) return;
    if (!r.ok) {
      state.route = null; drawRoute(null);
      const leg = pts.length > 2 ? ` (part ${i + 1}: ${esc(eps[i].label)} → ${esc(eps[i + 1].label)})` : '';
      res.innerHTML = `<div class="note"><b>No route${leg}.</b> ${esc(r.reason)}</div>`;
      return;
    }
    legs.push(r);
  }
  const r = combineLegs(legs, (d.stops || []).map((s) => s.label));
  r.toLabel = d.to.label;
  state.route = r;
  drawRoute(r, true);
  res.innerHTML = routeHtml(r);
}

function routeHtml(r) {
  const modeWord = { car: 'driving', foot: 'walking', bike: 'biking' }[r.mode];
  const extra = r.gaps.reduce((n, g) => n + (g[2] > 50 ? g[2] : 0), 0);
  let flood = '';
  const spots = r.flood.spots;
  if (spots.length) {
    // group repeats of the same road + warning into one line with a count
    const grouped = new Map();
    for (const sp of spots) {
      const key = sp.road + '|' + sp.kinds.join(',');
      const g = grouped.get(key);
      if (g) g.n++; else grouped.set(key, { ...sp, n: 1 });
    }
    const lines = [...grouped.values()];
    const top = lines.slice(0, 8).map((s) => `<li>${esc(s.road)}${s.n > 1 ? ` (${s.n} spots)` : ''}: ${s.kinds.map((k) => FLOOD_WORDS[k]).join('; ')}</li>`).join('');
    flood = `<div class="note"><b>⚠ Flood warning:</b> this route passes ${spots.length} flood-prone spot${spots.length > 1 ? 's' : ''} (yellow dots).
      <ul>${top}</ul>${lines.length > 8 ? `<div>…and ${lines.length - 8} more roads.</div>` : ''}
      This warning is based on FEMA floodplain maps and road shape. It is NOT a live flood report — the app cannot know if a road is flooded right now. Never drive or walk into water.</div>`;
  } else if (state.meta && state.meta.hasFlood) {
    flood = '<p class="small muted">No mapped flood-prone spots on this route. That does not mean it is dry right now — watch for water.</p>';
  } else {
    flood = '<p class="small muted">Flood map data is not in this download, so flood-prone roads cannot be flagged.</p>';
  }
  let alt = '';
  if (r.alt && r.alt.picked === 'safer') alt = `<p class="small">Chose a route that avoids more flood-prone spots. It is ${aboutTime(r.time - r.alt.fastestTime)} longer than the fastest route.</p>`;
  if (r.alt && r.alt.picked === 'fastest' && r.alt.saferTime == null) alt = '<p class="small">No nearby route with fewer flood-prone spots was found.</p>';
  if (r.alt && r.alt.picked === 'fastest' && r.alt.saferTime != null) alt = `<p class="small">A route with fewer flood-prone spots exists but takes ${aboutTime(r.alt.saferTime)} — much longer — so the faster one is shown.</p>`;
  return `
    <div class="eta" id="eta">${aboutTime(r.time)}</div>
    <div>${miles(r.dist)} · ${modeWord}${r.stopsAt.length ? ` · ${r.stopsAt.length} stop${r.stopsAt.length > 1 ? 's' : ''}` : ''} · arrive around ${clockAt(r.time)} (estimate)</div>
    <p class="small muted" id="eta-note">${ETA_NOTE}${r.stopsAt.length ? ' Time spent at stops is not included.' : ''}</p>
    ${extra > 0 ? `<p class="small muted">The dotted lines (${miles(extra)}) from your points to the nearest road are not counted in the time.</p>` : ''}
    ${flood}${alt}
    <ol class="steps">${r.steps.map((s) => `<li>${esc(s.text)}${s.dist ? ` <span class="muted small">— ${miles(s.dist)}</span>` : ''}</li>`).join('')}</ol>`;
}

function drawRoute(r, fit) {
  const src = state.map.getSource('route');
  const spots = state.map.getSource('spots');
  if (!src) return;
  if (!r) { src.setData({ type: 'FeatureCollection', features: [] }); spots.setData({ type: 'FeatureCollection', features: [] }); return; }
  const feats = [{ type: 'Feature', properties: { part: 'main' }, geometry: { type: 'LineString', coordinates: r.coords } }];
  for (const [a, b, d] of r.gaps) if (d > 5) feats.push({ type: 'Feature', properties: { part: 'gap' }, geometry: { type: 'LineString', coordinates: [a, b] } });
  for (const s of r.stopsAt) feats.push({ type: 'Feature', properties: { part: 'stop' }, geometry: { type: 'Point', coordinates: s } });
  src.setData({ type: 'FeatureCollection', features: feats });
  spots.setData({ type: 'FeatureCollection', features: r.flood.spots.map((s) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
    properties: { text: `${s.road}: ${s.kinds.map((k) => FLOOD_WORDS[k]).join('; ')}` } })) });
  // distance along the route, for "remaining distance" on the dashboard
  r.cum = [0];
  for (let i = 1; i < r.coords.length; i++) r.cum.push(r.cum[i - 1] + metersBetween(r.coords[i - 1], r.coords[i]));
  if (fit) {
    const b = new maplibregl.LngLatBounds();
    r.coords.forEach((c) => b.extend(c)); b.extend(r.from); b.extend(r.to);
    state.map.fitBounds(b, { padding: { top: 120, bottom: Math.round(innerHeight * 0.5), left: 30, right: 30 }, duration: settings.get().battery ? 0 : 600, maxZoom: 16 });
  }
}

// ------------------------------------------------------------------ nearest essentials + map toggles
function nearest(cats, n = 5) {
  const o = origin();
  return state.pois.filter((p) => cats.includes(p.cat))
    .map((p) => ({ ...p, d: metersBetween([o.lon, o.lat], [p.lon, p.lat]), b: bearingDeg([o.lon, o.lat], [p.lon, p.lat]) }))
    .sort((a, b) => a.d - b.d).slice(0, n);
}
const catLabel = (c) => (CATS[c] ? CATS[c].label : c === 'community' ? 'Community center' : '');
const poiPlace = (p) => ({
  label: p.name,
  sub: [catLabel(p.cat), p.addr, p.pc && 'TX ' + p.pc, p.phone && 'Phone: ' + p.phone].filter(Boolean).join(', '),
  note: p.note || '', src: p.src, lon: p.lon, lat: p.lat, cat: p.cat,
});

function nearestOne(cat) {
  if (!state.area) return openAreas();
  let cats = [cat];
  let warn = '';
  if (cat === 'shelter') {
    cats = ['shelter', 'community'];
    warn = '<div class="note">Official emergency shelters open only during disasters and change each time. This shows mapped shelters and community centers that are often used as shelters or cooling centers — not confirmed open or with space. Listen to local radio for official shelter news.</div>';
  }
  if (cat === 'grocery') cats = ['grocery', 'foodbank'];
  if (cat === 'fire') cats = ['fire', 'police', 'emergency'];
  let list = nearest(cats, 6);
  if (cat === 'water' && !list.length) {
    list = nearest(['grocery'], 6);
    warn = '<div class="note">No public drinking-water point is mapped near here. Grocery stores are the most practical places to get water — the app cannot know if they are open or have water.</div>';
  }
  if (!list.length) return showSheet('Nearest ' + CATS[cat].label.toLowerCase(), `<div class="note">None found in the downloaded map area.</div>`);
  showPois(list);
  const first = list[0];
  const o = origin();
  const more = list.slice(1).map((p, i) => `<li><div>${esc(p.name)}<div class="muted small">${miles(p.d)} ${compassWord(p.b)} · ${esc(catLabel(p.cat))}</div></div><button data-i="${i + 1}">Show</button></li>`).join('');
  showPlace(poiPlace(first), `
    <p><b>Nearest ${esc(CATS[cat].label.toLowerCase())}: ${miles(first.d)}, ${compassWord(first.b)}</b> of ${esc(o.label)} (straight line).</p>${warn}
    ${more ? `<details><summary>More nearby (${list.length - 1})</summary><ul class="list" id="morelist">${more}</ul></details>` : ''}`);
  const ml = $('#morelist');
  if (ml) ml.onclick = (e) => { const b = e.target.closest('[data-i]'); if (b) showPlace(poiPlace(list[+b.dataset.i])); };
}

function openEssentials() {
  const body = showSheet('Nearest essentials', `
    <p class="small muted">Distances are from ${esc(origin().label)}. Places come from the downloaded map — ${NOT_LIVE}</p>
    <div class="grid">${Object.entries(CATS).filter(([k]) => !CATS[k].hidden).map(([k, c]) => `<button data-cat="${k}">${c.icon} ${c.label}</button>`).join('')}</div>`, 'essentials', true);
  body.onclick = (e) => { const b = e.target.closest('[data-cat]'); if (b) nearestOne(b.dataset.cat); };
}

// map toggles: show / hide each kind of survival place
function groupOf(cat) { return Object.keys(GROUPS).find((g) => GROUPS[g].cats.includes(cat)); }
function poiFeatures() {
  return { type: 'FeatureCollection', features: state.pois.map((p) => {
    const g = groupOf(p.cat);
    return g && { type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: { group: g, color: GROUPS[g].color, name: p.name, place: JSON.stringify(poiPlace(p)) } };
  }).filter(Boolean) };
}
function enabledLayers() { const l = settings.get().layers || {}; return Object.keys(GROUPS).filter((g) => l[g]); }
function applyLayers() {
  const on = enabledLayers();
  document.querySelectorAll('#layers [data-layer]').forEach((b) => b.setAttribute('aria-pressed', on.includes(b.dataset.layer)));
  const f = ['in', ['get', 'group'], ['literal', on]];
  if (state.map.getLayer('allpois')) { state.map.setFilter('allpois', f); state.map.setFilter('allpois-label', f); }
}
function renderLayerChips() {
  $('#layers').innerHTML = Object.entries(GROUPS).map(([k, g]) =>
    `<button data-layer="${k}" aria-pressed="false" style="--chip:${g.color}">${g.icon} ${g.label}</button>`).join('');
  $('#layers').onclick = (e) => {
    const b = e.target.closest('[data-layer]');
    if (!b) return;
    const l = { ...(settings.get().layers || {}) };
    l[b.dataset.layer] = !l[b.dataset.layer];
    settings.set({ layers: l });
    applyLayers();
  };
  applyLayers();
}

// ------------------------------------------------------------------ GPS + compass dashboard
let compassOn = false;
function onOrientation(e) {
  let h = null;
  if (e.webkitCompassHeading != null) h = e.webkitCompassHeading;
  else if (e.absolute && e.alpha != null) h = 360 - e.alpha;
  if (h != null) { state.heading = h; state.headingSrc = 'compass'; updateArrows(); }
}
async function startCompass() {
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
      if ((await DeviceOrientationEvent.requestPermission()) !== 'granted') return false;
    }
  } catch { return false; }
  window.addEventListener('deviceorientationabsolute', onOrientation);
  window.addEventListener('deviceorientation', onOrientation);
  compassOn = true;
  return true;
}
function stopCompass() {
  window.removeEventListener('deviceorientationabsolute', onOrientation);
  window.removeEventListener('deviceorientation', onOrientation);
  compassOn = false;
}
function updateArrows() {
  document.querySelectorAll('.arrow[data-b]').forEach((el) => {
    const rel = (+el.dataset.b - (state.heading || 0) + 360) % 360;
    el.style.transform = `rotate(${rel}deg)`;
  });
  const h = $('#dash-heading');
  if (h && state.heading != null) h.textContent = `${Math.round(state.heading)}° ${compassWord(state.heading)}`;
}
if (navigator.getBattery) {
  navigator.getBattery().then((b) => {
    const upd = () => { state.battery = { level: b.level, charging: b.charging }; if ($('#sheet').dataset.view === 'dash') renderDash(); };
    upd();
    b.addEventListener('levelchange', upd);
    b.addEventListener('chargingchange', upd);
  }).catch(() => {});
}

function remainingOnRoute(r, me) {
  if (!r || !r.cum || !me) return null;
  let best = 0, bd = Infinity;
  for (let i = 0; i < r.coords.length; i += 1) {
    const d = metersBetween(r.coords[i], [me.lon, me.lat]);
    if (d < bd) { bd = d; best = i; }
  }
  const left = r.cum.at(-1) - r.cum[best];
  return { dist: left, time: r.dist > 0 ? (r.time * left) / r.dist : 0, off: bd };
}

function renderDash() {
  const me = state.me;
  const o = origin();
  const tile = (label, value, sub = '') => `<div class="tile"><div class="small muted">${label}</div><div class="big-num">${value}</div>${sub ? `<div class="small muted">${sub}</div>` : ''}</div>`;
  const coords = me ? `${me.lat.toFixed(5)}, ${me.lon.toFixed(5)}` : 'No GPS fix';
  const coordSub = me ? `±${Math.round(me.acc * 3.28)} ft · ${Math.round((Date.now() - me.t) / 1000)} s ago${me.speed != null && me.speed > 0.5 ? ` · ${Math.round(me.speed * 2.237)} mph` : ''}${me.alt != null ? ` · ${Math.round(me.alt * 3.28)} ft altitude` : ''}` : (state.gpsError ? esc(state.gpsError) : 'Waiting… best outside or near a window');
  const heading = state.heading != null ? `${Math.round(state.heading)}° ${compassWord(state.heading)}` : '—';
  const headingSub = state.heading != null ? (state.headingSrc === 'compass' ? 'from compass' : 'from GPS movement') : (compassOn ? 'Waiting for compass…' : 'Compass off');
  const bat = state.battery ? `${Math.round(state.battery.level * 100)}%` : '—';
  const batSub = state.battery ? (state.battery.charging ? 'charging' : 'on battery') : 'This browser does not share battery level (iPhone Safari does not)';
  let dest = tile('Destination', '—', 'Pick a place or get directions');
  let eta = tile('ETA', '—', 'No route yet');
  const target = state.route ? { label: state.route.toLabel, lon: state.route.to[0], lat: state.route.to[1] } : state.selected;
  if (target) {
    const d = metersBetween([o.lon, o.lat], [target.lon, target.lat]);
    dest = tile('Distance to destination', miles(d), `${esc(target.label)} · ${compassWord(bearingDeg([o.lon, o.lat], [target.lon, target.lat]))}, straight line`);
  }
  if (state.route) {
    const rem = remainingOnRoute(state.route, me);
    eta = rem && rem.off < 300
      ? tile('ETA (estimate)', aboutTime(rem.time), `${miles(rem.dist)} left on the route · arrive around ${clockAt(rem.time)}`)
      : tile('ETA (estimate)', aboutTime(state.route.time), `Whole route, ${miles(state.route.dist)}${rem ? ' · you are off the route line' : ''}`);
  }
  const helpRows = [['hospital', 'Hospital', ['hospital']], ['shelter', 'Shelter', ['shelter', 'community']], ['water', 'Water', ['water']]].map(([cat, label, cats]) => {
    let p = nearest(cats, 1)[0];
    let extra = '';
    if (!p && cat === 'water') { p = nearest(['grocery'], 1)[0]; extra = ' (none mapped — nearest grocery)'; }
    if (!p) return `<li><div><b>${label}:</b> none in downloaded area</div></li>`;
    return `<li><span class="arrow" data-b="${p.b.toFixed(0)}">↑</span><div><b>${label}: ${miles(p.d)}, ${compassWord(p.b)}</b>${extra}<div class="small muted">${esc(p.name)}</div></div><button data-cat="${cat}">Go</button></li>`;
  }).join('');
  const t = trails.current();
  const trailLine = t ? `<p class="small">🟠 Recording trail: ${t.points.length} points, ${miles(trailLength(t.points))}${t.points.length && me ? ` · start is ${miles(metersBetween([me.lon, me.lat], t.points[0]))} away` : ''}</p>` : '';
  const sheet = $('#sheet');
  const body = showSheet('GPS & compass', `
    <div class="tiles">
      ${tile('My coordinates', coords, coordSub)}
      <div class="tile"><div class="small muted">Compass direction</div><div class="big-num" id="dash-heading">${heading}</div><div class="small muted">${headingSub}</div></div>
      ${dest}${eta}
      ${tile('Battery', bat, batSub)}
    </div>
    ${trailLine}
    <h3>Nearest help (from ${esc(o.label)})</h3>
    <ul class="list">${helpRows}</ul>
    ${compassOn ? '<p class="small muted">Arrows point the way while you hold the phone flat.</p>'
      : `<button class="big" id="compass" ${settings.get().battery ? 'disabled' : ''}>Turn on compass</button><p class="small muted">${settings.get().battery ? 'Compass is off in battery saver. ' : ''}Without the compass, arrows point as if north is up.</p>`}
    <p class="small muted">Everything here works with no internet. ETA is an estimate from speed limits and distance — no live traffic.</p>`,
  'dash', !sheet.hidden && sheet.dataset.view !== 'dash');
  updateArrows();
  body.onclick = async (e) => {
    if (e.target.id === 'compass') { if (await startCompass()) renderDash(); else e.target.textContent = 'Compass not available on this device'; }
    const b = e.target.closest('[data-cat]');
    if (b) nearestOne(b.dataset.cat);
  };
}

// ------------------------------------------------------------------ breadcrumb trail
let wakeLock = null;
function trailLength(points) {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += metersBetween(points[i - 1], points[i]);
  return d;
}
function drawTrail(points) {
  const src = state.map && state.map.getSource('trail');
  if (!src) return;
  const t = points || (trails.current() && trails.current().points) || state.shownTrail || [];
  const feats = [];
  if (t.length > 1) feats.push({ type: 'Feature', properties: { part: 'line' }, geometry: { type: 'LineString', coordinates: t.map((p) => [p[0], p[1]]) } });
  if (t.length) feats.push({ type: 'Feature', properties: { part: 'start' }, geometry: { type: 'Point', coordinates: [t[0][0], t[0][1]] } });
  src.setData({ type: 'FeatureCollection', features: feats });
}
function recordPoint(me) {
  const t = trails.current();
  if (!t || me.acc > 100) return;
  const last = t.points.at(-1);
  const minMove = settings.get().battery ? 25 : 10;
  if (!last || metersBetween(last, [me.lon, me.lat]) >= minMove) {
    trails.addPoint([+me.lon.toFixed(6), +me.lat.toFixed(6), Date.now()]);
    drawTrail();
  }
}
async function startTrail() {
  trails.start();
  state.shownTrail = null;
  try { if (navigator.wakeLock && !settings.get().battery) wakeLock = await navigator.wakeLock.request('screen'); } catch { /* not supported */ }
  if (state.me) recordPoint(state.me);
  drawTrail();
}
function stopTrail() {
  const t = trails.stop();
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  if (t) state.shownTrail = t.points;
  drawTrail();
  return t;
}
function routeBackTo(points, label) {
  if (!points || !points.length) return;
  state.dir.stops = [];
  openDirections({ from: MY_LOCATION, to: { label, lon: points[0][0], lat: points[0][1] }, run: true });
}

function openTrail(msg = '') {
  const t = trails.current();
  const list = trails.saved();
  const body = showSheet('Breadcrumb trail', `
    ${msg ? `<div class="note">${esc(msg)}</div>` : ''}
    ${t ? `<p><b>🟠 Recording.</b> ${t.points.length} points, ${miles(trailLength(t.points))} since ${new Date(t.started).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.</p>
      <button class="primary big" id="tstop">Stop and save trail</button>
      <div class="row"><button id="tback">↩ Route back to trail start</button></div>`
    : `<button class="primary big" id="tstart">● Start recording trail</button>`}
    <div class="row"><button id="tcar">🚗 Mark my vehicle here</button><button id="twp">📍 Add waypoint here</button></div>
    <p class="small muted">The trail records where you go so you can find your way back (for example to Home or your vehicle). Keep the app open with the screen on while recording — phones pause web apps in the background.${settings.get().battery ? ' Battery saver is on, so points are only added every 2 minutes.' : ''} Saved only on this device.</p>
    ${list.length ? `<h3>Saved trails</h3><ul class="list">${list.map((s) => `<li><div><b>${esc(s.name)}</b><div class="small muted">${miles(trailLength(s.points))} · ${s.points.length} points</div></div>
      <button data-show="${s.id}">Show</button><button class="primary" data-back="${s.id}">Back</button><button class="danger" data-del="${s.id}" aria-label="Delete trail">🗑</button></li>`).join('')}</ul>` : ''}`,
  'trail', !$('#sheet').hidden && $('#sheet').dataset.view !== 'trail');
  body.onclick = async (e) => {
    const id = e.target.id;
    if (id === 'tstart') { await startTrail(); openTrail(state.me ? 'Recording started.' : 'Recording started. Waiting for a GPS fix for the first point.'); }
    if (id === 'tstop') { const s = stopTrail(); openTrail(s ? `Saved “${s.name}”.` : 'Stopped. No points were recorded (no GPS fix).'); }
    if (id === 'tback') routeBackTo(trails.current().points, 'Trail start');
    if (id === 'tcar' || id === 'twp') {
      const o = origin();
      const type = id === 'tcar' ? 'vehicle' : 'meeting';
      const name = id === 'tcar' ? 'My vehicle' : `Waypoint ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
      saved.add({ name, type, lon: o.lon, lat: o.lat, address: `${o.lat.toFixed(5)}, ${o.lon.toFixed(5)}` });
      openTrail(`Saved “${name}” at ${o.label}. Find it under Saved.`);
    }
    const sh = e.target.closest('[data-show]'), bk = e.target.closest('[data-back]'), dl = e.target.closest('[data-del]');
    const find = (x) => trails.saved().find((s) => s.id === x);
    if (sh) { const s = find(sh.dataset.show); state.shownTrail = s.points; drawTrail(s.points); const b = new maplibregl.LngLatBounds(); s.points.forEach((p) => b.extend([p[0], p[1]])); state.map.fitBounds(b, { padding: 60, maxZoom: 17 }); }
    if (bk) { const s = find(bk.dataset.back); state.shownTrail = s.points; drawTrail(s.points); routeBackTo(s.points, `Start of ${s.name}`); }
    if (dl && confirm('Delete this trail?')) { trails.remove(dl.dataset.del); state.shownTrail = null; drawTrail(); openTrail(); }
  };
}

// ------------------------------------------------------------------ saved places
function saveForm(p) {
  const body = showSheet('Save place', `
    <div class="field"><label>Name</label><input id="sname" value="${esc(p.label === 'Dropped pin' ? '' : p.label)}" placeholder="e.g. Home, Mom's house"></div>
    <div class="grid">${Object.entries(SAVED_TYPES).map(([k, v]) => `<button data-type="${k}">${v}</button>`).join('')}</div>
    <p class="small muted">Tap a type to save. Saved only on this device.</p>`, 'save', true);
  body.onclick = (e) => {
    const b = e.target.closest('[data-type]');
    if (!b) return;
    const name = $('#sname').value.trim() || SAVED_TYPES[b.dataset.type];
    saved.add({ name, type: b.dataset.type, lon: p.lon, lat: p.lat, address: p.sub || '' });
    openSaved(`Saved “${name}”.`);
  };
}

function openSaved(msg = '') {
  const list = saved.all();
  const order = Object.keys(SAVED_TYPES);
  list.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  const body = showSheet('Saved places', `
    ${msg ? `<div class="note">${esc(msg)}</div>` : ''}
    ${list.length ? `<ul class="list">${list.map((s) => `<li><div><b>${esc(s.name)}</b><div class="small muted">${esc(SAVED_TYPES[s.type] || '')}${s.address ? ' · ' + esc(s.address) : ''}</div></div>
      <button class="primary" data-go="${s.id}">Go</button><button class="danger" data-del="${s.id}" aria-label="Delete ${esc(s.name)}">🗑</button></li>`).join('')}</ul>`
      : '<p>No saved places yet. Search an address (or tap the map), then tap “Save place”. Save Home, family, a shelter and a meeting point.</p>'}
    <p class="small muted">Tap Go to get directions from your location right away. Saved only on this device.</p>`, 'saved');
  body.onclick = (e) => {
    const go = e.target.closest('[data-go]');
    if (go) { const s = saved.all().find((x) => x.id === go.dataset.go); state.dir.from = MY_LOCATION; openDirections({ to: nameSaved(s), run: true }); }
    const del = e.target.closest('[data-del]');
    if (del && confirm('Delete this saved place?')) { saved.remove(del.dataset.del); openSaved(); }
  };
}

// ------------------------------------------------------------------ pins
function pinForm(at, existing) {
  const p = existing || { type: 'hazard', note: '', ...at };
  const body = showSheet(existing ? 'Edit pin' : 'Add pin', `
    <div class="grid">${Object.entries(PIN_TYPES).map(([k, v]) => `<button data-type="${k}" aria-pressed="${p.type === k}" style="border-left:8px solid ${v.color}">${v.label}</button>`).join('')}</div>
    <div class="field"><label>Note (optional)</label><textarea id="pnote" rows="3" maxlength="500" placeholder="e.g. Water over road here after storms">${esc(p.note)}</textarea></div>
    <button class="primary big" id="psave">Save pin</button>
    <p class="small muted">“Blocked road” pins are avoided when the app makes routes. Pins are saved only on this device.</p>`, 'pin', true);
  let type = p.type;
  body.onclick = (e) => {
    const b = e.target.closest('[data-type]');
    if (b) { type = b.dataset.type; body.querySelectorAll('[data-type]').forEach((x) => x.setAttribute('aria-pressed', x === b)); }
    if (e.target.id === 'psave') {
      const note = $('#pnote').value.trim();
      if (existing) pins.update(existing.id, { type, note }); else pins.add({ type, note, lon: p.lon, lat: p.lat });
      drawPins();
      openPins('Pin saved.');
    }
  };
}

function showPin(id) {
  const p = pins.all().find((x) => x.id === id);
  if (!p) return;
  const t = PIN_TYPES[p.type] || PIN_TYPES.note;
  const body = showSheet(t.label, `
    <p>${esc(p.note || '(no note)')}</p>
    <div class="small muted">Added ${new Date(p.created).toLocaleString()} · ${esc(distanceLine(p))}</div>
    <button class="primary big" data-a="go">Directions</button>
    <div class="row"><button data-a="edit">Edit</button><button class="danger" data-a="del">Delete</button></div>`, 'pinview');
  body.onclick = (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'go') openDirections({ to: { label: t.label + (p.note ? ': ' + p.note.slice(0, 30) : ''), lon: p.lon, lat: p.lat } });
    if (a === 'edit') pinForm(null, p);
    if (a === 'del' && confirm('Delete this pin?')) { pins.remove(p.id); drawPins(); openPins(); }
  };
}

function openPins(msg = '') {
  const list = pins.all();
  const body = showSheet('My pins & notes', `
    ${msg ? `<div class="note">${esc(msg)}</div>` : ''}
    <button class="big" id="addhere">+ Add pin at ${state.me ? 'my location' : 'map center'}</button>
    ${list.length ? `<ul class="list">${list.map((p) => `<li><span class="marker pin" style="background:${(PIN_TYPES[p.type] || PIN_TYPES.note).color}"></span><div><b>${esc((PIN_TYPES[p.type] || PIN_TYPES.note).label)}</b><div class="small muted">${esc(p.note || '')}</div></div><button data-show="${p.id}">Show</button></li>`).join('')}</ul>`
      : '<p class="muted">No pins yet. Tap anywhere on the map, then “Add pin / note”.</p>'}`, 'pins', true);
  body.onclick = (e) => {
    if (e.target.id === 'addhere') { const o = origin(); pinForm({ lon: o.lon, lat: o.lat }); }
    const s = e.target.closest('[data-show]');
    if (s) { const p = pins.all().find((x) => x.id === s.dataset.show); state.map.easeTo({ center: [p.lon, p.lat], zoom: 16 }); showPin(p.id); }
  };
}

// ------------------------------------------------------------------ guide + checklist
function openGuide(tab = 'firstaid') {
  const g = GUIDE.find((x) => x.id === tab) || GUIDE[0];
  const body = showSheet('Survival guide', `
    <div class="note">${DISCLAIMER}</div>
    <div class="seg" style="grid-template-columns:repeat(4,1fr)">${GUIDE.map((x) => `<button data-tab="${x.id}" aria-pressed="${x.id === g.id}">${x.title}</button>`).join('')}</div>
    <div class="guide">${g.sections.map(([h, items]) => `<h3>${esc(h)}</h3><ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`).join('')}</div>
    <p class="small muted">Sources: American Red Cross, American Heart Association, CDC, National Weather Service, FEMA/Ready.gov, FoodSafety.gov.</p>`, 'guide', $('#sheet').dataset.view !== 'guide');
  body.onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) openGuide(b.dataset.tab); };
}

function openChecklist() {
  const c = checklist.get();
  const total = CHECKLIST.reduce((n, [, items]) => n + items.length, 0);
  const done = Object.values(c).filter(Boolean).length;
  const body = showSheet('Storm / blackout checklist', `
    <p><b>${done} of ${total}</b> done.</p>
    ${CHECKLIST.map(([h, items]) => `<h3>${esc(h)}</h3>${items.map(([id, text]) => `<label class="check"><input type="checkbox" data-id="${id}" ${c[id] ? 'checked' : ''}> ${esc(text)}</label>`).join('')}`).join('')}
    <button class="big" id="creset">Clear all ticks</button>
    <p class="small muted">Based on Ready.gov's emergency kit list. Saved only on this device.</p>`, 'checklist', true);
  body.onchange = (e) => { if (e.target.dataset.id) { checklist.toggle(e.target.dataset.id, e.target.checked); const n = Object.values(checklist.get()).filter(Boolean).length; body.querySelector('p b').textContent = `${n} of ${total}`; } };
  body.onclick = (e) => { if (e.target.id === 'creset' && confirm('Clear all ticks?')) { checklist.reset(); openChecklist(); } };
}

// ------------------------------------------------------------------ map areas + storage
async function openAreas(msg = '') {
  const body = showSheet('Map areas & storage', '<p class="muted">Checking…</p>', 'areas', $('#sheet').dataset.view !== 'areas' && !$('#sheet').hidden);
  const online = await areas.availableAreas();
  const local = areas.downloadedAreas();
  const est = await areas.storageEstimate();
  const all = new Map();
  (online || []).forEach((a) => all.set(a.id, { ...a, remote: true }));
  Object.values(local).forEach((a) => all.set(a.id, { ...(all.get(a.id) || {}), local: a, id: a.id, name: a.name }));
  const usedLocal = Object.values(local).reduce((n, a) => n + (a.bytes || 0), 0);
  body.innerHTML = `
    ${msg ? `<div class="note">${esc(msg)}</div>` : ''}
    ${online ? '' : '<div class="note">Offline right now: you can use and delete downloaded areas, but downloading needs internet.</div>'}
    <p>Map data on this device: <b>${areas.formatBytes(usedLocal)}</b>${est ? ` · free space for this app: about ${areas.formatBytes(Math.max(0, est.quota - est.usage))}` : ''}</p>
    <ul class="list">${[...all.values()].map((a) => {
      const active = state.area === a.id;
      const newer = a.local && a.remote && a.built && a.local.built !== a.built;
      return `<li><div><b>${esc(a.name)}</b>
        <div class="small muted">${a.local ? `On device · ${areas.formatBytes(a.local.bytes)} · data from ${esc(a.local.built)}${active ? ' · <b>in use</b>' : ''}` : `Not downloaded · ${areas.formatBytes(a.bytes)}`}${newer ? ` · newer data (${esc(a.built)}) available` : ''}</div>
        <div class="progress" id="prog-${a.id}" hidden><div></div></div></div>
        <div style="display:flex;flex-direction:column;gap:6px">
        ${a.remote && (!a.local || newer) ? `<button class="primary" data-dl="${a.id}">${a.local ? 'Update' : 'Download'}</button>` : ''}
        ${a.local && !active ? `<button data-use="${a.id}">Use</button>` : ''}
        ${a.local ? `<button class="danger" data-del="${a.id}">Delete</button>` : ''}</div></li>`;
    }).join('') || '<li>No areas found. Connect to the internet once to see what can be downloaded.</li>'}</ul>
    <p class="small muted">Download while you have Wi-Fi. After that, everything works with no internet. Data stays on this device.</p>`;
  body.onclick = async (e) => {
    const dl = e.target.closest('[data-dl]'), use = e.target.closest('[data-use]'), del = e.target.closest('[data-del]');
    if (dl) {
      const a = all.get(dl.dataset.dl);
      const prog = $('#prog-' + a.id);
      prog.hidden = false;
      body.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      try {
        await areas.downloadArea(a, (d, t) => { prog.firstElementChild.style.width = (t ? Math.min(100, (100 * d) / t) : 50) + '%'; });
        await useArea(a.id, true);
        openAreas(`Downloaded “${a.name}”. It now works offline.`);
      } catch (err) {
        openAreas('Download failed: ' + err.message + '. Your old data (if any) is unchanged.');
      }
    }
    if (use) { await useArea(use.dataset.use); openAreas('Now using this area.'); }
    if (del && confirm('Delete this map area from the device?')) {
      await areas.deleteArea(del.dataset.del);
      if (state.area === del.dataset.del) { const next = Object.keys(areas.downloadedAreas())[0] || null; await useArea(next); }
      openAreas('Deleted.');
    }
  };
}

async function useArea(id, force) {
  state.area = id;
  settings.set({ area: id });
  state.meta = id ? areas.downloadedAreas()[id] : null;
  state.pois = []; state.flood = null; state.route = null;
  if (id) {
    const [poisBlob, floodBlob] = await Promise.all([areas.getFile(id, 'pois.json'), areas.getFile(id, 'flood.geojson')]);
    state.pois = poisBlob ? JSON.parse(await poisBlob.text()) : [];
    state.flood = floodBlob ? JSON.parse(await floodBlob.text()) : null;
    await Promise.all([openSearch(id), loadRoads(id)]);
  }
  const ap = state.map && state.map.getSource('allpois');
  if (ap) ap.setData(poiFeatures());
  if (state.map) {
    await restyle(force);
    state.map.setMaxBounds(state.meta ? padBounds(state.meta.bbox, 0.25) : null);
    if (state.meta) state.map.fitBounds([[state.meta.bbox[0], state.meta.bbox[1]], [state.meta.bbox[2], state.meta.bbox[3]]], { duration: 0 });
  }
  setStatus();
  document.body.dataset.ready = id ? 'area' : 'none';
}

// ------------------------------------------------------------------ more menu + battery
function openMore() {
  const s = settings.get();
  const body = showSheet('More', `
    <div class="grid">
      <button data-m="essentials">🔎 Nearest essentials</button>
      <button data-m="dash">🧭 GPS & compass dashboard</button>
      <button data-m="trail">🟠 Breadcrumb trail</button>
      <button data-m="pins">📌 My pins & notes</button>
      <button data-m="guide">⛑ First aid & survival guide</button>
      <button data-m="checklist">✅ Storm / blackout checklist</button>
      <button data-m="areas">🗺 Map areas & storage</button>
    </div>
    <label class="check"><input type="checkbox" id="battery" ${s.battery ? 'checked' : ''}> 🔋 Battery saver (dark map, GPS every 2 min, compass off)</label>
    <label class="check"><input type="checkbox" id="showflood" ${s.showFlood ? 'checked' : ''}> 🌊 Show floodplain layer (FEMA maps, not live)</label>
    <button class="big" data-m="about">About & limits</button>`, 'more');
  body.onclick = (e) => {
    const m = e.target.closest('[data-m]')?.dataset.m;
    ({ essentials: openEssentials, dash: renderDash, trail: () => openTrail(), pins: () => openPins(), guide: () => openGuide(), checklist: openChecklist, areas: () => openAreas(), about: openAbout })[m]?.();
  };
  $('#battery').onchange = async (e) => { settings.set({ battery: e.target.checked }); await applyBattery(); };
  $('#showflood').onchange = (e) => { settings.set({ showFlood: e.target.checked }); if (state.map.getLayer('flood-fill')) state.map.setLayoutProperty('flood-fill', 'visibility', e.target.checked ? 'visible' : 'none'); };
}

async function applyBattery() {
  const on = settings.get().battery;
  if (on) stopCompass();
  try { state.map.setPixelRatio(on ? 1 : devicePixelRatio); } catch { /* older browsers */ }
  await restyle();
  startGps();
  setStatus();
}

function openAbout() {
  showSheet('About & limits', `
    <p>An offline survival map for the Houston metro area. After you download a map area once, the map, search, directions, nearest help, saved places, pins and the guide all work with no internet, no Wi-Fi and no cell signal. GPS and compass work offline too.</p>
    <h3>What this app can NOT know offline</h3>
    <ul>
      <li>It does not know live traffic, accidents or road closures.</li>
      <li>It does not know whether a road is flooded right now. Flood warnings come from FEMA floodplain maps and road shape.</li>
      <li>It does not know whether a place is open, has supplies or has space.</li>
    </ul>
    <p>Times are estimates from speed limits and distance. Map data © OpenStreetMap contributors. Basemap by Protomaps. Floodplains: FEMA National Flood Hazard Layer.</p>
    <p class="small muted">Your saved places, pins, notes and checklist stay on this device only.</p>`, 'about', true);
}

// ------------------------------------------------------------------ bottom bar
$('#bar').addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  if (!state.area && act !== 'more') return openAreas('Download a map area first. You need internet only for this one step.');
  if (act === 'directions') openDirections();
  if (act === 'hospital') nearestOne('hospital');
  if (act === 'shelter') nearestOne('shelter');
  if (act === 'saved') openSaved();
  if (act === 'more') openMore();
});
$('#dashbtn').onclick = () => renderDash();
$('#locate').onclick = () => {
  if (state.me) state.map.easeTo({ center: [state.me.lon, state.me.lat], zoom: 16 });
  else showSheet('Location', `<div class="note">No GPS fix yet. GPS works without internet, but can take a minute — try outside or near a window.${state.gpsError ? '<br>(' + esc(state.gpsError) + ')' : ''}</div>`);
};
window.addEventListener('online', setStatus);
window.addEventListener('offline', setStatus);

// ------------------------------------------------------------------ start
async function start() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  const local = areas.downloadedAreas();
  let id = settings.get().area;
  if (!id || !local[id]) id = Object.keys(local)[0] || null;
  state.area = id;
  state.meta = id ? local[id] : null;
  await setupMap();
  await useArea(id);
  if (settings.get().battery) await applyBattery(); else startGps();
  drawPins();
  renderLayerChips();
  if (trails.current()) { try { if (navigator.wakeLock && !settings.get().battery) wakeLock = await navigator.wakeLock.request('screen'); } catch { /* ignore */ } }
  if (!id) openAreas('Welcome! First, download the Houston map while you have internet. After that it all works offline.');
  if (!state.meta) state.map.jumpTo({ center: HOME_77088, zoom: 10 });
}
start().catch((err) => {
  document.body.dataset.ready = 'error';
  showSheet('Something went wrong', `<p>${esc(err.message)}</p>`);
  console.error(err);
});
