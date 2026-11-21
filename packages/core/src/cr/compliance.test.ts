import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_FEE_SCHEDULE, splitFixedPaymentFee } from "../fees";
import {
  ORDER_STATUSES,
  ORDER_TRANSITIONS,
  SHIPMENT_STATUSES,
  SHIPMENT_TRANSITIONS,
} from "../lifecycle";
import { boundSearchText, DEFAULT_RANKING, SEARCH_INPUT_LIMITS, TEXT_RELEVANCE } from "../search";
import {
  addBusinessDays,
  CONSUMER_LAW,
  HACIENDA_PAYMENT_CODE,
  legalWarrantyEnds,
  withdrawalDeadline,
} from "./compliance";

const migrationsDir = fileURLToPath(new URL("../../../../supabase/migrations/", import.meta.url));
const migration = (name: string) => readFileSync(`${migrationsDir}${name}`, "utf8");

/** The newest migration that (re)defines a marked block: the rule in force. */
const latestWith = (block: string) => {
  const name = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .filter((file) => migration(file).includes(`-- BEGIN ${block}`))
    .at(-1);
  expect(name, `no migration defines ${block}`).toBeDefined();
  return migration(name ?? "");
};

describe("business days", () => {
  it("skips weekends", () => {
    expect(addBusinessDays("2026-11-27", 1)).toBe("2026-11-30"); // Friday → Monday
    expect(addBusinessDays("2026-11-28", 1)).toBe("2026-11-30"); // Saturday → Monday
    expect(addBusinessDays("2026-11-23", 5)).toBe("2026-11-30"); // Monday + 5
    expect(addBusinessDays("2026-11-23", 0)).toBe("2026-11-23");
  });

  it("skips holidays", () => {
    // Tuesday 1 Dec 2026 is a holiday.
    expect(addBusinessDays("2026-11-30", 1, ["2026-12-01"])).toBe("2026-12-02");
  });

  it("rejects negative or fractional day counts", () => {
    expect(() => addBusinessDays("2026-11-23", -1)).toThrow(RangeError);
    expect(() => addBusinessDays("2026-11-23", 1.5)).toThrow(RangeError);
  });
});

describe("consumer-law periods", () => {
  it("gives eight business days to withdraw, counted from delivery", () => {
    // Delivered Monday 23 Nov 2026 → Thursday 3 Dec (1 Dec is not passed in here).
    expect(withdrawalDeadline("2026-11-23")).toBe("2026-12-03");
    expect(CONSUMER_LAW.withdrawalBusinessDays).toBe(8);
  });

  it("gives thirty business days of legal warranty", () => {
    expect(legalWarrantyEnds("2026-11-23")).toBe("2027-01-04");
  });
});

describe("Hacienda payment codes", () => {
  it("maps every payment method, with SINPE Móvil as 06", () => {
    expect(HACIENDA_PAYMENT_CODE).toEqual({
      cash_on_delivery: "01",
      card: "02",
      bank_transfer: "04",
      sinpe_movil: "06",
    });
  });
});

// ── The database and the clients must agree ─────────────────────────────────
// These tests read the SQL migrations as text, so they run without a database.

function sqlPairs(sql: string, block: string): string[] {
  const start = sql.indexOf(`-- BEGIN ${block}`);
  const end = sql.indexOf(`-- END ${block}`);
  expect(start, `block ${block} not found`).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return [...sql.slice(start, end).matchAll(/\('([a-z_]+)',\s*'([a-z_]+)'\)/g)]
    .map((m) => `${m[1]}>${m[2]}`)
    .sort();
}

const tsPairs = (table: Readonly<Record<string, readonly string[]>>) =>
  Object.entries(table)
    .flatMap(([from, tos]) => tos.map((to) => `${from}>${to}`))
    .sort();

