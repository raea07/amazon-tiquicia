import { brand } from "@yuntera/brand";
import { describe, expect, it } from "vitest";
import { legalName, supportEmail } from "../brand.ts";
import type { RenderedEmail } from "../types.ts";
import { authEmails } from "./auth.ts";
import { channelsOf, TEMPLATE_NAMES, type Vars } from "./catalog.ts";
import { CommercialConsentMissing, renderCommercialEmail } from "./commercial.ts";
import { render } from "./render.ts";

const links = {
  shop: "https://www.yuntera.cr",
  seller: "https://vende.yuntera.cr",
  ops: "https://central.yuntera.cr",
  field: "https://ruta.yuntera.cr",
};
const sender = {
  legalName: "Yuntera S.A.",
  legalId: "cédula jurídica 3-101-000000",
  postalAddress: "San José, Costa Rica",
  replyTo: "ayuda@yuntera.cr",
};

// Data the database never hands over, planted anyway: none of it may come out.
const SECRET = {
  delivery_pin: "4827",
  ship_senas: "Casa verde 200 m norte de la iglesia",
  id_number: "112340567",
  card_last4: "4242",
  sinpe_reference: "YT9Q2K",
};

const realistic: Vars = {
  order_number: "YT-100123",
  order_status: "confirmed",
  total_minor: 2_980_000,
  payment_method: "sinpe_movil",
  paid: false,
  promise_earliest: "2026-11-24",
  promise_latest: "2026-11-26",
  withdrawal_deadline: "2026-12-07",
  warranty_until: "2027-01-08",
  delivered_at: "2026-11-25T18:00:00Z",
  items: [
    {
      title: "Café molido de altura Tarrazú 340 g",
      variant: "",
      quantity: 2,
      line_total_minor: 990_000,
    },
    {
      title: "Audífonos inalámbricos Nimbo Aire",
      variant: "Negro",
      quantity: 1,
      line_total_minor: 1_990_000,
    },
  ],
  tracking_code: "YT-P-500123",
  attempt_count: 1,
  cash_due_minor: 0,
  service_date: "2026-11-25",
  reason: "nobody_home",
  shop_name: "TecnoCasa",
  line_count: 1,
  unit_count: 2,
  fulfillment: "seller",
  amount_minor: 990_000,
  return_ref: "1A2B3C4D",
  return_kind: "withdrawal",
  return_title: "Café molido",
  complaint_ref: "9F8E7D6C",
  closed: true,
  report_ref: "ABCDEF12",
  target_type: "product",
  report_reason: "counterfeit",
  report_status: "actioned",
  product_title: "Lámpara de mesa de bambú",
  rejection_reason: "Las fotos no muestran el producto.",
  status: "active",
  note: "Datos verificados.",
  route_code: "R-20261125-01",
  stop_count: 12,
  invitation_role: "staff",
  invitation_expires_at: "2026-12-05T18:00:00Z",
  change_kind: "contact",
  approved: true,
  decision_note: "Confirmamos el cambio por teléfono.",
  paid_at: "2026-11-28T15:00:00Z",
  offer_count: 2,
  paused_offers: [
    { title: "Bombillo LED 9 W (4 u.)", variant: "", min_price_minor: 612_345 },
    { title: "Libreta de tapa dura A5", variant: "Azul", min_price_minor: 455_000 },
  ],
  ...SECRET,
};

const HOSTILE = `<script>alert("x")</script><img src=x onerror=alert(1)>{{ evil }}{% raw %}\u0000\n`;
const hostile: Vars = Object.fromEntries(
  Object.entries(realistic).map(([key, value]) => [
    key,
    typeof value === "string" && !/(_at|_until|_deadline|_date|earliest|latest)$/.test(key)
      ? `${value}${HOSTILE}`
      : key === "items"
        ? [{ title: HOSTILE, variant: HOSTILE, quantity: 1, line_total_minor: 1 }]
        : value,
  ]),
);

const informal =
  /\b(tú|tu pedido|tu cuenta|tus|vos|tenés|podés|querés|revisá|puedes|tienes|quieres)\b/i;

function allText(rendered: ReturnType<typeof render>): string {
  switch (rendered.channel) {
    case "email":
      return `${rendered.subject}\n${rendered.html}\n${rendered.text}`;
    case "whatsapp":
      return JSON.stringify(rendered.parameters);
    case "sms":
      return rendered.text;
    case "push":
      return `${rendered.title}\n${rendered.body}\n${JSON.stringify(rendered.data)}`;
  }
}

