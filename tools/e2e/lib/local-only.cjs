// Loaded before every journey (run.mjs passes it with --require): a journey
// fails when the browser asks anything of a host that is not this machine.
//
// The journeys run the websites as they are built for a lane, with the error
// tracker off (or pointed at the stand-in on this machine) and every provider
// faked, so nothing may leave: not an error report, not a font, not an
// analytics call. Every browser context a journey opens is watched; requests
// to other hosts are listed when the journey ends, and its exit code is then
// 1, whatever the journey itself said.

const playwright = require("playwright");

const LOCAL = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const outside = new Map();

function check(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (!["http:", "https:", "ws:", "wss:"].includes(parsed.protocol)) return;
  if (LOCAL.has(parsed.hostname)) return;
  // Only the host is kept: an address may carry data a journey typed.
  outside.set(parsed.host, (outside.get(parsed.host) ?? 0) + 1);
}

function watchContext(context) {
  context.on("request", (request) => check(request.url()));
  context.on("websocket", (socket) => check(socket.url()));
  return context;
}

function watchBrowser(browser) {
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...args) => watchContext(await newContext(...args));
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...args) => {
    const page = await newPage(...args);
    watchContext(page.context());
    return page;
  };
  return browser;
}

for (const type of [playwright.chromium, playwright.firefox, playwright.webkit]) {
  const launch = type.launch.bind(type);
  type.launch = async (...args) => watchBrowser(await launch(...args));
  const persistent = type.launchPersistentContext.bind(type);
  type.launchPersistentContext = async (...args) => watchContext(await persistent(...args));
}

process.on("exit", () => {
  if (outside.size === 0) return;
  const list = [...outside].map(([host, count]) => `${host} (${count})`).join(", ");
  console.error(`FAILED: the browser made requests to hosts that are not local: ${list}`);
  process.exitCode = 1;
});

module.exports = { check, outside };
