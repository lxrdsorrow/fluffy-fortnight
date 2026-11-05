// Renders the SVG app icon to PNG sizes (uses the pre-installed Playwright).
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const svg = fs.readFileSync('app/assets/icon.svg', 'utf8');
  const b = await chromium.launch();
  for (const s of [192, 512]) {
    const p = await b.newPage({ viewport: { width: s, height: s } });
    await p.setContent(`<style>body{margin:0}</style>${svg.replace('<svg ', `<svg width="${s}" height="${s}" `)}`);
    await p.screenshot({ path: `app/assets/icon-${s}.png`, omitBackground: true });
  }
  await b.close();
})();
