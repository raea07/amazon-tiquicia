"""sistema.html (the whole system on one sheet), iconos, logotipos, mensajes
(T18), cubrir-logo, the two strip versions, and index.html."""
from common import *
import tokens as T
from shop import CARGADOR

SHEET_CSS = '''
.sheet{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:32px;padding:24px 0 48px;overflow-wrap:break-word}
.blk{grid-column:span 6;border-top:2px solid var(--yt-ink);padding-top:12px;min-width:0}
.blk.w12{grid-column:span 12}.blk.w4{grid-column:span 4}.blk.w8{grid-column:span 8}
.blk > h2{font:700 21px/26px var(--yt-font-title);letter-spacing:-.03em;margin-bottom:12px}
@media (min-width:900px){.blk > h2{font-size:24px;line-height:28px}}
.blk h3{font:600 15px/20px var(--yt-font-text);margin:16px 0 8px}
.spec{display:grid;grid-template-columns:170px minmax(0,1fr);gap:4px 16px;align-items:baseline;border-bottom:1px solid var(--yt-rule);padding:8px 0}
.spec small{color:var(--yt-ink-muted);font-size:13px;line-height:18px;display:block}
.sw{display:grid;grid-template-columns:44px minmax(0,1fr);gap:4px 12px;padding:8px 0;border-bottom:1px solid var(--yt-rule);font-size:14px;line-height:20px}
.sw i{width:44px;height:44px;grid-row:span 2;border:1px solid var(--yt-rule);display:block}
.pairs{width:100%;border-collapse:collapse;font-size:13px;line-height:18px;table-layout:fixed}.pairs td:first-child,.pairs th:first-child{width:46%}.pairs td:first-child{overflow-wrap:anywhere}.pairs th{overflow-wrap:break-word;font-size:13px}@media (max-width:599px){.pairs td:first-child,.pairs th:first-child{width:34%}.pairs td,.pairs th{padding:4px}}
.pairs td,.pairs th{border-bottom:1px solid var(--yt-rule);padding:4px 8px;text-align:left}
.pairs td:nth-child(n+3){text-align:right;font-variant-numeric:tabular-nums}
.states{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:16px 12px;align-items:start}
.states > div{display:flex;flex-direction:column;gap:8px;font-size:13px;line-height:18px;color:var(--yt-ink-muted);min-width:0}
.is-focus{outline:3px solid var(--yt-ring);outline-offset:2px}
.space{display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap}.space i{display:block;background:var(--yt-ink)}
.rad{display:flex;gap:12px;flex-wrap:wrap}.rad div{width:110px;font-size:13px;line-height:18px;text-align:center}.rad span{display:block;height:52px;border:2px solid var(--yt-ink);margin-bottom:8px}
.icons{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(11em,100%),1fr));gap:4px 12px}.icons span{display:flex;gap:8px;align-items:center;min-height:40px;font-size:14px;line-height:20px;min-width:0;overflow-wrap:break-word}
.darkbox{background:var(--yt-page);color:var(--yt-ink);padding:16px}
@media (max-width:899px){.sheet{grid-template-columns:minmax(0,1fr);gap:32px}.blk,.blk.w12,.blk.w4,.blk.w8{grid-column:1}.spec{grid-template-columns:minmax(0,1fr)}}
'''


