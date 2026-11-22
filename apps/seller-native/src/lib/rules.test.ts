// The app's checks give the seller centre's answers. Each case below is one
// the web's Server Action (apps/seller/src/app) answers the same way.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkInbound,
  checkListingEdit,
  checkLocation,
  checkNewListing,
  checkOffer,
  checkPacked,
  checkPayoutRequest,
  checkShop,
  checkStock,
  ibanFeedback,
  plainColones,
  slugOf,
} from "./rules";

const errorOf = (result: { error: string } | { input: unknown }) =>
  "error" in result ? result.error : null;
const inputOf = <T>(result: { error: string } | { input: T }): T => {
  if ("error" in result) throw new Error(`Expected an input, got: ${result.error}`);
  return result.input;
};

// A valid Costa Rican IBAN (checksum passes) and the same with two digits swapped.
const GOOD_IBAN = "CR05015202001026284066";
const SWAPPED_IBAN = "CR05015202001026284606";

describe("checkShop (registerShop)", () => {
  const good = {
    tradeName: "Café Doña Ana",
    legalName: "Ana Mora Solís",
    idType: "fisica",
    idNumber: "1-0234-0567",
    contactEmail: "ana@example.com",
    contactPhone: "8888-1234",
    fiscalAddress: "San José, Montes de Oca, San Pedro, 300 m sur de la iglesia",
    declared: true,
  };

  it("turns a complete form into the API's input", () => {
    const input = inputOf(checkShop(good));
    assert.equal(input.slug, "cafe-dona-ana");
    assert.equal(input.contactPhone, "+50688881234");
    assert.equal(input.idType, "fisica");
  });

  it("refuses each problem with the web's words, one at a time", () => {
    assert.match(errorOf(checkShop({ ...good, tradeName: "A" })) ?? "", /entre 2 y 80/);
    assert.match(errorOf(checkShop({ ...good, tradeName: "¡¡!!" })) ?? "", /letras o números/);
    assert.match(errorOf(checkShop({ ...good, legalName: "" })) ?? "", /razón social/);
    assert.match(errorOf(checkShop({ ...good, idType: "x" })) ?? "", /tipo de identificación/);
    assert.match(errorOf(checkShop({ ...good, idNumber: "123" })) ?? "", /no es válido/);
    assert.match(errorOf(checkShop({ ...good, contactEmail: "ana" })) ?? "", /correo/);
    assert.match(errorOf(checkShop({ ...good, contactPhone: "12" })) ?? "", /8 dígitos/);
    assert.match(errorOf(checkShop({ ...good, fiscalAddress: "San José" })) ?? "", /completa/);
    assert.match(errorOf(checkShop({ ...good, declared: false })) ?? "", /declarar/);
  });

  it("makes a shop address from any name", () => {
    assert.equal(slugOf("  Ferretería   El Higuerón! "), "ferreteria-el-higueron");
  });
});

describe("checkNewListing (createListing)", () => {
  const good = {
    title: "Lámpara de escritorio LED Volcán",
    categorySlug: "cocina",
    description: "",
    bullets: "Luz cálida\n\n Brazo flexible ",
    price: "20 000",
    fulfillment: "seller",
    handlingDays: "2",
    weightGrams: "900",
    lengthCm: "30",
    widthCm: "15",
    heightCm: "12",
  };

  it("sends céntimos, trimmed bullet points and the seller's handling days", () => {
    const input = inputOf(checkNewListing(good, false));
    assert.equal(input.priceMinor, 2_000_000);
    assert.deepEqual(input.bulletPoints, ["Luz cálida", "Brazo flexible"]);
    assert.equal(input.handlingDays, 2);
    assert.equal(input.description, null);
    assert.equal(input.submit, true);
    assert.equal(inputOf(checkNewListing(good, true)).submit, false);
  });

  it("ignores handling days when Yuntera ships it", () => {
    assert.equal(
      inputOf(checkNewListing({ ...good, fulfillment: "platform", handlingDays: "9" }, false))
        .handlingDays,
      0,
    );
  });

  it("refuses with the web's messages", () => {
    assert.equal(
      errorOf(checkNewListing({ ...good, title: "Hola" }, false)),
      "El título debe tener al menos 5 letras.",
    );
    assert.equal(
      errorOf(checkNewListing({ ...good, categorySlug: "" }, false)),
      "Elija la categoría.",
    );
    assert.equal(
      errorOf(checkNewListing({ ...good, weightGrams: "" }, false)),
      "Escriba el peso en gramos.",
    );
    assert.equal(
      errorOf(checkNewListing({ ...good, weightGrams: "40000" }, false)),
      "Por ahora no manejamos productos de más de 30 kg.",
    );
    assert.equal(
      errorOf(checkNewListing({ ...good, lengthCm: "250" }, false)),
      "Yuntera no transporta paquetes de más de 200 cm por lado. Revise las medidas.",
    );
    assert.equal(
      errorOf(checkNewListing({ ...good, price: "doce" }, false)),
      "Escriba el precio en colones, por ejemplo 12 500.",
    );
    assert.equal(
      errorOf(checkNewListing({ ...good, bullets: "a\nb\nc\nd\ne\nf\ng\nh\ni" }, false)),
      "Use como máximo 8 características.",
    );
  });
});

