// Payouts journey: a seller asks for a new payout account, finance approves it, previews a
// cut-off, creates a run, downloads the list for the bank and records a payment; the seller then
// sees the payout and a smaller balance.
//
// A journey drives the real app in a real browser against a freshly seeded
// database. It fails when a step does not arrive where it should, when the
// browser logs an error, or when any response is a 5xx.

const { chromium, request } = require("playwright");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const SELLER = process.env.SELLER_URL || "http://127.0.0.1:3001";
const OPS = process.env.OPS_URL || "http://127.0.0.1:3002";
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const log = (...a) => console.log(...a);
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, " ").trim();
const expect = (condition, message) => {
  if (!condition) throw new Error("expected: " + message);
};
// The lines of a tile: its label, its value and its hint.
const lines = (tile) =>
  tile
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

const NEW_IBAN = "CR23015108410026012345";
const NEW_IBAN_GROUPED = "CR23 0151 0841 0026 0123 45";
const BANK_REFERENCE = "BNCR-2026-000123";

async function rpcAs(email, fn, args = {}) {
  const ctx = await request.newContext();
  const t = await ctx.post(`${API}/auth/v1/token?grant_type=password`, {
    headers: { apikey: KEY },
    data: { email, password: PASSWORD },
  });
  const { access_token } = await t.json();
  const r = await ctx.post(`${API}/rest/v1/rpc/${fn}`, {
    headers: { apikey: KEY, authorization: `Bearer ${access_token}` },
    data: args,
  });
  const body = r.status() === 204 ? null : await r.json().catch(() => null);
  await ctx.dispose();
  return body;
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (page) => {
    page.on("console", (m) => {
      if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200));
    });
    page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 200)));
    page.on("response", (r) => {
      if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`);
    });
  };
  const signIn = async (page, base, email) => {
    await page.goto(base + "/ingresar", { waitUntil: "networkidle" });
    await page.fill('main input[name="email"]', email);
    await page.fill('main input[name="password"]', PASSWORD);
    await page.click('main form button[type="submit"]');
    await page.waitForURL((u) => new URL(u).pathname === "/");
    await page.waitForSelector("main h1:visible, main h2:visible");
  };
  // The three balances on the seller's money screen, as the text of each tile.
  const balances = async (page) => {
    const tiles = await page
      .locator('main:visible section[aria-labelledby="saldo"] .grid > div')
      .allInnerTexts();
    const amount = (label) => {
      const tile = tiles.find((t) => t.trim().startsWith(label)) || "";
      return lines(tile)[1] || "";
    };
    return {
      available: amount("Disponible"),
      pending: amount("Pendiente"),
      inTransit: amount("En tránsito"),
      owed: await text(page.locator('main:visible section[aria-labelledby="saldo"] > p').first()),
    };
  };

  // 1. The seller, in the shop that has sales old enough to be paid
  const sellerContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "es-CR",
    acceptDownloads: true,
  });
  const seller = await sellerContext.newPage();
  watch(seller);
  await signIn(seller, SELLER, "vendedor@yuntera.example");
  if (!(await text(seller.locator("main h1:visible"))).includes("TecnoCasa")) {
    await seller.selectOption("#shop", { label: "TecnoCasa" });
    await seller.click('header button:has-text("Cambiar")');
    await seller.waitForSelector('main h1:visible:has-text("TecnoCasa")');
  }

  await seller.goto(SELLER + "/pagos", { waitUntil: "networkidle" });
  const before = await balances(seller);
  log("seller balances before:", JSON.stringify(before));
  expect(
    before.available.startsWith("₡") && before.available !== "₡0",
    "TecnoCasa has money available",
  );
  expect(before.inTransit === "₡0", "and nothing in transit yet");
  log(
    "hold explained:",
    (await text(seller.locator('main:visible section[aria-labelledby="cuando"]'))).slice(0, 260),
  );
  log("history:", await text(seller.locator('main:visible section[aria-labelledby="historial"]')));
  await seller.screenshot({ path: SHOTS + "/pa1-seller-balances.png", fullPage: true });

  // 2. The seller asks for a new payout account
  await seller.goto(SELLER + "/cuenta", { waitUntil: "networkidle" });
  const bank = seller.locator('main:visible section:has(h2:has-text("Dónde le pagamos"))');
  log("current account:", (await text(bank.locator("dl").first())).slice(0, 120));
  expect(
    (await text(bank.locator("dl").first())).includes("•••• 6789"),
    "the current account is masked",
  );

  // A wrong digit is caught while typing, before anything is sent.
  await bank.locator('input[name="iban"]').fill("CR23 0151 0841 0026 0123 46");
  await bank.locator('[role="alert"]').waitFor();
  log("wrong digit:", await text(bank.locator('[role="alert"]')));
  expect(
    (await text(bank.locator('[role="alert"]'))).includes("no coinciden"),
    "the form says the digits do not add up",
  );
  await bank.locator('input[name="iban"]').fill("cr23 0151 0841 0026 0123 45");
  await bank.locator(`text=Cuenta válida: ${NEW_IBAN_GROUPED}`).waitFor();
  await bank.locator('input[name="holderName"]').fill("TecnoCasa de Costa Rica S.A.");
  log("SINPE Móvil offered again:", await bank.locator('input[name="sinpe"]').inputValue());
  await seller.screenshot({ path: SHOTS + "/pa2-seller-request-form.png", fullPage: true });
  await bank.locator('button[type="submit"]').click();
  await bank.locator("text=Cambio de cuenta en revisión").waitFor();
  const afterRequest = await text(bank);
  log("after asking:", afterRequest.slice(0, 420));
  expect(afterRequest.includes("•••• 2345"), "the request shows the new account masked");
  expect(afterRequest.includes("•••• 6789"), "and the current account has not changed");
  const sellerPage = await text(seller.locator("main:visible"));
  expect(
    !sellerPage.includes(NEW_IBAN) && !sellerPage.includes(NEW_IBAN_GROUPED),
    "the seller's screen never shows a whole account number",
  );
  await seller.screenshot({ path: SHOTS + "/pa3-seller-request-sent.png", fullPage: true });

  // 3. Finance: the request, with the number to call and the account in full
  const opsContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "es-CR",
    acceptDownloads: true,
  });
  const ops = await opsContext.newPage();
  watch(ops);
  await signIn(ops, OPS, "central@yuntera.example");
  await ops.goto(OPS + "/pagos-vendedores", { waitUntil: "networkidle" });
  const card = ops.locator('main:visible section[aria-labelledby="cuentas"] ul > li').first();
  const cardText = await text(card);
  log("request in finance's queue:", cardText.slice(0, 460));
  expect(cardText.includes("TecnoCasa"), "the request names the shop");
  expect(cardText.includes(NEW_IBAN_GROUPED), "finance sees the requested account in full");
  expect(cardText.includes("•••• 6789"), "and the current one masked");
  expect(cardText.includes("2234-0202"), "with the phone already on file to call");
  await ops.screenshot({ path: SHOTS + "/pa4-ops-request.png", fullPage: true });

  // A rejection has to be explained; what was typed survives the refusal.
  await card.locator('textarea[name="note"]').fill("no");
  await card.locator('button:has-text("Rechazar")').click();
  await card.locator('[role="alert"]').waitFor();
  log("reject without a reason:", await text(card.locator('[role="alert"]')));
  await card.locator('textarea[name="note"]').fill("");
  await card.locator('button:has-text("Aprobar la cuenta nueva")').click();
  await ops.waitForSelector("main:visible >> text=No hay cambios de cuenta por resolver");
  log("approved: the queue is empty");

  // 4. Preview: an earlier cut-off pays less; today's pays three shops
  const preview = ops.locator('main:visible section[aria-labelledby="corte"]');
  const today = await preview.locator('input[name="corte"]').inputValue();
  const earlier = new Date(Date.parse(today + "T00:00:00Z") - 12 * 86400000)
    .toISOString()
    .slice(0, 10);
  await preview.locator('input[name="corte"]').fill(earlier);
  await preview.locator('button:has-text("Ver este corte")').click();
  await ops.waitForURL((u) => new URL(u).searchParams.get("corte") === earlier);
  await ops.waitForSelector('main:visible section[aria-labelledby="corte"] .grid');
  const earlierTotal = lines(await preview.locator(".grid > div").first().innerText())[1];
  await ops.goto(OPS + "/pagos-vendedores", { waitUntil: "networkidle" });
  const todayTiles = await preview.locator(".grid > div").allInnerTexts();
  log(
    "cut-off",
    earlier,
    "would pay",
    earlierTotal,
    "| today:",
    todayTiles.map((t) => t.replace(/\s+/g, " ")).join(" | "),
  );
  expect(
    earlierTotal !== lines(todayTiles[0])[1],
    "an earlier cut-off pays a different (smaller) total",
  );
  const rows = await preview.locator("tbody tr").allInnerTexts();
  for (const row of rows) log("  preview:", row.replace(/\s+/g, " "));
  const tecnoRow = rows.find((row) => row.includes("TecnoCasa")) || "";
  expect(tecnoRow.includes("Se paga"), "TecnoCasa would be paid");
  expect(tecnoRow.includes("•••• 2345"), "to the account finance just approved");
  expect(
    (rows.find((row) => row.includes("Higuer")) || "").includes("Disponible menor al mínimo"),
    "a shop with nothing available is listed with the reason",
  );
  await ops.screenshot({ path: SHOTS + "/pa5-ops-preview.png", fullPage: true });

  // 5. Create the run and open it
  await preview.locator('button:has-text("Crear la corrida de pagos")').click();
  await ops.waitForURL((u) => new URL(u).pathname.startsWith("/pagos-vendedores/corridas/"));
  await ops.waitForSelector('main h1:visible:has-text("Corrida PV-")');
  const runUrl = ops.url();
  const runCode = (await text(ops.locator("main h1:visible"))).replace("Corrida ", "");
  log("run:", runCode, "|", (await text(ops.locator("main:visible .grid").first())).slice(0, 160));
  const payoutCards = ops.locator('main:visible section[aria-labelledby="pagos"] ul > li');
  expect((await payoutCards.count()) === 3, "three shops are paid in this run");
  const tecno = ops.locator(
    'main:visible section[aria-labelledby="pagos"] ul > li:has(h3:has-text("TecnoCasa"))',
  );
  const tecnoText = await text(tecno);
  log("TecnoCasa's payout:", tecnoText.slice(0, 260));
  expect(tecnoText.includes(NEW_IBAN_GROUPED), "the transfer list has the account in full");
  expect(tecnoText.includes(`YUNTERA ${runCode}-`), "and the text for the transfer's description");
  await ops.screenshot({ path: SHOTS + "/pa6-ops-run.png", fullPage: true });

  // 6. The CSV for the bank: a real download, never cached, finance only
  const [download] = await Promise.all([
    ops.waitForEvent("download"),
    ops.click('main:visible a:has-text("Descargar la lista para el banco")'),
  ]);
  log("downloaded file:", download.suggestedFilename());
  expect(
    download.suggestedFilename() === `transferencias-${runCode}.csv`,
    "the file is named after the run",
  );
  // The file itself, as it landed on disk.
  const csv = require("node:fs").readFileSync(await download.path(), "utf8");
  for (const line of csv.trim().split("\r\n")) log("  " + line);
  expect(csv.trim().split("\r\n").length === 4, "a header and one row per transfer");
  expect(
    csv.includes(`"${NEW_IBAN}","TecnoCasa de Costa Rica S.A."`) &&
      csv.includes(`"YUNTERA ${runCode}-`),
    "with TecnoCasa's account, holder and reference",
  );
  // Its headers, asked for again from the signed-in page.
  const fetchList = (page) =>
    page.evaluate(async (url) => {
      const response = await fetch(url, { redirect: "manual" });
      return {
        status: response.status,
        type: response.headers.get("content-type") || "",
        cache: response.headers.get("cache-control") || "",
        body: (await response.text()).slice(0, 400),
      };
    }, runUrl + "/transferencias");
  const asFinance = await fetchList(ops);
  log("csv:", asFinance.status, asFinance.type, "| cache-control:", asFinance.cache);
  expect(asFinance.status === 200 && asFinance.type.startsWith("text/csv"), "finance gets a CSV");
  expect(asFinance.cache.includes("no-store"), "that is never cached");

  // A visitor is sent to sign in; staff who are not finance are refused.
  const anonymous = await request.newContext();
  const asVisitor = await anonymous.get(runUrl + "/transferencias", { maxRedirects: 0 });
  log("csv as a visitor:", asVisitor.status(), asVisitor.headers().location);
  expect(
    asVisitor.status() === 307 && asVisitor.headers().location.startsWith("/ingresar"),
    "visitors must sign in",
  );
  expect(
    (asVisitor.headers()["cache-control"] || "").includes("no-store"),
    "and nothing is cached",
  );
  await anonymous.dispose();
  await rpcAs("central@yuntera.example", "ops_set_staff", {
    p_email: "comprador2@yuntera.example",
    p_role: "support",
    p_active: true,
  });
  const supportContext = await browser.newContext({ locale: "es-CR" });
  const support = await supportContext.newPage();
  watch(support);
  await signIn(support, OPS, "comprador2@yuntera.example");
  // Asked from a second tab that is not watched for console errors: the browser
  // logs every refused request as one, and this refusal is the expected answer.
  const probe = await supportContext.newPage();
  await probe.goto(OPS + "/sin-acceso", { waitUntil: "networkidle" });
  const asSupport = await fetchList(probe);
  await probe.close();
  log("csv as support staff:", asSupport.status, asSupport.body.slice(0, 60));
  expect(asSupport.status === 403, "only finance downloads the list");
  expect(!asSupport.body.includes("CR23"), "and the refusal carries no account number");
  await support.goto(runUrl, { waitUntil: "networkidle" });
  expect(new URL(support.url()).pathname === "/sin-acceso", "nor can they open the run");
  await supportContext.close();

  // 7. Record one payment, and one transfer the bank refused
  await tecno.locator('input[name="bankReference"]').fill("12");
  await tecno.locator('button:has-text("Registrar como pagado")').click();
  await tecno.locator('[role="alert"]').waitFor();
  log("too short a reference:", await text(tecno.locator('[role="alert"]')));
  await tecno.locator('input[name="bankReference"]').fill(BANK_REFERENCE);
  await tecno.locator('button:has-text("Registrar como pagado")').click();
  await ops.waitForSelector(`main:visible >> text=Comprobante ${BANK_REFERENCE}`);
  log(
    "TecnoCasa after paying:",
    (await text(tecno)).slice(0, 80),
    "…",
    (await text(tecno)).slice(-150),
  );
  expect((await text(tecno)).includes("Pagado"), "the payout is marked paid");

  const cafetal = ops.locator(
    'main:visible section[aria-labelledby="pagos"] ul > li:has(h3:has-text("Cafetal"))',
  );
  await cafetal.locator('summary:has-text("No se pudo pagar")').click();
  await cafetal.locator('textarea[name="note"]').fill("El banco rechazó la cuenta: está cerrada.");
  await cafetal.locator('button:has-text("Marcar como no pagado")').click();
  await ops.waitForSelector('main:visible li:has(h3:has-text("Cafetal")) >> text=No se pagó');
  log("Cafetal after the refusal:", (await text(cafetal)).slice(-140));
  log("run now:", (await text(ops.locator("main:visible .grid").first())).slice(0, 170));
  await ops.screenshot({ path: SHOTS + "/pa7-ops-run-after.png", fullPage: true });

  // The refused amount is available again, so the same cut-off offers it once more.
  await ops.goto(OPS + "/pagos-vendedores", { waitUntil: "networkidle" });
  const again = await preview.locator("tbody tr").allInnerTexts();
  expect(
    (again.find((row) => row.includes("Cafetal")) || "").includes("Se paga"),
    "the failed payout is payable again",
  );
  expect(
    (again.find((row) => row.includes("TecnoCasa")) || "").includes("Disponible menor al mínimo"),
    "and the paid shop has nothing left to pay",
  );
  log(
    "runs:",
    (
      await text(ops.locator('main:visible section[aria-labelledby="corridas"] tbody tr').first())
    ).slice(0, 150),
  );

  // 8. The seller sees the payment, a smaller balance and the new account
  await seller.goto(SELLER + "/pagos", { waitUntil: "networkidle" });
  const after = await balances(seller);
  log("seller balances after:", JSON.stringify(after));
  expect(after.available === "₡0", "what was available has been paid");
  expect(after.pending === before.pending, "what is pending has not moved");
  expect(after.owed !== before.owed, "and the total owed went down");
  const history = await text(seller.locator('main:visible section[aria-labelledby="historial"]'));
  log("seller history:", history);
  expect(
    history.includes("Pagado") && history.includes(BANK_REFERENCE),
    "the payout is there with the bank's reference",
  );
  expect(history.includes(before.available), "for the amount that was available");
  expect(
    history.includes("•••• 2345") && !history.includes(NEW_IBAN_GROUPED),
    "to the new account, masked",
  );
  await seller.screenshot({ path: SHOTS + "/pa8-seller-paid.png", fullPage: true });
  await seller.goto(SELLER + "/cuenta", { waitUntil: "networkidle" });
  const account = await text(bank);
  log("seller account:", account.slice(0, 200));
  expect(
    account.includes("•••• 2345") && account.includes("Último cambio de cuenta aprobado"),
    "the account page shows the approved change",
  );

  // 9. Phone width
  const widths = [
    [sellerContext, SELLER, ["/pagos", "/cuenta"], "seller"],
    [opsContext, OPS, ["/pagos-vendedores", new URL(runUrl).pathname], "ops"],
  ];
  for (const [ctx, base, paths, name] of widths) {
    const m = await ctx.newPage();
    watch(m);
    await m.setViewportSize({ width: 390, height: 844 });
    for (const path of paths) {
      await m.goto(base + path, { waitUntil: "networkidle" });
      const overflow = await m.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      log(`mobile ${name} ${path.slice(0, 30)} overflow px:`, overflow);
      expect(overflow <= 0, `${name} ${path} fits a 390 px screen`);
      await m.screenshot({
        path: `${SHOTS}/pa9-mobile-${name}${path.slice(0, 18).replaceAll("/", "-")}.png`,
        fullPage: true,
      });
    }
    await m.close();
  }

  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => {
  console.error("FAILED:", e.message.slice(0, 700));
  process.exit(1);
});
