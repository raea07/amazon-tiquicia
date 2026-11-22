/**
 * Hacienda's API, as its reference documents it (research note 5.1 to 5.6),
 * and nothing it does not:
 *
 *   token      POST {token URL}, password grant (client api-stag / api-prod),
 *              refresh grant; access tokens live about 5 minutes
 *   recepcion  POST {base}/recepcion with the JSON envelope; 201 received
 *              (any 2xx is treated so), 400 validation error with X-Error-Cause,
 *              401 token missing or expired
 *   status     GET {base}/recepcion/{clave}; ind-estado recibido, procesando,
 *              aceptado, rechazado or error, with respuesta-xml once final;
 *              404 when the clave is unknown
 *
 * A 403 is the gateway's answer for a path that does not exist (5.1): it is
 * treated as a configuration error, never as an answer about a document.
 * Every other failure (network, timeout, 5xx, 429) is "try again later".
 */

import { base64ToBytes, bytesToBase64 } from "./der.ts";

export interface HaciendaSettings {
  tokenUrl: string;
  clientId: string;
  username: string;
  password: string;
  /** Ends with /recepcion/v1/ (the sandbox host is a setting: research note 5.1). */
  apiBase: string;
  timeoutMs: number;
}

export interface HaciendaClock {
  now(): Date;
}

export type HaciendaState = "recibido" | "procesando" | "aceptado" | "rechazado" | "error";
const STATES = new Set<HaciendaState>(["recibido", "procesando", "aceptado", "rechazado", "error"]);

export type SubmitResult =
  | { kind: "received"; status: number; location: string | null }
  | { kind: "duplicate"; status: number; cause: string }
  | { kind: "refused"; status: number; cause: string }
  | { kind: "unauthorized"; status: number }
  | { kind: "config"; status: number; cause: string }
  | { kind: "retry"; status: number | null; cause: string; retryAfterSeconds: number | null };

export type StatusResult =
  | { kind: "state"; state: HaciendaState; responseXml: string | null }
  | { kind: "unknown"; status: number; cause: string }
  | { kind: "unauthorized"; status: number }
  | { kind: "config"; status: number; cause: string }
  | { kind: "retry"; status: number | null; cause: string; retryAfterSeconds: number | null };

export interface Envelope {
  clave: string;
  fecha: string;
  emisor: { tipoIdentificacion: string; numeroIdentificacion: string };
  receptor?: { tipoIdentificacion: string; numeroIdentificacion: string };
  callbackUrl?: string;
  /** The signed XML, UTF-8, Base64. */
  comprobanteXml: string;
}

export const toBase64 = (text: string) => bytesToBase64(new TextEncoder().encode(text));
export const fromBase64 = (base64: string) => new TextDecoder().decode(base64ToBytes(base64));

/** "El comprobante con la Clave […] ya fue recibido." means an earlier attempt got in. */
export const isAlreadyReceived = (cause: string) => /ya\s+fue\s+recibido/i.test(cause);

function retryAfter(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (header && /^\d+$/.test(header)) return Number(header);
  if (response.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    if (Number.isFinite(reset) && reset > 0) {
      // Either seconds to wait or an epoch time; both are read as a wait.
      return reset > 1_000_000_000 ? Math.max(1, Math.ceil(reset - Date.now() / 1000)) : reset;
    }
  }
  return null;
}

const causeOf = (response: Response, body: string) =>
  (response.headers.get("x-error-cause") ?? body ?? "").slice(0, 500);

async function timed(fetchImpl: typeof fetch, url: string, init: RequestInit, ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export class TokenError extends Error {
  constructor(
    readonly kind: "config" | "retry",
    message: string,
  ) {
    super(message);
  }
}

/**
 * The access token, kept in memory and renewed when fewer than 30 seconds are
 * left (research note 5.2). One request at a time: callers wait for the same
 * renewal. The refresh token is used while it lasts, then the password grant.
 */
export class TokenSource {
  private access: { token: string; expires: number } | null = null;
  private refresh: { token: string; expires: number } | null = null;
  private pending: Promise<string> | null = null;

  constructor(
    private readonly settings: HaciendaSettings,
    private readonly fetchImpl: typeof fetch,
    private readonly clock: HaciendaClock,
  ) {}

  invalidate() {
    this.access = null;
  }

  async get(): Promise<string> {
    const now = this.clock.now().getTime();
    if (this.access && this.access.expires - now > 30_000) return this.access.token;
    if (!this.pending) {
      this.pending = this.renew().finally(() => {
        this.pending = null;
      });
    }
    return this.pending;
  }

  private async renew(): Promise<string> {
    const now = this.clock.now().getTime();
    const useRefresh = this.refresh && this.refresh.expires - now > 30_000;
    const form = new URLSearchParams(
      useRefresh && this.refresh
        ? {
            grant_type: "refresh_token",
            client_id: this.settings.clientId,
            refresh_token: this.refresh.token,
          }
        : {
            grant_type: "password",
            client_id: this.settings.clientId,
            username: this.settings.username,
            password: this.settings.password,
          },
    );
    let response: Response;
    try {
      response = await timed(
        this.fetchImpl,
        this.settings.tokenUrl,
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
          body: form.toString(),
        },
        this.settings.timeoutMs,
      );
    } catch (error) {
      throw new TokenError("retry", `token request failed: ${String(error).slice(0, 100)}`);
    }
    const text = await response.text();
    if (!response.ok) {
      if (useRefresh) {
        // An expired or revoked refresh token: start again with the password.
        this.refresh = null;
        return this.renew();
      }
      throw new TokenError(
        response.status >= 500 || response.status === 429 ? "retry" : "config",
        `token refused: ${response.status}`,
      );
    }
    let body: {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      refresh_expires_in?: number;
    };
    try {
      body = JSON.parse(text);
    } catch {
      throw new TokenError("retry", "token answer is not JSON");
    }
    if (!body.access_token) throw new TokenError("retry", "token answer without access_token");
    const at = this.clock.now().getTime();
    this.access = { token: body.access_token, expires: at + (body.expires_in ?? 300) * 1000 };
    this.refresh = body.refresh_token
      ? { token: body.refresh_token, expires: at + (body.refresh_expires_in ?? 0) * 1000 }
      : null;
    return body.access_token;
  }
}

