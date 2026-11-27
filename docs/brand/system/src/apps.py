"""The four phone apps drawn as 390 × 844 pt frames, light and dark:
shop-native, seller-native, driver-native, warehouse-native."""
from common import *
from shop import CAFE1, CAFE2, JABON, TABLA, TRACK


def status(on_app=False):
    return f'<div class="status{" on-app" if on_app else ""}" aria-hidden="true"><span>9:41</span><span>4G ▮▮▮</span></div>'


def phone(cap, inner, theme=None, top_bg=None, on_app=False):
    th = f' data-theme="{theme}"' if theme else ''
    st = f'<div style="background:{top_bg}">{status(on_app)}</div>' if top_bg else status(on_app)
    return f'''<div class="phone-col"><p class="frame-cap">{cap}</p><div class="phone"{th}>{st}{inner}<div class="home-ind" aria-hidden="true"></div></div></div>'''


def nav_h(back, title, act=''):
    a = f'<span class="act">{act}</span>' if act else '<span class="act"></span>'
    b = f'<a class="back" href="#">{ICON["izquierda"]}{back}</a>' if back else '<span class="act"></span>'
    return f'<header class="nav-h">{b}<h1>{title}</h1>{a}</header>'


def tabbar(items, cur, badges=None):
    badges = badges or {}
    out = ''
    for icon, word in items:
        b = f'<span class="badge" aria-label="{badges[word]} {"productos" if word == "Carrito" else "por empacar"}">{badges[word]}</span>' if word in badges else ''
        out += f'<a href="#"{" aria-current=page" if word == cur else ""}><span class="ic">{ICON[icon]}{b}</span><span class="tl">{word}</span></a>'
    return f'<nav class="tabbar" style="--tabs:{len(items)}" aria-label="Secciones">{out}</nav>'


SHOP_TABS = [('inicio', 'Inicio'), ('menu', 'Categorías'), ('buscar', 'Buscar'), ('carrito', 'Carrito'), ('persona', 'Cuenta')]
SELL_TABS = [('inicio', 'Inicio'), ('caja', 'Pedidos'), ('etiqueta', 'Productos'), ('estante', 'Inventario'), ('moneda', 'Pagos')]


def shop_home(theme=None):
    depts = ''.join(f'<li><a href="#"><span>{n}</span><span class="n">{c}</span></a></li>' for n, c in DEPTS[:6])
    inner = f'''<div style="padding:4px 16px 8px;display:flex;align-items:center;justify-content:space-between;gap:8px">{lockup(href="#")}<a class="hdr-link" href="#">{ICON["pin"]}<span style="display:inline">Elija su zona</span></a></div>
<div style="padding:0 16px 8px">{search_form("app" + (theme or ""))}</div>
{strip()}
<div class="body"><ul class="depts"><li class="all"><a href="#">Todas las categorías <span class="n" style="color:var(--yt-ink)">14 {ICON["derecha"]}</span></a></li></ul>
<ul class="depts dept-grid">{depts}</ul>
<div class="sec-head" style="margin:8px 0 0"><h2 class="t-section">Hecho en Costa Rica</h2><a href="#">Ver todo</a></div>
<div class="grid">{card(CAFE1)}{card(CAFE2)}</div></div>
{tabbar(SHOP_TABS, "Inicio", {"Carrito": 3})}'''
    return phone(('Tienda · Inicio · oscuro' if theme else 'Tienda · Inicio · claro') + ' <span>(T1; el logo solo aquí y al ingresar)</span>', inner, theme)


