"""Seller centre (apps/seller), staff console (apps/ops), driver and warehouse
web app (apps/field): T6–T12, T16, T17, plus the console navigation."""
from common import *
from shop import comprobante, fiscal_doc, cents

OPS_GROUPS = [
    ('Hoy', [('Resumen', 'central-resumen.html'), ('Pedidos', 'consola.html'), ('Atención', 'central-atencion.html'), ('Mensajes', None)]),
    ('Entrega', [('Despacho', None), ('Operación', 'central-feriados.html'), ('Repartidores', None), ('Bodegas', None), ('Liquidaciones', None)]),
    ('Catálogo', [('Catálogo', 'central-catalogo.html'), ('Ofertas en pausa', None)]),
    ('Vendedores', [('Vendedores', None), ('Cambios de tienda', None)]),
    ('Dinero', [('Cobros', None), ('Pagos a vendedores', None), ('Comprobantes', None)]),
    ('Administración', [('Personal', None), ('Auditoría', None), ('Seguridad', None)]),
]
SUBNAV = {
    'Catálogo': ['Productos por revisar', 'Corregir un producto', 'Categorías', 'Marcas', 'Búsqueda', 'Reseñas', 'Retirar fotos', 'Logotipos'],
    'Operación': ['Zonas de entrega', 'Distritos', 'Feriados', 'Cierres de zona', 'Ubicaciones de bodega', 'Rutas detenidas', 'Ajustes de la plataforma'],
    'Cobros': ['Día y pagos', 'Por revisar', 'Reembolsos', 'Modo y comisiones'],
}
COUNTS = {'Atención': 2, 'Despacho': 1, 'Catálogo': 3, 'Vendedores': 1}
SELLER_NAV = [('Resumen', 'vende-inicio.html', 'grafico'), ('Productos', 'vende-productos.html', 'etiqueta'), ('Tienda', None, 'tienda'),
              ('Inventario', None, 'estante'), ('Pedidos', None, 'caja'), ('Pagos', None, 'moneda'), ('Equipo', 'vende-invitaciones.html', 'equipo'), ('Cuenta', None, 'persona')]


def ops_side(cur, sub=None):
    nav = ''
    for g, items in OPS_GROUPS:
        nav += f'<h2>{g}</h2>'
        for name, href in items:
            n = f'<span class="n" aria-label="{COUNTS[name]} por atender">{COUNTS[name]}</span>' if name in COUNTS else ''
            ac = ' aria-current="page"' if name == cur and not sub else (' aria-current="true"' if name == cur else '')
            nav += f'<a href="{href or "#"}"{ac}>{name}{n}</a>'
            if name == cur and name in SUBNAV:
                nav += '<div class="subnav">' + ''.join(f'<a href="#"{" aria-current=page" if s == sub else ""}>{s}</a>' for s in SUBNAV[name]) + '</div>'
    return nav


def shell(app, desc, mark, nav, who, main, cur_title):
    """The one back-office web shell. app = CSS colour var for the bar."""
    return f'''<div class="shell tool" style="--app:var(--yt-app-{app})">
<div class="mtop banda">{lockup(desc, mark, href="#")}<a class="btn btn-ghost-band btn-sm" href="#secciones" aria-controls="secciones">{ICON["menu"]} Secciones</a></div>
<aside class="side banda" id="secciones" aria-label="Secciones"><a class="btn btn-ghost-band btn-sm close" href="#">{ICON["cerrar"]} Cerrar</a>{lockup(desc, mark, href="#")}
<p class="who">{who}</p><nav aria-label="Secciones de {desc}">{nav}</nav>
<div class="foot"><a href="#">Su cuenta</a> · <a href="#">Salir</a></div></aside><a class="drawer-scrim" href="#" aria-hidden="true" tabindex="-1"></a>
<main class="main">{main}</main></div>'''


def ops(name, title, cur, main, template, sub=None, widths=(1280, 390)):
    body = head(f'{title}, yuntera central') + shell('ops', 'central', 'mark-cal.svg', ops_side(cur, sub), 'Laura Quesada · Operación', main, title) + '</body></html>'
    page(name, body, template=template, app='ops', widths=widths)


def seller(name, title, cur, main, template, widths=(1280, 390)):
    nav = ''.join(f'<a href="{h or "#"}"{" aria-current=page" if n == cur else ""}>{n}{"<span class=n aria-label=\'1 por empacar\'>1</span>" if n == "Pedidos" else ""}</a>' for n, h, _ in SELLER_NAV)
    who = 'Ferretería El Higuerón<br><a href="#" style="color:inherit;display:inline-flex;min-height:44px;align-items:center">Cambiar de tienda</a>'
    body = head(f'{title}, yuntera vende') + shell('seller', 'vende', 'mark-cal.svg', nav, who, main, title) + '</body></html>'
    page(name, body, template=template, app='seller', widths=widths)


# ------------------------------------------------------------------ console
# name (staff list: first name + initial), district, order, placed (day, time), arrives (day), parcels, payment, status, total
ORDERS = [
    ('Sofía R.', 'Heredia, Central', 'YT-100031', (24, '8:12 a. m.'), 25, '2', ('SINPE Móvil', 'ok', 'Pagado'), ('Por preparar', ''), 41800),
    ('Andrés M.', 'San Pedro, Montes de Oca', 'YT-100030', (24, '7:55 a. m.'), 25, '1', ('Efectivo', '', 'Al entregar'), ('Por preparar', ''), 21900),
    ('María F.', 'San Pedro, Montes de Oca', 'YT-100018', (23, '6:33 p. m.'), 27, '2', ('SINPE Móvil', 'ok', 'Pagado'), ('Preparando', 'half'), 29400),
    ('Luis C.', 'Escazú, San Rafael', 'YT-100028', (23, '4:10 p. m.'), 24, '1', ('Tarjeta', 'ok', 'Pagado'), ('En camino', 'half solid'), 8900),
    ('Jorge A.', 'Tibás, San Juan', 'YT-100026', (23, '11:48 a. m.'), 24, '1', ('SINPE Móvil', 'warn', 'Esperando el pago'), ('Por atender', 'warn'), 12900),
    ('Karla P.', 'Moravia, San Vicente', 'YT-100025', (23, '9:30 a. m.'), 24, '1', ('Efectivo', 'ok', 'Cobrado'), ('Entregado', 'ok'), 26500),
    ('Valeria S.', 'Alajuela, Central', 'YT-100023', (22, '5:40 p. m.'), 23, '1', ('Tarjeta', 'err', 'Pago rechazado'), ('Cancelado', 'ended'), 9900),
]


