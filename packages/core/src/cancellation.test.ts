import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CANCEL_REASON,
  cancellationWords,
  cancelReasonKind,
} from "./cancellation";

const MIGRATIONS = fileURLToPath(
  new URL("../../../supabase/migrations/", import.meta.url),
);
const SQL = readdirSync(MIGRATIONS)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(`${MIGRATIONS}${file}`, "utf8"))
  .join("\n");

describe("the reasons the database writes on a cancelled order", () => {
  it("are written in SQL exactly as here", () => {
    // The sweep and the return write them; the shopper's apps send the third.
    expect(SQL).toContain(
      `cancel_order_internal(v_order, '${CANCEL_REASON.unpaid}')`,
    );
    expect(SQL).toContain(`cancel_reason = '${CANCEL_REASON.returned}'`);
    expect(SQL).toContain(`'${CANCEL_REASON.shopper}'`);
  });

  it("are recognised, with surrounding spaces, and anything else is staff's own note", () => {
    expect(cancelReasonKind("Pago no recibido a tiempo")).toBe("unpaid");
    expect(cancelReasonKind(" Los paquetes regresaron sin entregarse ")).toBe(
      "returned",
    );
    expect(cancelReasonKind("Cancelado por el cliente")).toBe("shopper");
    expect(cancelReasonKind("El cliente llamó para cancelar")).toBe("other");
    expect(cancelReasonKind(null)).toBe("other");
    expect(cancelReasonKind(undefined)).toBe("other");
  });
});

describe("cancellationWords", () => {
  it("says why the sweep cancelled it, that nothing was charged and to order again", () => {
    const words = cancellationWords(CANCEL_REASON.unpaid, false);
    expect(words.title).toBe(
      "Cancelamos su pedido porque no recibimos el pago a tiempo",
    );
    expect(words.body).toContain("No se le cobró nada.");
    expect(words.body).toContain("haga el pedido de nuevo");
    expect(words.history).toBe("Cancelado: no recibimos el pago a tiempo");
  });

  it("says a payment that arrived late goes back", () => {
    expect(cancellationWords(CANCEL_REASON.unpaid, true).body).toContain(
      "Si su pago llegó después, se lo devolvemos",
    );
  });

  it("says the parcels came back, and where the money goes", () => {
    const paid = cancellationWords(CANCEL_REASON.returned, true);
    expect(paid.title).toContain("regresaron sin entregarse");
    expect(paid.body).toContain(
      "Le devolvemos lo que pagó por el mismo medio con que pagó.",
    );
    expect(cancellationWords(CANCEL_REASON.returned, false).body).toContain(
      "No se le cobró nada.",
    );
  });

  it("says only the products' money comes back when the delivery fee stays, and says it once", () => {
    const feeKept =
      "El envío (₡1 500) no se devuelve porque fuimos a entregarlo a su dirección.";
    const words = cancellationWords(CANCEL_REASON.returned, true, feeKept);
    expect(words.body).toContain(
      "Le devolvemos lo que pagó por los productos por el mismo medio con que pagó.",
    );
    expect(words.body).not.toContain(
      "Le devolvemos lo que pagó por el mismo medio",
    );
    expect(words.body.split(feeKept).length - 1).toBe(1);
    expect(words.body).toContain("haga el pedido de nuevo");
    // Nothing paid: nothing to say about the fee.
    expect(
      cancellationWords(CANCEL_REASON.returned, false, feeKept).body,
    ).not.toContain("El envío");
  });

  it("tells the shopper they cancelled it", () => {
    const words = cancellationWords(CANCEL_REASON.shopper, false);
    expect(words.title).toBe("Usted canceló este pedido");
    expect(words.history).toBe("Cancelado por usted");
  });

  it("never shows staff's own note", () => {
    const note = "Cliente pidió cancelar por teléfono, ver caso 4411";
    const words = cancellationWords(note, true);
    expect(words.title).toBe("Cancelamos este pedido");
    expect(`${words.title} ${words.body} ${words.history}`).not.toContain(
      "4411",
    );
    expect(words.body).toContain("Ayuda");
  });

  it("speaks to the shopper as usted, with no codes", () => {
    for (const reason of [...Object.values(CANCEL_REASON), "otra cosa", null]) {
      for (const paid of [true, false]) {
        const all = Object.values(cancellationWords(reason, paid)).join(" ");
        expect(all).not.toMatch(/\b(tú|tu|vos|te)\b/i);
        expect(all).not.toMatch(/[a-z]+_[a-z]+/);
      }
    }
  });
});
