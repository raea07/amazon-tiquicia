// Checks tools/e2e/lib/words.cjs: every status word comes from
// packages/core/src/status-words.ts, and SCREEN_ONLY holds only words core
// has no state for.
//
//   node tools/e2e/check-words.cjs
//
// Exits 1 on any problem, and says which.

const words = require("./lib/words.cjs");

const problems = [];

// A call that names no viewer must throw: §4.3 words some states per viewer.
try {
  words.word("order_status", "confirmed");
  problems.push("word() without a viewer did not throw");
} catch {}
// An unknown state must throw, not read as undefined.
try {
  words.word("order_status", "no_such_state", { viewer: "shopper" });
  problems.push("word() for an unknown state did not throw");
} catch {}

const core = words.loadCore();
// Core's words reach the journeys unchanged.
for (const [kind, value, viewer] of [
  ["order_status", "confirmed", "staff"],
  ["order_status", "confirmed", "shopper"],
  ["shipment_status", "returning", "staff"],
  ["stop_status", "skipped", "driver"],
]) {
  const expected = core.statusWord(kind, value, { viewer, locale: "es" }).word;
  if (words.word(kind, value, { viewer }) !== expected) {
    problems.push(`${kind}.${value} (${viewer}) is not core's word «${expected}»`);
  }
}
// Every entry of SCREEN_ONLY gives a word to every viewer it is read by, and
// names a kind core does not have.
for (const [kind, values] of Object.entries(words.SCREEN_ONLY)) {
  if (core.STATUS_WORDS[kind]) problems.push(`${kind} is in core now: move it out of SCREEN_ONLY`);
  for (const [value, entry] of Object.entries(values)) {
    const viewers = typeof entry === "string" || "_" in entry ? words.VIEWERS : Object.keys(entry);
    for (const viewer of viewers) {
      if (!words.VIEWERS.includes(viewer))
        problems.push(`${kind}.${value}: unknown viewer ${viewer}`);
      else if (typeof words.word(kind, value, { viewer }) !== "string")
        problems.push(`${kind}.${value} (${viewer}) has no word`);
    }
  }
}

if (problems.length > 0) {
  console.error(problems.map((p) => `  ${p}`).join("\n"));
  process.exit(1);
}
console.log("status words: fine");
