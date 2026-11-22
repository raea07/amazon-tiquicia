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
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const WEB = process.env.WEB_URL || "http://127.0.0.1:3000";
const OPS = process.env.OPS_URL || "http://127.0.0.1:3002";
const FAKE_PAY = process.env.FAKE_PAY_URL || "http://127.0.0.1:54324";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const SHOPPER = "comprador@yuntera.example";
const ADMIN = "central@yuntera.example";
const log = (...a) => console.log(...a);
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, " ").trim();

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
  const signIn = async (page, base, email, expectPath) => {
    await page.goto(base + "/ingresar", { waitUntil: "networkidle" });
    await page.fill('main input[name="email"]', email);
    await page.fill('main input[name="password"]', PASSWORD);
    await page.click('main form button[type="submit"]');
    await page.waitForURL((u) => new URL(u).pathname === expectPath);
  };

  // ── 0. The administrator switches to the gateway's test environment ────
  const ops = await (await browser.newContext(desktop)).newPage();
  watch(ops);
  await signIn(ops, OPS, ADMIN, "/");
  await ops.goto(OPS + "/cobros/ajustes", { waitUntil: "networkidle" });
  check(
    (await text(ops.locator("main h2").first())).includes("Simulación"),
    "starts in simulation",
  );
  // The worker reports itself every second; wait until the page shows it ready.
  await until("the payments service to report itself", async () => {
    await ops.reload({ waitUntil: "networkidle" });
    return (await text(ops.locator("body"))).includes("Listo");
  });
  await ops.selectOption('main select[name="mode"]', "test");
  await ops.fill('main textarea[name="note"] >> nth=0', "corto");
  await ops.click('main button:visible:has-text("Cambiar el modo")');
  await ops.waitForSelector('main [role="alert"]');
  check(
    /al menos 10 caracteres/.test(await text(ops.locator('main [role="alert"]').first())),
    "a reason is required",
  );
  await ops.fill(
    'main textarea[name="note"] >> nth=0',
    "Pruebas del recorrido de pagos con el simulador local",
  );
  await ops.click('main button:visible:has-text("Cambiar el modo")');
  await ops.waitForSelector("text=Modo de pagos cambiado");
  await ops.reload({ waitUntil: "networkidle" });
  check(
    (await text(ops.locator("main h2").first())).includes("Pruebas del procesador"),
    "now in the gateway's test mode",
  );
  await ops.screenshot({ path: `${SHOTS}/p00-mode.png`, fullPage: true });

  // ── The shopper ──────────────────────────────────────────────────────────
  const shop = await (await browser.newContext(desktop)).newPage();
  watch(shop);
  await signIn(shop, WEB, SHOPPER, "/");

  /** Reloads an order page and waits until its streamed content is on screen. */
  const fresh = async (page) => {
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector('h1:visible:has-text("Pedido YT-")');
    await page.waitForTimeout(300);
  };

  /** Buys one speaker with the given method and lands on the order page. */
  const buy = async (page, method) => {
    await page.goto(WEB + "/p/parlante-bluetooth-nimbo-ola", { waitUntil: "load" });
    await page.locator('aside[aria-label="Comprar"] button:has-text("Agregar al carrito")').click();
    await page.waitForSelector("text=Agregado al carrito");
    await page.goto(WEB + "/pagar", { waitUntil: "load" });
    await page.waitForSelector(`input[name="paymentMethod"][value="${method}"]`);
    await page.check(`input[name="paymentMethod"][value="${method}"]`);
    await page.click('button:has-text("Confirmar pedido")');
    await page.waitForURL((u) => /^\/pedidos\/YT-/.test(new URL(u).pathname));
    await page.waitForSelector('h1:visible:has-text("Pedido YT-")');
    return new URL(page.url()).pathname.split("/")[2];
  };
  const paid = async (page, order) =>
    until(`order ${order} paid`, async () => {
      if (!new URL(page.url()).pathname.endsWith(order)) {
        await page.goto(`${WEB}/pedidos/${order}`, { waitUntil: "load" });
      } else {
        await page.reload({ waitUntil: "load" });
      }
      await page.waitForSelector('h1:visible:has-text("Pedido YT-")');
      await page.waitForTimeout(300);
      return (await page.getByText("Su código de entrega").filter({ visible: true }).count()) > 0;
    }).catch(async (error) => {
      await page.screenshot({ path: `${SHOTS}/p-failed-${order}.png`, fullPage: true });
      throw error;
    });

  // ── 1. Card with the bank's extra step ──────────────────────────────────
  const card = await buy(shop, "card");
  check(
    (await text(shop.locator("body"))).includes("Falta el pago"),
    `${card}: waiting for payment`,
  );
  check(
    (await shop.getByText("Simular pago").filter({ visible: true }).count()) === 0,
    "no simulation button outside sandbox",
  );
  await shop.screenshot({ path: `${SHOTS}/p01-card-start.png`, fullPage: true });
  await shop.click('main button:visible:has-text("con tarjeta")');
  await shop.waitForURL((u) => u.href.startsWith(FAKE_PAY + "/pay/"));
  check(
    /Total: ₡/.test(await text(shop.locator("body"))),
    "on the gateway's page, with the amount",
  );
  await shop.screenshot({ path: `${SHOTS}/p02-gateway-page.png`, fullPage: true });
  await shop.click('[data-testid="fake-challenge"]');
  await shop.waitForSelector('[data-testid="fake-3ds"]');
  await shop.screenshot({ path: `${SHOTS}/p03-3ds.png`, fullPage: true });
  await shop.click('[data-testid="fake-3ds-pass"]');
  await shop.waitForURL(
    (u) => u.href.startsWith(WEB) && new URL(u).pathname === `/pedidos/${card}`,
  );
  check(
    new URL(shop.url()).searchParams.get("pago") === "retorno",
    "back at the order, as a hint only",
  );
  await paid(shop, card);
  await shop.goto(`${WEB}/pedidos/${card}?pago=retorno`, { waitUntil: "networkidle" });
  check(
    (await shop.getByText("¡Pago recibido!").filter({ visible: true }).count()) === 1,
    "the shopper is told it was paid",
  );
  await shop.screenshot({ path: `${SHOTS}/p04-card-paid.png`, fullPage: true });

  // ── 2. Declined, then paid with a new attempt ────────────────────────────
  const declined = await buy(shop, "card");
  await shop.click('main button:visible:has-text("con tarjeta")');
  await shop.waitForURL((u) => u.href.startsWith(FAKE_PAY + "/pay/"));
  await shop.click('[data-testid="fake-decline"]');
  await shop.waitForURL(
    (u) => u.href.startsWith(WEB) && new URL(u).pathname === `/pedidos/${declined}`,
  );
  await until("the decline to show", async () => {
    await fresh(shop);
    return (await shop.getByText("El pago no se completó").filter({ visible: true }).count()) > 0;
  });
  const declinedText = await text(shop.locator("body"));
  check(
    declinedText.includes("No se le cobró nada"),
    `the shopper knows nothing was charged: ${declinedText.slice(0, 300)}`,
  );
  await shop.screenshot({ path: `${SHOTS}/p05-declined.png`, fullPage: true });
  await shop.click('main button:visible:has-text("Intentar de nuevo")');
  await shop.waitForURL((u) => u.href.startsWith(FAKE_PAY + "/pay/"));
  await shop.click('[data-testid="fake-approve"]');
  await shop.waitForURL((u) => u.href.startsWith(WEB));
  await paid(shop, declined);
  log("ok: the second attempt paid", declined);

  // The gateway's API is down: nothing can be prepared, nothing is charged.
  await behave({ api: "down" });
  const outage = await buy(shop, "card");
  await shop.click('main button:visible:has-text("con tarjeta")');
  await until("the outage to show", async () => {
    await fresh(shop);
    return (
      (await shop.getByText("No pudimos preparar el pago").filter({ visible: true }).count()) > 0
    );
  });
  const outageText = await text(shop.locator("body"));
  check(
    outageText.includes("No se le cobró nada") && outageText.includes("Le quedan 4 intentos"),
    `the shopper knows nothing was charged, and may try again: ${outageText.slice(0, 300)}`,
  );
  await shop.screenshot({ path: `${SHOTS}/p05b-gateway-down.png`, fullPage: true });
  await behave({ api: "up" });
  await shop.click('main button:visible:has-text("Intentar de nuevo")');
  await shop.waitForURL((u) => u.href.startsWith(FAKE_PAY + "/pay/"));
  await shop.click('[data-testid="fake-approve"]');
  await shop.waitForURL((u) => u.href.startsWith(WEB));
  await paid(shop, outage);
  log("ok: once the gateway is back, a new attempt paid", outage);

  // ── 3. SINPE Móvil confirmed by the gateway ──────────────────────────────
  const sinpePhone = await (await browser.newContext(phone)).newPage();
  watch(sinpePhone);
  await signIn(sinpePhone, WEB, SHOPPER, "/");
  const sinpe = await buy(sinpePhone, "sinpe_movil");
  check((await overflow(sinpePhone)) <= 0, "the order page fits 390 px");
  await sinpePhone.waitForSelector('main button:visible:has-text("Ver los datos para transferir")');
  check(
    (await sinpePhone.inputValue('main select[name="kind"]')) === "",
    "who pays is asked, nothing chosen for them",
  );
  await sinpePhone.selectOption('main select[name="kind"]', "national");
  await sinpePhone.fill('main input[name="number"]', "1-1393-1919");
  await sinpePhone.fill('main input[name="phone"]', "2222-1234");
  await sinpePhone.click('main button:visible:has-text("Ver los datos para transferir")');
  await sinpePhone.waitForSelector('main [role="alert"]');
  check(
    /celular con SINPE/.test(await text(sinpePhone.locator('main [role="alert"]').first())),
    "a landline is refused",
  );
  check(
    (await sinpePhone.inputValue('main input[name="number"]')) === "1-1393-1919",
    "the form keeps what was typed",
  );
  check((await sinpePhone.inputValue('main select[name="kind"]')) === "national", "and the choice");
  // The gateway's test number that pays on its own a moment later.
  await sinpePhone.fill('main input[name="phone"]', "8888-8888");
  const box = await sinpePhone.locator('main select[name="kind"]').boundingBox();
  check(box && box.height >= 44, `fields are at least 44 px tall (${box && box.height})`);
  await sinpePhone.click('main button:visible:has-text("Ver los datos para transferir")');
  await sinpePhone.waitForSelector('[data-testid="sinpe-number"]').catch(async (error) => {
    await sinpePhone.screenshot({ path: `${SHOTS}/p-failed-sinpe.png`, fullPage: true });
    throw error;
  });
  check(
    (await text(sinpePhone.locator('[data-testid="sinpe-number"]'))) === "7019-6686",
    "transfer to the gateway's number",
  );
  check(
    (await text(sinpePhone.locator("body"))).includes("ONVO"),
    "and the shopper is told the bank shows ONVO",
  );
  await sinpePhone.screenshot({
    path: `${SHOTS}/p06-sinpe-instructions-phone.png`,
    fullPage: true,
  });
  await until(
    "the transfer to be confirmed",
    async () =>
      (await sinpePhone.getByText("Su código de entrega").filter({ visible: true }).count()) > 0,
    30,
  );
  log("ok: SINPE Móvil confirmed by the gateway, with no one at Yuntera involved", sinpe);
  await sinpePhone.screenshot({ path: `${SHOTS}/p07-sinpe-paid-phone.png`, fullPage: true });

  // ── 4. A transfer from another account, attached by finance ──────────────
  const other = await buy(shop, "sinpe_movil");
  await shop.selectOption('main select[name="kind"]', "national");
  await shop.fill('main input[name="number"]', "1-0101-0101");
  await shop.fill('main input[name="phone"]', "8888-1212");
  await shop.click('main button:visible:has-text("Ver los datos para transferir")');
  await shop.waitForSelector('[data-testid="sinpe-number"]');
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
  await ops.goto(OPS + "/cobros/revision", { waitUntil: "networkidle" });
  const review = ops
    .locator('[data-testid="payment-review"]', { hasText: "Transferencia sin pedido" })
    .first();
  await until("the transfer to reach finance", async () => {
    await ops.reload({ waitUntil: "networkidle" });
    return (await review.count()) > 0;
  });
  await ops.screenshot({ path: `${SHOTS}/p08-review.png`, fullPage: true });
  await review.locator('select[name="resolution"]').selectOption("attach");
  await review.locator('input[name="orderNumber"]').fill(other);
  await review
    .locator('textarea[name="note"]')
    .fill("La clienta confirmó que pagó desde la cuenta de su hermana.");
  await review.locator('button:has-text("Guardar decisión")').click();
  // The item leaves the list and shows among the settled ones, with its order.
  await ops.waitForSelector(`#resueltos ~ ul li:has-text("aplicado a otro pedido (${other})")`);
  log("ok: the transfer is settled, with finance's note");
  await shop.goto(`${WEB}/pedidos/${other}`, { waitUntil: "load" });
  await paid(shop, other);
  log("ok: finance attached the transfer and the order was paid", other);

  // ── 5. A refund, completed only when the gateway confirms ───────────────
  await behave({ refunds: "hold" });
  await shop.goto(`${WEB}/pedidos/${card}`, { waitUntil: "networkidle" });
  await shop.click('main button:visible:has-text("Cancelar pedido")');
  // The cancel form goes once the order is cancelled; its refund takes its place.
  await shop.waitForSelector('[data-testid="refund"]:visible');
  await fresh(shop);
  const refund = shop.locator('[data-testid="refund"]').first();
  check((await text(refund)).includes("En camino"), "the refund is shown on its way");
  check(
    (await text(shop.locator("body"))).includes("reembolso en camino"),
    "and the payment says so",
  );
  // The worker sends it; the gateway accepts it and holds it.
  const sentRefund = await until("the refund to reach the gateway", async () => {
    const s = await fakeState();
    return s.refunds.find((r) => r.status === "pending");
  });
  await new Promise((resolve) => setTimeout(resolve, 3000));
  await fresh(shop);
  check((await text(refund)).includes("En camino"), "still on its way while the gateway holds it");
  check(
    !(await text(refund)).includes("Completado"),
    "never completed before the gateway confirms",
  );
  await shop.screenshot({ path: `${SHOTS}/p09-refund-on-its-way.png`, fullPage: true });
  await ops.goto(OPS + "/cobros/reembolsos", { waitUntil: "networkidle" });
  const row = ops.locator('[data-testid="refund-row"]', { hasText: card });
  check((await text(row)).includes("Enviado, sin confirmar"), "finance sees it sent, unconfirmed");
  await fake.post(`${FAKE_PAY}/_fake/refunds/${sentRefund.id}/complete`, {
    data: { outcome: "succeeded" },
  });
  await until("the refund to complete", async () => {
    await fresh(shop);
    return (await text(shop.locator('[data-testid="refund"]').first())).includes("Completado");
  });
  // The page reads the order and its refunds in two calls: the confirmation
  // may land between them, so read a page made wholly after it.
  await fresh(shop);
  const after = await text(shop.locator('aside[aria-label="Resumen"]:visible'));
  check(after.includes("reembolsado"), `the payment shows refunded: ${after}`);
  await shop.screenshot({ path: `${SHOTS}/p10-refund-completed.png`, fullPage: true });

  // ── 6. Finance's pages on a phone ────────────────────────────────────────
  const opsPhone = await (await browser.newContext(phone)).newPage();
  watch(opsPhone);
  await signIn(opsPhone, OPS, ADMIN, "/");
  for (const [path, shot] of [
    ["/cobros", "p11-day-phone"],
    ["/cobros/revision", "p12-review-phone"],
    ["/cobros/reembolsos", "p13-refunds-phone"],
    ["/cobros/ajustes", "p14-settings-phone"],
  ]) {
    await opsPhone.goto(OPS + path, { waitUntil: "networkidle" });
    check((await overflow(opsPhone)) <= 0, `${path} fits 390 px`);
    await opsPhone.screenshot({ path: `${SHOTS}/${shot}.png`, fullPage: true });
  }
  await ops.goto(OPS + "/cobros", { waitUntil: "networkidle" });
  const day = await text(ops.locator("body"));
  check(day.includes(card) && day.includes(declined), "the day's payments with their references");
  check(/Comisión del procesador/.test(day), "and the gateway's fees against the expected ones");
  await ops.screenshot({ path: `${SHOTS}/p15-day.png`, fullPage: true });

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
