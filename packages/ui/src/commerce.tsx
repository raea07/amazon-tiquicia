/**
 * Commerce-specific display components: prices, ratings and statuses.
 * Shared so a price or an order status reads the same in every app.
 */

import {
  bayesianRating,
  format,
  money,
  ORDER_STATUS_LABEL,
  type OrderStatus,
  type ShipmentStatus,
} from "@yuntera/core";
import { Badge, cx, type Tone } from "./primitives";

/** Formats céntimos for display: ₡12 500. */
export const formatPrice = (amountMinor: number) => format(money(amountMinor));

export function Price({
  amountMinor,
  listAmountMinor,
  size = "md",
  className,
}: {
  amountMinor: number;
  /** A higher "precio regular", shown struck through with the saving. */
  listAmountMinor?: number | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const hasDiscount = typeof listAmountMinor === "number" && listAmountMinor > amountMinor;
  const percentOff = hasDiscount
    ? Math.round((1 - amountMinor / (listAmountMinor as number)) * 100)
    : 0;
  const sizeClass = size === "lg" ? "text-3xl" : size === "sm" ? "text-base" : "text-xl";

  return (
    <span className={cx("inline-flex flex-wrap items-baseline gap-x-2", className)}>
      <span className={cx("font-display font-bold tabular-nums text-ink", sizeClass)}>
        {formatPrice(amountMinor)}
      </span>
      {hasDiscount ? (
        <>
          <span className="text-sm text-ink-muted tabular-nums">
            <span className="sr-only">Precio regular: </span>
            <s>{formatPrice(listAmountMinor as number)}</s>
          </span>
          {percentOff >= 5 ? <Badge tone="promo">−{percentOff}%</Badge> : null}
        </>
      ) : null}
    </span>
  );
}

/** Average rating out of five. Reads as text to assistive tech; the stars are decoration. */
const STAR_PATH = "M10 1.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.6 7.7l5.8-.8z";

export function Stars({
  ratingSum,
  ratingCount,
  showCount = true,
  className,
}: {
  ratingSum: number;
  ratingCount: number;
  showCount?: boolean;
  className?: string;
}) {
  if (ratingCount === 0) {
    return <span className={cx("text-sm text-ink-muted", className)}>Sin reseñas todavía</span>;
  }
  const average = ratingSum / ratingCount;
  const label = `${average.toLocaleString("es-CR", { maximumFractionDigits: 1 })} de 5`;
  const filled = Math.round(average * 2) / 2;

  return (
    <span
      className={cx("inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm", className)}
    >
      <span aria-hidden="true" className="inline-flex shrink-0">
        {[1, 2, 3, 4, 5].map((star) => (
          <svg key={star} viewBox="0 0 20 20" className="size-4" aria-hidden="true">
            <path d={STAR_PATH} fill="var(--color-arena-300)" />
            {filled >= star - 0.5 ? (
              <path
                d={STAR_PATH}
                fill="var(--color-rating)"
                className={filled >= star ? undefined : "[clip-path:inset(0_50%_0_0)]"}
              />
            ) : null}
          </svg>
        ))}
      </span>
      <span className="whitespace-nowrap font-semibold text-ink">{label}</span>
      {showCount ? (
        <span className="whitespace-nowrap text-ink-muted">
          ({ratingCount} {ratingCount === 1 ? "reseña" : "reseñas"})
        </span>
      ) : null}
    </span>
  );
}

/** Sort key for "best rated": the same smoothing search uses, so the two agree. */
export const ratingScore = bayesianRating;

const ORDER_TONE: Record<OrderStatus, Tone> = {
  pending_payment: "warning",
  payment_review: "warning",
  confirmed: "info",
  processing: "info",
  partially_shipped: "info",
  shipped: "info",
  delivered: "success",
  completed: "success",
  cancelled: "neutral",
  refunded: "neutral",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={ORDER_TONE[status]}>{ORDER_STATUS_LABEL[status]["es-CR"]}</Badge>;
}

export const SHIPMENT_STATUS_LABEL: Record<ShipmentStatus, string> = {
  pending: "Por preparar",
  picking: "En preparación",
  packed: "Empacado",
  ready_for_dispatch: "Listo para salir",
  out_for_delivery: "En camino",
  delivered: "Entregado",
  delivery_failed: "Entrega fallida",
  returning: "De regreso",
  returned: "Devuelto",
  cancelled: "Cancelado",
};

const SHIPMENT_TONE: Record<ShipmentStatus, Tone> = {
  pending: "neutral",
  picking: "info",
  packed: "info",
  ready_for_dispatch: "info",
  out_for_delivery: "info",
  delivered: "success",
  delivery_failed: "danger",
  returning: "warning",
  returned: "neutral",
  cancelled: "neutral",
};

export function ShipmentStatusBadge({ status }: { status: ShipmentStatus }) {
  return <Badge tone={SHIPMENT_TONE[status]}>{SHIPMENT_STATUS_LABEL[status]}</Badge>;
}

/** Dates as people write them in Costa Rica: "lunes 23 de noviembre". */
export function formatDate(
  value: string,
  options: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" },
): string {
  // Date-only strings are calendar dates, not instants: format them in UTC so
  // the day never shifts with the viewer's timezone.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  return new Intl.DateTimeFormat("es-CR", {
    ...options,
    timeZone: dateOnly ? "UTC" : "America/Costa_Rica",
  }).format(new Date(dateOnly ? `${value}T00:00:00Z` : value));
}

export const formatDateTime = (value: string) =>
  formatDate(value, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
