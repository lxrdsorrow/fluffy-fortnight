// Offline directions. Runs in a Web Worker (a background thread).
// The road network (graph.bin) is pre-built from OpenStreetMap by
// pipeline/build_area.py. Path finding uses the standard A* method.

const F = { CAR_FWD: 1, CAR_BWD: 2, FOOT: 4, BIKE_FWD: 8, BIKE_BWD: 16, FLOOD100: 32, UNDERPASS: 64,
  BAYOU: 128, FORD: 256, FLOOD500: 512, PRIVATE: 1024, SLOWBIKE: 2048 };
const WALK_KMH = 5; // about 3 mph
const BIKE_KMH = 15; // about 9 mph
const CELL = 0.005;

let G = null; // the loaded graph
let loadedArea = null;

function parseGraph(buf) {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'HSG1') throw new Error('Unknown road data format');
  const nN = dv.getUint32(8, true), nE = dv.getUint32(12, true), nC = dv.getUint32(16, true), nameLen = dv.getUint32(20, true);
  let off = 24;
  const take = (Type, n, bytes) => {
    const a = new Type(buf, off, n);
    off += Math.ceil((n * bytes) / 4) * 4;
    return a;
  };
  const g = {
    nN, nE,
    lon: take(Int32Array, nN, 4), lat: take(Int32Array, nN, 4),
    u: take(Uint32Array, nE, 4), v: take(Uint32Array, nE, 4), len: take(Float32Array, nE, 4),
    speed: take(Uint8Array, nE, 1), flags: take(Uint16Array, nE, 2), name: take(Uint32Array, nE, 4),
    geom: take(Uint32Array, nE + 1, 4), coords: take(Int32Array, nC * 2, 4),
  };
  g.names = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off, nameLen)));
  // adjacency list: for each node, the road pieces touching it (sign = direction)
  const deg = new Uint32Array(nN + 1);
  for (let e = 0; e < nE; e++) { deg[g.u[e] + 1]++; deg[g.v[e] + 1]++; }
  for (let i = 0; i < nN; i++) deg[i + 1] += deg[i];
  const adj = new Int32Array(nE * 2);
  const fill = deg.slice(0, nN);
  for (let e = 0; e < nE; e++) {
    adj[fill[g.u[e]]++] = e + 1; // leaving u = forward
    adj[fill[g.v[e]]++] = -(e + 1); // leaving v = backward
  }
  g.adjStart = deg;
  g.adj = adj;
  // grid for finding the nearest road to a point
  g.grid = new Map();
  for (let i = 0; i < nN; i++) {
    const k = cellKey(g.lon[i] / 1e6, g.lat[i] / 1e6);
    let arr = g.grid.get(k);
    if (!arr) g.grid.set(k, (arr = []));
    arr.push(i);
  }
  g.gScore = new Float64Array(nN).fill(Infinity);
  g.prev = new Int32Array(nN);
  g.closed = new Uint8Array(nN);
  return g;
}

function cellKey(lon, lat) {
  return (Math.floor(lon / CELL) + 100000) * 200000 + (Math.floor(lat / CELL) + 100000);
}

function meters(lon1, lat1, lon2, lat2) {
  const x = (lon2 - lon1) * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  const y = lat2 - lat1;
  return Math.sqrt(x * x + y * y) * 111195;
}

function allowed(flags, forward, mode) {
  if (mode === 'car') return (flags & (forward ? F.CAR_FWD : F.CAR_BWD)) !== 0;
  if (mode === 'bike') return (flags & (forward ? F.BIKE_FWD : F.BIKE_BWD)) !== 0;
  return (flags & F.FOOT) !== 0;
}

function speedMs(e, mode) {
  if (mode === 'car') return G.speed[e] / 3.6;
  if (mode === 'bike') return ((G.flags[e] & F.SLOWBIKE) ? 6 : BIKE_KMH) / 3.6;
  return WALK_KMH / 3.6;
}

function floodFactor(fl) {
  let k = 1;
  if (fl & F.FORD) k *= 10;
  if (fl & F.UNDERPASS) k *= 4;
  if (fl & F.FLOOD100) k *= 3;
  if (fl & F.BAYOU) k *= 1.5;
  if (fl & F.FLOOD500) k *= 1.3;
  return k;
}

function nodeUsable(n, mode) {
  if (mode === 'any') return G.adjStart[n + 1] > G.adjStart[n];
  for (let i = G.adjStart[n]; i < G.adjStart[n + 1]; i++) {
    const a = G.adj[i];
    const e = Math.abs(a) - 1;
    if (allowed(G.flags[e], a > 0, mode) || allowed(G.flags[e], a < 0, mode)) return true;
  }
  return false;
}