def shop_product(theme=None):
    inner = f'''{nav_h("Buscar", "Audio y audífonos")}
<div class="body"><div style="aspect-ratio:1;background:var(--yt-photo);margin:0 -16px"><img src="img/audifonos.svg" alt="Audífonos Nimbo Aire con su estuche"></div>
<p class="t-small muted">Nimbo</p><h2 class="t-title">Audífonos inalámbricos Nimbo Aire con estuche de carga</h2>{rating(4.5, 2)}
<div class="buy" style="margin:4px -16px 0"><div><span class="t-price-xl">{col(19500)}</span><p class="t-small">Precio final, IVA incluido.</p></div>
<div><p class="when">Llega el viernes 27 de noviembre</p><p class="t-small">Pida antes de las 2 p. m. Lo llevan nuestros propios repartidores.</p></div>
<button class="btn btn-block">Agregar al carrito</button>
<p class="t-small">Vendido por <a class="seller-link" href="#">Tienda Sendero</a></p></div></div>
{tabbar(SHOP_TABS, "Inicio", {"Carrito": 3})}'''
    return phone(('Tienda · Producto · oscuro' if theme else 'Tienda · Producto · claro') + ' <span>(T3; encabezado de pila con «atrás» y su palabra)</span>', inner, theme)


def shop_order(theme=None):
    inner = f'''{nav_h("Pedidos", "Pedido YT-100018")}
<div class="body"><span class="tag half solid" style="align-self:flex-start">Preparando su pedido</span>
<section class="code banda-marca" style="margin:0 -16px;padding:16px" aria-labelledby="c{theme}"><h2 class="t-h3" id="c{theme}">Su código de entrega</h2><p class="t-code">3772</p>
<p class="t-small">Dígaselo al repartidor solo cuando tenga el paquete en sus manos. Nadie de Yuntera se lo va a pedir por teléfono ni por mensaje.</p></section>
<h2 class="t-section">Dónde va su pedido</h2>{linea(TRACK, "track v", wheel_at=1)}
<p class="when">Llega el viernes 27 de noviembre</p>
<div class="pkg"><span><b>Paquete 1 de 2</b> · <span class="mono-code">YT500019</span></span><span class="tag">Por preparar</span></div></div>
{tabbar(SHOP_TABS, "Cuenta", {"Carrito": 3})}'''
    return phone(('Tienda · Pedido · oscuro' if theme else 'Tienda · Pedido · claro') + ' <span>(T5; la línea de ruta vertical)</span>', inner, theme)


def shop_account():
    inner = f'''<div class="body" style="padding-top:12px"><h1 class="t-title">Su cuenta</h1><p class="muted">María Fernández Solís</p>
<ul class="rowlist"><li><a href="#">Sus pedidos<small>El último llega el viernes 27</small>{ICON["derecha"]}</a></li><li><a href="#">Direcciones<small>San Pedro, Montes de Oca</small>{ICON["derecha"]}</a></li>
<li><a href="#">Avisos<small>Correo sí, WhatsApp no</small>{ICON["derecha"]}</a></li><li><a href="#">Contraseña<small>Cambiada el 2 de noviembre</small>{ICON["derecha"]}</a></li><li><a href="#">Ayuda<small>Entregas, devoluciones, pagos</small>{ICON["derecha"]}</a></li></ul>
<button class="btn btn-outline btn-block">{ICON["salir"]} Salir</button><a class="link44" href="#" style="color:var(--yt-danger)">Eliminar mi cuenta</a></div>
{tabbar(SHOP_TABS, "Cuenta", {"Carrito": 3})}'''
    return phone('Tienda · Cuenta <span>(T11 menú de cuenta)</span>', inner)


def shop_signin():
    inner = f'''<div class="body" style="padding-top:24px;gap:16px"><span>{lockup(href="#")}</span><h1 class="t-title">Ingresar</h1>
<div class="field"><label for="ae">Correo</label><input id="ae" class="input" type="email" value="maria.f@correo.cr"></div>
<div class="field error"><label for="ap">Contraseña</label><span class="err">{ICON["alerta"]} Esa contraseña no coincide. Revise las mayúsculas o pida un enlace nuevo.</span><input id="ap" class="input" type="password" value="xxxxxxxx"></div>
<button class="btn btn-block">Ingresar</button><a class="link44" href="#">¿Olvidó su contraseña?</a>
<div style="border-top:2px solid var(--yt-ink);padding-top:12px"><p>¿Primera vez?</p><a class="btn btn-outline btn-block" href="#">Crear una cuenta</a></div></div>'''
    return phone('Tienda · Ingresar con error <span>(T13)</span>', inner)


