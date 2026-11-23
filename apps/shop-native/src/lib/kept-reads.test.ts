import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { settledTotal } from "./brand-filter";
import { unavailableFooter, unavailableNote } from "./cart-wording";
import {
  AMOUNT_UNREAD,
  firstReadFailed,
  KEPT,
  PAYMENT_UNREAD,
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

  it("do not ask for a product page per cart alternative", () => {
    const cart = readFileSync(join(app, "components/cart-alternative.tsx"), "utf8");
    expect(cart).not.toMatch(/getProduct\(/);
  });
});