def sistema():
    sw = ''.join(f'<div class="sw"><i style="background:var(--yt-{n})"></i><b>--yt-{n} <span class="muted" style="font-weight:400">{l} {T.P[l]} · oscuro {d} {T.P[d]}</span></b><span>{j}</span></div>'
                 for n, l, d, j in T.SEMANTIC if not n.startswith('on-') and not n.startswith('app-'))
    apps = ''.join(f'<span class="row" style="--g:8px;font-size:13px;line-height:18px"><i style="width:24px;height:24px;display:inline-block;background:var(--yt-{n});border:1px solid var(--yt-rule)"></i>{n.replace("app-", "")}</span>' for n, *_ in T.SEMANTIC if n.startswith('app-'))
    pairs = ''.join(f'<tr><td>{lab}</td><td>{need}:1</td><td>{T.cr(T.sem(fg), T.sem(bg)):.2f}</td><td>{T.cr(T.sem(fg, True), T.sem(bg, True)):.2f}</td></tr>' for lab, fg, bg, need in T.PAIRS)
    typ = ''
    sample = {'display': 'Pedido YT-100018', 'title': 'Audífonos Nimbo Aire', 'section': 'Hecho en Costa Rica', 'price-xl': col(19500), 'price': col(12900) + ' · ' + col(2341, 38),
              'code': '3772', 'h3': '¿Cambió de opinión?', 'body': 'Devoluciones sin enredos: 8 días hábiles.', 'body-app': 'Cobre el monto completo.', 'label': 'Teléfono',
              'small': 'Vendido por Tienda Sendero', 'table': 'San Pedro, Montes de Oca', 'fine': 'Todos los precios incluyen el IVA.',
              'button': 'Agregar al carrito', 'button-app': 'Publicar un producto', 'button-xl': 'Llegué', 'field-lg': 'Casa esquinera con portón negro', 'loc': 'A-02-02-A', 'count': '5', 'code-entry': '3772'}
    for n, f, w, p, d, tr, u in T.TYPE:
        face = 'Epilogue' if f == 'title' else 'Fira Sans'
        fam = 'var(--yt-font-title)' if f == 'title' else 'var(--yt-font-text)'
        style = f'font:{w} {d[0]}px/{d[1]}px {fam};letter-spacing:{tr};font-feature-settings:"lnum","tnum";overflow-wrap:anywhere'
        typ += f'<div class="spec"><span><b>{n}</b> · {face} {w}<small>{p[0]}/{p[1]} teléfono · {d[0]}/{d[1]} escritorio. {u}</small></span><span style=\'{style}\'>{sample[n]}</span></div>'
    st = lambda cap, html: f'<div>{html}<span>{cap}</span></div>'
    btn_states = (st('reposo', '<button class="btn">Agregar al carrito</button>') + st('encima: subrayado', '<button class="btn is-hover">Agregar al carrito</button>')
                  + st('foco: anillo 3 px', '<button class="btn is-focus">Agregar al carrito</button>') + st('presionado: baja 1 px', '<button class="btn is-pressed">Agregar al carrito</button>')
                  + st('desactivado: borde punteado', '<button class="btn" disabled>Agregar al carrito</button>') + st('cargando: dice qué hace', '<button class="btn is-loading" aria-busy="true">Agregando…</button>')
                  + st('contorno', '<button class="btn btn-outline">Guardar sin enviar</button>') + st('peligro: nombra su objeto', '<button class="btn btn-danger btn-sm">Suspender a TecnoCasa</button>')
                  + st('enlace con forma de botón', '<button class="link-btn">Quitar</button>'))
    fld = (st('reposo', '<div class="field"><label for="f1">Correo</label><input id="f1" class="input" placeholder="nombre@correo.cr"></div>')
           + st('foco', '<div class="field"><label for="f2">Correo</label><input id="f2" class="input is-focus" value="maria.f@"></div>')
           + st('desactivado', '<div class="field"><label for="f3">Correo</label><input id="f3" class="input" disabled value="maria.f@correo.cr"></div>')
           + st('error: mensaje arriba, valor guardado', f'<div class="field error"><label for="f4">Teléfono</label><span class="err">{ICON["alerta"]} Escriba 8 dígitos.</span><input id="f4" class="input" value="8888 12"></div>')
           + st('casillas', '<label class="check on"><span class="box"></span>Volcán</label><label class="check"><span class="box"></span>Solo disponibles</label><label class="check is-disabled"><span class="box"></span>Agotado</label>')
           + st('opciones', '<label class="check radio on"><span class="box"></span>Más relevantes</label><label class="check radio"><span class="box"></span>Más nuevos</label>'))
    tags = ''.join(f'<div class="row" style="--g:8px;padding:8px 0;border-bottom:1px solid var(--yt-rule)"><b style="width:120px;font-size:14px;line-height:20px">{h}</b>{x}</div>' for h, x in [
        ('○ Todavía no', '<span class="tag">Pendiente</span><span class="tag">Por preparar</span>'),
        ('◐ En curso', '<span class="tag half">Preparando</span><span class="tag half solid">En camino</span>'),
        ('✓ Listo', '<span class="tag done">Confirmado</span><span class="tag ok">Entregado</span><span class="tag ok">Pagado</span>'),
        ('! Atención', '<span class="tag warn">Por atender</span><span class="tag warn">Esperando el pago</span><span class="tag err">Pago rechazado</span>'),
        ('– Terminado', '<span class="tag ended">Cancelado</span>'), ('Entrega propia', '<span class="tag yt">Llega antes</span><span class="yt-line">Entregado por Yuntera</span>')])
    notices = (f'<div class="notice ok">{ICON["check"]}<div><b>¡Recibimos su pedido!</b>Ya lo estamos preparando.</div></div>'
               f'<div class="notice">{ICON["ayuda"]}<div><b>Su zona cierra el 25 de diciembre.</b>Ese día no entregamos.</div></div>'
               f'<div class="notice warn">{ICON["alerta"]}<div><b>Falta el pago por SINPE Móvil.</b>Lo esperamos hasta las 2 p. m.</div></div>'
               f'<div class="notice err">{ICON["alerta"]}<div><b>No pudimos cobrar la tarjeta.</b>Pruebe con otra o pague con SINPE Móvil.</div></div>'
               f'<div class="notice offline">{ICON["sin-red"]}<div><b>Está sin conexión.</b>Lo que ve es de las 9:42 a. m.</div></div>')
    from shop import TRACK
    icons = ''.join(f'<span>{ICON[k]}{w}</span>' for k, w in ICON_WORDS)
    lock = ''.join(f'<img src="assets/logo/{s}-marca.svg" alt="Yuntera {s}" style="height:36px;width:auto">' for s in ['yuntera', 'vende', 'central', 'ruta', 'bodega'])
    body = head('Sistema Carreta', SHEET_CSS) + f'''<main class="wrap"><div style="padding-top:24px"><h1 class="t-display">El sistema en una hoja</h1>
<p class="muted" style="max-width:820px">Carreta final. Títulos, precios y el código de entrega en Epilogue 600–800; todo lo demás en Fira Sans. Achiote tiene un solo trabajo: la entrega propia de Yuntera (y la yunta). Botones y selección en noche, enlaces y foco en añil.</p></div>
<div class="sheet">
<section class="blk w8"><h2>Letra</h2>{typ}<p class="t-small muted" style="margin-top:8px">Epilogue (Etcetera Type Co., OFL 1.1) solo de 18 px para arriba y solo en títulos, precios, el código y la marca. Fira Sans (Mozilla, OFL 1.1) para leer y tocar. Sin mayúsculas sostenidas, sin cursivas en títulos.</p></section>
<section class="blk w4"><h2>Color, claro y oscuro</h2>{sw}<h3>Color de cada app</h3><div class="row" style="--g:12px">{apps}</div></section>
<section class="blk w8"><h2>Pares de contraste (calculados)</h2><table class="pairs"><thead><tr><th>Par</th><th>Pide</th><th>Claro</th><th>Oscuro</th></tr></thead><tbody>{pairs}</tbody></table></section>
<section class="blk w4"><h2>Oscuro (apps del teléfono)</h2><div class="darkbox" data-theme="dark"><div class="row" style="--g:8px">{wheel(28, None)}<p class="t-section">Llega el viernes</p></div><p class="when">Llega el viernes 27 de noviembre</p><p class="muted t-small">Vendido por Tienda Sendero</p><p style="margin:8px 0"><a class="link44" href="#">Ver la factura</a></p><div class="row" style="--g:8px"><button class="btn btn-sm">Agregar</button><span class="tag ok">Entregado</span><span class="tag warn">Por atender</span><span class="tag err">Rechazado</span></div></div>
<p class="t-small muted" style="margin-top:8px">Sigue el ajuste del teléfono. Las barras de identidad (cacao, añil, noche) no cambian. Las webs quedan en claro.</p></section>
<section class="blk"><h2>Botones: estados</h2><div class="states">{btn_states}</div><p class="t-small muted" style="margin-top:8px">48 px en la web, 44 en herramientas (secundarios), 52–56 en las apps, 64 la acción fija del repartidor.</p></section>
<section class="blk"><h2>Campos: estados</h2><div class="states">{fld}</div></section>
<section class="blk"><h2>Sellos de estado: cinco signos</h2>{tags}</section>
<section class="blk"><h2>Avisos</h2><div class="stack">{notices}</div></section>
<section class="blk w12"><h2>La línea de ruta y la rueda</h2>
<h3>Pasos de la compra: estaciones con número, sin rueda</h3>{linea([("done", "Hecho", "Entrega", ""), ("now", "Ahora", "Pago", ""), ("next", "Falta", "Confirmar", "")], "pasos")}
<h3>Seguimiento del pedido: la rueda es la estación donde va el paquete</h3>{linea(TRACK, "track", wheel_at=1)}
<p class="t-small muted" style="margin-top:12px">La línea dice la secuencia; la rueda dice dónde va la entrega propia. Una sola rueda por pantalla: donde hay línea de seguimiento no hay franja.</p></section>
<section class="blk"><h2>La franja de entrega: dos versiones</h2>{strip()}<div style="height:8px"></div>{strip(version=2)}
<p class="t-small muted" style="margin-top:8px">Versión 1: franja achiote. Versión 2: blanca con filete achiote de 4 px. Se decide con 5 compradores (ver franja/).</p></section>
<section class="blk"><h2>La rueda</h2><div class="row" style="--g:24px;align-items:flex-end">{wheel(24)}{wheel(28)}{wheel(32)}<span style="color:var(--yt-ink)">{wheel(48, None, True)}</span><img src="assets/rueda.svg" alt="" width="96" height="96"></div>
<ol class="t-small" style="margin:12px 0 0;padding-left:16px"><li>Significa «Yuntera lo lleva». Nada más.</li><li>Una por pantalla, como máximo.</li><li>24 en la franja del teléfono, 28 en escritorio, 32 en la línea de ruta, 48 sin pintar en vacíos de entrega.</li><li>Nunca detrás de texto, nunca como patrón, nunca en errores.</li></ol></section>
<section class="blk w4"><h2>Tarjeta de producto</h2>{card(CARGADOR)}</section>
<section class="blk w4"><h2>Vendedor como persona</h2><div class="seller"><span class="mono" aria-hidden="true">C</span><a href="tienda.html">Cafetal Los Santos</a><p>Café de altura de la Zona de los Santos y artesanía de talleres costarricenses.</p></div>
<h3>Vacío</h3><div class="empty"><span class="pic" style="color:var(--yt-ink)">{wheel(48, None, True).replace("w48", "w48")}</span><h2>Todavía no tiene pedidos</h2><p class="t-small muted">Cuando compre, aquí verá cuándo llega.</p><div class="acts"><a class="btn btn-outline btn-sm" href="home.html">Ir a la tienda</a></div></div></section>
<section class="blk w4"><h2>Esquinas, espacio, sombra</h2><div class="rad"><div><span style="border-radius:4px"></span>controles 4</div><div><span style="border-radius:2px;height:28px"></span>sellos 2</div><div><span style="border-radius:0;background:var(--yt-photo)"></span>fotos 0</div><div><span style="border-radius:10px;box-shadow:var(--yt-elevation-overlay)"></span>capas 10 + sombra</div></div>
<div class="space" style="margin-top:12px">{"".join(f'<span style="text-align:center;font-size:13px;line-height:18px"><i style="width:{s}px;height:{s}px"></i>{s}</span>' for s in T.SPACE[1:])}</div>
<p class="t-small muted" style="margin-top:8px">Nada en reposo lleva sombra. Movimiento: 100 ms al tocar, 200 ms en paneles, nada con movimiento reducido.</p></section>
<section class="blk w12"><h2>Las piezas que faltaban (§5.26–5.32)</h2><div class="states" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">
<div><div class="notice ok" role="status" tabindex="-1">{ICON["check"]}<div><b>Guardamos sus avisos.</b>Le escribimos solo por correo.</div></div><span>Resultado de guardar: aviso arriba del formulario, el foco pasa a él; se queda hasta que la persona cambia algo.</span></div>
<div><div class="notice">{ICON["check"]}<div><b>Quitamos el café del carrito.</b><button class="link-btn" style="padding:0;justify-content:flex-start">Deshacer</button></div></div><span>Deshacer: para lo que se puede devolver (quitar del carrito, quitar un filtro). Lo que no se puede deshacer pide confirmación.</span></div>
<div><nav class="pager-t" aria-label="Ejemplo de paginador"><p>Mostrando 1–7 de 214. Página 1 de 31.</p><div class="row" style="--g:8px"><span class="btn btn-outline btn-sm is-disabled" aria-disabled="true">Anterior</span><a class="btn btn-outline btn-sm" href="#">Siguiente</a></div></nav><span>Paginador: qué se ve en palabras, Anterior y Siguiente, y «Ir a la página» en tablas largas.</span></div>
<div><div class="field"><label for="fx">Fecha del feriado <span class="muted">(dd/mm/aaaa)</span></label><div class="row" style="--g:8px"><input id="fx" class="input" inputmode="numeric" value="25/12/2026"><button class="btn btn-outline btn-sm" type="button">Calendario</button></div></div><span>Fecha: se escribe; el botón abre el calendario del sistema (el del teléfono o el del navegador). Sin calendario propio.</span></div>
<div><div class="photo-slots" style="grid-template-columns:repeat(2,minmax(0,1fr))"><div class="up" role="status"><span>Subiendo foto 2</span><span class="prog" aria-hidden="true"><i style="width:60%"></i></span><span>60 %</span></div><div class="up err" role="alert"><span>{ICON["alerta"]} No se pudo subir.</span><button type="button" class="link-btn">Intentar otra vez</button></div></div><span>Subir fotos y logotipos: progreso en palabras y barra; si falla, ! con la frase y «Intentar otra vez». Nada se pierde.</span></div>
<div><fieldset class="plain" style="gap:8px"><legend class="label" style="font:600 15px/20px var(--yt-font-text);margin:0">Avisos</legend><label class="check"><span class="box"></span>Avisos del pedido por WhatsApp</label><label class="check"><span class="box"></span>Ofertas, una vez por semana</label></fieldset><span>Consentimiento: casillas sin marcar, nunca un interruptor; se guardan con un botón «Guardar avisos».</span></div>
<div><div class="humancheck"><p class="label">Confirme que es una persona</p><p class="t-small muted">La revisión del proveedor va aquí, encima del botón «Crear la cuenta», con su propia etiqueta.</p></div><span>Verificación humana (registro): un bloque con etiqueta, justo antes del botón; si falla, el error va arriba como los demás.</span></div>
<div><div class="overlay dialog" role="dialog" aria-labelledby="dl1" style="max-width:none"><div class="head"><h2 class="t-h3" id="dl1">¿Cancelar el pedido YT-100018?</h2><button class="btn btn-outline btn-sm">Cerrar</button></div><p class="t-small">Le devolvemos {col(29400)} por SINPE Móvil.</p><div class="acts"><button class="btn btn-sm">Sí, cancelar el pedido</button></div></div><span>Diálogo: confirmación de una acción que no se deshace (ver confirmar.html).</span></div>
</div></section>
<section class="blk w8"><h2>Íconos (trazo de la yunta, siempre con palabra)</h2><div class="icons">{icons}</div></section>
<section class="blk w4"><h2>Logo</h2><div class="stack">{lock}</div><div class="row" style="margin-top:12px;--g:12px">{''.join(f'<img src="assets/icono-{a}.svg" width="60" height="60" alt="" style="border-radius:13px;box-shadow:0 0 0 1px var(--yt-rule)">' for a in ['yuntera', 'vende', 'ruta', 'bodega'])}</div></section>
</div></main></body></html>'''
    page('sistema.html', body, template='El sistema en una hoja', app='todas', widths=(1280, 390))


