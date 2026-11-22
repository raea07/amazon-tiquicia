/**
 * The worker's loop with a fake clock, a fake queue and a fake of Hacienda's
 * API answering each status its reference documents: 201, 400 with
 * X-Error-Cause (a duplicate and a real refusal), 401, a gateway 403, 5xx and
 * a dropped connection on submission; recibido, procesando, aceptado,
 * rechazado, error and 404 on the status query.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { InvoiceConfig } from "./config.ts";
import { fromBase64, HaciendaClient, toBase64 } from "./hacienda.ts";
import { createHaciendaCallback, createInvoiceWorker } from "./handlers.ts";
import type { Signer } from "./signature.ts";
import { throwawaySigner } from "./testing/certificate.ts";
import { lineFromGross, sampleDocument } from "./testing/samples.ts";
import type { ClaimedInvoice, HealthReport, InvoiceQueue, Outcome } from "./types.ts";
import { runOnce } from "./worker.ts";

let signer: Signer;
beforeAll(async () => {
  const test = await throwawaySigner();
  signer = { key: test.key, certificate: test.certificate, certificateDigest: "sha256" };
});

class FakeClock {
  constructor(public at = new Date("2026-11-22T15:00:00Z")) {}
  now() {
    return new Date(this.at);
  }
  advance(ms: number) {
    this.at = new Date(this.at.getTime() + ms);
  }
}

const silent = { info() {}, warn() {}, error() {} };

function invoice(sequence: number, overrides: Partial<ClaimedInvoice> = {}): ClaimedInvoice {
  return {
    id: `inv-${sequence}`,
    phase: "submit",
    document: sampleDocument({
      type: "04",
      sequence,
      issuedAt: new Date("2026-11-22T14:59:00Z"),
      lines: [
        lineFromGross(1, {
          cabys: "6803000000000",
          unit: "Os",
          description: "Entrega a domicilio",
          grossMinor: 250_000,
        }),
      ],
    }),
    signed_xml: null,
    submitted_before: false,
    attempts: 1,
    ...overrides,
  };
}

class FakeQueue implements InvoiceQueue {
  due: ClaimedInvoice[] = [];
  stored = new Map<string, string>();
  recorded: Array<{ id: string; outcome: Outcome }> = [];
  hints: string[] = [];
  health_: HealthReport[] = [];
  plans = 0;
  async plan() {
    this.plans += 1;
    return 0;
  }
  async claim() {
    const batch = this.due;
    this.due = [];
    return batch;
  }
  async signed(id: string, _w: string, xml: string) {
    if (!this.stored.has(id)) this.stored.set(id, xml);
    return this.stored.get(id) ?? null;
  }
  async record(id: string, _w: string, outcome: Outcome) {
    this.recorded.push({ id, outcome });
    return "ok";
  }
  async hint(clave: string) {
    this.hints.push(clave);
    return true;
  }
  async health(report: HealthReport) {
    this.health_.push(report);
  }
  events(id: string) {
    return this.recorded.filter((r) => r.id === id).map((r) => r.outcome.event);
  }
}

type Script = Array<{ status: number; headers?: Record<string, string>; body?: string } | "drop">;

/** Hacienda as a fetch function, following a script per route. */
function fakeHacienda() {
  const calls: Array<{ method: string; path: string; body: string; auth: string | null }> = [];
  const scripts = { token: [] as Script, submit: [] as Script, status: [] as Script };
  let tokens = 0;
  const next = (
    script: Script,
    fallback: { status: number; headers?: Record<string, string>; body?: string },
  ) => script.shift() ?? fallback;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = typeof init?.body === "string" ? init.body : "";
    const auth = new Headers(init?.headers).get("authorization");
    calls.push({ method: init?.method ?? "GET", path: url.pathname, body, auth });
    let answer: ReturnType<typeof next> | "drop";
    if (url.pathname.endsWith("/token")) {
      tokens += 1;
      answer = next(scripts.token, {
        status: 200,
        body: JSON.stringify({
          access_token: `token-${tokens}`,
          refresh_token: `refresh-${tokens}`,
          expires_in: 300,
          refresh_expires_in: 36_000,
        }),
      });
    } else if (init?.method === "POST") {
      answer = next(scripts.submit, { status: 201, headers: { location: `${url}/clave/` } });
    } else {
      answer = next(scripts.status, {
        status: 200,
        body: JSON.stringify({ clave: url.pathname.split("/").pop(), "ind-estado": "procesando" }),
      });
    }
    if (answer === "drop") throw new TypeError("fetch failed: connection reset");
    return new Response(answer.body ?? "", { status: answer.status, headers: answer.headers });
  }) as typeof fetch;
  return { fetchImpl, calls, scripts };
}

