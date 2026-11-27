"""Shop website (apps/web): T1–T5, T9 (shopper's invoice), T11–T15, N5."""
from common import *

CAFE1 = dict(img='cafe-molido', brand='Cafetal Los Santos', name='Café molido de altura Tarrazú 340 g', price=4950,
             unit=f'{col(1456)} por 100{NB}g', r=4.5, n=2, seller='Cafetal Los Santos', cr=True)
CAFE2 = dict(img='cafe-grano', brand='Cafetal Los Santos', name='Café en grano tostado medio Tarrazú 1 kg', price=12900,
             unit=f'{col(1290)} por 100{NB}g', r=5, n=2, seller='Cafetal Los Santos', cr=True)
JABON = dict(img='jabon', brand='Guaria Botánica', name='Jabón artesanal de avena y miel, 3 unidades', price=5400, r=5, n=1, seller='Cafetal Los Santos', cr=True)
TABLA = dict(img='tabla', brand='Taller Sarchí', name='Tabla de picar de madera de teca 35 cm', price=13500, r=5, n=1, seller='Cafetal Los Santos')
BOTELLA = dict(img='botella', brand='Sendero', name='Botella térmica Sendero 750 ml acero inoxidable', price=9900, r=5, n=1, seller='Tienda Sendero')
CARGADOR = dict(img='cargador', brand='Nimbo', name='Cargador USB-C 30 W Nimbo de carga rápida', price=8900, old=10900, pct=18, r=4, n=1, seller='TecnoCasa')
LIBRETA = dict(img='libreta', brand='Papelera Central', name='Libreta de notas tapa dura A5 rayada', price=3900, r=3, n=1, seller='Tienda Sendero')
CAMISETA = dict(img='camiseta', brand='Sendero', name='Camiseta de algodón Sendero cuello redondo', price=8900, r=4, n=1, seller='Tienda Sendero')
OLLA = dict(img='olla', brand='Volcán', name='Olla arrocera Volcán 1,8 L con vaporera', price=21900, r=3, n=1, seller='TecnoCasa')
LLEGA = 'Llega el miércoles 25 de noviembre'
OLLA_L = dict(OLLA, deliv=f'Entregado por Yuntera · {LLEGA}')
LICU = dict(img='licuadora', brand='Volcán', name='Licuadora Volcán 600 W vaso de vidrio 1,5 L', price=26500, old=29900, pct=11, r=3, n=1, seller='TecnoCasa', deliv=f'Entregado por Yuntera · {LLEGA}')
CAFET = dict(img='cafetera', brand='Volcán', name='Cafetera eléctrica Volcán 12 tazas programable', price=23900, r=5, n=1, seller='TecnoCasa', deliv=f'Entregado por Yuntera · {LLEGA}')
ABAN = dict(img='abanico', brand='Volcán', name='Abanico de pie Volcán 18" 3 velocidades', price=29900, r=None, seller='TecnoCasa', deliv=f'Entregado por Yuntera · {LLEGA}')
SELLERS = [  # monogram, name, own trade line, place, who answers (both approved by the seller)
    ('C', 'Cafetal Los Santos', 'Café de altura de la Zona de los Santos y artesanía de talleres costarricenses.', 'San Marcos de Tarrazú, San José', 'Marta'),
    ('T', 'TecnoCasa', 'Electrónica y electrodomésticos con garantía local de 12 meses.', 'Curridabat, San José', None),
    ('F', 'Ferretería El Higuerón', 'Herramientas y materiales. Despachamos desde Heredia.', 'San Pablo, Heredia', 'Rodrigo'),
    ('S', 'Tienda Sendero', 'Aire libre, deporte y todo para la casa.', 'Curridabat, San José', None),
]


def seller_block(m, n, d, place=None, who=None, href='tienda.html'):
    extra = ' · '.join(x for x in [f'Desde {place}' if place else '', f'Atiende: {who}' if who else ''] if x)
    return f'<div class="seller"><span class="mono" aria-hidden="true">{m}</span><a href="{href}">{n}</a><p>{d}</p>' + (f'<p class="place">{extra}</p>' if extra else '') + '</div>'


def home(version=1, name='home.html', title='Yuntera, inicio'):
    dept_items = ''.join(f'<li><a href="lista.html"><span>{n}</span><span class="n">{c}</span></a></li>' for n, c in DEPTS)
    sel = ''.join(seller_block(*s) for s in SELLERS)
    body = head(title) + shop_header() + strip(version=version) + f'''
<main class="wrap two-col">
<nav class="dept-aside" id="departamentos" aria-labelledby="dh">
<h2 class="t-section" id="dh" style="margin-bottom:8px">Departamentos</h2>
<ul class="depts"><li class="all"><a href="#departamentos">Todas las categorías <span class="n" style="color:var(--yt-ink)">14 {ICON["derecha"]}</span></a></li></ul>
<ul class="depts dept-grid">{dept_items}</ul></nav>
<div class="home-main">
<section class="sec"><div class="sec-head"><h2 class="t-section">Hecho en Costa Rica</h2><a href="lista.html">Ver todo</a></div>
<div class="grid">{card(CAFE1)}{card(CAFE2)}{card(JABON)}{card(TABLA)}</div></section>
<section class="sec"><div class="sec-head"><h2 class="t-section">Quién le vende</h2><a href="tienda.html">Ver todas las tiendas</a></div>
<div class="sellers">{sel}</div></section>
<section class="sec"><div class="sec-head"><h2 class="t-section">Lo que más se está llevando</h2></div>
<div class="grid">{''.join(card(p) for p in [CAFE1, CAFE2, BOTELLA, CARGADOR, JABON, LIBRETA, CAMISETA, OLLA])}</div></section>
</div></main>''' + footer() + '</body></html>'
    page(name, body, template='T1 Inicio de la tienda', app='web')


def filters_html(on=()):
    def ch(label, count=None):
        c = f'<span class="count">{count}</span>' if count is not None else ''
        return f'<label class="check{" on" if label in on else ""}"><span class="box"></span>{label}{c}</label>'
    return (f'<fieldset><legend>Subcategoría</legend>{ch("Cocina eléctrica", 3)}{ch("Abanicos y ventilación", 1)}</fieldset>'
            f'<fieldset><legend>Precio</legend>{ch("Hasta " + col(25000), 2)}{ch(col(25000) + " a " + col(50000), 2)}</fieldset>'
            f'<fieldset><legend>Calificación</legend>{ch("4 estrellas o más", 1)}</fieldset>'
            f'<fieldset><legend>Marca <span class="muted t-small" style="font-weight:400">(puede elegir varias)</span></legend>{ch("Volcán", 4)}</fieldset>'
            f'<fieldset style="border:0"><legend>Disponibilidad</legend>{ch("Solo disponibles")}</fieldset>')