def iconos():
    names = [('yuntera', 'yuntera', 'Tienda: achiote, pétalos'), ('vende', 'yuntera vende', 'Vendedores: cacao, cuatro hojas'),
             ('ruta', 'yuntera ruta', 'Repartidores: añil, flechas en el aro'), ('bodega', 'yuntera bodega', 'Bodega: arena, cuadros, filete de tinta abajo')]
    big = ''.join(f'<figure style="margin:0;text-align:center"><img src="assets/app-icons/icono-{f}-1024.png" alt="Ícono de {n}" width="220" height="220" style="border-radius:48px;box-shadow:0 0 0 1px var(--yt-rule)"><figcaption style="margin-top:8px"><b>{n}</b><br><span class="muted t-small">{d}</span></figcaption></figure>' for f, n, d in names)
    small = ''.join(f'<figure style="margin:0;text-align:center"><img src="assets/app-icons/icono-{f}-180.png" alt="Ícono de {n}" width="60" height="60" style="border-radius:13px"><figcaption class="t-fine" style="margin-top:4px">{n}</figcaption></figure>' for f, n, d in names)
    tiny = ''.join(f'<img src="assets/app-icons/icono-{f}-48.png" alt="Ícono de {n} a 48 px" width="48" height="48">' for f, n, d in names)
    adaptive = ''.join(f'<figure style="margin:0;text-align:center"><span style="display:block;width:108px;height:108px;border-radius:50%;overflow:hidden;position:relative"><img src="assets/app-icons/icono-{f}-adaptativo-fondo-432.png" alt="" width="108" height="108" style="position:absolute;inset:0"><img src="assets/app-icons/icono-{f}-adaptativo-frente-432.png" alt="Ícono adaptable de {n} en máscara redonda" width="108" height="108" style="position:absolute;inset:0"></span><figcaption class="t-fine" style="margin-top:4px">{n}</figcaption></figure>' for f, n, d in names)
    mono = ''.join(f'<figure style="margin:0;text-align:center"><span style="display:block;width:108px;height:108px;border-radius:50%;background:#DCE3F5"><img src="assets/app-icons/icono-{f}-monocromo-432.png" alt="Ícono temático de {n}" width="108" height="108"></span><figcaption class="t-fine" style="margin-top:4px">{n}</figcaption></figure>' for f, n, d in names)
    splash = ''.join(f'<img src="assets/app-icons/icono-{f}-inicio-1024.png" alt="Inicio de {n}" width="96" height="96">' for f, n, d in names)
    body = head('Íconos de las apps') + f'''<main class="wrap" style="padding-top:24px;padding-bottom:48px"><h1 class="t-title">Los cuatro íconos</h1>
<p class="muted" style="margin:4px 0 24px;overflow-wrap:anywhere">Los PNG de assets/app-icons/, mostrados a 220 (archivo de 1024) y a 60 (archivo de 180). Fondo de su color, la rueda de su región, la yunta en el centro, sin palabras.</p>
<div class="row" style="--g:32px">{big}</div>
<h2 class="t-section" style="margin:32px 0 12px">A 60 px, uno al lado del otro</h2>
<div class="row" style="--g:24px;align-items:flex-start"><div class="row" style="--g:24px;background:#fff;padding:24px;border:1px solid var(--yt-rule)">{small}</div><div class="row" style="--g:24px;background:#2B2621;padding:24px;color:#fff">{small}</div></div>
<h2 class="t-section" style="margin:32px 0 12px">A 48 px (Android, el tamaño más chico)</h2><div class="row" style="--g:24px">{tiny}</div>
<h2 class="t-section" style="margin:32px 0 12px">Ícono adaptable de Android en máscara redonda</h2><p class="muted" style="margin-bottom:12px;max-width:760px">Fondo y frente por separado (432 × 432, 108 dp a 4x). El aro y la yunta van al 68 %: el punto más lejano queda al 57,9 % del lienzo, dentro del círculo seguro (61,1 %). El fondo se configura como un color en la app; el PNG de fondo solo lo muestra.</p><div class="row" style="--g:24px">{adaptive}</div>
<h2 class="t-section" style="margin:32px 0 12px">Ícono temático de Android 13 y pantalla de inicio</h2><p class="muted" style="margin-bottom:12px;max-width:760px">El temático es de un solo color sobre transparencia (el sistema lo tiñe). La pantalla de inicio muestra la rueda sin el cuadro, sobre el color de la página; la de bodega tiene su versión para el modo oscuro.</p>
<div class="row" style="--g:24px">{mono}</div><div class="row" style="--g:24px;margin-top:16px"><span style="background:#fff;border:1px solid var(--yt-rule);padding:8px">{splash}</span><span style="background:#16120F;padding:8px"><img src="assets/app-icons/icono-bodega-inicio-oscuro-1024.png" alt="Inicio de yuntera bodega en modo oscuro" width="96" height="96"></span></div>
<h2 class="t-section" style="margin:32px 0 12px">Consola (solo navegador)</h2><p class="row" style="--g:16px"><img src="assets/app-icons/icono-central-180.png" alt="Ícono de yuntera central" width="60" height="60" style="border-radius:13px"><img src="assets/app-icons/icono-central-48.png" alt="Ícono de yuntera central a 48 px" width="48" height="48"></p>
<p class="t-small muted" style="margin-top:24px;overflow-wrap:anywhere">Archivos: icono-*-1024.png (App Store, sin canal alfa), -512 (Google Play), -180 (iPhone), -48 (Android y favicon de la exportación web), -adaptativo-fondo-432, -adaptativo-frente-432, -monocromo-432, -inicio-1024 (y -inicio-oscuro-1024 de bodega); icono-central-512, -180, -48. Revisados por src/checkpng.py (assets/png-check.txt).</p></main></body></html>'''
    page('iconos.html', body, template='Íconos de las apps', app='todas', widths=(1280, 390))