describe("checkListingEdit (updateListing)", () => {
  const good = {
    title: "Abanico de pie Volcán 18 pulgadas",
    categorySlug: "ventilacion",
    description: "  ",
    bullets: "Tres velocidades",
    weightGrams: "4200",
    lengthCm: "50",
    widthCm: "20",
    heightCm: "20",
  };
  it("sends the edit, or refuses a bullet that is too long", () => {
    assert.equal(inputOf(checkListingEdit(good, false)).description, null);
    assert.equal(
      errorOf(checkListingEdit({ ...good, bullets: "x".repeat(301) }, false)),
      "Cada característica puede tener hasta 300 caracteres.",
    );
  });
});

describe("checkOffer (updateOffer)", () => {
  it("accepts a price and an optional higher regular price", () => {
    assert.deepEqual(
      inputOf(checkOffer({ price: "4 300", listPrice: "", status: "active", handlingDays: "1" })),
      { priceMinor: 430_000, listPriceMinor: null, status: "active", handlingDays: 1 },
    );
  });
  it("refuses a regular price that is not higher, and impossible handling days", () => {
    assert.match(
      errorOf(checkOffer({ price: "4300", listPrice: "1", status: "active", handlingDays: "" })) ??
        "",
      /debe ser mayor/,
    );
    assert.match(
      errorOf(checkOffer({ price: "4300", listPrice: "", status: "active", handlingDays: "11" })) ??
        "",
      /entre 0 y 10/,
    );
  });
  it("writes a price back the way a person types it", () => {
    assert.equal(plainColones(1_990_000), "19900");
    assert.equal(plainColones(1_990_050), "19900,50");
  });
});

describe("inventory and packing", () => {
  it("checks a stock count", () => {
    assert.equal(inputOf(checkStock("23")), 23);
    assert.match(errorOf(checkStock("")) ?? "", /de 0 en adelante/);
    assert.match(errorOf(checkStock("-1")) ?? "", /de 0 en adelante/);
  });

  it("checks a pickup place, asking for the exact point last", () => {
    const place = {
      name: "Local Heredia",
      address: "Heredia centro, 100 metros este del Mercado",
      postalCode: "40101",
      lat: 9.998,
      lng: -84.117,
    };
    assert.equal(inputOf(checkLocation(place)).postalCode, "40101");
    assert.match(errorOf(checkLocation({ ...place, address: "Heredia" })) ?? "", /más detalle/);
    assert.match(errorOf(checkLocation({ ...place, postalCode: "" })) ?? "", /provincia/);
    assert.match(errorOf(checkLocation({ ...place, lat: null })) ?? "", /código Plus/);
  });

  it("checks an inbound shipment", () => {
    const warehouseId = "00000000-0000-4000-8000-000000000001";
    const sku = "00000000-0000-4000-8000-000000000002";
    const other = "00000000-0000-4000-8000-000000000003";
    assert.deepEqual(
      inputOf(
        checkInbound({ warehouseId, quantities: { [sku]: "15", [other]: "" }, expectedOn: "" }),
      ),
      { warehouseId, lines: [{ skuId: sku, quantity: 15 }], expectedOn: null },
    );
    assert.match(
      errorOf(checkInbound({ warehouseId, quantities: { [sku]: "0" }, expectedOn: "" })) ?? "",
      /al menos un producto/,
    );
    assert.match(
      errorOf(checkInbound({ warehouseId, quantities: { [sku]: "1,5" }, expectedOn: "" })) ?? "",
      /números enteros/,
    );
    assert.equal(
      errorOf(checkInbound({ warehouseId: "", quantities: {}, expectedOn: "" })),
      "Elija la bodega.",
    );
  });

  it("checks a packed parcel", () => {
    assert.deepEqual(inputOf(checkPacked({ weightGrams: "850", packageCount: "" })), {
      weightGrams: 850,
      packageCount: 1,
    });
    assert.match(errorOf(checkPacked({ weightGrams: "", packageCount: "1" })) ?? "", /gramos/);
  });
});

describe("the payout account", () => {
  it("sends a valid IBAN without spaces", () => {
    assert.deepEqual(
      inputOf(
        checkPayoutRequest({
          iban: "cr05 0152 0200 1026 2840 66",
          holderName: "Ana  Mora",
          sinpe: "",
        }),
      ),
      { iban: GOOD_IBAN, holderName: "Ana Mora", sinpeNumber: null },
    );
  });

  it("refuses a wrong IBAN before anything is sent, saying why", () => {
    assert.match(
      errorOf(checkPayoutRequest({ iban: SWAPPED_IBAN, holderName: "Ana Mora", sinpe: "" })) ?? "",
      /no coinciden/,
    );
    assert.match(
      errorOf(
        checkPayoutRequest({ iban: "ES05015202001026284066", holderName: "Ana", sinpe: "" }),
      ) ?? "",
      /empieza con las letras CR/,
    );
    assert.match(
      errorOf(
        checkPayoutRequest({ iban: GOOD_IBAN, holderName: "Ana Mora", sinpe: "2222-1234" }),
      ) ?? "",
      /celular/,
    );
  });

  it("guides while the IBAN is typed", () => {
    assert.equal(ibanFeedback("CR05 0152").hint, "Lleva 8 de 22 caracteres.");
    assert.equal(ibanFeedback("C").hint, "Empieza con CR y tiene 22 caracteres.");
    assert.match(ibanFeedback(SWAPPED_IBAN).error ?? "", /no coinciden/);
    assert.match(ibanFeedback(GOOD_IBAN).hint ?? "", /^Cuenta válida: CR05/);
  });
});