SORTS = ['Más relevantes', 'Precio: menor a mayor', 'Precio: mayor a menor', 'Mejor calificados', 'Más vendidos', 'Más nuevos']


def lista():
    sort = ''.join(f'<option{" selected" if i == 0 else ""}>{s}</option>' for i, s in enumerate(SORTS))
    body = head('Electrodomésticos, Yuntera') + shop_header(cur='Electrodomésticos') + strip() + f'''
<main class="wrap"><nav class="crumbs" aria-label="Ruta"><a href="home.html">Inicio</a> / <span aria-current="page">Electrodomésticos</span></nav>
<div class="list-layout">
<aside class="filters" aria-labelledby="fh"><h2 class="t-section" id="fh" style="margin-bottom:4px">Filtrar</h2>{filters_html(on=("Cocina eléctrica", "Hasta " + col(25000)))}</aside>
<div>
<div class="toolbar"><div><h1 class="t-title">Electrodomésticos</h1><p class="muted">2 productos con los filtros elegidos</p></div>
<div class="field sortbox"><label for="ord">Ordenar por</label><select id="ord" class="select">{sort}</select></div></div>
<div class="mob-filter"><a class="btn btn-outline" href="lista-filtros.html">{ICON["filtro"]} Filtrar y ordenar (2)</a></div>
<div class="applied applied-bar" role="region" aria-label="Filtros aplicados"><span class="label">Filtros aplicados:</span><button class="chip">Cocina eléctrica {ICON["cerrar"]}<span class="sr">: quitar este filtro</span></button><button class="chip">Hasta {col(25000)} {ICON["cerrar"]}<span class="sr">: quitar este filtro</span></button><button class="link-btn">Quitar todos</button></div>
<div class="grid">{card(OLLA_L)}{card(CAFET)}</div>
<nav class="pager" aria-label="Páginas"><p class="muted">Página 1 de 1. Ya ve los 2 productos.</p></nav>
</div></div></main>''' + footer() + '</body></html>'
    page('lista.html', body, template='T2 Lista con filtros (2 filtros aplicados)', app='web')
    panel = head('Filtrar y ordenar, Yuntera') + f'''<div class="sheet-page" role="dialog" aria-modal="true" aria-labelledby="sh">
<div class="sheet-top"><h1 class="t-section" id="sh">Filtrar y ordenar</h1><a class="btn btn-outline btn-sm" href="lista.html">{ICON["cerrar"]} Cerrar</a></div>
<div class="sheet-body">
<p class="label" style="margin:12px 0 8px">Aplicados</p>
<div class="applied"><button class="chip">Cocina eléctrica {ICON["cerrar"]}<span class="sr">Quitar este filtro</span></button><button class="chip">Hasta {col(25000)} {ICON["cerrar"]}<span class="sr">Quitar este filtro</span></button><button class="link-btn">Quitar todos</button></div>
<fieldset class="plain" style="padding:16px 0 8px;border-bottom:1px solid var(--yt-rule)"><legend class="label" style="font:600 15px/20px var(--yt-font-text)">Ordenar por</legend>
<div>{''.join(f'<label class="check radio{" on" if i == 0 else ""}"><span class="box"></span>{s}</label>' for i, s in enumerate(SORTS))}</div></fieldset>
<div class="filters">{filters_html(on=("Cocina eléctrica", "Hasta " + col(25000)))}</div>
</div>
<div class="sheet-foot"><a class="btn btn-block" href="lista.html">Ver 2 productos</a></div></div></body></html>'''
    page('lista-filtros.html', panel, template='T2 Lista: panel de filtros abierto (teléfono)', app='web', widths=(390,))


def tienda():
    body = head('Cafetal Los Santos, Yuntera') + shop_header() + strip() + f'''
<main class="wrap"><nav class="crumbs" aria-label="Ruta"><a href="home.html">Inicio</a> / <a href="home.html">Tiendas</a> / <span aria-current="page">Cafetal Los Santos</span></nav>
<section class="shopface"><span class="mono" aria-hidden="true">C</span><h1 class="t-title">Cafetal Los Santos</h1>
<p>Café de altura de la Zona de los Santos y artesanía de talleres costarricenses.</p>
<p class="t-small muted">Desde San Marcos de Tarrazú, San José · Atiende: Marta</p>
<p class="facts"><span>4 productos</span><span>Entrega: Yuntera, desde nuestra bodega</span><span>Responde reclamos en 1 día hábil</span></p>
<p class="t-small"><a class="link44" href="ayuda.html#r">Reportar esta tienda</a></p></section>
<div class="toolbar" style="padding-top:16px"><div><h2 class="t-section">Sus productos</h2></div></div>
<div class="grid">{card(CAFE1, False)}{card(CAFE2, False)}{card(JABON, False)}{card(TABLA, False)}</div>
<nav class="pager" aria-label="Páginas"><p class="muted">Página 1 de 1. Ya ve los 4 productos.</p></nav></main>''' + footer() + '</body></html>'
    page('tienda.html', body, template='T2 Variante: la tienda de un vendedor (vendedor como persona)', app='web')