def logotipos():
    rows = ''
    for s in ['yuntera', 'vende', 'central', 'ruta', 'bodega']:
        rows += f'''<div class="row" style="--g:16px;padding:12px 0;border-bottom:1px solid var(--yt-rule)">
<div style="background:#fff;padding:16px;border:1px solid var(--yt-rule)"><img src="assets/logo/{s}-marca.svg" alt="{s}, color de marca" style="height:40px;width:auto"></div>
<div style="background:#fff;padding:16px;border:1px solid var(--yt-rule)"><img src="assets/logo/{s}-tinta.svg" alt="{s}, tinta" style="height:40px;width:auto"></div>
<div style="background:#1E1A16;padding:16px"><img src="assets/logo/{s}-blanco.svg" alt="{s}, blanco" style="height:40px;width:auto"></div>
<div style="background:#fff;padding:16px;border:1px solid var(--yt-rule)"><img src="assets/logo/{s}-marca@2x.png" alt="{s}, PNG para correo" style="height:36px;width:auto"><p class="t-fine muted" style="margin-top:4px">PNG (correo)</p></div></div>'''
    body = head('Logotipos en contornos') + f'''<main class="wrap" style="padding-top:24px;padding-bottom:48px"><h1 class="t-title">La marca y los cinco logotipos</h1>
<p class="muted" style="margin:4px 0 16px;max-width:820px">Texto convertido a contornos desde los archivos Epilogue (src/logo.py): «yuntera» en 800, el descriptor en 600 al 62 %, al mismo tamaño. La yunta es la del repositorio, sin cambios. Tres versiones: marca (yunta achiote, letras noche), tinta y blanco.</p>
<div style="max-width:100%;overflow-wrap:anywhere">{rows}</div>
<h2 class="t-section" style="margin-top:24px">Reglas</h2><ul><li>Espacio libre: un cuarto de la altura de la yunta en cada lado.</li><li>Mínimo en pantalla: yunta de 20 px; en papel, 8 mm.</li><li>El descriptor nunca cambia de color, nunca va en otra línea ni en mayúsculas.</li><li>La yunta no se redibuja. Solo achiote, noche o blanco.</li></ul></main></body></html>'''
    page('logotipos.html', body.replace('<img src', '<img style="max-width:100%" src', 0), template='Logotipos en contornos', app='todas', widths=(1280, 390))


