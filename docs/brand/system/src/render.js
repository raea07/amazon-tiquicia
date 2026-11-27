// Rasterises the SVG artwork with Chromium (network blocked). The SVG is
// passed as a data: URL: a page made with setContent is about:blank and may
// not load file:// images (that was the bug that left every PNG a
// broken-image placeholder). After rendering, run python3 -I src/checkpng.py:
// it fails on any blank, duplicate or broken-image PNG.
// Writes:
//   assets/app-icons/icono-<app>-1024.png (App Store; flattened to RGB by checkpng.py),
//   -512.png (Google Play), -180.png (iPhone 60 pt @3x), -48.png (Android mdpi),
//   -adaptativo-frente-432.png + -adaptativo-fondo-432.png (Android adaptive
//   icon, 108 dp at 4x: ring and mark scaled to 68 %, so the furthest pixel sits at
//   57.7 % of the canvas, inside the 66 dp safe circle of 61.1 % with 1.5 dp to spare),
//   -monocromo-432.png (Android 13 themed icon: ring, pattern and mark, one colour on
//   alpha, same 68 %), -inicio-1024.png and -inicio-oscuro-1024.png (expo splash
//   image: the wheel without the tile, for the page colour in light and in dark);
//   icono-central: 512, 180, 48 only (browser icon of the console);
//   assets/logo/<lockup>-raw.png, cropped and padded by src/lockpng.py.
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const path = require('path'); const fs = require('fs');
const root = path.resolve(__dirname, '..');
const dataUrl = svg => 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
(async () => {
  const b = await chromium.launch();
  const shot = async (svg, w, h, dst, bg) => {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await p.route('**/*', r => r.request().url().startsWith('data:') ? r.continue() : r.abort());
    await p.setContent(`<html><body style="margin:0;background:${bg || 'transparent'}"><img id="i" src="${dataUrl(svg)}" style="display:block;width:${w}px;height:${h}px"></body></html>`);
    const ok = await p.evaluate(() => new Promise(res => { const i = document.getElementById('i'); if (i.complete) return res(i.naturalWidth > 0); i.onload = () => res(true); i.onerror = () => res(false); }));
    if (!ok) throw new Error('image did not load: ' + dst);
    await p.screenshot({ path: dst, omitBackground: !bg });
    await p.close();
  };
  const out = path.join(root, 'assets', 'app-icons'); fs.mkdirSync(out, { recursive: true });
  const S = 0.68;
  for (const a of ['yuntera', 'vende', 'ruta', 'bodega', 'central']) {
    const svg = fs.readFileSync(path.join(root, 'assets', `icono-${a}.svg`), 'utf8');
    for (const s of (a === 'central' ? [512, 180, 48] : [1024, 512, 180, 48])) await shot(svg, s, s, path.join(out, `icono-${a}-${s}.png`), '#fff');
    if (a === 'central') continue;
    // adaptive icon: background = <g id="fondo">, foreground = everything else, scaled to 68 %
    const fondo = svg.match(/<g id="fondo">.*?<\/g>/)[0];
    const inner = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(fondo, '');
    const open = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">';
    const scaled = body => `<g transform="translate(512 512) scale(${S}) translate(-512 -512)">${body}</g>`;
    await shot(open + fondo + '</svg>', 432, 432, path.join(out, `icono-${a}-adaptativo-fondo-432.png`));
    await shot(open + scaled(inner) + '</svg>', 432, 432, path.join(out, `icono-${a}-adaptativo-frente-432.png`));
    // themed (monochrome) icon: the hub is dropped so the mark stays visible in one colour
    const mono = inner.replace(/<circle cx="512" cy="512" r="215" fill="[^"]+"\/>/, '').replace(/(fill|stroke)="#[0-9A-Fa-f]{6}"/g, '$1="#000000"');
    await shot(open + scaled(mono) + '</svg>', 432, 432, path.join(out, `icono-${a}-monocromo-432.png`));
    // splash image: the wheel without the tile, on the page colour (light, and dark with noche turned texto-claro)
    await shot(open + inner + '</svg>', 1024, 1024, path.join(out, `icono-${a}-inicio-1024.png`));
    if (inner.includes('#1E1A16')) await shot(open + inner.replace(/#1E1A16/g, '#F3EEE6') + '</svg>', 1024, 1024, path.join(out, `icono-${a}-inicio-oscuro-1024.png`));
  }
  const L = path.join(root, 'assets', 'logo');
  for (const f of fs.readdirSync(L).filter(f => f.endsWith('.svg'))) {
    const s = fs.readFileSync(path.join(L, f), 'utf8'); const m = s.match(/viewBox="0 0 ([\d.]+) 48"/); const ratio = parseFloat(m[1]) / 48;
    // rendered large, then cropped to the ink and padded evenly by src/lockpng.py
    await shot(s, Math.round(240 * ratio), 240, path.join(L, f.replace('.svg', '-raw.png')));
  }
  await b.close(); console.log('rendered');
})();