def consola():
    rows = ''
    for k, (n, d, o, (pd, pt), dl, pk, pay, st, tot) in enumerate(ORDERS):
        sel = k in (0, 1)
        stamp = f'<span class="tag {st[1]}">{st[0]}</span>'
        rows += f'''<tr class="{"sel" if sel else ""}"><td><label class="check{" on" if sel else ""}"><span class="box"></span><span class="sr">Elegir {o}</span></label></td>
<td class="person"><a class="who-link" href="central-pedido.html"><b>{n}</b><span><span class="nowrap">{o}</span> · {d}</span></a><span class="m-only">{stamp}<span class="tot">{col(tot)}</span></span></td>
<td class="estado m-hide">{stamp}<br><span class="t-small muted">{pay[0]} · {pay[2].lower()}</span></td><td class="money m-hide">{col(tot)}</td>
<td>{when_word(pd)}, {pt}</td><td>{when_word(dl)}</td></tr>'''
    th = lambda t, s=False, cls='': f'<th class="{cls}"{" aria-sort=descending" if s else ""}><button type="button">{t}{ICON["abajo"] if s else ""}{"<span class=sr>, del más reciente al más antiguo</span>" if s else ""}</button></th>'
    main = f'''<div class="pagehead"><div><h1 class="t-section">Pedidos</h1><p>Martes 24 de noviembre. 3 pedidos por preparar antes del corte de las 2 p. m.</p></div></div>
<nav class="tabs-row" aria-label="Vistas guardadas" style="margin-top:8px"><a href="#" aria-current="page">Todos <span class="n">(214)</span></a><a href="#">Por atender <span class="n">(2)</span></a><a href="#">Para hoy <span class="n">(3)</span></a><a href="#">Esperando el pago <span class="n">(1)</span></a><a href="#">Entregados <span class="n">(186)</span></a></nav>
<form class="filters-row"><div class="field"><label for="b">Buscar por cliente o pedido</label><input id="b" class="input" placeholder="Ej.: Chaves o YT-100025"></div>
<div class="field"><label for="z">Zona</label><select id="z" class="select"><option>Todo el GAM</option></select></div>
<div class="two" style="display:contents"><div class="field"><label for="f1">Desde <span class="muted">(dd/mm/aaaa)</span></label><input id="f1" class="input" value="23/11/2026" inputmode="numeric"></div>
<div class="field"><label for="f2">Hasta <span class="muted">(dd/mm/aaaa)</span></label><input id="f2" class="input" value="24/11/2026" inputmode="numeric"></div></div>
<button class="btn btn-sm" type="submit">Buscar</button></form>
<div class="detail"><div>
<div class="bulk banda" role="region" aria-label="Acciones para los elegidos"><b>2 pedidos elegidos</b>
<button class="btn btn-on-band btn-sm">Imprimir etiquetas</button><button class="btn btn-ghost-band btn-sm">Agregar a una ruta</button>
<button class="link-btn">Quitar la selección</button></div>
<p class="t-small muted mob-only" style="margin-top:12px">Se ven el cliente, su estado y el total. Toque un nombre para ver el pedido completo; deslice la tabla para ver las fechas.</p>
<div class="tbl-shell cut" style="margin-top:12px"><div class="tbl-wrap"><table class="t freeze"><caption class="sr">Pedidos, del más reciente al más antiguo</caption><thead><tr><th style="width:52px"><label class="check"><span class="box"></span><span class="sr">Elegir todos</span></label></th>
{th("Cliente y pedido")}{th("Estado y pago", cls="m-hide")}{th("Total", cls="money m-hide")}{th("Realizado", True)}{th("Llega")}</tr></thead>
<tbody>{rows}</tbody></table></div><span class="cutshade" aria-hidden="true"></span></div>
<nav class="pager-t" aria-label="Páginas de pedidos"><p>Mostrando 1–7 de 214 pedidos. Página 1 de 31.</p>
<div class="row" style="--g:8px"><span class="btn btn-outline btn-sm is-disabled" aria-disabled="true">{ICON["izquierda"]} Anterior</span><a class="btn btn-outline btn-sm" href="#">Siguiente {ICON["derecha"]}</a>
<form class="row" style="--g:8px;flex-wrap:nowrap"><label for="pg" class="label">Ir a la página</label><input id="pg" class="input" inputmode="numeric" style="width:72px;min-height:44px"><button class="btn btn-outline btn-sm">Ir</button></form></div></nav></div>
<aside class="side-panel desk-only" aria-labelledby="dp"><h2 class="t-section" id="dp">Jorge A.</h2><p class="row" style="--g:8px"><span class="muted">YT-100026</span><span class="tag warn">Por atender</span></p>
<p><b>Falta el pago por SINPE Móvil.</b> Lo esperamos hasta las 2 p. m.; después se cancela solo.</p>
<dl class="facts"><dt>Llega</dt><dd>hoy</dd><dt>Distrito</dt><dd>Tibás, San Juan</dd><dt>Total</dt><dd>{col(12900)}</dd><dt>Código</dt><dd>Solo lo ve el cliente.</dd></dl>
<a class="btn btn-sm" href="central-pedido.html">Abrir el pedido</a>
<h3 class="t-h3" style="margin-top:8px">Últimos cambios</h3><ul class="audit"><li>El sistema creó el pedido YT-100026 por {col(12900)} con pago por SINPE Móvil.<time>ayer, 11:48 a. m.</time></li>
<li>Laura Quesada le escribió a Jorge A. por WhatsApp: «Su pago aún no llega».<time>hoy, 8:05 a. m.</time></li></ul>
<div class="danger-zone"><h3 class="t-h3">Cancelar el pedido</h3><p class="t-small">Se avisa al cliente. No hay cobro que devolver. Pide el motivo y una confirmación.</p><a class="btn btn-danger btn-sm" href="confirmar.html#personal">Cancelar el pedido YT-100026</a></div></aside></div>'''
    ops('consola.html', 'Pedidos', 'Pedidos', main, 'T7 Tabla con filtros, vistas, barra de selección, paginador y panel de detalle (consola)', widths=(1280, 1024, 390))