def producto():
    body = head('Audífonos Nimbo Aire, Yuntera') + shop_header() + strip() + f'''
<main class="wrap"><nav class="crumbs" aria-label="Ruta"><a href="home.html">Inicio</a> / <a href="lista.html">Electrónica</a> / <a href="lista.html">Audio y audífonos</a></nav>
<div class="pd">
<div class="gallery"><div class="main"><img src="img/audifonos.svg" alt="Audífonos Nimbo Aire con su estuche"></div>
<div class="thumbs" aria-hidden="true"><span class="on"></span><span></span><span></span></div></div>
<div class="pd-info"><a href="lista.html" class="brand-link">Nimbo</a>
<h1 class="t-title" style="margin:0 0 8px">Audífonos inalámbricos Nimbo Aire con estuche de carga</h1>
{rating(4.5, 2)}</div>
<div class="pd-desc"><p style="margin:12px 0">Audífonos Bluetooth 5.3 con estuche de carga USB-C y controles táctiles.</p>
<dl class="rows"><div><dt>Batería</dt><dd>Hasta 24 horas con el estuche</dd></div><div><dt>Llamadas</dt><dd>Cancelación de ruido</dd></div><div><dt>Uso</dt><dd>Resistentes al sudor</dd></div><div><dt>Garantía</dt><dd>12 meses, en Costa Rica</dd></div></dl></div>
<aside class="buy" aria-label="Comprar">
<div class="b-price"><span class="t-price-xl">{col(19500)}</span><p class="t-small">Precio final, IVA incluido.</p></div>
<div class="b-when"><p class="when">Llega el viernes 27 de noviembre</p><p class="t-small">Pida antes de las 2 p. m. Lo llevan nuestros propios repartidores.</p></div>
<div class="b-ship"><p class="t-small">Envío {col(1500)}; gratis en pedidos desde {col(25000)}. <a href="zona.html">Elija su zona</a> para confirmar la fecha</p></div>
<div class="b-seller"><p>Vendido por <a class="seller-link" href="tienda.html">Tienda Sendero</a></p><p class="t-small muted">Aire libre, deporte y todo para la casa.</p>
<p class="t-small" style="margin-top:4px">Entrega: El vendedor lo despacha y Yuntera lo entrega</p></div>
<div class="b-qty row"><span class="label" id="cant">Cantidad</span>
<div class="qty" role="group" aria-labelledby="cant"><button aria-label="Quitar uno">{ICON["menos"]}</button><output>1</output><button aria-label="Agregar uno">{ICON["mas"]}</button></div></div>
<button class="btn btn-block b-add">Agregar al carrito</button>
<dl class="rows b-rows"><div><dt>Devolución</dt><dd>8 días hábiles desde que lo recibe, sin dar explicaciones.</dd></div>
<div><dt>Garantía</dt><dd>12 meses con el vendedor.</dd></div><div><dt>Pago</dt><dd>SINPE Móvil, tarjeta o contra entrega.</dd></div></dl>
</aside></div>
<section class="sec" style="margin-top:32px"><h2 class="t-section">Otras ofertas de este producto (1)</h2>
<p class="t-small muted" style="margin:8px 0 12px;max-width:760px">Mostramos primero la oferta nueva con existencias y el precio más bajo; si cuestan lo mismo, la que se publicó antes. Puede comprar cualquiera de estas. <a href="ayuda.html">Cómo las ordenamos</a></p>
<div class="offer"><div><span class="t-price">{col(19900)}</span> <span class="old">antes {col(24900)}</span> <span class="tag discount">{MINUS}20{NB}%</span></div>
<div>Vendido por <a class="seller-link" href="tienda.html">TecnoCasa</a><p class="t-small muted">Entrega: Sale de la bodega de Yuntera</p></div>
<div><span class="tag yt">Llega antes</span><p class="when" style="font-size:16px">Llega el miércoles 25 de noviembre</p></div>
<div><button class="btn btn-outline btn-sm">Agregar esta oferta al carrito</button></div></div></section>
<section class="sec"><div class="rev-grid"><div><h2 class="t-section">Reseñas de quienes lo compraron</h2>
<p style="margin:8px 0 12px"><span class="t-price-xl">4,5</span> de 5 · 2 reseñas</p>
<div class="bars">{''.join(f'<div class="bar"><span>{k}</span><i><b style="width:{w}%"></b></i><span>{c}</span></div>' for k, w, c in [('5 estrellas', 50, 1), ('4 estrellas', 50, 1), ('3 estrellas', 0, 0), ('2 estrellas', 0, 0), ('1 estrella', 0, 0)])}</div>
<p class="t-small muted" style="margin-top:12px">Publicamos las reseñas de compras verificadas, buenas y malas. Solo retiramos las que incumplen las reglas, como insultos o datos personales.</p></div>
<div><div class="review"><p><b>5 de 5</b> · Andrés M. · 19 de noviembre de 2026</p><p>Llegó al día siguiente, tal como decía. Muy buen producto.</p></div>
<div class="review"><p><b>4 de 5</b> · María F. · 29 de octubre de 2026</p><p>Buena calidad por el precio. El repartidor fue muy amable.</p></div>
<p style="padding-top:12px"><a class="link44" href="ayuda.html#r">Reportar un problema</a></p></div></div></section>
<section class="sec"><h2 class="t-section" style="margin-bottom:16px">Productos parecidos</h2>
<div class="grid">{card(dict(img="parlante", brand="Nimbo", name="Parlante Bluetooth Nimbo Ola resistente al agua", price=27500, r=5, n=1, seller="TecnoCasa"))}</div></section>
</main>
<script>addEventListener('scroll',function(){{var b=document.querySelector('.buy .b-add').getBoundingClientRect();document.body.classList.toggle('scrolled',b.bottom<0)}},{{passive:true}})</script><div class="sticky-buy" aria-label="Comprar"><div><span class="t-price">{col(19500)}</span><p class="t-small" style="color:var(--yt-brand);font-weight:700">Llega el viernes 27 de noviembre</p></div><button class="btn">Agregar al carrito</button></div>''' + footer() + bar_script('.sticky-buy') + '</body></html>'
    page('producto.html', body, template='T3 Producto', app='web')