describe("lifecycle rules match the database", () => {
  const foundation = migration("20261121080000_foundation.sql");

  it("allows exactly the same order transitions", () => {
    expect(sqlPairs(latestWith("order_transitions"), "order_transitions")).toEqual(
      tsPairs(ORDER_TRANSITIONS),
    );
  });

  it("allows exactly the same shipment transitions", () => {
    expect(sqlPairs(latestWith("shipment_transitions"), "shipment_transitions")).toEqual(
      tsPairs(SHIPMENT_TRANSITIONS),
    );
  });

  it("declares the same statuses in the same order", () => {
    const enumValues = (name: string) => {
      const match = new RegExp(`create type public\\.${name} as enum \\(([^;]+)\\);`).exec(
        foundation,
      );
      expect(match, `enum ${name} not found`).not.toBeNull();
      return [...(match?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    };
    expect(enumValues("order_status")).toEqual([...ORDER_STATUSES]);
    expect(enumValues("shipment_status")).toEqual([...SHIPMENT_STATUSES]);
  });
});

describe("fee schedule matches the database", () => {
  const finance = migration("20261121080800_finance.sql");

  it("uses the same payment fees", () => {
    for (const [method, bps] of Object.entries(DEFAULT_FEE_SCHEDULE.paymentBpsByMethod)) {
      const fixed =
        DEFAULT_FEE_SCHEDULE.paymentFixedMinorByMethod[
          method as keyof typeof DEFAULT_FEE_SCHEDULE.paymentFixedMinorByMethod
        ];
      expect(finance).toContain(`'${method}', ${bps}, ${fixed})`);
    }
  });

  it("uses the same fulfilment tiers", () => {
    DEFAULT_FEE_SCHEDULE.fulfillmentTiers.forEach((tier, index) => {
      expect(finance).toContain(
        `'${tier.id}', ${tier.maxWeightGrams}, ${tier.maxLongestSideCm}, ${tier.feeMinor}, ${index + 1})`,
      );
    });
  });

  it("uses the same defaults and version", () => {
    expect(finance).toContain(
      `('${DEFAULT_FEE_SCHEDULE.version}', true, ${DEFAULT_FEE_SCHEDULE.defaultReferralBps}, ` +
        `${DEFAULT_FEE_SCHEDULE.minReferralFeePerUnitMinor}, ${DEFAULT_FEE_SCHEDULE.feeTaxBps},`,
    );
  });
});

describe("the fixed payment fee is split the way the database splits it", () => {
  // The database test runs these very lines through private.split_fixed_fee;
  // here the same inputs go through the TypeScript and must give the same parts.
  const suite = readFileSync(
    fileURLToPath(new URL("../../../../supabase/tests/090_fixes.sql", import.meta.url)),
    "utf8",
  );
  const block = /-- BEGIN fixed_fee_split_cases([\s\S]*?)-- END fixed_fee_split_cases/.exec(suite);
  const cases = [
    ...(block?.[1] ?? "").matchAll(/check_split\((\d+), '\{([\d,]*)\}', '\{([\d,]*)\}'\)/g),
  ].map((match) => ({
    fixed: Number(match[1]),
    sales: (match[2] ?? "").split(",").filter(Boolean).map(Number),
    expected: (match[3] ?? "").split(",").filter(Boolean).map(Number),
  }));
  // Both sides name the sellers of a case by position, so ties fall the same way.
  const sellerId = (position: number) => `00000000-0000-4000-8000-00000000000${position}`;

  it("finds the shared cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(8);
    expect(cases.some((c) => c.sales.length >= 3)).toBe(true);
    expect(cases.some((c) => c.fixed > 0 && c.sales.every((sale) => sale === 0))).toBe(true);
  });

  it("gives every seller the same part", () => {
    for (const c of cases) {
      const parts = splitFixedPaymentFee(
        c.fixed,
        c.sales.map((itemsGrossMinor, index) => ({
          sellerId: sellerId(index + 1),
          itemsGrossMinor,
        })),
      );
      expect([...parts.values()], `${c.fixed} over ${c.sales.join(", ")}`).toEqual(c.expected);
      const soldSomething = c.sales.some((sale) => sale > 0);
      expect(c.expected.reduce((a, b) => a + b, 0)).toBe(soldSomething ? c.fixed : 0);
    }
  });

  it("is the function the fee computation calls", () => {
    const fixes = migration("20261121082400_fixes.sql");
    expect(fixes).toContain("from private.split_fixed_fee(coalesce(v_pay.fixed_minor, 0)");
  });
});

describe("search ranking matches the database", () => {
  const search = migration("20261121081200_search.sql");

  it("composes text relevance from the same constants", () => {
    const t = TEXT_RELEVANCE;
    expect(search).toContain(
      `${t.exactFloor} + ${t.rankWeight} * c.rank + ${t.headMatchBonus} * c.head_match::integer ` +
        `+ ${t.categoryMatchBonus} * c.category_match::integer`,
    );
    expect(search).toContain(`${t.fuzzyCeiling} * c.word_similarity`);
    expect(search).toContain(`c.exact_total < ${t.fuzzyFallbackBelow}`);
  });

  it("weights quality with the same numbers", () => {
    const w = DEFAULT_RANKING.weights;
    for (const [signal, weight] of Object.entries(w)) {
      expect(search, `weight for ${signal}`).toContain(`${weight.toFixed(2)} * `);
    }
    expect(search).toContain(`power(s.text_score, ${DEFAULT_RANKING.relevanceExponent})`);
    expect(search).toContain(`else ${DEFAULT_RANKING.outOfStockPenalty} end`);
    expect(search).toContain(`then ${DEFAULT_RANKING.newListingBoost} else 1 end`);
    expect(search).toContain(`interval '${DEFAULT_RANKING.newListingDays} days'`);
  });

  it("bounds what a search box sends the same way", () => {
    const limits = migration("20261121083000_limits.sql");
    const { maxChars, maxWords } = SEARCH_INPUT_LIMITS;
    expect(limits).toContain(
      `(regexp_split_to_array(trim(left(p_text, ${maxChars})), '\\s+'))[1:${maxWords}]`,
    );
    expect(limits).toContain(`search input limits ${maxChars} characters, ${maxWords} words`);
    expect(boundSearchText("a".repeat(500))).toBe("a".repeat(maxChars));
    expect(
      boundSearchText("uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece"),
    ).toBe("uno dos tres cuatro cinco seis siete ocho nueve diez once doce");
    expect(boundSearchText("  licuadora   de  vaso ")).toBe("licuadora de vaso");
    expect(boundSearchText("   ")).toBe("");
  });
});