def central_resumen():
    main = f'''<div class="pagehead"><div><h1 class="t-section">Resumen</h1><p>Martes 24 de noviembre, 10:05 a. m. Corte de pedidos a las 2 p. m.</p></div></div>
<div class="dash" style="margin-top:16px"><section aria-labelledby="pa"><h2 class="t-h3" id="pa" style="margin-bottom:8px">Por atender, lo más urgente primero</h2><ul class="tasks">
<li class="task"><div><span class="tag warn">Por atender</span><p style="font-weight:600;margin-top:8px">Pedidos esperando el pago</p><p class="t-small muted">Se cancelan solos a las 2 p. m.</p><a href="consola.html">Ver los pedidos</a></div><span class="cnt t-count">1</span></li>
<li class="task"><div><p style="font-weight:600">Reclamos por responder</p><p class="t-small muted">El más viejo llegó hace 5 horas.</p><a href="central-atencion.html">Abrir Atención</a></div><span class="cnt t-count">2</span></li>
<li class="task"><div><p style="font-weight:600">Paquetes sin ruta para mañana</p><a href="#">Abrir Despacho</a></div><span class="cnt t-count">1</span></li>
<li class="task zero"><span>Mensajes detenidos</span><span class="cnt t-count">0</span></li><li class="task zero"><span>Rutas detenidas</span><span class="cnt t-count">0</span></li><li class="task zero"><span>Comprobantes rechazados</span><span class="cnt t-count">0</span></li></ul></section>
<section aria-labelledby="hy"><h2 class="t-h3" id="hy" style="margin-bottom:8px">Hoy hasta ahora</h2>
<div class="kv"><span>Pedidos nuevos</span><span class="t-price">12</span></div><div class="kv"><span>Ventas (precio pagado)</span><span class="t-price">{col(318400)}</span></div>
<div class="kv"><span>Entregados de 18 en ruta</span><span class="t-price">7</span></div><div class="kv"><span>Efectivo por liquidar</span><span class="t-price">{col(48300)}</span></div>
<p class="t-small muted" style="margin-top:8px">Cifras de hoy desde las 12:00 a. m. Se actualizan al abrir la página.</p></section></div>'''
    ops('central-resumen.html', 'Resumen', 'Resumen', main, 'T6 Tablero de tareas (consola)')


def central_catalogo():
    items = [('Reseña', 'resenas', '«Llegó rayado y el vendedor no contesta.»', 'Reseña de 1 de 5 de Andrés M. sobre Olla arrocera Volcán 1,8 L. Menciona un problema de entrega.', 'olla', 'Publicar', 'No publicar'),
             ('Foto nueva', 'fotos', 'Foto 2 de Licuadora Volcán 600 W', 'TecnoCasa la subió el lunes 23 a las 4:12 p. m. Tiene texto encima: las reglas no lo permiten.', 'licuadora', 'Aprobar foto', 'Rechazar foto'),
             ('Logotipo', 'logos', 'Logotipo nuevo de Ferretería El Higuerón', 'Reemplaza la inicial «F». Revise que se lea a 48 px y que no copie una marca conocida.', None, 'Aprobar logotipo', 'Rechazar logotipo')]
    li = ''
    for kind, _, title, why, img, ok, no in items:
        ph = f'<div class="ph"><img src="img/{img}.svg" alt=""></div>' if img else '<div class="ph" style="display:grid;place-items:center"><span class="mono" style="width:64px;height:64px;font-size:30px">H</span></div>'
        li += f'''<li class="qitem">{ph}<div><p class="t-small muted">{kind} · espera desde ayer</p><p class="why">{title}</p><p class="t-small">{why}</p></div>
<form class="acts"><button class="btn btn-sm" type="button">{ok}</button><div class="field"><label for="m{kind}">Motivo, si lo rechaza</label><input id="m{kind}" class="input"></div><button class="btn btn-outline btn-sm" type="button">{no}</button></form></li>'''
    main = f'''<div class="pagehead"><div><h1 class="t-section">Productos por revisar</h1><p>3 por decidir. Lo que decida se avisa al vendedor con su motivo.</p></div></div>
<ul class="queue" style="margin-top:8px">{li}</ul><div class="empty" style="border-top:1px solid var(--yt-rule)">{ICON["check"].replace('class="ico"', 'class="ico pic" style="width:40px;height:40px"')}<h2>Cuando termine, aquí no queda nada</h2><p class="t-small muted">Las decisiones quedan en Auditoría con su nombre.</p></div>'''
    ops('central-catalogo.html', 'Productos por revisar', 'Catálogo', main, 'T8 Cola de cosas por decidir (consola, con subsecciones de Catálogo)', sub='Productos por revisar')


def central_atencion():
    """Atención: complaints and returns (T8), the queue the inventory calls Atención."""
    main = f'''<div class="pagehead"><div><h1 class="t-section">Atención</h1><p>2 por decidir. El más viejo llegó hace 5 horas. Lo que decida se avisa al cliente y al vendedor.</p></div></div>
<ul class="queue" style="margin-top:8px">
<li class="qitem"><div class="ph"><img src="img/licuadora.svg" alt="Foto que envió la clienta: el vaso de la licuadora con una grieta"></div><div><p class="t-small muted">Devolución · espera desde hoy, 5:10 a. m.</p><p class="why">Karla P. pide devolver la Licuadora Volcán 600 W: «El vaso llegó con una grieta.»</p>
<p class="t-small">Pedido YT-100025, entregado ayer. Vendido por TecnoCasa. Está dentro de los 8 días hábiles. Si la aprueba, le devolvemos {col(26500)} por SINPE Móvil cuando el repartidor recoja el producto.</p></div>
<form class="acts"><button class="btn btn-sm" type="button">Aprobar la devolución de {col(26500)}</button><div class="field"><label for="mdev">Motivo, si la rechaza</label><input id="mdev" class="input"></div><button class="btn btn-outline btn-sm" type="button">Rechazar la devolución</button></form></li>
<li class="qitem"><div class="ph" style="display:grid;place-items:center">{ICON["chat"].replace('class="ico"', 'class="ico" style="width:40px;height:40px"')}</div><div><p class="t-small muted">Reclamo · espera desde ayer, 4:30 p. m.</p><p class="why">Andrés M.: «El repartidor dejó el paquete con el guarda sin preguntarme.»</p>
<p class="t-small">Pedido YT-100030. Ruta 3, repartidor Diego Rojas. El código de entrega se registró a las 2:14 p. m.</p></div>
<form class="acts"><div class="field"><label for="mrec">Su respuesta al cliente</label><textarea id="mrec" class="textarea"></textarea></div><button class="btn btn-sm" type="button">Enviar la respuesta y cerrar</button><button class="btn btn-outline btn-sm" type="button">Pasarlo a Operación</button></form></li></ul>'''
    ops('central-atencion.html', 'Atención', 'Atención', main, 'T8 Cola por decidir: devoluciones y reclamos (consola)')


