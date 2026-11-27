// Measures every reference page with every non-file request aborted. Writes
// shots/audit.json. Usage: node src/audit.js [page ...]   (FAST=1 skips the ring pixels)
// Per page and width (390 and 320 touch, 1280 mouse, 1024 where the page lists it;
// forced dark on the phone-app pages and sistema.html):
//  - sideways scroll; outside requests; fonts loaded
//  - text contrast against the composited background
//  - stand-alone controls under 44 px (web), 48 (phone frames), 56 (driver actions),
//    64 (the driver's fixed action)
//  - fields without a visible label
//  - focus rings by PIXELS: each focus stop is shot blurred and focused; on each of
//    the four sides the changed pixels must contrast 3:1 with what was there before.
//    A side that does not change, or falls outside the viewport, fails.
//  - words broken inside the word at normal text size (letters on two lines)
//  - type off the scale: (face, size, line height) not in the type table
//  - 200 % text: every size and px line height doubled (tab labels capped at 1.6x and
//    shrunk to fit, as specified): sideways scroll, text-box overlaps, a bottom bar
//    covering the end of the page, and (cards) a long price injected
//  - header height at most the token maximum (120 phone, 124 desktop); consola T7b: frozen
//    share, and the total visible both before and after the table is slid to its end
//  - (new, 27 Nov) a time, an amount or a number with its unit split over two lines
//    (SISTEMA §3 rule 8), at normal size and at 200 %
//  - (new) words broken inside the word at 200 % text too, except where §3 rule 6
//    allows it (display, title, product names, card prices, the code, long codes)
//  - (new) on Tab, the focused control must not be fully hidden: at least one of
//    five inner points must hit-test to the control (WCAG 2.4.11), at 390, 320, 1280
//  - (new) the 200 % runs include 320
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const path = require('path'); const fs = require('fs');
const root = path.resolve(__dirname, '..');
const pages = JSON.parse(fs.readFileSync(path.join(__dirname, 'pages.json'), 'utf8'));
const TOK = JSON.parse(fs.readFileSync(path.join(root, 'tokens.json'), 'utf8'));
const ONLY = process.argv.slice(2); const FAST = !!process.env.FAST;
const ALLOWED = [];
for (const [k, v] of Object.entries(TOK.type)) for (const m of [v.phone, v.desktop]) ALLOWED.push(`${v.face === 'title' ? 'Epilogue' : 'Fira Sans'} ${m.size}/${m.line}`);

