import { verifyStandardWebhook } from "@yuntera/notifications";
import { afterEach, describe, expect, it } from "vitest";
import { createFake } from "./fake.ts";

const secret = `whsec_${btoa("fake test secret")}`;

function post(fake: ReturnType<typeof createFake>, path: string, body: unknown, key = "k1") {
  return fake.handle(
    new Request(`http://fake.test${path}`, {
      method: "POST",
      headers: {
        authorization: "Bearer bk_local_x",
        "idempotency-key": key,
        "content-type": "application/json",
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const email = {
  to: [{ email: "ana@correo.cr" }],
  subject: "Hola",
  text: "x",
  html: "<p>x</p>",
  category: "transactional",
  metadata: { delivery_id: "d1" },
};

describe("the fake providers", () => {
  let fake: ReturnType<typeof createFake>;
  afterEach(() => fake.close());

  it("keeps an answer per idempotency key, as Bird does", async () => {
    fake = createFake({ deliverAfterMs: -1 });
    const raw = JSON.stringify(email);
    const first = await post(fake, "/v1/email/messages", raw);
    expect(first.status).toBe(202);
    const replay = await post(fake, "/v1/email/messages", raw);
    expect(replay.headers.get("idempotency-replay")).toBe("true");
    expect(await replay.json()).toEqual(await first.json());
    expect((await post(fake, "/v1/email/messages", { ...email, subject: "Otro" })).status).toBe(
      409,
    );
    expect(fake.messages()).toHaveLength(1);
  });

  it("rejects a recipient when told to, and keeps the refusal for the key", async () => {
    fake = createFake({ deliverAfterMs: -1 });
    await fake.handle(
      new Request("http://fake.test/_fake/behaviour", {
        method: "POST",
        body: JSON.stringify({ rules: [{ mode: "reject", to: "ana@correo.cr" }] }),
      }),
    );
    expect((await post(fake, "/v1/email/messages", email)).status).toBe(422);
    await fake.handle(
      new Request("http://fake.test/_fake/behaviour", { method: "POST", body: '{"rules":[]}' }),
    );
    expect((await post(fake, "/v1/email/messages", email)).status).toBe(422); // same key: replayed
    expect((await post(fake, "/v1/email/messages", email, "k2")).status).toBe(202); // new key: sent
  });

  it("refuses transactional mail that Bird would treat as Liquid or marketing", async () => {
    fake = createFake({ deliverAfterMs: -1 });
    expect((await post(fake, "/v1/email/messages", { ...email, parameters: {} })).status).toBe(422);
    expect(
      (await post(fake, "/v1/email/messages", { ...email, category: undefined }, "k3")).status,
    ).toBe(422);
  });

  it("reports delivery with a correctly signed webhook", async () => {
    const received: Array<{ body: string; headers: Headers }> = [];
    fake = createFake({
      webhookUrl: "http://functions.test/bird-webhook",
      webhookSecret: secret,
      deliverAfterMs: 0,
      fetch: (async (_url: string, init: RequestInit) => {
        received.push({
          body: String(init.body),
          headers: new Headers(init.headers as Record<string, string>),
        });
        return new Response("{}", { status: 200 });
      }) as unknown as typeof fetch,
    });
    await post(fake, "/v1/email/messages", email);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(received).toHaveLength(1);
    const delivery = received[0];
    expect(JSON.parse(delivery?.body ?? "{}")).toMatchObject({
      type: "email.delivered",
      data: { metadata: { delivery_id: "d1" } },
    });
    expect(
      (
        await verifyStandardWebhook(delivery?.body ?? "", delivery?.headers ?? new Headers(), [
          secret,
        ])
      ).ok,
    ).toBe(true);
    expect(fake.messages()[0]?.status).toBe("delivered");
  });
});
