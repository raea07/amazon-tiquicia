/**
 * What each message says: one entry per template (section 8 of the research
 * note), written once and rendered for each channel by ./render.ts.
 *
 * Rules every entry follows:
 *   - Spanish, usted, plain and specific: what happened and what to do next.
 *   - Never the delivery code, an address, an identification number or
 *     payment details. For those the message points to the order page.
 *   - Nothing promotional: a promotional line would make the whole message
 *     commercial (Decreto 37899 art. 200; Meta's template categories).
 *   - Variables are data from the database; text a person wrote (a shop name,
 *     a product title, a note) is cleaned here and escaped when rendered.
 */

import { clean, colones, fullDate, longDate } from "../format.ts";

export type Vars = Record<string, unknown>;

export interface Links {
  shop: string;
  seller: string;
  ops: string;
  field: string;
}

export interface Copy {
  /** Which sender address. */
  from: "orders" | "account" | "sellers";
  subject: string;
  /** Short line shown by mail apps after the subject. */
  preheader: string;
  greeting: string | null;
  paragraphs: string[];
  facts?: Array<[string, string]>;
  items?: Array<{ title: string; quantity: number; amount: string }>;
  action?: { label: string; url: string };
  /** Small print under the action. */
  note?: string;
  push?: { title: string; body: string; url: string; priority?: "high"; ttlSeconds?: number };
  /** WhatsApp: an approved template's slug and its parameters (see whatsapp/*.json). */
  whatsapp?: { slug: string; parameters: Record<string, string> };
  sms?: string;
}

export interface TemplateInput {
  vars: Vars;
  /** First name of a person, or the shop's name. */
  name: string | null;
  links: Links;
}

const s = (value: unknown) => (typeof value === "string" ? value : "");
const n = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

export const PAYMENT_METHOD: Record<string, string> = {
  card: "tarjeta",
  sinpe_movil: "SINPE Móvil",
  cash_on_delivery: "efectivo contra entrega",
  bank_transfer: "transferencia bancaria",
};

export const FAILURE_REASON: Record<string, string> = {
  nobody_home: "no había nadie para recibirlo",
  wrong_address: "no encontramos la dirección",
  refused: "el pedido fue rechazado en la entrega",
  cannot_pay: "no se pudo completar el pago contra entrega",
  unsafe: "no era seguro llegar al lugar",
  damaged: "el paquete se dañó en el camino",
  other: "no se pudo completar la entrega",
};

const SELLER_STATUS: Record<string, string> = {
  pending: "en revisión",
  active: "activa",
  suspended: "suspendida",
  closed: "cerrada",
};

const RETURN_KIND: Record<string, string> = {
  withdrawal: "desistimiento de la compra",
  warranty: "garantía",
  damaged: "producto dañado",
  wrong_item: "producto equivocado",
};

const REPORT_TARGET: Record<string, string> = {
  product: "un producto",
  review: "una reseña",
  seller: "un vendedor",
};

const orderNumber = (v: Vars) => clean(s(v.order_number), 20);
const orderUrl = (v: Vars, links: Links) =>
  `${links.shop}/pedidos/${encodeURIComponent(orderNumber(v))}`;
const sellerOrdersUrl = (links: Links) => `${links.seller}/pedidos`;
const hello = (name: string | null) => (name ? `Hola, ${clean(name, 40)}:` : "Hola:");
const items = (v: Vars) =>
  (Array.isArray(v.items) ? v.items : []).slice(0, 40).map((raw) => {
    const item = (raw ?? {}) as Vars;
    const variant = clean(s(item.variant), 40);
    return {
      title: clean(s(item.title), 90) + (variant ? ` (${variant})` : ""),
      quantity: n(item.quantity),
      amount: colones(n(item.line_total_minor)),
    };
  });

const window = (v: Vars) => {
  const earliest = s(v.promise_earliest);
  const latest = s(v.promise_latest);
  if (!latest) return "";
  return earliest && earliest !== latest
    ? `entre el ${longDate(earliest)} y el ${longDate(latest)}`
    : `el ${longDate(latest)}`;
};

const cashDue = (v: Vars) => (n(v.cash_due_minor) > 0 ? colones(n(v.cash_due_minor)) : null);

const ORDER_FOOTER =
  "Este mensaje es sobre un pedido que usted hizo en Yuntera. Para cualquier duda, responda a este correo.";