function nearestNodes(lon, lat, mode, k = 4, maxM = 3000) {
  const found = [];
  const cx = Math.floor(lon / CELL), cy = Math.floor(lat / CELL);
  for (let r = 0; r <= Math.ceil(maxM / 450); r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const arr = G.grid.get((cx + dx + 100000) * 200000 + (cy + dy + 100000));
        if (!arr) continue;
        for (const n of arr) {
          if (!nodeUsable(n, mode)) continue;
          found.push({ n, d: meters(lon, lat, G.lon[n] / 1e6, G.lat[n] / 1e6) });
        }
      }
    }
    // a ring further out cannot hold anything closer than r * cell size
    if (found.length >= k && r > 0) {
      found.sort((a, b) => a.d - b.d);
      if (found[k - 1].d < r * CELL * 111195 * 0.86) break;
    }
  }
  found.sort((a, b) => a.d - b.d);
  return found.filter((f) => f.d <= maxM).slice(0, k);
}

// Small binary heap of (priority, node)
class Heap {
  constructor() { this.p = []; this.n = []; }
  get size() { return this.p.length; }
  push(pri, node) {
    const p = this.p, n = this.n;
    let i = p.length;
    p.push(pri); n.push(node);
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (p[j] <= pri) break;
      p[i] = p[j]; n[i] = n[j]; i = j;
    }
    p[i] = pri; n[i] = node;
  }
  pop() {
    const p = this.p, n = this.n;
    const top = n[0];
    this.lastPri = p[0];
    const lp = p.pop(), ln = n.pop();
    if (p.length) {
      let i = 0;
      const len = p.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= len) break;
        if (c + 1 < len && p[c + 1] < p[c]) c++;
        if (p[c] >= lp) break;
        p[i] = p[c]; n[i] = n[c]; i = c;
      }
      p[i] = lp; n[i] = ln;
    }
    return top;
  }
}

function astar(starts, targets, dest, mode, avoidFlood, blockedNodes) {
  const maxSpeed = mode === 'car' ? 140 / 3.6 : mode === 'bike' ? BIKE_KMH / 3.6 : WALK_KMH / 3.6;
  const touched = [];
  const gS = G.gScore, prev = G.prev, closed = G.closed;
  const targetOffset = new Map(targets.map((t) => [t.n, t.cost]));
  const h = (n) => meters(G.lon[n] / 1e6, G.lat[n] / 1e6, dest[0], dest[1]) / maxSpeed;
  const heap = new Heap();
  for (const s of starts) {
    if (s.cost < gS[s.n]) {
      if (gS[s.n] === Infinity) touched.push(s.n);
      gS[s.n] = s.cost; prev[s.n] = 0;
      heap.push(s.cost + h(s.n), s.n);
    }
  }
  // Several possible end points: keep going until no cheaper finish is possible.
  let found = -1, best = Infinity;
  while (heap.size) {
    const n = heap.pop();
    if (heap.lastPri >= best) break;
    if (closed[n]) continue;
    closed[n] = 1;
    if (targetOffset.has(n)) {
      const total = gS[n] + targetOffset.get(n);
      if (total < best) { best = total; found = n; }
    }
    const gn = gS[n];
    for (let i = G.adjStart[n]; i < G.adjStart[n + 1]; i++) {
      const a = G.adj[i];
      const fwd = a > 0;
      const e = (fwd ? a : -a) - 1;
      const fl = G.flags[e];
      if (!allowed(fl, fwd, mode)) continue;
      const m = fwd ? G.v[e] : G.u[e];
      if (closed[m] || (blockedNodes && blockedNodes.has(m))) continue;
      let c = G.len[e] / speedMs(e, mode);
      if (mode === 'car' && (fl & F.PRIVATE)) c *= 5;
      if (avoidFlood) c *= floodFactor(fl);
      const ng = gn + c;
      if (ng < gS[m]) {
        if (gS[m] === Infinity) touched.push(m);
        gS[m] = ng; prev[m] = a;
        heap.push(ng + h(m), m);
      }
    }
  }
  let path = null;
  if (found >= 0) {
    path = [];
    let n = found;
    while (prev[n] !== 0) {
      const a = prev[n];
      const e = Math.abs(a) - 1;
      path.push(a);
      n = a > 0 ? G.u[e] : G.v[e];
    }
    path.reverse();
    path.startNode = n;
    path.endNode = found;
  }
  for (const n of touched) { gS[n] = Infinity; closed[n] = 0; prev[n] = 0; }
  return path;
}

