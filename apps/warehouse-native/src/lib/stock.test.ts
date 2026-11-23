// Runs with Node's own test runner (`pnpm test` here), as floor.test.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  differenceText,
  goneText,
  movedText,
  parseCount,
  parseMove,
  refusedAndGone,
} from "./stock";

describe("a move", () => {
  it("needs a target and a whole number of free units", () => {
    assert.deepEqual(parseMove({ quantity: "2", toLocationId: null, free: 5 }), {
      error: "Elija a qué estante lo mueve.",
    });
    for (const quantity of ["", "0", "1.5", "-1", "dos"]) {
      assert.deepEqual(parseMove({ quantity, toLocationId: "x", free: 5 }), {
        error: "Escriba cuántas unidades mueve: un número entero desde 1.",
      });
    }
    assert.deepEqual(parseMove({ quantity: "6", toLocationId: "x", free: 5 }), {
      error: "Solo hay 5 unidades libres para mover: las demás esperan a pedidos.",
    });
    assert.deepEqual(parseMove({ quantity: " 5 ", toLocationId: "x", free: 5 }), {
      quantity: 5,
      toLocationId: "x",
    });
  });
});

describe("a count", () => {
  it("needs a different number and a reason with letters", () => {
    assert.ok("error" in parseCount({ counted: "", note: "Faltan dos", expected: 3 }));
    assert.deepEqual(parseCount({ counted: "3", note: "Faltan dos", expected: 3 }), {
      error: "Contó lo mismo que está registrado: no hay nada que corregir.",
    });
    assert.deepEqual(parseCount({ counted: "1", note: "12345 678", expected: 3 }), {
      error: "Escriba el motivo con al menos 5 letras, por ejemplo «faltan 2, caja rota».",
    });
    assert.deepEqual(parseCount({ counted: "1", note: "  Faltan dos  ", expected: 3 }), {
      counted: 1,
      delta: -2,
      note: "Faltan dos",
    });
    assert.ok("error" in parseCount({ counted: "20000", note: "Faltan dos", expected: 3 }));
  });

  it("shows the difference while typing", () => {
    assert.equal(differenceText("", 7), "Escriba lo que contó para ver la diferencia.");
    assert.equal(differenceText("7", 7), "Coincide con lo registrado: no hay nada que corregir.");
    assert.equal(differenceText("5", 7), "Diferencia: −2 unidades (faltan). Quedarán 5 unidades.");
    assert.equal(differenceText("8", 7), "Diferencia: +1 unidad (sobran). Quedarán 8 unidades.");
  });
});

describe("the answer after a move", () => {
  it("agrees with the number of units", () => {
    assert.equal(movedText(1, "B-01-02-A"), "Se movió 1 unidad a B-01-02-A. Guárdela allí ahora.");
    assert.equal(
      movedText(3, "B-01-02-A"),
      "Se movieron 3 unidades a B-01-02-A. Guárdelas allí ahora.",
    );
  });
});

describe("a refusal whose product has left the location", () => {
  const item = { sku_id: "s1", seller_id: "v1" };
  it("is shown on the screen only when the product is no longer listed", () => {
    const refused = { skuId: "s1", sellerId: "v1" };
    assert.equal(refusedAndGone(null, []), false);
    assert.equal(refusedAndGone(refused, [item]), false);
    assert.equal(refusedAndGone(refused, []), true);
    assert.equal(refusedAndGone(refused, [{ sku_id: "s1", seller_id: "v2" }]), true);
  });
  it("says nothing was saved and what to do, in the web's words", () => {
    assert.equal(
      goneText("move", "YT-64D3BDF4"),
      "No se movió nada: el producto YT-64D3BDF4 ya no está en esta ubicación, porque alguien lo alistó, lo movió o corrigió la cantidad mientras tanto. Búsquelo en «Buscar un producto» para ver dónde está.",
    );
    assert.equal(
      goneText("count", "YT-1"),
      "No se corrigió nada: el producto YT-1 ya no está en esta ubicación, porque alguien lo alistó, lo movió o corrigió la cantidad mientras tanto. Revise la ubicación y vuelva a contar.",
    );
    const web = readFileSync(join(__dirname, "../../../field/src/lib/locations.ts"), "utf8");
    const native = readFileSync(join(__dirname, "stock.ts"), "utf8");
    const words = (source: string) => /export const goneText = [^`]*(`[^`]*`)/.exec(source)?.[1];
    assert.ok(words(web));
    assert.equal(words(web), words(native));
  });
});
