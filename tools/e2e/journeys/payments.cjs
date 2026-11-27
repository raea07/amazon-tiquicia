// Payments journey: the whole chain against the local fake of the payment
// gateway (tools/dev-notify/src/fake-onvo.ts), with the payments worker and
// webhook served as the Edge Functions are. Nothing here reaches a real
// gateway or moves money.
//
//   0. An administrator switches the payments mode to the gateway's test
//      environment in the console (refused without a reason).
//   1. A card payment on the gateway's page, with the bank's extra step.
//   2. A declined card, then a new attempt that succeeds; the gateway's API
//      down, the shopper told nothing was charged, and a retry once it is back.
//   3. SINPE Móvil confirmed by the gateway, with no one at Yuntera involved.
//   4. A SINPE Móvil transfer the gateway could not match (another account),
//      settled by finance: attached to its order.
//   5. A refund: requested, shown as on its way, still on its way while the
//      gateway holds it, and completed only after the gateway confirms.
//   6. Finance's daily reconciliation, refunds and review pages at 390 px.
//
// Needs `tools/dev/stack.sh up <lane>`. Fails on any browser error or 5xx.

const { chromium, request } = require("playwright");
const web = require("../lib/web.cjs");
const ops = require("../lib/ops.cjs");
const { word } = require("../lib/words.cjs");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const WEB = web.BASE;
const FAKE_PAY = process.env.FAKE_PAY_URL || "http://127.0.0.1:54324";
const SHOPPER = "comprador@yuntera.example";
const ADMIN = "central@yuntera.example";
const log = (...a) => console.log(...a);

function check(condition, message) {
  if (!condition) throw new Error(`check failed: ${message}`);
  log("ok:", message);
}

async function until(what, fn, seconds = 40) {
  for (let i = 0; i < seconds * 2; i++) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`timed out waiting for ${what}`);
}