// Injected into every page before it loads: shared by the normal and the 200 % checks.
const HELPERS = () => {
  // §3 rule 6: only these may break a word that is longer than its line
  const MAY_BREAK = '.t-display,.t-title,.card .name,.card .t-price,.t-code,.key,.mono-code,.loc,.line b,.line a,.x2,.mail,.wa';
  const UNITS = '(?:g|kg|mg|ml|L|cm|mm|m|km|W|V|px|pt|dp|ms|oz|GB|MB|%|°C)';
  const COUNTED = '(?:d[ií]as?|horas?|minutos?|segundos?|semanas?|meses|mes|años?|unidades?|productos?|pedidos?|paquetes?|paradas?|rese[ñn]as?|estrellas?|bultos?|metros?|tiendas?|vendedor(?:es)?|compradores?|piezas?|tazas?|d[ií]gitos?|n[uú]meros?|entregas?|entregadas?|p[aá]ginas?|filtros?|mensajes?|fotos?|veces|personas?|intentos?|l[ií]neas?|cajas?|puntos?|caracteres)';
  const RE = new RegExp('\\d+(?::\\d\\d)?[\\s\\u00a0\\u202f]+[ap]\\.[\\s\\u00a0]*m\\.|₡\\d[\\d\\u202f]*(?:,\\d\\d)?|\\d+(?:,\\d+)?[\\s\\u00a0]' + UNITS + '(?![A-Za-zÀ-ÿ])|\\d+[\\s\\u00a0]' + COUNTED + '(?![A-Za-zÀ-ÿ])', 'gu');
  window.splitCheck = (big) => {
    const out = [];
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      const el = n.parentElement; if (!el || el.closest('svg,.sr,script,style,[aria-hidden=true]' + (big ? ',' + MAY_BREAK : ''))) continue;
      const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      RE.lastIndex = 0; let m;
      while ((m = RE.exec(n.textContent))) {
        const rg = document.createRange(); rg.setStart(n, m.index); rg.setEnd(n, m.index + m[0].length);
        const tops = new Set([...rg.getClientRects()].filter(q => q.width > 0.5).map(q => Math.round(q.top)));
        if (tops.size > 1) out.push(m[0].replace(/[\u00a0\u202f]/g, ' ') + ' (' + (el.className || el.tagName) + ')');
      }
    }
    return [...new Set(out)];
  };
  window.midwordCheck = (all) => {
    const out = [];
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      const el = n.parentElement; if (!el || el.closest('svg,.sr,script,style,' + (all ? '.x2' : MAY_BREAK))) continue;
      const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      { const rr = el.getBoundingClientRect(); if (rr.width < 2 || rr.height < 2) continue; }
      const re = /\p{L}{3,}/gu; let m;
      while ((m = re.exec(n.textContent))) {
        const rg = document.createRange(); rg.setStart(n, m.index); rg.setEnd(n, m.index + m[0].length);
        const qs = [...rg.getClientRects()].filter(q => q.width > 0.5);
        const tops = new Set(qs.map(q => Math.round(q.top)));
        if (tops.size < 2) continue;
        // a word longer than its whole line may break (break-word does that): only an avoidable break counts
        let blk = el; while (blk && getComputedStyle(blk).display === 'inline') blk = blk.parentElement;
        const cs2 = getComputedStyle(blk); const line = blk.clientWidth - parseFloat(cs2.paddingLeft) - parseFloat(cs2.paddingRight);
        const word = qs.reduce((a, q) => a + q.width, 0);
        if (word >= line - 2) continue;
        out.push(`${m[0]} (${el.className || el.tagName})`);
      }
    }
    return [...new Set(out)];
  };
};