def mensajes():
    css = '.mail{max-width:600px;margin:0 auto;background:#fff;border:1px solid #D9D0C3}.wa{max-width:360px;box-sizing:border-box;overflow-wrap:anywhere;background:#E9E3DA;padding:16px}.bubble{overflow-wrap:anywhere;background:#fff;padding:8px 12px;border-radius:0 10px 10px 10px;font:400 14px/20px var(--yt-font-text);color:#1E1A16}'
    email = f'''<div class="mail"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;color:#1E1A16">
<tr><td style="padding:24px 24px;border-bottom:3px solid #1E1A16"><img src="assets/logo/yuntera-marca.png" width="164" height="36" alt="yuntera" style="display:block;height:36px;width:auto"></td></tr>
<tr><td style="padding:24px 24px 8px"><h1 style="margin:0;font:700 24px/30px Arial,Helvetica,sans-serif">Su pedido va en camino</h1></td></tr>
<tr><td style="padding:0 24px 16px;font:400 16px/24px Arial,Helvetica,sans-serif">María, el pedido YT-100018 salió de la bodega a las 8:05 a. m.</td></tr>
<tr><td style="padding:0 24px 16px"><p style="margin:0;font:700 18px/24px Arial,Helvetica,sans-serif;color:#B8420F">Llega hoy, viernes 27 de noviembre, entre 9 a. m. y 1 p. m.</p></td></tr>
<tr><td style="padding:0 24px 16px;font:400 16px/24px Arial,Helvetica,sans-serif">Al recibir, dígale al repartidor su código de entrega. Lo ve en su pedido; por seguridad no lo enviamos por correo.</td></tr>
<tr><td style="padding:0 24px 24px"><a href="#" style="display:inline-block;background:#1E1A16;color:#ffffff;font:700 16px/20px Arial,Helvetica,sans-serif;padding:16px 24px;border-radius:4px;text-decoration:none">Ver mi pedido</a></td></tr>
<tr><td style="padding:16px 24px;background:#F3EEE6;font:400 13px/18px Arial,Helvetica,sans-serif;color:#574E45">REASON Ayuda por WhatsApp: [número por definir]. Yuntera (entidad en formación). ayuda@yuntera.cr</td></tr></table></div>'''
    account = email.replace('REASON', 'Le escribimos porque alguien creó una cuenta con este correo en yuntera.cr.').replace('Su pedido va en camino', 'Confirme su correo').replace('María, el pedido YT-100018 salió de la bodega a las 8:05 a. m.', 'Toque el botón para confirmar maria.f@correo.cr. El enlace vence en 24 horas.') \
        .replace('<tr><td style="padding:0 24px 16px"><p style="margin:0;font:700 18px/24px Arial,Helvetica,sans-serif;color:#B8420F">Llega hoy, viernes 27 de noviembre, entre 9 a. m. y 1 p. m.</p></td></tr>', '') \
        .replace('Al recibir, dígale al repartidor su código de entrega. Lo ve en su pedido; por seguridad no lo enviamos por correo.', 'Si usted no creó esta cuenta, no haga nada: la borramos en 7 días.') \
        .replace('Ver mi pedido', 'Confirmar mi correo')
    email = email.replace('REASON', 'Le escribimos porque compró en Yuntera.')
    wa = '''<div class="wa"><p class="t-fine muted" style="margin-bottom:8px">Plantilla de WhatsApp «pedido_en_camino»</p><div class="bubble"><b>Yuntera:</b> Su pedido YT-100018 va en camino. Llega hoy entre 9 a. m. y 1 p. m.<br><br>Tenga a mano su código de entrega; lo ve en su pedido.<br><br>Ver el pedido: yuntera.cr/pedidos/YT-100018</div></div>'''
    body = head('Mensajes, Yuntera', css) + f'''<main class="wrap" style="padding-top:24px;padding-bottom:48px"><h1 class="t-title">El marco de los mensajes</h1>
<p class="muted" style="max-width:760px;margin:4px 0 24px">Correo: tabla de 600 px con estilos en línea. Encabezado con el logotipo en PNG (los programas de correo bloquean SVG y no cargan Epilogue), una regla noche de 3 px, el título en Arial negrita como respaldo, un botón noche. Achiote solo en la fecha de llegada.</p>
<p class="frame-cap">Mensaje de un evento <span>(renderEmail, 37 mensajes)</span></p><div style="background:#E9E3DA;padding:16px 0">{email}</div>
<p class="frame-cap" style="margin-top:24px">Correo de la cuenta <span>(10 plantillas de supabase/templates)</span></p><div style="background:#E9E3DA;padding:16px 0">{account}</div>
<p class="frame-cap" style="margin-top:24px">WhatsApp <span>(4 plantillas; texto plano, la primera línea dice qué pasó)</span></p><div style="padding:16px 0">{wa}</div></main></body></html>'''
    page('mensajes.html', body, template='T18 Marco de mensajes (correo, cuenta, WhatsApp)', app='mensajes', widths=(390, 1280))


