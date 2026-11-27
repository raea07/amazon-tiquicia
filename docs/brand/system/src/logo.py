"""Wordmark and the five lockups as SVG with the text in outlines.

How the outlines are made (no font is needed to open the files):
1. The text is set from the F2 Epilogue files in fonts/f2/ (wordmark
   ExtraBold 800 from epilogue-800-latin.woff2, descriptor SemiBold 600 from
   epilogue-600-latin.woff2) with fontTools: each character goes through the
   font's cmap to its glyph, the glyph outline is drawn with
   fontTools.pens.svgPathPen.SVGPathPen, flipped (font y up, SVG y down),
   scaled to the font size and placed at the running x.
2. The running x adds each glyph's advance width (hmtx), the pair kerning
   from the font's GPOS 'kern' feature (PairPos format 1 and 2, read here),
   and the tracking (-0.03 em, brand book §5).
3. The mark is the repository's own path (packages/brand/assets/mark.svg:
   "M12 12C12 23 24 20 24 31M36 12C36 23 24 20 24 31M24 31V42", stroke 6,
   round caps and joins, nodes r 6 at 12,11 and 36,11), unchanged.
4. Geometry follows brand book §5 with h = mark height = 48 units: gap 0.30 h,
   wordmark size 0.86 h, descriptor the same size after a 0.22 h gap at 62 %
   opacity, text centred on the mark's em box (dominant-baseline central).
   One change, because the chosen title files are 600–800 only: the
   descriptor is Epilogue 600, not 500 (brand book v2 must say so).

Run: python3 -I src/logo.py   writes assets/logo/*.svg
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from tokens import P

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS = os.path.join(ROOT, 'fonts')
OUT = os.path.join(ROOT, 'assets', 'logo')
MARK = ('<path d="M12 12C12 23 24 20 24 31M36 12C36 23 24 20 24 31M24 31V42" fill="none" stroke="{c}" stroke-width="6" '
        'stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="11" r="6" fill="{c}"/><circle cx="36" cy="11" r="6" fill="{c}"/>')


class Face:
    def __init__(self, path):
        self.f = TTFont(path)
        self.cmap = self.f.getBestCmap()
        self.gs = self.f.getGlyphSet()
        self.upm = self.f['head'].unitsPerEm
        hh = self.f['hhea']
        self.asc, self.desc = hh.ascent, hh.descent
        self.kern = self._kern()

    def _kern(self):
        k = {}
        if 'GPOS' not in self.f:
            return k
        g = self.f['GPOS'].table
        idx = set()
        for fr in g.FeatureList.FeatureRecord:
            if fr.FeatureTag == 'kern':
                idx |= set(fr.Feature.LookupListIndex)
        order = self.f.getGlyphOrder()
        for i in sorted(idx):
            lk = g.LookupList.Lookup[i]
            for st in lk.SubTable:
                if lk.LookupType == 9:
                    st = st.ExtSubTable
                if getattr(st, 'LookupType', 2) != 2 and lk.LookupType not in (2, 9):
                    continue
                if not hasattr(st, 'Format'):
                    continue
                cov = st.Coverage.glyphs
                if st.Format == 1:
                    for a, ps in zip(cov, st.PairSet):
                        for pv in ps.PairValueRecord:
                            v = pv.Value1.XAdvance if pv.Value1 and hasattr(pv.Value1, 'XAdvance') else 0
                            if v and (a, pv.SecondGlyph) not in k:
                                k[(a, pv.SecondGlyph)] = v
                elif st.Format == 2:
                    c1 = st.ClassDef1.classDefs; c2 = st.ClassDef2.classDefs
                    self._cls = (st, cov, c1, c2)
                    for a in cov:
                        ca = c1.get(a, 0)
                        rec = st.Class1Record[ca]
                        for b in order:
                            cb = c2.get(b, 0)
                            v1 = rec.Class2Record[cb].Value1
                            v = getattr(v1, 'XAdvance', 0) if v1 else 0
                            if v and (a, b) not in k:
                                k[(a, b)] = v
        return k

    def run(self, text, size, tracking_em, x0, baseline):
        s = size / self.upm
        x = x0; parts = []
        names = [self.cmap[ord(c)] for c in text]
        for i, n in enumerate(names):
            pen = SVGPathPen(self.gs)
            tp = TransformPen(pen, (s, 0, 0, -s, x, baseline))
            self.gs[n].draw(tp)
            d = pen.getCommands()
            if d:
                parts.append(d)
            adv = self.gs[n].width
            if i + 1 < len(names):
                adv += self.kern.get((n, names[i + 1]), 0)
                x += adv * s + tracking_em * size
            else:
                x += adv * s
        return ' '.join(parts), x


def lockup(desc, mark_c, word_c, h=48):
    wm = Face(os.path.join(FONTS, 'f2', 'epilogue-800-latin.woff2'))
    ds = Face(os.path.join(FONTS, 'f2', 'epilogue-600-latin.woff2'))
    size = 0.86 * h
    centre = h / 2
    baseline = centre + (wm.asc + wm.desc) / 2 * size / wm.upm
    x0 = h + 0.30 * h
    d1, x = wm.run('yuntera', size, -0.03, x0, baseline)
    body = f'<path d="{d1}" fill="{word_c}"/>'
    if desc:
        d2, x = ds.run(desc, size, -0.03, x + 0.22 * h, baseline)
        body += f'<path d="{d2}" fill="{word_c}" fill-opacity="0.62"/>'
    w = round(x + 2, 1)
    label = 'Yuntera' + (f' {desc.title()}' if desc else '')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" role="img" aria-label="{label}"><title>{label}</title>'
            f'{MARK.format(c=mark_c)}{body}</svg>'), w


VERSIONS = {  # name: (mark, word, background for previews)
    'marca': (P['achiote'], P['noche'], P['cal']),
    'tinta': (P['noche'], P['noche'], P['cal']),
    'blanco': (P['cal'], P['cal'], P['noche']),
}
APPS = [(None, 'yuntera'), ('vende', 'vende'), ('central', 'central'), ('ruta', 'ruta'), ('bodega', 'bodega')]

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for d, slug in APPS:
        for v, (mc, wc, _) in VERSIONS.items():
            svg, w = lockup(d, mc, wc)
            open(os.path.join(OUT, f'{slug}-{v}.svg'), 'w').write(svg)
    print('ok', len(APPS) * len(VERSIONS), 'lockups in', OUT)
