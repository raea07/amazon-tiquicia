// Full-page screenshots of every reference page at its widths, deviceScaleFactor 2,
// with every request outside this folder aborted. Usage: node src/shots.js [page ...]
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const path = require('path'); const fs = require('fs');
const root = path.resolve(__dirname, '..');
const pages = JSON.parse(fs.readFileSync(path.join(__dirname, 'pages.json'), 'utf8'));
const only = process.argv.slice(2);
(async () => {
  const b = await chromium.launch(); const report = [];
  fs.mkdirSync(path.join(root, 'shots'), { recursive: true });
  for (const [file, title, tpl, app, widths] of pages) {
    const name = file.replace('.html', '');
    if (only.length && !only.includes(name)) continue;
    for (const w of widths) {
      const ctx = await b.newContext({ viewport: { width: w, height: w < 600 ? 844 : 800 }, deviceScaleFactor: 2, hasTouch: w < 600, isMobile: w < 600 });
      const p = await ctx.newPage(); const outside = [];
      await p.route('**/*', r => { const u = r.request().url(); if (u.startsWith('file://')) return r.continue(); outside.push(u); return r.abort(); });
      await p.goto('file://' + path.join(root, file)); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(80);
      const sw = await p.evaluate(() => document.documentElement.scrollWidth);
      // a full-page shot would freeze sticky bars where the first screen ended: let them sit in place
      await p.addStyleTag({ content: '.submit-bar,.fixed{position:static!important}' });
      await p.screenshot({ path: path.join(root, 'shots', `${name}-${w}.png`), fullPage: true });
      if (['home', 'producto', 'franja2-home', 'franja2-producto'].includes(name)) await p.screenshot({ path: path.join(root, 'shots', `${name}-primera-${w}.png`) });
      if (name === 'producto' && w === 390) { await p.evaluate(() => window.scrollTo(0, 1500)); await p.waitForTimeout(150); await p.screenshot({ path: path.join(root, 'shots', 'producto-desplazado-390.png') }); }
      if (['consola', 'vende-inicio'].includes(name) && w === 390) { await p.goto('file://' + path.join(root, file) + '#secciones'); await p.waitForTimeout(150); await p.screenshot({ path: path.join(root, 'shots', `${name}-menu-390.png`) }); }
      report.push({ file, w, scrollWidth: sw, sideways: sw > w, blocked: outside.length });
      await ctx.close();
    }
  }
  await b.close();
  if (!only.length) fs.writeFileSync(path.join(root, 'shots', 'shots.json'), JSON.stringify(report, null, 1));
  console.log(report.filter(r => r.sideways || r.blocked).map(r => JSON.stringify(r)).join('\n') || 'no sideways scroll, no outside request', report.length, 'shots');
})();