def sugerencias():
    items = [('caf', 'é molido'), ('caf', 'é en grano'), ('caf', 'etera eléctrica'), ('caf', 'etera de goteo 12 tazas'), ('caf', 'é Tarrazú 1 kg')]
    li = ''.join(f'<li role="option"><a href="lista.html">{ICON["buscar"]}<span>{a}<b>{b}</b></span></a></li>' for a, b in items)
    scopes = [('café', 'Abarrotes y café'), ('café', 'Hecho en Costa Rica'), ('cafetera', 'Electrodomésticos')]
    li2 = ''.join(f'<li role="option"><a class="scope" href="lista.html">{ICON["menu"]}<span><b>{a}</b> en <em>{d}</em></span></a></li>' for a, d in scopes)
    css = '''.search{position:relative}.sug a{line-height:20px}.sug{position:absolute;left:0;right:0;top:100%;background:var(--yt-page);border:2px solid var(--yt-ink);border-top:0;border-radius:0 0 var(--yt-radius-overlay) var(--yt-radius-overlay);box-shadow:var(--yt-elevation-overlay);z-index:40;list-style:none;margin:0;padding:4px 0}
.sug a{display:flex;align-items:center;gap:12px;min-height:44px;padding:0 16px;color:var(--yt-ink);text-decoration:none;font-size:16px}.sug b{font-weight:700}
.sug .scope{color:var(--yt-ink-muted);font-size:15px}.sug .scope b{color:var(--yt-ink)}.sug em{font-style:normal;color:var(--yt-ink);font-weight:600;border-bottom:2px solid var(--yt-ink)}.sug .sep{border-top:1px solid var(--yt-rule);margin:4px 0}'''
    hdr = shop_header().replace('<input id="q-mob" class="input" type="search" placeholder="¿Qué ocupa?">',
        f'<input id="q-mob" class="input" type="search" value="caf" role="combobox" aria-expanded="true" aria-controls="s1"><ul class="sug" id="s1" role="listbox" aria-label="Sugerencias">{li}<li class="sep" role="presentation"></li>{li2}</ul>')
    page('sugerencias.html', head('Sugerencias de búsqueda, Yuntera', css) + hdr + strip() + '<main class="wrap" style="min-height:600px"><p class="t-small muted" style="padding-top:16px">8 sugerencias como máximo en el teléfono, 10 en escritorio. La parte que completamos va en negrita; las búsquedas dentro de un departamento llevan el ícono de categorías y el nombre del departamento subrayado.</p></main></body></html>',
         template='Búsqueda con sugerencias (N5)', app='web', widths=(390,))


def carrito():
    def line(img, name, seller, unit, q, total):
        return f'''<div class="line"><div class="ph"><img src="img/{img}.svg" alt=""></div>
<div><a href="producto.html" style="color:var(--yt-ink);font-weight:600;display:flex;align-items:center;min-height:44px">{name}</a><p class="t-small muted">Vendido por {seller}</p>
<p class="t-small">{col(unit)} c/u</p></div>
<div class="controls"><div class="qty sm" role="group" aria-label="Cantidad de {name}"><button aria-label="Quitar uno">{ICON["menos"]}</button><output>{q}</output><button aria-label="Agregar uno">{ICON["mas"]}</button></div>
<button class="link-btn">Quitar</button><span class="t-price">{col(total)}</span></div></div>'''
    body = head('Su carrito, Yuntera') + shop_header(cart=3) + strip() + f'''
<main class="wrap"><h1 class="t-title" style="padding:24px 0 8px">Su carrito</h1>
<div class="cart"><div style="border-top:1px solid var(--yt-rule)">
{line('audifonos', 'Audífonos inalámbricos Nimbo Aire con estuche de carga', 'Tienda Sendero', 19500, 1, 19500)}
{line('cafe-molido', 'Café molido de altura Tarrazú 340 g', 'Cafetal Los Santos', 4950, 2, 9900)}
<p class="t-small muted" style="padding-top:12px">La cantidad se actualiza al tocar − o +.</p></div>
<aside class="summary" aria-labelledby="rs"><h2 class="t-section" id="rs">Resumen</h2>
<div class="sumrow"><span>Productos</span><span>{col(29400)}</span></div>
<div class="sumrow"><span>Envío (estimado)</span><span>Gratis</span></div>
<div class="sumrow total"><span>Total</span><span class="t-price-xl">{col(29400)}</span></div>
<p class="t-small">Incluye {col(2341, 38)} de IVA.</p>
<p class="when">Llega el viernes 27 de noviembre</p><p class="t-small">Pida antes de las 2 p. m.</p>
<p class="t-small"><a href="zona.html">Elija su zona</a> para ver el envío y la fecha exactos.</p>
<a class="btn btn-block" href="pago.html">Continuar con la compra</a></aside></div></main>''' + footer() + '</body></html>'
    page('carrito.html', body, template='T4 Carrito', app='web')


def pago():
    steps = [('now', 'Ahora', 'Entrega', ''), ('next', 'Falta', 'Pago', ''), ('next', 'Falta', 'Confirmar', '')]
    body = head('Pago, Yuntera') + closed_header() + f'''
<main class="wrap frames" style="padding-top:24px;display:grid;gap:48px">
<section aria-labelledby="k1">
<h1 class="t-title" id="k1" style="margin:0 0 8px">¿Cómo quiere continuar?</h1>
<p style="margin-bottom:16px" class="row"><span class="pending-label">{ICON["alerta"]} Pendiente de decisión</span> <span class="t-small muted">Hoy la compra pide una cuenta. Este paso se usa solo si se aprueba comprar sin cuenta.</span></p>
<div class="entry"><div class="opt main"><button class="btn btn-block">Continuar sin cuenta</button>
<p class="t-small">Le pedimos su teléfono y su correo para avisarle y enviarle su código de entrega.</p></div>
<div class="opt"><button class="btn btn-outline btn-block">Ingresar</button><p class="t-small">Si ya tiene cuenta, usamos su dirección guardada.</p></div></div>
<p class="t-small muted" style="margin-top:12px">Al terminar le ofrecemos guardar sus datos en una cuenta.</p></section>
<section aria-labelledby="cmp"><h1 class="sr" id="cmp">Compra</h1>{linea(steps, "pasos")}
<div class="cart" style="margin-top:24px"><div class="formcol">
<div class="errsum" role="alert" tabindex="-1"><h2>{ICON["alerta"]} Revise 1 dato para continuar</h2>
<a href="#tel">Teléfono: Escriba un número de 8 dígitos, por ejemplo 8888 1234.</a></div>
<fieldset class="plain"><legend>¿Dónde lo entregamos?</legend>
<label class="choice on"><span class="check radio on"><span class="box"></span></span><span><b>Su dirección: San Pedro, Montes de Oca</b><p>De la Fuente de la Hispanidad 300 metros sur y 50 este, casa esquinera con portón negro.</p></span></label>
<button class="link-btn" style="align-self:flex-start">Usar otra dirección</button></fieldset>
<div class="field error"><label for="tel">Teléfono</label><span class="err">{ICON["alerta"]} Escriba un número de 8 dígitos, por ejemplo 8888 1234.</span>
<input id="tel" class="input" value="8888 12" inputmode="numeric" aria-invalid="true" aria-describedby="tel-h"><span class="hint" id="tel-h">Le escribimos aquí cuando el paquete va en camino.</span></div>
<div class="field"><label for="correo">Correo</label><input id="correo" class="input" value="maria.f@correo.cr"><span class="hint">Aquí recibe las facturas electrónicas.</span></div>
<fieldset class="plain"><legend>¿Cómo quiere pagar?</legend>
<label class="choice"><span class="check radio"><span class="box"></span></span><span><b>SINPE Móvil</b><p>Le mostramos el número y el monto; confirmamos su pago en minutos.</p></span></label>
<label class="choice"><span class="check radio"><span class="box"></span></span><span><b>Tarjeta</b><p>Le llevamos a la página segura del banco para pagar.</p></span></label>
<label class="choice"><span class="check radio"><span class="box"></span></span><span><b>Efectivo contra entrega</b><p>Paga al repartidor cuando recibe. Si puede, tenga el monto exacto; si no, el repartidor le da el vuelto.</p></span></label></fieldset>
<label class="check"><span class="box"></span>Quiero recibir avisos del pedido por WhatsApp</label>
<button class="btn btn-block">Seguir al paso 2: Pago</button></div>
<aside class="summary" aria-labelledby="rp"><h2 class="t-section" id="rp">Resumen del pedido</h2>
<div class="sumrow"><span>Productos (3)</span><span>{col(29400)}</span></div><div class="sumrow"><span>Envío</span><span>Gratis</span></div>
<div class="sumrow total"><span>Total</span><span class="t-price-xl">{col(29400)}</span></div><p class="t-small">Incluye {col(2341, 38)} de IVA.</p>
<p class="when">Llega el viernes 27 de noviembre</p><p class="t-small">Pida antes de las 2 p. m.</p></aside></div></section>
</main>''' + footer() + '</body></html>'
    page('pago.html', body, template='T4 Pago: entrada (K1), pasos con la línea de ruta, error (K3)', app='web')


