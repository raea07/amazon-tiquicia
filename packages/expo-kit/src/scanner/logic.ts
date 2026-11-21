/**
 * What a scan means, without a camera: which symbologies the camera looks
 * for, how a read is cleaned and checked, how the same code seen many times a
 * second becomes one read, and whether a code is the product a line expects.
 *
 * No React Native import: this runs in Node for the tests, and on every
 * platform the same way (camera, typed text, a hand scanner typing into a field).
 */

/**
 * The codes the camera looks for (research note §4b): the retail barcodes on
 * products (EAN-13, EAN-8, UPC-A, UPC-E), the logistics ones on boxes and
 * labels (Code 128, Code 39, ITF-14), and QR. Fewer types read faster and
 * misread less, so the list stops there.
 */
export const SYMBOLOGIES = [
  "ean13",
  "ean8",
  "upc_a",
  "upc_e",
  "code128",
  "code39",
  "itf14",
  "qr",
] as const;
export type Symbology = (typeof SYMBOLOGIES)[number];

/** The longest code accepted, as on the web's lookup (`slice(0, 40)`). */
export const MAX_CODE_LENGTH = 40;

/**
 * GS1 element strings carry the product's GTIN after application identifier
 * 01. A hand scanner may send them with an AIM prefix (`]C1` for GS1-128,
 * `]d2` for GS1 DataMatrix, `]Q3` for GS1 QR, `]e0` for GS1 DataBar), and
 * people type them in the printed form "(01)07441234567890(17)…".
 */
const GS1_AIM = /^\](?:C1|d2|Q3|e0)/;
const AIM = /^\][A-Za-z][0-9A-Za-z]/;
const GS = "\u001d";

/**
 * Turns whatever arrived (camera text, a hand scanner's keystrokes, typing)
 * into the code to look up: control characters (the scanner's Enter, tabs,
 * the GS separator) and spaces removed, an AIM symbology prefix dropped, a
 * GS1 element string reduced to its GTIN, letters in capitals (stock codes
 * are printed as YT-XXXXXXXX).
 */
export function cleanScan(raw: string): string {
  let text = raw.trim();
  // An AIM prefix for GS1, or the GS separator (FNC1) some scanners send
  // between variable-length elements: either way it is an element string.
  const gs1 = GS1_AIM.test(text) || text.includes(GS);
  text = text.replace(AIM, "");
  // biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
  text = text.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, "");
  const printed = /^\(01\)(\d{14})/.exec(text);
  if (printed?.[1]) return printed[1];
  if (gs1) {
    const element = /^01(\d{14})/.exec(text);
    if (element?.[1]) return element[1];
  }
  return text.toUpperCase();
}

/** The GS1 check digit of the digits before it (weights 3, 1, 3… from the right). */
export function gtinCheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const digit = Number(body[body.length - 1 - i]);
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

/** True for an 8, 12, 13 or 14 digit GTIN whose last digit checks out. */
export function isValidGtin(code: string): boolean {
  if (!/^(?:\d{8}|\d{12,14})$/.test(code)) return false;
  return gtinCheckDigit(code.slice(0, -1)) === Number(code.slice(-1));
}

/**
 * UPC-E (8 digits, number system 0 or 1) written out as the UPC-A it stands
 * for, or null if the code cannot be one. A product stored with its 12-digit
 * UPC-A must match when the box carries the short form.
 */
export function expandUpcE(code: string): string | null {
  if (!/^[01]\d{7}$/.test(code)) return null;
  const system = code.charAt(0);
  const d = code.slice(1, 7);
  const check = code.charAt(7);
  const last = Number(d.charAt(5));
  let body: string;
  if (last <= 2) body = `${d.slice(0, 2)}${last}0000${d.slice(2, 5)}`;
  else if (last === 3) body = `${d.slice(0, 3)}00000${d.slice(3, 5)}`;
  else if (last === 4) body = `${d.slice(0, 4)}00000${d.charAt(4)}`;
  else body = `${d.slice(0, 5)}0000${last}`;
  const upcA = `${system}${body}${check}`;
  return isValidGtin(upcA) ? upcA : null;
}

export type ScanCheck = { ok: true; code: string } | { ok: false; error: string };

/**
 * Whether a cleaned code can be looked up. A 12–14 digit number is a GTIN, so
 * a wrong check digit means it was misread or mistyped: refused with a
 * message, rather than sent and answered "not found". (An 8-digit number may
 * be a GTIN-8 or an internal code, so it is not refused on its check digit.)
 */
