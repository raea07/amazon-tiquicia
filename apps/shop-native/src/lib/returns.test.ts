import type { MyOrderReturn } from "@yuntera/db";
import { describe, expect, it } from "vitest";
import { returnNextStep, returnTitle, WITHDRAWAL_APPROVED } from "./returns";

const base: MyOrderReturn = {
  id: "11111111-1111-4111-8111-111111111111",
  order_item_id: "22222222-2222-4222-8222-222222222222",
  kind: "withdrawal",
  status: "approved",
  quantity: 1,
  refund_minor: null,
  resolution_note: null,
  created_at: "2026-11-20T10:00:00Z",
  received_at: null,
  resolved_at: null,
};

describe("where a return stands", () => {
  it("promises the refund only once the goods are back at the warehouse", () => {
    expect(returnNextStep(base)).toMatch(/recoger el producto/);
    expect(returnNextStep(base)).toMatch(/cuando llegue a nuestra bodega le reembolsamos/);
    expect(WITHDRAWAL_APPROVED).toMatch(/cuando llegue a nuestra bodega le reembolsamos/);
    expect(WITHDRAWAL_APPROVED).not.toMatch(/8 días/);
    expect(returnNextStep({ ...base, status: "received" })).toMatch(/Ya recibimos el producto/);
  });

  it("says what was refunded, and why a closed one was closed", () => {
    expect(returnNextStep({ ...base, status: "refunded", refund_minor: 1_250_000 })).toMatch(
      /^Reembolsada: le devolvimos ₡\s?12[\s.]?500 por el mismo medio de pago\.$/,
    );
    expect(returnNextStep({ ...base, status: "rejected", resolution_note: "Llegó usado." })).toBe(
      "Cerrada: Llegó usado.",
    );
  });

  it("names the kind and the units", () => {
    expect(returnTitle(base)).toBe("Devolución de 1 unidad");
    expect(returnTitle({ ...base, kind: "warranty", quantity: 2 })).toBe("Garantía de 2 unidades");
  });
});
