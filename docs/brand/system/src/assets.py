"""Draws the direction's own assets: product placeholders, the painted wheel,
the four app icons. Run: python3 src/assets.py (from the direction folder)."""
import math, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG = os.path.join(ROOT, 'img')
AS = os.path.join(ROOT, 'assets')

NOCHE = '#1E1A16'; ACH = '#B8420F'; MAIZ = '#F2B705'; CAL = '#FFFFFF'
ANIL = '#1F47A8'; CACAO = '#4A2A1C'

# ---------- product placeholders: neutral studio shot stand-ins ----------
B = '#8E857B'; H = '#A69D92'; D = '#6F675E'; L = '#C9C1B6'

def studio(body, w_shadow=150):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" role="img">
<rect width="400" height="400" fill="#EEEAE4"/>
<rect y="300" width="400" height="100" fill="#E8E3DC"/>
<ellipse cx="200" cy="330" rx="{w_shadow}" ry="16" fill="#D2CABF" opacity=".8"/>
{body}
</svg>'''

P = {}
P['cafe-molido'] = studio(f'''<path d="M140 110 L260 110 L272 330 L128 330 Z" fill="{B}"/>
<rect x="140" y="96" width="120" height="22" rx="3" fill="{D}"/>
<rect x="152" y="180" width="96" height="92" rx="4" fill="{L}"/>
<rect x="168" y="200" width="64" height="10" rx="2" fill="{D}"/><rect x="168" y="220" width="44" height="8" rx="2" fill="{H}"/>
<path d="M150 110 L156 330" stroke="{H}" stroke-width="8"/>''', 90)
P['cafe-grano'] = studio(f'''<path d="M118 80 L282 80 L296 332 L104 332 Z" fill="{D}"/>
<rect x="118" y="66" width="164" height="24" rx="3" fill="{NOCHE}" opacity=".55"/>
<circle cx="200" cy="130" r="12" fill="{H}"/>
<rect x="136" y="170" width="128" height="120" rx="4" fill="{L}"/>
<rect x="154" y="196" width="92" height="12" rx="2" fill="{D}"/><rect x="154" y="218" width="60" height="8" rx="2" fill="{B}"/>''', 110)
P['jabon'] = studio(f'''<rect x="116" y="262" width="168" height="66" rx="18" fill="{B}"/>
<rect x="128" y="200" width="150" height="62" rx="18" fill="{H}"/>
<rect x="122" y="140" width="160" height="62" rx="18" fill="{B}"/>
<rect x="150" y="160" width="100" height="10" rx="5" fill="{L}"/>''', 110)
P['tabla'] = studio(f'''<g transform="rotate(-8 200 220)"><rect x="96" y="120" width="210" height="200" rx="14" fill="{B}"/>
<rect x="306" y="190" width="40" height="60" rx="14" fill="{B}"/><circle cx="330" cy="220" r="9" fill="#EEEAE4"/>
<path d="M110 160 H290 M110 210 H290 M110 260 H290" stroke="{H}" stroke-width="5"/></g>''', 140)
P['botella'] = studio(f'''<rect x="160" y="110" width="80" height="222" rx="22" fill="{B}"/>
<rect x="168" y="70" width="64" height="48" rx="8" fill="{D}"/>
<rect x="172" y="120" width="12" height="200" rx="6" fill="{H}"/>''', 70)
P['cargador'] = studio(f'''<rect x="140" y="150" width="120" height="130" rx="18" fill="{L}"/>
<rect x="166" y="112" width="12" height="42" rx="3" fill="{D}"/><rect x="222" y="112" width="12" height="42" rx="3" fill="{D}"/>
<rect x="186" y="230" width="28" height="12" rx="4" fill="{D}"/>
<path d="M200 280 C200 320 280 320 300 330" stroke="{B}" stroke-width="10" fill="none" stroke-linecap="round"/>''', 120)
P['libreta'] = studio(f'''<g transform="rotate(-4 200 220)"><rect x="120" y="90" width="170" height="236" rx="8" fill="{D}"/>
<rect x="120" y="90" width="18" height="236" fill="{NOCHE}" opacity=".35"/>
<rect x="258" y="90" width="10" height="236" fill="{L}"/></g>''', 110)
P['camiseta'] = studio(f'''<path d="M150 90 L118 104 L70 150 L104 192 L134 170 L134 330 L266 330 L266 170 L296 192 L330 150 L282 104 L250 90 C238 112 162 112 150 90 Z" fill="{B}"/>
<path d="M150 90 C162 112 238 112 250 90" stroke="{D}" stroke-width="8" fill="none"/>''', 120)
P['olla'] = studio(f'''<rect x="112" y="170" width="176" height="160" rx="40" fill="{L}"/>
<path d="M112 196 C120 150 280 150 288 196 Z" fill="{B}"/>
<rect x="184" y="136" width="32" height="20" rx="8" fill="{D}"/>
<rect x="176" y="240" width="48" height="28" rx="6" fill="{D}"/>''', 120)
P['licuadora'] = studio(f'''<path d="M150 80 L250 80 L238 236 L162 236 Z" fill="{L}" opacity=".9"/>
<rect x="146" y="70" width="108" height="18" rx="5" fill="{D}"/>
<path d="M250 110 C290 110 290 190 244 196" stroke="{B}" stroke-width="10" fill="none"/>
<rect x="140" y="236" width="120" height="94" rx="12" fill="{B}"/>
<circle cx="200" cy="284" r="14" fill="{D}"/>''', 100)
P['cafetera'] = studio(f'''<rect x="136" y="90" width="128" height="240" rx="14" fill="{D}"/>
<rect x="136" y="90" width="128" height="60" rx="14" fill="{B}"/>
<path d="M160 214 L240 214 L232 314 L168 314 Z" fill="{L}" opacity=".95"/>
<rect x="150" y="306" width="100" height="14" rx="4" fill="{B}"/>''', 110)
P['abanico'] = studio(f'''<rect x="194" y="200" width="12" height="122" fill="{D}"/>
<ellipse cx="200" cy="328" rx="60" ry="10" fill="{D}"/>
<circle cx="200" cy="140" r="86" fill="none" stroke="{B}" stroke-width="10"/>
<circle cx="200" cy="140" r="58" fill="none" stroke="{H}" stroke-width="4"/>
<circle cx="200" cy="140" r="30" fill="none" stroke="{H}" stroke-width="4"/>
<circle cx="200" cy="140" r="14" fill="{D}"/>''', 80)
P['audifonos'] = studio(f'''<rect x="120" y="210" width="160" height="110" rx="46" fill="{L}"/>
<path d="M120 252 H280" stroke="{H}" stroke-width="4"/>
<g transform="rotate(-18 160 170)"><rect x="140" y="120" width="40" height="70" rx="20" fill="{B}"/><rect x="152" y="180" width="16" height="44" rx="8" fill="{B}"/></g>
<g transform="rotate(18 240 170)"><rect x="220" y="120" width="40" height="70" rx="20" fill="{B}"/><rect x="232" y="180" width="16" height="44" rx="8" fill="{B}"/></g>''', 110)
P['parlante'] = studio(f'''<rect x="100" y="180" width="200" height="140" rx="70" fill="{D}"/>
<circle cx="170" cy="250" r="44" fill="{B}"/><circle cx="170" cy="250" r="16" fill="{D}"/>
<rect x="234" y="228" width="40" height="44" rx="10" fill="{B}"/>''', 120)
P['generico'] = studio(f'''<rect x="140" y="140" width="120" height="190" rx="10" fill="{B}"/>''', 90)

# ---------- the painted wheel ----------
def petals(cx, cy, r, n, rx, ry, fill, rot=0):
    out = []
    for i in range(n):
        a = rot + i * 360 / n
        x = cx + r * math.sin(math.radians(a)); y = cy - r * math.cos(math.radians(a))
        out.append(f'<ellipse cx="{x:.2f}" cy="{y:.2f}" rx="{rx}" ry="{ry}" transform="rotate({a:.1f} {x:.2f} {y:.2f})" fill="{fill}"/>')
    return ''.join(out)

def dots(cx, cy, r, n, rr, fill, rot=0):
    return ''.join(f'<circle cx="{cx + r*math.sin(math.radians(rot+i*360/n)):.2f}" cy="{cy - r*math.cos(math.radians(rot+i*360/n)):.2f}" r="{rr}" fill="{fill}"/>' for i in range(n))

def wheel_body(cx=50, cy=50, s=1.0, ground=MAIZ, paint=ACH, rim=NOCHE):
    g = (f'<circle cx="{cx}" cy="{cy}" r="{48*s}" fill="{rim}"/>'
         f'<circle cx="{cx}" cy="{cy}" r="{43*s}" fill="{ground}"/>'
         + petals(cx, cy, 30*s, 8, 6.5*s, 11*s, paint)
         + f'<circle cx="{cx}" cy="{cy}" r="{18*s}" fill="{CAL}"/>'
         + dots(cx, cy, 12.5*s, 8, 2.2*s, rim, 22.5)
         + f'<circle cx="{cx}" cy="{cy}" r="{6*s}" fill="{rim}"/>')
    return g

WHEEL = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="Rueda de carreta pintada">{wheel_body()}</svg>'
WHEEL_EMPTY = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="Rueda sin pintar">'
               f'<circle cx="50" cy="50" r="46" fill="none" stroke="{NOCHE}" stroke-width="4"/>'
               f'<circle cx="50" cy="50" r="18" fill="none" stroke="{NOCHE}" stroke-width="3"/>'
               f'<circle cx="50" cy="50" r="6" fill="{NOCHE}"/></svg>')

# ---------- app icons: ground colour + regional wheel pattern + mark ----------
MARK = ('<path d="M12 12C12 23 24 20 24 31M36 12C36 23 24 20 24 31M24 31V42" fill="none" stroke="{c}" '
        'stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="11" r="6" fill="{c}"/>'
        '<circle cx="36" cy="11" r="6" fill="{c}"/>')

def pattern(kind, color):
    cx = cy = 512
    if kind == 'petalos':
        return petals(cx, cy, 300, 8, 56, 96, color)
    if kind == 'hojas':
        return petals(cx, cy, 300, 4, 95, 115, color, 45)
    if kind == 'flechas':
        # twelve chevrons on the outer band only, pointing the way the wheel
        # turns; nothing runs from hub to rim, so the wheel stays solid
        out = []
        for i in range(12):
            a = i * 30
            x = cx + 330*math.sin(math.radians(a)); y = cy - 330*math.cos(math.radians(a))
            out.append(f'<path d="M-26 -42 L16 0 L-26 42" transform="translate({x:.1f} {y:.1f}) rotate({a})" fill="none" stroke="{color}" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/>')
        return ''.join(out)
    if kind == 'cuadros':
        out = []
        for i in range(8):
            a = i * 45
            x = cx + 305*math.sin(math.radians(a)); y = cy - 305*math.cos(math.radians(a))
            out.append(f'<rect x="{x-55:.1f}" y="{y-55:.1f}" width="110" height="110" transform="rotate({a} {x:.1f} {y:.1f})" fill="{color}"/>')
        return ''.join(out)

def app_icon(ground, patt, pcolor, hub, markc, rule=None):
    # <g id="fondo"> is the Android adaptive background; everything after it is the
    # foreground (src/render.js splits on it). rule: the 3 px ink rule of the bodega
    # bar, drawn along the bottom of the tile so a cal tile keeps its square on a
    # white home screen (judge's note).
    r = f'<rect y="976" width="1024" height="48" fill="{rule}"/>' if rule else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">'
            f'<g id="fondo"><rect width="1024" height="1024" fill="{ground}"/>{r}</g>'
            + f'<circle cx="512" cy="512" r="420" fill="none" stroke="{pcolor}" stroke-width="28"/>'
            + pattern(patt, pcolor) +
            f'<circle cx="512" cy="512" r="215" fill="{hub}"/>'
            f'<g transform="translate(512 512) scale(7.6) translate(-24 -26.5)">{MARK.format(c=markc)}</g></svg>')

ICONS = {
    'icono-yuntera': app_icon(ACH, 'petalos', MAIZ, CAL, ACH),
    'icono-vende': app_icon(CACAO, 'hojas', '#C98A5A', CAL, CACAO),
    'icono-ruta': app_icon(ANIL, 'flechas', CAL, CAL, ANIL),
    'icono-bodega': app_icon('#F3EEE6', 'cuadros', NOCHE, NOCHE, CAL, rule=NOCHE),
    # the staff console has no phone app: this is its browser icon (apps/ops/public/icon.svg)
    'icono-central': app_icon(NOCHE, 'cuadros', CAL, CAL, NOCHE),
}

if __name__ == '__main__':
    os.makedirs(IMG, exist_ok=True)
    for k, v in P.items():
        open(os.path.join(IMG, k + '.svg'), 'w').write(v)
    open(os.path.join(AS, 'rueda.svg'), 'w').write(WHEEL)
    open(os.path.join(AS, 'rueda-sin-pintar.svg'), 'w').write(WHEEL_EMPTY)
    for k, v in ICONS.items():
        open(os.path.join(AS, k + '.svg'), 'w').write(v)
    print('ok', len(P), 'placeholders')