def seller_home(theme=None):
    top = f'''<div class="app-top vende banda"><div class="inner">{lockup("vende", "mark-cal.svg", href="#")}<div class="end"><a href="#">{ICON["persona"]}<span class="sr">Su cuenta</span>Cuenta</a></div></div></div>'''
    inner = top + f'''<div class="body"><div class="row" style="justify-content:space-between"><div><p class="t-small muted">Su tienda</p><p class="t-section">Ferretería El Higuerón</p></div><a class="btn btn-outline btn-sm" href="#">Cambiar</a></div>
<h2 class="t-section">Por atender</h2><p style="margin-top:-8px">Hoy tiene 1 paquete por empacar.</p>
<ul class="tasks"><li class="task"><div><span class="tag warn">Por atender</span><p style="font-weight:600;margin-top:8px">Pedidos por empacar</p><a href="#">Ver pedidos</a></div><span class="cnt t-count">1</span></li>
<li class="task zero"><span>Productos sin existencias</span><span class="cnt t-count">0</span></li>
<li class="task zero"><span>Productos rechazados</span><span class="cnt t-count">0</span></li>
<li class="task zero"><span>Devoluciones abiertas</span><span class="cnt t-count">0</span></li></ul>
<button class="btn btn-block btn-lg">{ICON["mas"]} Publicar un producto</button>
<h2 class="t-section">Últimos 30 días</h2>
<div class="kv"><span>Ventas<br><span class="t-small muted">Precio pagado por los compradores</span></span><span class="t-price">{col(63300)}</span></div>
<div class="kv"><span>Pedidos</span><span class="t-price">1 <span class="t-small muted" style="font-family:var(--yt-font-text);font-weight:400">(3 unidades)</span></span></div></div>
{tabbar(SELL_TABS, "Inicio", {"Pedidos": 1})}'''
    return phone(('Vende · Inicio · oscuro' if theme else 'Vende · Inicio · claro') + ' <span>(T6; barra cacao)</span>', inner, theme, 'var(--yt-app-seller)', True)


def seller_orders():
    # sellers see the buyer's first name and district only (§4.4)
    rows = [('Pedido YT-100030 · Andrés', 'San Pedro, Montes de Oca', 'Por empacar', 'warn', 'hoy, antes de las 4 p. m.', 21900),
            ('Pedido YT-100022 · Luis', 'Escazú, San Rafael', 'Recogido', 'ok', 'ayer, 3:10 p. m.', 18900)]
    li = ''.join(f'<li><a href="#" style="grid-template-columns:minmax(0,1fr) auto"><span><b>{a}</b><br><small style="display:block">{d}</small><span class="tag {c}" style="margin-top:8px">{s}</span> <small style="display:inline">{w}</small></span><span class="t-price">{col(m)}</span></a></li>' for a, d, s, c, w, m in rows)
    top = f'<div class="app-top vende banda"><div class="inner"><h1>Pedidos</h1><div class="end"><a href="#">{ICON["persona"]}Cuenta</a></div></div></div>'
    inner = top + f'''<div class="body"><div class="field"><label for="ps">Buscar pedido</label><input id="ps" class="input"></div>
<nav class="tabs-row" aria-label="Vistas"><a href="#" aria-current="page">Por empacar <span class="n">(1)</span></a><a href="#">Todos <span class="n">(2)</span></a></nav>
<ul class="rowlist" style="border-top:0">{li}</ul><p class="t-small muted">Del comprador se ve solo el nombre y el distrito.</p></div>{tabbar(SELL_TABS, "Pedidos", {"Pedidos": 1})}'''
    return phone('Vende · Pedidos <span>(T7 como lista; cada pestaña raíz lleva la barra cacao, solo Inicio lleva el logo)</span>', inner, None, 'var(--yt-app-seller)', True)