def central_pedido():
    main = f'''<nav class="crumbs" aria-label="Ruta"><a href="consola.html">Pedidos</a> / <span aria-current="page">YT-100018</span></nav>
<div class="pagehead"><div><div class="row" style="--g:8px"><h1 class="t-section">Pedido YT-100018</h1><span class="tag half">Preparando</span></div><p>María Fernández Solís · San Pedro, Montes de Oca · realizado ayer, 6:33 p. m.</p></div></div>
<div class="detail" style="margin-top:24px"><div class="stack" style="--g:24px">
<section aria-labelledby="ln"><h2 class="t-h3" id="ln" style="margin-bottom:12px">Dónde va</h2>{linea(TRACK_OPS, "track")}</section>
<section aria-labelledby="dt"><h2 class="t-h3" id="dt" style="margin-bottom:8px">Datos</h2><dl class="facts"><dt>Cliente</dt><dd>María Fernández Solís · 8888 1234</dd><dt>Distrito</dt><dd>San Pedro, Montes de Oca</dd><dt>Llega</dt><dd>viernes 27</dd><dt>Pago</dt><dd>SINPE Móvil · <span class="tag ok">Pagado</span></dd><dt>Código de entrega</dt><dd>Solo lo ve el cliente.</dd></dl></section>
<section aria-labelledby="pq"><h2 class="t-h3" id="pq" style="margin-bottom:8px">Paquetes</h2>
<div class="tbl-wrap cards"><table class="t cards"><thead><tr><th>Paquete</th><th>Vendedor</th><th>Ubicación</th><th>Estado</th></tr></thead><tbody>
<tr><td class="lead"><b class="mono-code">YT500019</b> · 1 bulto</td><td data-label="Vendedor:">Tienda Sendero</td><td data-label="Ubicación:">Llega del vendedor el jueves 26</td><td data-label="Estado:"><span class="tag">Por preparar</span></td></tr>
<tr><td class="lead"><b class="mono-code">YT500018</b> · 1 bulto</td><td data-label="Vendedor:">Cafetal Los Santos</td><td data-label="Ubicación:">A-02-02-A</td><td data-label="Estado:"><span class="tag half">Preparando</span></td></tr></tbody></table></div></section>
<section aria-labelledby="di"><h2 class="t-h3" id="di" style="margin-bottom:8px">Dinero</h2><dl class="facts"><dt>Productos</dt><dd>{col(29400)}</dd><dt>Envío</dt><dd>Gratis</dd><dt>Comisión Yuntera, con IVA</dt><dd>{col(3986, 64)}</dd><dt>A los vendedores</dt><dd>{col(25413, 36)}, en el pago del lunes 30</dd></dl></section>
<section aria-labelledby="au"><h2 class="t-h3" id="au" style="margin-bottom:8px">Historial</h2><ul class="audit">
<li>El sistema registró el pago de {col(29400)} por SINPE Móvil.<time>ayer, 6:33 p. m.</time></li>
<li>Pablo Mora asignó el paquete YT500018 a la ubicación A-02-02-A.<time>hoy, 8:05 a. m.</time></li>
<li>Laura Quesada cambió el estado de «Pedido confirmado» a «Preparando».<time>hoy, 9:42 a. m.</time></li></ul>
<p class="t-small muted" style="margin-top:8px">Cifras de ejemplo. La comisión sale de la tabla de tarifas, no de este dibujo.</p></section></div>
<aside class="side-panel" aria-label="Acciones"><h2 class="t-h3">Acciones</h2><button class="btn btn-block">Imprimir etiquetas de 2 paquetes</button><button class="btn btn-outline btn-block">Escribir a María Fernández</button><button class="btn btn-outline btn-block">Cambiar la fecha de entrega</button>
<div class="danger-zone"><h3 class="t-h3">Cancelar el pedido</h3><p class="t-small">Le devolvemos {col(29400)} a María Fernández por SINPE Móvil y avisamos a los 2 vendedores. Pide el motivo y una confirmación.</p><a class="btn btn-danger btn-block" href="confirmar.html#personal">Cancelar el pedido YT-100018</a></div></aside></div>'''
    ops('central-pedido.html', 'Pedido YT-100018', 'Pedidos', main, 'T9 Página de detalle con acciones (estructura del pedido de A)')


TRACK_OPS = [('done', 'Hecho', 'Confirmado', 'ayer, 6:33 p. m.'), ('now', 'Ahora', 'Preparando', 'desde 9:42 a. m.'), ('next', 'Falta', 'En camino', 'viernes 27'), ('next', 'Falta', 'Entregado', 'viernes 27')]


def central_feriados():
    hol = [('jueves 25 de diciembre de 2026', 'Navidad', 'Todo el país'), ('jueves 1 de enero de 2027', 'Año Nuevo', 'Todo el país'), ('jueves 25 de marzo de 2027', 'Jueves Santo', 'Todo el país')]
    li = ''.join(f'<li><div><b>{d}</b><p class="t-small muted">{n} · {z} · no entregamos ni recogemos</p></div><div class="row" style="--g:8px"><button class="btn btn-outline btn-sm">Editar</button><button class="btn btn-outline btn-sm">Quitar {n}</button></div></li>' for d, n, z in hol)
    main = f'''<div class="pagehead"><div><h1 class="t-section">Feriados</h1><p>Días sin entregas. Las fechas prometidas se corren al siguiente día hábil.</p></div></div>
<ul class="setlist" style="margin-top:16px">{li}</ul>
<form class="addrow" aria-labelledby="ag"><h2 class="t-h3 sr" id="ag">Agregar un feriado</h2><div class="field"><label for="fd">Fecha <span class="muted">(dd/mm/aaaa)</span></label><input id="fd" class="input" inputmode="numeric" placeholder="15/09/2027"></div>
<div class="field"><label for="fn">Nombre</label><input id="fn" class="input"></div><button class="btn btn-sm" type="submit">Agregar feriado</button></form>
<p class="t-small muted" style="margin-top:12px">Cada cambio queda en Auditoría con su nombre.</p>'''
    ops('central-feriados.html', 'Feriados', 'Operación', main, 'T11 Ajustes y listas de referencia (consola, subsecciones de Operación)', sub='Feriados')


