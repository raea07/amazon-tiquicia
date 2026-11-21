import type { OrderStatus, ShipmentStatus } from "@yuntera/core";
import { Badge } from "@yuntera/expo-kit/ui";
import { ORDER_TONE, orderLabel, SHIPMENT_STATUS_LABEL, SHIPMENT_TONE } from "@/lib/labels";

export const OrderStatusBadge = ({ status }: { status: OrderStatus }) => (
  <Badge tone={ORDER_TONE[status]}>{orderLabel(status)}</Badge>
);

export const ShipmentStatusBadge = ({ status }: { status: ShipmentStatus }) => (
  <Badge tone={SHIPMENT_TONE[status]}>{SHIPMENT_STATUS_LABEL[status]}</Badge>
);
