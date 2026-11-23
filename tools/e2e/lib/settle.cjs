// Waiting for the state a step asserts, instead of reading the screen once.
//
// A text that changes when data arrives (a count, a total, a summary) can be
// read a moment too early: the element is there, its words are not final yet.
// `settledText` reads it again until it says what the step expects, for a
// bounded time, and when the time runs out it fails with the last text seen,
// so the report shows what the screen said instead of a bare "false".
//
// Used by the web journeys (tools/e2e) and the native ones (tools/native-e2e).

const squash = (text) => text.replace(/\s+/g, " ").trim();

const describe = (wanted) =>
  typeof wanted === "string"
    ? `"${wanted}"`
    : wanted instanceof RegExp
      ? String(wanted)
      : wanted.name || "the expected text";

/**
 * Resolves with the locator's text (white space squashed) once it matches
 * `wanted`: an exact string, a RegExp, or a predicate over the text. Throws
 * after `timeout` ms with the last text seen.
 */
async function settledText(locator, wanted, { timeout = 15_000, what = "the text" } = {}) {
  const matches =
    typeof wanted === "string"
      ? (text) => text === wanted
      : wanted instanceof RegExp
        ? (text) => wanted.test(text)
        : wanted;
  const deadline = Date.now() + timeout;
  let last = "(not on screen)";
  for (;;) {
    let read = false;
    try {
      last = squash(await locator.innerText({ timeout: 1_000 }));
      read = true;
    } catch {
      last = "(not on screen)";
    }
    // Only a text actually read can match: a missing element never passes.
    if (read && matches(last)) return last;
    if (Date.now() >= deadline) {
      throw new Error(
        `${what}: waited ${timeout} ms for ${describe(wanted)}; the screen last said "${last.slice(0, 400)}"`,
      );
    }
    // Poll, not sleep: the loop ends as soon as the text matches.
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

module.exports = { settledText, squash };
