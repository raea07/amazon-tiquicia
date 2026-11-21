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

export const PAYOUT_STATUS: Record<PayoutStatus, { label: string; tone: Tone }> = {
  scheduled: { label: "Por transferir", tone: "warning" },
  paid: { label: "Pagado", tone: "success" },
  failed: { label: "No se pagó", tone: "danger" },
};

/** Why a shop with a balance is left out of a run. */
export const PAYOUT_BLOCK: Record<PayoutBlock, string> = {
  shop_suspended: "Tienda suspendida o sin verificar",
  no_bank_details: "Sin cuenta bancaria aprobada",
  below_minimum: "Disponible menor al mínimo",
};

export const REQUEST_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Por resolver", tone: "warning" },
  approved: { label: "Aprobada", tone: "success" },
  rejected: { label: "Rechazada", tone: "danger" },
};

/** An account number the way banks print it, in groups of four. */
export const groupIban = (iban: string) => iban.replace(/(.{4})(?=.)/g, "$1 ");
