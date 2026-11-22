/**
 * Messages for events that had no consumer until migration 083200: a
 * return's goods back at the warehouse, a delivery code locked and released,
 * an invitation to join a shop, a decided change of a shop's details or
 * payout account, a payout paid, and offers paused by a fee change.
 *
 * Same rules as catalog.ts: Spanish, usted, plain and specific; never the
 * delivery code, an address, an identification number or payment details
 * (no account number, no bank reference: a payout says how much and when,
 * and the seller centre shows the rest); nothing promotional.
 */

import { clean, colones, fullDate, longDate } from "../format.ts";
import type { Copy, Links, TemplateInput, Vars } from "./catalog.ts";

type Template = (input: TemplateInput) => Copy;

const s = (value: unknown) => (typeof value === "string" ? value : "");
const n = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

const orderNumber = (v: Vars) => clean(s(v.order_number), 20);
const orderUrl = (v: Vars, links: Links) =>
  `${links.shop}/pedidos/${encodeURIComponent(orderNumber(v))}`;
const hello = (name: string | null) => (name ? `Hola, ${clean(name, 40)}:` : "Hola:");
const shopHello = (v: Vars, name: string | null) => `Hola, ${clean(s(v.shop_name) || name, 60)}:`;

const ORDER_FOOTER =
  "Este mensaje es sobre un pedido que usted hizo en Yuntera. Para cualquier duda, responda a este correo.";
const SELLER_FOOTER = "Recibe este mensaje porque su tienda vende en Yuntera.";

const CHANGE_KIND: Record<string, string> = {
  shop_name: "el nombre de su tienda",
  fiscal: "los datos fiscales de su tienda",
  contact: "el correo y el teléfono de contacto de su tienda",
  description: "la descripción de su tienda",
  logo: "el logotipo de su tienda",
};

const ROLE: Record<string, string> = {
  admin: "administrador",
  staff: "colaborador",
};

