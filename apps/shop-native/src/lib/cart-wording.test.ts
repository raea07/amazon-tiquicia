import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { arrivalText, unavailableFooter, unavailableNote } from "./cart-wording";

/** The website's cart page, whose words the app's cart repeats. */
const webCart = readFileSync(join(__dirname, "../../../web/src/app/carrito/page.tsx"), "utf8");
const flat = (text: string) => text.replace(/\s+/g, " ");

const alternative = {
  title: "Audífonos inalámbricos Nimbo Aire",
  variant_name: "",
  seller_name: "TecnoCasa",
  price_minor: 1_990_000,
  available: 10,
};

describe("a cart line that can no longer be bought", () => {
  it("names the shop whose offer ran out, who else sells it and for how much", () => {
    const note = unavailableNote(
      { title: "Audífonos", seller_name: "Tienda Sendero", available: 0 },
      alternative,
      2,
    );
    expect(note.title).toBe("Audífonos inalámbricos Nimbo Aire");
    expect(note.body.replace(/\s/g, " ")).toBe(
      "La oferta de Tienda Sendero se agotó. TecnoCasa lo vende a ₡19 900.",
    );
    expect(note.swapLabel).toBe("Cambiar a la oferta de TecnoCasa");
  });

  it("says when the offer is no longer on sale rather than sold out, and how few are left", () => {
    const note = unavailableNote(
      { title: "Camiseta", seller_name: "Tienda Sendero", available: 4 },
      { ...alternative, variant_name: "Talla M", available: 2 },
      3,
    );
    expect(note.title).toBe("Audífonos inalámbricos Nimbo Aire, Talla M");
    expect(note.body).toMatch(/^La oferta de Tienda Sendero ya no está a la venta\. /);
    expect(note.body).toMatch(/ \(le quedan 2\)\.$/);
  });

  it("says plainly that nobody sells it when there is no other offer", () => {
    expect(
      unavailableNote({ title: "Hamaca", seller_name: "Tienda Sendero", available: 0 }, null, 1),
    ).toEqual({
      title: "Hamaca",
      body: "La oferta de Tienda Sendero ya no está disponible y ninguna otra tienda lo vende ahora. Quítelo para continuar con su compra.",
    });
    expect(unavailableNote({ title: null, seller_name: null, available: 0 }, null, 1)).toEqual({
      title: "Producto no disponible",
      body: "Ya no está disponible y ninguna otra tienda lo vende ahora. Quítelo para continuar con su compra.",
    });
  });

  it("uses the website's words", () => {
    const web = flat(webCart);
    for (const phrase of [
      "y ninguna otra tienda lo vende ahora. Quítelo para continuar con su compra.",
      "se agotó.",
      "ya no está a la venta.",
      "La oferta que eligió ya no está a la venta.",
      "lo vende a",
      "(le quedan",
      "Cambiar a la oferta de",
      unavailableFooter(true),
      unavailableFooter(false),
    ]) {
      expect(web, phrase).toContain(phrase);
    }
  });
});

describe("the delivery date of another shop's offer", () => {
  const day = (value: string) => `día ${value.slice(8)}`;
  it("is one day, or a range, as on the product page", () => {
    expect(arrivalText({ earliest: "2026-11-25", latest: "2026-11-25" }, day)).toBe(
      "Llega el día 25",
    );
    expect(arrivalText({ earliest: "2026-11-25", latest: "2026-11-27" }, day)).toBe(
      "Llega entre el día 25 y el día 27",
    );
  });
});