export function validateScan(code: string): ScanCheck {
  if (code.length === 0) return { ok: false, error: "Escanee o escriba el código." };
  if (code.length > MAX_CODE_LENGTH) {
    return {
      ok: false,
      error: "Ese código es demasiado largo. Revise que escaneó la etiqueta del producto.",
    };
  }
  if (!/^[A-Z0-9][A-Z0-9./_-]*$/.test(code)) {
    return {
      ok: false,
      error: "Ese código tiene caracteres que no reconocemos. Vuelva a escanearlo o escríbalo.",
    };
  }
  if (/^\d{12,14}$/.test(code) && !isValidGtin(code)) {
    return {
      ok: false,
      error:
        "Ese código de barras no es válido: puede que se haya leído o escrito mal. Revíselo e inténtelo de nuevo.",
    };
  }
  return { ok: true, code };
}

/** Clean, then check: what every scan screen does with a read before using it. */
export function readScan(raw: string): ScanCheck {
  return validateScan(cleanScan(raw));
}

/**
 * The forms one product code can arrive in, made comparable: a GTIN padded to
 * 14 digits (the camera on iOS reports a UPC-A as a 13-digit EAN with a
 * leading 0), plus the UPC-A an 8-digit UPC-E stands for.
 */
export function codeKeys(code: string): string[] {
  const cleaned = cleanScan(code);
  if (!/^\d+$/.test(cleaned) || cleaned.length > 14) return [cleaned];
  const keys = new Set([cleaned.padStart(14, "0")]);
  const upcA = cleaned.length === 8 ? expandUpcE(cleaned) : null;
  if (upcA) keys.add(upcA.padStart(14, "0"));
  return [...keys];
}

/**
 * The spellings of a code worth asking the database for, in order: as read,
 * then the same GTIN at its other usual lengths (a UPC-A read as a 13-digit
 * EAN on iOS, a GTIN-14 with a leading 0, the UPC-A behind a UPC-E). The
 * lookup function compares barcodes as stored, so a scan screen tries these
 * one by one until one is found.
 */
export function lookupForms(code: string): string[] {
  const cleaned = cleanScan(code);
  const forms = [cleaned];
  if (/^\d+$/.test(cleaned) && cleaned.length <= 14) {
    for (const key of codeKeys(cleaned)) {
      for (const length of [12, 13, 14, 8]) {
        const form = key.slice(14 - length);
        if (key.slice(0, 14 - length).replace(/0/g, "") === "" && isValidGtin(form)) {
          forms.push(form);
        }
      }
    }
  }
  return [...new Set(forms)];
}

/** What a line expects: its stock code and, when the product has one, its barcode. */
export interface ScanTarget {
  sku_code: string;
  gtin?: string | null;
}

/** True when the code is this target's stock code or barcode, in any of its forms. */
export function matchesTarget(code: string, target: ScanTarget): boolean {
  const keys = new Set(codeKeys(code));
  const forms = [target.sku_code, target.gtin].filter((form): form is string => Boolean(form));
  return forms.some((form) => codeKeys(form).some((key) => keys.has(key)));
}

export type ScanMatch<T> =
  | { kind: "expected"; line: T }
  | { kind: "other"; line: T }
  | { kind: "none" };

/**
 * Matches a scan to the line the worker is on. A code that belongs to another
 * line still waiting is told apart from one that is not in the list at all,
 * so the screen can say which.
 */
export function matchScan<T extends ScanTarget>(
  code: string,
  expected: T | null | undefined,
  others: readonly T[] = [],
): ScanMatch<T> {
  if (expected && matchesTarget(code, expected)) return { kind: "expected", line: expected };
  const other = others.find((line) => line !== expected && matchesTarget(code, line));
  return other ? { kind: "other", line: other } : { kind: "none" };
}

/**
 * Turns the camera's stream of sightings into reads. The camera reports a
 * code for every frame it is in view, many times a second; a read is only:
 *   - a code not seen in the last `repeatMs` (each sighting restarts that
 *     wait, so a code held in front of the lens fires once, not every second);
 *   - and only while no other read is being handled (`release()` ends that).
 */
export function createScanGate({
  repeatMs = 1500,
  now = () => Date.now(),
}: {
  repeatMs?: number;
  now?: () => number;
} = {}) {
  const seen = new Map<string, number>();
  let busy = false;
  return {
    /** The cleaned code if this sighting is a new read, otherwise null. */
    offer(raw: string): string | null {
      const code = cleanScan(raw);
      if (!code) return null;
      const at = now();
      for (const [key, time] of seen) if (at - time > repeatMs * 4) seen.delete(key);
      const previous = seen.get(code);
      seen.set(code, at);
      if (previous !== undefined && at - previous < repeatMs) return null;
      if (busy) return null;
      busy = true;
      return code;
    },
    /** The read was handled: the next new code may fire. */
    release() {
      busy = false;
    },
    /** Forget every code seen, e.g. when the screen moves to another line. */
    reset() {
      seen.clear();
      busy = false;
    },
    get busy() {
      return busy;
    },
  };
}
export type ScanGate = ReturnType<typeof createScanGate>;

/**
 * The code as the screen repeats it back ("Código leído: …"): a junk read or
 * a QR full of text must not fill the screen and push the field out of view.
 */