describe("every template on every channel", () => {
  it("has the templates of section 8", () => {
    // 26 of section 8, 9 added with migration 083200 (followups.ts) and 1
    // with migration 083600 (seller_offers_paused_edit, also in followups.ts).
    expect(TEMPLATE_NAMES).toHaveLength(36);
    expect(channelsOf("shipment_out_for_delivery")).toEqual(["email", "push", "whatsapp", "sms"]);
    expect(channelsOf("seller_new_order")).toEqual(["email", "push", "whatsapp"]);
    expect(channelsOf("order_placed")).toContain("whatsapp");
  });

  for (const template of TEMPLATE_NAMES) {
    for (const channel of channelsOf(template)) {
      for (const [label, vars] of [
        ["realistic", realistic],
        ["hostile", hostile],
      ] as const) {
        it(`${template} · ${channel} · ${label} data`, () => {
          const name = label === "hostile" ? `Ana${HOSTILE}` : "Ana";
          const rendered = render({ template, channel, vars, name, links, sender });
          const text = allText(rendered);

          for (const secret of Object.values(SECRET)) expect(text).not.toContain(secret);
          expect(text).not.toContain("\u0000");
          expect(text).not.toMatch(informal);
          if (label === "realistic") expect(text).not.toContain("{{");
          if (rendered.channel === "email") {
            expect(rendered.subject.length).toBeGreaterThan(5);
            expect(rendered.html).toContain('lang="es-CR"');
            // Sender identification on every e-mail (Decreto 35205 art. 32 a).
            expect(rendered.text).toContain(sender.legalName);
            expect(rendered.text).toContain(sender.replyTo);
            expect(rendered.html).toContain(sender.postalAddress);
            // Markup only from our layout: a person's text arrives escaped. (The
            // plain-text part and the other channels are not HTML, so their
            // characters are shown as written.)
            expect(rendered.html).not.toContain("<script");
            expect(rendered.html).not.toMatch(/<img/i);
            expect(rendered.subject).not.toMatch(/[\r\n]/);
            if (label === "hostile") expect(rendered.html).toContain("&lt;script&gt;");
          }
          if (rendered.channel === "whatsapp") {
            for (const value of Object.values(rendered.parameters)) {
              expect(value).not.toMatch(/[\n\t]| {4,}/);
              expect(value.length).toBeGreaterThan(0);
            }
          }
          if (rendered.channel === "sms") {
            expect(rendered.text.length).toBeLessThanOrEqual(300);
            if (label === "realistic") expect(rendered.text).toMatch(/^[\x20-\x7e]+$/); // GSM-7 safe
          }
          if (rendered.channel === "push") {
            expect(new TextEncoder().encode(JSON.stringify(rendered)).length).toBeLessThan(4096);
            expect(rendered.data.url?.startsWith("/")).toBe(true);
          }
        });
      }
    }
  }

  it("tells a shopper waiting to pay where to find the instructions, without the payment details", () => {
    const email = render({
      template: "order_placed",
      channel: "email",
      vars: realistic,
      name: "Ana",
      links,
      sender,
    }) as RenderedEmail;
    expect(email.text).toContain("instrucciones de la página del pedido");
    expect(email.text).toContain("https://www.yuntera.cr/pedidos/YT-100123");
    expect(email.text).toContain("₡29 800");
    expect(email.text).toContain("desistir de la compra hasta el 7 de diciembre de 2026");
  });

  it("thanks a cash-on-delivery shopper at the door instead of saying the order is being prepared", () => {
    const cod = {
      ...realistic,
      payment_method: "cash_on_delivery",
      paid: true,
      order_status: "delivered",
    };
    for (const channel of ["email", "push"] as const) {
      const text = allText(
        render({
          template: "payment_received",
          channel,
          vars: cod,
          name: "Ana",
          links,
          sender,
        }),
      );
      expect(text).toContain("efectivo");
      expect(text).not.toMatch(/preparando|Le llega|tenga a mano/i);
    }
    // Paid ahead (SINPE Móvil, card): the order is still to be prepared and delivered.
    const ahead = allText(
      render({
        template: "payment_received",
        channel: "email",
        vars: { ...realistic, paid: true },
        name: "Ana",
        links,
        sender,
      }),
    );
    expect(ahead).toContain("Ya lo estamos preparando");
  });

  it("never asks for the delivery code, only tells the shopper to have it ready", () => {
    const sms = render({
      template: "shipment_out_for_delivery",
      channel: "sms",
      vars: realistic,
      name: "Ana",
      links,
      sender,
    });
    expect(allText(sms)).toMatch(/Tenga a mano el codigo de entrega/);
  });

  it("shows a seller only their shop's lines", () => {
    const email = render({
      template: "seller_new_order",
      channel: "email",
      vars: realistic,
      name: "TecnoCasa",
      links,
      sender,
    }) as RenderedEmail;
    expect(email.subject).toBe("Pedido nuevo para TecnoCasa: YT-100123");
    expect(email.text).not.toContain("Ana");
  });
});

