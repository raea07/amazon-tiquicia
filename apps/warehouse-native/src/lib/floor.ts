/**
 * The rules of the warehouse floor, as the web app (`apps/field`, /bodega)
 * applies them, without React: the order of the board, the labels, which
 * line comes next, and the checks a form runs before calling the API. Every
 * text is the web's own. `floor.test.ts` runs them in Node.
 */

// The status words come from packages/core status-words (warehouse viewer).
import { type ShipmentStatus, statusWordMap } from "@yuntera/core";
import type { Tone } from "@yuntera/expo-kit/theme";

export interface BoardShipment {
  status: ShipmentStatus;
}

/** The steps a parcel goes through on the floor, in the order the board lists them. */
const WORD = statusWordMap("shipment_status", "warehouse");
export const STEP: Partial<Record<ShipmentStatus, { label: string; tone: Tone; order: number }>> = {
  picking: { label: WORD.picking, tone: "info", order: 0 },
  pending: { label: WORD.pending, tone: "warning", order: 1 },
  packed: { label: WORD.packed, tone: "success", order: 2 },
  ready_for_dispatch: { label: WORD.ready_for_dispatch, tone: "success", order: 3 },
};

/** In picking first, then waiting, then done; the database's order within each. */
export function sortBoard<T extends BoardShipment>(shipments: readonly T[]): T[] {
  return [...shipments].sort((a, b) => (STEP[a.status]?.order ?? 9) - (STEP[b.status]?.order ?? 9));
}

export const isToDo = (shipment: BoardShipment) =>
  shipment.status === "pending" || shipment.status === "picking";

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export interface PickTask {
  task_id: string;
  status: "open" | "in_progress" | "done" | "short" | "cancelled";
  quantity: number;
  picked_quantity: number;
}

/** How far a pick list is: "1 de 3" lines done, and whether it can be packed. */
export function pickProgress(tasks: readonly PickTask[]) {
  const done = tasks.filter((task) => task.status === "done").length;
  return {
    done,
    total: tasks.length,
    short: tasks.some((task) => task.status === "short"),
    allPicked: tasks.length > 0 && done === tasks.length,
  };
}

/**
 * The line to pick now: the one the worker chose, if it still needs work;
 * otherwise the first in walking order that has not been picked, and only
 * then one left short (to correct its quantity). Null when all are done.
 */
export function nextTask<T extends PickTask>(
  tasks: readonly T[],
  chosen?: string | null,
): T | null {
  const open = (task: T) => task.status === "open" || task.status === "in_progress";
  const pick = tasks.find((task) => task.task_id === chosen && task.status !== "done");
  return pick ?? tasks.find(open) ?? tasks.find((task) => task.status === "short") ?? null;
}

/** The lines still to do, the current one included, in walking order. */
export const pendingTasks = <T extends PickTask>(tasks: readonly T[]) =>
  tasks.filter((task) => task.status !== "done" && task.status !== "cancelled");

const WHOLE = /^\d{1,6}$/;

/** "Tomó": a whole number from 0 to what the line asks for. */
export function parsePicked(text: string, asked: number): { quantity: number } | { error: string } {
  const value = text.trim();
  if (!WHOLE.test(value) || Number(value) > asked) {
    return { error: "Escriba cuántas unidades tomó." };
  }
  return { quantity: Number(value) };
}

/** What packing asks for: the real weight in grams (1–30 000) and the number of parcels (1–20). */
export function parsePack(
  weight: string,
  packages: string,
): { weightGrams: number; packageCount: number } | { error: string } {
  const w = weight.trim();
  const p = packages.trim() || "1";
  if (!WHOLE.test(w) || !WHOLE.test(p)) {
    return { error: "Escriba el peso en gramos y cuántos bultos son." };
  }
  const weightGrams = Number(w);
  const packageCount = Number(p);
  if (weightGrams < 1 || weightGrams > 30_000 || packageCount < 1 || packageCount > 20) {
    return { error: "Escriba el peso en gramos y cuántos bultos son." };
  }
  return { weightGrams, packageCount };
}

/** The most of one kind a single count can record, as the web's form allows. */
export const MAX_RECEIVE = 100_000;

/**
 * What a count above what is still to receive is told. The database refuses
 * it (`over_receipt`): a line takes no more than the seller announced, so a
 * slip at the dock ("120" for "12") or a double scan never becomes stock that
 * is sold. Units that really came in extra go in on a new inbound from the
 * seller.
 */
export function overReceiptMessage(surplus: number, pending: number): string {
  return `Escribió ${plural(surplus, "unidad", "unidades")} más de las que faltan por recibir (${
    pending === 0 ? "no falta ninguna" : `faltan ${pending}`
  }). No se puede recibir más de lo que el vendedor anunció. Cuente de nuevo; si de verdad llegaron de más, registre ${
    pending === 0 ? "nada en esta línea" : `las ${pending} que faltan`
  } y avise al encargado: el vendedor debe anunciar otro ingreso por el resto.`;
}

/** What receiving one inbound line asks for, with the web's words. */
export function parseReceive(input: {
  good: string;
  damaged: string;
  locationId: string | null;
  pending: number;
}): { goodQuantity: number; damagedQuantity: number; locationId: string } | { error: string } {
  if (!input.locationId) return { error: "Elija dónde lo guarda." };
  const good = input.good.trim() || "0";
  const damaged = input.damaged.trim() || "0";
  if (!WHOLE.test(good) || !WHOLE.test(damaged)) {
    return { error: "Indique cuántas unidades recibió." };
  }
  const goodQuantity = Number(good);
  const damagedQuantity = Number(damaged);
  if (goodQuantity > MAX_RECEIVE || damagedQuantity > MAX_RECEIVE) {
    return { error: "Indique cuántas unidades recibió." };
  }
  if (goodQuantity + damagedQuantity === 0) return { error: "Indique cuántas unidades recibió." };
  const surplus = goodQuantity + damagedQuantity - input.pending;
  if (surplus > 0) return { error: overReceiptMessage(surplus, input.pending) };
  return { goodQuantity, damagedQuantity, locationId: input.locationId };
}

export interface InboundLine {
  line_id: string;
  expected: number;
  received: number;
  damaged: number;
}

/** Units of a line still to count in. */
export const pendingUnits = (line: InboundLine) =>
  Math.max(0, line.expected - line.received - line.damaged);

/** Bins where received stock can be put: receiving and storage, as on the web. */
export const isPutawayBin = (location: { kind: string }) =>
  location.kind === "receiving" || location.kind === "storage";
