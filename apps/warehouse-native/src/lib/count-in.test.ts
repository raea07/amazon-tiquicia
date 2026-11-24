// Runs with Node's own test runner (`pnpm test` here), as stock.test.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  countedInText,
  countInButton,
  elsewhereText,
  keepResults,
  listedText,
  noCountHere,
  notFoundText,
  parseCountIn,
  receiptText,
  searchable,
  takesCounts,
} from "./count-in";

describe("a count of a new product", () => {
  it("needs the shop, a whole number from 1 to 10 000 and a reason", () => {
    assert.deepEqual(parseCountIn({ sellerId: null, quantity: "2", note: "Detrás de la caja" }), {
      error: "Elija de qué tienda son las unidades.",
    });
    for (const quantity of ["", "0", "1.5", "-1", "dos", "10001"]) {
      assert.deepEqual(parseCountIn({ sellerId: "s", quantity, note: "Detrás de la caja" }), {
        error:
          "Escriba cuántas unidades contó: un número entero desde 1 hasta 10 000. Si son más, avise a operaciones.",
      });
    }
    for (const note of ["rota", "12345 67", ""]) {
      assert.deepEqual(parseCountIn({ sellerId: "s", quantity: "2", note }), {
        error:
          "Escriba el motivo con al menos 5 letras, por ejemplo «estaban detrás de otra caja».",
      });
    }
    assert.deepEqual(
      parseCountIn({ sellerId: "s", quantity: " 2 ", note: " Detrás de la caja " }),
      {
        sellerId: "s",
        quantity: 2,
        note: "Detrás de la caja",
      },
    );
    assert.deepEqual(
      parseCountIn({ sellerId: "s", quantity: "10000", note: "Detrás de la caja" }),
      {
        sellerId: "s",
        quantity: 10000,
        note: "Detrás de la caja",
      },
    );
  });

  it("is offered only on a switched-on location that takes counted units", () => {
    for (const kind of ["storage", "pick", "returns", "receiving"]) {
      assert.equal(takesCounts(kind), true);
      assert.equal(noCountHere({ active: true, kind }), null);
    }
    for (const kind of ["damaged", "packing", "staging"]) {
      assert.equal(takesCounts(kind), false);
      assert.match(noCountHere({ active: true, kind }) ?? "", /En esta zona no se suman unidades/);
    }
    assert.match(noCountHere({ active: false, kind: "storage" }) ?? "", /está desactivada/);
  });

  it("says what it does and what happened, in the web's words", () => {
    assert.equal(countInButton("", "B-01-01-A"), "Sumar las unidades a B-01-01-A");
    assert.equal(countInButton("1", "B-01-01-A"), "Sumar 1 unidad a B-01-01-A");
    assert.equal(countInButton("2", "B-01-01-A"), "Sumar 2 unidades a B-01-01-A");
    assert.equal(
      countedInText(2, "YT-1"),
      "Se sumaron 2 unidades de YT-1 a esta ubicación: ya aparece en la lista. La tienda ve el conteo y su motivo en su inventario.",
    );
    assert.match(countedInText(1, "YT-1"), /^Se sumó 1 unidad de YT-1/);
    assert.match(receiptText("Bodega Central"), /Mercadería por recibir/);
    assert.match(
      listedText("TecnoCasa", 3),
      /\(3 en el estante\): corrija la cantidad en su línea/,
    );
    assert.match(elsewhereText("Tienda Sendero"), /^Tienda Sendero también vende/);
    assert.match(notFoundText("Bodega Central", "xyz"), /«xyz»/);
    assert.equal(searchable(" a "), false);
    assert.equal(searchable("ab"), true);
    assert.equal(searchable("a".repeat(81)), false);
  });

  it("uses the same words as the web page and its action", () => {
    const web = join(__dirname, "../../../field/src/app/bodega/ubicacion");
    const page = readFileSync(join(web, "count-in.tsx"), "utf8").replace(/\s+/g, " ");
    const action = readFileSync(join(web, "count-in-actions.ts"), "utf8").replace(/\s+/g, " ");
    const words = (text: string) => text.replace(/\s+/g, " ");
    for (const sentence of [
      "Elija de qué tienda son las unidades.",
      "Escriba cuántas unidades contó: un número entero desde 1 hasta 10 000. Si son más, avise a operaciones.",
      "Escriba el motivo con al menos 5 letras, por ejemplo «estaban detrás de otra caja».",
    ]) {
      assert.ok(action.includes(words(sentence)), `the web action says: ${sentence}`);
    }
    for (const part of [
      "Esta ubicación está desactivada: aquí no se cuentan productos nuevos.",
      "En esta zona no se suman unidades: lo que se guarda aquí no se vende.",
      "Las primeras unidades de una tienda entran con una recepción: búsquela en «Mercadería por recibir», en el inicio de Bodega.",
      "corrija la cantidad en su línea, en la lista de arriba.",
      "también vende este producto, pero no tiene existencias registradas en esta bodega: sus primeras unidades entran con una recepción.",
    ]) {
      assert.ok(page.includes(part), `the web page says: ${part}`);
    }
  });
});

describe("the results read again after a refusal", () => {
  const notebook = { sku_id: "a", listed: false };
  const earphones = { sku_id: "b", listed: false };
  it("take what the new read says about each product shown", () => {
    assert.deepEqual(
      keepResults([notebook, earphones], [{ sku_id: "b", listed: true }, notebook]),
      [notebook, { sku_id: "b", listed: true }],
    );
  });
  it("never drop a product the new read misses (a barcode found in another of its forms)", () => {
    assert.deepEqual(keepResults([earphones], []), [earphones]);
    assert.deepEqual(keepResults([notebook, earphones], [notebook]), [notebook, earphones]);
  });
  it("are the new read when nothing was shown", () => {
    assert.deepEqual(keepResults(null, [notebook]), [notebook]);
    assert.deepEqual(keepResults([], [notebook]), [notebook]);
  });
});
