/**
 * Every status the database knows has a word (design system §4.3).
 *
 * Reads the enums (`create type … as enum`) and the `check (status in (…))`
 * lists of supabase/migrations, as files (no database needed), and the
 * status lists of lifecycle.ts, and fails when a value has no word or a word
 * names a value the database does not have. Then checks every row of the
 * §4.3 table (docs/brand/system/migration.json) against the module, word for
 * word, in Spanish and English.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ORDER_PROGRESS, ORDER_STATUS_LABEL, ORDER_STATUSES, SHIPMENT_STATUSES } from "./lifecycle";
import {
  DERIVED_STATUS_WORDS,
  STATUS_KINDS,
  STATUS_SIGN_GLYPH,
  STATUS_VIEWERS,
  STATUS_WORDS,
  type StatusKind,
  type StatusTone,
  type StatusWordOptions,
  statusValues,
  statusWord,
  statusWordOf,
} from "./status-words";

const MIGRATIONS = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const SPEC = fileURLToPath(new URL("../../../docs/brand/system/migration.json", import.meta.url));

/** The quoted words of a SQL list: `'a', 'b'` → ["a", "b"]. */
const quoted = (list: string) => [...list.matchAll(/'([^']*)'/g)].map((m) => m[1] as string);

/** Reads every migration in order; later definitions of a column replace earlier ones. */
function readDatabase() {
  const enums = new Map<string, string[]>();
  const checks = new Map<string, string[]>();
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = readFileSync(`${MIGRATIONS}${file}`, "utf8").replace(/--[^\n]*/g, "");
    for (const m of sql.matchAll(
      /create\s+type\s+(?:public\.)?(\w+)\s+as\s+enum\s*\(([^)]*)\)/gi,
    )) {
      enums.set(m[1] as string, quoted(m[2] as string));
    }
    for (const m of sql.matchAll(
      /alter\s+type\s+(?:public\.)?(\w+)\s+add\s+value\s+(?:if\s+not\s+exists\s+)?'([^']*)'/gi,
    )) {
      enums.get(m[1] as string)?.push(m[2] as string);
    }
    let table: string | null = null;
    const pattern =
      /create\s+table\s+(?:if\s+not\s+exists\s+)?([\w.]+)|alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?([\w.]+)|check\s*\(\s*(\w*(?:status|state))\s+in\s*\(([^)]*)\)/gi;
    for (const m of sql.matchAll(pattern)) {
      if (m[1] || m[2]) table = (m[1] ?? m[2]) as string;
      else if (table) checks.set(`${table}.${m[3]}`, quoted(m[4] as string));
    }
  }
  const statusEnums = new Map([...enums].filter(([name]) => name.endsWith("_status")));
  return { enums: statusEnums, checks };
}

const db = readDatabase();

/**
 * Check lists that only narrow a column whose type is already a status enum
 * (routes: a draft or cancelled route may have no driver). Their values must
 * be values of that enum.
 */
const NARROWING_CHECKS: Record<string, string> = { "public.routes.status": "route_status" };

const sorted = (values: readonly string[]) => [...values].sort();