TRACK = [('done', 'Hecho', 'Pedido confirmado', 'ayer, 6:34 p. m.'), ('now', 'Ahora', 'Preparando su pedido', 'en la bodega, desde hoy a las 8:10 a. m.'),
         ('next', 'Falta', 'En camino', 'viernes 27, en la mañana'), ('next', 'Falta', 'Entregado', 'viernes 27')]


def pedido():
    body = head('Pedido YT-100018, Yuntera') + shop_header(account='María') + f'''
<main class="wrap">
<div class="order-head"><div class="row"><h1 class="t-display">Pedido YT-100018</h1><span class="tag half solid">Preparando su pedido</span></div>
<p class="muted">Realizado el lunes 23 de noviembre de 2026, 6:33 p. m.</p></div>
<div class="notice ok" role="status" style="border-top:0">{ICON["check"]}<div><b>¡Recibimos su pedido!</b>Ya lo estamos preparando. Aquí puede seguirlo en todo momento.</div></div>
<div class="cart"><div>
<section class="code banda-marca" aria-labelledby="cd"><h2 class="t-h3" id="cd">Su código de entrega</h2><p class="t-code" aria-label="3 7 7 2">3772</p>
<p class="t-small">Dígaselo al repartidor solo cuando tenga el paquete en sus manos. Es la prueba de que usted lo recibió; nadie de Yuntera se lo va a pedir por teléfono ni por mensaje.</p></section>
<section class="order-sec" style="margin-top:24px" aria-labelledby="dv"><h2 class="t-section" id="dv">Dónde va su pedido</h2>
{linea(TRACK, "track", wheel_at=1)}
<p class="when" style="margin-top:16px">Llega el viernes 27 de noviembre</p>
<p class="t-small muted">María Fernández Solís · De la Fuente de la Hispanidad 300 metros sur y 50 este, casa esquinera con portón negro. San Pedro, Montes de Oca.</p></section>
<section class="order-sec" aria-labelledby="pq"><h2 class="t-section" id="pq">Paquetes</h2>
<div class="pkg"><span><b>Paquete 1 de 2</b> · <span class="mono-code">YT500019</span> · Audífonos, de Tienda Sendero</span><span class="tag">Por preparar</span></div>
<div class="pkg"><span><b>Paquete 2 de 2</b> · <span class="mono-code">YT500018</span> · Café, de Cafetal Los Santos</span><span class="tag">Por preparar</span></div></section>
<section class="order-sec" aria-labelledby="pr"><h2 class="t-section" id="pr">Productos</h2>
<div class="line"><div class="ph"><img src="img/audifonos.svg" alt=""></div><div><b>Audífonos inalámbricos Nimbo Aire con estuche de carga</b><p class="t-small muted">1 × {col(19500)} · Vendido por Tienda Sendero</p><p class="t-price" style="margin-top:4px">{col(19500)}</p></div></div>
<div class="line"><div class="ph"><img src="img/cafe-molido.svg" alt=""></div><div><b>Café molido de altura Tarrazú 340 g</b><p class="t-small muted">2 × {col(4950)} · Vendido por Cafetal Los Santos</p><p class="t-price" style="margin-top:4px">{col(9900)}</p></div></div></section>
<section class="order-sec" aria-labelledby="fe"><h2 class="t-section" id="fe">Facturas electrónicas</h2><p>Cada vendedor le envía su factura electrónica al correo. Este pedido no tuvo costo de entrega, así que Yuntera no le emite factura.</p>
<p><a class="link44" href="comprobante.html">Ver la factura de Tienda Sendero</a></p></section>
<section class="order-sec" aria-labelledby="hi"><h2 class="t-section" id="hi">Historial</h2><ul class="hist">
<li><time>ayer, 6:33 p. m.</time><span>Recibimos su pedido.</span></li><li><time>ayer, 6:33 p. m.</time><span>Recibimos su pago por SINPE Móvil.</span></li><li><time>ayer, 6:34 p. m.</time><span>Confirmamos su pedido.</span></li><li><time>hoy, 8:10 a. m.</time><span>Empezamos a preparar su pedido en la bodega.</span></li></ul></section>
</div>
<div class="aside-stack">
<aside class="summary" aria-labelledby="rs"><h2 class="t-section" id="rs">Resumen</h2>
<div class="sumrow"><span>Productos</span><span>{col(29400)}</span></div><div class="sumrow"><span>Envío</span><span>Gratis</span></div>
<div class="sumrow total"><span>Total</span><span class="t-price-xl">{col(29400)}</span></div><p class="t-small">Incluye {col(2341, 38)} de IVA.</p>
<p class="t-small row" style="--g:8px">Pago: SINPE Móvil <span class="tag ok">Pagado</span></p></aside>
<section class="aside-block" aria-labelledby="ay"><h2 class="t-h3" id="ay">¿Necesita ayuda?</h2><a class="btn btn-outline btn-block" href="ayuda.html">{ICON["chat"]} Escribir por WhatsApp</a>
<p class="t-small muted">WhatsApp: [número por definir]</p><a class="link44" href="ayuda.html#r">Presentar un reclamo</a></section>
<section class="aside-block" aria-labelledby="co"><h2 class="t-h3" id="co">¿Cambió de opinión?</h2><p class="t-small">Ya empezamos a prepararlo, así que no se puede cancelar. Si no lo quiere, puede devolverlo cuando lo reciba: tiene 8 días hábiles y le devolvemos {col(29400)}.</p>
<a class="link44" href="ayuda.html#d">Cómo devolver un producto</a></section>
</div></div></main>''' + footer() + '</body></html>'
    page('pedido.html', body, template='T5 Pedido del comprador (estructura de A, línea de ruta de C, rueda en la estación)', app='web')


