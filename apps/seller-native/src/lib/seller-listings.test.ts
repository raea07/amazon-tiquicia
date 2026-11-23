// The seller actions of 083600 in the app give the seller centre's answers.
// Each case below is one the web's Server Action
// (apps/seller/src/app/seller-listing-actions.ts) answers the same way, and
// the words are checked against the seller centre's sources.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ApiError } from "@yuntera/db";
import {
  bringsBack,
  catalogRefusal,
  checkAddOffer,
  checkResumePrice,
  checkShopDescription,
  descriptionSent,
  offerAdded,
  pausedElsewhere,
  pausedHeading,
  pausedReason,
  RESUMED,
  sharedBy,
  UNPUBLISH_CONFIRM_NEEDED,
  unpublished,
  VARIANT_DONE,
  WITHDRAW_CONFIRM_NEEDED,
  WITHDRAWN,
} from "./seller-listings";

const web = (path: string) =>
  readFileSync(join(__dirname, "../../../seller/src", path), "utf8").replace(/\s+/g, " ");
const errorOf = (result: { error: string } | { input: unknown }) =>
  "error" in result ? result.error : null;

const offer = { price: "12 500", listPrice: "", fulfillment: "seller", handlingDays: "1" };

describe("an offer on another shop's product", () => {
  it("needs who ships it, a price, a sensible regular price and the handling days", () => {
    assert.equal(
      errorOf(checkAddOffer({ ...offer, fulfillment: "" })),
      "Elija quién guarda y despacha el producto.",
    );
    assert.equal(
      errorOf(checkAddOffer({ ...offer, price: "doce" })),
      "Escriba el precio en colones, por ejemplo 12 500.",
    );
    assert.equal(
      errorOf(checkAddOffer({ ...offer, listPrice: "abc" })),
      "El precio regular no es un monto válido.",
    );
    assert.match(
      errorOf(checkAddOffer({ ...offer, listPrice: "12 000" })) ?? "",
      /^El precio regular debe ser mayor/,
    );
    for (const days of ["", "11", "1.5", "-1"]) {
      assert.equal(
        errorOf(checkAddOffer({ ...offer, handlingDays: days })),
        "Indique en cuántos días hábiles lo tiene listo, de 0 a 10.",
      );
    }
  });

  it("hands the API colones as céntimos, and no handling days when the warehouse ships it", () => {
    assert.deepEqual(checkAddOffer({ ...offer, listPrice: "15 000" }), {
      input: {
        priceMinor: 1_250_000,
        listPriceMinor: 1_500_000,
        fulfillment: "seller",
        handlingDays: 1,
      },
    });
    assert.deepEqual(checkAddOffer({ ...offer, fulfillment: "platform", handlingDays: "" }), {
      input: {
        priceMinor: 1_250_000,
        listPriceMinor: null,
        fulfillment: "platform",
        handlingDays: null,
      },
    });
  });

  it("says what happens next, and why a search was refused, in the seller centre's words", () => {
    const actions = web("app/seller-listing-actions.ts");
    for (const text of [
      offerAdded("resumed", "seller"),
      offerAdded("added", "platform"),
      offerAdded("added", "seller"),
    ]) {
      assert.ok(actions.includes(text), text);
    }
    const page = web("app/productos/ofrecer/page.tsx");
    for (const code of ["shop_not_approved", "shop_not_active"] as const) {
      const text = catalogRefusal(new ApiError(code), "otro");
      assert.ok(page.includes(text), text);
    }
    assert.equal(catalogRefusal(new ApiError("forbidden"), "otro"), "otro");
  });
});

describe("variants and draft", () => {
  it("say what happened in the seller centre's words", () => {
    const actions = web("app/seller-listing-actions.ts");
    for (const text of Object.values(VARIANT_DONE)) assert.ok(actions.includes(text), text);
    assert.ok(actions.includes(UNPUBLISH_CONFIRM_NEEDED));
    const page = web("app/productos/[id]/page.tsx");
    for (const text of [
      "Ya no aparece en la tienda ni en las búsquedas, y nadie lo puede comprar. Los pedidos que ya tenía siguen su curso.",
      " El cambio que esperaba revisión se retiró: hágalo aquí.",
      sharedBy(1),
      "tiendas más tienen una oferta a la venta en esta publicación",
      pausedElsewhere(1) ?? "",
    ]) {
      assert.ok(page.includes(text.trim()), text);
    }
    assert.match(unpublished(true), /se retiró: hágalo aquí\. Cuando esté listo/);
    assert.equal(pausedElsewhere(0), null);
  });

  it("bring back a variant that is off or whose own offer is paused", () => {
    assert.equal(bringsBack({ active: false, own_offer_status: "active" }), true);
    assert.equal(bringsBack({ active: true, own_offer_status: "paused" }), true);
    assert.equal(bringsBack({ active: true, own_offer_status: "active" }), false);
    assert.equal(bringsBack({ active: true, own_offer_status: null }), false);
  });
});

describe("an offer paused below the price floor", () => {
  const day = (value: string) => `el día ${value.slice(8, 10)}`.replace("el ", "");
  it("says why, as the seller centre's list", () => {
    const page = web("app/productos/page.tsx");
    const fee = pausedReason({ reason: "fee_change", paused_at: "2026-11-20T10:00:00Z" }, day);
    const edit = pausedReason({ reason: "listing_edit", paused_at: "2026-11-20T10:00:00Z" }, day);
    assert.match(fee, /^Las tarifas cambiaron el día 20 y,/);
    assert.match(edit, /^El día 20 se aprobó un cambio del paquete/);
    for (const text of [
      fee.slice(fee.indexOf(" y, con")),
      edit.slice(edit.indexOf(" se aprobó")),
      pausedHeading(1),
      "ofertas en pausa porque su precio ya no cubre las tarifas",
    ]) {
      assert.ok(page.includes(text), text);
    }
  });

  it("goes back on sale at a new price, keeping a regular price only above it", () => {
    assert.equal(
      errorOf(checkResumePrice("", null)),
      "Escriba el precio en colones, por ejemplo 12 500.",
    );
    assert.deepEqual(checkResumePrice("13 000", 1_500_000), {
      input: { priceMinor: 1_300_000, listPriceMinor: 1_500_000 },
    });
    assert.deepEqual(checkResumePrice("16 000", 1_500_000), {
      input: { priceMinor: 1_600_000, listPriceMinor: null },
    });
    const actions = web("app/seller-listing-actions.ts");
    for (const text of [RESUMED, WITHDRAW_CONFIRM_NEEDED, WITHDRAWN]) {
      assert.ok(actions.includes(text), text);
    }
  });
});

describe("the shop's description", () => {
  it("is sent as the database keeps it, or empty to remove it", () => {
    assert.deepEqual(checkShopDescription("  Café   de altura \r\n\r\n\r\nDesde 1990 ", false), {
      input: "Café de altura\n\nDesde 1990",
    });
    assert.deepEqual(checkShopDescription("Lo que sea", true), { input: "" });
    assert.equal(
      errorOf(checkShopDescription("x".repeat(1001), false)),
      "La descripción puede tener hasta 1000 caracteres; esta tiene 1001.",
    );
  });

  it("says what happens next in the seller centre's words", () => {
    const actions = web("app/seller-listing-actions.ts");
    assert.ok(actions.includes(descriptionSent("algo")));
    assert.ok(actions.includes(descriptionSent("")));
  });
});
