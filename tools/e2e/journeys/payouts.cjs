// Payouts journey: a seller asks for a new payout account, finance approves it, previews a
// cut-off, creates a run, downloads the list for the bank and records a payment; the seller then
// sees the payout and a smaller balance.
//
// A journey drives the real app in a real browser against a freshly seeded
// database. It fails when a step does not arrive where it should, when the
// browser logs an error, or when any response is a 5xx.

const { chromium, request } = require("playwright");
const seller = require("../lib/seller.cjs");
const ops = require("../lib/ops.cjs");
const { word } = require("../lib/words.cjs");
const kit = require("../lib/kit.cjs");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const SELLER = process.env.SELLER_URL || "http://127.0.0.1:3001";
const OPS = process.env.OPS_URL || "http://127.0.0.1:3002";
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const log = (...a) => console.log(...a);
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
  // The three balances on the seller's money screen, as the text of each tile.
  const balances = async (page) => {
    const { tiles, owed } = await seller.balanceTiles(page);
    const amount = (label) => {
      const tile = tiles.find((t) => t.trim().startsWith(label)) || "";
      return lines(tile)[1] || "";
    };
    return {
      available: amount("Disponible"),
      pending: amount("Pendiente"), // not a status word: the label of a balance tile
      inTransit: amount("En tránsito"),
      owed,
    };
  };

  // 1. The seller, in the shop that has sales old enough to be paid
  const sellerContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "es-CR",
    acceptDownloads: true,
  });
  const vendor = await sellerContext.newPage();
  watch(vendor);
  await seller.signInHome(vendor, "vendedor@yuntera.example");
  await seller.chooseShop(vendor, "TecnoCasa");
  await seller.open(vendor, "/pagos");
  const before = await balances(vendor);
  log("seller balances before:", JSON.stringify(before));
  expect(
    before.available.startsWith("₡") && before.available !== "₡0",
    "TecnoCasa has money available",
  );
  expect(before.inTransit === "₡0", "and nothing in transit yet");
  log("hold explained:", (await seller.whenPaid(vendor)).slice(0, 260));
  log("history:", await seller.payoutHistory(vendor));
  await vendor.screenshot({ path: SHOTS + "/pa1-seller-balances.png", fullPage: true });

  // 2. The seller asks for a new payout account
  await seller.open(vendor, "/cuenta");
  const current = await seller.payoutAccount(vendor);
  log("current account:", current.slice(0, 120));
  expect(current.includes("•••• 6789"), "the current account is masked");
  // A wrong digit is caught while typing, before anything is sent.
  const wrongDigit = await seller.typeWrongIban(vendor, "CR23 0151 0841 0026 0123 46");
  log("wrong digit:", wrongDigit);
  expect(wrongDigit.includes("no coinciden"), "the form says the digits do not add up");
  await seller.typeIban(vendor, "cr23 0151 0841 0026 0123 45", NEW_IBAN_GROUPED);
  log(
    "SINPE Móvil offered again:",
    await seller.typeHolder(vendor, "TecnoCasa de Costa Rica S.A."),
  );
  await vendor.screenshot({ path: SHOTS + "/pa2-seller-request-form.png", fullPage: true });
  const afterRequest = await seller.askPayoutAccount(vendor);
  log("after asking:", afterRequest.slice(0, 420));
  expect(afterRequest.includes("•••• 2345"), "the request shows the new account masked");
  expect(afterRequest.includes("•••• 6789"), "and the current account has not changed");
  const sellerPage = await seller.mainText(vendor);
  expect(
    !sellerPage.includes(NEW_IBAN) && !sellerPage.includes(NEW_IBAN_GROUPED),
    "the seller's screen never shows a whole account number",
  );
  await vendor.screenshot({ path: SHOTS + "/pa3-seller-request-sent.png", fullPage: true });

  // 3. Finance: the request, with the number to call and the account in full
  const opsContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "es-CR",
    acceptDownloads: true,
  });
  const staff = await opsContext.newPage();
  watch(staff);
  await ops.signInHome(staff, "central@yuntera.example");
  await ops.open(staff, "/pagos-vendedores");
  const cardText = await ops.firstAccountChangeText(staff);
  log("request in finance's queue:", cardText.slice(0, 460));
  expect(cardText.includes("TecnoCasa"), "the request names the shop");
  expect(cardText.includes(NEW_IBAN_GROUPED), "finance sees the requested account in full");
  expect(cardText.includes("•••• 6789"), "and the current one masked");
  expect(cardText.includes("2234-0202"), "with the phone already on file to call");
  await staff.screenshot({ path: SHOTS + "/pa4-ops-request.png", fullPage: true });
  // A rejection has to be explained; what was typed survives the refusal.
  log("reject without a reason:", await ops.rejectAccountChangeRefused(staff, "no"));
  // The card is gone with its form, so the page itself confirms the decision.
  const confirmed = await ops.approveAccountChange(staff);
  log("approved: the queue is empty;", confirmed);
  expect(confirmed.includes("Cuenta aprobada"), "finance is told the account was approved");

  // 4. Preview: an earlier cut-off pays less; today's pays three shops
  const today = await ops.cutoffDate(staff);
  const earlier = new Date(Date.parse(today + "T00:00:00Z") - 12 * 86400000)
    .toISOString()
    .slice(0, 10);
  await ops.previewCutoff(staff, earlier);
  const earlierTotal = lines((await ops.cutoffTiles(staff))[0])[1];
  await ops.open(staff, "/pagos-vendedores");
  const todayTiles = await ops.cutoffTiles(staff);
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
  const rows = await ops.cutoffRows(staff);
  for (const row of rows) log("  preview:", row.replace(/\s+/g, " "));
  const tecnoRow = rows.find((row) => row.includes("TecnoCasa")) || "";
  expect(tecnoRow.includes("Se paga"), "TecnoCasa would be paid");
  expect(tecnoRow.includes("•••• 2345"), "to the account finance just approved");
  expect(
    (rows.find((row) => row.includes("Higuer")) || "").includes("Disponible menor al mínimo"),
    "a shop with nothing available is listed with the reason",
  );
  await staff.screenshot({ path: SHOTS + "/pa5-ops-preview.png", fullPage: true });

  // 5. Create the run and open it
  const runCode = await ops.createRun(staff);
  const runUrl = staff.url();
  log("run:", runCode, "|", (await ops.runFigures(staff)).slice(0, 160));
  expect((await ops.runPayoutCount(staff)) === 3, "three shops are paid in this run");
  const tecnoText = await ops.runPayoutText(staff, "TecnoCasa");
  log("TecnoCasa's payout:", tecnoText.slice(0, 260));
  expect(tecnoText.includes(NEW_IBAN_GROUPED), "the transfer list has the account in full");
  expect(tecnoText.includes(`YUNTERA ${runCode}-`), "and the text for the transfer's description");
  await staff.screenshot({ path: SHOTS + "/pa6-ops-run.png", fullPage: true });

  // 6. The CSV for the bank: a real download, never cached, finance only
  const download = await ops.downloadBankList(staff);
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
  const asFinance = await fetchList(staff);
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
  await ops.signInHome(support, "comprador2@yuntera.example");
  // Asked from a second tab that is not watched for console errors: the browser
  // logs every refused request as one, and this refusal is the expected answer.
  const probe = await supportContext.newPage();
  await ops.open(probe, "/sin-acceso");
  const asSupport = await fetchList(probe);
  await probe.close();
  log("csv as support staff:", asSupport.status, asSupport.body.slice(0, 60));
  expect(asSupport.status === 403, "only finance downloads the list");
  expect(!asSupport.body.includes("CR23"), "and the refusal carries no account number");
  await support.goto(runUrl, { waitUntil: "networkidle" });
  expect(new URL(support.url()).pathname === "/sin-acceso", "nor can they open the run");
  await supportContext.close();

  // 7. Record one payment, and one transfer the bank refused
  log("too short a reference:", await ops.recordPaidRefused(staff, "TecnoCasa", "12"));
  await ops.recordPaid(staff, "TecnoCasa", BANK_REFERENCE);
  const paidText = await ops.runPayoutText(staff, "TecnoCasa");
  log("TecnoCasa after paying:", paidText.slice(0, 80), "…", paidText.slice(-150));
  expect(
    paidText.includes(word("payouts", "paid", { viewer: "staff" })),
    "the payout is marked paid",
  );
  await ops.recordNotPaid(staff, "Cafetal", "El banco rechazó la cuenta: está cerrada.");
  log("Cafetal after the refusal:", (await ops.runPayoutText(staff, "Cafetal")).slice(-140));
  log("run now:", (await ops.runFigures(staff)).slice(0, 170));
  await staff.screenshot({ path: SHOTS + "/pa7-ops-run-after.png", fullPage: true });
  // The refused amount is available again, so the same cut-off offers it once more.
  await ops.open(staff, "/pagos-vendedores");
  const again = await ops.cutoffRows(staff);
  expect(
    (again.find((row) => row.includes("Cafetal")) || "").includes("Se paga"),
    "the failed payout is payable again",
  );
  expect(
    (again.find((row) => row.includes("TecnoCasa")) || "").includes("Disponible menor al mínimo"),
    "and the paid shop has nothing left to pay",
  );
  log("runs:", (await ops.firstRun(staff)).slice(0, 150));

  // 8. The seller sees the payment, a smaller balance and the new account
  await seller.open(vendor, "/pagos");
  const after = await balances(vendor);
  log("seller balances after:", JSON.stringify(after));
  expect(after.available === "₡0", "what was available has been paid");
  expect(after.pending === before.pending, "what is pending has not moved");
  expect(after.owed !== before.owed, "and the total owed went down");
  const history = await seller.payoutHistory(vendor);
  log("seller history:", history);
  expect(
    history.includes(word("payouts", "paid", { viewer: "seller" })) &&
      history.includes(BANK_REFERENCE),
    "the payout is there with the bank's reference",
  );
  expect(history.includes(before.available), "for the amount that was available");
  expect(
    history.includes("•••• 2345") && !history.includes(NEW_IBAN_GROUPED),
    "to the new account, masked",
  );
  await vendor.screenshot({ path: SHOTS + "/pa8-seller-paid.png", fullPage: true });
  await seller.open(vendor, "/cuenta");
  const account = await seller.payoutSectionText(vendor);
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
      const overflow = await kit.overflowPx(m);
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
