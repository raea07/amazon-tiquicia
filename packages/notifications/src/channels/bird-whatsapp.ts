/**
 * Bird WhatsApp: `POST /v1/whatsapp/messages`, one recipient per request,
 * always an approved template of our own WhatsApp Business Account, sent from
 * our own number (research note 2.3). The templates' definitions are in
 * packages/notifications/whatsapp/, ready to submit for Meta's review.
 */

import type { ChannelAdapter, OutboundMessage } from "../types.ts";
import { type BirdSettings, generationOf, sendToBird, tagValue } from "./bird.ts";

export interface BirdWhatsAppSettings extends BirdSettings {
  from: string;
}

export function birdWhatsApp(settings: BirdWhatsAppSettings): ChannelAdapter {
  return {
    channel: "whatsapp",
    provider: "bird",
    buildRequest(message: OutboundMessage) {
      if (message.content.channel !== "whatsapp" || message.to.channel !== "whatsapp") {
        throw new Error("birdWhatsApp renders WhatsApp only");
      }
      return JSON.stringify({
        to: message.to.phone,
        from: settings.from,
        template: {
          slug: message.content.templateSlug,
          language: message.content.language,
          parameters: message.content.parameters,
        },
        tags: [{ name: "template", value: tagValue(message.template) }],
        metadata: { delivery_id: message.deliveryId, ...generationOf(message) },
        reference: message.deliveryId,
      });
    },
    send: (message, io) =>
      settings.from
        ? sendToBird(settings, "/v1/whatsapp/messages", message, io)
        : Promise.resolve({
            ok: false,
            provider: "bird",
            kind: "config",
            code: "no_sender",
            message: "BIRD_WHATSAPP_FROM is not set.",
            newKey: false,
          }),
  };
}