const settings = {
  tokenUrl: "http://hacienda.test/auth/realms/rut-stag/protocol/openid-connect/token",
  clientId: "api-stag",
  username: "cpj-3-101-123456@stag.comprobanteselectronicos.go.cr",
  password: "contraseña con símbolos &=+",
  apiBase: "http://hacienda.test/recepcion/v1/",
  timeoutMs: 1000,
};

function setup() {
  const clock = new FakeClock();
  const queue = new FakeQueue();
  const hacienda = fakeHacienda();
  const client = new HaciendaClient(settings, hacienda.fetchImpl, clock);
  const deps = {
    queue,
    client,
    signer: async () => signer,
    clock,
    logger: silent,
    workerId: "test-worker",
    callbackUrl: "https://example.test/functions/v1/hacienda-callback/secreto",
  };
  return { clock, queue, hacienda, client, deps };
}

const mensaje = (clave: string, code: "1" | "3", detail: string) =>
  toBase64(
    `<?xml version="1.0" encoding="UTF-8"?><MensajeHacienda xmlns="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/mensajeHacienda"><Clave>${clave}</Clave><NombreEmisor>X</NombreEmisor><TipoIdentificacionEmisor>02</TipoIdentificacionEmisor><NumeroCedulaEmisor>3101123456</NumeroCedulaEmisor><Mensaje>${code}</Mensaje><EstadoMensaje>${code === "1" ? "Aceptado" : "Rechazado"}</EstadoMensaje><DetalleMensaje>${detail}</DetalleMensaje><TotalFactura>2500.00000</TotalFactura></MensajeHacienda>`,
  );

