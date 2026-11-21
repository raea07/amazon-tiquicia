/**
 * The frame every commercial (marketing) e-mail must have. This workstream
 * sends none, but when one is written it can only be built through here:
 *
 *   - only with a recorded consent (Ley 8968 art. 5; Decreto 35205 art. 31 a;
 *     Decreto 37899 art. 200; Ley 10946 art. 29 from mid-2027);
 *   - identifiable as commercial: the word "Publicidad" (or "Oferta",
 *     "Invitación") at the start of the subject and of the body, because
 *     Ley 10946 art. 9 says "al comienzo del mensaje" and it is not settled
 *     whether that means the subject (research note, corrections item 3);
 *   - the sender identified, and a free way to stop that works at once: an
 *     unsubscribe link and a reply address that is read (Decreto 35205 art. 32).
 */

import type { RenderedEmail } from "../types.ts";
import type { Copy } from "./catalog.ts";
import { renderEmail, type Sender } from "./render.ts";

export type CommercialLabel = "Publicidad" | "Oferta" | "Invitación";

export class CommercialConsentMissing extends Error {
  constructor() {
    super("A commercial message needs the recipient's recorded consent.");
  }
}

export interface CommercialInput {
  label: CommercialLabel;
  subject: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  /** A link that withdraws the consent in one step, without signing in. */
  unsubscribeUrl: string;
}

export function renderCommercialEmail(
  input: CommercialInput,
  sender: Sender,
  consent: { granted: boolean },
): RenderedEmail & { headers: Record<string, string> } {
  if (!consent.granted) throw new CommercialConsentMissing();
  if (!/^https:\/\//.test(input.unsubscribeUrl)) {
    throw new Error("A commercial message needs an https unsubscribe link.");
  }
  const copy: Copy = {
    from: "orders",
    subject: `${input.label}: ${input.subject}`,
    preheader: input.label,
    greeting: null,
    paragraphs: input.paragraphs,
    ...(input.action ? { action: input.action } : {}),
  };
  const rendered = renderEmail(copy, sender, {
    headerLabel: input.label,
    footerLines: [
      `Recibe este mensaje porque aceptó recibir ${input.label.toLowerCase()} de Yuntera. Puede dejar de recibirla en cualquier momento, sin costo: ${input.unsubscribeUrl}`,
      `También puede pedirlo respondiendo a este correo (${sender.replyTo}).`,
    ],
  });
  return {
    ...rendered,
    headers: {
      "List-Unsubscribe": `<${input.unsubscribeUrl}>, <mailto:${sender.replyTo}?subject=baja>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}
