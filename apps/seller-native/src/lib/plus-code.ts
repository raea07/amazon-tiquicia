import { decodePlusCode, encodePlusCode, isInCostaRica, type LatLng } from "@yuntera/core";

const ALPHABET = "23456789CFGHJMPQRVWX";
/** A full code (8 characters before "+") or a short one (4 or 6), as Google Maps shows them. */
const CODE_RE = new RegExp(
  `^([${ALPHABET}]{4}|[${ALPHABET}]{6}|[${ALPHABET}]{8})\\+([${ALPHABET}]{2,3})$`,
);

/**
 * Where short codes are recovered from. Our drivers collect only in the
 * active delivery zones (seller_save_location refuses any other district
 * with `zone_not_served`), and those are the Gran Área Metropolitana: from
 * Atenas and Poás in the west to Paraíso and El Guarco in the east, and from
 * the hills above Heredia and Alajuela to the south of Aserrí, roughly
 * 9.55–10.25 N and 84.40–83.70 W. A short code (four characters dropped)
 * names a point inside a 1° × 1° cell, and recovery picks the one within
 * half a degree of the reference in each direction, so this one point
 * (central San José) recovers every short code in the area we collect from
 * with a margin of more than 0.15° on every side.
 */
export const PICKUP_REFERENCE: LatLng = { lat: 9.93, lng: -84.08 };

export type PlusCodeResult =
  | { ok: true; point: LatLng; plusCode: string; recovered: boolean }
  | { ok: false; reason: "invalid" | "outside" };

/**
 * Reads what the seller pasted: a full Plus Code ("66XRQ4XR+RH"), or the
 * short form Google Maps shows beside a place ("Q4XR+RH Orosi, Cartago"),
 * whose place name is ignored and whose missing first characters are taken
 * from PICKUP_REFERENCE, the way Open Location Code's "recover nearest" does.
 * Returns the centre of the code's cell and the full code, which the screen
 * shows so the seller can compare it with the map.
 */
export function readPlusCode(input: string, reference: LatLng = PICKUP_REFERENCE): PlusCodeResult {
  const first =
    input
      .trim()
      .toUpperCase()
      .split(/[\s,]+/)[0] ?? "";
  const match = CODE_RE.exec(first);
  if (!match) return { ok: false, reason: "invalid" };
  const [, before, after] = match as unknown as [string, string, string];
  const length = after.length === 2 ? 10 : 11; // digits of the full code
  let point: LatLng | null;
  let recovered = false;

  if (before.length === 8) {
    point = decodePlusCode(first);
  } else {
    recovered = true;
    const padding = 8 - before.length; // 4 or 2 characters dropped
    // The size of the cell the short code is inside: 1° for 4 dropped, 20° for 2.
    const resolution = 20 ** (2 - padding / 2);
    const prefix = encodePlusCode(reference).replace("+", "").slice(0, padding);
    const guess = decodePlusCode(`${prefix}${before}+${after}`);
    if (!guess) return { ok: false, reason: "invalid" };
    let { lat, lng } = guess;
    const half = resolution / 2;
    if (reference.lat + half < lat && lat - resolution >= -90) lat -= resolution;
    else if (reference.lat - half > lat && lat + resolution <= 90) lat += resolution;
    if (reference.lng + half < lng) lng -= resolution;
    else if (reference.lng - half > lng) lng += resolution;
    // Re-encode and decode so the point is exactly the centre of the code's cell.
    point = decodePlusCode(encodePlusCode({ lat, lng }, length));
  }

  if (!point) return { ok: false, reason: "invalid" };
  if (!isInCostaRica(point)) return { ok: false, reason: "outside" };
  return { ok: true, point, plusCode: encodePlusCode(point, length), recovered };
}
