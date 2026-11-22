/**
 * A fake of Hacienda's identity provider and reception API, for development
 * and tests only, answering as docs/research/hacienda-factura-electronica-v44.md
 * (sections 5.1 to 5.5) describes the real ones:
 *
 *   POST /auth/realms/<realm>/protocol/openid-connect/token
 *        password and refresh_token grants; access tokens last 300 s
 *   POST /recepcion/v1/recepcion          201 with Location; 400 with X-Error-Cause; 401
 *   GET  /recepcion/v1/recepcion/<clave>  200 {clave, fecha, ind-estado, respuesta-xml}; 404
 *
 * and, when a document has its answer, it posts the same body to the
 * document's callbackUrl, as Hacienda does. It keeps everything in memory and
 * talks to nothing else. Its answers (MensajeHacienda) are not signed; the
 * real ones are (XAdES-XL).
 *
 * It can be told to misbehave (POST /_fake/behaviour {rules: [...]}):
 *   reject    the next documents are answered "rechazado" with `cause`
 *             (only those to receiver `receiver`, when given)
 *   refuse    the next submissions are refused at reception: 400 with `cause`
 *   late      the answer comes only after `delayMs`
 *   twice     the callback is sent twice
 *   silent    no callback: only polling finds the answer
 *   down      the next requests (`times`) answer 503
 *   lost      the next submissions are received, but the answer to the POST
 *             never arrives (the connection hangs until the client gives up)
 *
 * Control endpoints (all under /_fake):
 *   GET  /_fake/documents[?clave=]   what was received, with its state
 *   GET  /_fake/xml?clave=           the signed XML of one, byte for byte as received
 *   GET  /_fake/requests             every request, in order
 *   POST /_fake/behaviour {rules}
 *   POST /_fake/answer {clave, state, cause?}   answer a document now
 *   POST /_fake/reset
 */

export type Mode = "reject" | "refuse" | "late" | "twice" | "silent" | "down" | "lost";

export interface Rule {
  mode: Mode;
  times?: number;
  /** Receiver identification number the rule applies to (reject, refuse). */
  receiver?: string;
  cause?: string;
  delayMs?: number;
}

export interface FakeDocument {
  clave: string;
  fecha: string;
  emisor: { tipoIdentificacion: string; numeroIdentificacion: string };
  receptor: { tipoIdentificacion: string; numeroIdentificacion: string } | null;
  callbackUrl: string | null;
  xml: string;
  receivedAt: string;
  answerAt: number;
  /** Final state once answered; until then the document is "procesando". */
  verdict: "aceptado" | "rechazado";
  cause: string | null;
  callbacks: string[];
  callbackTimes: number;
  polled: number;
}

export interface FakeOptions {
  username: string;
  password: string;
  /** Milliseconds between receipt and the answer, unless a rule says otherwise. */
  answerAfterMs?: number;
  fetch?: typeof fetch;
  log?: (line: string) => void;
  now?: () => number;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });

const empty = (status: number, headers: Record<string, string> = {}) =>
  new Response(null, { status, headers });

const toBase64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
const fromBase64 = (text: string) => Buffer.from(text, "base64").toString("utf8");

const escapeXml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function field(xml: string, path: string[]): string | null {
  let part = xml;
  for (const name of path) {
    const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(part);
    if (!match) return null;
    part = match[1] ?? "";
  }
  return part;
}

