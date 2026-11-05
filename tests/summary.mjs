// Turns test-results-*.json and areas.json into a Markdown summary.
import { readFileSync, existsSync } from 'node:fs';
const dir = process.argv[2] || 'app/data';
const out = [];
if (existsSync(`${dir}/areas.json`)) {
  const { areas } = JSON.parse(readFileSync(`${dir}/areas.json`, 'utf8'));
  out.push('## Download sizes', '', '| Area | Total | Files |', '|---|---|---|');
  for (const a of areas) out.push(`| ${a.name} | **${(a.bytes / 1e6).toFixed(1)} MB** | ${Object.entries(a.files).map(([f, b]) => `${f} ${(b / 1e6).toFixed(1)} MB`).join(', ')} |`);
  out.push('');
  for (const a of areas) {
    const mp = `${dir}/${a.id}/meta.json`;
    const m = existsSync(mp) ? JSON.parse(readFileSync(mp, 'utf8')) : a;
    if (m.counts) out.push(`**${a.id}** counts: \`${JSON.stringify(m.counts)}\``, '');
  }
}
for (const id of process.argv.slice(3)) {
  const f = `${dir}/test-results-${id}.json`;
  if (!existsSync(f)) { out.push(`## Airplane-mode tests: ${id}`, '', '_No results (test did not run)._', ''); continue; }
  const r = JSON.parse(readFileSync(f, 'utf8'));
  out.push(`## Airplane-mode tests: ${id}`, '', '| # | Check | Result | Details |', '|---|---|---|---|');
  for (const x of r.results) out.push(`| ${x.n} | ${x.name} | ${x.ok ? '✅ PASS' : '❌ FAIL'} | ${String(x.detail).replace(/\|/g, '/').slice(0, 600)} |`);
  out.push('');
}
console.log(out.join('\n'));