def driver_list():
    top = f'<div class="app-top ruta banda"><div class="inner"><h1>Ruta 3 · martes 24</h1><div class="end"><a href="#">{ICON["persona"]}Cuenta</a></div></div></div>'
    inner = top + f'''<div class="notice offline" style="margin:0">{ICON["sin-red"]}<div><b>Sin señal.</b>Guardamos en el teléfono 1 parada que no se pudo entregar y la enviamos al volver la señal. Para entregar con código necesita señal.</div></div>
<div class="body"><p class="big" style="font-weight:600">1 de 8 entregadas. Siguiente: San Pedro.</p>{linea([("done", "Hecho", "Karla Pérez Mora", "Moravia · entregado 8:41 a. m."), ("now", "Ahora", "María Fernández Solís", "San Pedro · cobrar " + col(23400)), ("next", "Falta", "Luis Chaves Rojas", "Escazú, San Rafael")], "v", wheel_at=1)}
<a class="btn btn-block btn-lg" href="#">Abrir la parada 2</a></div>'''
    return phone('Ruta · Paradas, sin señal <span>(T16; la rueda marca la parada actual)</span>', inner, None, 'var(--yt-app-driver)', True)


def driver_stop(theme=None):
    top = f'<div class="app-top ruta banda"><div class="inner" style="padding-left:4px"><a class="back" href="#" style="color:inherit;display:inline-flex;align-items:center;min-height:48px;padding:0 8px;text-decoration:none">{ICON["izquierda"]} Ruta</a><h1>Parada 2 de 8</h1></div></div>'
    inner = top + f'''<div class="body" style="gap:4px"><p class="t-small muted">Paquete <span class="mono-code">YT500011</span> · 1 bulto</p>
<div class="row" style="justify-content:space-between;--g:4px 12px"><h2 class="t-title">María Fernández Solís</h2><span class="tag">Por entregar</span></div>
<p class="lbl">Señas</p><p class="big" style="font-weight:600">De la Fuente de la Hispanidad 300 metros sur y 50 este, casa esquinera con portón negro</p>
<p class="lbl">Código Plus</p><p class="mono-code">66XQWWMX+GG</p>
<div class="acts4"><a class="btn btn-outline" href="#">{ICON["ruta"]} Cómo llegar</a><a class="btn btn-outline" href="#">{ICON["mapa"]} Abrir en Waze</a><a class="btn btn-outline" href="#">{ICON["llamar"]} Llamar</a><a class="btn btn-outline" href="#">{ICON["chat"]} WhatsApp</a></div>
<div class="cash" style="margin:16px -16px 0"><b>Cobrar {col(23400)} en efectivo</b><details class="more"><summary>Más información</summary><p class="t-small">Cobre el monto completo antes de entregar.</p></details></div></div>
<div style="padding:12px 16px;border-top:1px solid var(--yt-rule)"><button class="btn btn-xl">Llegué</button></div>'''
    return phone(('Ruta · Parada · oscuro' if theme else 'Ruta · Parada · claro') + ' <span>(T16; la barra añil no cambia en oscuro)</span>', inner, theme, 'var(--yt-app-driver)', True)


def driver_permission():
    inner = f'''<div class="body" style="padding-top:24px;gap:16px"><span style="color:var(--yt-app-driver)">{ICON["pin"].replace('class="ico"', 'class="ico" style="width:56px;height:56px"')}</span>
<h1 class="t-title">Para avisar al cliente que usted va cerca, usamos su ubicación</h1>
<p>Solo mientras tenga una ruta abierta, de 7 a. m. a 7 p. m. No la guardamos al terminar la ruta.</p>
<p>Después de tocar «Continuar», el teléfono le preguntará si nos permite usarla. Puede decir que no y seguir trabajando; el cliente no verá cuándo llega.</p>
<button class="btn btn-block btn-lg">Continuar</button><button class="btn btn-outline btn-block btn-lg">Ahora no</button></div>'''
    return phone('Ruta · Antes de pedir la ubicación <span>(T14 variante; sigue las reglas de las tiendas)</span>', inner)