export const FOLLOWUP_TEMPLATES: Record<string, Template> = {
  // ── Shopper ───────────────────────────────────────────────────────────────

  return_goods_received: ({ vars: v, name, links }) => {
    const number = orderNumber(v);
    const ref = clean(s(v.return_ref), 12);
    const title = clean(s(v.return_title), 90);
    return {
      from: "orders",
      subject: `Recibimos el producto de su devolución ${ref}`,
      preheader: "Su reembolso va en camino.",
      greeting: hello(name),
      paragraphs: [
        `Ya tenemos en nuestra bodega ${title ? `«${title}»` : "el producto"} de su devolución ${ref}, del pedido ${number}.`,
        "Su reembolso va en camino, por el mismo medio con que pagó. Le avisaremos cuando el dinero haya salido; según su banco puede tardar unos días hábiles en verse en su cuenta.",
      ],
      facts: [
        ["Solicitud", ref],
        ["Pedido", number],
      ],
      action: { label: "Ver el pedido", url: orderUrl(v, links) },
      note: ORDER_FOOTER,
      push: {
        title: "Recibimos su devolución",
        body: `Solicitud ${ref}: su reembolso va en camino.`,
        url: `/pedidos/${number}`,
      },
    };
  },

  delivery_code_locked: ({ vars: v, name, links }) => {
    const number = orderNumber(v);
    return {
      from: "orders",
      subject: `Bloqueamos el código de entrega de su pedido ${number}`,
      preheader: "Por su seguridad, nadie puede recibir el pedido por ahora.",
      greeting: hello(name),
      paragraphs: [
        `En la entrega de su pedido ${number} se escribió un código equivocado varias veces, así que lo bloqueamos: por ahora nadie puede recibir el paquete, ni siquiera con el código correcto.`,
        "Nuestro equipo de atención lo va a contactar para revisarlo con usted. Cuando lo liberemos, en la página del pedido verá un código nuevo; el anterior ya no sirve.",
        "Nadie de Yuntera le va a pedir el código por teléfono ni por mensaje. Si alguien se lo pide, no lo dé y responda a este correo.",
      ],
      action: { label: "Ver el pedido", url: orderUrl(v, links) },
      note: ORDER_FOOTER,
      push: {
        title: "Código de entrega bloqueado",
        body: `${number}: lo contactaremos para entregarlo con un código nuevo.`,
        url: `/pedidos/${number}`,
        priority: "high",
      },
    };
  },

  delivery_code_released: ({ vars: v, name, links }) => {
    const number = orderNumber(v);
    return {
      from: "orders",
      subject: `Su pedido ${number} tiene un código de entrega nuevo`,
      preheader: "Está en la página del pedido; el anterior ya no sirve.",
      greeting: hello(name),
      paragraphs: [
        `Liberamos la entrega de su pedido ${number} con un código de entrega nuevo. Lo encuentra en la página del pedido; solo usted lo ve.`,
        "El código anterior ya no sirve. Cuando llegue el repartidor, dígale el nuevo en la puerta, no antes.",
      ],
      action: { label: "Ver el código en el pedido", url: orderUrl(v, links) },
      note: ORDER_FOOTER,
      push: {
        title: "Código de entrega nuevo",
        body: `${number}: véalo en la página del pedido.`,
        url: `/pedidos/${number}`,
      },
    };
  },

  // ── Someone invited to a shop ─────────────────────────────────────────────

  seller_invitation: ({ vars: v, name, links }) => {
    const shop = clean(s(v.shop_name), 60) || "una tienda";
    const role = ROLE[s(v.invitation_role)] ?? "colaborador";
    const until = fullDate(v.invitation_expires_at);
    return {
      from: "sellers",
      subject: `${shop} lo invita a su equipo en Yuntera`,
      preheader: "Acepte o rechace la invitación en Yuntera Vende.",
      greeting: hello(name),
      paragraphs: [
        `${shop} lo invitó a unirse a su equipo en Yuntera Vende como ${role}.`,
        `Para aceptar o rechazar, ingrese a Yuntera Vende con esta misma cuenta y abra «Invitaciones»${until ? `; la invitación vence el ${until}` : ""}. Si no conoce esta tienda, no haga nada: sin su respuesta nadie lo agrega.`,
      ],
      action: { label: "Ver la invitación", url: `${links.seller}/invitaciones` },
      note: "Recibe este mensaje porque una tienda de Yuntera escribió el correo de su cuenta al invitarlo.",
      push: {
        title: "Invitación a una tienda",
        body: `${shop} lo invita a su equipo.`,
        url: "/invitaciones",
      },
    };
  },

  // ── Sellers ───────────────────────────────────────────────────────────────

  seller_change_decided: ({ vars: v, name, links }) => {
    const what = CHANGE_KIND[s(v.change_kind)] ?? "los datos de su tienda";
    const approved = v.approved === true;
    const note = clean(s(v.decision_note), 400);
    return {
      from: "sellers",
      subject: approved
        ? "Aprobamos el cambio que pidió para su tienda"
        : "No aprobamos el cambio que pidió para su tienda",
      preheader: approved ? "Ya está aplicado." : "Vea el motivo en Yuntera Vende.",
      greeting: shopHello(v, name),
      paragraphs: [
        approved
          ? `Revisamos y aprobamos su solicitud para cambiar ${what}. El cambio ya está aplicado.`
          : `Revisamos su solicitud para cambiar ${what} y no la pudimos aprobar. Los datos siguen como estaban.`,
        note ? `Nota del equipo: ${note}` : "",
        approved ? "" : "Puede corregirla y enviarla de nuevo desde la cuenta de su tienda.",
      ].filter(Boolean),
      action: { label: "Ir a la cuenta de la tienda", url: `${links.seller}/cuenta` },
      note: SELLER_FOOTER,
      push: {
        title: approved ? "Cambio aprobado" : "Cambio no aprobado",
        body: approved ? "Ya está aplicado en su tienda." : "Vea el motivo en Yuntera Vende.",
        url: "/cuenta",
      },
    };
  },

  seller_payout_account_decided: ({ vars: v, name, links }) => {
    const approved = v.approved === true;
    const note = clean(s(v.decision_note), 400);
    return {
      from: "sellers",
      subject: approved
        ? "Aprobamos la cuenta para sus pagos"
        : "No aprobamos la cuenta que envió para sus pagos",
      preheader: approved
        ? "Los próximos pagos van a esa cuenta."
        : "Vea el motivo en Yuntera Vende.",
      greeting: shopHello(v, name),
      paragraphs: [
        approved
          ? "Verificamos y aprobamos la cuenta bancaria que nos envió. Los próximos pagos de su tienda se depositan en ella."
          : "Revisamos la cuenta bancaria que nos envió y no la pudimos aprobar. Sus pagos siguen yendo a la cuenta aprobada anterior, si la hay.",
        note ? `Nota del equipo: ${note}` : "",
        approved
          ? "Si usted no pidió este cambio, responda a este correo de inmediato."
          : "Puede enviar los datos de nuevo desde la sección de pagos.",
      ].filter(Boolean),
      action: { label: "Ver sus pagos", url: `${links.seller}/pagos` },
      note: SELLER_FOOTER,
      push: {
        title: approved ? "Cuenta de pagos aprobada" : "Cuenta de pagos no aprobada",
        body: approved ? "Los próximos pagos van a esa cuenta." : "Vea el motivo en Yuntera Vende.",
        url: "/pagos",
      },
    };
  },

  seller_payout_paid: ({ vars: v, name, links }) => {
    const amount = colones(n(v.amount_minor));
    const day = longDate(v.paid_at);
    return {
      from: "sellers",
      subject: `Le pagamos ${amount}`,
      preheader: "La transferencia ya salió hacia su cuenta.",
      greeting: shopHello(v, name),
      paragraphs: [
        `Hicimos la transferencia de ${amount} a la cuenta aprobada de su tienda${day ? ` el ${day}` : ""}.`,
        "Según su banco, puede tardar hasta un día hábil en verse. El detalle de lo que incluye está en la sección de pagos.",
      ],
      facts: [["Monto", amount]],
      action: { label: "Ver sus pagos", url: `${links.seller}/pagos` },
      note: SELLER_FOOTER,
      push: { title: "Pago enviado", body: `Le transferimos ${amount}.`, url: "/pagos" },
    };
  },

  seller_offers_paused_fees: ({ vars: v, name, links }) => {
    // The shop's whole list as the database sees it when the message is
    // written; the count in the event is only what one re-check paused.
    const count = Math.max(1, n(v.paused_count) || n(v.offer_count));
    const one = count === 1;
    // What each paused offer needs to cover the fees now.
    const offers = (Array.isArray(v.paused_offers) ? v.paused_offers : [])
      .slice(0, 20)
      .map((raw): [string, string] => {
        const offer = (raw ?? {}) as Vars;
        const variant = clean(s(offer.variant), 40);
        const title = clean(s(offer.title), 90) + (variant ? ` (${variant})` : "");
        const minimum = n(offer.min_price_minor);
        return [
          title,
          minimum > 0
            ? `precio mínimo ${colones(Math.ceil(minimum / 100) * 100)}`
            : "revise el precio",
        ];
      });
    const what = one ? "una de sus ofertas" : `${count} de sus ofertas`;
    return {
      from: "sellers",
      subject: `Pausamos ${what} por el cambio de comisiones`,
      preheader: one
        ? "Suba el precio para volver a venderla."
        : "Suba el precio para volver a venderlas.",
      greeting: shopHello(v, name),
      paragraphs: [
        one
          ? "Cambiaron las comisiones y costos de Yuntera, y con el precio actual esta oferta ya no cubre lo que cuesta venderla: cada venta le dejaría una deuda en lugar de un pago. Por eso la pausamos; nadie la puede comprar mientras tanto."
          : "Cambiaron las comisiones y costos de Yuntera, y con el precio actual estas ofertas ya no cubren lo que cuesta venderlas: cada venta le dejaría una deuda en lugar de un pago. Por eso las pausamos; nadie las puede comprar mientras tanto.",
        one
          ? "Para volver a venderla, ponga en Yuntera Vende un precio igual o mayor al mínimo que indicamos y actívela. Si prefiere no hacerlo, puede quedar en pausa."
          : "Para volver a venderlas, ponga en Yuntera Vende un precio igual o mayor al mínimo que indicamos y actívelas. Si prefiere no hacerlo, pueden quedar en pausa.",
      ],
      facts: offers,
      action: { label: "Ver sus productos", url: `${links.seller}/productos` },
      note: SELLER_FOOTER,
      push: {
        title: one ? "Oferta en pausa" : "Ofertas en pausa",
        body: one
          ? "Una oferta: suba el precio para venderla."
          : `${count} ofertas: suba el precio para venderlas.`,
        url: "/productos",
      },
    };
  },

  // ── Staff ─────────────────────────────────────────────────────────────────

  staff_delivery_code_locked: ({ vars: v, links }) => ({
    from: "orders",
    subject: `Código de entrega bloqueado: ${orderNumber(v)}`,
    preheader: "Contacte al cliente antes de liberarlo.",
    greeting: null,
    paragraphs: [
      `El código de entrega del pedido ${orderNumber(v)} se bloqueó tras varios intentos equivocados en la puerta. Llame al cliente, confirme que todo está bien y libérelo desde el pedido: el cliente recibe un código nuevo en su página.`,
    ],
    action: { label: "Abrir el pedido", url: `${links.ops}/pedidos/${orderNumber(v)}` },
  }),
};