export class HaciendaClient {
  readonly tokens: TokenSource;

  constructor(
    private readonly settings: HaciendaSettings,
    private readonly fetchImpl: typeof fetch,
    clock: HaciendaClock,
  ) {
    this.tokens = new TokenSource(settings, fetchImpl, clock);
  }

  private url(path: string) {
    return `${this.settings.apiBase.replace(/\/?$/, "/")}${path}`;
  }

  async submit(envelope: Envelope): Promise<SubmitResult> {
    let token: string;
    try {
      token = await this.tokens.get();
    } catch (error) {
      return tokenFailure(error);
    }
    let response: Response;
    try {
      response = await timed(
        this.fetchImpl,
        this.url("recepcion"),
        {
          method: "POST",
          headers: { authorization: `bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify(envelope),
        },
        this.settings.timeoutMs,
      );
    } catch (error) {
      return {
        kind: "retry",
        status: null,
        cause: String(error).slice(0, 200),
        retryAfterSeconds: null,
      };
    }
    const body = await response.text().catch(() => "");
    const status = response.status;
    if (status >= 200 && status < 300) {
      return { kind: "received", status, location: response.headers.get("location") };
    }
    if (status === 400) {
      const cause = causeOf(response, body);
      return isAlreadyReceived(cause)
        ? { kind: "duplicate", status, cause }
        : { kind: "refused", status, cause };
    }
    if (status === 401) {
      this.tokens.invalidate();
      return { kind: "unauthorized", status };
    }
    if (status === 429 || status >= 500) {
      return {
        kind: "retry",
        status,
        cause: causeOf(response, body),
        retryAfterSeconds: retryAfter(response),
      };
    }
    return { kind: "config", status, cause: causeOf(response, body) };
  }

  async status(clave: string): Promise<StatusResult> {
    let token: string;
    try {
      token = await this.tokens.get();
    } catch (error) {
      return tokenFailure(error);
    }
    let response: Response;
    try {
      response = await timed(
        this.fetchImpl,
        this.url(`recepcion/${encodeURIComponent(clave)}`),
        {
          method: "GET",
          headers: { authorization: `bearer ${token}`, accept: "application/json" },
        },
        this.settings.timeoutMs,
      );
    } catch (error) {
      return {
        kind: "retry",
        status: null,
        cause: String(error).slice(0, 200),
        retryAfterSeconds: null,
      };
    }
    const body = await response.text().catch(() => "");
    const status = response.status;
    if (status === 200) {
      const answer = parseAnswer(body);
      if (!answer)
        return { kind: "retry", status, cause: "unreadable answer", retryAfterSeconds: null };
      return { kind: "state", ...answer };
    }
    if (status === 404) return { kind: "unknown", status, cause: causeOf(response, body) };
    if (status === 401) {
      this.tokens.invalidate();
      return { kind: "unauthorized", status };
    }
    if (status === 429 || status >= 500) {
      return {
        kind: "retry",
        status,
        cause: causeOf(response, body),
        retryAfterSeconds: retryAfter(response),
      };
    }
    return { kind: "config", status, cause: causeOf(response, body) };
  }
}

function tokenFailure(error: unknown) {
  if (error instanceof TokenError && error.kind === "config") {
    return { kind: "config" as const, status: 0, cause: error.message };
  }
  return {
    kind: "retry" as const,
    status: null,
    cause: String(error instanceof Error ? error.message : error).slice(0, 200),
    retryAfterSeconds: null,
  };
}

/**
 * The status answer and the callback body. The annex example spells the keys
 * `indEstado` / `respuestaXml` (upper-case values), the API reference
 * `ind-estado` / `respuesta-xml` (lower-case): both are read (research note 5.5).
 */
export function parseAnswer(
  body: string,
): { clave: string | null; state: HaciendaState; responseXml: string | null } | null {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(body);
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") return null;
  const state = String(json["ind-estado"] ?? json.indEstado ?? "").toLowerCase() as HaciendaState;
  if (!STATES.has(state)) return null;
  const xml = json["respuesta-xml"] ?? json.respuestaXml;
  let responseXml: string | null = null;
  if (typeof xml === "string" && xml.length > 0) {
    try {
      responseXml = fromBase64(xml);
    } catch {
      responseXml = null;
    }
  }
  const clave = typeof json.clave === "string" ? json.clave : null;
  return { clave, state, responseXml };
}
