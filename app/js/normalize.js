import { ABBREV } from './abbrev.js';

// Turn any address or name into simple lowercase words with shortcuts spelled
// out. Must give the same result as pipeline/textnorm.py.
export function normalize(text) {
  const t = String(text || '').toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ');
  const out = [];
  for (const w of t.split(' ')) {
    if (!w) continue;
    const full = ABBREV[w] || w;
    for (const p of full.split(' ')) out.push(p);
  }
  return out.join(' ');
}
