// Saved places, own pins/notes and settings. Stored ONLY on this device
// (browser localStorage). Nothing is ever sent anywhere.

function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const SAVED_TYPES = { home: 'Home', family: 'Family', shelter: 'Shelter', meeting: 'Meeting point / waypoint', vehicle: 'Vehicle', other: 'Other' };
export const PIN_TYPES = {
  safe: { label: 'Safe route', color: '#1a9e4b' },
  hazard: { label: 'Hazard', color: '#e08a00' },
  blocked: { label: 'Blocked road', color: '#d32f2f' },
  water: { label: 'Water source', color: '#1976d2' },
  note: { label: 'Note', color: '#7b1fa2' },
};

export const saved = {
  all: () => load('hsm.saved', []),
  add(p) { const list = this.all(); const item = { id: uid(), ...p }; list.push(item); save('hsm.saved', list); return item; },
  remove(id) { save('hsm.saved', this.all().filter((p) => p.id !== id)); },
};

export const pins = {
  all: () => load('hsm.pins', []),
  add(p) { const list = this.all(); const item = { id: uid(), created: new Date().toISOString(), ...p }; list.push(item); save('hsm.pins', list); return item; },
  update(id, changes) { save('hsm.pins', this.all().map((p) => (p.id === id ? { ...p, ...changes } : p))); },
  remove(id) { save('hsm.pins', this.all().filter((p) => p.id !== id)); },
  blockedPoints() { return this.all().filter((p) => p.type === 'blocked').map((p) => [p.lon, p.lat]); },
};

export const settings = {
  get: () => ({ battery: false, avoidFlood: true, mode: 'car', area: null, showFlood: true, layers: { hospital: true, shelter: true }, ...load('hsm.settings', {}) }),
  set(changes) { const s = { ...this.get(), ...changes }; save('hsm.settings', s); return s; },
};

// Breadcrumb trails: [lon, lat, time] points recorded while moving.
export const trails = {
  state: () => load('hsm.trails', { current: null, saved: [] }),
  current() { return this.state().current; },
  saved() { return this.state().saved; },
  start() { const s = this.state(); s.current = { id: uid(), started: new Date().toISOString(), points: [] }; save('hsm.trails', s); },
  addPoint(p) { const s = this.state(); if (!s.current) return; s.current.points.push(p); save('hsm.trails', s); },
  stop() {
    const s = this.state();
    if (!s.current) return null;
    const t = { ...s.current, ended: new Date().toISOString(), name: 'Trail ' + new Date(s.current.started).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) };
    s.current = null;
    if (t.points.length) s.saved.unshift(t);
    save('hsm.trails', s);
    return t.points.length ? t : null;
  },
  remove(id) { const s = this.state(); s.saved = s.saved.filter((t) => t.id !== id); save('hsm.trails', s); },
};

export const checklist = {
  get: () => load('hsm.checklist', {}),
  toggle(id, on) { const c = this.get(); c[id] = on; save('hsm.checklist', c); },
  reset() { save('hsm.checklist', {}); },
};
