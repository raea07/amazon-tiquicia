// Run with `pnpm --filter @yuntera/seller-native test` (Node's test runner through tsx).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { format, money } from "@yuntera/core";
import { categoryOptions, previewFees } from "./fees";

const base = {
  priceText: "20 000",
  topCategory: "hogar",
  byPlatform: false,
  weightGrams: 0,
  longestSideCm: 0,
  method: "card" as const,
};

describe("previewFees", () => {
  it("gives the documented example: ₡20 000, hogar, card, shipped by the seller → ₡16 203,20", () => {
    // docs/04-algorithms/fees-and-settlement.md, "Worked example".
    const preview = previewFees(base);
    assert.equal(preview.state, "ready");
    if (preview.state !== "ready") return;
    assert.equal(preview.payoutMinor, 1_620_320);
    assert.deepEqual(
      preview.rows.map((row) => [row.label, row.amountMinor]),
      [
        ["Precio de venta", 2_000_000],
        ["Comisión (12 %)", -240_000],
        ["Costo de cobro", -96_000],
        ["IVA sobre los cargos (13 %)", -43_680],
      ],
    );
    // Thousands are separated by a narrow no-break space, as everywhere in Yuntera.
    assert.equal(format(money(preview.payoutMinor)), "₡16\u202f203,20");
  });

  it("adds the warehouse fee by size when Yuntera ships it (documented: pequeño, SINPE Móvil → ₡15 367)", () => {
    const preview = previewFees({
      ...base,
      byPlatform: true,
      weightGrams: 900,
      longestSideCm: 30,
      method: "sinpe_movil",
    });
    assert.equal(preview.state, "ready");
    if (preview.state !== "ready") return;
    assert.equal(preview.payoutMinor, 1_536_700);
    assert.ok(preview.rows.some((row) => row.label === "Bodega y despacho (paquete pequeño)"));
  });

  it("asks for what is missing, and for the size only when Yuntera ships it", () => {
    const missing = previewFees({ ...base, priceText: "" });
    assert.equal(missing.state, "incomplete");
    if (missing.state === "incomplete") {
      assert.equal(
        missing.needs,
        "Escriba el precio, la categoría para ver cada cargo y lo que le queda.",
      );
    }
    const unsized = previewFees({ ...base, byPlatform: true });
    assert.equal(unsized.state, "incomplete");
    if (unsized.state === "incomplete") assert.match(unsized.needs, /el peso y las medidas/);
    assert.equal(previewFees({ ...base, topCategory: null }).state, "incomplete");
  });

  it("says when a package is too big for the warehouse", () => {
    const preview = previewFees({
      ...base,
      byPlatform: true,
      weightGrams: 29_000,
      longestSideCm: 190,
    });
    assert.equal(preview.state, "oversize");
  });
});

describe("categoryOptions", () => {
  const categories = [
    { slug: "hogar", parent_slug: null, name_es: "Hogar y cocina" },
    { slug: "cocina", parent_slug: "hogar", name_es: "Cocina y mesa" },
    { slug: "libros", parent_slug: null, name_es: "Libros y oficina" },
  ];

  it("offers only categories without children, each with its top-level category", () => {
    assert.deepEqual(categoryOptions(categories), [
      { slug: "cocina", name: "Cocina y mesa", group: "Hogar y cocina", top: "hogar" },
      { slug: "libros", name: "Libros y oficina", group: "Libros y oficina", top: "libros" },
    ]);
  });

  it("keeps a listing's current category even if it has children", () => {
    assert.equal(categoryOptions(categories, "hogar")[0]?.slug, "hogar");
  });
});
