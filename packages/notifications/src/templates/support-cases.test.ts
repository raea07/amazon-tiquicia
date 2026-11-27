/**
 * The message added with migration 084700 (support-cases.ts): what a shopper
 * reads when staff answer one of their cases. templates.test.ts renders it on
 * every channel with realistic and hostile data; this checks that it points
 * to where the answer is read and never carries the answer, and that the
 * planner sends it on the channels named here.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { RenderedEmail, RenderedPush } from "../types.ts";
import { channelsOf } from "./catalog.ts";
import { render } from "./render.ts";

const links = {
  shop: "https://www.yuntera.cr",
  seller: "https://vende.yuntera.cr",
  ops: "https://central.yuntera.cr",
  field: "https://ruta.yuntera.cr",
};
const sender = {
  legalName: "Yuntera S.A.",
  legalId: "cédula jurídica 3-101-000000",
  postalAddress: "San José, Costa Rica",
  replyTo: "ayuda@yuntera.cr",
};

describe("case_answered", () => {
  it("points to the order's page when the case has an order", () => {
    const mail = render({
      template: "case_answered",
      channel: "email",
      vars: { case_ref: "7C1A2B3D", order_number: "YT-100123", closed: true },
      name: "Ana",
      links,
      sender,
    }) as RenderedEmail;
    expect(mail.subject).toBe("Le respondimos (caso 7C1A2B3D)");
    expect(mail.text).toContain("sobre el pedido YT-100123");
    expect(mail.text).toContain("https://www.yuntera.cr/pedidos/YT-100123");
    expect(mail.text).toContain("Dimos el caso por resuelto");
  });

  it("points to the account's cases otherwise, also in the push", () => {
    const push = render({
      template: "case_answered",
      channel: "push",
      vars: { case_ref: "7C1A2B3D", closed: false },
      name: "Ana",
      links,
      sender,
    }) as RenderedPush;
    expect(push.data.url).toBe("/cuenta/casos");
    expect(push.body).toBe("Hay una respuesta en su cuenta.");
  });

  it("is planned by e-mail and push, and the planner never passes the answer", () => {
    expect(channelsOf("case_answered")).toEqual(["email", "push"]);
    const migrations = fileURLToPath(new URL("../../../../supabase/migrations/", import.meta.url));
    const file = readdirSync(migrations).find((name) => name.endsWith("_support_cases.sql"));
    const sql = readFileSync(`${migrations}${file}`, "utf8");
    const call = /notify_person\(v_event, 'case_answered'[\s\S]*?\);/.exec(sql)?.[0] ?? "";
    expect(call).toContain("array['email', 'push']");
    expect(call).not.toContain("v_body");
  });
});