def warehouse_home():
    top = f'<div class="app-top bodega"><div class="inner">{lockup("bodega", "mark-noche.svg", href="#")}<div class="end"><a href="#">{ICON["persona"]}Cuenta</a></div></div></div>'
    inner = top + f'''<div class="body"><form class="field scan"><label for="wsc">Escanee o escriba cualquier código</label><div class="search-app"><input id="wsc" class="input" placeholder="Ej.: YT500018"><button class="btn btn-lg" type="button">{ICON["camara"]} Cámara</button></div></form>
<ul class="tasks"><li class="task"><div><span class="tag warn">Por atender</span><p style="font-weight:600;margin-top:8px">Recoger para la ruta 3</p><a href="#">Empezar</a></div><span class="cnt t-count">5</span></li>
<li class="task"><div><p style="font-weight:600">Recibir de TecnoCasa</p><a href="#">Ver lo que llega</a></div><span class="cnt t-count">2</span></li>
<li class="task zero"><span>Devoluciones por revisar</span><span class="cnt t-count">0</span></li></ul></div>'''
    return phone('Bodega · Inicio <span>(T6; el logo solo en el inicio)</span>', inner)


def warehouse_scan():
    inner = f'''{nav_h("Tareas", "Recoger · ruta 3")}<div class="body"><div class="camera" role="img" aria-label="Vista de la cámara"><span class="frame"></span><p>Ponga el código dentro del marco. También puede escribirlo abajo.</p></div>
<div class="field"><label for="wc">Código</label><input id="wc" class="input" placeholder="Ej.: YT500018"></div>
<section class="pick"><p class="lbl" style="margin-top:0">Ubicación</p><p class="loc t-loc">A-02-02-A</p><p class="big" style="font-weight:600">Café molido de altura Tarrazú 340 g</p><p class="big" style="font-weight:700">Tome 2 unidades</p></section></div>'''
    return phone('Bodega · Escanear con la cámara <span>(T17)</span>', inner)


def warehouse_refused(theme=None):
    inner = f'''<section class="refused banda-peligro" style="flex:1;min-height:0" role="alertdialog" aria-labelledby="wr{theme}">{mark_err(96)}<h2 id="wr{theme}" class="t-title">Este no es el producto de esta línea.</h2>
<p class="big">Código leído: <b class="mono-code">7 441029 504121</b>. Busque: Café molido de altura Tarrazú 340 g en A-02-02-A.</p><button class="btn btn-block btn-xl">Entendido, vuelvo a leer</button></section>'''
    return phone('Bodega · Lectura rechazada' + (' · oscuro' if theme else '') + ' <span>(ocupa la pantalla)</span>', inner, theme, 'var(--yt-danger)', True)


