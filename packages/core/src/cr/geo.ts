/**
 * Costa Rican geography: the province → cantón → distrito hierarchy, postal
 * codes, distances, and Plus Codes.
 *
 * Street addresses in Costa Rica are landmark-based ("señas"): there is no
 * reliable street-and-number system to geocode. The platform therefore treats
 * the map pin as the address of record, keeps the señas as free text for the
 * driver, and derives a Plus Code so the location can be shared and re-found
 * without our app.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export const PROVINCES = [
  { code: 1, name: "San José" },
  { code: 2, name: "Alajuela" },
  { code: 3, name: "Cartago" },
  { code: 4, name: "Heredia" },
  { code: 5, name: "Guanacaste" },
  { code: 6, name: "Puntarenas" },
  { code: 7, name: "Limón" },
] as const;

export type ProvinceCode = (typeof PROVINCES)[number]["code"];

export interface PostalCode {
  /** Five digits: P CC DD. */
  code: string;
  province: number;
  canton: number;
  district: number;
  /** Three-digit cantón code (province + cantón), e.g. "101" for San José central. */
  cantonCode: string;
}

/**
 * Parses a 5-digit postal code. The code IS the administrative hierarchy:
 * digit 1 = province, digits 2-3 = cantón within it, digits 4-5 = distrito.
 */
export function parsePostalCode(input: string): PostalCode | null {
  const code = input.trim();
  if (!/^[1-7]\d{4}$/.test(code)) return null;
  const province = Number(code[0]);
  const canton = Number(code.slice(1, 3));
  const district = Number(code.slice(3, 5));
  if (canton === 0 || district === 0) return null;
  return { code, province, canton, district, cantonCode: code.slice(0, 3) };
}

/** Rough bounding box for continental Costa Rica plus Isla del Coco margin excluded. */
export const CR_BOUNDS = { minLat: 8.0, maxLat: 11.25, minLng: -86.0, maxLng: -82.5 } as const;

export function isInCostaRica(p: LatLng): boolean {
  return (
    p.lat >= CR_BOUNDS.minLat &&
    p.lat <= CR_BOUNDS.maxLat &&
    p.lng >= CR_BOUNDS.minLng &&
    p.lng <= CR_BOUNDS.maxLng
  );
}

const EARTH_RADIUS_KM = 6371.0088;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in kilometres. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Road distance is longer than the straight line. 1.4 is a working figure for
 * the Valle Central's river canyons and one-way grids; it is replaced by a
 * routing-engine matrix once volume justifies running one.
 */
export const DEFAULT_CIRCUITY = 1.4;

export const roadDistanceKm = (a: LatLng, b: LatLng, circuity = DEFAULT_CIRCUITY) =>
  haversineKm(a, b) * circuity;

// ── Plus Codes (Open Location Code) ────────────────────────────────────────

const OLC_ALPHABET = "23456789CFGHJMPQRVWX";
const OLC_SEPARATOR_POSITION = 8;
const OLC_PAIR_LENGTH = 10;
const OLC_GRID_COLUMNS = 4;
const OLC_GRID_ROWS = 5;
const OLC_GRID_LENGTH = 5;
// Integer precision of the finest pair/grid digit, per the Open Location Code spec.
const OLC_PAIR_PRECISION = 20 ** 3; // 8000 units per degree at 10 digits
const OLC_FINAL_LAT_PRECISION = OLC_PAIR_PRECISION * OLC_GRID_ROWS ** OLC_GRID_LENGTH;
const OLC_FINAL_LNG_PRECISION = OLC_PAIR_PRECISION * OLC_GRID_COLUMNS ** OLC_GRID_LENGTH;

/**
 * Encodes a location as a Plus Code. The default 10 digits identify roughly a
 * 14 m × 14 m cell, enough to find a gate; 11 narrows it to about 3 m.
 */
