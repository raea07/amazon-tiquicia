// Checks tools/e2e/lib/words.cjs, so the switch to core's status words stays
// one line:
//
//   node tools/e2e/check-words.cjs                       the table on its own
//   node tools/e2e/check-words.cjs <status-words.ts>     and against core
//
// Without a path it uses packages/core/src/status-words.ts when that file
// exists. Exits 1 on any problem, and says which.

const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
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
// Every entry of today's table gives a word to every viewer it is read by.
for (const table of [words.TODAY, words.SCREEN_ONLY]) {
  for (const [kind, values] of Object.entries(table)) {
    for (const [value, entry] of Object.entries(values)) {
      const viewers =
        typeof entry === "string" || "_" in entry ? words.VIEWERS : Object.keys(entry);
      for (const viewer of viewers) {
        if (!words.VIEWERS.includes(viewer))
          problems.push(`${kind}.${value}: unknown viewer ${viewer}`);
        else if (typeof words.word(kind, value, { viewer }) !== "string")
          problems.push(`${kind}.${value} (${viewer}) has no word`);
      }
    }
  }
}
for (const kind of Object.keys(words.SCREEN_ONLY)) {
  if (kind in words.TODAY) problems.push(`${kind} is in both TODAY and SCREEN_ONLY`);
}

const corePath = resolve(process.argv[2] ?? `${__dirname}/../../packages/core/src/status-words.ts`);
if (existsSync(corePath)) {
  // Every kind and value of TODAY must have the same name in core, or the
  // switch would read a word for a state that does not exist there.
  const core = words.loadCore(corePath);
  for (const [kind, values] of Object.entries(words.TODAY)) {
    const spec = core.STATUS_WORDS[kind];
    if (!spec) {
      problems.push(`core has no kind ${kind}`);
      continue;
    }
    for (const value of Object.keys(values)) {
      if (!Object.hasOwn(spec.words, value)) problems.push(`core has no ${kind}.${value}`);
    }
  }
  for (const kind of Object.keys(words.SCREEN_ONLY)) {
    if (core.STATUS_WORDS[kind])
      problems.push(`${kind} is in core now: move it out of SCREEN_ONLY`);
  }
  console.log(`compared with ${corePath}`);
} else {
  console.log(`no ${corePath}: checked the table on its own`);
}

if (problems.length > 0) {
  console.error(problems.map((p) => `  ${p}`).join("\n"));
  process.exit(1);
}
console.log("status words: fine");