export function shortCode(code: string, max = MAX_CODE_LENGTH): string {
  const chars = [...code];
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : code;
}

/**
 * Asks the database for a code in each of its spellings (`lookupForms`),
 * one at a time, and returns the first answer found. Every screen that looks
 * a scanned barcode up goes through this, so none of them misses a UPC-A that
 * iOS reported as a 13-digit EAN.
 */
export async function findByForms<T>(
  code: string,
  lookup: (form: string) => Promise<T | null | undefined>,
): Promise<T | null> {
  for (const form of lookupForms(code)) {
    const found = await lookup(form);
    if (found) return found;
  }
  return null;
}

/**
 * Reads, one after the other, in the order they came. A hand scanner can send
 * the next code while the last one is still being checked (slow Wi-Fi on the
 * floor); that read waits its turn instead of being lost. `limit` bounds the
 * wait so a scanner stuck on repeat cannot pile up work.
 */
export function createScanQueue<T>(run: (item: T) => Promise<void>, { limit = 5 } = {}) {
  const waiting: T[] = [];
  let busy = false;
  return {
    /** "ran" once this read and any that came in meanwhile were handled; "queued" or "dropped" otherwise. */
    async push(item: T): Promise<"ran" | "queued" | "dropped"> {
      if (busy) {
        if (waiting.length >= limit) return "dropped";
        waiting.push(item);
        return "queued";
      }
      busy = true;
      try {
        let next: T | undefined = item;
        while (next !== undefined) {
          try {
            await run(next);
          } catch {
            // `run` reports its own failures; the queue goes on to the next read.
          }
          next = waiting.shift();
        }
      } finally {
        busy = false;
      }
      return "ran";
    },
    get busy() {
      return busy;
    },
    get waiting() {
      return waiting.length;
    },
  };
}

/** Where a read is, as the camera frame shows it. */
export type ReadState =
  | { phase: "checking"; code: string }
  | { phase: "done"; tone: "success" | "warning" | "danger"; title?: string; code?: string };

/**
 * The camera frame's caption for a read: the result in words, with an icon
 * that matches it. Nothing says "correct" before the screen has checked the
 * code, and a refused read reads differently from an accepted one, so a
 * worker glancing at the frame can tell them apart without the colours.
 */
export function readCaption(state: ReadState | null): {
  icon: "check" | "cross" | "attention" | null;
  text: string;
} {
  if (!state) return { icon: null, text: "Ponga el código dentro del marco" };
  if (state.phase === "checking") {
    return { icon: null, text: `Revisando ${shortCode(state.code, 24)}…` };
  }
  const code = state.code ? ` · ${shortCode(state.code, 24)}` : "";
  if (state.tone === "success") return { icon: "check", text: `Correcto${code}` };
  if (state.tone === "warning")
    return { icon: "attention", text: `${state.title ?? "Revise"}${code}` };
  return { icon: "cross", text: `${state.title ?? "No se aceptó"}${code}` };
}

/**
 * Keeps a hand scanner's code out of a number field next to the scan field
 * (how many units were taken). A scanner types into whatever has focus, so
 * after the worker edits the number, the next scan arrives there. Two signs
 * tell a scan from a number: a character that is not a digit (stock codes
 * start with letters), or a fast burst of keys ended by Enter (a barcode of
 * digits). What belongs to the scan is handed back, and the number is left
 * as the worker typed it.
 */
export function createNumberFieldGuard({
  burstMs = 40,
  minBurst = 4,
  now = () => Date.now(),
}: {
  burstMs?: number;
  minBurst?: number;
  now?: () => number;
} = {}) {
  let text = "";
  let stable = "";
  let burst = 0;
  let lastAt = Number.NEGATIVE_INFINITY;
  return {
    /** The field's value as set by the screen (a new line, a reset). */
    reset(value: string) {
      text = value;
      stable = value;
      burst = 0;
      lastAt = Number.NEGATIVE_INFINITY;
    },
    /** A change typed into the number field: what it keeps, and a scan if one started. */
    change(next: string): { value: string; scan?: string } {
      const at = now();
      if (at - lastAt > burstMs) {
        stable = text;
        burst = 0;
      }
      burst += 1;
      lastAt = at;
      const letter = next.search(/[^0-9]/);
      if (letter >= 0) {
        const value = next.slice(0, letter);
        text = value;
        stable = value;
        burst = 0;
        return { value, scan: next.slice(letter) };
      }
      text = next;
      return { value: next };
    },
    /** Enter in the number field: a scan if a fast burst just came before it. */
    enter(): { value: string; scan?: string } {
      const at = now();
      if (burst >= minBurst && at - lastAt <= burstMs * 4 && text.startsWith(stable)) {
        const scan = text.slice(stable.length);
        text = stable;
        burst = 0;
        return { value: stable, scan };
      }
      return { value: text };
    },
  };
}