function edgeCoords(a) {
  const e = Math.abs(a) - 1;
  const pts = [];
  for (let i = G.geom[e]; i < G.geom[e + 1]; i++) pts.push([G.coords[2 * i] / 1e6, G.coords[2 * i + 1] / 1e6]);
  if (a < 0) pts.reverse();
  return pts;
}

function bearing(p1, p2) {
  const toR = Math.PI / 180;
  const y = Math.sin((p2[0] - p1[0]) * toR) * Math.cos(p2[1] * toR);
  const x = Math.cos(p1[1] * toR) * Math.sin(p2[1] * toR) - Math.sin(p1[1] * toR) * Math.cos(p2[1] * toR) * Math.cos((p2[0] - p1[0]) * toR);
  return (Math.atan2(y, x) / toR + 360) % 360;
}

const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
const compassWord = (b) => COMPASS[Math.round(b / 45) % 8];

function describe(path, mode) {
  const coords = [];
  const groups = [];
  let dist = 0, time = 0;
  const spots = [];
  const counts = { flood100: 0, flood500: 0, underpass: 0, bayou: 0, ford: 0 };
  let lastSpotKey = null;
  for (const a of path) {
    const e = Math.abs(a) - 1;
    const pts = edgeCoords(a);
    const startIdx = coords.length ? coords.length - 1 : 0;
    if (coords.length) pts.shift();
    for (const p of pts) coords.push(p);
    const len = G.len[e];
    const t = len / speedMs(e, mode);
    dist += len; time += t;
    const nameIdx = G.name[e];
    const g = groups[groups.length - 1];
    if (g && g.nameIdx === nameIdx) { g.dist += len; g.time += t; g.end = coords.length - 1; }
    else groups.push({ nameIdx, dist: len, time: t, start: startIdx, end: coords.length - 1 });
    const fl = G.flags[e];
    const kinds = [];
    if (fl & F.FORD) kinds.push('ford');
    if (fl & F.UNDERPASS) kinds.push('underpass');
    if (fl & F.FLOOD100) kinds.push('flood100');
    if (fl & F.BAYOU) kinds.push('bayou');
    if (!(fl & F.FLOOD100) && (fl & F.FLOOD500)) kinds.push('flood500');
    const key = kinds.join(',') + '|' + nameIdx;
    if (kinds.length && key !== lastSpotKey) {
      for (const k of kinds) counts[k]++;
      const mid = pts[Math.floor(pts.length / 2)] || coords[coords.length - 1];
      spots.push({ kinds, road: G.names[nameIdx] || 'unnamed road', lon: mid[0], lat: mid[1] });
    }
    lastSpotKey = kinds.length ? key : null;
  }
  // fold tiny unnamed pieces into their neighbours so the list stays short
  const merged = [];
  for (const g of groups) {
    const prevG = merged[merged.length - 1];
    if (prevG && g.dist < 40 && !G.names[g.nameIdx]) { prevG.dist += g.dist; prevG.time += g.time; prevG.end = g.end; continue; }
    merged.push({ ...g });
  }
  const steps = merged.map((g, i) => {
    const name = G.names[g.nameIdx] || 'unnamed road';
    const a0 = coords[g.start], a1 = coords[Math.min(g.start + 1, coords.length - 1)];
    if (i === 0) return { text: `Head ${compassWord(bearing(a0, a1))} on ${name}`, dist: g.dist, time: g.time };
    const pg = merged[i - 1];
    const p0 = coords[Math.max(pg.end - 1, 0)], p1 = coords[pg.end];
    let d = bearing(a0, a1) - bearing(p0, p1);
    d = ((d + 540) % 360) - 180;
    const side = d > 0 ? 'right' : 'left';
    const ad = Math.abs(d);
    const verb = ad < 20 ? 'Continue onto' : ad < 60 ? `Keep ${side} onto` : ad < 140 ? `Turn ${side} onto` : `Make a sharp ${side} onto`;
    return { text: `${verb} ${name}`, dist: g.dist, time: g.time };
  });
  steps.push({ text: 'Arrive at your destination', dist: 0, time: 0 });
  return { coords, dist, time, steps, flood: { spots, counts } };
}

function riskCount(c) { return c.ford * 3 + c.underpass * 2 + c.flood100 * 2 + c.bayou; }

