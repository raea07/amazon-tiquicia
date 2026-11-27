/**
 * What an error report may carry, decided before anything leaves the app.
 *
 * Pure functions, no I/O and no SDK: the tracker's SDK hands every event to
 * `scrubEvent` just before sending (its `beforeSend`), and whatever this
 * returns is all that is sent. It works by keeping, not by removing: a new
 * event is built from the few fields listed here, so a field the SDK adds in a
 * later version is left out until someone decides it may go.
 *
 * Kept: the error's type and message, the stack (file, function, line), which
 * website, environment and commit, the page's path without its query, the
 * route pattern, the runtime, and for a database error its short code (what
 * `private.fail` raises) and, for an answer the client did not expect, the
 * database function's name.
 *
 * Never kept: cookies and every header; request bodies, form fields and query
 * strings; the user (id, e-mail, IP address); breadcrumbs (clicks, typed
 * text, console lines, addresses visited); extra data and every other
 * context; a database error's detail text; local variables; source lines. Every string
 * that is kept goes through `redactText`, which removes what looks like an
 * e-mail address, a Costa Rican phone or identity number, a delivery code,
 * an IP address, a token or a key. A street address cannot be recognised in
 * free text, which is why no free text from the page or the database is kept
 * at all.
 */

/** The websites that report errors. */
export type ReportingApp = "web" | "seller" | "ops" | "field";

/** The parts of a Sentry event this module reads. Everything else is dropped. */
export interface TrackerEvent {
  event_id?: string;
  timestamp?: number;
  start_timestamp?: number;
  platform?: string;
  level?: string;
  logger?: string;
  type?: string;
  message?: string | { message?: string; formatted?: string; params?: unknown[] };
  logentry?: { message?: string; formatted?: string; params?: unknown[] };
  transaction?: string;
  release?: string;
  dist?: string;
  environment?: string;
  server_name?: string;
  fingerprint?: string[];
  exception?: { values?: TrackerException[] };
  request?: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    cookies?: Record<string, string>;
    data?: unknown;
    query_string?: unknown;
    env?: Record<string, string>;
  };
  user?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  contexts?: Record<string, Record<string, unknown> | undefined>;
  breadcrumbs?: unknown[];
  sdk?: {
    name?: string;
    version?: string;
    integrations?: string[];
    packages?: unknown[];
  };
  debug_meta?: { images?: Array<Record<string, unknown>> };
  modules?: Record<string, string>;
  sdkProcessingMetadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface TrackerException {
  type?: string;
  value?: string;
  module?: string;
  mechanism?: {
    type?: string;
    handled?: boolean;
    synthetic?: boolean;
    [key: string]: unknown;
  };
  stacktrace?: { frames?: TrackerFrame[]; [key: string]: unknown };
  [key: string]: unknown;
}

export interface TrackerFrame {
  filename?: string;
  abs_path?: string;
  function?: string;
  module?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
  pre_context?: string[];
  context_line?: string;
  post_context?: string[];
  vars?: Record<string, unknown>;
  [key: string]: unknown;
}

/** The longest string kept anywhere in a report. */
export const MAX_TEXT = 500;
/** The most stack frames kept per exception (the innermost ones). */
export const MAX_FRAMES = 60;

// ── Text ──────────────────────────────────────────────────────────────────

/**
 * How much of a string the rules read: the start of it, a few times what is
 * kept. Every rule is bounded, so this keeps one long message (a large value
 * in an error, a long validation error) from costing more than a moment on
 * the server or in the page.
 */
const WINDOW_FACTOR = 8;

/**
 * Where a number may start and end: not right after a digit (or a digit and
 * one separator), and not right before one. A full stop, comma or bracket
 * after the last digit ends the number ("Llame al 8888-1234."), but a full
 * stop followed by a digit does not ("1.2.3.4.5" is one run).
 */
const N0 = String.raw`(?<!\d[\s.-]?)`;
const N1 = String.raw`(?![\s.-]?\d)`;
const num = (body: string) => new RegExp(`${N0}(?:${body})${N1}`, "g");

/**
 * The words a delivery code is written next to, in text and in field names:
 * "código de entrega", "codigoEntrega", "delivery_pin", "deliveryPin", "PIN",
 * "code". Matched anywhere a letter or digit does not come right before it,
 * so an underscore or a quote is a boundary too.
 */
const CODE_WORD = String.raw`(?<![\p{L}\p{N}])(?:delivery[\s_-]?(?:pin|code)|c[oó]digo(?:[\s_-]*(?:de[\s_-]*)?entrega)?|pin|code)`;

