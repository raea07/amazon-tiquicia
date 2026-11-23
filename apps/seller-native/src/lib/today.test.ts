// Run with `pnpm --filter @yuntera/seller-native test` (Node's test runner through tsx).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SellerListingEdit, SellerPayoutDetails } from "@yuntera/db";
import { todayItems, todaySentence } from "./today";

const none = {
  listings_active: 3,
  listings_in_review: 0,
  listings_rejected: 0,
  offers_out_of_stock: 0,
  to_pack: 0,
  open_returns: 0,
};
const now = new Date("2026-11-21T15:00:00Z");
const edit = (status: "pending" | "rejected" | null): SellerListingEdit => ({
  product_id: "00000000-0000-4000-8000-000000000001",
  editable: true,
  edit_status: status,
  edit_reason: status === "rejected" ? "La foto no corresponde." : null,
  edit_at: status ? "2026-11-20T15:00:00Z" : null,
});
const payout = (
  status: "pending" | "approved" | "rejected",
  decidedAt: string | null,
): SellerPayoutDetails => ({
  can_request: true,
  current: { iban_masked: "CR•• •••• •••• •••• 8637", holder_name: "Ana", sinpe_number: null },
  request: {
    id: "00000000-0000-4000-8000-000000000002",
    status,
    iban_masked: "CR•• •••• •••• •••• 0606",
    holder_name: "Ana Mora Solís",
    sinpe_number: null,
    requested_at: "2026-11-01T15:00:00Z",
    requested_by_name: "Ana",
    decided_at: decidedAt,
    note: status === "rejected" ? "El titular no coincide." : null,
  },
});

describe("todayItems", () => {
  it("says there is nothing to do when nothing needs doing", () => {
    const items = todayItems(
      none,
      [edit(null), edit("pending")],
      payout("approved", "2026-11-10T00:00:00Z"),
      now,
    );
    assert.deepEqual(items, []);
    assert.match(todaySentence(items), /no tiene nada pendiente/);
  });

  it("does not say nothing is pending while the edits or the bank request are still read", () => {
    const items = todayItems(none, undefined, undefined, now);
    assert.equal(todaySentence(items, { loading: true }), "Cargando lo que tiene pendiente…");
    assert.doesNotMatch(todaySentence(items, { loading: true }), /no tiene nada/);
    // What is already known is said; the rest joins it when it answers.
    const known = todayItems({ ...none, to_pack: 1 }, undefined, undefined, now);
    assert.equal(todaySentence(known, { loading: true }), "Hoy tiene 1 paquete por empacar.");
    // A read that failed is left out, and then nothing pending is said.
    assert.match(todaySentence(items, { loading: false }), /no tiene nada pendiente/);
  });

  it("counts the overview's figures as the web summary does", () => {
    const items = todayItems({ ...none, to_pack: 1, offers_out_of_stock: 2 }, [], undefined, now);
    assert.equal(
      todaySentence(items),
      "Hoy tiene 1 paquete por empacar y 2 productos sin existencias.",
    );
    assert.equal(items[0]?.href, "/pedidos");
  });

  it("adds a published listing whose change was not approved, linked to Productos", () => {
    const items = todayItems(
      none,
      [edit("rejected"), edit("rejected"), edit("pending")],
      undefined,
      now,
    );
    assert.deepEqual(
      items.map((i) => [i.key, i.text, i.href]),
      [["rejected-edits", "2 cambios no aprobados", "/productos"]],
    );
  });

  it("adds a bank-account request waiting, or refused in the last 30 days, linked to Cuenta", () => {
    assert.deepEqual(
      todayItems(none, [], payout("pending", null), now).map((i) => [i.key, i.href]),
      [["payout-pending", "/cuenta"]],
    );
    assert.deepEqual(
      todayItems(none, [], payout("rejected", "2026-11-15T00:00:00Z"), now).map((i) => i.key),
      ["payout-rejected"],
    );
    // An old refusal is no longer news.
    assert.deepEqual(todayItems(none, [], payout("rejected", "2026-09-01T00:00:00Z"), now), []);
  });
});