const inPage = (allowed) => {
  const hex = c => { const m = c.match(/[\d.]+/g); return m ? m.map(Number) : [0, 0, 0, 0]; };
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const bgOf = el => {
    const stack = [];
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e); const c = hex(cs.backgroundColor); const a = (c.length > 3 ? c[3] : 1) * parseFloat(cs.opacity || 1);
      if (cs.backgroundImage && cs.backgroundImage !== 'none' && !cs.backgroundImage.startsWith('url')) stack.push({ img: true });
      if (a > 0) { stack.push([c[0], c[1], c[2], a]); if (a >= 1) break; }
    }
    let out = [255, 255, 255];
    for (let i = stack.length - 1; i >= 0; i--) { const s = stack[i]; if (s.img) continue; out = out.map((v, k) => v * (1 - s[3]) + s[k] * s[3]); }
    return out;
  };
  const vis = el => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0 && !el.closest('.sr,[aria-hidden=true]'); };
  const lowText = [], typeOff = {};
  const EXEMPT_TYPE = '.wordmark,.mono,.mark-err,.status,.frame-cap,.x2,.mail,.wa,.spec,.space,.input,.select,.textarea,.qty output,.count-badge,.badge,.tag,.linea .st,.side .n';
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el) || el.closest('svg')) continue;
    if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const cs = getComputedStyle(el); const fg = hex(cs.color); const bg = bgOf(el);
    const disabled = el.closest('[disabled],[aria-disabled=true],.is-disabled');
    const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight) >= 700;
    const need = (size >= 24 || (bold && size >= 18.66)) ? 3 : 4.5;
    const r = cr(fg, bg);
    if (r < need && !disabled) lowText.push(`${el.textContent.trim().slice(0, 30)} ${r.toFixed(2)}`);
    if (!el.closest(EXEMPT_TYPE)) {
      const fam = cs.fontFamily.includes('Epilogue') ? 'Epilogue' : cs.fontFamily.includes('Fira') ? 'Fira Sans' : cs.fontFamily.split(',')[0];
      const lh = cs.lineHeight === 'normal' ? 'normal' : Math.round(parseFloat(cs.lineHeight) * 10) / 10;
      const key = `${fam} ${Math.round(size * 10) / 10}/${lh}`;
      if (!allowed.includes(key)) { typeOff[key] = typeOff[key] || []; if (typeOff[key].length < 2) typeOff[key].push(el.textContent.trim().slice(0, 24)); }
    }
  }
  // targets
  const small = [];
  for (const el of document.querySelectorAll('a,button,input,select,textarea,summary,label.check')) {
    if (!vis(el)) continue;
    if (el.closest('.check') && el.tagName !== 'LABEL') continue;
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    const p = el.parentElement;
    const inline = el.tagName === 'A' && cs.display === 'inline' && p && p.textContent.trim().length > el.textContent.trim().length + 3;
    if (inline) continue;
    if (el.matches('.card .name') || el.closest('.choice .check')) continue;
    const phone = el.closest('.phone'), driver = el.closest('.acts4'), fixed = el.matches('.btn-xl');
    const field = document.querySelector('.bar.ruta, .app-top.ruta');
    let need = phone ? 48 : 44;
    if (driver && (phone || field)) need = 56;
    if (fixed && (phone || field)) need = 64;
    if (r.height < need - 0.5 || (r.width < need - 0.5 && !['INPUT', 'TEXTAREA'].includes(el.tagName))) small.push(`${(el.textContent || el.placeholder || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)} (needs ${need})`);
  }
  const unlabelled = [];
  for (const el of document.querySelectorAll('input:not([type=checkbox]):not([type=radio]),select,textarea')) {
    if (!vis(el)) continue;
    const l = el.labels && [...el.labels].find(vis);
    if (!l) unlabelled.push(el.id || el.placeholder);
  }
  // words broken inside the word (normal size: nothing may break inside a word except the .x2 frame)
  const midword = window.midwordCheck(true);
  const tw = document.createTreeWalker(document.createElement('div'), NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const el = n.parentElement; if (!el || !vis(el) || el.closest('svg,.sr,script,style,.x2')) continue;
    { const rr = el.getBoundingClientRect(); if (rr.width < 2 || rr.height < 2) continue; }
    const re = /\p{L}{3,}/gu; let m;
    while ((m = re.exec(n.textContent))) {
      const rg = document.createRange(); rg.setStart(n, m.index); rg.setEnd(n, m.index + m[0].length);
      const tops = new Set([...rg.getClientRects()].filter(q => q.width > 0.5).map(q => Math.round(q.top)));
      if (tops.size > 1) midword.push(`${m[0]} (${el.className || el.tagName})`);
    }
  }
  // times, amounts and quantities on one line (§3 rule 8)
  const splits = splitCheck();
  // header height against the token
  let header = null; const h = document.querySelector('header.hdr:not(.closed)');
  if (h) header = { measured: Math.round(h.getBoundingClientRect().height), token: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--yt-header-h')) };
  // consola T7b: frozen share and the total column fully visible
  let t7b = null; const ft = document.querySelector('table.t.freeze');
  if (ft && innerWidth < 900) {
    const wrap = ft.closest('.tbl-wrap').getBoundingClientRect(); const row = ft.tBodies[0].rows[0];
    const c1 = row.cells[0].getBoundingClientRect(), c2 = row.cells[1].getBoundingClientRect();
    const totEl = () => { const t = ft.tBodies[0].querySelector('.m-only .tot'); return t && t.offsetParent ? t : ft.tBodies[0].querySelector('td.money'); };
    const seen = () => { const tot = totEl().getBoundingClientRect(); const w2 = ft.closest('.tbl-wrap').getBoundingClientRect(); const x = tot.left + tot.width / 2, y = tot.top + tot.height / 2; const hit = document.elementFromPoint(x, y); return tot.right <= w2.right + 0.5 && tot.left >= w2.left - 0.5 && !!hit && totEl().contains(hit); };
    totEl().scrollIntoView({ block: 'center' }); const before = seen(); const tw2 = ft.closest('.tbl-wrap'); tw2.scrollLeft = tw2.scrollWidth; const after = seen(); tw2.scrollLeft = 0;
    t7b = { frozenShare: Math.round((c2.right - c1.left) / wrap.width * 100) / 100, totalVisible: before && after, before, after };
  }
  // a table wider than its frame (it would run under the side panel)
  for (const t of document.querySelectorAll('table.t')) { const w = t.closest('.tbl-wrap'); if (!w || getComputedStyle(w).overflowX !== 'visible') continue; if (t.getBoundingClientRect().right > w.getBoundingClientRect().right + 1) lowText.push('TABLE WIDER THAN ITS FRAME ' + Math.round(t.getBoundingClientRect().width) + ' > ' + Math.round(w.getBoundingClientRect().width)); }
  return { sw: document.documentElement.scrollWidth, lowText, small, unlabelled, midword: [...new Set(midword)], typeOff, header, t7b, splits };
};