const RULES: Array<[RegExp, string]> = [
  // Query strings and fragments of any address: a search, a sign-in link's
  // token, an e-mail confirmation. The path stays.
  [/(?<![\w/])(https?:\/\/[^\s/?#"'<>]{1,253}(?:\/[^\s?#"'<>]*)?)[?#][^\s"'<>]*/gi, "$1"],
  [/((?<![\w/])\/[^\s?#"'<>]*)[?#][^\s"'<>]*/g, "$1"],
  // The user name and password some addresses carry (https://user:pass@host).
  [/\b([a-z][a-z0-9+.-]{0,30}:\/\/)[^\s/@"'<>]+@/gi, "$1"],
  // Tokens and keys: JSON Web Tokens, the project's keys, "Bearer …", and any
  // name=value pair whose name says it is a secret.
  [/(?<![\w-])eyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]*/g, "[token]"],
  [/\bsb_(?:publishable|secret)_[\w-]+/gi, "[key]"],
  [/\b(bearer|basic)\s+[\w.~+/=-]{8,}/gi, "$1 [token]"],
  [
    /\b(password|passwd|contrase(?:ñ|n)a|clave|secret|token|api[_-]?key|apikey|authorization|cookie|session|dsn|pin)(["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi,
    "$1$2[filtered]",
  ],
  // E-mail addresses, also written for an address bar (ana%40example.com).
  // Bounded as the standard bounds them: 64 characters before the @, 63 per
  // part of the domain.
  [
    /[\p{L}\p{N}._%+-]{1,64}(?:@|%40)[\p{L}\p{N}-]{1,63}(?:\.[\p{L}\p{N}-]{1,63}){0,8}\.\p{L}{2,24}(?![\p{L}\p{N}-])/giu,
    "[email]",
  ],
  // Long random strings: ids, hashes, keys (a UUID is one). An account's id is
  // personal; none of these helps to read an error. A long string is read
  // once, from its start.
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]"],
  [/(?<![\w./-])(?=[\w.-]*\d)(?=[\w.-]*[a-zA-Z])[\w.-]{32,}(?![\w-])/g, "[token]"],
  // IP addresses.
  [/(?<!\d\.?)(?:\d{1,3}\.){3}\d{1,3}(?!\.?\d)/g, "[ip]"],
  [/(?<![\w:])(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}(?![\w:])/gi, "[ip]"],
  // Costa Rican phone numbers: 8 digits starting 2, 4, 5, 6, 7 or 8, with or
  // without +506. Written whole, as 4 and 4, as 4, 2 and 2, or as pairs. With
  // the country code first, so the long-number rule below does not take it.
  [num(String.raw`(?:\+|00)?506[\s-]?[245678](?:[\s.-]?\d){7}`), "[phone]"],
  // Identity numbers, bank accounts and cards: any run of 9 or more digits,
  // with or without separators (cédula 1-0234-0567, jurídica 3-101-123456,
  // DIMEX and NITE, IBAN CR05 0152…, card numbers), and a cédula written
  // short (1-234-567).
  [/\bCR\d{2}(?:[\s-]?\d){18}\b/gi, "[number]"],
  [num(String.raw`\d(?:[\s.-]?\d){8,}`), "[number]"],
  [num(String.raw`[1-9]-\d{3,4}-\d{3,4}`), "[number]"],
  [
    num(
      // Not a date written 2026-11-27: the 4, 2 and 2 form skips one.
      String.raw`[245678]\d{3}[\s.-]?\d{4}|[245678]\d[\s.-]\d{2}[\s.-]\d{2}[\s.-]\d{2}|(?!(?:19|20)\d{2}-[01]\d-[0-3]\d)[245678]\d{3}[\s.-]\d{2}[\s.-]\d{2}`,
    ),
    "[phone]",
  ],
  // A delivery code: a number of 4 to 6 digits after the word for it (within
  // 60 characters, whatever lies between) or just before it. (The code is 4
  // digits today; 6 covers a longer one.) After the phone and identity rules,
  // so their digits are not taken for a code.
  [new RegExp(String.raw`(?<=${CODE_WORD}[^\n]{0,60}?)(?<!\d)\d{4,6}(?!\d)`, "giu"), "[code]"],
  [new RegExp(String.raw`(?<!\d)\d{4,6}(?!\d)(?=[^\d\n]{0,25}?${CODE_WORD})`, "giu"), "[code]"],
];

/**
 * Quoted text in a message is nearly always a value: a JSON snippet, what a
 * form held, a name. It is replaced, except a short lower-case identifier
 * (a property name such as 'name' in "reading 'name'"), which helps to read
 * the error and is not a person's data. A name written into a message
 * without quotes cannot be recognised; no code of the websites does that
 * (scrub.test.ts checks their error messages).
 */
const QUOTED = /(["“'‘«])([^"“”'‘’«»\n]+)(["”'’»])/g;
const IDENTIFIER = /^[a-z_$][\w$.-]{0,39}$/;
const quoted = (text: string) =>
  text.replace(QUOTED, (_all, open: string, inner: string, close: string) =>
    IDENTIFIER.test(inner) || /^\[[a-z-]+\]$/.test(inner)
      ? `${open}${inner}${close}`
      : `${open}[text]${close}`,
  );

/**
 * Removes from a string what may identify a person, and shortens it. Safe on
 * any input; non-strings become empty strings. Only the start of a long
 * string is read (WINDOW_FACTOR times what is kept); the last, possibly cut,
 * word or number of that start is dropped, and so is text after a quote that
 * the cut left open, so nothing cut in half escapes a rule.
 */
export function redactText(input: unknown, max = MAX_TEXT): string {
  if (typeof input !== "string") return "";
  const window = Math.max(max, 64) * WINDOW_FACTOR;
  const cut = input.length > window;
  let text = cut
    ? input
        .slice(0, window)
        .replace(/\S+$/u, "")
        .replace(/[\d\s.()+-]+$/u, "")
    : input;
  for (const [pattern, replacement] of RULES) text = text.replace(pattern, replacement);
  text = quoted(text);
  if (cut) text = text.replace(/["“'‘«][^"“”'‘’«»\n]*$/u, "[text]");
  return cut || text.length > max ? `${text.slice(0, max)}…` : text;
}

/** An address without its query string, fragment, user name or password. */
export function pathOnly(input: unknown): string {
  if (typeof input !== "string" || input === "") return "";
  return redactText(input.split(/[?#]/)[0] ?? "");
}

// ── Database errors ───────────────────────────────────────────────────────

/** A short code as `private.fail` raises it, or one of the client's own. */
const DB_CODE = /^[a-z][a-z0-9_]{1,62}$/;
const DB_FUNCTION = /^[a-z][a-z0-9_]{1,62}$/;

/**
 * What may be said about a database error: its short code, and for an answer
 * of the wrong shape (`invalid_response`) the name of the function. Read from
 * the original exception (packages/db's ApiError); its `detail` (an offer id,
 * a new total) and its cause's text never leave.
 */
export function databaseFacts(original: unknown): {
  db_code?: string;
  db_function?: string;
} {
  if (!original || typeof original !== "object") return {};
  const error = original as {
    name?: unknown;
    code?: unknown;
    detail?: unknown;
  };
  if (error.name !== "ApiError" || typeof error.code !== "string" || !DB_CODE.test(error.code)) {
    return {};
  }
  const facts: { db_code?: string; db_function?: string } = {
    db_code: error.code,
  };
  if (
    error.code === "invalid_response" &&
    typeof error.detail === "string" &&
    DB_FUNCTION.test(error.detail)
  ) {
    facts.db_function = error.detail;
  }
  return facts;
}

// ── Events ────────────────────────────────────────────────────────────────

const ROLES = new Set(["visitor", "shopper", "seller", "staff", "driver", "warehouse"]);
const TAGS = new Set(["app", "runtime", "role", "db_code", "db_function", "drill"]);
const CONTEXT_KEYS: Record<string, readonly string[]> = {
  runtime: ["name", "version"],
  nextjs: ["route_type", "router_kind", "router_path", "request_path"],
};

function scrubFrame(frame: TrackerFrame): TrackerFrame {
  const out: TrackerFrame = {};
  if (frame.filename) out.filename = pathOnly(frame.filename);
  if (frame.abs_path) out.abs_path = pathOnly(frame.abs_path);
  if (frame.module) out.module = redactText(frame.module, 200);
  if (frame.function) out.function = redactText(frame.function, 200);
  if (typeof frame.lineno === "number") out.lineno = frame.lineno;
  if (typeof frame.colno === "number") out.colno = frame.colno;
  if (typeof frame.in_app === "boolean") out.in_app = frame.in_app;
  // No source lines and no local variables: a frame says where, never what.
  return out;
}

function scrubException(exception: TrackerException): TrackerException {
  const out: TrackerException = {};
  if (exception.type) out.type = redactText(exception.type, 200);
  if (exception.value !== undefined) out.value = redactText(exception.value);
  if (exception.module) out.module = redactText(exception.module, 200);
  if (exception.mechanism) {
    const { type, handled, synthetic, exception_id, parent_id, is_exception_group, source } =
      exception.mechanism;
    out.mechanism = {};
    if (typeof type === "string") out.mechanism.type = redactText(type, 100);
    if (typeof handled === "boolean") out.mechanism.handled = handled;
    if (typeof synthetic === "boolean") out.mechanism.synthetic = synthetic;
    if (typeof exception_id === "number") out.mechanism.exception_id = exception_id;
    if (typeof parent_id === "number") out.mechanism.parent_id = parent_id;
    if (typeof is_exception_group === "boolean")
      out.mechanism.is_exception_group = is_exception_group;
    if (typeof source === "string") out.mechanism.source = redactText(source, 100);
  }
  const frames = exception.stacktrace?.frames;
  if (Array.isArray(frames)) {
    out.stacktrace = { frames: frames.slice(-MAX_FRAMES).map(scrubFrame) };
  }
  return out;
}

function messageText(event: TrackerEvent): string | undefined {
  const raw = event.logentry ?? event.message;
  if (raw === undefined) return undefined;
  if (typeof raw === "string") return raw;
  // A message's parameters are values from the caller: never kept.
  return raw.message ?? raw.formatted;
}

export interface ScrubOptions {
  app: ReportingApp;
  environment?: string;
  release?: string;
  /** The original thrown value (the SDK's hint), to read a database code from. */
  original?: unknown;
}

/**
 * The only form of an event that may be sent. Returns null for anything that
 * is not an error (a transaction, a span, a replay, feedback): those are not
 * sent at all.
 */
export function scrubEvent(event: TrackerEvent, options: ScrubOptions): TrackerEvent | null {
  if (event.type !== undefined && event.type !== "event") return null;

  const out: TrackerEvent = {};
  for (const key of ["event_id", "timestamp", "platform", "level", "dist"] as const) {
    const value = event[key];
    if (typeof value === "string" || typeof value === "number") {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  // Set by this module's caller from the build (settings.ts), not by the page.
  out.environment = (options.environment ?? "unknown").slice(0, 64);
  if (options.release) out.release = options.release.slice(0, 200);
  if (event.logger) out.logger = redactText(event.logger, 100);

  const message = messageText(event);
  if (message !== undefined) out.message = redactText(message);

  const values = event.exception?.values;
  if (Array.isArray(values)) out.exception = { values: values.map(scrubException) };

  if (event.transaction) out.transaction = pathOnly(event.transaction);
  if (Array.isArray(event.fingerprint)) {
    out.fingerprint = event.fingerprint.map((part) => redactText(part, 200));
  }

  // The request: the page's path and the method, nothing else.
  if (event.request && (event.request.url || event.request.method)) {
    out.request = {};
    if (event.request.url) out.request.url = pathOnly(event.request.url);
    if (typeof event.request.method === "string" && /^[A-Z]{3,7}$/.test(event.request.method)) {
      out.request.method = event.request.method;
    }
  }

  // Tags: only the named ones, and a role only from the fixed list.
  const tags: Record<string, string> = {};
  for (const [key, value] of Object.entries(event.tags ?? {})) {
    if (!TAGS.has(key) || (typeof value !== "string" && typeof value !== "boolean")) continue;
    if (key === "role" && !ROLES.has(String(value))) continue;
    tags[key] = redactText(String(value), 100);
  }
  tags.app = options.app;
  Object.assign(tags, databaseFacts(options.original));
  out.tags = tags;

  // Contexts: the runtime and the route's shape.
  const contexts: Record<string, Record<string, unknown>> = {};
  for (const [name, keys] of Object.entries(CONTEXT_KEYS)) {
    const source = event.contexts?.[name];
    if (!source) continue;
    const kept: Record<string, unknown> = {};
    for (const key of keys) {
      const value = source[key];
      if (typeof value !== "string") continue;
      kept[key] = key === "request_path" ? pathOnly(value) : redactText(value, 200);
    }
    if (Object.keys(kept).length > 0) contexts[name] = kept;
  }
  if (Object.keys(contexts).length > 0) out.contexts = contexts;

  // Which SDK sent it (name and version only), and the build ids that let
  // the tracker match uploaded source maps later.
  if (event.sdk?.name) {
    out.sdk = {
      name: redactText(event.sdk.name, 100),
      version: redactText(event.sdk.version, 50),
    };
  }
  const images = event.debug_meta?.images;
  if (Array.isArray(images)) {
    const kept = images
      .filter((image) => typeof image.debug_id === "string")
      .map((image) => ({
        type: typeof image.type === "string" ? image.type : "sourcemap",
        debug_id: String(image.debug_id),
        code_file: pathOnly(image.code_file),
      }));
    if (kept.length > 0) out.debug_meta = { images: kept };
  }
  return out;
}

/** Breadcrumbs (clicks, typing, console lines, visited addresses) are never sent. */
export const dropBreadcrumb = (): null => null;
