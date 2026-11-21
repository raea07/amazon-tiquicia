/**
 * Turns a template's copy into what each channel sends: HTML and text e-mail
 * in the brand's look, a WhatsApp template call, an SMS, a push notification.
 * Every piece of text is escaped here, once, at the last moment.
 */

import { brandName, mailColors as c } from "../brand.ts";
import { clean, escapeHtml as e, whatsappParam } from "../format.ts";
import type { Channel, Rendered, RenderedEmail } from "../types.ts";
import { type Copy, type Links, TEMPLATES, type Vars } from "./catalog.ts";

export interface Sender {
  legalName: string;
  legalId: string;
  postalAddress: string;
  replyTo: string;
}

export interface RenderInput {
  template: string;
  channel: Channel;
  vars: Vars;
  name: string | null;
  links: Links;
  sender: Sender;
  whatsappLanguage?: string;
}

export class TemplateMissing extends Error {}

/** The copy for a template, or an error when it has nothing for that channel. */
export function copyFor(template: string, vars: Vars, name: string | null, links: Links): Copy {
  const build = TEMPLATES[template];
  if (!build) throw new TemplateMissing(`unknown template ${template}`);
  return build({ vars, name, links });
}

export function render(input: RenderInput): Rendered {
  const copy = copyFor(input.template, input.vars, input.name, input.links);
  switch (input.channel) {
    case "email":
      return renderEmail(copy, input.sender);
    case "whatsapp": {
      if (!copy.whatsapp) throw new TemplateMissing(`${input.template} has no WhatsApp template`);
      return {
        channel: "whatsapp",
        templateSlug: copy.whatsapp.slug,
        language: input.whatsappLanguage ?? "es",
        parameters: Object.fromEntries(
          Object.entries(copy.whatsapp.parameters).map(([key, value]) => [
            key,
            key === "button_url" ? encodeURIComponent(clean(value, 40)) : whatsappParam(value),
          ]),
        ),
      };
    }
    case "sms": {
      if (!copy.sms) throw new TemplateMissing(`${input.template} has no SMS text`);
      return { channel: "sms", text: clean(copy.sms, 300) };
    }
    case "push": {
      if (!copy.push) throw new TemplateMissing(`${input.template} has no push text`);
      const collapse = clean(input.vars.order_number, 20) || input.template;
      return {
        channel: "push",
        title: clean(copy.push.title, 60),
        body: clean(copy.push.body, 160),
        data: { url: copy.push.url },
        channelId: "pedidos",
        // iOS replaces a notification on screen with the same collapse id;
        // Android needs the tag for that (corrections, item 2).
        collapseId: `yt-${collapse}`,
        tag: `yt-${collapse}`,
        ...(copy.push.ttlSeconds ? { ttlSeconds: copy.push.ttlSeconds } : {}),
        ...(copy.push.priority ? { priority: copy.push.priority } : {}),
      };
    }
  }
}

/** The legal identification every e-mail carries (Decreto 35205 art. 32 a). */
export function senderLines(sender: Sender): string[] {
  return [
    `${clean(sender.legalName, 120)} · ${clean(sender.legalId, 60)}`,
    clean(sender.postalAddress, 160),
    `Escríbanos a ${clean(sender.replyTo, 120)}.`,
  ];
}

export function renderEmail(
  copy: Copy,
  sender: Sender,
  extra: { footerLines?: string[]; headerLabel?: string } = {},
): RenderedEmail {
  const subject = clean(copy.subject, 200);
  const footer = [
    ...(copy.note ? [copy.note] : []),
    ...(extra.footerLines ?? []),
    ...senderLines(sender),
  ];

  const text = [
    ...(extra.headerLabel ? [extra.headerLabel, ""] : []),
    ...(copy.greeting ? [copy.greeting, ""] : []),
    ...copy.paragraphs.flatMap((p) => [p, ""]),
    ...(copy.items && copy.items.length > 0
      ? [...copy.items.map((i) => `- ${i.quantity} × ${i.title}: ${i.amount}`), ""]
      : []),
    ...(copy.facts ?? []).map(([label, value]) => `${label}: ${value}`),
    ...(copy.facts?.length ? [""] : []),
    ...(copy.action ? [`${copy.action.label}: ${copy.action.url}`, ""] : []),
    "—",
    ...footer,
  ].join("\n");

  const paragraph = (p: string) =>
    `<p style="margin:0 0 16px;font-size:16px;line-height:24px;color:${c.ink}">${e(p)}</p>`;
  const itemRows = (copy.items ?? [])
    .map(
      (i) =>
        `<tr><td style="padding:6px 0;font-size:15px;color:${c.ink}">${e(i.quantity)} × ${e(i.title)}</td><td align="right" style="padding:6px 0;font-size:15px;color:${c.ink};white-space:nowrap">${e(i.amount)}</td></tr>`,
    )
    .join("");
  const factRows = (copy.facts ?? [])
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 0;font-size:14px;color:${c.inkMuted}">${e(label)}</td><td align="right" style="padding:4px 0;font-size:14px;font-weight:600;color:${c.ink}">${e(value)}</td></tr>`,
    )
    .join("");
  const button = copy.action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr><td style="border-radius:10px;background:${c.brand}"><a href="${e(safeUrl(copy.action.url))}" style="display:inline-block;padding:14px 22px;font-size:16px;font-weight:700;color:${c.onBrand};text-decoration:none;border-radius:10px">${e(copy.action.label)}</a></td></tr></table>`
    : "";

  const html = `<!doctype html>
<html lang="es-CR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${e(subject)}</title></head>
<body style="margin:0;padding:0;background:${c.bg};font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<div style="display:none;max-height:0;overflow:hidden">${e(copy.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.bg}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${c.surface};border:1px solid ${c.border};border-radius:16px">
<tr><td style="padding:24px 28px 8px"><span style="font-size:22px;font-weight:800;letter-spacing:-0.5px;color:${c.brand}">${e(brandName)}</span></td></tr>
<tr><td style="padding:8px 28px 8px">
${extra.headerLabel ? `<p style="margin:0 0 12px;font-size:13px;font-weight:700;text-transform:uppercase;color:${c.inkMuted}">${e(extra.headerLabel)}</p>` : ""}
${copy.greeting ? paragraph(copy.greeting) : ""}
${copy.paragraphs.map(paragraph).join("\n")}
${itemRows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border-top:1px solid ${c.border};border-bottom:1px solid ${c.border}">${itemRows}</table>` : ""}
${factRows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px">${factRows}</table>` : ""}
${button}
</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid ${c.border}">
${footer.map((line) => `<p style="margin:0 0 6px;font-size:12px;line-height:18px;color:${c.inkMuted}">${e(line)}</p>`).join("\n")}
</td></tr>
</table></td></tr></table></body></html>`;

  return { channel: "email", subject, html, text, from: copy.from };
}

/** Links in messages are ours: anything else becomes the shop's home. */
function safeUrl(url: string): string {
  return /^https?:\/\/[^\s"'<>]+$/.test(url) ? url : "#";
}
