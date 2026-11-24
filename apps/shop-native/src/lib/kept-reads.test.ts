import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { settledTotal } from "./brand-filter";
import { unavailableFooter, unavailableNote } from "./cart-wording";
import {
  AMOUNT_UNREAD,
  firstReadFailed,
  KEPT,
  orderNotice,
  PAYMENT_UNREAD,
  type PaymentRead,
  RETURN_UNREAD,
  refreshFailed,
  TRY_AGAIN,
} from "./kept-reads";

const page = (total: number) => [{ total_count: total }];

describe("a read that fails", () => {
  it("shows the error state when nothing was read yet", () => {
    expect(firstReadFailed({ isError: true, data: undefined })).toBe(true);
    expect(refreshFailed({ isError: true, data: undefined })).toBe(false);
  });

  it("keeps what is on screen when asking again fails, and says so", () => {
    expect(firstReadFailed({ isError: true, data: [] })).toBe(false);
    expect(refreshFailed({ isError: true, data: [] })).toBe(true);
    // A product that does not exist answered null: that answer is kept too.
    expect(refreshFailed({ isError: true, data: null })).toBe(true);
  });

  it("says nothing while all is well, or while loading", () => {
    for (const read of [
      { isError: false, data: undefined },
      { isError: false, data: [1] },
    ]) {
      expect(firstReadFailed(read)).toBe(false);
      expect(refreshFailed(read)).toBe(false);
    }
  });

  it("keeps a listing's count when its refresh failed, never another filter's", () => {
    // Kept: the count of the results still on screen for these same options.
    expect(settledTotal({ isSuccess: false, isError: true, data: { pages: [page(5)] } })).toBe(5);
    // The first search failed: no count.
    expect(settledTotal({ isSuccess: false, isError: true })).toBeNull();
    // Another filter's results standing in: no count, error or not.
    expect(
      settledTotal({
        isSuccess: false,
        isError: true,
        isPlaceholderData: true,
        data: { pages: [page(9)] },
      }),
    ).toBeNull();
    // Still loading: no count.
    expect(settledTotal({ isSuccess: false, isError: false })).toBeNull();
  });
});

describe("the words", () => {
  const all = [
    ...Object.values(KEPT).flatMap((words) => [words.title, words.body]),
    PAYMENT_UNREAD.title,
    PAYMENT_UNREAD.body,
    AMOUNT_UNREAD,
    RETURN_UNREAD,
    TRY_AGAIN,
  ];

  it("say what could not be read, in the usted register, never a code", () => {
    for (const text of all) {
      expect(text, text).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
      expect(text, text).not.toMatch(/\b(tú|tu|puedes|intenta)\b/i);
    }
    for (const words of Object.values(KEPT)) expect(words.title).toMatch(/^No pudimos /);
  });

  it("state no amount of money while the payment cannot be read", () => {
    for (const text of [PAYMENT_UNREAD.title, PAYMENT_UNREAD.body, AMOUNT_UNREAD]) {
      expect(text).not.toMatch(/₡|\d/);
    }
  });

  it("say the retry the way the error state does", () => {
    const kit = readFileSync(
      join(__dirname, "../../../../packages/expo-kit/src/ui/feedback.tsx"),
      "utf8",
    );
    expect(kit).toContain(TRY_AGAIN);
  });
});