def pedidos():
    rows = [('YT-100018', 'lunes 23 de noviembre', 'Preparando su pedido', 'half solid', 'Llega el viernes 27 de noviembre', 29400, 'audifonos', '2 productos de 2 tiendas'),
            ('YT-100011', 'martes 17 de noviembre', 'Entregado', 'ok', 'Lo recibió el miércoles 18 de noviembre', 12900, 'cafe-grano', '1 producto'),
            ('YT-100004', 'lunes 2 de noviembre', 'Cancelado', 'ended', 'Le devolvimos ' + col(8900) + ' el 3 de noviembre', 8900, 'cargador', '1 producto')]
    li = ''.join(f'''<li class="ord"><div class="ph"><img src="img/{img}.svg" alt=""></div><div><a class="big" href="pedido.html">Pedido {n}</a>
<p class="t-small muted">Realizado el {d} · {what}</p><p class="row" style="--g:8px;margin-top:4px"><span class="tag {c}">{s}</span><span class="t-small"{' style="color:var(--yt-brand);font-weight:700"' if c.startswith('half') else ''}>{w}</span></p>
<p class="t-price" style="margin-top:8px">{col(t)}</p></div></li>''' for n, d, s, c, w, t, img, what in rows)
    body = head('Sus pedidos, Yuntera') + shop_header(account='María') + f'''<main class="wrap narrow" style="max-width:820px">
<nav class="crumbs" aria-label="Ruta"><a href="cuenta.html">Su cuenta</a> / <span aria-current="page">Pedidos</span></nav>
<h1 class="t-title" style="padding:4px 0 12px">Sus pedidos</h1><ul class="plain list-orders" style="border-top:1px solid var(--yt-rule)">{li}</ul>
<p class="pager muted">Página 1 de 1. Ya ve sus 3 pedidos.</p></main>''' + footer() + '</body></html>'
    page('pedidos.html', body, template='T5 Lista de sus pedidos', app='web')


