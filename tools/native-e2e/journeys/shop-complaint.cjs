// The shopper app (web export, at phone size): the complaint form and the
// answers (migration 20261121084700_support_cases.sql).
//
//   1. Ayuda gives the promised times of customer-service.md and opens the form.
//   2. The demo shopper opens one of their orders, taps "Presente un reclamo",
//      finds the order's number in the form, is refused an empty choice,
//      files the complaint and reads its reference and the promised dates.
//   3. Support answers it in the console (here through the API, as the
//      administrator); the shopper reads the answer in "Sus consultas" and on
//      the order's screen, and never the internal note staff wrote.
//
// Fails on any console error, uncaught exception or 5xx.

const { spawnSync } = require("node:child_process");
const { chromium, request } = require("playwright");

const SHOTS = process.env.NATIVE_SHOTS || require("node:os").tmpdir();
const SHOP = process.env.NATIVE_SHOP_URL || "http://127.0.0.1:3010";
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5432/yuntera_local";
const SHOPPER = "comprador@yuntera.example";
const STAFF = "central@yuntera.example";
const log = (...args) => console.log(...args);
const squash = (text) => text.replace(/\s+/g, " ").trim();

function check(condition, message) {
  if (!condition) throw new Error(message);
  log("  ok:", message);
}

function sql(statement) {
  const run = spawnSync(
    "psql",
    [DATABASE_URL, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", statement],
    { encoding: "utf8" },
  );
  if (run.status !== 0) throw new Error(`psql: ${run.stderr}`);
  return run.stdout.trim();
}

async function as(email) {
  const ctx = await request.newContext();
  const token = await ctx.post(`${API}/auth/v1/token?grant_type=password`, {
    headers: { apikey: KEY },
    data: { email, password: PASSWORD },
  });
  const { access_token } = await token.json();
  const rpc = async (fn, args = {}) => {
    const r = await ctx.post(`${API}/rest/v1/rpc/${fn}`, {
      headers: { apikey: KEY, authorization: `Bearer ${access_token}` },
      data: args,
    });
    const body = await r.json().catch(() => null);
    if (r.status() >= 400) throw new Error(`${fn}: ${r.status()} ${JSON.stringify(body)}`);
    return body;
  };
  rpc.dispose = () => ctx.dispose();
  return rpc;
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "es-CR",
    timezoneId: "America/Costa_Rica",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text().slice(0, 300)}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${String(error).slice(0, 300)}`));
  page.on("response", (response) => {
    if (response.status() >= 500) errors.push(`HTTP ${response.status()} ${response.url()}`);
  });
  const visible = (testId) => page.getByTestId(testId).filter({ visible: true }).first();
  const noSideways = async (where) =>
    check(
      (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0,
      `no sideways scrolling at 390 px: ${where}`,
    );
  const orderNumber = sql(`select o.order_number from public.orders o
    join auth.users u on u.id = o.user_id where u.email = '${SHOPPER}'
    order by o.placed_at desc limit 1`);

  // ── 1. Ayuda ──────────────────────────────────────────────────────────────
  await page.goto(`${SHOP}/ingresar?siguiente=%2Fpedidos`, { waitUntil: "networkidle" });
  await visible("sign-in-email").fill(SHOPPER);
  await visible("sign-in-password").fill(PASSWORD);
  await visible("sign-in-submit").click();
  await visible(`order-${orderNumber}`).waitFor();
  await page.goto(`${SHOP}/ayuda`, { waitUntil: "networkidle" });
  const help = squash(await page.locator("body").innerText());
  check(
    help.includes("1 día hábil") &&
      help.includes("5 días hábiles") &&
      !help.includes("2 días hábiles"),
    "Ayuda gives the times of customer-service.md",
  );
  await visible("help-complaint").waitFor();
  check(true, "and a button to the complaint form");

  // ── 2. A complaint from the order's screen ────────────────────────────────
  await page.goto(`${SHOP}/pedidos/${orderNumber}`, { waitUntil: "networkidle" });
  await visible("order-complaint").click();
  await visible("complaint-form").waitFor();
  check(
    (await visible("complaint-order").inputValue()) === orderNumber,
    "the form carries the order's number",
  );
  await visible("complaint-description").fill("La caja llegó abierta y faltaba el manual.");
  await visible("complaint-submit").click();
  check(
    squash(await visible("complaint-message").innerText()) === "Elija de qué trata su reclamo.",
    "a complaint without a choice is refused before anything is sent",
  );
  await visible("complaint-category-delivery").click();
  await noSideways("the complaint form");
  await page.screenshot({ path: `${SHOTS}/native-complaint-1-form.png`, fullPage: true });
  await visible("complaint-submit").click();
  await visible("complaint-cases").waitFor();
  const filed = squash(await visible("complaint-message").innerText());
  log("   filed:", filed);
  const reference = /reclamo ([0-9A-F]{8})/.exec(filed)?.[1] ?? "";
  check(reference.length === 8, `the shopper reads the reference (${reference})`);
  check(
    filed.includes("Este mensaje es la confirmación") &&
      (filed.match(/a más tardar el/g) ?? []).length === 1,
    "the message is the acknowledgement, with the date of the written answer",
  );
  await page.screenshot({ path: `${SHOTS}/native-complaint-2-filed.png`, fullPage: true });

  // ── 3. Support answers; the shopper reads it ──────────────────────────────
  const caseId =
    sql(`select k.id from private.cases k join public.complaints c on c.id = k.complaint_id
    where upper(left(c.id::text, 8)) = '${reference}'`);
  const staff = await as(STAFF);
  await staff("ops_add_case_note", {
    p_case_id: caseId,
    p_body: "Nota interna nativa: revisar con bodega.",
  });
  await staff("ops_answer_case", {
    p_case_id: caseId,
    p_body: "Lamentamos lo del manual. Se lo enviamos por correo hoy mismo.",
    p_close: false,
  });
  await staff.dispose();

  await visible("complaint-cases").click();
  await visible("case-answers").waitFor();
  const mine = squash(await visible("case-answers").innerText());
  check(
    mine.includes(`Reclamo ${reference}`) && mine.includes("Se lo enviamos por correo hoy mismo"),
    "the shopper reads the answer in Sus consultas",
  );
  check(!mine.includes("Nota interna nativa"), "and never the internal note");
  await noSideways("Sus consultas");
  await page.screenshot({ path: `${SHOTS}/native-complaint-3-cases.png`, fullPage: true });

  await page.goto(`${SHOP}/pedidos/${orderNumber}`, { waitUntil: "networkidle" });
  await visible("case-answers").waitFor();
  check(
    squash(await visible("case-answers").innerText()).includes(
      "Se lo enviamos por correo hoy mismo",
    ),
    "and on the order's screen",
  );
  check(
    !squash(await page.locator("body").innerText()).includes("Nota interna nativa"),
    "the order's screen shows no note",
  );
  await noSideways("the order with its answer");
  await page.screenshot({ path: `${SHOTS}/native-complaint-4-order.png`, fullPage: true });

  await browser.close();
  if (errors.length) {
    console.error("ERRORS:", errors);
    process.exit(1);
  }
  log("\nThe shopper app's complaint journey passed.");
})().catch((error) => {
  console.error("FAILED:", String(error.message ?? error).slice(0, 800));
  process.exit(1);
});