describe("every status of the database has a word", () => {
  it("finds the status enums and check lists in the migrations", () => {
    // Guards the reader itself: if a pattern stopped matching, nothing would be checked.
    expect(db.enums.size).toBeGreaterThanOrEqual(16);
    expect(db.checks.size).toBeGreaterThanOrEqual(17);
    expect(db.enums.get("order_status")).toContain("partially_shipped");
    expect(db.checks.get("private.notification_deliveries.status")).toContain("dead");
  });

  it.each([...db.enums.keys()])("enum %s", (name) => {
    const kind = STATUS_KINDS.find((k) => {
      const source = STATUS_WORDS[k].source;
      return "enum" in source && source.enum === name;
    });
    expect(kind, `no kind in status-words.ts reads the enum ${name}`).toBeDefined();
    expect(sorted(statusValues(kind as StatusKind))).toEqual(sorted(db.enums.get(name) ?? []));
  });

  it.each([...db.checks.keys()])("check list %s", (key) => {
    const values = db.checks.get(key) ?? [];
    const narrowed = NARROWING_CHECKS[key];
    if (narrowed) {
      const kind = STATUS_KINDS.find((k) => {
        const source = STATUS_WORDS[k].source;
        return "enum" in source && source.enum === narrowed;
      }) as StatusKind;
      for (const value of values) expect(statusValues(kind)).toContain(value);
      return;
    }
    const kind = STATUS_KINDS.find((k) => {
      const source = STATUS_WORDS[k].source;
      return "table" in source && `${source.table}.${source.column}` === key;
    });
    expect(kind, `no kind in status-words.ts reads ${key}`).toBeDefined();
    expect(sorted(statusValues(kind as StatusKind))).toEqual(sorted(values));
  });

  it("every kind read from the database still exists there", () => {
    for (const kind of STATUS_KINDS) {
      const source = STATUS_WORDS[kind].source;
      if ("enum" in source) expect(db.enums.has(source.enum), kind).toBe(true);
      if ("table" in source)
        expect(db.checks.has(`${source.table}.${source.column}`), kind).toBe(true);
    }
  });

  it("agrees with the status lists of lifecycle.ts", () => {
    expect(statusValues("order_status")).toEqual([...ORDER_STATUSES]);
    expect(statusValues("shipment_status")).toEqual([...SHIPMENT_STATUSES]);
    for (const status of ORDER_PROGRESS) expect(statusValues("order_status")).toContain(status);
  });

  it("gives every value a word in both languages for every viewer", () => {
    for (const kind of STATUS_KINDS) {
      for (const value of statusValues(kind)) {
        for (const viewer of STATUS_VIEWERS) {
          for (const locale of ["es", "en"] as const) {
            const w = statusWord(kind, value, { viewer, locale });
            expect(w.word.trim().length, `${kind} ${value} ${viewer} ${locale}`).toBeGreaterThan(0);
            expect(w.glyph).toBe(STATUS_SIGN_GLYPH[w.sign]);
            // Stamps never say a route-line position (§4.3) or show a code.
            expect(["Hecho", "Ahora", "Falta"]).not.toContain(w.word);
            expect(w.word).not.toMatch(/_/);
          }
        }
      }
    }
  });
});

/** §4.3 table, as data. */
interface SpecRow {
  value: string;
  sign: string;
  es: string;
  en: string;
}
const spec = JSON.parse(readFileSync(SPEC, "utf8")) as { statusWords: Record<string, SpecRow[]> };

const TONE_OF_SIGN: Record<string, StatusTone> = {
  "○": "plain",
  "◐": "half",
  "✓ done": "done",
  "✓ ok": "ok",
  "! warn": "warn",
  "! err": "err",
  "–": "ended",
};

/** How each group of the §4.3 table maps onto the module. */
const GROUPS: Record<string, { kind: StatusKind; viewers: StatusWordOptions["viewer"][] }> = {
  "order_status (shopper)": { kind: "order_status", viewers: ["shopper"] },
  "order_status (seller, staff)": { kind: "order_status", viewers: ["seller", "staff"] },
  "shipment_status (seller, staff, driver; shopper where it differs)": {
    kind: "shipment_status",
    viewers: ["seller", "staff", "driver"],
  },
  "derived order flags (packages/core lifecycle.ts; staff only)": {
    kind: "order_flags",
    viewers: ["staff"],
  },
  payment_status: { kind: "payment_status", viewers: ["shopper", "staff"] },
  "return_requests.status": { kind: "return_requests", viewers: ["shopper", "seller", "staff"] },
  "complaints.status": { kind: "complaints", viewers: ["shopper", "staff"] },
  "payouts.status": { kind: "payouts", viewers: ["seller", "staff"] },
  product_status: { kind: "product_status", viewers: ["seller", "staff"] },
  "offer_status (+ derived stock)": { kind: "offer_status", viewers: ["seller", "staff"] },
  "product_photos.state": { kind: "product_photos", viewers: ["seller", "staff"] },
  "invoice_status (Hacienda)": { kind: "invoice_status", viewers: ["seller", "staff"] },
  "inbound_status (+ derived)": { kind: "inbound_status", viewers: ["seller", "warehouse"] },
  review_status: { kind: "review_status", viewers: ["staff"] },
  "stop_status (driver)": { kind: "stop_status", viewers: ["driver"] },
  route_status: { kind: "route_status", viewers: ["driver", "staff"] },
  "seller_invitations.status": { kind: "seller_invitations", viewers: ["seller"] },
  "shop change requests (pending, approved, rejected, withdrawn, replaced)": {
    kind: "seller_change_requests",
    viewers: ["seller", "staff"],
  },
  "messages (notification outbox; staff only)": {
    kind: "notification_deliveries",
    viewers: ["staff"],
  },
  "content_reports.status": { kind: "content_reports", viewers: ["staff"] },
};