export function encodePlusCode(p: LatLng, codeLength: 10 | 11 = 10): string {
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) {
    throw new RangeError("Latitude and longitude must be finite numbers");
  }
  const lat = Math.min(90, Math.max(-90, p.lat));
  let lng = p.lng;
  while (lng < -180) lng += 360;
  while (lng >= 180) lng -= 360;

  let latVal = Math.floor(Math.round((lat + 90) * OLC_FINAL_LAT_PRECISION * 1e6) / 1e6);
  let lngVal = Math.floor(Math.round((lng + 180) * OLC_FINAL_LNG_PRECISION * 1e6) / 1e6);
  // Latitude 90 would overflow the top cell; pull it just inside.
  latVal = Math.min(latVal, 180 * OLC_FINAL_LAT_PRECISION - 1);

  const digits: string[] = [];
  const char = (i: number) => OLC_ALPHABET.charAt(i);

  // Grid digits (11th onwards), least significant first.
  for (let i = 0; i < OLC_GRID_LENGTH; i++) {
    const latDigit = latVal % OLC_GRID_ROWS;
    const lngDigit = lngVal % OLC_GRID_COLUMNS;
    digits.unshift(char(latDigit * OLC_GRID_COLUMNS + lngDigit));
    latVal = Math.floor(latVal / OLC_GRID_ROWS);
    lngVal = Math.floor(lngVal / OLC_GRID_COLUMNS);
  }
  // Pair digits, least significant first.
  for (let i = 0; i < OLC_PAIR_LENGTH / 2; i++) {
    digits.unshift(char(lngVal % 20));
    digits.unshift(char(latVal % 20));
    latVal = Math.floor(latVal / 20);
    lngVal = Math.floor(lngVal / 20);
  }

  const full = digits.join("");
  return `${full.slice(0, OLC_SEPARATOR_POSITION)}+${full.slice(OLC_SEPARATOR_POSITION, codeLength)}`;
}

const PLUS_CODE_RE = /^[23456789CFGHJMPQRVWX]{8}\+[23456789CFGHJMPQRVWX]{2,3}$/;

export const isValidPlusCode = (code: string) => PLUS_CODE_RE.test(code.trim().toUpperCase());

/** Decodes a full 10/11-digit Plus Code to the centre of its cell. */
export function decodePlusCode(code: string): LatLng | null {
  const clean = code.trim().toUpperCase();
  if (!PLUS_CODE_RE.test(clean)) return null;
  const digits = clean.replace("+", "");

  let lat = -90;
  let lng = -180;
  let latRes = 400;
  let lngRes = 400;
  for (let i = 0; i < OLC_PAIR_LENGTH; i += 2) {
    latRes /= 20;
    lngRes /= 20;
    lat += OLC_ALPHABET.indexOf(digits.charAt(i)) * latRes;
    lng += OLC_ALPHABET.indexOf(digits.charAt(i + 1)) * lngRes;
  }
  for (let i = OLC_PAIR_LENGTH; i < digits.length; i++) {
    const v = OLC_ALPHABET.indexOf(digits.charAt(i));
    latRes /= OLC_GRID_ROWS;
    lngRes /= OLC_GRID_COLUMNS;
    lat += Math.floor(v / OLC_GRID_COLUMNS) * latRes;
    lng += (v % OLC_GRID_COLUMNS) * lngRes;
  }
  return { lat: lat + latRes / 2, lng: lng + lngRes / 2 };
}

// ── Delivery address ───────────────────────────────────────────────────────

export interface DeliveryAddressInput {
  recipientName: string;
  phone: string;
  /** 5-digit postal code identifying the distrito. */
  postalCode: string;
  /** Free-text directions the way a Tico would give them. */
  senas: string;
  pin: LatLng | null;
}

export type AddressIssue =
  | "recipient_required"
  | "postal_code_invalid"
  | "senas_too_short"
  | "pin_required"
  | "pin_outside_country";

/**
 * Validates the parts of an address that code can judge. A pin is mandatory:
 * señas alone ("de la antigua pulpería 200 m sur") cannot be routed.
 */
export function validateDeliveryAddress(a: DeliveryAddressInput): AddressIssue[] {
  const issues: AddressIssue[] = [];
  if (a.recipientName.trim().length < 3) issues.push("recipient_required");
  if (!parsePostalCode(a.postalCode)) issues.push("postal_code_invalid");
  if (a.senas.trim().length < 15) issues.push("senas_too_short");
  if (!a.pin) issues.push("pin_required");
  else if (!isInCostaRica(a.pin)) issues.push("pin_outside_country");
  return issues;
}