describe("the order page's notice", () => {
  const payments: PaymentRead[] = ["ok", "unread", "stale"];
  const every = payments.flatMap((payment) =>
    [false, true].flatMap((orderStale) =>
      [false, true].map((returnsUnread) => ({ orderStale, payment, returnsUnread })),
    ),
  );

  it("is one notice, or none when every read answered", () => {
    expect(orderNotice({ orderStale: false, payment: "ok", returnsUnread: false })).toBeNull();
    for (const reads of every.slice(1)) {
      const notice = orderNotice(reads);
      if (reads.orderStale || reads.payment !== "ok" || reads.returnsUnread) {
        expect(notice, JSON.stringify(reads)).not.toBeNull();
        expect(notice?.title).toMatch(/^No pudimos /);
      }
    }
  });

  it("never says the order is up to date when its refresh failed", () => {
    for (const reads of every.filter((r) => r.orderStale)) {
      const notice = orderNotice(reads);
      expect(`${notice?.title} ${notice?.body}`, JSON.stringify(reads)).not.toContain(
        "sí está al día",
      );
      expect(notice?.title).toContain("actualizar su pedido");
      expect(notice?.testID).toBe("order-kept");
    }
  });

  it("names every read that failed, in one title", () => {
    expect(orderNotice({ orderStale: true, payment: "unread", returnsUnread: false })?.title).toBe(
      "No pudimos actualizar su pedido ni consultar su pago",
    );
    expect(orderNotice({ orderStale: true, payment: "stale", returnsUnread: false })?.title).toBe(
      "No pudimos actualizar su pedido ni su pago",
    );
    expect(orderNotice({ orderStale: true, payment: "stale", returnsUnread: true })?.title).toBe(
      "No pudimos actualizar su pedido, su pago ni consultar sus devoluciones",
    );
    expect(orderNotice({ orderStale: false, payment: "unread", returnsUnread: true })?.title).toBe(
      "No pudimos consultar su pago ni sus devoluciones",
    );
    expect(orderNotice({ orderStale: false, payment: "ok", returnsUnread: true })).toMatchObject({
      title: "No pudimos consultar sus devoluciones",
      body: "Lo demás de su pedido sí está al día. Cómo va su devolución aparece aquí cuando la podamos consultar.",
      cause: "returns",
      testID: "returns-unread",
    });
  });

  it("keeps the words of a single failure", () => {
    expect(
      orderNotice({ orderStale: false, payment: "unread", returnsUnread: false }),
    ).toMatchObject({ ...PAYMENT_UNREAD, testID: "payment-unread", cause: "payment" });
    expect(
      orderNotice({ orderStale: false, payment: "stale", returnsUnread: false }),
    ).toMatchObject({
      ...KEPT.payment,
      testID: "payment-kept",
    });
    expect(orderNotice({ orderStale: true, payment: "ok", returnsUnread: false })).toMatchObject({
      ...KEPT.order,
      testID: "order-kept",
      cause: "order",
    });
  });

  it("states no amount while the payment is unread, in the usted register", () => {
    for (const reads of every) {
      const notice = orderNotice(reads);
      if (!notice) continue;
      const text = `${notice.title} ${notice.body}`;
      expect(text).not.toMatch(/₡|\d/);
      expect(text).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
      expect(text).not.toMatch(/\b(tú|tu|puedes|intenta|deslice)\b/i);
    }
  });
});

describe("a cart line while the other shops are checked", () => {
  const line = { title: "Hamaca", seller_name: "Tienda Sendero", available: 0 };

  it("never says nobody else sells it before the answer", () => {
    const loading = unavailableNote(line, null, 1, "loading");
    expect(loading.body).toBe(
      "La oferta de Tienda Sendero ya no está disponible. Estamos revisando si otra tienda lo vende.",
    );
    expect(loading.body).not.toContain("ninguna otra tienda");
    const failed = unavailableNote(line, null, 1, "failed");
    expect(failed.body).toBe(
      "La oferta de Tienda Sendero ya no está disponible. No pudimos revisar si otra tienda lo vende: inténtelo de nuevo o quítelo para continuar con su compra.",
    );
    expect(failed.body).not.toContain("ninguna otra tienda");
  });

  it("says it once the answer came and nobody does", () => {
    expect(unavailableNote(line, null, 1, "done").body).toContain(
      "y ninguna otra tienda lo vende ahora.",
    );
    expect(unavailableNote(line, null, 1).body).toContain("y ninguna otra tienda lo vende ahora.");
    expect(unavailableFooter(true)).toMatch(/^Cambie o quite/);
  });
});

describe("the screens", () => {
  const app = join(__dirname, "..");
  const files = (dir: string): string[] =>
    readdirSync(join(app, dir), { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? files(join(dir, entry.name))
        : entry.name.endsWith(".tsx")
          ? [join(dir, entry.name)]
          : [],
    );

  it("never replace what they show with the error state when a refresh fails", () => {
    // Each screen asks firstReadFailed (no answer yet) before its error
    // state; a bare `.isError ?` or `if (x.isError)` would hide data on screen.
    const offenders = [...files("app"), ...files("components")].filter((file) =>
      /if \(\w+\.isError\)|\w+\.isError \?/.test(readFileSync(join(app, file), "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("never say a category does not exist because the categories could not be read", () => {
    const category = readFileSync(join(app, "app/c/[slug].tsx"), "utf8");
    const failed = category.indexOf("firstReadFailed(categories)");
    expect(failed).toBeGreaterThan(-1);
    expect(failed).toBeLessThan(category.indexOf("No encontramos esa categoría"));
  });

  it("never leave a failed read with only a pull to ask again", () => {
    const offenders = [...files("app"), ...files("components")].filter((file) =>
      /Deslice hacia abajo/i.test(readFileSync(join(app, file), "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("give up on a read that never answers", () => {
    const layout = readFileSync(join(app, "app/_layout.tsx"), "utf8");
    expect(layout).toMatch(/readTimeoutMs=\{READ_TIMEOUT_MS\}/);
    // The listing reads outside useApiQuery, so it applies the limit itself.
    const listing = readFileSync(join(app, "components/listing.tsx"), "utf8");
    expect(listing).toMatch(/withReadTimeout\(api\.searchProducts/);
  });

  it("do not ask for a product page per cart alternative", () => {
    const cart = readFileSync(join(app, "components/cart-alternative.tsx"), "utf8");
    expect(cart).not.toMatch(/getProduct\(/);
  });
});
