/**
 * The fake answers as the API reference documents, and the real worker
 * (packages/invoicing) works against it end to end: signed documents are
 * received, answered, rejected, answered late, called back twice, refused
 * while the service is down, and received once even when the answer to the
 * submission is lost.
 */

import {
  type ClaimedInvoice,
  HaciendaClient,
  type HealthReport,
  type InvoiceQueue,
  type Outcome,
  runOnce,
} from "@yuntera/invoicing";
import { cleanText } from "@yuntera/invoicing/codes";
import {
  checkSignature,
  lineFromGross,
  sampleDocument,
  schemaErrors,
  textAt,
  throwawaySigner,
} from "@yuntera/invoicing/testing";
import { afterEach, describe, expect, it } from "vitest";
import { createFake } from "./fake.ts";

const USER = "cpj-3-101-123456@stag.comprobanteselectronicos.go.cr";
const PASSWORD = "clave&local=1";
const BASE = "http://hacienda.test";

let clock = Date.parse("2026-11-22T15:00:00Z");
const fakes: Array<ReturnType<typeof createFake>> = [];

function setup(answerAfterMs = 1000) {
  const callbacks: string[] = [];
  const fake = createFake({
    username: USER,
    password: PASSWORD,
    answerAfterMs,
    now: () => clock,
    fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
      callbacks.push(String(init?.body ?? ""));
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
  });
  fakes.push(fake);
  // As over a network: a client that gives up stops waiting for the answer.
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted: timeout")));
      fake.handle(new Request(String(input), { ...init, signal: null })).then(resolve, reject);
    })) as typeof fetch;
  const client = new HaciendaClient(
    {
      tokenUrl: `${BASE}/auth/realms/rut-stag/protocol/openid-connect/token`,
      clientId: "api-stag",
      username: USER,
      password: PASSWORD,
      apiBase: `${BASE}/recepcion/v1/`,
      timeoutMs: 200,
    },
    fetchImpl,
    { now: () => new Date(clock) },
  );
  return { fake, client, callbacks, fetchImpl };
}

afterEach(() => {
  for (const fake of fakes.splice(0)) fake.close();
});

class MemoryQueue implements InvoiceQueue {
  docs = new Map<string, { claimed: ClaimedInvoice; status: string; events: string[] }>();
  add(doc: ClaimedInvoice) {
    this.docs.set(doc.id, { claimed: doc, status: "pending", events: [] });
  }
  async plan() {
    return 0;
  }
  /** Each run of the worker gets the due documents once, as the lease would ensure. */
  served = false;
  async claim() {
    if (this.served) return [];
    this.served = true;
    const out: ClaimedInvoice[] = [];
    for (const entry of this.docs.values()) {
      if (entry.status === "pending" || entry.status === "sent") {
        out.push({ ...entry.claimed, phase: entry.status === "pending" ? "submit" : "poll" });
      }
    }
    return out;
  }
  async signed(id: string, _w: string, xml: string) {
    const entry = this.docs.get(id);
    if (!entry) return null;
    entry.claimed.signed_xml ??= xml;
    return entry.claimed.signed_xml;
  }
  async record(id: string, _w: string, outcome: Outcome) {
    const entry = this.docs.get(id);
    if (!entry) return null;
    entry.events.push(outcome.event === "answer" ? outcome.state : outcome.event);
    if (outcome.event === "received" || outcome.event === "duplicate") entry.status = "sent";
    if (outcome.event === "refused") entry.status = "rejected";
    if (outcome.event === "retry") entry.claimed.submitted_before = true;
    if (outcome.event === "answer" && outcome.state === "aceptado") entry.status = "accepted";
    if (outcome.event === "answer" && outcome.state === "rechazado") entry.status = "rejected";
    return entry.status;
  }
  async hint() {
    return true;
  }
  async health(_report: HealthReport) {}
}

async function chain(
  fixture: ReturnType<typeof setup>,
  sequence: number,
  receiver = false,
  text = { name: "Ana Prueba", description: "Entrega" },
) {
  const test = await throwawaySigner();
  const queue = new MemoryQueue();
  const doc: ClaimedInvoice = {
    id: `doc-${sequence}`,
    phase: "submit",
    signed_xml: null,
    submitted_before: false,
    attempts: 0,
    document: sampleDocument({
      type: receiver ? "01" : "04",
      sequence,
      issuedAt: new Date(clock),
      lines: [
        lineFromGross(1, {
          cabys: "6803000000000",
          unit: "Os",
          description: text.description,
          grossMinor: 150_000,
        }),
      ],
      receiver: receiver
        ? {
            name: text.name,
            id_type: "01",
            id_number: "109870654",
            email: null,
            activity_code: null,
          }
        : null,
      payment: { code: "02" },
    }),
  };
  queue.add(doc);
  const run = () => {
    queue.served = false;
    return runOnce(
      {
        queue,
        client: fixture.client,
        signer: async () => ({
          key: test.key,
          certificate: test.certificate,
          certificateDigest: "sha256",
        }),
        clock: { now: () => new Date(clock) },
        logger: { info() {}, warn() {}, error() {} },
        workerId: "w",
        callbackUrl: "http://localhost/functions/v1/hacienda-callback/token",
      },
      { budgetMs: 1, batchSize: 10 },
    );
  };
  return { queue, doc, run, entry: () => queue.docs.get(doc.id) };
}