describe("account e-mails from the Auth hook", () => {
  const payload = (type: string, extra: Record<string, string> = {}) => ({
    user: { id: "u1", email: "ana@correo.cr", new_email: "ana.nueva@correo.cr" },
    email_data: {
      token: "305805",
      token_hash: "hash-a",
      redirect_to: "https://www.yuntera.cr/auth/confirm",
      email_action_type: type,
      site_url: "https://www.yuntera.cr",
      ...extra,
    },
  });

  it("links a sign-up confirmation with the token hash flow", () => {
    const [mail] = authEmails(payload("signup"), sender);
    expect(mail?.to).toBe("ana@correo.cr");
    expect(mail?.rendered.text).toContain(
      "https://www.yuntera.cr/auth/confirm?token_hash=hash-a&type=email",
    );
    expect(mail?.rendered.text).toContain("305805");
  });

  it("always links the one verifying route, on the origin the person came from", () => {
    const linkOf = (redirect_to: string) =>
      /https?:\/\/\S+token_hash=\S+/.exec(
        authEmails(payload("recovery", { redirect_to }), sender)[0]?.rendered.text ?? "",
      )?.[0];
    expect(linkOf("https://vender.yuntera.cr/cuenta?x=1")).toBe(
      "https://vender.yuntera.cr/auth/confirm?token_hash=hash-a&type=recovery",
    );
    expect(linkOf("/pagar")).toBe(
      "https://www.yuntera.cr/auth/confirm?token_hash=hash-a&type=recovery",
    );
    expect(linkOf("javascript:alert(1)")).toBe(
      "https://www.yuntera.cr/auth/confirm?token_hash=hash-a&type=recovery",
    );
  });

  it("crosses the hashes for a secure e-mail change", () => {
    const mails = authEmails(
      payload("email_change", { token_new: "999111", token_hash_new: "hash-b" }),
      sender,
    );
    expect(mails.map((m) => m.to)).toEqual(["ana@correo.cr", "ana.nueva@correo.cr"]);
    expect(mails[0]?.rendered.text).toContain("token_hash=hash-b");
    expect(mails[0]?.rendered.text).toContain("305805");
    expect(mails[1]?.rendered.text).toContain("token_hash=hash-a");
    expect(mails[1]?.rendered.text).toContain("999111");
  });

  it("answers an unknown action with a plain notice instead of failing", () => {
    const [mail] = authEmails(payload("something_new_in_auth"), sender);
    expect(mail?.template).toBe("auth_security_notice");
    expect(authEmails(payload("recovery"), sender)[0]?.rendered.subject).toMatch(/contraseña/);
  });
});

describe("commercial messages", () => {
  const input = {
    label: "Publicidad" as const,
    subject: "Café de temporada",
    paragraphs: ["Llegó el café de la nueva cosecha."],
    unsubscribeUrl: "https://www.yuntera.cr/baja/abc",
  };

  it("cannot be built without a recorded consent", () => {
    expect(() => renderCommercialEmail(input, sender, { granted: false })).toThrow(
      CommercialConsentMissing,
    );
  });

  it("carries what the law asks for", () => {
    const mail = renderCommercialEmail(input, sender, { granted: true });
    expect(mail.subject.startsWith("Publicidad: ")).toBe(true);
    expect(mail.text.startsWith("Publicidad")).toBe(true);
    expect(mail.text).toContain(input.unsubscribeUrl);
    expect(mail.text).toContain("sin costo");
    expect(mail.text).toContain(sender.legalName);
    expect(mail.text).toContain(sender.replyTo);
    expect(mail.headers["List-Unsubscribe"]).toContain(input.unsubscribeUrl);
    expect(mail.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });
});

it("keeps its copy of the brand in step with packages/brand", () => {
  expect(legalName).toBe(brand.legalName);
  expect(supportEmail).toBe(brand.support.email);
});