describe("sending", () => {
  it("signs once, sends the documented envelope with the token, and records 201 as received", async () => {
    const { queue, hacienda, deps } = setup();
    const doc = invoice(1);
    queue.due = [doc];
    const stats = await runOnce(deps);
    expect(stats).toMatchObject({ claimed: 1, signed: 1, sent: 1 });
    expect(queue.events(doc.id)).toEqual(["received"]);

    const token = hacienda.calls.find((c) => c.path.endsWith("/token"));
    expect(token?.body).toContain("grant_type=password");
    expect(token?.body).toContain("client_id=api-stag");
    // The password is URL-encoded, symbols and all.
    expect(token?.body).toContain(
      `password=${encodeURIComponent(settings.password).replace(/%20/g, "+")}`,
    );

    const post = hacienda.calls.find((c) => c.method === "POST" && c.path.endsWith("/recepcion"));
    expect(post?.auth).toBe("bearer token-1");
    const envelope = JSON.parse(post?.body ?? "{}");
    expect(envelope).toEqual({
      clave: doc.document.clave,
      fecha: "2026-11-22T08:59:00-06:00",
      emisor: { tipoIdentificacion: "02", numeroIdentificacion: "3101123456" },
      callbackUrl: "https://example.test/functions/v1/hacienda-callback/secreto",
      comprobanteXml: expect.any(String),
    });
    expect(fromBase64(envelope.comprobanteXml)).toBe(queue.stored.get(doc.id));
  });

  it("sends the stored bytes on a retry and never signs again", async () => {
    const { queue, hacienda, deps } = setup();
    const stored = '<?xml version="1.0"?><TiqueteElectronico>ya firmado</TiqueteElectronico>';
    queue.due = [invoice(2, { signed_xml: stored })];
    const stats = await runOnce(deps);
    expect(stats.signed).toBe(0);
    const post = hacienda.calls.find((c) => c.method === "POST" && c.path.endsWith("/recepcion"));
    expect(fromBase64(JSON.parse(post?.body ?? "{}").comprobanteXml)).toBe(stored);
  });

  it("asks before sending again when an earlier attempt may have got in", async () => {
    const { queue, hacienda, deps } = setup();
    queue.due = [invoice(3, { signed_xml: "<x/>", submitted_before: true })];
    hacienda.scripts.status.push({
      status: 200,
      body: JSON.stringify({ "ind-estado": "recibido" }),
    });
    await runOnce(deps);
    expect(hacienda.calls.some((c) => c.method === "POST" && c.path.endsWith("/recepcion"))).toBe(
      false,
    );
    expect(queue.events("inv-3")).toEqual(["answer"]);

    // Unknown to Hacienda (404): only then is it sent.
    queue.due = [invoice(4, { signed_xml: "<x/>", submitted_before: true })];
    hacienda.scripts.status.push({
      status: 404,
      headers: { "x-error-cause": "Comprobante no encontrado" },
    });
    await runOnce(deps);
    expect(queue.events("inv-4")).toEqual(["received"]);
  });

  it("reads 400 'ya fue recibido' as received and any other 400 as a refusal, with its cause", async () => {
    const { queue, hacienda, deps } = setup();
    queue.due = [invoice(5), invoice(6)];
    hacienda.scripts.submit.push(
      {
        status: 400,
        headers: {
          "x-error-cause":
            "El comprobante con la Clave [50621112600310112345600100001040000001532148291037] ya fue recibido.",
          "validation-exception": "true",
        },
      },
      {
        status: 400,
        headers: {
          "x-error-cause": "La firma del comprobante electrónico no es válida",
          "validation-exception": "true",
        },
      },
    );
    await runOnce(deps);
    expect(queue.recorded.map((r) => r.outcome.event)).toEqual(["duplicate", "refused"]);
    const refused = queue.recorded[1]?.outcome;
    expect(refused && "cause" in refused ? refused.cause : "").toBe(
      "La firma del comprobante electrónico no es válida",
    );
  });

  it("gets a new token on 401 and tries once more", async () => {
    const { queue, hacienda, deps } = setup();
    queue.due = [invoice(7)];
    hacienda.scripts.submit.push({ status: 401 });
    await runOnce(deps);
    expect(queue.events("inv-7")).toEqual(["received"]);
    const posts = hacienda.calls.filter(
      (c) => c.method === "POST" && c.path.endsWith("/recepcion"),
    );
    expect(posts.map((p) => p.auth)).toEqual(["bearer token-1", "bearer token-2"]);
  });

  it("treats a gateway 403 as a configuration error, 5xx and a dropped connection as retries", async () => {
    const { queue, hacienda, deps } = setup();
    queue.due = [invoice(8), invoice(9), invoice(10)];
    hacienda.scripts.submit.push(
      { status: 403, body: '{"message":"Missing Authentication Token"}' },
      { status: 503, headers: { "retry-after": "30" } },
      "drop",
    );
    await runOnce(deps);
    const [config, unavailable, dropped] = queue.recorded.map((r) => r.outcome);
    expect(config).toMatchObject({ event: "config", http_status: 403 });
    expect(unavailable).toMatchObject({ event: "retry", http_status: 503, retry_after: 30 });
    expect(dropped).toMatchObject({ event: "retry", http_status: null, code: "network" });
  });

  it("stops a document whose figures do not add up before signing it", async () => {
    const { queue, hacienda, deps } = setup();
    const bad = invoice(11);
    bad.document = { ...bad.document, summary: { ...bad.document.summary, total: "1.00000" } };
    queue.due = [bad];
    await runOnce(deps);
    expect(queue.recorded[0]?.outcome).toEqual({ event: "invalid", code: "summary_total" });
    expect(queue.stored.size).toBe(0);
    expect(hacienda.calls.some((c) => c.method === "POST" && c.path.endsWith("/recepcion"))).toBe(
      false,
    );
  });
});