def cubrir():
    css = '''.pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px}.frame{position:relative;aspect-ratio:1280/800;overflow:hidden;border:1px solid var(--yt-rule)}
.frame iframe{width:1280px;height:800px;border:0;transform:scale(.45);transform-origin:0 0}.frame .blk{position:absolute;background:#000;left:13px;top:12px;width:82px;height:22px}'''
    body = head('Prueba de cubrir el logo', css) + '''<main class="wrap" style="padding-top:24px;padding-bottom:48px"><h1 class="t-title">Prueba de cubrir el logo</h1>
<p class="muted" style="margin:4px 0 24px">Inicio y producto a 1280 × 800, con el logo tapado en negro.</p>
<div class="pair"><div class="frame"><iframe src="home.html" title="Inicio" scrolling="no" tabindex="-1"></iframe><span class="blk"></span></div><div class="frame"><iframe src="producto.html" title="Producto" scrolling="no" tabindex="-1"></iframe><span class="blk"></span></div></div>
<p style="margin-top:24px;max-width:900px;font-size:18px;line-height:24px">Sin el logo sigue diciendo «Yuntera»: la franja achiote con la rueda pintada y la hora de corte, la fecha de llegada en achiote, los títulos y precios anchos en Epilogue, los sellos de estado cuadrados y los vendedores con su oficio.</p></main></body></html>'''
    page('cubrir-logo.html', body, template='Prueba de cubrir el logo', app='web', widths=(1280,))


