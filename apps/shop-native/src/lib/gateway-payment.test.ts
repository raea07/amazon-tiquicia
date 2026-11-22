import type { OrderPayment } from "@yuntera/db";
import { describe, expect, it } from "vitest";
import { attemptsLeftText, browserOutcome, moneyInReviewText } from "./gateway-payment";

describe("leaving the gateway's page", () => {
  it("is a return only through the gateway's link back with pago=retorno", () => {
    expect(
      browserOutcome({ type: "success", url: "yuntera://pedidos/YT-100018?pago=retorno" }),
    ).toBe("returned");
  });

  it("is backing out when the browser is closed, dismissed or the cancel link is used", () => {
    expect(browserOutcome({ type: "cancel" })).toBe("backed_out");
    expect(browserOutcome({ type: "dismiss" })).toBe("backed_out");
    expect(
      browserOutcome({ type: "success", url: "yuntera://pedidos/YT-100018?pago=cancelado" }),
    ).toBe("backed_out");
    expect(browserOutcome({ type: "success", url: "yuntera://pedidos/YT-100018" })).toBe(
      "backed_out",
    );
    expect(browserOutcome({ type: "success" })).toBe("backed_out");
  });
});

const payment = (review: OrderPayment["money_in_review"]) =>
  ({ amount_minor: 2750000, money_in_review: review }) as OrderPayment;

describe("money that arrived but was not applied", () => {
  const base = { amount_minor: 2750000, currency: "CRC", created_at: "2026-11-21T10:00:00Z" };

  it("says a late payment was received, and not to pay again", () => {
    const { text } = moneyInReviewText(payment({ ...base, kind: "late", status: "open" }));
    expect(text).toContain("cuando el pedido ya se había cancelado");
    expect(text).toContain("No vuelva a pagar");
    expect(text).toMatch(/₡\s?27\s?500/);
  });

  it("follows the money back", () => {
    expect(
      moneyInReviewText(payment({ ...base, kind: "paid_twice", status: "refunding" })).title,
    ).toMatch(/^Le estamos devolviendo/);
    expect(
      moneyInReviewText(payment({ ...base, kind: "paid_twice", status: "refunded" })).title,
    ).toMatch(/^Le devolvimos/);
  });

  it("never shows a code", () => {
    for (const kind of ["amount_mismatch", "wrong_environment", "unknown_reference"] as const) {
      const { title, text } = moneyInReviewText(payment({ ...base, kind, status: "open" }));
      expect(`${title} ${text}`).not.toMatch(/_/);
    }
  });
});

describe("attempts left", () => {
  it("uses the singular for one", () => {
    expect(attemptsLeftText(1)).toBe("Le queda 1 intento.");
    expect(attemptsLeftText(3)).toBe("Le quedan 3 intentos.");
  });
});