/** Hacienda's answer, MensajeHacienda v4.4, without its signature. */
export function mensajeHacienda(doc: FakeDocument): string {
  const accepted = doc.verdict === "aceptado";
  const receiverName = field(doc.xml, ["Receptor", "Nombre"]);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<MensajeHacienda xmlns="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/mensajeHacienda">',
    `<Clave>${doc.clave}</Clave>`,
    `<NombreEmisor>${field(doc.xml, ["Emisor", "Nombre"]) ?? ""}</NombreEmisor>`,
    `<TipoIdentificacionEmisor>${doc.emisor.tipoIdentificacion}</TipoIdentificacionEmisor>`,
    `<NumeroCedulaEmisor>${doc.emisor.numeroIdentificacion}</NumeroCedulaEmisor>`,
    receiverName ? `<NombreReceptor>${receiverName}</NombreReceptor>` : "",
    doc.receptor
      ? `<TipoIdentificacionReceptor>${doc.receptor.tipoIdentificacion}</TipoIdentificacionReceptor><NumeroCedulaReceptor>${doc.receptor.numeroIdentificacion}</NumeroCedulaReceptor>`
      : "",
    `<Mensaje>${accepted ? "1" : "3"}</Mensaje>`,
    `<EstadoMensaje>${accepted ? "Aceptado" : "Rechazado"}</EstadoMensaje>`,
    `<DetalleMensaje>${escapeXml(accepted ? `Este comprobante fue aceptado en el ambiente de pruebas local.` : (doc.cause ?? "Rechazado"))}</DetalleMensaje>`,
    `<MontoTotalImpuesto>${field(doc.xml, ["ResumenFactura", "TotalImpuesto"]) ?? "0.00000"}</MontoTotalImpuesto>`,
    `<TotalFactura>${field(doc.xml, ["ResumenFactura", "TotalComprobante"]) ?? "0.00000"}</TotalFactura>`,
    "</MensajeHacienda>",
  ].join("");
}