describe("the fake's API", () => {
  it("gives tokens only for the right credentials, as the identity provider does", async () => {
    const { fake } = setup();
    const token = (body: Record<string, string>) =>
      fake.handle(
        new Request(`${BASE}/auth/realms/rut-stag/protocol/openid-connect/token`, {
          method: "POST",
          body: new URLSearchParams(body),
        }),
      );
    const missing = await token({ grant_type: "password", client_id: "api-stag" });
    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({
      error: "invalid_request",
      error_description: "Missing parameter: username",
    });
    expect(
      (
        await token({
          grant_type: "password",
          client_id: "api-stag",
          username: USER,
          password: "x",
        })
      ).status,
    ).toBe(401);
    const ok = await token({
      grant_type: "password",
      client_id: "api-stag",
      username: USER,
      password: PASSWORD,
    });
    const body = (await ok.json()) as {
      access_token: string;
      expires_in: number;
      refresh_token: string;
    };
    expect(body.expires_in).toBe(300);
    expect(
      (
        await token({
          grant_type: "refresh_token",
          client_id: "api-stag",
          refresh_token: body.refresh_token,
        })
      ).status,
    ).toBe(200);
    // A route that does not exist: the gateway's 403.
    expect(
      (await fake.handle(new Request(`${BASE}/recepcion-sandbox/v1/recepcion/x`))).status,
    ).toBe(403);
  });

  it("refuses without a token and refuses what is not a signed document", async () => {
    const { fake, client } = setup();
    const post = (body: unknown, auth = "bearer nada") =>
      fake.handle(
        new Request(`${BASE}/recepcion/v1/recepcion`, {
          method: "POST",
          headers: { authorization: auth, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    expect((await post({})).status).toBe(401);
    const token = await client.tokens.get();
    const refused = await post({ clave: "x" }, `bearer ${token}`);
    expect(refused.status).toBe(400);
    expect(refused.headers.get("x-error-cause")).toBe("La clave del comprobante no es válida.");
  });
});

describe("the worker against the fake", () => {
  it("sends a signed tiquete, polls, and records Hacienda's acceptance", async () => {
    const fixture = setup(1000);
    const { run, entry, doc } = await chain(fixture, 1);
    await run();
    expect(entry()?.events).toEqual(["received"]);
    await run();
    expect(entry()?.events.at(-1)).toBe("recibido");
    clock += 1500;
    await run();
    expect(entry()?.status).toBe("accepted");
    expect(fixture.callbacks).toHaveLength(0); // the timer has not fired in fake time
    expect(fixture.fake.documents.get(doc.document.clave)?.polled).toBe(2);
  });

  it("records a rejection with Hacienda's reason", async () => {
    const fixture = setup(0);
    await fixture.fake.handle(
      new Request(`${BASE}/_fake/behaviour`, {
        method: "POST",
        body: JSON.stringify({
          rules: [{ mode: "reject", times: 1, cause: "Receptor no encontrado en el padrón" }],
        }),
      }),
    );
    const { run, entry, queue } = await chain(fixture, 2, true);
    await run();
    await run();
    expect(entry()?.status).toBe("rejected");
    expect(queue.docs.size).toBe(1);
  });

  it("receives each clave once, even when the answer to the submission is lost", async () => {
    const fixture = setup(0);
    await fixture.fake.handle(
      new Request(`${BASE}/_fake/behaviour`, {
        method: "POST",
        body: JSON.stringify({ rules: [{ mode: "lost", times: 1 }] }),
      }),
    );
    const { run, entry } = await chain(fixture, 3);
    await run(); // the POST times out on the client
    expect(entry()?.events).toEqual(["retry"]);
    await run(); // asks first: Hacienda has it, so nothing is sent again
    expect(entry()?.status).toBe("accepted");
    const posts = (await (
      await fixture.fake.handle(new Request(`${BASE}/_fake/requests`))
    ).json()) as Array<{
      method: string;
      path: string;
    }>;
    expect(
      posts.filter((r) => r.method === "POST" && r.path === "/recepcion/v1/recepcion"),
    ).toHaveLength(1);
  });

  it("backs off while Hacienda is down and sends when it is back", async () => {
    const fixture = setup(0);
    await fixture.fake.handle(
      new Request(`${BASE}/_fake/behaviour`, {
        method: "POST",
        body: JSON.stringify({ rules: [{ mode: "down", times: 2 }] }),
      }),
    );
    const { run, entry } = await chain(fixture, 4);
    await run();
    expect(entry()?.events).toEqual(["retry"]);
    await run(); // still down: the token request gets the second 503
    await run(); // back: asks first, Hacienda does not have it, sends
    expect(entry()?.events).toEqual(["retry", "retry", "received"]);
    await run();
    expect(entry()?.status).toBe("accepted");
  });

  it("receives hostile text as text: what it keeps is valid, signed and says what was typed", async () => {
    const name =
      'Ana </Nombre><Nombre>Otra & "Cía" \'Ltda\' ]]> <!DOCTYPE x [<!ENTITY e "ja">]> &e;';
    const description = "Libreta <b>A5</b> & ]]> &amp; &#60;";
    const fixture = setup(0);
    const { run, entry, doc } = await chain(fixture, 5, true, { name, description });
    await run();
    await run();
    expect(entry()?.status).toBe("accepted");
    const response = await fixture.fake.handle(
      new Request(`${BASE}/_fake/xml?clave=${doc.document.clave}`),
    );
    expect(response.headers.get("content-type")).toContain("application/xml");
    const xml = await response.text();
    // Byte for byte what the worker signed and stored.
    expect(xml).toBe(entry()?.claimed.signed_xml);
    expect(schemaErrors(xml, "01")).toEqual([]);
    expect(textAt(xml, "FacturaElectronica", "Receptor", "Nombre")).toBe(cleanText(name, 100));
    expect(textAt(xml, "FacturaElectronica", "DetalleServicio", "LineaDetalle", "Detalle")).toBe(
      cleanText(description, 200),
    );
    expect(checkSignature(xml)).toEqual({
      documentDigest: true,
      propertiesDigest: true,
      signature: true,
    });
    // A clave it never received is not found.
    const unknown = await fixture.fake.handle(
      new Request(`${BASE}/_fake/xml?clave=${"0".repeat(50)}`),
    );
    expect(unknown.status).toBe(404);
  });

  it("calls back twice when told to, with the documented body", async () => {
    let now = 0;
    const calls: string[] = [];
    const fake = createFake({
      username: USER,
      password: PASSWORD,
      answerAfterMs: 0,
      now: () => now,
      fetch: (async (_u: string | URL | Request, init?: RequestInit) => {
        calls.push(String(init?.body));
        return new Response("{}");
      }) as typeof fetch,
    });
    fakes.push(fake);
    await fake.handle(
      new Request(`${BASE}/_fake/behaviour`, {
        method: "POST",
        body: JSON.stringify({ rules: [{ mode: "twice", times: 1 }] }),
      }),
    );
    const tokenResponse = await fake.handle(
      new Request(`${BASE}/auth/realms/rut-stag/protocol/openid-connect/token`, {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "password",
          client_id: "api-stag",
          username: USER,
          password: PASSWORD,
        }),
      }),
    );
    const { access_token } = (await tokenResponse.json()) as { access_token: string };
    const clave = "50621112600310112345600100001040000001532148291037";
    const xml = `<TiqueteElectronico><Clave>${clave}</Clave><ds:Signature></ds:Signature></TiqueteElectronico>`;
    const response = await fake.handle(
      new Request(`${BASE}/recepcion/v1/recepcion`, {
        method: "POST",
        headers: { authorization: `bearer ${access_token}` },
        body: JSON.stringify({
          clave,
          fecha: "2026-11-21T21:30:00-06:00",
          emisor: { tipoIdentificacion: "02", numeroIdentificacion: "3101123456" },
          callbackUrl: "http://localhost/cb",
          comprobanteXml: Buffer.from(xml).toString("base64"),
        }),
      }),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("location")).toMatch(/\/recepcion\/v1\/recepcion\/5062.*\/$/);
    now = 10;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toHaveLength(2);
    const body = JSON.parse(calls[0] ?? "{}");
    expect(body).toMatchObject({ clave, "ind-estado": "aceptado" });
    expect(Buffer.from(body["respuesta-xml"], "base64").toString()).toContain(
      "<Mensaje>1</Mensaje>",
    );
    expect(
      (
        await fake.handle(
          new Request(`${BASE}/recepcion/v1/recepcion`, {
            method: "POST",
            headers: { authorization: `bearer ${access_token}` },
            body: JSON.stringify({
              clave,
              fecha: "2026-11-21T21:30:00-06:00",
              emisor: { tipoIdentificacion: "02", numeroIdentificacion: "3101123456" },
              comprobanteXml: Buffer.from(xml).toString("base64"),
            }),
          }),
        )
      ).headers.get("x-error-cause"),
    ).toBe(`El comprobante con la Clave [${clave}] ya fue recibido.`);
  });
});