function blockedSet(points) {
  if (!points || !points.length) return null;
  const s = new Set();
  for (const [lon, lat] of points) {
    for (const f of nearestNodes(lon, lat, 'foot', 12, 60)) s.add(f.n);
    for (const f of nearestNodes(lon, lat, 'car', 12, 60)) s.add(f.n);
  }
  return s;
}

function route({ from, to, mode, avoidFlood, blocked }) {
  const crawl = mode === 'car' ? 20 / 3.6 : mode === 'bike' ? BIKE_KMH / 3.6 : WALK_KMH / 3.6;
  const sN = nearestNodes(from[0], from[1], mode);
  const tN = nearestNodes(to[0], to[1], mode);
  const nameOf = { car: 'driving', foot: 'walking', bike: 'biking' }[mode];
  if (!sN.length) return { ok: false, reason: `Your starting point is not near any road open for ${nameOf} in the downloaded area.` };
  if (!tN.length) return { ok: false, reason: `The destination is not near any road open for ${nameOf} in the downloaded area.` };
  // If the closest road of ANY kind is much closer than the closest road open to
  // this mode, the point sits on a road you cannot use (e.g. a freeway on foot).
  const anyS = nearestNodes(from[0], from[1], 'any', 1)[0], anyT = nearestNodes(to[0], to[1], 'any', 1)[0];
  const slack = (d) => 150 + d * 0.5;
  if (anyS && sN[0].d > slack(anyS.d)) return { ok: false, reason: `Your starting point is on a road that is closed to ${nameOf} (for example a freeway). The nearest road open for ${nameOf} is ${Math.round(sN[0].d * 3.28)} ft away.` };
  if (anyT && tN[0].d > slack(anyT.d)) return { ok: false, reason: `The destination is on a road that is closed to ${nameOf} (for example a freeway). The nearest road open for ${nameOf} is ${Math.round(tN[0].d * 3.28)} ft away.` };
  // only consider road points about as close as the nearest one (never jump to a far street)
  const near = (list) => list.filter((x) => x.d <= list[0].d + 120);
  const starts = near(sN).map((s) => ({ n: s.n, cost: s.d / crawl }));
  const targets = near(tN).map((t) => ({ n: t.n, cost: t.d / crawl }));
  const bl = blockedSet(blocked);
  const fast = astar(starts, targets, to, mode, false, bl);
  if (!fast) return { ok: false, reason: `No ${nameOf} route found between these points in the downloaded map. (Roads may not connect for ${nameOf}, for example freeways for walking.)` };
  let chosen = describe(fast, mode);
  let alt = null;
  if (avoidFlood && riskCount(chosen.flood.counts) > 0) {
    const safe = astar(starts, targets, to, mode, true, bl);
    if (safe) {
      const s = describe(safe, mode);
      const better = riskCount(s.flood.counts) < riskCount(chosen.flood.counts);
      if (better && s.time <= chosen.time * 1.6 + 120) {
        alt = { picked: 'safer', fastestTime: chosen.time, fastestRisk: chosen.flood.counts };
        chosen = s;
      } else {
        alt = { picked: 'fastest', saferTime: better ? s.time : null };
      }
    }
  }
  const sNode = sN.find((s) => s.n === fast.startNode) || sN[0];
  const tNode = tN.find((t) => t.n === fast.endNode) || tN[0];
  return {
    ok: true, mode, ...chosen, alt,
    gapStart: sNode.d, gapEnd: tNode.d,
    from, to,
  };
}

async function load(areaId) {
  if (loadedArea === areaId && G) return { ok: true, nodes: G.nN, edges: G.nE };
  const cache = await caches.open('hsm-area-' + areaId);
  const res = await cache.match(new URL(`../data/${areaId}/graph.bin`, self.location.href).href);
  if (!res) return { ok: false, reason: 'Road data not downloaded for this area.' };
  G = parseGraph(await res.arrayBuffer());
  loadedArea = areaId;
  return { ok: true, nodes: G.nN, edges: G.nE };
}

self.onmessage = async (ev) => {
  const { id, type } = ev.data;
  try {
    let result;
    if (type === 'load') result = await load(ev.data.areaId);
    else if (type === 'route') {
      if (!G) throw new Error('Road data is not loaded yet.');
      const t0 = performance.now();
      result = route(ev.data);
      result.ms = Math.round(performance.now() - t0);
    }
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, result: { ok: false, reason: String(err.message || err) } });
  }
};