# ------------------------------------------------------------------ seller centre
def vende_inicio():
    main = f'''<div class="pagehead"><div><h1 class="t-section">Resumen</h1><p>Martes 24 de noviembre. Empaque antes de las 4 p. m. para que lo recojamos hoy.</p></div><a class="btn btn-sm" href="vende-publicar.html">{ICON["mas"]} Publicar un producto</a></div>
<div class="dash" style="margin-top:16px"><section aria-labelledby="pa"><h2 class="t-h3" id="pa" style="margin-bottom:4px">Por atender</h2><p class="muted" style="margin-bottom:8px">Hoy tiene 1 paquete por empacar.</p><ul class="tasks">
<li class="task"><div><span class="tag warn">Por atender</span><p style="font-weight:600;margin-top:8px">Pedidos por empacar</p><p class="t-small muted">Antes de las 4 p. m. de hoy.</p><a href="#">Ver pedidos</a></div><span class="cnt t-count">1</span></li>
<li class="task zero"><span>Productos sin existencias · <a href="#">Ver inventario</a></span><span class="cnt t-count">0</span></li>
<li class="task zero"><span>Productos rechazados · <a href="#">Ver el motivo</a></span><span class="cnt t-count">0</span></li>
<li class="task zero"><span>Devoluciones abiertas</span><span class="cnt t-count">0</span></li></ul></section>
<section aria-labelledby="ul"><h2 class="t-h3" id="ul" style="margin-bottom:8px">Últimos 30 días</h2>
<div class="kv"><span>Ventas<br><span class="t-small muted">Precio pagado por los compradores</span></span><span class="t-price">{col(63300)}</span></div>
<div class="kv"><span>Pedidos</span><span class="t-price">1 <span class="t-small muted" style="font-family:var(--yt-font-text);font-weight:400">(3 unidades)</span></span></div>
<div class="kv"><span>Próximo pago<br><span class="t-small muted">Ventas menos la comisión y su IVA</span></span><span><span class="t-price">{col(54716, 52)}</span><br><span class="t-small muted">lunes 30</span></span></div>
<p class="t-small muted" style="margin-top:8px">Cifras de ejemplo. La comisión sale de la tabla de tarifas.</p></section></div>'''
    seller('vende-inicio.html', 'Resumen', 'Resumen', main, 'T6 Tablero de tareas (centro de vendedores)')


def vende_productos():
    prods = [('Taladro percutor 600 W con maletín', 'TAL-600', 18900, 12, ('Publicado', 'ok'), 'taladro'),
             ('Juego de destornilladores 12 piezas', 'DES-12', 7900, 0, ('Sin existencias', 'warn'), 'generico'),
             ('Cinta métrica 8 m con freno', 'CIN-8', 4500, 31, ('En revisión', 'half'), 'generico'),
             ('Martillo de uña 16 oz mango de fibra', 'MAR-16', 6200, 9, ('Rechazado', 'err'), 'generico')]
    rows = ''.join(f'''<tr><td class="lead"><a class="who-link" href="#"><b>{n}</b><span>{s}</span></a></td><td data-label="Estado:"><span class="tag {c}">{st}</span></td>
<td data-label="Existencias:" class="num-col">{q}</td><td class="money">{col(p)}</td><td class="acts" data-label=""><a class="link44" href="#">Editar<span class="sr"> {n}</span></a></td></tr>''' for n, s, p, q, (st, c), _ in prods).replace('<td data-label="Estado:">', '<td data-label="Estado:" class="estado">')
    main = f'''<div class="pagehead"><div><h1 class="t-section">Productos</h1><p>4 productos. 2 necesitan su atención.</p></div><a class="btn btn-sm" href="vende-publicar.html">{ICON["mas"]} Publicar un producto</a></div>
<form class="filters-row"><div class="field"><label for="q">Buscar por nombre o código</label><input id="q" class="input"></div><div class="field"><label for="e">Estado</label><select id="e" class="select"><option>Todos</option></select></div>
<div class="field"><label for="o">Ordenar por</label><select id="o" class="select"><option>Producto, de la A a la Z</option><option>Producto, de la Z a la A</option><option>Precio, de menor a mayor</option><option>Existencias, de menor a mayor</option></select></div></form>
<div class="tbl-wrap cards"><table class="t cards"><caption class="sr">Sus productos</caption><thead><tr><th><button type="button">Producto {ICON["abajo"]}<span class="sr">, de la A a la Z</span></button></th><th>Estado</th><th>Existencias</th><th class="money">Precio</th><th><span class="sr">Acciones</span></th></tr></thead><tbody>{rows}</tbody></table></div>
<p class="tbl-foot">Página 1 de 1. Ya ve sus 4 productos.</p>'''
    seller('vende-productos.html', 'Productos', 'Productos', main, 'T7 Tabla que se vuelve lista de tarjetas bajo 640 px (centro de vendedores)')