/** Rows whose value is a description: the database values and options they stand for. */
const SPECIAL_ROWS: Record<string, { value: string; opts?: Partial<StatusWordOptions> }[]> = {
  isStoppedOrder: [{ value: "stopped" }],
  "waitsForNewAttempt / awaiting another route": [{ value: "awaiting_route" }],
  "needs a person (any of the above, or unpaid at the cut-off)": [{ value: "needs_attention" }],
  "pending (cash on delivery)": [{ value: "pending", opts: { paymentMethod: "cash_on_delivery" } }],
  "pending (SINPE, transfer)": [
    { value: "pending", opts: { paymentMethod: "sinpe_movil" } },
    { value: "pending", opts: { paymentMethod: "bank_transfer" } },
  ],
  "active with stock 0": [{ value: "active", opts: { stock: 0 } }],
  "received with a difference": [{ value: "received", opts: { hasDifference: true } }],
  "code locked (pin_attempts_left 0)": [
    { value: "pending", opts: { pinAttemptsLeft: 0 } },
    { value: "arrived", opts: { pinAttemptsLeft: 0 } },
  ],
  "pending past expires_at": [{ value: "pending", opts: { expired: true } }],
  "pending, sending": [{ value: "pending" }, { value: "sending" }],
  "skipped, expired": [{ value: "skipped" }, { value: "expired" }],
};

describe("the words are the words of §4.3, character by character", () => {
  it("maps every group of the table", () => {
    expect(Object.keys(spec.statusWords).sort()).toEqual(Object.keys(GROUPS).sort());
  });

  for (const [group, rows] of Object.entries(spec.statusWords)) {
    it(group, () => {
      const map = GROUPS[group];
      expect(map).toBeDefined();
      if (!map) return;
      for (const row of rows) {
        const calls = SPECIAL_ROWS[row.value] ?? [{ value: row.value }];
        let es = row.es;
        let en = row.en;
        let shopperEs: string | null = null;
        let shopperEn: string | null = null;
        // «Empacado (shopper: Preparando)»: the word, and the shopper's.
        const shopper = /^(.*) \(shopper: (.*)\)$/;
        const ms = shopper.exec(es);
        const me = shopper.exec(en);
        if (ms && me) {
          es = ms[1] as string;
          shopperEs = ms[2] as string;
          en = me[1] as string;
          shopperEn = me[2] as string;
        }
        // «No se pudo entregar; with attempt_count 0 …: Reprogramado (◐)».
        if (es.includes("; with attempt_count 0")) {
          es = es.split(";")[0] as string;
          en = en.split(";")[0] as string;
          const r = statusWord("shipment_status", "delivery_failed", {
            viewer: "staff",
            attemptCount: 0,
          });
          expect([r.word, r.tone]).toEqual(["Reprogramado", "half"]);
          expect(
            statusWord("shipment_status", "delivery_failed", {
              viewer: "shopper",
              attemptCount: 0,
              locale: "en",
            }).word,
          ).toBe("Rescheduled");
          expect(
            statusWord("shipment_status", "delivery_failed", { viewer: "staff", attemptCount: 1 })
              .word,
          ).toBe("No se pudo entregar");
        }
        // «Rechazada (the reason follows in a sentence)»: an English note, not a word.
        es = es.replace(/ \(the reason follows in a sentence\)$/, "");
        for (const call of calls) {
          for (const viewer of map.viewers) {
            const opts = { viewer, ...call.opts } as StatusWordOptions;
            const where = `${group} ${row.value} ${viewer}`;
            const kind = map.kind;
            const value = call.value as never;
            expect(statusWord(kind, value, { ...opts, locale: "es" }).word, where).toBe(es);
            expect(statusWord(kind, value, { ...opts, locale: "en" }).word, where).toBe(en);
            expect(statusWord(kind, value, opts).tone, where).toBe(TONE_OF_SIGN[row.sign]);
          }
          if (shopperEs && shopperEn) {
            const value = call.value as never;
            const opts = { viewer: "shopper" } as const;
            expect(statusWord(map.kind, value, { ...opts, locale: "es" }).word).toBe(shopperEs);
            expect(statusWord(map.kind, value, { ...opts, locale: "en" }).word).toBe(shopperEn);
          }
        }
      }
    });
  }
});