def franja_pages():
    """Version 2 of the strip on the shop home and the product page, for the owner's test."""
    for src in ('home.html', 'producto.html'):
        s = open(os.path.join(ROOT, src)).read()
        assert s.count('class="strip banda-marca"') == 1
        s2 = s.replace('class="strip banda-marca"', 'class="strip regla"')
        name = 'franja2-' + src
        with open(os.path.join(ROOT, name), 'w') as f:
            f.write(s2)
        PAGES.append((name, ('Inicio' if src == 'home.html' else 'Producto') + ', franja versión 2', 'Franja versión 2 (prueba)', 'web', (390,)))


def confirmar():
    """The confirmation dialog of a destructive action, for the shopper (opened
    by an outline button) and for staff (opened by a danger button), with the
    reason field and the consequence sentence (§5.15, §5.19, S6)."""
    def dlg(i, title, body, field, btn, back):
        return f'''<div class="dialog-stage"><div class="overlay dialog" role="dialog" aria-modal="true" aria-labelledby="t{i}">
<div class="head"><h2 class="t-section" id="t{i}">{title}</h2><button class="btn btn-outline btn-sm">{ICON["cerrar"]} Cerrar</button></div>
{body}{field}<div class="acts"><button class="btn btn-outline">{back}</button>{btn}</div></div></div>'''
    shopper = dlg(1, '¿Cancelar el pedido <span class="nowrap">YT-100018</span>?', f'<p>Le devolvemos {col(29400)} por SINPE Móvil en 1 día hábil. Los 2 vendedores reciben el aviso.</p>',
                  '<div class="field"><label for="mc">¿Por qué lo cancela? <span class="muted">(opcional)</span></label><select id="mc" class="select"><option>Elija un motivo</option><option>Ya no lo necesito</option><option>Lo encontré en otro lugar</option><option>Tarda mucho en llegar</option></select></div>',
                  '<button class="btn">Sí, cancelar el pedido</button>', 'No, mantener el pedido')
    staff = dlg(2, 'Cancelar el pedido <span class="nowrap">YT-100018</span>', f'<p>Le devolvemos {col(29400)} a María Fernández por SINPE Móvil y avisamos a los 2 vendedores. Queda en Auditoría con su nombre.</p>',
                '<div class="field"><label for="ms">Motivo <span class="muted">(se le envía al cliente)</span></label><textarea id="ms" class="textarea"></textarea></div>',
                '<button class="btn btn-danger">Cancelar el pedido YT-100018</button>', 'No, mantener el pedido')
    body = head('Confirmar una cancelación, Yuntera') + f'''<main><div class="wrap" style="padding:24px 16px 8px"><h1 class="t-title">Confirmar una acción que no se deshace</h1>
<p class="muted" style="max-width:760px">El comprador cancela con un botón de contorno (es un servicio, no un peligro); el personal, con el botón rojo de la zona de peligro. Los dos abren este diálogo: dice la consecuencia en una frase, pide el motivo, y el botón final repite la acción.</p></div>
<p class="frame-cap" id="comprador">Comprador <span>(pedido en «Pedido confirmado» o «Esperando el pago»: solo entonces su página muestra «Cancelar el pedido»)</span></p>{shopper}
<p class="frame-cap" id="personal">Personal de Yuntera <span>(consola y central-pedido.html, zona de peligro)</span></p>{staff}</main></body></html>'''
    page('confirmar.html', body, template='T14 Confirmación de una acción que no se deshace (diálogo, comprador y personal)', app='web, ops')


def index():
    rows = ''.join(f'<tr><td><a class="link44" href="{f}">{f}</a></td><td>{t}</td><td>{tpl}</td><td>{a}</td><td>{", ".join(str(w) for w in ws)}</td></tr>' for f, t, tpl, a, ws in PAGES if f != 'index.html')
    body = head('Carreta, páginas de referencia') + f'''<main class="wrap" style="padding-top:24px;padding-bottom:48px"><h1 class="t-title">Carreta: páginas de referencia</h1>
<p class="muted" style="margin:4px 0 16px">{len(PAGES)} páginas, generadas por src/build.py. La especificación está en SISTEMA.md.</p>
<div class="tbl-wrap cards" style="max-height:none"><table class="t cards"><thead><tr><th>Página</th><th>Título</th><th>Plantilla</th><th>App</th><th>Anchos</th></tr></thead><tbody>{rows.replace("<tr><td>", '<tr><td class="lead">', ).replace("</td><td>", "</td><td data-label=\"\">")}</tbody></table></div></main></body></html>'''
    page('index.html', body, template='Índice', app='todas', widths=(1280, 390))
