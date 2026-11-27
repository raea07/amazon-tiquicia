import { statusWord } from "@yuntera/core";
import { describe, expect, it } from "vitest";
import { orderLabel, SHIPMENT_STATUS_LABEL } from "./labels";

describe("status words", () => {
  it("are the shopper's words of packages/core for every shipment status", () => {
    for (const [status, label] of Object.entries(SHIPMENT_STATUS_LABEL)) {
      expect(label).toBe(
        statusWord("shipment_status", status as keyof typeof SHIPMENT_STATUS_LABEL, {
          viewer: "shopper",
        }).word,
      );
    }
    expect(SHIPMENT_STATUS_LABEL.packed).toBe("Preparando");
  });

  it("read an order the way the website reads it to the shopper", () => {
    expect(orderLabel("confirmed")).toBe("Pedido confirmado");
    expect(orderLabel("completed")).toBe("Entregado");
  });
});