(async () => {
  const fake = await request.newContext();
  const fakeState = async () => (await fake.get(`${FAKE_PAY}/_fake/state`)).json();
  const behave = (rules) => fake.post(`${FAKE_PAY}/_fake/behaviour`, { data: rules });
  await fake.post(`${FAKE_PAY}/_fake/reset`);

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
  const desktop = { viewport: { width: 1280, height: 900 }, locale: "es-CR" };
  const phone = {
    viewport: { width: 390, height: 844 },
    locale: "es-CR",
    isMobile: true,
    hasTouch: true,
  };
  const overflow = (page) =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const signIn = (page, app, email, expectPath) => app.signInLandingOn(page, email, expectPath);

  // ── 0. The administrator switches to the gateway's test environment ────
  const finance = await (await browser.newContext(desktop)).newPage();
  watch(finance);
  await signIn(finance, ops, ADMIN, "/");
  await ops.open(finance, "/cobros/ajustes");
  check((await ops.firstSectionHeading(finance)).includes("Simulación"), "starts in simulation");
  // The worker reports itself every second; wait until the page shows it ready.
  await until("the payments service to report itself", async () => {
    await finance.reload({ waitUntil: "networkidle" });
    return (await ops.pageText(finance)).includes("Listo");
  });
  await ops.changePaymentsMode(finance, "test", "corto");
  check(/al menos 10 caracteres/.test(await ops.firstAlert(finance)), "a reason is required");
  await ops.changePaymentsMode(
    finance,
    "test",
    "Pruebas del recorrido de pagos con el simulador local",
  );
  await ops.waitForModeChanged(finance);
  await finance.reload({ waitUntil: "networkidle" });
  check(
    (await ops.firstSectionHeading(finance)).includes("Pruebas del procesador"),
    "now in the gateway's test mode",
  );
  await finance.screenshot({ path: `${SHOTS}/p00-mode.png`, fullPage: true });

  // ── The shopper ──────────────────────────────────────────────────────────
  const shop = await (await browser.newContext(desktop)).newPage();
  watch(shop);
  await signIn(shop, web, SHOPPER, "/");

  /** Reloads an order page and waits until its streamed content is on screen. */
  const fresh = (page) => web.reloadOrder(page);

  /** Buys one speaker with the given method and lands on the order page. */
  const buy = (page, method) => web.buy(page, "parlante-bluetooth-nimbo-ola", method);
  const paid = async (page, order) =>
    until(`order ${order} paid`, () => web.orderShowsPaid(page, order)).catch(async (error) => {
      await page.screenshot({ path: `${SHOTS}/p-failed-${order}.png`, fullPage: true });
      throw error;
    });

  // ── 1. Card with the bank's extra step ──────────────────────────────────
  const card = await buy(shop, "card");
  check((await web.pageText(shop)).includes("Falta el pago"), `${card}: waiting for payment`);
  check(!(await web.simulationOffered(shop)), "no simulation button outside sandbox");
  await shop.screenshot({ path: `${SHOTS}/p01-card-start.png`, fullPage: true });
  await web.payByCard(shop, FAKE_PAY);
  check(/Total: ₡/.test(await web.pageText(shop)), "on the gateway's page, with the amount");
  await shop.screenshot({ path: `${SHOTS}/p02-gateway-page.png`, fullPage: true });
  await web.gatewayChallengePass(shop);
  await shop.screenshot({ path: `${SHOTS}/p03-3ds.png`, fullPage: true });
  await web.gatewayPass3ds(shop);
  await shop.waitForURL(
    (u) => u.href.startsWith(WEB) && new URL(u).pathname === `/pedidos/${card}`,
  );
  check(
    new URL(shop.url()).searchParams.get("pago") === "retorno",
    "back at the order, as a hint only",
  );
  await paid(shop, card);
  await web.open(shop, `/pedidos/${card}?pago=retorno`);
  check((await web.paymentReceivedNotices(shop)) === 1, "the shopper is told it was paid");
  await shop.screenshot({ path: `${SHOTS}/p04-card-paid.png`, fullPage: true });

  // ── 2. Declined, then paid with a new attempt ────────────────────────────
  const declined = await buy(shop, "card");
  await web.payByCard(shop, FAKE_PAY);
  await web.gatewayDecline(shop);
  await shop.waitForURL(
    (u) => u.href.startsWith(WEB) && new URL(u).pathname === `/pedidos/${declined}`,
  );
  await until("the decline to show", async () => {
    await fresh(shop);
    return web.paymentFailedShown(shop);
  });
  const declinedText = await web.pageText(shop);
  check(
    declinedText.includes("No se le cobró nada"),
    `the shopper knows nothing was charged: ${declinedText.slice(0, 300)}`,
  );
  await shop.screenshot({ path: `${SHOTS}/p05-declined.png`, fullPage: true });
  await web.retryPayment(shop, FAKE_PAY);
  await web.gatewayApprove(shop);
  await shop.waitForURL((u) => u.href.startsWith(WEB));
  await paid(shop, declined);
  log("ok: the second attempt paid", declined);

  // The gateway's API is down: nothing can be prepared, nothing is charged.
  await behave({ api: "down" });
  const outage = await buy(shop, "card");
  await web.tryCardWithoutGateway(shop);
  await until("the outage to show", async () => {
    await fresh(shop);
    return web.paymentNotPreparedShown(shop);
  });
  const outageText = await web.pageText(shop);
  check(
    outageText.includes("No se le cobró nada") && outageText.includes("Le quedan 4 intentos"),
    `the shopper knows nothing was charged, and may try again: ${outageText.slice(0, 300)}`,
  );
  await shop.screenshot({ path: `${SHOTS}/p05b-gateway-down.png`, fullPage: true });
  await behave({ api: "up" });
  await web.retryPayment(shop, FAKE_PAY);
  await web.gatewayApprove(shop);
  await shop.waitForURL((u) => u.href.startsWith(WEB));
  await paid(shop, outage);
  log("ok: once the gateway is back, a new attempt paid", outage);

  // ── 3. SINPE Móvil confirmed by the gateway ──────────────────────────────
  const sinpePhone = await (await browser.newContext(phone)).newPage();
  watch(sinpePhone);
  await signIn(sinpePhone, web, SHOPPER, "/");
  const sinpe = await buy(sinpePhone, "sinpe_movil");
  check((await overflow(sinpePhone)) <= 0, "the order page fits 390 px");
  await web.waitForSinpeForm(sinpePhone);
  check(
    (await web.sinpeTyped(sinpePhone)).kind === "",
    "who pays is asked, nothing chosen for them",
  );
  await web.fillSinpe(sinpePhone, { kind: "national", number: "1-1393-1919", phone: "2222-1234" });
  await web.askSinpeDetails(sinpePhone);
  check(/celular con SINPE/.test(await web.firstAlert(sinpePhone)), "a landline is refused");
  const keptSinpe = await web.sinpeTyped(sinpePhone);
  check(keptSinpe.number === "1-1393-1919", "the form keeps what was typed");
  check(keptSinpe.kind === "national", "and the choice");
  // The gateway's test number that pays on its own a moment later.
  await web.fillSinpe(sinpePhone, { phone: "8888-8888" });
  const box = await web.sinpeKindField(sinpePhone).boundingBox();
  check(box && box.height >= 44, `fields are at least 44 px tall (${box && box.height})`);
  await web.askSinpeDetails(sinpePhone);
  const toNumber = await web.sinpeNumber(sinpePhone).catch(async (error) => {
    await sinpePhone.screenshot({ path: `${SHOTS}/p-failed-sinpe.png`, fullPage: true });
    throw error;
  });
  check(toNumber === "7019-6686", "transfer to the gateway's number");
  check(
    (await web.pageText(sinpePhone)).includes("ONVO"),
    "and the shopper is told the bank shows ONVO",
  );
  await sinpePhone.screenshot({
    path: `${SHOTS}/p06-sinpe-instructions-phone.png`,
    fullPage: true,
  });
  await until("the transfer to be confirmed", () => web.deliveryCodeShown(sinpePhone), 30);
  log("ok: SINPE Móvil confirmed by the gateway, with no one at Yuntera involved", sinpe);
  await sinpePhone.screenshot({ path: `${SHOTS}/p07-sinpe-paid-phone.png`, fullPage: true });

  // ── 4. A transfer from another account, attached by finance ──────────────
  const other = await buy(shop, "sinpe_movil");
  await web.fillSinpe(shop, { kind: "national", number: "1-0101-0101", phone: "8888-1212" });
  await web.askSinpeDetails(shop);
  await web.sinpeNumber(shop);
  const state = await fakeState();
  const intent = state.intents.find(
    (i) => i.metadata.orderNumber === other && i.status === "processing",
  );
  check(intent, `the gateway waits for ${other}'s transfer`);
  // Paid from a relative's account: the gateway cannot tie it to the order.
  const sent = await (
    await fake.post(`${FAKE_PAY}/_fake/sinpe/transfer`, {
      data: { identification: "02-0222-0222", amount: intent.amount, description: `Pago ${other}` },
    })
  ).json();
  check(sent.matched === null, "a transfer from another account matches nothing");
  await ops.open(finance, "/cobros/revision");
  await until("the transfer to reach finance", async () => {
    await finance.reload({ waitUntil: "networkidle" });
    return (await ops.unmatchedTransfers(finance)) > 0;
  });
  await finance.screenshot({ path: `${SHOTS}/p08-review.png`, fullPage: true });
  const settledLine = await ops.attachTransfer(
    finance,
    other,
    "La clienta confirmó que pagó desde la cuenta de su hermana.",
  );
  check(
    settledLine.includes(`aplicado a otro pedido (${other})`),
    `the transfer is settled on ${other}: ${settledLine}`,
  );
  log("ok: the transfer is settled, with finance's note");
  await web.openOrder(shop, other, "load");
  await paid(shop, other);
  log("ok: finance attached the transfer and the order was paid", other);

  // ── 5. A refund, completed only when the gateway confirms ───────────────
  await behave({ refunds: "hold" });
  await web.openOrder(shop, card);
  await web.cancelPaidOrder(shop);
  await fresh(shop);
  const onItsWay = word("shopper_refund", "pending", { viewer: "shopper" });
  const completed = word("shopper_refund", "succeeded", { viewer: "shopper" });
  check((await web.firstRefund(shop)).includes(onItsWay), "the refund is shown on its way");
  check((await web.pageText(shop)).includes("reembolso en camino"), "and the payment says so");
  // The worker sends it; the gateway accepts it and holds it.
  const sentRefund = await until("the refund to reach the gateway", async () => {
    const s = await fakeState();
    return s.refunds.find((r) => r.status === "pending");
  });
  await new Promise((resolve) => setTimeout(resolve, 3000));
  await fresh(shop);
  check(
    (await web.firstRefund(shop)).includes(onItsWay),
    "still on its way while the gateway holds it",
  );
  check(
    !(await web.firstRefund(shop)).includes(completed),
    "never completed before the gateway confirms",
  );
  await shop.screenshot({ path: `${SHOTS}/p09-refund-on-its-way.png`, fullPage: true });
  await ops.open(finance, "/cobros/reembolsos");
  check(
    (await ops.refundRow(finance, card)).includes(
      word("gateway_refunds", "sent", { viewer: "staff" }),
    ),
    "finance sees it sent, unconfirmed",
  );
  await fake.post(`${FAKE_PAY}/_fake/refunds/${sentRefund.id}/complete`, {
    data: { outcome: "succeeded" },
  });
  await until("the refund to complete", async () => {
    await fresh(shop);
    return (await web.firstRefund(shop)).includes(completed);
  });
  // The page reads the order and its refunds in two calls: the confirmation
  // may land between them, so read a page made wholly after it.
  await fresh(shop);
  const after = await web.orderSummary(shop);
  check(after.includes("reembolsado"), `the payment shows refunded: ${after}`);
  await shop.screenshot({ path: `${SHOTS}/p10-refund-completed.png`, fullPage: true });

  // ── 6. Finance's pages on a phone ────────────────────────────────────────
  const opsPhone = await (await browser.newContext(phone)).newPage();
  watch(opsPhone);
  await signIn(opsPhone, ops, ADMIN, "/");
  for (const [path, shot] of [
    ["/cobros", "p11-day-phone"],
    ["/cobros/revision", "p12-review-phone"],
    ["/cobros/reembolsos", "p13-refunds-phone"],
    ["/cobros/ajustes", "p14-settings-phone"],
  ]) {
    await ops.open(opsPhone, path);
    check((await overflow(opsPhone)) <= 0, `${path} fits 390 px`);
    await opsPhone.screenshot({ path: `${SHOTS}/${shot}.png`, fullPage: true });
  }
  await ops.open(finance, "/cobros");
  const day = await ops.pageText(finance);
  check(day.includes(card) && day.includes(declined), "the day's payments with their references");
  check(/Comisión del procesador/.test(day), "and the gateway's fees against the expected ones");
  await finance.screenshot({ path: `${SHOTS}/p15-day.png`, fullPage: true });

  await browser.close();
  if (errors.length) {
    console.error("errors:", errors);
    process.exit(1);
  }
  log("payments journey passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