def vende_publicar():
    main = f'''<nav class="crumbs" aria-label="Ruta"><a href="vende-productos.html">Productos</a> / <span aria-current="page">Publicar</span></nav>
<div class="pagehead"><div><h1 class="t-section">Publicar un producto</h1><p>Lo revisamos en 1 día hábil. Le avisamos por correo.</p></div></div>
<form class="lform" style="margin-top:24px">
<div class="errsum" role="alert"><h2>{ICON["alerta"]} Revise 1 dato para publicar</h2><a href="#pr">Precio: Escriba el precio final en colones, con IVA.</a></div>
<section aria-labelledby="s1"><h2 class="t-h3" id="s1">Qué vende</h2>
<div class="field"><label for="nm">Nombre del producto</label><span class="hint">Como lo buscaría un comprador: qué es, marca, tamaño.</span><input id="nm" class="input" value="Taladro percutor 600 W con maletín"></div>
<div class="field"><label for="cat">Categoría</label><select id="cat" class="select"><option>Ferretería y herramientas › Herramientas eléctricas</option></select></div>
<div class="field"><label for="ds">Descripción</label><textarea id="ds" class="textarea">Taladro con percutor para concreto, madera y metal. Incluye maletín y 5 brocas.</textarea></div></section>
<section aria-labelledby="s2"><h2 class="t-h3" id="s2">Fotos</h2><p class="t-small muted">Fondo claro, el producto al centro, sin texto encima. La primera es la portada.</p>
<div class="photo-slots"><div class="filled"><img src="img/generico.svg" alt="Foto 1, portada"></div>
<div class="up" role="status"><span>Subiendo foto 2</span><span class="prog" aria-hidden="true"><i style="width:60%"></i></span><span>60 %</span></div>
<div class="up err" role="alert"><span>{ICON["alerta"]} No se pudo subir la foto 3.</span><button type="button" class="link-btn">Intentar otra vez</button></div>
<button type="button" class="link-btn" style="justify-content:center;text-decoration:none">{ICON["mas"]}<span>Agregar foto</span></button><span>Foto en uso o en la mano (para ver el tamaño)</span></div></section>
<section aria-labelledby="s3"><h2 class="t-h3" id="s3">Precio y existencias</h2><div class="two">
<div class="field error"><label for="pr">Precio final</label><span class="err">{ICON["alerta"]} Escriba el precio final en colones, con IVA.</span><input id="pr" class="input" value="18 900,5" inputmode="numeric"></div>
<div class="field"><label for="ex">Existencias</label><span class="hint">Unidades que tiene listas.</span><input id="ex" class="input" value="12" inputmode="numeric"></div></div>
<p class="t-small">Usted recibe {col(16337, 16)} por unidad: el precio menos la comisión de 12 % ({col(2268)}) y su IVA ({col(294, 84)}). <span class="muted">Cifras de ejemplo; salen de la tabla de tarifas.</span></p></section>
<div class="notice"><span></span><div><b>Antes de publicar</b>Revisamos que el nombre, las fotos y el precio coincidan. Si algo falta, le decimos qué cambiar.</div></div>
<div class="submit-bar"><button class="btn">Enviar a revisión</button><button class="btn btn-outline" type="button">Guardar sin enviar</button></div></form>'''
    main += bar_script('.submit-bar')
    seller('vende-publicar.html', 'Publicar un producto', 'Productos', main, 'T10 Formulario largo con error y barra de envío fija')


def vende_invitaciones():
    main = f'''<div class="pagehead"><div><h1 class="t-section">Equipo</h1><p>Quién puede entrar a Ferretería El Higuerón.</p></div></div>
<h2 class="t-h3" style="margin-top:16px">Invitaciones para usted</h2><ul class="queue"><li class="qitem" style="grid-template-columns:minmax(0,1fr)"><div><p class="why">Tienda Sendero le invita como encargado de pedidos</p><p class="t-small muted">Lo envió Ana Solano el lunes 23 de noviembre. Vence el lunes 30.</p></div>
<div class="row" style="--g:8px"><button class="btn btn-sm">Aceptar la invitación</button><button class="btn btn-outline btn-sm">No aceptar</button></div></li></ul>
<h2 class="t-h3" style="margin-top:24px">Personas en esta tienda</h2><ul class="setlist"><li><div><b>Rodrigo Mena</b><p class="t-small muted">Dueño · todo</p></div><span class="t-small muted">Usted</span></li>
<li><div><b>Paola Vargas</b><p class="t-small muted">Pedidos e inventario</p></div><div class="row" style="--g:8px"><button class="btn btn-outline btn-sm">Cambiar permisos</button><button class="btn btn-outline btn-sm">Quitar a Paola Vargas</button></div></li></ul>
<form class="addrow"><div class="field"><label for="ic">Correo de la persona</label><input id="ic" class="input" type="email"></div><div class="field"><label for="ip">Puede</label><select id="ip" class="select"><option>Pedidos e inventario</option></select></div><button class="btn btn-sm">Enviar invitación</button></form>'''
    seller('vende-invitaciones.html', 'Equipo', 'Equipo', main, 'T8 Cola por decidir + T11 lista de ajustes (centro de vendedores)')


def vende_comprobante():
    # 12 % of 63 300 = 7 596 + IVA 13 % = 987,48 -> 8 583,48 (illustrative; fees come from the fee schedule)
    doc = fiscal_doc('Yuntera', 'pendiente de inscripción', 'San José', [('Receptor', 'Ferretería El Higuerón · cédula jurídica 3-101-000002'), ('Periodo', 'del 1 al 31 de octubre de 2026'), ('Condición', 'Se descontó del pago del lunes 2 de noviembre')],
                     [(1, 'Comisión por ventas de octubre: 12 % de ' + col(63300), '8314100000000', 858348)],
                     'Documento de ejemplo: Yuntera todavía no tiene cédula jurídica. Emitida por Yuntera por el servicio de venta en línea. La comisión sale de la tabla de tarifas.',
                     '00100001010000000077', '50601112600310100000100100001010000000077100000031', date='domingo 1 de noviembre de 2026, 12:05 a. m.')
    main = f'''<nav class="crumbs" aria-label="Ruta"><a href="#">Pagos</a> / <span aria-current="page">Factura de comisión</span></nav><div class="pagehead"><div><h1 class="t-section">Factura de comisión de octubre</h1><p>La emite Yuntera a Ferretería El Higuerón por la comisión de sus ventas. No incluye datos de compradores.</p></div></div><div style="margin-top:16px">{doc}</div>'''
    seller('vende-comprobante.html', 'Factura de comisión', 'Pagos', main, 'T9 Documento fiscal dentro de una herramienta')


# ------------------------------------------------------------------ field web app
def field(name, title, bar, main, template, fixed='', widths=(390,), app='field'):
    body = head(title) + bar + main + fixed + '</body></html>'
    page(name, body, template=template, app=app, widths=widths)


RUTA_BAR = lambda back, h1, back_href='ruta.html': f'<header class="bar ruta banda"><a class="back" href="{back_href}">{ICON["izquierda"]} {back}</a><h1>{h1}</h1></header>'
# drivers see the recipient's name as the shopper wrote it, on the list and on the stop (§4.4)
STOPS = [('done', 'Hecho', 'Karla Pérez Mora', 'Moravia, San Vicente · entregado 8:41 a. m.'), ('now', 'Ahora', 'María Fernández Solís', 'San Pedro, Montes de Oca · cobrar ' + col(23400)),
         ('next', 'Falta', 'Luis Chaves Rojas', 'Escazú, San Rafael'), ('next', 'Falta', 'Daniela Vargas Alfaro', 'Curridabat, Granadilla · 3 bultos')]


