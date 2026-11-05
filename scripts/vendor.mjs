// Copies the map/search libraries from node_modules into app/vendor so the
// app can run with no internet (nothing is loaded from a CDN).
import { copyFileSync, mkdirSync } from 'node:fs';
const files = {
  'node_modules/maplibre-gl/dist/maplibre-gl.js': 'maplibre-gl.js',
  'node_modules/maplibre-gl/dist/maplibre-gl.css': 'maplibre-gl.css',
  'node_modules/pmtiles/dist/pmtiles.js': 'pmtiles.js',
  'node_modules/@protomaps/basemaps/dist/basemaps.js': 'basemaps.js',
  'node_modules/sql.js/dist/sql-wasm.js': 'sql-wasm.js',
  'node_modules/sql.js/dist/sql-wasm.wasm': 'sql-wasm.wasm',
};
mkdirSync('app/vendor', { recursive: true });
for (const [from, to] of Object.entries(files)) copyFileSync(from, 'app/vendor/' + to);
console.log('copied', Object.keys(files).length, 'library files to app/vendor');
