/**
 * The message added with migration 084700 (support cases): staff answered a
 * case the shopper has (a contact recorded from WhatsApp, phone or e-mail, a
 * return, or a report they made). Planned by ops_answer_case through the
 * notification planner. An answer to a complaint keeps using
 * complaint_answered.
 *
 * The answer itself is never in the message: it is read in the shopper's
 * account (and on the order's page), the only place that shows it to the
 * person it belongs to. Same rules as catalog.ts.
 */

import { clean } from "../format.ts";
import type { Copy, Links, TemplateInput, Vars } from "./catalog.ts";

type Template = (input: TemplateInput) => Copy;

const s = (value: unknown) => (typeof value === "string" ? value : "");
const hello = (name: string | null) => (name ? `Hola, ${clean(name, 40)}:` : "Hola:");
const orderNumber = (v: Vars) => clean(s(v.order_number), 20);

/** Where the answer is read: the order's page when the case has an order, else the account. */
function answerPath(v: Vars): string {
  const number = orderNumber(v);
  return number ? `/pedidos/${encodeURIComponent(number)}` : "/cuenta/casos";
}
const answerUrl = (v: Vars, links: Links) => `${links.shop}${answerPath(v)}`;

export const SUPPORT_TEMPLATES: Record<string, Template> = {
  case_answered: ({ vars: v, name, links }) => {
    const ref = clean(s(v.case_ref), 12);
    const number = orderNumber(v);
    return {
      from: "orders",
      subject: `Le respondimos${ref ? ` (caso ${ref})` : ""}`,
      preheader: "La respuesta está en su cuenta de Yuntera.",
      greeting: hello(name),
      paragraphs: [
        `Respondimos su consulta${ref ? ` ${ref}` : ""}${number ? ` sobre el pedido ${number}` : ""}. La respuesta completa está en su cuenta.`,
        v.closed
          ? "Dimos el caso por resuelto. Si necesita algo más, escríbanos y lo volvemos a abrir."
          : "Seguimos atendiéndolo y le avisaremos de cada novedad.",
      ],
      action: { label: "Ver la respuesta", url: answerUrl(v, links) },
      note: "Este mensaje es sobre una consulta que usted hizo a Yuntera.",
      push: {
        title: "Le respondimos",
        body: number
          ? `Hay una respuesta sobre su pedido ${number}.`
          : "Hay una respuesta en su cuenta.",
        url: answerPath(v),
      },
    };
  },
};