describe("statusWord", () => {
  it("returns the sign, the tone, the glyph and the word", () => {
    expect(statusWord("shipment_status", "packed", { viewer: "shopper" })).toEqual({
      sign: "in_progress",
      tone: "half",
      glyph: "◐",
      word: "Preparando",
    });
    expect(statusWord("order_status", "confirmed", { viewer: "shopper", locale: "en" })).toEqual({
      sign: "done",
      tone: "done",
      glyph: "✓",
      word: "Order confirmed",
    });
    expect(statusWord("payouts", "failed", { viewer: "seller" })).toEqual({
      sign: "attention",
      tone: "err",
      glyph: "!",
      word: "No se pudo transferir",
    });
  });

  it("reads es-CR as Spanish and defaults to Spanish", () => {
    expect(statusWord("order_status", "shipped", { viewer: "shopper", locale: "es-CR" }).word).toBe(
      "En camino",
    );
    expect(statusWord("order_status", "processing", { viewer: "seller" }).word).toBe("Preparando");
  });

  it("gives the driver and the warehouse the work-tool words of an order", () => {
    for (const viewer of ["driver", "warehouse"] as const) {
      expect(statusWord("order_status", "confirmed", { viewer }).word).toBe("Por preparar");
      expect(statusWord("shipment_status", "packed", { viewer }).word).toBe("Empacado");
    }
  });

  it("applies a derived word only to its own case", () => {
    expect(statusWord("offer_status", "active", { viewer: "seller", stock: 3 }).word).toBe(
      "A la venta",
    );
    expect(statusWord("offer_status", "paused", { viewer: "seller", stock: 0 }).word).toBe(
      "En pausa",
    );
    expect(
      statusWord("stop_status", "delivered", { viewer: "driver", pinAttemptsLeft: 0 }).word,
    ).toBe("Entregado");
    expect(
      statusWord("payment_status", "pending", { viewer: "staff", paymentMethod: "card" }).word,
    ).toBe("Esperando el pago");
    expect(Object.keys(DERIVED_STATUS_WORDS)).toHaveLength(6);
  });

  it("statusWordOf takes a value read at run time and answers null for an unknown one", () => {
    expect(statusWordOf("order_status", "shipped", { viewer: "staff" })?.word).toBe("En camino");
    expect(statusWordOf("order_status", "lost_at_sea", { viewer: "staff" })).toBeNull();
    expect(statusWordOf("order_status", "toString", { viewer: "staff" })).toBeNull();
  });

  it("leaves today's ORDER_STATUS_LABEL untouched (screens still read it)", () => {
    expect(ORDER_STATUS_LABEL.completed["es-CR"]).toBe("Completado");
    expect(ORDER_STATUS_LABEL.payment_review.en).toBe("Verifying payment");
  });
});