// focus rings by pixels
const ringPixels = async (page, ctx) => {
  const dec = await ctx.newPage();
  await dec.setContent('<canvas id=c></canvas>');
  const decode = async (buf) => dec.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.getElementById('c'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    return { w: img.width, h: img.height, d: Array.from(x.getImageData(0, 0, img.width, img.height).data) };
  }, buf.toString('base64'));
  const n = await page.evaluate(() => { const L = [...document.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex]')].filter(e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width && cs.visibility !== 'hidden' && cs.display !== 'none' && !e.closest('.sr,[inert]') && !e.matches('.is-focus') && e.tabIndex >= 0 && !e.disabled && e.getAttribute('aria-disabled') !== 'true'; }); L.forEach((e, i) => e.setAttribute('data-fi', i)); return L.length; });
  await page.keyboard.press('Tab');
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const vw = page.viewportSize();
  const bad = []; let ok = 0;
  for (let i = 0; i < n; i++) {
    const info = await page.evaluate((i) => {
      const el = document.querySelector(`[data-fi="${i}"]`); el.scrollIntoView({ block: 'center', inline: 'nearest' });
      if (document.activeElement) document.activeElement.blur();
      let r = el.getBoundingClientRect(); const rs = el.getClientRects(); if (getComputedStyle(el).display === 'inline' && rs.length > 1) r = rs[0]; // a link that wraps: measure its first line
      return { name: (el.textContent || el.placeholder || el.id || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 32), r: { x: r.left, y: r.top, w: r.width, h: r.height } };
    }, i);
    const P = 8, r = info.r;
    const cx = Math.max(0, Math.floor(r.x - P)), cy = Math.max(0, Math.floor(r.y - P));
    const cw = Math.min(vw.width, Math.ceil(r.x + r.w + P)) - cx, ch = Math.min(vw.height, Math.ceil(r.y + r.h + P)) - cy;
    if (cw < 4 || ch < 4) { bad.push(`${info.name}: off-screen`); continue; }
    const clip = { x: cx, y: cy, width: cw, height: ch };
    const A = await decode(await page.screenshot({ clip }));
    const fv = await page.evaluate((i) => { const el = document.querySelector(`[data-fi="${i}"]`); el.focus({ preventScroll: true }); return el.matches(':focus-visible'); }, i);
    const B = await decode(await page.screenshot({ clip }));
    if (!fv) { bad.push(`${info.name}: no focus-visible`); continue; }
    const px = (I, x, y) => { const k = (y * I.w + x) * 4; return [I.d[k], I.d[k + 1], I.d[k + 2]]; };
    const lx = r.x - cx, ty = r.y - cy, rx = lx + r.w, by = ty + r.h;
    const side = (name) => {
      const out = [];
      const along = name === 'top' || name === 'bottom';
      const len = along ? r.w : r.h; const a0 = Math.floor(len * 0.25), a1 = Math.ceil(len * 0.75);
      const edge = { top: ty, bottom: by, left: lx, right: rx }[name];
      const offEdge = name === 'top' ? r.y - 7 < 0 : name === 'bottom' ? r.y + r.h + 7 > vw.height : name === 'left' ? r.x - 7 < 0 : r.x + r.w + 7 > vw.width;
      for (let t = a0; t <= a1; t += 1) for (let d = -7; d <= 7; d++) {
        const x = Math.round(along ? lx + t : edge + d), y = Math.round(along ? edge + d : ty + t);
        if (x < 0 || y < 0 || x >= A.w || y >= A.h) continue;
        const a = px(A, x, y), b = px(B, x, y);
        if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > 40) out.push(cr(a, b));
      }
      if (out.length < (a1 - a0) * 1.5) return offEdge ? -1 : 1;  // under ~1.5 px of change along the side: not visible
      out.sort((p, q) => p - q); return out[Math.floor(out.length / 2)];
    };
    const s = ['top', 'right', 'bottom', 'left'].map(side);
    if (s.every(v => v >= 3)) ok++;
    else bad.push(`${info.name}: ${s.map((v, k) => ['T', 'R', 'B', 'L'][k] + (v < 0 ? ' off-screen' : v.toFixed(2))).join(' ')}`);
  }
  await dec.close();
  return { stops: n, ok, bad };
};