def driver_stop_android():
    """The same stop on Android: status bar with the time on the left, top app bar
    with a back arrow and no word (the system back gesture does the same), title on
    the left, ripple on press (not drawable), the gesture bar inset at the bottom."""
    st = '<div style="background:var(--yt-app-driver)"><div class="status on-app android" aria-hidden="true"><span>9:41</span><span>▾ ▮▮▮ 4G</span></div></div>'
    top = f'<div class="app-top ruta banda"><div class="inner android-bar"><a class="back" href="#" style="color:inherit;display:inline-flex;align-items:center;justify-content:center;min-height:48px;min-width:48px;text-decoration:none">{ICON["izquierda"]}<span class="sr">Volver a la ruta</span></a><h1>Parada 2 de 8</h1></div></div>'
    inner = top + f'''<div class="body" style="gap:4px"><p class="t-small muted">Paquete <span class="mono-code">YT500011</span> · 1 bulto</p>
<div class="row" style="justify-content:space-between;--g:4px 12px"><h2 class="t-title">María Fernández Solís</h2><span class="tag">Por entregar</span></div>
<p class="lbl">Señas</p><p class="big" style="font-weight:600">De la Fuente de la Hispanidad 300 metros sur y 50 este, casa esquinera con portón negro</p>
<div class="acts4"><a class="btn btn-outline" href="#">{ICON["ruta"]} Cómo llegar</a><a class="btn btn-outline" href="#">{ICON["mapa"]} Abrir en Waze</a><a class="btn btn-outline" href="#">{ICON["llamar"]} Llamar</a><a class="btn btn-outline" href="#">{ICON["chat"]} WhatsApp</a></div></div>
<div style="padding:8px 16px;border-top:1px solid var(--yt-rule)"><button class="btn btn-xl">Llegué</button></div>'''
    return f'''<div class="phone-col"><p class="frame-cap">Ruta · Parada en Android <span>(flecha sin palabra, título a la izquierda, barra de gestos)</span></p><div class="phone android">{st}{inner}<div class="gesture-ind" aria-hidden="true"></div></div></div>'''


def shop_product_big():
    """A2: the product at 200 % text (body 34 pt). Title, price, date and the
    button stay whole; the tab bar labels are capped and shrink to fit."""
    inner = f'''{nav_h("Buscar", "Audio y audífonos")}
<div class="body"><p class="t-small muted">Nimbo</p><h2 class="t-title">Audífonos inalámbricos Nimbo Aire con estuche de carga</h2>
<div class="buy" style="margin:4px -16px 0"><span class="t-price-xl">{col(19500)}</span><p class="when">Llega el viernes 27 de noviembre</p>
<button class="btn btn-block">Agregar al carrito</button></div></div>
{tabbar(SHOP_TABS, "Inicio", {"Carrito": 3})}'''
    return f'''<div class="phone-col"><p class="frame-cap">Tienda · Producto con letra al 200 % <span>(A2; cuerpo 34 pt, la barra de pestañas con tope)</span></p><div class="phone x2">{status()}{inner}<div class="home-ind" aria-hidden="true"></div></div></div>'''


def gallery(name, title, cap, frames, template, app):
    body = head(title) + f'<main><div class="wrap" style="padding:24px 16px 0"><h1 class="t-section">{title}</h1><p class="muted">{cap}</p></div><div class="phones">{"".join(frames)}</div></main></body></html>'
    page(name, body, template=template, app=app, widths=(390, 1280))


if __name__ == '__main__':
    gallery('app-tienda.html', 'App de la tienda', 'shop-native: barra inferior de 5 pestañas, pila con «atrás». Claro y oscuro (sigue el ajuste del teléfono).',
            [shop_home(), shop_home('dark'), shop_product(), shop_product('dark'), shop_product_big(), shop_order(), shop_order('dark'), shop_account(), shop_signin()],
            'T1, T3, T5, T11, T13 en el teléfono (claro y oscuro)', 'shop-native')
    gallery('app-vende.html', 'App vende', 'seller-native: barra cacao con la tienda, 5 pestañas, Tienda y Equipo dentro de Cuenta.',
            [seller_home(), seller_home('dark'), seller_orders()], 'T6, T7 en el teléfono del vendedor', 'seller-native')
    gallery('app-ruta.html', 'App ruta', 'driver-native: solo pila, barra añil, la acción principal fija abajo. Claro y oscuro.',
            [driver_list(), driver_stop(), driver_stop('dark'), driver_stop_android(), driver_permission()], 'T16, T14 (permiso) en el teléfono del repartidor; una pantalla en Android', 'driver-native')
    gallery('app-bodega.html', 'App bodega', 'warehouse-native: solo pila, barra cal con regla, cámara y escáner de mano.',
            [warehouse_home(), warehouse_scan(), warehouse_refused(), warehouse_refused('dark')], 'T6, T17 en el teléfono de la bodega', 'warehouse-native')