def campo():
    main = f'''<header class="bar bodega" style="padding-left:16px">{lockup(None, "mark-noche.svg", href="#")}<div class="end"><a href="#">Cuenta</a><a href="#">Salir</a></div></header>
<main class="wrap" style="padding-top:24px;padding-bottom:32px"><h1 class="t-section" style="margin-bottom:4px">Buenos días, Diego</h1><p class="muted" style="margin-bottom:16px">¿Dónde trabaja hoy?</p>
<div class="chooser"><a href="ruta.html"><img src="assets/icono-ruta.svg" alt=""><b class="t-h3">Ruta</b><span>8 paradas para hoy. Sale de Bodega Central a las 8 a. m.</span>{ICON["derecha"]}</a><a href="bodega-tareas.html"><img src="assets/icono-bodega.svg" alt=""><b class="t-h3">Bodega</b><span>5 paquetes por recoger para la ruta 3.</span>{ICON["derecha"]}</a></div></main>'''
    field('campo.html', 'Ruta o bodega, yuntera', '', main, 'T6 Variante: elegir trabajo (campo, quien tiene los dos papeles)', widths=(390, 1280))


def ruta_lista():
    main = f'''<header class="bar ruta banda" style="padding-left:16px"><h1>Ruta 3 · martes 24 de noviembre</h1><div class="end"><a href="campo.html">Cambiar</a><a href="#">Cuenta</a></div></header>
<main class="screen" style="padding-bottom:48px"><p class="big" style="font-weight:600">1 de 8 entregadas. Siguiente: San Pedro.</p>
<p class="note">Efectivo por cobrar hoy: {col(48300)} en 3 paradas.</p>
<div style="margin-top:24px">{linea(STOPS, "v", wheel_at=1)}</div>
<a class="btn btn-block btn-lg" href="ruta-parada.html" style="margin-top:8px">Abrir la parada 2: María Fernández Solís</a>
<details class="more" style="margin-top:12px"><summary>Ver las 4 paradas restantes</summary><p class="t-small">Paradas 5 a 8: Tibás, Moravia, Guadalupe, San Pedro.</p></details></main>'''
    field('ruta.html', 'Ruta 3, yuntera ruta', '', main, 'T16 Ruta: la línea de paradas, con la rueda en la parada actual')


def ruta_parada():
    main = f'''<main class="screen"><p class="t-small muted">Parada 2 de 8 · paquete <span class="mono-code">YT500011</span> · 1 bulto</p>
<div class="row" style="justify-content:space-between;align-items:flex-start;--g:4px 12px;margin-top:4px"><h2 class="t-title">María Fernández Solís</h2><span class="tag" style="margin-top:4px">Por entregar</span></div>
<p class="lbl">Distrito</p><p class="big">San Pedro, Montes de Oca</p>
<p class="lbl">Señas</p><p class="big" style="font-weight:600">De la Fuente de la Hispanidad 300 metros sur y 50 este, casa esquinera con portón negro</p>
<p class="lbl">Código Plus</p><p class="mono-code t-h3">66XQWWMX+GG</p>
<div class="acts4"><a class="btn btn-outline" href="#">{ICON["ruta"]} Cómo llegar</a><a class="btn btn-outline" href="#">{ICON["mapa"]} Abrir en Waze</a>
<a class="btn btn-outline" href="#">{ICON["llamar"]} Llamar</a><a class="btn btn-outline" href="#">{ICON["chat"]} WhatsApp</a></div>
<div class="cash" role="note"><b>Cobrar {col(23400)} en efectivo</b>
<details class="more"><summary>Más información</summary><p class="t-small">Cobre el monto completo antes de entregar; si le pagan con más, dé el vuelto de su fondo. Si no lo tienen completo, no entregue el paquete y regístrelo abajo.</p></details></div>
<p class="note" style="margin-top:24px">El código de entrega lo dice el cliente al recibir. Usted no lo ve en esta pantalla.</p></main>'''
    fixed = '<div class="fixed"><button class="btn btn-xl">Llegué</button><p class="note" style="text-align:center">Paso 1 de 2. Al tocarlo, avisamos al cliente que usted está afuera.</p></div>'
    field('ruta-parada.html', 'Parada 2, yuntera ruta', RUTA_BAR('Ruta', 'Parada 2 de 8'), main, 'T16 Parada (repartidor)', fixed + bar_script('.fixed'))
    main2 = f'''<main class="screen"><p class="t-small muted">Parada 2 de 8 · paquete <span class="mono-code">YT500011</span> · 1 bulto</p>
<div class="row" style="justify-content:space-between;align-items:flex-start;--g:4px 12px;margin-top:4px"><h2 class="t-title">María Fernández Solís</h2><span class="tag half" style="margin-top:4px">En la puerta</span></div>
<p class="big" style="font-weight:600;margin-top:8px">Casa esquinera con portón negro</p>
<h3 class="t-h3" style="margin-top:24px">Entregar</h3>
<div class="cash" role="note"><b>Cobrar {col(23400)} en efectivo</b><span class="t-small">Cuente el dinero antes de entregar el paquete.</span></div>
<div class="field" style="margin-top:16px"><label for="ef">Efectivo que le entrega el cliente</label><input id="ef" class="input" inputmode="decimal" value="{col(25000)}"></div>
<p aria-live="polite" style="margin-top:8px;font-weight:600">Dé {col(1600)} de vuelto.</p>
<label class="check" style="margin-top:4px"><span class="box"></span>Sí, recibí {col(25000)} y tengo {col(1600)} para el vuelto.</label>
<div class="field" style="margin-top:16px"><label for="nr">Nombre de quien recibe</label><input id="nr" class="input" autocomplete="off"></div>
<div class="field" style="margin-top:16px"><label for="cod" style="font-size:17px;line-height:24px">Código de entrega del cliente</label>
<span class="hint" id="cod-h">4 números. El cliente lo ve en su pedido; pídaselo con el paquete ya en sus manos.</span>
<input id="cod" class="input code-in" inputmode="numeric" autocomplete="off" maxlength="4" aria-describedby="cod-h"></div>
<button class="btn btn-outline btn-block btn-lg" style="margin-top:24px">No pude entregar</button>
<p class="note">Le pedimos el motivo y el paquete vuelve a la bodega. Si no hay señal, el intento fallido se guarda en el teléfono y se envía al volver la señal.</p>
<section aria-labelledby="otros" style="margin-top:32px"><h2 class="t-section" id="otros">Otros estados de esta pantalla</h2>
<p class="frame-cap" style="margin:16px -16px 12px">Después de un código equivocado <span>(testID attempts-notice)</span></p>
<p style="font-weight:600;color:var(--yt-danger)">! El código no coincide. Le quedan 2 intentos de código para este pedido.</p>
<p class="frame-cap" style="margin:24px -16px 12px">Sin señal al tocar «Entregar» <span>(deliver-offline, deliver-retry, deliver-later)</span></p>
<div class="notice warn" role="alert">{ICON["sin-red"]}<div><b>Sin señal: no se pudo revisar el código</b>El código solo se puede revisar en el servidor, así que la entrega necesita señal. No quedó nada guardado. Intente de nuevo, o deje esta parada pendiente y siga con la próxima.</div></div>
<button class="btn btn-block btn-lg" style="margin-top:12px">Intentar de nuevo</button><button class="btn btn-outline btn-block btn-lg" style="margin-top:8px">Dejar pendiente y seguir</button>
<p class="frame-cap" style="margin:24px -16px 12px">Código bloqueado <span>(deliver-locked, deliver-recheck; el campo del código no se muestra)</span></p>
<div class="notice err" role="alert">{ICON["alerta"]}<div><b>Código bloqueado</b>El código de este pedido quedó bloqueado por demasiados intentos. No entregue el paquete. Llame a Central: si lo desbloquean, el cliente verá un código nuevo en su pedido; si no, márquelo como no entregado.</div></div>
<button class="btn btn-outline btn-block btn-lg" style="margin-top:12px">Central ya lo desbloqueó: revisar de nuevo</button>
</section></main>'''
    fixed2 = '<div class="fixed"><button class="btn btn-xl">Entregar</button><p class="note" style="text-align:center">Paso 2 de 2. Si el código no coincide, se lo decimos aquí.</p></div>'
    field('ruta-entregar.html', 'Entregar, yuntera ruta', RUTA_BAR('Ruta', 'Parada 2 de 8'), main2, 'T16 Parada: entregar con el código que dice el cliente', fixed2 + bar_script('.fixed'))