// keyboard focus not hidden behind a sticky or fixed bar (WCAG 2.4.11): tab naturally and
// let the browser scroll; at least one of five inner points must hit the control itself
const obscured = async (page) => {
  const n = await page.evaluate(() => [...document.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex]')].filter(e => e.tabIndex >= 0 && !e.disabled && e.getBoundingClientRect().width).length);
  const hidden = [];
  await page.evaluate(() => { window.scrollTo(0, 0); document.activeElement && document.activeElement.blur(); });
  for (let i = 0; i < Math.min(n, 140); i++) {
    await page.keyboard.press('Tab'); await page.waitForTimeout(15);
    const h = await page.evaluate(() => {
      const el = document.activeElement; if (!el || el === document.body) return null;
      let r = el.getBoundingClientRect(); if (!r.width || !r.height) return null;
      const rs = el.getClientRects(); if (getComputedStyle(el).display === 'inline' && rs.length > 1) r = rs[0]; // a link that wraps: its first line
      const pts = [[.5, .5], [.2, .25], [.8, .25], [.2, .75], [.8, .75]].map(([a, b]) => [r.left + r.width * a, r.top + r.height * b]);
      const hit = pts.some(([x, y]) => { if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false; const t = document.elementFromPoint(x, y); return t && (t === el || el.contains(t) || t.contains(el) && t.tagName === 'LABEL'); });
      if (hit) return null;
      const top = document.elementFromPoint(r.left + r.width / 2, Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2)));
      return `${(el.textContent || el.placeholder || el.id || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 30)} under ${top ? (top.closest('[class]') || top).className.toString().slice(0, 24) : 'nothing'}`;
    });
    if (h) hidden.push(h);
  }
  return [...new Set(hidden)];
};

