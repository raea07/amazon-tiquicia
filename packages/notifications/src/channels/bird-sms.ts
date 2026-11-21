/**
 * Bird SMS: `POST /v1/sms/messages` (research note 2.8). A last resort for
 * delivery-day news only: carriers in Costa Rica overwrite an alphanumeric
 * sender, and an SMS costs about six WhatsApp utility messages. The texts are
 * written without accented vowels so they fit one GSM-7 segment.
 */

import type { ChannelAdapter, OutboundMessage } from "../types.ts";
import { type BirdSettings, generationOf, sendToBird, tagValue } from "./bird.ts";

export interface BirdSmsSettings extends BirdSettings {
  from: string;
}

export function birdSms(settings: BirdSmsSettings): ChannelAdapter {
  return {
    channel: "sms",
    provider: "bird",
    buildRequest(message: OutboundMessage) {
      if (message.content.channel !== "sms" || message.to.channel !== "sms") {
        throw new Error("birdSms renders SMS only");
      }
      return JSON.stringify({
        to: message.to.phone,
        from: settings.from,
        text: message.content.text,
        category: "transactional",
        tags: [{ name: "template", value: tagValue(message.template) }],
        metadata: { delivery_id: message.deliveryId, ...generationOf(message) },
        reference: message.deliveryId,
      });
    },
    send: (message, io) => sendToBird(settings, "/v1/sms/messages", message, io),
  };
}