def cents(c):
    """céntimos -> written money, céntimos shown only when there are any"""
    return col(c // 100, c % 100) if c % 100 else col(c // 100)


def iva_split(total_c, rate=13):
    """A price with IVA included, in céntimos -> (subtotal, iva). Integer céntimos,
    rounded half up on the subtotal, as packages/core does with money."""
    sub = (total_c * 100 * 2 + (100 + rate)) // (2 * (100 + rate))
    return sub, total_c - sub


def fiscal_doc(issuer, issuer_id, issuer_place, receptor_rows, lines, note, consec, key, date='lunes 23 de noviembre de 2026, 6:34 p. m.'):
    """lines: (qty, description, cabys, total_c with IVA included) -> the tax-format sheet."""
    trs, st, it = '', 0, 0
    for q, d, cab, tot in lines:
        sub, iva = iva_split(tot); st += sub; it += iva
        trs += (f'<tr><td data-label="Cantidad">{q}</td><td data-label="Descripción">{d}</td><td data-label="Código CABYS" class="mono-code">{cab}</td>'
                f'<td data-label="Precio sin IVA" class="money">{cents(sub)}</td><td data-label="IVA" class="money">13 % · {cents(iva)}</td><td data-label="Total" class="money">{cents(tot)}</td></tr>')
    rec = ''.join(f'<dt>{a}</dt><dd>{b}</dd>' for a, b in receptor_rows)
    return f'''<article class="fiscal" aria-labelledby="fd"><div class="row" style="justify-content:space-between;align-items:flex-start">
<div><p class="t-small muted">Factura electrónica</p><h1 class="t-section" id="fd">{issuer}</h1><p class="t-small">Cédula jurídica{':' if not issuer_id[0].isdigit() else ''} {issuer_id} · {issuer_place}</p></div>
<div class="t-small" style="text-align:right"><p>Consecutivo <span class="mono-code">{consec}</span></p><p>Fecha: {date}</p><p class="row" style="justify-content:flex-end;--g:8px">Hacienda: <span class="tag ok">Aceptada</span></p></div></div>
<p class="key">Clave numérica: {key}</p>
<dl class="facts">{rec}</dl>
<div class="fiscal-wrap"><table><thead><tr><th>Cantidad</th><th>Descripción</th><th>Código CABYS</th><th class="money">Precio sin IVA</th><th class="money">IVA</th><th class="money">Total</th></tr></thead>
<tbody>{trs}</tbody></table></div>
<dl class="facts" style="margin-left:auto;max-width:360px"><dt>Subtotal</dt><dd class="money">{cents(st)}</dd><dt>IVA 13 %</dt><dd class="money">{cents(it)}</dd><dt><b>Total</b></dt><dd class="money"><b class="t-price">{cents(st + it)}</b></dd></dl>
<p class="t-fine muted">{note}</p>
<div class="row no-print"><a class="btn btn-outline btn-sm" href="#">{ICON["documento"]} Descargar PDF</a><a class="btn btn-outline btn-sm" href="#">{ICON["documento"]} Descargar XML</a><button class="btn btn-outline btn-sm" onclick="print()">Imprimir</button></div></article>'''


def comprobante(name='comprobante.html', app='web', shell=None):
    # 19 500 with IVA included: subtotal 19 500 / 1,13 = 17 256,64, IVA 2 243,36 (computed, not typed)
    doc = fiscal_doc('Tienda Sendero', '3-101-000000', 'Curridabat, San José',
                     [('Receptor', 'María Fernández Solís'), ('Pedido', 'YT-100018 · paquete YT500019'), ('Condición', 'Contado · SINPE Móvil')],
                     [(1, 'Audífonos inalámbricos Nimbo Aire con estuche de carga', '4522000000000', 1950000)],
                     'Emitida por Tienda Sendero conforme a la resolución vigente de comprobantes electrónicos. Yuntera la muestra; no la emite.',
                     '00100001010000000412', '50623112600310100000000100001010000000412100000018')
    if shell:
        return doc
    body = head('Factura de Tienda Sendero, Yuntera') + shop_header(account='María') + f'''<main class="wrap" style="padding-bottom:24px">
<nav class="crumbs" aria-label="Ruta"><a href="cuenta.html">Su cuenta</a> / <a href="pedido.html">Pedido YT-100018</a> / <span aria-current="page">Factura</span></nav>{doc}</main>''' + footer() + '</body></html>'
    page(name, body, template='T9 Documento fiscal (vista del comprador)', app=app)


def cuenta():
    body = head('Su cuenta, Yuntera') + shop_header(account='María') + f'''<main class="wrap narrow" style="max-width:720px;padding-bottom:24px">
<h1 class="t-title" style="padding:24px 0 4px">Su cuenta</h1><p class="muted" style="margin-bottom:16px">María Fernández Solís · maria.f@correo.cr</p>
<ul class="hub">
<li><a href="pedidos.html"><b>Sus pedidos</b><span>3 pedidos. El último llega el viernes 27 de noviembre.</span>{ICON["derecha"]}</a></li>
<li><a href="#dir"><b>Direcciones</b><span>San Pedro, Montes de Oca (principal)</span>{ICON["derecha"]}</a></li>
<li><a href="#avisos"><b>Avisos</b><span>Correo sí, WhatsApp no</span>{ICON["derecha"]}</a></li>
<li><a href="#seg"><b>Contraseña y seguridad</b><span>Cambiada el 2 de noviembre de 2026</span>{ICON["derecha"]}</a></li>
<li><a href="ayuda.html"><b>Ayuda</b><span>Entregas, devoluciones, medios de pago</span>{ICON["derecha"]}</a></li></ul>
<section class="sec" id="avisos" style="margin-top:24px" aria-labelledby="av"><h2 class="t-section" id="av">Avisos</h2>
<p class="muted" style="margin:4px 0 12px">Siempre le avisamos de sus pedidos por correo. Lo demás lo decide usted.</p>
<form class="stack" style="--g:4px"><div class="notice ok" role="status" tabindex="-1">{ICON["check"]}<div><b>Guardamos sus avisos.</b>Le escribimos solo por correo. <span class="muted">(Así aparece el resultado de guardar: arriba del formulario, y el foco pasa aquí.)</span></div></div><fieldset class="plain"><legend class="sr">Canales</legend>
<label class="check"><span class="box"></span>Avisos del pedido también por WhatsApp</label>
<label class="check"><span class="box"></span>Ofertas de vendedores costarricenses, una vez por semana como máximo</label></fieldset>
<p class="t-small muted">Las casillas empiezan sin marcar. Puede cambiar esto cuando quiera.</p>
<div class="row" style="margin-top:8px"><button class="btn">Guardar avisos</button></div></form></section>
<section class="sec" aria-labelledby="el"><h2 class="t-section" id="el">Eliminar su cuenta</h2><p style="margin:4px 0 12px">Borramos sus datos personales. Las facturas se guardan 5 años porque la ley lo pide.</p>
<a class="btn btn-outline" href="avisos.html#eliminar">Eliminar mi cuenta</a></section></main>''' + footer() + '</body></html>'
    page('cuenta.html', body, template='T11 Su cuenta y ajustes (menú de cuenta)', app='web')


def zona():
    body = head('Elija su zona, Yuntera') + shop_header() + f'''<main class="wrap narrow" style="padding:24px 16px 32px">
<form class="stack" style="--g:24px" aria-labelledby="zt"><h1 class="t-title" id="zt">¿Dónde le entregamos?</h1>
<p class="muted">Con su distrito le decimos la fecha exacta y el costo del envío.</p>
<div class="field"><label for="dist">Distrito</label><span class="hint" id="dh2">Escriba el nombre del distrito o del cantón.</span>
<input id="dist" class="input" value="San Pedro" aria-describedby="dh2" autocomplete="off"></div>
<fieldset class="plain"><legend class="label" style="font:600 15px/20px var(--yt-font-text)">Coincidencias</legend>
<label class="choice on"><span class="check radio on"><span class="box"></span></span><span><b>San Pedro, Montes de Oca, San José</b><p>Entregamos al día siguiente si pide antes de las 2 p. m.</p></span></label>
<label class="choice"><span class="check radio"><span class="box"></span></span><span><b>San Pedro, Barva, Heredia</b><p>Entregamos al día siguiente si pide antes de las 2 p. m.</p></span></label>
<label class="choice"><span class="check radio"><span class="box"></span></span><span><b>San Pedro, Pérez Zeledón, San José</b><p>Todavía no entregamos ahí. Le avisamos cuando empecemos, si quiere.</p></span></label></fieldset>
<button class="btn btn-block">Guardar San Pedro, Montes de Oca</button></form></main>''' + footer() + '</body></html>'
    page('zona.html', body, template='T12 Una pregunta (zona)', app='web')


def ingresar():
    body = head('Ingresar, Yuntera') + closed_header('home.html', 'Volver a la tienda') + f'''<main class="wrap"><div class="auth">
<form class="stack" style="--g:16px" aria-labelledby="in"><h1 class="t-title" id="in">Ingresar</h1>
<div class="field"><label for="em">Correo</label><input id="em" class="input" type="email" autocomplete="email" value="maria.f@correo.cr"></div>
<div class="field"><label for="pw">Contraseña</label><div class="row" style="--g:8px;flex-wrap:nowrap"><input id="pw" class="input" type="password" autocomplete="current-password" value="contraseña"><button type="button" class="btn btn-outline btn-sm" aria-pressed="false">Mostrar</button></div></div>
<button class="btn btn-block">Ingresar</button><a class="link44" href="#rec">¿Olvidó su contraseña?</a></form>
<section class="stack" style="--g:12px;border-top:2px solid var(--yt-ink);padding-top:16px" aria-labelledby="nu"><h2 class="t-section" id="nu">¿Primera vez en Yuntera?</h2>
<p>Con una cuenta sigue sus pedidos, guarda su dirección y recibe su código de entrega.</p><a class="btn btn-outline" href="#">Crear una cuenta</a></section></div>
<p class="frame-cap">Estado siguiente: segundo paso <span>(verificar)</span></p>
<form class="stack narrow" style="--g:16px;padding:24px 0 32px" aria-labelledby="vf"><h1 class="t-title" id="vf">Escriba el código que le enviamos</h1>
<p>Lo enviamos a maria.f@correo.cr. Vence en 10 minutos.</p>
<div class="field"><label for="otp">Código de 6 números</label><input id="otp" class="input code-in" inputmode="numeric" autocomplete="one-time-code" maxlength="6" value="4815" style="max-width:260px"></div>
<button class="btn btn-block">Verificar</button><button class="link-btn" style="align-self:flex-start">Enviar otro código</button></form></main></body></html>'''
    page('ingresar.html', body, template='T13 Ingresar y recuperar', app='web')


def avisos():
    def frame(cap, inner):
        return f'<p class="frame-cap">{cap}</p><div class="wrap notice-page">{inner}</div>'
    body = head('Avisos de página, Yuntera') + shop_header() + '<main>' + frame('No encontrado <span>(not-found.tsx)</span>', f'''{mark_err(64)}
<h1 class="t-title">No encontramos esta página</h1><p>Puede que el enlace esté incompleto o que el producto ya no se venda.</p>
<div class="row"><a class="btn" href="home.html">Ir al inicio</a><a class="btn btn-outline" href="lista.html">Buscar en Electrodomésticos</a></div>''') + frame('Algo falló <span>(error.tsx)</span>', f'''{mark_err(64)}
<h1 class="t-title">No pudimos cargar esta página</h1><p>No es culpa suya. Si estaba pagando, no le cobramos dos veces: revise el pedido antes de volver a pagar.</p>
<div class="row"><button class="btn">Intentar otra vez</button><a class="btn btn-outline" href="pedidos.html">Ver sus pedidos</a></div>''') + frame('Sin conexión', f'''<div class="notice offline">{ICON["sin-red"]}<div><b>Está sin conexión.</b>Lo que ve es de las 9:42 a. m. Al volver la señal, lo actualizamos solo.</div></div>''') + '<div id="eliminar"></div>' + frame('Confirmar una acción que no se deshace <span>(cuenta/eliminar)</span>', f'''
<h1 class="t-title">¿Eliminar su cuenta?</h1>
<p>Esto borra su nombre, sus direcciones y su historial de compras. No se puede deshacer.</p>
<ul style="margin:0;padding-left:24px"><li>Su pedido YT-100018 sigue en camino y le llega igual.</li><li>Las facturas se guardan 5 años porque la ley lo pide.</li></ul>
<div class="field"><label for="cf">Para confirmar, escriba la palabra eliminar</label><input id="cf" class="input" autocomplete="off"></div>
<div class="row"><button class="btn btn-danger">Eliminar mi cuenta para siempre</button><a class="btn btn-outline" href="cuenta.html">No, volver a mi cuenta</a></div>''') + frame('Hecho <span>(cuenta-eliminada)</span>', f'''<div class="notice ok">{ICON["check"]}<div><b>Eliminamos su cuenta.</b>Le enviamos una confirmación a maria.f@correo.cr.</div></div>
<a class="btn btn-outline" href="home.html" style="align-self:flex-start">Ir a la tienda</a>''') + frame('Sin acceso <span>(sin-acceso, apps de trabajo)</span>', f'''{mark_err(64)}
<h1 class="t-title">Esta sección es para el equipo de pagos</h1><p>Su cuenta es de Operación. Si necesita entrar, pídale acceso a Laura Quesada.</p><a class="btn btn-outline" href="consola.html" style="align-self:flex-start">Volver a Pedidos</a>''') + '</main>' + footer() + '</body></html>'
    page('avisos.html', body, template='T14 Avisos: no encontrado, error, sin conexión, confirmación destructiva, hecho, sin acceso', app='web')


def ayuda():
    body = head('Ayuda, Yuntera') + shop_header() + f'''<main class="wrap" style="padding-bottom:24px"><div style="display:grid;gap:32px;grid-template-columns:minmax(0,1fr)" class="help-grid">
<div><h1 class="t-title" style="padding:24px 0 8px">Ayuda</h1><p class="muted">Respondemos por WhatsApp de lunes a sábado, de 8 a. m. a 6 p. m. WhatsApp: [número por definir]</p>
<nav class="toc" aria-label="En esta página" style="margin-top:16px"><a href="#e">Entregas y zonas</a><br><a href="#d">Devoluciones y garantía</a><br><a href="#p">Medios de pago</a><br><a href="#r">Presentar un reclamo</a></nav></div>
<div class="prose"><h2 id="e">Entregas y zonas</h2><p>Entregamos en el Gran Área Metropolitana al día siguiente si pide antes de las 2 p. m. Lo llevan nuestros propios repartidores. El envío cuesta {col(1500)} y es gratis desde {col(25000)}.</p>
<p>Al recibir, dígale al repartidor su código de entrega de 4 números. Nadie de Yuntera se lo va a pedir por teléfono ni por mensaje.</p>
<h2 id="d">Devoluciones y garantía</h2><p>Tiene 8 días hábiles desde que recibe para devolver un producto, sin dar explicaciones. La garantía la da el vendedor; el plazo está en la página de cada producto.</p>
<h2 id="p">Medios de pago</h2><p>SINPE Móvil, tarjeta o efectivo cuando recibe. Si paga en efectivo y no tiene el monto exacto, el repartidor le da el vuelto.</p>
<h2 id="r">Presentar un reclamo</h2><p>Escríbanos con el número de su pedido. Le respondemos en 1 día hábil y le decimos qué sigue.</p><p><a class="btn btn-outline" href="ayuda.html#r">Presentar un reclamo</a></p></div></div></main>''' + footer() + '</body></html>'
    page('ayuda.html', body.replace('class="help-grid"', 'class="help-grid"'), template='T15 Ayuda y textos legales', app='web')


CSS_EXTRA = '@media (min-width:900px){.help-grid{grid-template-columns:280px minmax(0,1fr)!important}}'

if __name__ == '__main__':
    home(); lista(); tienda(); producto(); sugerencias(); carrito(); pago(); pedido(); pedidos(); comprobante(); cuenta(); zona(); ingresar(); avisos(); ayuda()
