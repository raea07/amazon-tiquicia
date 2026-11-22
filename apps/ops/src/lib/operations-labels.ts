import type { Tone } from "@yuntera/ui";

/** 0 = Sunday … 6 = Saturday, as the database counts them. */
export const WEEKDAYS = [
  { day: 1, short: "Lun", name: "lunes" },
  { day: 2, short: "Mar", name: "martes" },
  { day: 3, short: "Mié", name: "miércoles" },
  { day: 4, short: "Jue", name: "jueves" },
  { day: 5, short: "Vie", name: "viernes" },
  { day: 6, short: "Sáb", name: "sábado" },
  { day: 0, short: "Dom", name: "domingo" },
] as const;

/** "lunes a sábado", or the days one by one when they are not in a row. */
export function weekdayList(days: readonly number[]): string {
  const ordered = WEEKDAYS.filter((weekday) => days.includes(weekday.day));
  if (ordered.length === 7) return "todos los días";
  const positions = ordered.map((weekday) => WEEKDAYS.indexOf(weekday));
  const contiguous = positions.every(
    (position, i) => i === 0 || position === (positions[i - 1] ?? -2) + 1,
  );
  if (contiguous && ordered.length > 2) {
    return `${ordered[0]?.name} a ${ordered.at(-1)?.name}`;
  }
  return ordered.map((weekday) => weekday.name).join(", ");
}

export const CLOSURE_REASON: Record<string, string> = {
  weather: "Lluvias o mal tiempo",
  road_closed: "Camino cerrado",
  capacity: "Sin capacidad de reparto",
  other: "Otro",
};

export const CLOSURE_STATE: Record<string, { label: string; tone: Tone }> = {
  upcoming: { label: "Próximo", tone: "info" },
  current: { label: "En curso", tone: "warning" },
  over: { label: "Terminado", tone: "neutral" },
  cancelled: { label: "Cancelado", tone: "neutral" },
};

export const STUCK_REASON: Record<string, string> = {
  past_date: "Su día ya pasó",
  cancelled_parcel: "Lleva un paquete cancelado o devuelto",
  no_open_stops: "No le quedan paradas pendientes",
};

export const NOT_REMOVABLE: Record<string, string> = {
  attempt_in_progress: "El repartidor está en la puerta: espere a que la cierre.",
  closed: "Ya está cerrada.",
};

export const LOCATION_KIND: Record<string, string> = {
  receiving: "Recepción",
  storage: "Almacenaje",
  pick: "Alisto",
  packing: "Empaque",
  staging: "Despacho",
  returns: "Devoluciones",
  damaged: "Dañados",
};

/** Céntimos shown as whole colones in a form field ("1500" for ₡1 500). */
export const colonesField = (minor: number | null) =>
  minor === null ? "" : String(Math.round(minor / 100));