BODEGA_BAR = lambda back, h1: f'<header class="bar bodega"><a class="back" href="bodega-tareas.html">{ICON["izquierda"]} {back}</a><h1>{h1}</h1></header>'


def bodega_tareas():
    main = f'''<header class="bar bodega" style="padding-left:16px"><h1>Bodega Central · martes 24</h1><div class="end"><a href="campo.html">Cambiar</a><a href="#">Cuenta</a></div></header>
<main class="screen" style="padding-bottom:48px"><form class="field scan"><label for="sc0">Escanee o escriba cualquier código</label><div class="row" style="--g:8px;flex-wrap:nowrap"><input id="sc0" class="input" placeholder="Ej.: YT500018" enterkeyhint="search"><button class="btn btn-lg" type="submit">Buscar</button></div>
<span class="hint">Paquetes (YT…), productos y ubicaciones. El lector de mano escribe el código y envía solo.</span></form>
<ul class="tasks" style="margin-top:24px"><li class="task"><div><span class="tag warn">Por atender</span><p style="font-weight:600;margin-top:8px">Recoger para la ruta 3</p><p class="t-small muted">Sale a las 8 a. m. · 5 paquetes</p><a href="bodega.html">Empezar a recoger</a></div><span class="cnt t-count">5</span></li>
<li class="task"><div><p style="font-weight:600">Recibir de vendedores</p><p class="t-small muted">TecnoCasa llega a las 10 a. m.</p><a href="#">Ver lo que llega</a></div><span class="cnt t-count">2</span></li>
<li class="task zero"><span>Devoluciones por revisar</span><span class="cnt t-count">0</span></li><li class="task zero"><span>Conteos pendientes</span><span class="cnt t-count">0</span></li></ul>
<div class="row" style="margin-top:16px"><a class="btn btn-outline btn-lg" href="#">Ubicaciones</a><a class="btn btn-outline btn-lg" href="#">Buscar un producto</a></div></main>'''
    field('bodega-tareas.html', 'Bodega, yuntera bodega', '', main, 'T6 Tablero de la bodega')


def bodega():
    main = f'''<main class="screen" style="padding-bottom:48px"><form class="field scan"><label for="sc">Escanee o escriba cualquier código</label>
<div class="row" style="--g:8px;flex-wrap:nowrap"><input id="sc" class="input" placeholder="Ej.: YT500018" enterkeyhint="search"><button class="btn btn-lg" type="submit">Buscar</button></div>
<span class="hint">Acepta paquetes (YT…), productos y ubicaciones. El lector de mano escribe el código y envía solo.</span></form>
<section class="pick" aria-label="Línea actual"><p class="t-small muted">Línea 2 de 5 · paquete <span class="mono-code">YT500018</span></p>
<p class="lbl" style="margin-top:8px">Ubicación</p><p class="loc t-loc">A-02-02-A</p>
<p class="big" style="font-weight:600">Café molido de altura Tarrazú 340 g</p>
<p class="big" style="font-weight:700;margin-top:8px">Tome 2 unidades</p><p class="note">Quedan 38 en esta ubicación.</p>
<button class="btn btn-block btn-lg" style="margin-top:24px">Ya tomé 2, siguiente línea</button>
<button class="btn btn-outline btn-block" style="margin-top:8px">No está en la ubicación</button></section></main>
<p class="frame-cap">Estado siguiente: lectura rechazada <span>(ocupa la pantalla y hay que confirmarla)</span></p>
<section class="refused banda-peligro" role="alertdialog" aria-labelledby="rt" aria-describedby="rd">{mark_err(96)}
<h2 id="rt" class="t-title">Este no es el producto de esta línea.</h2>
<p id="rd" class="big">Código leído: <b class="mono-code">7 441029 504121</b>. Busque: Café molido de altura Tarrazú 340 g en A-02-02-A.</p>
<button class="btn btn-block btn-xl">Entendido, vuelvo a leer</button></section>
<p class="frame-cap" style="font-weight:400">Fuera de la pantalla: con este estado suenan dos tonos graves y vibran tres pulsos largos. Una lectura aceptada suena con un tono agudo corto y un pulso breve.</p>'''
    field('bodega.html', 'Recoger, yuntera bodega', BODEGA_BAR('Tareas', 'Recoger para la ruta 3'), main, 'T17 Tarea con escáner (bodega) y lectura rechazada')


if __name__ == '__main__':
    consola(); central_resumen(); central_atencion(); central_catalogo(); central_pedido(); central_feriados()
    vende_inicio(); vende_productos(); vende_publicar(); vende_invitaciones(); vende_comprobante()
    campo(); ruta_lista(); ruta_parada(); bodega_tareas(); bodega()
