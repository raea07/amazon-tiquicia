/**
 * The message added with migration 083700: catalogue staff changed one of the
 * shop's listings without going through the seller (topic
 * `product.staff_changed`). Three kinds, one template:
 *
 *   - corrected: the category or the brand was corrected; says what it was,
 *     what it is now, why, and what it means for the commission and the IVA;
 *   - taken_down: the listing was taken off the shop, with the reason;
 *   - restored: it is back on sale.
 *
 * Same rules as catalog.ts: Spanish, usted, plain and specific; nothing about
 * who in the team did it; nothing promotional.
 */

import { clean } from "../format.ts";
import type { Copy, TemplateInput } from "./catalog.ts";

type Template = (input: TemplateInput) => Copy;

const s = (value: unknown) => (typeof value === "string" ? value : "");
const n = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** 1200 basis points as "12 %", 50 as "0,5 %". */
export function percent(bps: number): string {
  const value = bps / 100;
  const text = Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "");
  return `${text.replace(".", ",")} %`;
}

const SELLER_FOOTER = "Recibe este mensaje porque su tienda vende en Yuntera.";

export const STAFF_CATALOGUE_TEMPLATES: Record<string, Template> = {
  seller_listing_staff_change: ({ vars: v, name, links }) => {
    const shop = clean(s(v.shop_name) || name, 60);
    const title = clean(s(v.product_title), 90);
    const note = clean(s(v.note), 400);
    const kind = s(v.kind);
    const products = `${links.seller}/productos`;

    if (kind === "taken_down") {
      return {
        from: "sellers",
        subject: `Retiramos su producto de la tienda: ${title}`,
        preheader: "Ya no se muestra ni se puede comprar.",
        greeting: `Hola, ${shop}:`,
        paragraphs: [
          `Nuestro equipo de catálogo retiró «${title}» de Yuntera: ya no se muestra ni se puede comprar.`,
          note ? `Motivo: ${note}` : "El motivo está en Yuntera Vende.",
          "Los pedidos que ya se hicieron siguen su curso. Puede corregir el producto en Yuntera Vende y enviarlo de nuevo a revisión, o responder a este correo si cree que es un error.",
        ],
        action: { label: "Ver sus productos", url: products },
        note: SELLER_FOOTER,
        push: { title: "Producto retirado", body: title, url: "/productos" },
      };
    }

    if (kind === "restored") {
      return {
        from: "sellers",
        subject: `Su producto volvió a la tienda: ${title}`,
        preheader: "Ya se puede comprar de nuevo.",
        greeting: `Hola, ${shop}:`,
        paragraphs: [
          `Revisamos de nuevo «${title}» y lo volvimos a publicar. Ya se puede comprar.`,
          note ? `Nota del equipo: ${note}` : "",
        ].filter(Boolean),
        action: { label: "Ver sus productos", url: products },
        note: SELLER_FOOTER,
        push: { title: "Producto publicado de nuevo", body: title, url: "/productos" },
      };
    }

    // corrected
    const facts: Array<[string, string]> = [];
    const fromCategory = clean(s(v.from_category), 60);
    const toCategory = clean(s(v.to_category), 60);
    if (toCategory) facts.push(["Categoría", `${fromCategory || "—"} → ${toCategory}`]);
    if (v.brand_changed === true) {
      facts.push([
        "Marca",
        `${clean(s(v.from_brand), 60) || "sin marca"} → ${clean(s(v.to_brand), 60) || "sin marca"}`,
      ]);
    }
    const fromBps = n(v.from_referral_bps);
    const toBps = n(v.to_referral_bps);
    const fromTax = n(v.from_tax_bps);
    const toTax = n(v.to_tax_bps);
    return {
      from: "sellers",
      subject: `Corregimos los datos de su producto: ${title}`,
      preheader: "Para que los compradores lo encuentren donde lo buscan.",
      greeting: `Hola, ${shop}:`,
      paragraphs: [
        `Nuestro equipo de catálogo corrigió «${title}» para que los compradores lo encuentren donde lo buscan. El producto sigue a la venta.`,
        note ? `Motivo: ${note}` : "",
        fromBps !== null && toBps !== null
          ? `Con la nueva categoría, la comisión por cada venta pasa de ${percent(fromBps)} a ${percent(toBps)}. Se aplica a las ventas desde ahora; las anteriores no cambian.`
          : "",
        fromTax !== null && toTax !== null
          ? `El IVA que se aplica al producto pasa de ${percent(fromTax)} a ${percent(toTax)}. El precio que paga el comprador no cambia.`
          : "",
        "Si cree que la corrección es un error, responda a este correo.",
      ].filter(Boolean),
      facts,
      action: { label: "Ver sus productos", url: products },
      note: SELLER_FOOTER,
      push: { title: "Producto corregido", body: title, url: "/productos" },
    };
  },
};
