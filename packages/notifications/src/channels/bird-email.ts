/**
 * Bird e-mail: `POST /v1/email/messages`, rendered by us and sent inline
 * (research note 1.2). Always `category: "transactional"` (the default is
 * marketing, which would add an unsubscribe link and obey newsletter
 * opt-outs), tracking off (links carry tokens and we do not track people),
 * and no `parameters` field (it would make Bird run our text as Liquid).
 */

import type { ChannelAdapter, OutboundMessage } from "../types.ts";
import { type BirdSettings, generationOf, sendToBird, tagValue } from "./bird.ts";

export interface BirdEmailSettings extends BirdSettings {
  from: { orders: string; account: string; sellers: string };
  replyTo: string;
  env: string;
}

export function birdEmail(settings: BirdEmailSettings): ChannelAdapter {
  return {
    channel: "email",
    provider: "bird",
    buildRequest(message: OutboundMessage) {
      if (message.content.channel !== "email" || message.to.channel !== "email") {
        throw new Error("birdEmail renders e-mail only");
      }
      const content = message.content;
      return JSON.stringify({
        from: { email: settings.from[content.from], name: "Yuntera" },
        to: [{ email: message.to.email, ...(message.to.name ? { name: message.to.name } : {}) }],
        reply_to: [settings.replyTo],
        subject: content.subject,
        html: content.html,
        text: content.text,
        category: message.category === "marketing" ? "marketing" : "transactional",
        track_opens: false,
        track_clicks: false,
        tags: [
          { name: "template", value: tagValue(message.template) },
          { name: "env", value: tagValue(settings.env) },
        ],
        metadata: {
          delivery_id: message.deliveryId,
          template: message.template,
          ...generationOf(message),
        },
        reference: message.deliveryId,
      });
    },
    send: (message, io) => sendToBird(settings, "/v1/email/messages", message, io),
  };
}