const big = async (page) => page.evaluate(() => {
  const els = [...document.querySelectorAll('body, body *')].filter(e => !e.closest('.x2'));
  const sizes = els.map(e => { const cs = getComputedStyle(e); return [parseFloat(cs.fontSize), cs.lineHeight]; });
  els.forEach((e, i) => { e.style.fontSize = (sizes[i][0] * 2) + 'px'; if (sizes[i][1].endsWith('px')) e.style.lineHeight = (parseFloat(sizes[i][1]) * 2) + 'px'; });
  // tab labels: capped at 1.6x, then shrunk to fit their tab, never under 13 (SISTEMA §5.23)
  for (const t of document.querySelectorAll('.tabbar .tl')) { let s = 13 * 1.6; t.style.fontSize = s + 'px'; t.style.lineHeight = '22px'; t.parentElement.style.fontSize = s + 'px'; while (t.scrollWidth > t.parentElement.clientWidth && s > 13) { s -= 0.5; t.style.fontSize = s + 'px'; } }
  return true;
});
const bigCheck = async (page) => page.evaluate(() => {
  const leaves = [...document.querySelectorAll('body *')].filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && getComputedStyle(e).display !== 'none' && !e.closest('.sr,svg,[aria-hidden=true]'));
  const rects = [];
  for (const e of leaves) for (const n of e.childNodes) { if (n.nodeType !== 3 || !n.textContent.trim()) continue; const rg = document.createRange(); rg.selectNodeContents(n); for (const r0 of rg.getClientRects()) { if (r0.width <= 1) continue; let r = { left: r0.left, right: r0.right, top: r0.top, bottom: r0.bottom };
      for (let p = e.parentElement; p; p = p.parentElement) { const cs = getComputedStyle(p); if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') { const c = p.getBoundingClientRect(); r = { left: Math.max(r.left, c.left), right: Math.min(r.right, c.right), top: Math.max(r.top, c.top), bottom: Math.min(r.bottom, c.bottom) }; } }
      if (r.right - r.left > 1 && r.bottom - r.top > 1) rects.push([e, r]); } }
  const over = [];
  const fx = e => !!e.closest('.fixed:not(.static),.sticky-buy,.sug,.side:target,.submit-bar,.sheet-foot');
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const [a, ra] = rects[i], [b, rb] = rects[j];
    if (a === b || fx(a) !== fx(b)) continue;
    const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    if (w > 4 && h > 4) over.push(`${a.textContent.trim().slice(0, 20)} / ${b.textContent.trim().slice(0, 20)} ${Math.round(w)}x${Math.round(h)}`);
  }
  return { sw: document.documentElement.scrollWidth, over: over.slice(0, 8), nOver: over.length, midword: window.midwordCheck(false), splits: window.splitCheck(true) };
});
// at the very bottom, nothing may sit under a fixed or sticky bottom bar
const coverCheck = async (page) => {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await page.waitForTimeout(120);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await page.waitForTimeout(120);
  return page.evaluate(() => {
    const bar = [...document.querySelectorAll('.fixed,.sticky-buy')].find(b => { const cs = getComputedStyle(b); return cs.position === 'fixed' && cs.display !== 'none'; });
    if (!bar) return null;
    const top = bar.getBoundingClientRect().top; const hidden = [];
    for (const e of document.querySelectorAll('main *, footer *')) {
      if (bar.contains(e) || ![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
      const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || e.closest('.sr')) continue;
      const r = e.getBoundingClientRect(); if (r.bottom > top + 1 && r.top < innerHeight) hidden.push(e.textContent.trim().slice(0, 30));
    }
    return { barTop: Math.round(top), hidden: hidden.slice(0, 4) };
  });
};

(async () => {
  const b = await chromium.launch(); const out = [];
  const open = async (ctx, file, dark) => {
    const page = await ctx.newPage(); let blocked = 0;
    await page.addInitScript(HELPERS);
    await page.route('**/*', r => r.request().url().startsWith('file://') ? r.continue() : (blocked++, r.abort()));
    await page.goto('file://' + path.join(root, file)); await page.evaluate(() => document.fonts.ready);
    if (dark) await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.waitForTimeout(dark ? 400 : 60); // colours transition for 100 ms after the theme changes
    return [page, () => blocked];
  };
  const run = async (file, w, opts = {}) => {
    const ctx = await b.newContext({ viewport: { width: w, height: w < 600 ? 844 : 800 }, hasTouch: w < 600, isMobile: w < 600 });
    const [page, blocked] = await open(ctx, file, opts.dark);
    const fonts = await page.evaluate(() => [...new Set([...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/"/g, '') + ' ' + f.weight))]);
    const fontErrors = await page.evaluate(() => [...document.fonts].filter(f => f.status === 'error').length);
    const r = await page.evaluate(inPage, ALLOWED);
    const rec = { file, w, dark: !!opts.dark, sideways: r.sw > w ? r.sw : 0, blocked: blocked(), fonts, fontErrors, lowText: r.lowText, small: r.small, unlabelled: r.unlabelled, midword: r.midword, typeOff: r.typeOff, header: r.header, t7b: r.t7b };
    if (opts.focus && !FAST) rec.ring = await ringPixels(page, ctx);
    if (opts.obscured !== false && !opts.dark) { const [p3] = await open(ctx, file, false); rec.obscured = await obscured(p3); await p3.close(); }
    if (!opts.dark) rec.cover = await coverCheck(page);
    if (opts.big) {
      const [p2] = await open(ctx, file, opts.dark);
      await big(p2); await p2.waitForTimeout(80); rec.big = await bigCheck(p2); rec.bigCover = await coverCheck(p2);
      // a long price and a long name in the first card, at 200 %
      const hasCard = await p2.evaluate(() => { const c = document.querySelector('.card'); if (!c) return false; c.querySelector('.t-price').textContent = '₡1 289 000'; c.querySelector('.name').textContent = 'Juego de ollas de acero inoxidable con tapa de vidrio templado, mangos fríos y fondo encapsulado para todo tipo de cocina, 10 piezas'; return true; });
      if (hasCard) { await p2.waitForTimeout(50); rec.bigLong = await p2.evaluate(() => document.documentElement.scrollWidth); }
      await p2.close();
    }
    out.push(rec); await ctx.close();
  };
  for (const [file, , , app, widths] of pages) {
    const n = file.replace('.html', '');
    if (ONLY.length && !ONLY.includes(n)) continue;
    if (n === 'cubrir-logo') { await run(file, 1280); continue; }
    if (widths.includes(390)) { await run(file, 390, { focus: true, big: true }); await run(file, 320, { big: true }); }
    if (widths.includes(1024)) await run(file, 1024, { focus: true });
    if (widths.includes(1280)) await run(file, 1280, { focus: true, big: true });
    if (n.startsWith('app-') || n === 'sistema') await run(file, n === 'sistema' ? 1280 : 390, { focus: true, dark: true });
  }
  await b.close();
  if (!ONLY.length) fs.writeFileSync(path.join(root, 'shots', 'audit.json'), JSON.stringify(out, null, 1));
  let bad = 0, stops = 0, ringOk = 0;
  for (const r of out) {
    const f = [];
    if (r.sideways) f.push('SIDEWAYS ' + r.sideways);
    if (r.blocked) f.push('blocked ' + r.blocked);
    if (r.fontErrors) f.push('font errors ' + r.fontErrors);
    if (r.lowText.length) f.push('lowText ' + r.lowText.join(' | '));
    if (r.small.length) f.push('small ' + r.small.join(' | '));
    if (r.unlabelled.length) f.push('unlabelled ' + r.unlabelled.join(','));
    if (r.midword.length) f.push('mid-word ' + r.midword.join(' | '));
    if (r.splits && r.splits.length) f.push('split over two lines ' + r.splits.join(' | '));
    if (r.obscured && r.obscured.length) f.push('focus hidden ' + r.obscured.join(' | '));
    if (r.big && r.big.midword.length) f.push('200% mid-word ' + r.big.midword.join(' | '));
    if (r.big && r.big.splits.length) f.push('200% split ' + r.big.splits.join(' | '));
    if (Object.keys(r.typeOff).length) f.push('type off scale ' + Object.entries(r.typeOff).map(([k, v]) => `${k} (${v.join('; ')})`).join(' | '));
    if (r.header && r.header.measured > (r.w < 900 ? 120 : 124)) f.push(`header ${r.header.measured} over its maximum`);
    if (r.t7b && (r.t7b.frozenShare > 0.6 || !r.t7b.totalVisible)) f.push('T7b ' + JSON.stringify(r.t7b));
    if (r.ring) { stops += r.ring.stops; ringOk += r.ring.ok; if (r.ring.bad.length) f.push('ring ' + r.ring.bad.join(' | ')); }
    if (r.cover && r.cover.hidden.length) f.push('covered by bar ' + r.cover.hidden.join(' | '));
    if (r.big && (r.big.sw > r.w || r.big.nOver)) f.push(`200%: sw ${r.big.sw} overlaps ${r.big.nOver} ${r.big.over.join(' | ')}`);
    if (r.bigCover && r.bigCover.hidden.length) f.push('200% covered by bar ' + r.bigCover.hidden.join(' | '));
    if (r.bigLong && r.bigLong > r.w) f.push('200% long price: sw ' + r.bigLong);
    if (f.length) { bad++; console.log(r.file, r.w, r.dark ? 'dark' : '', '\n   ' + f.join('\n   ')); }
  }
  console.log(out.length, 'runs,', bad, 'with findings;', FAST ? 'rings skipped' : `${stops} focus stops, ${ringOk} with a ring of 3:1 or more on all four sides`);
})();
