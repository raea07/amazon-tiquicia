/**
 * Bird's webhook events (one per POST: `{type, timestamp, data}`) turned into
 * delivery updates. Shapes from research note 1.6, 2.5, 2.7 and 2.8. Event
 * types we do not act on are acknowledged and ignored.
 *
 * The `preference.*` payload was not shown in Bird's documentation in detail;
 * the fields read here (`data.channel`, `data.email` / `data.phone_number` /
 * `data.identifier`) are UNVERIFIED and must be checked against a test event.
 */

import type { Channel, DeliveryStatus, DeliveryUpdate } from "../types.ts";

interface BirdEvent {
  type?: string;
  timestamp?: string;
  data?: Record<string, unknown>;
}

const str = (value: unknown) => (typeof value === "string" ? value : undefined);

function deliveryIdOf(data: Record<string, unknown>): string | undefined {
  const metadata = data.metadata as Record<string, unknown> | null | undefined;
  return str(metadata?.delivery_id);
}

/** The request's generation we put in the metadata (a string; a number is accepted too). */
function generationOf(
  data: Record<string, unknown>,
): { generation: number } | Record<string, never> {
  const metadata = data.metadata as Record<string, unknown> | null | undefined;
  const raw = metadata?.generation;
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  return Number.isInteger(value) && value >= 0 && value < 100_000 ? { generation: value } : {};
}

const EMAIL: Record<string, DeliveryStatus> = {
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.out_of_band_bounce": "bounced",
  "email.rejected": "rejected",
  "email.complained": "complained",
  "email.unsubscribed": "unsubscribed",
  "email.list_unsubscribed": "unsubscribed",
};

const MESSAGING: Record<string, DeliveryStatus> = {
  sent: "sent",
  delivered: "delivered",
  read: "read",
  failed: "failed",
  rejected: "rejected",
  undelivered: "failed",
  expired: "failed",
};

export function parseBirdEvent(rawBody: string): DeliveryUpdate[] {
  let event: BirdEvent;
  try {
    event = JSON.parse(rawBody) as BirdEvent;
  } catch {
    return [];
  }
  const type = str(event.type) ?? "";
  const data = event.data ?? {};
  const occurredAt = str(event.timestamp) ?? new Date().toISOString();
  const deliveryId = deliveryIdOf(data);

  const emailStatus = EMAIL[type];
  if (emailStatus) {
    const bounceType = str(data.bounce_type);
    return [
      {
        provider: "bird",
        channel: "email",
        providerMessageId: str(data.email_id),
        ...(deliveryId ? { deliveryId } : {}),
        ...generationOf(data),
        status: emailStatus,
        permanent: emailStatus === "bounced" ? bounceType === "hard" : emailStatus !== "delivered",
        occurredAt,
        reason:
          str(data.rejection_reason) ?? (bounceType ? `bounce_${bounceType}` : undefined) ?? type,
        recipientAddress: str(data.recipient),
      },
    ];
  }

  if (type === "email_suppression.created") {
    const reason = str(data.reason);
    return [
      {
        provider: "bird",
        channel: "email",
        status: reason === "complaint" ? "complained" : "bounced",
        permanent: true,
        occurredAt,
        reason: reason ?? type,
        recipientAddress: str(data.email),
      },
    ];
  }

  const [channel, action] = type.split(".") as [string, string | undefined];
  if ((channel === "whatsapp" || channel === "sms") && action && MESSAGING[action]) {
    const error = data.error as Record<string, unknown> | undefined;
    const code = str(error?.code);
    const to = data.to as Record<string, unknown> | string | undefined;
    const phone = typeof to === "string" ? to : str(to?.phone_number);
    const update: DeliveryUpdate = {
      provider: "bird",
      channel: channel as Channel,
      providerMessageId: str(data[`${channel}_id`]) ?? str(data.id) ?? str(data.message_id),
      ...(deliveryId ? { deliveryId } : {}),
      ...generationOf(data),
      status: MESSAGING[action] as DeliveryStatus,
      permanent: action === "rejected" || action === "failed",
      occurredAt,
      ...(code ? { reason: code } : {}),
    };
    // A rejection because the person opted out also records the opt-out.
    if (code === "recipient_suppressed" && phone) {
      return [
        update,
        { ...update, status: "opted_out", recipientAddress: phone, providerMessageId: undefined },
      ];
    }
    return [update];
  }

  // The phone itself asked to receive messages again (START, or an opt-in
  // keyword): the one proof that whoever lifts an opt-out holds the number.
  // Field names UNVERIFIED, as for preference.revoked.
  if (type === "preference.granted") {
    const prefChannel = str(data.channel);
    const address = str(data.phone_number) ?? str(data.identifier);
    if (address && (prefChannel === "whatsapp" || prefChannel === "sms")) {
      return [
        {
          provider: "bird",
          channel: prefChannel,
          status: "opted_in",
          permanent: false,
          occurredAt,
          recipientAddress: address,
        },
      ];
    }
    return [];
  }

  if (type === "preference.revoked") {
    const prefChannel = str(data.channel);
    const address = str(data.email) ?? str(data.phone_number) ?? str(data.identifier);
    if (!address) return [];
    if (prefChannel === "email") {
      return [
        {
          provider: "bird",
          channel: "email",
          status: "unsubscribed",
          permanent: true,
          occurredAt,
          recipientAddress: address,
        },
      ];
    }
    if (prefChannel === "whatsapp" || prefChannel === "sms") {
      return [
        {
          provider: "bird",
          channel: prefChannel,
          status: "opted_out",
          permanent: true,
          occurredAt,
          recipientAddress: address,
        },
      ];
    }
  }
  return [];
}
