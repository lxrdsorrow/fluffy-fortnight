// Talks to the routing worker and formats the results for people.
const worker = new Worker(new URL('./route-worker.js', import.meta.url));
let seq = 0;
const waiting = new Map();
worker.onmessage = (ev) => {
  const cb = waiting.get(ev.data.id);
  if (cb) { waiting.delete(ev.data.id); cb(ev.data.result); }
};
function ask(msg) {
  return new Promise((resolve) => {
    const id = ++seq;
    waiting.set(id, resolve);
    worker.postMessage({ ...msg, id });
  });
}

export const loadRoads = (areaId) => ask({ type: 'load', areaId });

/** from/to are [lon, lat]. mode: 'car' | 'foot' | 'bike'. blocked: [[lon,lat],...] */
export const getRoute = (from, to, mode, avoidFlood, blocked) =>
  ask({ type: 'route', from, to, mode, avoidFlood, blocked });

export function miles(m) {
  const mi = m / 1609.344;
  if (mi < 0.1) return `${Math.round(m * 3.28084 / 10) * 10} ft`;
  return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
}

export function aboutTime(sec) {
  const min = Math.max(1, Math.round(sec / 60));
  if (min < 60) return `about ${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return `about ${h} hr${m ? ` ${m} min` : ''}`;
}

export function clockAt(sec) {
  return new Date(Date.now() + sec * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
export function bearingDeg(a, b) {
  const toR = Math.PI / 180;
  const y = Math.sin((b[0] - a[0]) * toR) * Math.cos(b[1] * toR);
  const x = Math.cos(a[1] * toR) * Math.sin(b[1] * toR) - Math.sin(a[1] * toR) * Math.cos(b[1] * toR) * Math.cos((b[0] - a[0]) * toR);
  return (Math.atan2(y, x) / toR + 360) % 360;
}
export const compassWord = (deg) => COMPASS[Math.round(deg / 45) % 8];

export function metersBetween(a, b) {
  const R = 6371008.8, toR = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toR, dLon = (b[0] - a[0]) * toR;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toR) * Math.cos(b[1] * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export const FLOOD_WORDS = {
  ford: 'road crosses water at ground level (low-water crossing)',
  underpass: 'underpass — water collects here first',
  flood100: 'in a FEMA high-risk floodplain (1% yearly chance)',
  bayou: 'crosses a bayou or creek',
  flood500: 'in a FEMA moderate-risk floodplain (0.2% yearly chance)',
};