type Template = (input: TemplateInput) => Copy;

export const TEMPLATES: Record<string, Template> = {
  // ── Shopper: the order ────────────────────────────────────────────────────

  order_placed: ({ vars: v, name, links }) => {
    const number = orderNumber(v);
    const method = s(v.payment_method);
    const waitingForTransfer = !v.paid && (method === "sinpe_movil" || method === "bank_transfer");
    return {
      from: "orders",
      subject: `Recibimos su pedido ${number}`,
      preheader: waitingForTransfer
        ? "Falta el pago: siga las instrucciones en la página del pedido."
        : `Llega ${window(v)}.`,
      greeting: hello(name),
      paragraphs: [
        `Recibimos su pedido ${number} por ${colones(n(v.total_minor))}.`,
        waitingForTransfer
          ? `Para completarlo, pague por ${PAYMENT_METHOD[method]} siguiendo las instrucciones de la página del pedido. Guardamos sus productos por 30 minutos; si el pago no llega, el pedido se cancela solo y no se le cobra nada.`
          : method === "cash_on_delivery"
            ? "Pagará en efectivo cuando lo reciba. Le avisaremos el día de la entrega."
            : "Le avisaremos cuando salga hacia usted.",
        `Le llega ${window(v)}.`,
      ],
      items: items(v),
      facts: [
        ["Pedido", number],
        ["Total", colones(n(v.total_minor))],
        ["Forma de pago", PAYMENT_METHOD[method] ?? "—"],
      ],
      action: { label: "Ver el pedido", url: orderUrl(v, links) },
      note: v.withdrawal_deadline
        ? `Puede desistir de la compra hasta el ${fullDate(v.withdrawal_deadline)}, sin dar razones. ${ORDER_FOOTER}`
        : ORDER_FOOTER,
      push: {
        title: "Recibimos su pedido",
        body: waitingForTransfer
          ? `${number}: complete el pago en la página del pedido.`
          : `${number} llega ${window(v)}.`,
        url: `/pedidos/${number}`,
      },
      whatsapp: {
        slug: "order_placed",
        parameters: { first_name: name ?? "", order_number: number, button_url: number },
      },
    };
  },

  payment_received: ({ vars: v, name, links }) => {
    const number = orderNumber(v);
    return {
      from: "orders",
      subject: `Recibimos el pago de su pedido ${number}`,
      preheader: "Ya estamos preparando su pedido.",
      greeting: hello(name),
      paragraphs: [
        `Recibimos el pago de ${colones(n(v.total_minor))} por su pedido ${number}. Ya lo estamos preparando.`,
        `Le llega ${window(v)}. El día de la entrega tenga a mano el código de entrega: lo encuentra en la página del pedido, solo usted lo ve y nadie de Yuntera se lo va a pedir por teléfono ni por mensaje.`,
      ],
      facts: [
        ["Pedido", number],
        ["Pagado", colones(n(v.total_minor))],
        ["Forma de pago", PAYMENT_METHOD[s(v.payment_method)] ?? "—"],
      ],
      action: { label: "Ver el pedido", url: orderUrl(v, links) },
      note: ORDER_FOOTER,
      push: {
        title: "Pago recibido",
        body: `${number}: ya lo estamos preparando.`,
        url: `/pedidos/${number}`,
      },
    };
  },

  shipment_scheduled: ({ vars: v, name, links }) => {
    const number = orderNumber(v);
    const due = cashDue(v);
    const day = longDate(v.service_date) || window(v);
    return {
      from: "orders",
      subject: `Su pedido ${number} llega el ${day}`,
      preheader: "Ya tiene fecha de entrega.",
      greeting: hello(name),
      paragraphs: [
        `Su pedido ${number} ya tiene ruta: se lo entregamos el ${day}.`,
        due
          ? `Tenga listos ${due} en efectivo para pagar al recibirlo.`
          : "No tiene que pagar nada al recibirlo.",
        "Ese día tenga a mano el código de entrega que aparece en la página del pedido. Se lo dice al repartidor cuando reciba el paquete.",
      ],
      action: { label: "Seguir el pedido", url: orderUrl(v, links) },
      note: ORDER_FOOTER,
      push: {
        title: "Su pedido ya tiene fecha",
        body: `${number} llega el ${day}.`,
        url: `/pedidos/${number}`,
      },
    };
  },

  shipment_out_for_delivery: ({ vars: v, name, links }) => {
    const number = orderNumber(v);
    const due = cashDue(v);
    return {
      from: "orders",
      subject: `Su pedido ${number} va en camino`,
      preheader: "Llega hoy.",
      greeting: hello(name),
      paragraphs: [
        `Su pedido ${number} salió hoy con el repartidor y llega en el transcurso del día.`,
        due ? `Tenga listos ${due} en efectivo.` : "No tiene que pagar nada al recibirlo.",
        "Tenga a mano el código de entrega de la página del pedido: el repartidor se lo pedirá en la puerta, no antes.",
      ],
      action: { label: "Seguir el pedido", url: orderUrl(v, links) },
      note: ORDER_FOOTER,
      push: {
        title: "Su pedido va en camino",
        body: `${number} llega hoy. Tenga a mano el código de entrega.`,
        url: `/pedidos/${number}`,
        priority: "high",
        ttlSeconds: 4 * 3600,
      },
      whatsapp: {
        slug: "shipment_out_for_delivery",
        parameters: { first_name: name ?? "", order_number: number, button_url: number },
      },
      sms: `Yuntera: su pedido ${number} va en camino y llega hoy. Tenga a mano el codigo de entrega de la pagina del pedido.`,
    };
  },

  shipment_delivered: ({ vars: v, name, links }) => {
    const number = orderNumber(v);
    return {
      from: "orders",
      subject: `Entregamos su pedido ${number}`,
      preheader: "Gracias por comprar en Yuntera.",
      greeting: hello(name),
      paragraphs: [
        `Entregamos su pedido ${number}${v.delivered_at ? ` el ${longDate(v.delivered_at)}` : ""}.`,
        v.withdrawal_deadline
          ? `Si cambia de opinión, puede desistir de la compra hasta el ${fullDate(v.withdrawal_deadline)}, sin dar razones, desde la página del pedido.`
          : "Si algo no está bien, avísenos desde la página del pedido.",
        v.warranty_until
          ? `La garantía legal cubre los productos hasta el ${fullDate(v.warranty_until)}.`
          : "",
      ].filter(Boolean),
      action: { label: "Ver el pedido", url: orderUrl(v, links) },
      note: ORDER_FOOTER,
      push: { title: "Pedido entregado", body: `Entregamos ${number}.`, url: `/pedidos/${number}` },
    };
  },

  shipment_delivery_failed: ({ vars: v, name, links }) => {
    const number = orderNumber(v);
    const reason =
      FAILURE_REASON[s(v.reason) || s(v.failure_reason)] ?? "no se pudo completar la entrega";
    return {
      from: "orders",
      subject: `No pudimos entregar su pedido ${number}`,
      preheader: "Le diremos cuándo lo intentamos de nuevo.",
      greeting: hello(name),
      paragraphs: [
        `Hoy no pudimos entregar su pedido ${number}: ${reason}.`,
        "El paquete vuelve a nuestra bodega y lo intentamos de nuevo en los próximos días hábiles. Le avisaremos la fecha.",
        "Si algo de la entrega debe cambiar, escríbanos respondiendo a este correo.",
      ],
      action: { label: "Ver el pedido", url: orderUrl(v, links) },
      note: ORDER_FOOTER,
      push: {
        title: "No pudimos entregar su pedido",
        body: `${number}: lo intentamos de nuevo pronto.`,
        url: `/pedidos/${number}`,
        priority: "high",
      },
      whatsapp: {
        slug: "shipment_delivery_failed",
        parameters: { first_name: name ?? "", order_number: number, reason, button_url: number },
      },
      sms: `Yuntera: no pudimos entregar su pedido ${number}. Lo intentamos de nuevo pronto; le avisaremos la fecha.`,
    };
  },

  order_cancelled: ({ vars: v, name, links }) => {
    const number = orderNumber(v);
    return {
      from: "orders",
      subject: `Su pedido ${number} fue cancelado`,
      preheader: v.paid ? "Le devolvemos el dinero." : "No se le cobró nada.",
      greeting: hello(name),
      paragraphs: [
        `Su pedido ${number} fue cancelado.`,
        v.paid
          ? `Le devolvemos ${colones(n(v.total_minor))} por el mismo medio con que pagó. Le avisaremos cuando el reembolso esté hecho.`
          : "No se le cobró nada.",
      ],
      action: { label: "Ver el pedido", url: orderUrl(v, links) },
      note: ORDER_FOOTER,
      push: {
        title: "Pedido cancelado",
        body: `${number} fue cancelado.`,
        url: `/pedidos/${number}`,
      },
    };
  },

  refund_initiated: ({ vars: v, name, links }) => {
    const number = orderNumber(v);
    const amount = n(v.amount_minor) > 0 ? colones(n(v.amount_minor)) : null;
    return {
      from: "orders",
      subject: `Estamos devolviendo su dinero del pedido ${number}`,
      preheader: "El reembolso va en camino.",
      greeting: hello(name),
      paragraphs: [
        amount
          ? `Iniciamos el reembolso de ${amount} del pedido ${number}, por el mismo medio con que pagó.`
          : `Iniciamos el reembolso del pedido ${number}, por el mismo medio con que pagó.`,
        "Según su banco, el dinero puede tardar unos días hábiles en verse en su cuenta. Le avisaremos cuando esté hecho.",
      ],
      action: { label: "Ver el pedido", url: orderUrl(v, links) },
      note: ORDER_FOOTER,
    };
  },

  refund_completed: ({ vars: v, name, links }) => {
    const number = orderNumber(v);
    const amount = colones(n(v.amount_minor) || n(v.total_minor));
    return {
      from: "orders",
      subject: `Le devolvimos ${amount} del pedido ${number}`,
      preheader: "El reembolso está hecho.",
      greeting: hello(name),
      paragraphs: [
        `Hicimos el reembolso de ${amount} del pedido ${number}, por el mismo medio con que pagó.`,
        "Si en unos días hábiles no lo ve en su cuenta, respóndanos a este correo.",
      ],
      action: { label: "Ver el pedido", url: orderUrl(v, links) },
      note: ORDER_FOOTER,
      push: {
        title: "Reembolso hecho",
        body: `${number}: le devolvimos ${amount}.`,
        url: `/pedidos/${number}`,
      },
    };
  },

  return_received: ({ vars: v, name, links }) => {
    const number = orderNumber(v);
    const ref = clean(s(v.return_ref), 12);
    return {
      from: "orders",
      subject: `Recibimos su solicitud de devolución ${ref}`,
      preheader: "La revisamos en un máximo de 3 días hábiles.",
      greeting: hello(name),
      paragraphs: [
        `Recibimos su solicitud de devolución ${ref} (${RETURN_KIND[s(v.return_kind)] ?? "devolución"}) de ${clean(s(v.return_title), 90)}, del pedido ${number}.`,
        "La revisamos y le respondemos por este medio en un máximo de 3 días hábiles. No envíe el producto todavía: le diremos cómo hacerlo.",
      ],
      facts: [
        ["Solicitud", ref],
        ["Pedido", number],
      ],
      action: { label: "Ver el pedido", url: orderUrl(v, links) },
      note: ORDER_FOOTER,
    };
  },

  return_approved: ({ vars: v, name, links }) => {
    const number = orderNumber(v);
    const ref = clean(s(v.return_ref), 12);
    return {
      from: "orders",
      subject: `Aprobamos su devolución ${ref}`,
      preheader: "Le explicamos los siguientes pasos.",
      greeting: hello(name),
      paragraphs: [
        `Aprobamos su devolución ${ref} de ${clean(s(v.return_title), 90)}, del pedido ${number}.`,
        "Guarde el producto con sus accesorios. Coordinaremos la recolección con usted; cuando lo recibamos, le devolvemos el dinero por el mismo medio con que pagó.",
      ],
      action: { label: "Ver el pedido", url: orderUrl(v, links) },
      note: ORDER_FOOTER,
      push: {
        title: "Devolución aprobada",
        body: `Solicitud ${ref}, pedido ${number}.`,
        url: `/pedidos/${number}`,
      },
    };
  },

  return_rejected: ({ vars: v, name, links }) => {
    const number = orderNumber(v);
    const ref = clean(s(v.return_ref), 12);
    return {
      from: "orders",
      subject: `Su solicitud de devolución ${ref} no fue aprobada`,
      preheader: "Vea el motivo en la página del pedido.",
      greeting: hello(name),
      paragraphs: [
        `Revisamos su solicitud de devolución ${ref} del pedido ${number} y no la pudimos aprobar.`,
        "El motivo está en la página del pedido. Si no está de acuerdo, responda a este correo y la revisa otra persona del equipo. También puede presentar un reclamo ante la Comisión Nacional del Consumidor.",
      ],
      action: { label: "Ver el pedido", url: orderUrl(v, links) },
      note: ORDER_FOOTER,
      push: {
        title: "Devolución no aprobada",
        body: `Solicitud ${ref}: vea el motivo.`,
        url: `/pedidos/${number}`,
      },
    };
  },

  complaint_received: ({ vars: v, name, links }) => {
    const ref = clean(s(v.complaint_ref), 12);
    return {
      from: "orders",
      subject: `Recibimos su reclamo ${ref}`,
      preheader: "Le respondemos en un máximo de 10 días hábiles.",
      greeting: hello(name),
      paragraphs: [
        `Recibimos su reclamo ${ref}${v.order_number ? ` sobre el pedido ${orderNumber(v)}` : ""}.`,
        "Una persona del equipo lo revisa y le responde en un máximo de 10 días hábiles. Si necesita agregar algo, responda a este correo.",
      ],
      action: { label: "Ir a su cuenta", url: `${links.shop}/cuenta` },
      note: "Guarde este correo: es el comprobante de que presentó el reclamo.",
    };
  },

  complaint_answered: ({ vars: v, name, links }) => {
    const ref = clean(s(v.complaint_ref), 12);
    return {
      from: "orders",
      subject: `Respondimos su reclamo ${ref}`,
      preheader: v.closed ? "El reclamo quedó resuelto." : "Hay una respuesta para usted.",
      greeting: hello(name),
      paragraphs: [
        `Respondimos su reclamo ${ref}. La respuesta completa está en su cuenta.`,
        v.closed
          ? "Lo dimos por resuelto. Si no está de acuerdo, responda a este correo y lo volvemos a abrir. También puede acudir a la Comisión Nacional del Consumidor."
          : "Seguimos trabajando en él y le avisaremos de cada novedad.",
      ],
      action: { label: "Ver la respuesta", url: `${links.shop}/cuenta` },
      note: "Este mensaje es sobre un reclamo que usted presentó en Yuntera.",
    };
  },

  report_resolved: ({ vars: v, name }) => {
    const ref = clean(s(v.report_ref), 12);
    const actioned = s(v.report_status) === "actioned" || v.actioned === true;
    return {
      from: "orders",
      subject: `Revisamos su reporte ${ref}`,
      preheader: actioned ? "Tomamos medidas." : "No encontramos una infracción.",
      greeting: hello(name),
      paragraphs: [
        `Revisamos su reporte ${ref} sobre ${REPORT_TARGET[s(v.target_type)] ?? "un contenido"} de Yuntera.`,
        actioned
          ? "Encontramos que no cumplía nuestras reglas y lo retiramos o corregimos. Gracias por avisarnos."
          : "No encontramos que incumpliera nuestras reglas, así que se mantiene publicado. Si tiene más información, responda a este correo.",
      ],
      note: "Recibe este mensaje porque reportó un contenido en Yuntera.",
    };
  },

  // ── Sellers ───────────────────────────────────────────────────────────────

  seller_new_order: ({ vars: v, name, links }) => {
    const number = orderNumber(v);
    const shop = clean(s(v.shop_name) || name, 60);
    const units = n(v.unit_count);
    const own = s(v.fulfillment) === "seller";
    return {
      from: "sellers",
      subject: `Pedido nuevo para ${shop}: ${number}`,
      preheader: own ? "Prepárelo y márquelo como empacado." : "Sale de la bodega de Yuntera.",
      greeting: `Hola, ${shop}:`,
      paragraphs: [
        `Tiene un pedido nuevo, ${number}: ${units} ${units === 1 ? "unidad" : "unidades"} en ${n(v.line_count)} ${n(v.line_count) === 1 ? "producto" : "productos"}.`,
        own
          ? "Este pedido sale de su propia ubicación: empáquelo y márquelo como empacado en Yuntera Vende para que lo recojamos."
          : "Este pedido sale de la bodega de Yuntera con el inventario que usted nos envió. No tiene que hacer nada más.",
      ],
      items: items(v),
      action: { label: "Ver sus pedidos", url: sellerOrdersUrl(links) },
      note: "Recibe este mensaje porque su tienda vende en Yuntera.",
      push: {
        title: "Pedido nuevo",
        body: `${number}: ${units} ${units === 1 ? "unidad" : "unidades"}.`,
        url: "/pedidos",
      },
      whatsapp: {
        slug: "seller_new_order",
        parameters: {
          shop_name: shop,
          order_number: number,
          unit_count: String(units),
          button_url: "pedidos",
        },
      },
    };
  },

  seller_order_cancelled: ({ vars: v, name, links }) => {
    const number = orderNumber(v);
    const shop = clean(s(v.shop_name) || name, 60);
    return {
      from: "sellers",
      subject: `Pedido cancelado: ${number}`,
      preheader: "No lo despache.",
      greeting: `Hola, ${shop}:`,
      paragraphs: [
        `El pedido ${number} fue cancelado. Si todavía no lo despachó, no lo haga: el inventario reservado volvió a estar disponible.`,
        "Si ya lo había empacado, guárdelo; no se le cobra ninguna comisión por un pedido cancelado.",
      ],
      action: { label: "Ver sus pedidos", url: sellerOrdersUrl(links) },
      note: "Recibe este mensaje porque su tienda vende en Yuntera.",
      push: { title: "Pedido cancelado", body: `${number}: no lo despache.`, url: "/pedidos" },
    };
  },

  seller_listing_approved: ({ vars: v, name, links }) => {
    const shop = clean(name, 60);
    const title = clean(s(v.product_title), 90);
    return {
      from: "sellers",
      subject: `Publicamos su producto: ${title}`,
      preheader: "Ya está a la venta.",
      greeting: `Hola, ${shop}:`,
      paragraphs: [`Revisamos y publicamos «${title}». Ya está a la venta en Yuntera.`],
      action: { label: "Ver sus productos", url: `${links.seller}/productos` },
      note: "Recibe este mensaje porque su tienda vende en Yuntera.",
      push: { title: "Producto publicado", body: title, url: "/productos" },
    };
  },

  seller_listing_rejected: ({ vars: v, name, links }) => {
    const shop = clean(name, 60);
    const title = clean(s(v.product_title), 90);
    const reason = clean(s(v.rejection_reason), 400);
    return {
      from: "sellers",
      subject: `Su producto necesita cambios: ${title}`,
      preheader: "No lo pudimos publicar todavía.",
      greeting: `Hola, ${shop}:`,
      paragraphs: [
        `Revisamos «${title}» y todavía no lo pudimos publicar.`,
        reason ? `Lo que hay que cambiar: ${reason}` : "El motivo está en Yuntera Vende.",
        "Corríjalo en Yuntera Vende y vuelva a enviarlo a revisión.",
      ],
      action: { label: "Ver sus productos", url: `${links.seller}/productos` },
      note: "Recibe este mensaje porque su tienda vende en Yuntera.",
      push: { title: "Producto con cambios pendientes", body: title, url: "/productos" },
    };
  },

  seller_account_status: ({ vars: v, name, links }) => {
    const shop = clean(name, 60);
    const status = s(v.status);
    const note = clean(s(v.note), 400);
    return {
      from: "sellers",
      subject: `Su tienda en Yuntera está ${SELLER_STATUS[status] ?? "actualizada"}`,
      preheader: status === "active" ? "Ya puede vender." : "Vea los detalles.",
      greeting: `Hola, ${shop}:`,
      paragraphs: [
        status === "active"
          ? "Verificamos los datos de su tienda: ya está activa y sus productos aprobados se pueden vender."
          : `Su tienda quedó ${SELLER_STATUS[status] ?? "con un cambio de estado"}.`,
        note ? `Nota del equipo: ${note}` : "",
        status === "active" ? "" : "Si tiene preguntas, responda a este correo.",
      ].filter(Boolean),
      action: { label: "Ir a Yuntera Vende", url: links.seller },
      note: "Recibe este mensaje porque su tienda vende en Yuntera.",
    };
  },

  // ── Drivers ───────────────────────────────────────────────────────────────

  driver_route_assigned: ({ vars: v, name, links }) => ({
    from: "orders",
    subject: "Tiene una ruta asignada",
    preheader: "",
    greeting: hello(name),
    paragraphs: [
      `Le asignamos la ruta ${clean(s(v.route_code), 20)} del ${longDate(v.service_date)}, con ${n(v.stop_count)} paradas.`,
    ],
    action: { label: "Ver la ruta", url: `${links.field}/ruta` },
    push: {
      title: "Ruta asignada",
      body: `${longDate(v.service_date)}: ${n(v.stop_count)} paradas.`,
      url: "/ruta",
    },
  }),

  // ── Staff mailboxes ───────────────────────────────────────────────────────

  staff_payment_to_confirm: ({ vars: v, links }) => ({
    from: "orders",
    subject: `Pago por confirmar: ${orderNumber(v)}`,
    preheader: PAYMENT_METHOD[s(v.payment_method)] ?? "",
    greeting: null,
    paragraphs: [
      `El pedido ${orderNumber(v)} se pagará por ${PAYMENT_METHOD[s(v.payment_method)] ?? "transferencia"} (${colones(n(v.total_minor))}). Confírmelo en la consola solo cuando vea el dinero en el banco.`,
    ],
    action: { label: "Abrir el pedido", url: `${links.ops}/pedidos/${orderNumber(v)}` },
  }),

  staff_delivery_failed: ({ vars: v, links }) => ({
    from: "orders",
    subject: `Entrega fallida: ${orderNumber(v)}`,
    preheader: clean(s(v.tracking_code), 30),
    greeting: null,
    paragraphs: [
      `El paquete ${clean(s(v.tracking_code), 30)} del pedido ${orderNumber(v)} no se entregó: ${FAILURE_REASON[s(v.reason)] ?? FAILURE_REASON.other}. Intentos: ${n(v.attempt_count)}.`,
    ],
    action: { label: "Abrir el pedido", url: `${links.ops}/pedidos/${orderNumber(v)}` },
  }),

  staff_return_requested: ({ vars: v, links }) => ({
    from: "orders",
    subject: `Devolución solicitada: ${orderNumber(v)}`,
    preheader: clean(s(v.return_ref), 12),
    greeting: null,
    paragraphs: [
      `Nueva solicitud de devolución ${clean(s(v.return_ref), 12)} (${RETURN_KIND[s(v.return_kind)] ?? "devolución"}) en el pedido ${orderNumber(v)}.`,
    ],
    action: { label: "Ir a Atención", url: `${links.ops}/atencion` },
  }),

  staff_complaint_filed: ({ vars: v, links }) => ({
    from: "orders",
    subject: `Reclamo nuevo ${clean(s(v.complaint_ref), 12)}`,
    preheader: v.order_number ? orderNumber(v) : "",
    greeting: null,
    paragraphs: [
      `Se presentó el reclamo ${clean(s(v.complaint_ref), 12)}${v.order_number ? ` sobre el pedido ${orderNumber(v)}` : ""}. La ley da 10 días hábiles para responder.`,
    ],
    action: { label: "Ir a Atención", url: `${links.ops}/atencion` },
  }),

  staff_content_reported: ({ vars: v, links }) => ({
    from: "orders",
    subject: `Contenido reportado ${clean(s(v.report_ref), 12)}`,
    preheader: REPORT_TARGET[s(v.target_type)] ?? "",
    greeting: null,
    paragraphs: [
      `Se reportó ${REPORT_TARGET[s(v.target_type)] ?? "un contenido"} (${clean(s(v.report_reason), 40)}).`,
    ],
    action: { label: "Ir a Atención", url: `${links.ops}/atencion` },
  }),
};

export const TEMPLATE_NAMES = Object.keys(TEMPLATES).sort();

/** The channels each template can be rendered for. */
export function channelsOf(template: string): Array<"email" | "push" | "whatsapp" | "sms"> {
  const sample = TEMPLATES[template]?.({ vars: {}, name: null, links: SAMPLE_LINKS });
  if (!sample) return [];
  return [
    "email",
    ...(sample.push ? (["push"] as const) : []),
    ...(sample.whatsapp ? (["whatsapp"] as const) : []),
    ...(sample.sms ? (["sms"] as const) : []),
  ];
}

const SAMPLE_LINKS: Links = {
  shop: "https://www.example.test",
  seller: "https://vende.example.test",
  ops: "https://central.example.test",
  field: "https://ruta.example.test",
};