export function createFake(options: FakeOptions) {
  const fetchImpl = options.fetch ?? fetch;
  const log = options.log ?? (() => {});
  const now = options.now ?? Date.now;
  const answerAfter = options.answerAfterMs ?? 1500;
  let rules: Rule[] = [];
  let documents = new Map<string, FakeDocument>();
  let requests: Array<{ method: string; path: string; status: number; at: string }> = [];
  const tokens = new Map<string, number>();
  const refreshTokens = new Map<string, number>();
  const timers = new Set<ReturnType<typeof setTimeout>>();

  function take(mode: Mode, receiver?: string | null): Rule | undefined {
    const rule = rules.find((r) => r.mode === mode && (!r.receiver || r.receiver === receiver));
    if (rule && rule.times !== undefined) {
      rule.times -= 1;
      if (rule.times <= 0) rules = rules.filter((r) => r !== rule);
    }
    return rule;
  }
  const has = (mode: Mode) => rules.find((r) => r.mode === mode);

  function issueTokens() {
    const access = `fake-access-${crypto.randomUUID()}`;
    const refresh = `fake-refresh-${crypto.randomUUID()}`;
    tokens.set(access, now() + 300_000);
    refreshTokens.set(refresh, now() + 36_000_000);
    return json(200, {
      access_token: access,
      expires_in: 300,
      refresh_expires_in: 36_000,
      refresh_token: refresh,
      token_type: "bearer",
      "not-before-policy": 0,
      scope: "",
    });
  }

  async function token(request: Request): Promise<Response> {
    const form = new URLSearchParams(await request.text());
    const grant = form.get("grant_type");
    if (form.get("client_id") !== "api-stag" && form.get("client_id") !== "api-prod") {
      return json(400, {
        error: "invalid_client",
        error_description: "Invalid client credentials",
      });
    }
    if (grant === "password") {
      if (!form.get("username")) {
        return json(401, {
          error: "invalid_request",
          error_description: "Missing parameter: username",
        });
      }
      if (form.get("username") !== options.username || form.get("password") !== options.password) {
        return json(401, { error: "invalid_grant", error_description: "Invalid user credentials" });
      }
      return issueTokens();
    }
    if (grant === "refresh_token") {
      const refresh = form.get("refresh_token") ?? "";
      const until = refreshTokens.get(refresh);
      if (!until || until < now()) {
        return json(400, { error: "invalid_grant", error_description: "Invalid refresh token" });
      }
      refreshTokens.delete(refresh);
      return issueTokens();
    }
    return json(400, { error: "unsupported_grant_type" });
  }

  function authorized(request: Request) {
    const match = /^bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
    const until = match?.[1] ? tokens.get(match[1]) : undefined;
    return until !== undefined && until > now();
  }

  const refused = (cause: string) =>
    empty(400, { "x-error-cause": cause, "validation-exception": "true" });

  function scheduleAnswer(doc: FakeDocument) {
    const timer = setTimeout(
      () => {
        timers.delete(timer);
        void callback(doc);
      },
      Math.max(0, doc.answerAt - now()),
    );
    timers.add(timer);
  }

  async function callback(doc: FakeDocument) {
    if (!doc.callbackUrl || doc.callbackTimes === 0) return;
    const body = JSON.stringify(answerBody(doc));
    for (let i = 0; i < doc.callbackTimes; i++) {
      try {
        const response = await fetchImpl(doc.callbackUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        });
        doc.callbacks.push(String(response.status));
        log(`callback for ${doc.clave.slice(-12)}: ${response.status}`);
      } catch (error) {
        doc.callbacks.push("unreachable");
        log(`callback for ${doc.clave.slice(-12)} not delivered: ${String(error).slice(0, 80)}`);
      }
    }
  }

  function stateOf(doc: FakeDocument) {
    if (now() >= doc.answerAt) return doc.verdict;
    return doc.polled === 0 ? "recibido" : "procesando";
  }

  function answerBody(doc: FakeDocument) {
    const state = stateOf(doc);
    const final = state === "aceptado" || state === "rechazado";
    return {
      clave: doc.clave,
      fecha: doc.fecha,
      "ind-estado": state,
      ...(final ? { "respuesta-xml": toBase64(mensajeHacienda(doc)) } : {}),
    };
  }

  async function receive(request: Request): Promise<Response> {
    if (!authorized(request)) return json(401, { message: "Unauthorized" });
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return refused("El cuerpo de la solicitud no es un JSON válido.");
    }
    const clave = typeof body.clave === "string" ? body.clave : "";
    const emisor = body.emisor as FakeDocument["emisor"] | undefined;
    const receptor = (body.receptor as FakeDocument["receptor"] | undefined) ?? null;
    if (!/^[A-Za-z0-9]{50}$/.test(clave)) return refused("La clave del comprobante no es válida.");
    if (typeof body.fecha !== "string" || Number.isNaN(Date.parse(body.fecha))) {
      return refused("La fecha del comprobante no es válida.");
    }
    if (!emisor?.tipoIdentificacion || !emisor.numeroIdentificacion) {
      return refused("Falta la identificación del emisor.");
    }
    if (typeof body.comprobanteXml !== "string") return refused("Falta el comprobante.");
    if (documents.has(clave))
      return refused(`El comprobante con la Clave [${clave}] ya fue recibido.`);
    const xml = fromBase64(body.comprobanteXml);
    if (!xml.includes(`<Clave>${clave}</Clave>`)) {
      return refused("La clave del comprobante no coincide con la del envío.");
    }
    if (!/<ds:Signature[\s>]/.test(xml)) return refused("El comprobante no está firmado.");
    const refusal = take("refuse", receptor?.numeroIdentificacion);
    if (refusal) return refused(refusal.cause ?? "El comprobante no cumple con la estructura.");

    const rejection = take("reject", receptor?.numeroIdentificacion);
    const late = take("late");
    const doc: FakeDocument = {
      clave,
      fecha: body.fecha,
      emisor,
      receptor,
      callbackUrl: typeof body.callbackUrl === "string" ? body.callbackUrl : null,
      xml,
      receivedAt: new Date(now()).toISOString(),
      answerAt: now() + (late ? (late.delayMs ?? 10_800_000) : answerAfter),
      verdict: rejection ? "rechazado" : "aceptado",
      cause: rejection ? (rejection.cause ?? "El comprobante fue rechazado.") : null,
      callbacks: [],
      callbackTimes: take("silent") ? 0 : take("twice") ? 2 : 1,
      polled: 0,
    };
    documents.set(clave, doc);
    scheduleAnswer(doc);
    log(`received ${clave.slice(-12)}: will be ${doc.verdict}`);
    const location = `${new URL(request.url).origin}/recepcion/v1/recepcion/${clave}/`;
    if (take("lost")) {
      // Received, but the answer never reaches the client.
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 30_000);
        timers.add(timer);
      });
    }
    return empty(201, {
      location,
      "x-ratelimit-limit": "1000",
      "x-ratelimit-remaining": "999",
      "x-ratelimit-reset": "60",
    });
  }

  function status(request: Request, clave: string): Response {
    if (!authorized(request)) return json(401, { message: "Unauthorized" });
    const doc = documents.get(clave);
    if (!doc) return empty(404, { "x-error-cause": "El comprobante no existe." });
    const body = answerBody(doc);
    doc.polled += 1;
    return json(200, body);
  }

  async function control(request: Request, path: string): Promise<Response> {
    const url = new URL(request.url);
    if (path === "/_fake/documents" && request.method === "GET") {
      const clave = url.searchParams.get("clave");
      return json(
        200,
        [...documents.values()]
          .filter((doc) => !clave || doc.clave === clave)
          .map((doc) => ({
            clave: doc.clave,
            receivedAt: doc.receivedAt,
            state: stateOf(doc),
            verdict: doc.verdict,
            cause: doc.cause,
            emisor: doc.emisor,
            receptor: doc.receptor,
            callbacks: doc.callbacks,
            polled: doc.polled,
            type: doc.clave.slice(29, 31),
          })),
      );
    }
    if (path === "/_fake/xml" && request.method === "GET") {
      // The signed document exactly as it was received, for checks of what was sent.
      const doc = documents.get(url.searchParams.get("clave") ?? "");
      if (!doc) return json(404, { error: "unknown clave" });
      return new Response(doc.xml, {
        status: 200,
        headers: { "content-type": "application/xml; charset=utf-8" },
      });
    }
    if (path === "/_fake/requests" && request.method === "GET") return json(200, requests);
    if (path === "/_fake/behaviour" && request.method === "POST") {
      const body = (await request.json()) as { rules?: Rule[] };
      rules = Array.isArray(body.rules) ? body.rules.map((rule) => ({ ...rule })) : [];
      return json(200, { rules });
    }
    if (path === "/_fake/answer" && request.method === "POST") {
      const body = (await request.json()) as { clave?: string; state?: string; cause?: string };
      const doc = documents.get(body.clave ?? "");
      if (!doc) return json(404, { error: "unknown clave" });
      doc.verdict = body.state === "rechazado" ? "rechazado" : "aceptado";
      doc.cause = body.cause ?? doc.cause;
      doc.answerAt = now();
      void callback(doc);
      return json(200, { ok: true });
    }
    if (path === "/_fake/reset" && request.method === "POST") {
      rules = [];
      documents = new Map();
      requests = [];
      return json(200, { ok: true });
    }
    return json(404, { error: "not_found" });
  }

  async function route(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/_fake/")) return control(request, path);
    if (take("down")) return json(503, { message: "Service Unavailable" }, { "retry-after": "1" });
    if (
      /^\/auth\/realms\/rut(-stag)?\/protocol\/openid-connect\/token$/.test(path) &&
      request.method === "POST"
    ) {
      return token(request);
    }
    if (path === "/recepcion/v1/recepcion" && request.method === "POST") return receive(request);
    const match = /^\/recepcion\/v1\/recepcion\/([A-Za-z0-9]{50})\/?$/.exec(path);
    if (match?.[1] && request.method === "GET") return status(request, match[1]);
    // What the API gateway answers for a route that does not exist (research note 5.1).
    return json(
      403,
      { message: "Missing Authentication Token" },
      {
        "x-amzn-errortype": "MissingAuthenticationTokenException",
      },
    );
  }

  return {
    async handle(request: Request): Promise<Response> {
      const path = new URL(request.url).pathname;
      // Logged on arrival: a request whose answer never leaves is still in the log (status 0).
      const entry = { method: request.method, path, status: 0, at: new Date(now()).toISOString() };
      if (!path.startsWith("/_fake/")) {
        requests.push(entry);
        if (requests.length > 2000) requests = requests.slice(-1000);
      }
      const response = await route(request);
      entry.status = response.status;
      return response;
    },
    get documents() {
      return documents;
    },
    hasRule: has,
    close() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}
