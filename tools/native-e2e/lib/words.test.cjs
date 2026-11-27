// node --test tools/native-e2e/lib/words.test.cjs
// words.cjs reads every status word from packages/core, and keeps a word of
// its own only for the four kinds that are not database statuses.

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { TODAY, core, makeWord, word } = require("./words.cjs");

/** Every (kind, viewer, value, word) of the table. */
const entries = Object.entries(TODAY).flatMap(([kind, viewers]) =>
  Object.entries(viewers).flatMap(([viewer, values]) =>
    Object.entries(values).map(([value, text]) => ({ kind, viewer, value, text })),
  ),
);

// A stand-in for core's statusWord, shaped like the real one: it throws a
// TypeError for a kind it does not know and a RangeError for a value.
const CORE_WORDS = {
  order_status: { shopper: { shipped: "En camino (core)" } },
  stop_status: { driver: { arrived: "En la puerta (core)" } },
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

test("the table holds only kinds packages/core does not have", () => {
  assert.deepEqual(Object.keys(TODAY).sort(), [
    "listing_edit",
    "order_stopping",
    "queued_action",
    "variant_status",
  ]);
  for (const kind of Object.keys(TODAY)) {
    assert.ok(!Object.hasOwn(core.STATUS_WORDS, kind), `${kind} is in core: drop it here`);
  }
  for (const { kind, viewer, value, text } of entries) {
    assert.equal(word(kind, value, viewer), text, `${kind} ${value} (${viewer})`);
  }
});

test("every status word the journeys ask for is core's word", () => {
  const asked = [
    ["order_status", "shipped", "shopper"],
    ["shipment_status", "pending", "warehouse"],
    ["shipment_status", "packed", "warehouse"],
    ["stop_status", "arrived", "driver"],
    ["stop_status", "skipped", "driver"],
    ["offer_status", "paused", "seller"],
    ["product_status", "draft", "seller"],
    ["product_status", "active", "seller"],
  ];
  for (const [kind, value, viewer] of asked) {
    assert.equal(word(kind, value, viewer), core.statusWord(kind, value, { viewer }).word);
  }
  assert.equal(word("stop_status", "skipped", "driver"), "Quitada por Central");
  assert.equal(word("shipment_status", "pending", "warehouse"), "Por preparar");
});

test("core's word wins where core has one", () => {
  const switched = makeWord(fakeCore);
  assert.equal(switched("order_status", "shipped", "shopper"), "En camino (core)");
  assert.equal(switched("stop_status", "arrived", "driver"), "En la puerta (core)");
});

test("every kind core lacks still has the table's word", () => {
  const switched = makeWord(fakeCore);
  for (const { kind, viewer, value, text } of entries) {
    assert.equal(switched(kind, value, viewer), text, `${kind} ${value} (${viewer})`);
  }
  assert.equal(switched("order_stopping", "cancels", "shopper"), "Se está cancelando");
  assert.equal(switched("queued_action", "pending", "driver"), "Por enviar");
  assert.equal(switched("listing_edit", "pending", "seller"), "Cambios en revisión");
  assert.equal(switched("variant_status", "retired", "seller"), "Retirada");
});

test("a core that answers with no word falls back too", () => {
  const empty = makeWord({ statusWord: () => ({ sign: "done", word: "" }) });
  assert.equal(empty("queued_action", "pending", "driver"), "Por enviar");
  const nothing = makeWord({ statusWord: () => undefined });
  assert.equal(nothing("queued_action", "pending", "driver"), "Por enviar");
});

test("a word neither core nor the table has is an error that names it", () => {
  assert.throws(() => makeWord(fakeCore)("order_status", "lost", "shopper"), /order_status lost/);
  assert.throws(() => word("nothing", "x", "seller"), /nothing x \(seller\)/);
});
