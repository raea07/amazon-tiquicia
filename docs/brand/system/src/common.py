"""Shared pieces for every reference page of the final Carreta system."""
import os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NB = ' '  # narrow no-break space for thousands
MINUS = '−'
PAGES = []  # (file, title, template, app, widths) registered by page()


def col(n, cents=None):
    s = '₡' + f'{n:,}'.replace(',', NB)
    return s + (f',{cents:02d}' if cents is not None else '')

# ---------- icons: drawn from the mark's stroke (2.75 on 24 = 6 on 48 at
# 20 px), round caps, the mark's round heads as dot terminals ----------
def _i(body):
    return f'<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">{body}</svg>'
D = lambda x, y, r=1.9: f'<circle class="dot" cx="{x}" cy="{y}" r="{r}"/>'
ICON = {
 'buscar': _i('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l3.5 3.5"/>' + D(19.3, 19.3, 2.1)),
 'carrito': _i('<path d="M3 5h3l2.2 10h10.3l2-7H7.4"/>' + D(10, 19.5) + D(17, 19.5)),
 'pin': _i('<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/>' + D(12, 10, 2.2)),
 'ayuda': _i('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.6"/>' + D(12, 17, 1.6)),
 'chat': _i('<path d="M4.5 19.5l1.3-3.6A8 8 0 1 1 8.4 18.6z"/>' + D(8.6, 12, 1.4) + D(12.2, 12, 1.4) + D(15.8, 12, 1.4)),
 'menu': _i('<path d="M8 7h12M8 12h12M8 17h12"/>' + D(4, 7) + D(4, 12) + D(4, 17)),
 'filtro': _i('<path d="M4 7h16M4 12h16M4 17h16"/>' + D(9, 7, 2.6) + D(15, 12, 2.6) + D(7, 17, 2.6)),
 'caja': _i('<path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/>'),
 'etiqueta': _i('<path d="M3.5 12V4h8l9 9-7.5 7.5z"/>' + D(8, 8, 2)),
 'estante': _i('<path d="M5 3v18M19 3v18M5 9h14M5 15h14"/>'),
 'moneda': _i('<circle cx="12" cy="12" r="9"/><path d="M15 9a4 4 0 1 0 0 6"/><path d="M12 6.5l-1.6 11M14.6 7.5l-1.2 9" stroke-width="1.6"/>'),
 'inicio': _i('<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>'),
 'escanear': _i('<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M4 12h16"/>'),
 'llamar': _i('<path d="M6.5 3.5h3l1.8 4.6-2.4 1.5a10.5 10.5 0 0 0 5.5 5.5l1.5-2.4 4.6 1.8v3a2 2 0 0 1-2 2A15.5 15.5 0 0 1 4.5 5.5a2 2 0 0 1 2-2z"/>'),
 'ruta': _i('<path d="M6 17.5V12a4 4 0 0 1 4-4h8"/><path d="M15 5l3 3-3 3"/>' + D(6, 19.5, 2.2)),
 'mapa': _i('<path d="M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2z"/><path d="M9 4v14M15 6v14"/>'),
 'check': _i('<path d="M5 12.5l4.5 4.5L19 7"/>'),
 'alerta': _i('<circle cx="12" cy="12" r="9"/><path d="M12 7v6"/>' + D(12, 16.6, 1.6)),
 'abajo': _i('<path d="M6 9l6 6 6-6"/>'),
 'derecha': _i('<path d="M9 6l6 6-6 6"/>'),
 'izquierda': _i('<path d="M15 6l-6 6 6 6"/>'),
 'cerrar': _i('<path d="M6 6l12 12M18 6L6 18"/>'),
 'mas': _i('<path d="M12 5v14M5 12h14"/>'),
 'menos': _i('<path d="M5 12h14"/>'),
 'camion': _i('<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7"/>' + D(7, 18.5, 2) + D(17, 18.5, 2)),
 'persona': _i('<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>'),
 'grafico': _i('<path d="M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6"/>'),
 'escudo': _i('<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/>'),
 'reloj': _i('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
 'camara': _i('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
 'sin-red': _i('<path d="M3 9.5a13 13 0 0 1 6-3M12 6a13 13 0 0 1 9 3.5M6.5 13a8 8 0 0 1 3.5-2M14.5 11.3a8 8 0 0 1 3 1.7M4 4l16 16"/>' + D(12, 18.5, 1.8)),
 'documento': _i('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>'),
 'campana': _i('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/>' + D(12, 20.5, 1.8)),
 'candado': _i('<rect x="5" y="10" width="14" height="10" rx="1"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>' + D(12, 15, 1.6)),
 'salir': _i('<path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9"/>'),
 'lista': _i('<path d="M9 7h11M9 12h11M9 17h11"/>' + D(4.5, 7, 1.6) + D(4.5, 12, 1.6) + D(4.5, 17, 1.6)),
 'tienda': _i('<path d="M4 9l1.5-5h13L20 9M4 9h16v11H4zM9 20v-6h6v6"/>'),
 'equipo': _i('<circle cx="9" cy="9" r="3"/><circle cx="16.5" cy="10" r="2.5"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M14 19a4.5 4.5 0 0 1 7 0"/>'),
 'editar': _i('<path d="M4 20h4l11-11-4-4L4 16z"/><path d="M13 7l4 4"/>'),
}
ICON_WORDS = [('buscar', 'Buscar'), ('carrito', 'Carrito'), ('pin', 'Zona'), ('ayuda', 'Ayuda'), ('chat', 'WhatsApp'), ('menu', 'Categorías'),
              ('filtro', 'Filtrar'), ('caja', 'Pedidos'), ('etiqueta', 'Productos'), ('estante', 'Inventario'), ('moneda', 'Pagos (₡)'),
              ('inicio', 'Inicio'), ('escanear', 'Leer código'), ('camara', 'Cámara'), ('llamar', 'Llamar'), ('ruta', 'Cómo llegar'), ('mapa', 'Abrir en Waze'),
              ('check', 'Listo'), ('alerta', 'Atención'), ('camion', 'Despacho'), ('persona', 'Cuenta'), ('equipo', 'Equipo'), ('tienda', 'Tienda'),
              ('grafico', 'Resumen'), ('escudo', 'Seguridad'), ('reloj', 'Horario'), ('documento', 'Comprobantes'), ('campana', 'Avisos'),
              ('candado', 'Contraseña'), ('salir', 'Salir'), ('lista', 'Lista'), ('editar', 'Editar'), ('sin-red', 'Sin conexión')]


def stars(r):
    """Five stars in currentColor. Decorative; the number is always written."""
    out = []
    pts = '7,1 8.8,5 13,5.4 9.8,8.2 10.8,12.5 7,10.3 3.2,12.5 4.2,8.2 1,5.4 5.2,5'
    for i in range(5):
        x = i * 15
        fill = max(0, min(1, r - i))
        cid = f'c{i}{int(r * 10)}'
        out.append(f'<g transform="translate({x} 0)"><polygon points="{pts}" fill="none" stroke="currentColor" stroke-width="1.2"/>'
                   + (f'<clipPath id="{cid}"><rect width="{14 * fill}" height="14"/></clipPath><polygon points="{pts}" fill="currentColor" clip-path="url(#{cid})"/>' if fill > 0 else '') + '</g>')
    return f'<svg viewBox="0 0 74 14" aria-hidden="true">{"".join(out)}</svg>'


def rating(r, n):
    if r is None:
        return '<span class="stars muted">Sin reseñas todavía</span>'
    rs = (f'{r:.1f}'.replace('.', ',')).replace(',0', '')
    word = 'reseña' if n == 1 else 'reseñas'
    return f'<span class="stars">{stars(r)}<span><b>{rs} de 5</b> <span class="muted">({n} {word})</span></span></span>'


_W = open(os.path.join(ROOT, 'assets', 'rueda.svg')).read()
_W = re.sub(r'<svg [^>]*>', '', _W).replace('</svg>', '')
_W = _W.replace('r="48.0" fill="#1E1A16"', 'r="48.0" style="fill:var(--yt-wheel-rim,#1E1A16)"')


def wheel(size=28, label='Entregado por Yuntera, con nuestros propios repartidores', unpainted=False):
    if unpainted:
        body = ('<circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="4"/>'
                '<circle cx="50" cy="50" r="18" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="50" cy="50" r="6" fill="currentColor"/>')
    else:
        body = _W
    lab = f'role="img" aria-label="{label}"' if label else 'aria-hidden="true"'
    return f'<svg class="wheel w{size}" viewBox="0 0 100 100" {lab}>{body}</svg>'


def mark_err(size=56):
    return f'<span class="mark-err" aria-hidden="true" style="width:{size}px;height:{size}px">!</span>'


DEPTS = [('Hecho en Costa Rica', 2), ('Electrónica', 2), ('Computación', 2), ('Celulares y accesorios', 1),
         ('Electrodomésticos', 4), ('Hogar y cocina', 2), ('Ferretería y herramientas', 3), ('Deportes y aire libre', 2),
         ('Moda', 2), ('Belleza y cuidado personal', 1), ('Mascotas', 1), ('Juguetes y juegos', 1),
         ('Libros y oficina', 1), ('Abarrotes y café', 2)]


def head(title, css='', theme=None, body_cls=''):
    th = f' data-theme="{theme}"' if theme else ''
    return (f'<!doctype html><html lang="es"{th}><head><meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n'
            f'<title>{title}</title><link rel="stylesheet" href="carreta.css">' + (f'<style>{css}</style>' if css else '') + f'</head><body class="{body_cls}">')


def lockup(desc=None, mark='mark-achiote.svg', href='home.html', size=None):
    d = f'<span class="desc">{desc}</span>' if desc else ''
    name = 'Yuntera' + (f' {desc}' if desc else '') + ', inicio'
    st = f' style="font-size:{size}px"' if size else ''
    return f'<a class="lockup" href="{href}"><img src="assets/{mark}" alt=""><span class="wordmark"{st} aria-hidden="true">yuntera{d}</span><span class="sr">{name}</span></a>'


def search_form(cls):
    return (f'<form class="search {cls}" role="search"><label class="search-label" for="q-{cls}">Buscar en Yuntera</label>'
            f'<div class="search-row"><input id="q-{cls}" class="input" type="search" placeholder="¿Qué ocupa?"><button class="btn" type="submit">Buscar</button></div></form>')


def shop_header(cur=None, cart=0, account='Ingresar', zone='Elija su zona'):
    links = ''.join(f'<a href="lista.html"{" aria-current=page" if n == cur else ""}>{n}</a>' for n, _ in DEPTS[:5])
    cnt = f'<span class="count-badge" aria-label="{cart} productos">{cart}</span>'
    return f'''<header class="hdr"><div class="wrap">
<div class="hdr-row">{lockup()}{search_form("desk-search")}
<div class="hdr-actions"><a class="hdr-link mob-only" href="ayuda.html">Ayuda</a><a class="hdr-link" href="ingresar.html">{ICON["persona"]}{account}</a>
<a class="hdr-link" href="carrito.html">{ICON["carrito"]}<span>Carrito</span> {cnt}</a></div></div>
<div class="mobile-search">{search_form("mob")}</div>
<nav class="dept-bar" aria-label="Departamentos"><a class="all" href="home.html#departamentos">Todas las categorías</a>{links}
<a href="home.html#departamentos">Más (9)</a>
<a class="help" href="ayuda.html">{ICON["ayuda"]} Ayuda</a><a href="ayuda.html">{ICON["chat"]} WhatsApp</a></nav>
</div></header>
<script>(function(){{var y=scrollY,h=document.querySelector('.hdr');addEventListener('scroll',function(){{var n=scrollY;h.classList.toggle('hide',n>y+4&&n>160);y=n}},{{passive:true}})}})()</script>'''


def closed_header(back='carrito.html', back_word='Volver al carrito'):
    return f'''<header class="hdr closed"><div class="wrap"><div class="hdr-row">{lockup()}
<div class="hdr-actions"><a class="hdr-link" href="ayuda.html">{ICON["ayuda"]} Ayuda</a><a class="hdr-link" href="{back}">{back_word}</a></div></div></div></header>'''


def strip(chosen=False, version=1, phone_line=False):
    if chosen:
        t = 'Pida hoy antes de las 2 p. m. y le llega mañana, <strong>miércoles 25 de noviembre</strong>, en San Pedro.'
        z = '<a href="zona.html">Cambiar zona</a>'
    else:
        t = ('<strong>Pida hoy antes de las 2 p. m.</strong> y le llega mañana, en el GAM.'
             '<span class="desk-only"> Con nuestros propios repartidores.</span>')
        z = '<a href="zona.html">Elija su zona</a>'
    cls = 'strip banda-marca' if version == 1 else 'strip regla'
    return f'<div class="{cls}"><div class="wrap">{wheel(28 if version else 24)}<p>{t}</p>{z}</div></div>'


def footer():
    return f'''<footer class="footer" id="ayuda"><div class="wrap">
<div class="facts"><p><b>Pague como prefiera:</b> SINPE Móvil, tarjeta o en efectivo cuando recibe.</p>
<p><b>Devoluciones sin enredos:</b> 8 días hábiles desde que recibe, sin dar explicaciones.</p>
<p><b>Factura electrónica:</b> de cada vendedor, directo a su correo.</p></div>
<div class="cols">
<div class="lead"><h2>Dónde entregamos</h2><p class="t-small">En el Gran Área Metropolitana, al día siguiente si pide antes de las 2 p. m., con nuestros propios repartidores. Envío {col(1500)}; gratis desde {col(25000)}.</p>
<ul class="cols3"><li><a href="zona.html">San José</a></li><li><a href="zona.html">Heredia</a></li><li><a href="zona.html">Alajuela</a></li><li><a href="zona.html">Cartago</a></li><li><a href="zona.html">Escazú y Santa Ana</a></li><li><a href="zona.html">Vea si llegamos a su distrito</a></li></ul></div>
<div><h2>Ayuda</h2><ul><li><a href="ayuda.html">WhatsApp: [número por definir]</a></li><li><a href="ayuda.html">Entregas y zonas</a></li><li><a href="ayuda.html">Devoluciones y garantía</a></li><li><a href="ayuda.html">Medios de pago</a></li><li><a href="ayuda.html">Presentar un reclamo</a></li></ul></div>
<div><h2>Yuntera</h2><ul><li><a href="ayuda.html">Cómo ordenamos los resultados</a></li><li><a href="ayuda.html">Términos y condiciones</a></li><li><a href="ayuda.html">Privacidad</a></li><li><a href="ayuda.html">Eliminar su cuenta</a></li></ul></div>
</div>
<p class="legal">Yuntera (entidad en formación). Cédula jurídica: pendiente de inscripción. Contacto: ayuda@yuntera.cr. Todos los precios están en colones e incluyen el IVA.</p>
</div></footer>'''


def card(p, show_seller=True, href='producto.html'):
    tag = '<span class="tag plain">Hecho en Costa Rica</span>' if p.get('cr') else ''
    old = ''
    if p.get('old'):
        old = f'<span class="old">antes {col(p["old"])}</span><span class="tag discount">{MINUS}{p["pct"]}{NB}%</span>'
    unit = f'<span class="unit">{p["unit"]}</span>' if p.get('unit') else ''
    seller = f'<span class="by">Vendido por {p["seller"]}</span>' if show_seller and p.get('seller') else ''
    deliv = p.get('deliv', 'Entregado por Yuntera')
    return f'''<article class="card"><div class="ph"><img src="img/{p["img"]}.svg" alt="">{tag}</div>
<span class="brand">{p["brand"]}</span><a class="name" href="{href}">{p["name"]}</a>
{rating(p.get("r"), p.get("n", 0))}
<div class="price-row"><span class="t-price">{col(p["price"])}</span>{old}</div>{unit}
{seller}<span class="yt-line">{deliv}</span></article>'''


def linea(steps, cls='', wheel_at=None):
    """steps: (state, when_word, what, sub). state in done/now/next. wheel_at:
    index of the station that carries the wheel (only when the sequence IS the
    delivery: order tracking and the driver's stops)."""
    out = []
    for i, (st, ww, what, sub) in enumerate(steps):
        inner = ''
        if st == 'done':
            inner = ''
        elif st == 'now' and wheel_at == i:
            inner = wheel(32, 'Aquí va su pedido')
        elif cls.find('pasos') >= 0:
            inner = str(i + 1)
        cl = 'st has-wheel' if (st == 'now' and wheel_at == i) else 'st'
        num = f'<span class="sr">Paso {i + 1} de {len(steps)}: </span>'
        out.append(f'<li class="{st}"{" aria-current=step" if st == "now" else ""}><span class="{cl}" aria-hidden="{"false" if "has-wheel" in cl else "true"}">{inner}</span>'
                   f'{num}<span class="when-word">{ww}</span><span class="what">{what}</span>' + (f'<span class="sub">{sub}</span>' if sub else '') + '</li>')
    return f'<div class="linea-box"><ol class="linea {cls}" style="--n:{len(steps)}">{"".join(out)}</ol></div>'


# SISTEMA §3 rule 8: a time and a quantity never break across two lines.
# «2 p. m.» is written 2 U+00A0 p. U+00A0 m.; a number and the unit or the
# counted word after it are joined by U+00A0 («340 g», «24 horas», «12 %»).
# Money already uses U+202F (col()). In the product this is formatDay,
# formatTime and formatQuantity in packages/core; here every page's text
# goes through keep_together() before it is written.
NBSP = '\u00a0'
UNITS = r'(?:g|kg|mg|ml|L|cm|mm|m|km|W|V|px|pt|dp|ms|oz|GB|MB|%|°C)'
COUNTED = (r'(?:d[ií]as?|horas?|minutos?|segundos?|semanas?|meses|mes|años?|unidades?|productos?|pedidos?|paquetes?|paradas?|'
           r'rese[ñn]as?|estrellas?|bultos?|metros?|tiendas?|vendedor(?:es)?|compradores?|piezas?|tazas?|d[ií]gitos?|n[uú]meros?|'
           r'entregas?|entregadas?|p[aá]ginas?|filtros?|mensajes?|fotos?|veces|personas?|intentos?|l[ií]neas?|cajas?|puntos?|caracteres)')
_TIME = re.compile(r'(\d)[ \u00a0]([ap])\.[ \u00a0]m\.')
_UNIT = re.compile(r'(\d) (?=' + UNITS + r'(?![A-Za-zÀ-ÿ]))')
_COUNT = re.compile(r'(\d) (?=' + COUNTED + r'(?![A-Za-zÀ-ÿ]))')


def keep_together(html):
    out = []
    for part in re.split(r'(<script\b.*?</script>|<style\b.*?</style>|<[^>]+>)', html, flags=re.S):
        if not part.startswith('<'):
            part = _TIME.sub(lambda m: f'{m.group(1)}{NBSP}{m.group(2)}.{NBSP}m.', part)
            part = _UNIT.sub(lambda m: m.group(1) + NBSP, part)
            part = _COUNT.sub(lambda m: m.group(1) + NBSP, part)
        out.append(part)
    return ''.join(out)


def page(name, body, title=None, template='', app='', widths=(390, 1280)):
    body = keep_together(body)
    with open(os.path.join(ROOT, name), 'w') as f:
        f.write(body)
    m = re.search(r'<title>(.*?)</title>', body)
    PAGES.append((name, m.group(1) if m else name, template, app, tuple(widths)))


def bar_script(sel):
    """Fixed or sticky bottom bars: measure the real height into --bar-h (the
    page pads its end by it, so nothing is covered), and when the bar is taller
    than 20 % of the screen (large text) let it sit at the end of the page."""
    return ("<script>(function(){var b=document.querySelector('%s');if(!b)return;function f(){b.classList.remove('static');"
            "var h=b.offsetHeight;if(h>innerHeight*.2){b.classList.add('static');h=0}document.documentElement.style.setProperty('--bar-h',h+'px')}"
            "if(window.ResizeObserver)new ResizeObserver(f).observe(b);addEventListener('resize',f);f()})()</script>") % sel


def when_word(day, today=24):
    """Dates as people say them (SISTEMA §10.4), for tables and lists:
    hoy, ayer, mañana, else the weekday in full and the day (same month)."""
    names = {22: 'domingo', 23: 'lunes', 24: 'martes', 25: 'miércoles', 26: 'jueves', 27: 'viernes', 28: 'sábado', 30: 'lunes'}
    if day == today: return 'hoy'
    if day == today - 1: return 'ayer'
    if day == today + 1: return 'mañana'
    return f'{names[day]} {day}'
