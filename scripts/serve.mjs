// Tiny local web server for the app (no extra installs needed).
// Usage: node scripts/serve.mjs [port] [appFolder] [dataFolder]
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { join, extname, normalize, resolve } from 'node:path';

const port = +(process.argv[2] || process.env.PORT || 8080);
const root = resolve(process.argv[3] || 'app');
const dataRoot = resolve(process.argv[4] || join(root, 'data'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.geojson': 'application/geo+json', '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.pbf': 'application/x-protobuf', '.webmanifest': 'application/manifest+json',
  '.pmtiles': 'application/octet-stream', '.sqlite': 'application/octet-stream', '.bin': 'application/octet-stream' };

createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.endsWith('/')) path += 'index.html';
  const base = path.startsWith('/data/') ? dataRoot : root;
  const rel = path.startsWith('/data/') ? path.slice(6) : path;
  const file = normalize(join(base, rel));
  if (!file.startsWith(base)) { res.writeHead(403); return res.end(); }
  let st;
  try { st = statSync(file); } catch { res.writeHead(404); return res.end('Not found'); }
  if (!st.isFile()) { res.writeHead(404); return res.end('Not found'); }
  const type = TYPES[extname(file)] || 'application/octet-stream';
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range) { // part of a file (the map preview streams the basemap this way)
    let start = range[1] === '' ? st.size - +range[2] : +range[1];
    let end = range[1] === '' || range[2] === '' ? st.size - 1 : Math.min(+range[2], st.size - 1);
    if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
    res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
    return req.method === 'HEAD' ? res.end() : createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`Houston Survival Map: open http://localhost:${port}/  (Ctrl+C to stop)`));