describe("answers", () => {
  it("records each documented state and Hacienda's message", async () => {
    const { queue, hacienda, deps } = setup();
    const docs = ["recibido", "procesando", "error", "aceptado", "rechazado"].map((_, i) =>
      invoice(20 + i, { phase: "poll" }),
    );
    queue.due = docs;
    hacienda.scripts.status.push(
      { status: 200, body: JSON.stringify({ "ind-estado": "recibido" }) },
      { status: 200, body: JSON.stringify({ "ind-estado": "procesando" }) },
      { status: 200, body: JSON.stringify({ "ind-estado": "error" }) },
      {
        status: 200,
        body: JSON.stringify({
          "ind-estado": "aceptado",
          "respuesta-xml": mensaje(docs[3]?.document.clave ?? "", "1", "Aceptado"),
        }),
      },
      // The annex's spelling, upper case.
      {
        status: 200,
        body: JSON.stringify({
          indEstado: "RECHAZADO",
          respuestaXml: mensaje(
            docs[4]?.document.clave ?? "",
            "3",
            "El receptor &lt;no&gt; existe en el padrón",
          ),
        }),
      },
    );
    const stats = await runOnce(deps);
    expect(stats.answered).toBe(2);
    const outcomes = queue.recorded.map((r) => r.outcome);
    expect(outcomes.map((o) => (o.event === "answer" ? o.state : o.event))).toEqual([
      "recibido",
      "procesando",
      "error",
      "aceptado",
      "rechazado",
    ]);
    expect(outcomes[3]).toMatchObject({
      message: "1",
      detail: "Aceptado",
      response_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(outcomes[4]).toMatchObject({
      message: "3",
      detail: "El receptor <no> existe en el padrón",
    });
  });

  it("sends the document again when Hacienda does not know its clave (404)", async () => {
    const { queue, hacienda, deps } = setup();
    queue.due = [invoice(30, { phase: "poll" })];
    hacienda.scripts.status.push({ status: 404 });
    await runOnce(deps);
    expect(queue.events("inv-30")).toEqual(["unknown_clave"]);
  });
});

describe("the token", () => {
  it("is reused for five minutes, renewed with the refresh token, then with the password", async () => {
    const { clock, hacienda, client } = setup();
    await client.status("x".repeat(50));
    await client.status("x".repeat(50));
    expect(hacienda.calls.filter((c) => c.path.endsWith("/token"))).toHaveLength(1);
    clock.advance(4 * 60_000 + 31_000); // fewer than 30 seconds left
    await client.status("x".repeat(50));
    const grants = hacienda.calls
      .filter((c) => c.path.endsWith("/token"))
      .map((c) => new URLSearchParams(c.body).get("grant_type"));
    expect(grants).toEqual(["password", "refresh_token"]);
    clock.advance(11 * 3_600_000); // the refresh token is gone too
    await client.status("x".repeat(50));
    expect(
      hacienda.calls
        .filter((c) => c.path.endsWith("/token"))
        .map((c) => new URLSearchParams(c.body).get("grant_type")),
    ).toEqual(["password", "refresh_token", "password"]);
  });

  it("reports refused credentials as configuration, an unreachable server as a retry", async () => {
    const { hacienda, client } = setup();
    hacienda.scripts.token.push({ status: 401, body: '{"error":"invalid_grant"}' });
    expect(await client.status("x".repeat(50))).toMatchObject({ kind: "config" });
    hacienda.scripts.token.push("drop");
    expect(await client.status("x".repeat(50))).toMatchObject({ kind: "retry" });
  });
});

describe("the entry points", () => {
  const config = {
    env: "local",
    api: { url: "http://api.test", secretKey: "secret" },
    workerToken: "worker-token",
    hacienda: settings,
    callbackUrl: "",
    callbackToken: "c".repeat(40),
    signing: { keyPem: "", pin: "", certificatePem: "", certificateDigest: "sha256" as const },
  } satisfies InvoiceConfig;

  it("wakes only with the worker token, and reports the certificate's expiry", async () => {
    const { queue, hacienda } = setup();
    const worker = createInvoiceWorker(config, {
      queue,
      fetch: hacienda.fetchImpl,
      signer: async () => signer,
      logger: silent,
    });
    expect(
      (await worker(new Request("http://f.test/invoice-worker", { method: "POST" }))).status,
    ).toBe(401);
    const ran = await worker(
      new Request("http://f.test/invoice-worker?wait=1", {
        method: "POST",
        headers: { "x-worker-token": "worker-token" },
      }),
    );
    expect(ran.status).toBe(200);
    expect(queue.health_[0]?.certificate_not_after).toBe(signer.certificate.notAfter.toISOString());
  });

  it("takes Hacienda's callback, in either spelling, as a hint, and only on the secret path", async () => {
    const { queue } = setup();
    let woken = 0;
    const callback = createHaciendaCallback(
      config,
      () => {
        woken += 1;
      },
      { queue, logger: silent },
    );
    const clave = "50621112600310112345600100001040000001532148291037";
    const post = (path: string, body: unknown) =>
      callback(
        new Request(`http://f.test/functions/v1/hacienda-callback/${path}`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      );
    expect((await post("wrong", { clave, "ind-estado": "aceptado" })).status).toBe(404);
    expect((await post(config.callbackToken, { clave, "ind-estado": "aceptado" })).status).toBe(
      200,
    );
    expect(
      (await post(config.callbackToken, { clave, indEstado: "RECHAZADO", respuestaXml: "" }))
        .status,
    ).toBe(200);
    expect((await post(config.callbackToken, { nada: true })).status).toBe(200);
    expect(queue.hints).toEqual([clave, clave]);
    expect(woken).toBe(2);
  });
});
