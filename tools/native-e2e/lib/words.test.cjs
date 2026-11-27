// node --test tools/native-e2e/lib/words.test.cjs
// words.cjs gives today's words now, and after the switch to packages/core it
// still gives a word for every kind and viewer the journeys use.

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { TODAY, makeWord, word } = require("./words.cjs");

/** Every (kind, viewer, value, word) of today's table. */
const entries = Object.entries(TODAY).flatMap(([kind, viewers]) =>
  Object.entries(viewers).flatMap(([viewer, values]) =>
    Object.entries(values).map(([value, text]) => ({ kind, viewer, value, text })),
  ),
);

// A stand-in for core's statusWord, shaped like the real one: it holds only
// database statuses, throws a TypeError for a kind it does not know and a
// RangeError for a value it does not know, and has no "warehouse" words.
const CORE_WORDS = {
  order_status: { shopper: { shipped: "En camino (core)" } },
  stop_status: { driver: { arrived: "En la puerta (core)" } },
  product_status: { seller: { draft: "Borrador (core)" } },
  shipment_status: { staff: { packed: "Empacado (core)" } },
};
const fakeCore = {
  statusWord(kind, value, { viewer }) {
    const words = CORE_WORDS[kind];
    if (!words) throw new TypeError(`unknown kind ${kind}`);
    const found = words[viewer]?.[value];
    if (!found) throw new RangeError(`No word for ${kind} ${value}`);
    return { sign: "done", word: found };
  },
};

test("today, every word comes from the table", () => {
  assert.ok(entries.length > 0);
  for (const { kind, viewer, value, text } of entries) {
    assert.equal(word(kind, value, viewer), text, `${kind} ${value} (${viewer})`);
  }
});

test("after the switch, core's word wins where core has one", () => {
  const switched = makeWord(fakeCore);
  assert.equal(switched("order_status", "shipped", "shopper"), "En camino (core)");
  assert.equal(switched("stop_status", "arrived", "driver"), "En la puerta (core)");
  assert.equal(switched("product_status", "draft", "seller"), "Borrador (core)");
});

test("after the switch, every kind and viewer core lacks still has today's word", () => {
  const switched = makeWord(fakeCore);
  for (const { kind, viewer, value, text } of entries) {
    if (CORE_WORDS[kind]?.[viewer]?.[value]) continue;
    assert.equal(switched(kind, value, viewer), text, `${kind} ${value} (${viewer})`);
  }
  // The four kinds that are not database statuses, and the warehouse viewer.
  assert.equal(switched("order_stopping", "cancels", "shopper"), "Se está cancelando");
  assert.equal(switched("queued_action", "pending", "driver"), "Por enviar");
  assert.equal(switched("listing_edit", "pending", "seller"), "Cambios en revisión");
  assert.equal(switched("variant_status", "retired", "seller"), "Retirada");
  assert.equal(switched("shipment_status", "packed", "warehouse"), "Empacado");
});

test("a core that answers with no word falls back too", () => {
  const empty = makeWord({ statusWord: () => ({ sign: "done", word: "" }) });
  assert.equal(empty("offer_status", "paused", "seller"), "En pausa");
  const nothing = makeWord({ statusWord: () => undefined });
  assert.equal(nothing("offer_status", "paused", "seller"), "En pausa");
});

test("a word neither core nor the table has is an error that names it", () => {
  assert.throws(() => makeWord(fakeCore)("order_status", "lost", "shopper"), /order_status lost/);
  assert.throws(() => word("nothing", "x", "seller"), /nothing x \(seller\)/);
});
