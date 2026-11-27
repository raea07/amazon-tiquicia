import { statusLabels } from "@yuntera/core";
import type { PayoutBlock, PayoutStatus, WarehouseRole } from "@yuntera/db";
import type { Tone } from "@yuntera/ui";

/** How the console words people's positions and the states of a payout. */

export const WAREHOUSE_ROLE: Record<WarehouseRole, string> = {
  associate: "Auxiliar de bodega",
  lead: "Líder de bodega",
};

export const ID_TYPE: Record<string, string> = {
  fisica: "Cédula física",
  juridica: "Cédula jurídica",
  dimex: "DIMEX",
  nite: "NITE",
};

export const PAYOUT_STATUS: Record<PayoutStatus, { label: string; tone: Tone }> = statusLabels(
  "payouts",
  "staff",
  { scheduled: "warning", paid: "success", failed: "danger" },
);

/** Why a shop with a balance is left out of a run. */
export const PAYOUT_BLOCK: Record<PayoutBlock, string> = {
  shop_suspended: "Tienda suspendida o sin verificar",
  no_bank_details: "Sin cuenta bancaria aprobada",
  invalid_bank_details: "La cuenta registrada no es un IBAN válido",
  below_minimum: "Disponible menor al mínimo",
};

/**
 * A shop change or new payout details waiting for staff. Both tables read the
 * same words in packages/core (seller_change_requests, payout_detail_requests).
 */
export const REQUEST_STATUS: Record<string, { label: string; tone: Tone }> = statusLabels(
  "seller_change_requests",
  "staff",
  { pending: "warning", approved: "success", rejected: "danger" },
);

/** An account number the way banks print it, in groups of four. */
export const groupIban = (iban: string) => iban.replace(/(.{4})(?=.)/g, "$1 ");
