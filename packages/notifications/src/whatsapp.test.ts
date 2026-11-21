/**
 * The WhatsApp template definitions (packages/notifications/whatsapp/*.json),
 * which are submitted to Meta, must match what the worker sends, and follow
 * Meta's authoring rules as the research note lists them (section 2.2).
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { channelsOf, TEMPLATE_NAMES } from "./templates/catalog.ts";
import { render } from "./templates/render.ts";

const dir = fileURLToPath(new URL("../whatsapp/", import.meta.url));
interface Definition {
  slug: string;
  category: string;
  language: string;
  header?: { type: string; text: string };
  body: string;
  footer?: string;
  button?: { type: string; text: string; url: string };
  variables: Record<string, string>;
  ttl_seconds: number | null;
}
const definitions = readdirSync(dir)
  .filter((file) => file.endsWith(".json"))
  .map((file) => JSON.parse(readFileSync(`${dir}${file}`, "utf8")) as Definition);

const links = {
  shop: "https://www.yuntera.cr",
  seller: "https://vende.yuntera.cr",
  ops: "https://central.yuntera.cr",
  field: "https://ruta.yuntera.cr",
};
const sender = {
  legalName: "Yuntera",
  legalId: "x",
  postalAddress: "San José",
  replyTo: "ayuda@yuntera.cr",
};

describe("WhatsApp template definitions", () => {
  it("exist for exactly the templates the worker sends by WhatsApp", () => {
    const sent = TEMPLATE_NAMES.filter((t) => channelsOf(t).includes("whatsapp")).sort();
    expect(definitions.map((d) => d.slug).sort()).toEqual(sent);
  });

  for (const d of definitions) {
    it(`${d.slug} follows Meta's rules and matches the worker`, () => {
      expect(d.slug).toMatch(/^[a-z0-9_]+$/);
      expect(d.slug.startsWith("bird_")).toBe(false);
      expect(d.category).toBe("utility");
      expect(d.body.length).toBeLessThanOrEqual(1024);
      expect(d.header?.text.length ?? 0).toBeLessThanOrEqual(60);
      expect(d.footer?.length ?? 0).toBeLessThanOrEqual(60);
      expect(d.footer ?? "").not.toMatch(/\{\{/);
      expect(d.button?.text.length ?? 0).toBeLessThanOrEqual(25);
      // The body never starts or ends with a variable.
      expect(d.body.trim()).not.toMatch(/^\{\{|\}\}[.!]?$/);
      const inBody = [...d.body.matchAll(/\{\{([a-z0-9_]+)\}\}/g)].map((m) => m[1]);
      const inButton = [...(d.button?.url ?? "").matchAll(/\{\{([a-z0-9_]+)\}\}/g)].map(
        (m) => m[1],
      );
      expect(d.button?.url ?? "{{button_url}}").toMatch(/\{\{button_url\}\}$/);
      expect([...inBody, ...inButton].sort()).toEqual(Object.keys(d.variables).sort());

      // The worker sends exactly these names.
      const rendered = render({
        template: d.slug,
        channel: "whatsapp",
        vars: {
          order_number: "YT-100123",
          shop_name: "TecnoCasa",
          unit_count: 2,
          reason: "nobody_home",
        },
        name: "Ana",
        links,
        sender,
      });
      if (rendered.channel !== "whatsapp") throw new Error("not WhatsApp");
      expect(Object.keys(rendered.parameters).sort()).toEqual(Object.keys(d.variables).sort());
      expect(rendered.templateSlug).toBe(d.slug);
      // Nothing secret, nothing promotional.
      expect(d.body).not.toMatch(/descuento|oferta|promoción|cupón/i);
    });
  }
});
