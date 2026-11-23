// The app's stock history says what the seller centre's says, word for word.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  HISTORY_EMPTY,
  HISTORY_HEADING,
  HISTORY_INTRO,
  HISTORY_KIND,
  HISTORY_LIMIT,
  historyChange,
  historyReason,
} from "./stock-history";

const centre = readFileSync(
  join(__dirname, "../../../seller/src/app/inventario/page.tsx"),
  "utf8",
).replace(/\s+/g, " ");

describe("stock history in the seller app", () => {
  it("uses the seller centre's heading, introduction and empty text", () => {
    for (const words of [HISTORY_HEADING, HISTORY_INTRO, HISTORY_EMPTY]) {
      assert.ok(centre.includes(words), `not in the seller centre: ${words}`);
    }
    assert.ok(centre.includes(`sellerStockHistory(shop.id, ${HISTORY_LIMIT})`));
  });

  it("names each kind of change as the seller centre does", () => {
    for (const [kind, label] of Object.entries(HISTORY_KIND)) {
      assert.ok(centre.includes(`${kind}: "${label}"`), `${kind}: ${label}`);
    }
  });

  it("writes the change with its sign and the reason only when there is one", () => {
    assert.equal(historyChange(3), "+3 unidades");
    assert.equal(historyChange(-1), "−1 unidad");
    assert.equal(historyReason("Faltan 2, caja rota"), "Motivo: Faltan 2, caja rota");
    assert.equal(historyReason(null), null);
  });
});
