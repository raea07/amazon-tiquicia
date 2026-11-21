// Notifications journey: a shopper chooses WhatsApp, places and pays an order;
// the worker sends the messages to the local fake providers; the fake reports
// delivery through the signed webhook; staff see the messages as delivered.
// The first WhatsApp message is accepted and then reported as not delivered:
// staff find it among the stuck messages and send it again. Then the fake
// rejects the shopper's address, the message ends as a dead letter, staff send
// it again; that send soft-bounces, the worker retries it under a new key by
// itself, and it is delivered once.
//
// Needs `tools/dev/stack.sh up <lane>`, which starts the worker (served as the
// Edge Functions are) and the fake providers. Nothing here reaches a real
// provider. Fails on any browser error or 5xx, like the other journeys.

const { chromium, request } = require("playwright");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const WEB = process.env.WEB_URL || "http://127.0.0.1:3000";
const SELLER = process.env.SELLER_URL || "http://127.0.0.1:3001";
const OPS = process.env.OPS_URL || "http://127.0.0.1:3002";
const FAKE = process.env.FAKE_PROVIDERS_URL || "http://127.0.0.1:54323";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const SHOPPER = "comprador@yuntera.example";
const MOBILE = "+50688881234";
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
  const fakeGet = async (query) => (await fake.get(`${FAKE}/_fake/messages${query}`)).json();
  const behave = (rules) => fake.post(`${FAKE}/_fake/behaviour`, { data: { rules } });
  await fake.post(`${FAKE}/_fake/reset`);

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

  // ── 1. The shopper chooses WhatsApp ─────────────────────────────────────
  const shopper = await (await browser.newContext(desktop)).newPage();
  watch(shopper);
  await shopper.goto(`${WEB}/ingresar?siguiente=/cuenta/notificaciones`, {
    waitUntil: "networkidle",
  });
  await shopper.fill('main input[name="email"]', SHOPPER);
  await shopper.fill('main input[name="password"]', PASSWORD);
  await shopper.click('main form button[type="submit"]');
  await shopper.waitForURL((u) => new URL(u).pathname === "/cuenta/notificaciones");
  await shopper.waitForSelector('h1:has-text("Notificaciones")');
  check(
    await shopper.locator("#aviso-email").isDisabled(),
    "e-mail cannot be switched off with an order open",
  );
  check(
    (await text(shopper.locator("main"))).includes(
      "No se puede desactivar mientras tenga un pedido en curso",
    ),
    "and the page says why",
  );
  check(
    !(await shopper.locator("#aviso-commercial").isChecked()),
    "commercial consent starts unticked",
  );
  check(!(await shopper.locator("#aviso-whatsapp").isChecked()), "WhatsApp starts off");

  await shopper.check("#aviso-whatsapp");
  await shopper.fill('main input[name="phone"]', "2222-1234");
  await shopper.click('main button:has-text("Guardar preferencias")');
  await shopper.waitForSelector('main [role="alert"]');
  const refusal = await text(shopper.locator('main [role="alert"]').first());
  check(/celular costarricense/.test(refusal), `a landline is refused: "${refusal}"`);
  check(
    (await shopper.inputValue('main input[name="phone"]')) === "2222-1234",
    "the form keeps what was typed",
  );
  check(await shopper.locator("#aviso-whatsapp").isChecked(), "and the choice");

  await shopper.fill('main input[name="phone"]', "8888-1234");
  await shopper.click('main button:has-text("Guardar preferencias")');
  await shopper.waitForSelector("text=Guardamos sus preferencias");
  await shopper.reload({ waitUntil: "networkidle" });
  check(await shopper.locator("#aviso-whatsapp").isChecked(), "WhatsApp saved");
  check((await shopper.inputValue('main input[name="phone"]')) === "88881234", "the number saved");
  await shopper.screenshot({ path: `${SHOTS}/n01-shopper-settings.png`, fullPage: true });

  const shopperPhone = await (await browser.newContext(phone)).newPage();
  watch(shopperPhone);
  await shopperPhone.goto(`${WEB}/ingresar?siguiente=/cuenta/notificaciones`, {
    waitUntil: "networkidle",
  });
  await shopperPhone.fill('main input[name="email"]', SHOPPER);
  await shopperPhone.fill('main input[name="password"]', PASSWORD);
  await shopperPhone.click('main form button[type="submit"]');
  await shopperPhone.waitForURL((u) => new URL(u).pathname === "/cuenta/notificaciones");
  await shopperPhone.waitForSelector('h1:has-text("Notificaciones")');
  check((await overflow(shopperPhone)) <= 0, "settings fit 390 px");
  const box = await shopperPhone.locator('label[for="aviso-whatsapp"]').boundingBox();
  check(box && box.height >= 44, `choices are at least 44 px tall (${box && box.height})`);
  await shopperPhone.screenshot({
    path: `${SHOTS}/n02-shopper-settings-phone.png`,
    fullPage: true,
  });

  // A tab left open does not silently undo what another tab saved since.
  await shopper.check("#aviso-commercial");
  await shopper.click('main button:has-text("Guardar preferencias")');
  await shopper.waitForSelector("text=Lo aceptó el");
  await shopperPhone.uncheck("#aviso-whatsapp");
  await shopperPhone.click('main button:has-text("Guardar preferencias")');
  await shopperPhone.waitForSelector('main [role="alert"]');
  check(
    /cambiaron en otra ventana/.test(
      await text(shopperPhone.locator('main [role="alert"]').first()),
    ),
    "a save from an out-of-date tab is refused, with a request to reload",
  );
  await shopperPhone.reload({ waitUntil: "networkidle" });
  check(
    (await shopperPhone.locator("#aviso-whatsapp").isChecked()) &&
      (await shopperPhone.locator("#aviso-commercial").isChecked()),
    "and nothing saved in the other tab was lost",
  );
  await shopper.uncheck("#aviso-commercial");
  await shopper.click('main button:has-text("Guardar preferencias")');
  await shopper.waitForSelector("text=Si no marca la casilla");

  // ── 2. The shopper orders, by SINPE Móvil ───────────────────────────────
  await shopper.goto(`${WEB}/p/cafe-molido-tarrazu-340g`, { waitUntil: "networkidle" });
  await shopper
    .locator('aside[aria-label="Comprar"] button:has-text("Agregar al carrito")')
    .click();
  await shopper.waitForSelector("text=Agregado al carrito");
  await shopper.goto(`${WEB}/pagar`, { waitUntil: "networkidle" });
  await shopper.waitForSelector("text=Resumen del pedido");
  await shopper.check('input[name="paymentMethod"][value="sinpe_movil"]');
  // The provider will accept the first WhatsApp message and later report it undelivered.
  await behave([{ mode: "fail_later", channel: "whatsapp", to: MOBILE, times: 1 }]);
  await shopper.click('button:has-text("Confirmar pedido")');
  await shopper.waitForURL((u) => /^\/pedidos\/YT-/.test(new URL(u).pathname));
  const orderNumber = new URL(shopper.url()).pathname.split("/").pop();
  log("order:", orderNumber);

  // ── 3. The worker sends; the fake records it ────────────────────────────
  const placedEmail = await until("the order e-mail", async () =>
    (await fakeGet(`?channel=email&template=order_placed&to=${SHOPPER}`)).find((m) =>
      m.subject.includes(orderNumber),
    ),
  );
  const placedWhatsApp = await until("the WhatsApp message", async () =>
    (
      await fakeGet(`?channel=whatsapp&template=order_placed&to=${encodeURIComponent(MOBILE)}`)
    ).find((m) => m.parameters && m.parameters.order_number === orderNumber),
  );
  check(
    placedEmail.subject === `Recibimos su pedido ${orderNumber}`,
    `e-mail subject: ${placedEmail.subject}`,
  );
  check(placedEmail.text.includes("Hola, María:"), "addressed by first name");
  check(
    placedEmail.text.includes("instrucciones de la página del pedido"),
    "points to the order page to pay",
  );
  check(placedEmail.text.includes(`/pedidos/${orderNumber}`), "links the order page");
  check(
    placedEmail.html.includes('lang="es-CR"') && placedEmail.html.includes("Yuntera"),
    "branded HTML",
  );
  check(placedWhatsApp.parameters.first_name === "María", "WhatsApp template parameters");
  check(placedWhatsApp.parameters.button_url === orderNumber, "WhatsApp button opens the order");

  // The provider reports through the signed webhook: the e-mail delivered,
  // the WhatsApp message not.
  const fakeMessage = async (channel, id) =>
    (await fakeGet(`?channel=${channel}`)).find((m) => m.id === id);
  await until(
    "delivery reports",
    async () =>
      (await fakeMessage("email", placedEmail.id))?.status === "delivered" &&
      (await fakeMessage("whatsapp", placedWhatsApp.id))?.status === "failed",
  );
  log("webhooks:", placedEmail.id, "delivered,", placedWhatsApp.id, "failed after sending");

  // ── 4. Staff find the undelivered message and send it again ─────────────
  const staff = await (await browser.newContext(desktop)).newPage();
  watch(staff);
  await staff.goto(`${OPS}/ingresar`, { waitUntil: "networkidle" });
  await staff.fill('main input[name="email"]', "central@yuntera.example");
  await staff.fill('main input[name="password"]', PASSWORD);
  await staff.click('main form button[type="submit"]');
  await staff.waitForURL((u) => new URL(u).pathname === "/");
  check(
    (await text(staff.locator("nav"))).includes("Mensajes"),
    "the console lists Mensajes for an admin",
  );
  await staff.goto(`${OPS}/mensajes`, { waitUntil: "networkidle" });
  const failedRow = staff
    .locator("main li", { hasText: "Pedido recibido" })
    .filter({ hasText: orderNumber })
    .filter({ hasText: "WhatsApp" });
  await until(
    "the undelivered WhatsApp message among the stuck ones",
    async () => {
      await staff.reload({ waitUntil: "networkidle" });
      return (await failedRow.count()) === 1;
    },
    20,
  );
  const failedText = await text(failedRow);
  check(
    /No entregado/.test(failedText) && /no llegó a la persona/.test(failedText),
    `failed after sending: ${failedText}`,
  );
  check(!/message_undeliverable/.test(failedText), "no provider code on screen");
  await failedRow.locator('button:has-text("Reenviar")').click();
  await staff.waitForSelector("text=Lo enviamos de nuevo");
  const resentWhatsApp = await until("the resent WhatsApp message", async () =>
    (
      await fakeGet(`?channel=whatsapp&template=order_placed&to=${encodeURIComponent(MOBILE)}`)
    ).find(
      (m) =>
        m.parameters &&
        m.parameters.order_number === orderNumber &&
        /\/1$/.test(m.idempotencyKey) &&
        m.status === "delivered",
    ),
  );
  check(resentWhatsApp.id !== placedWhatsApp.id, "sent again as a new request, and delivered");
  const messagesOf = async () => {
    await staff.goto(`${OPS}/pedidos/${orderNumber}`, { waitUntil: "networkidle" });
    return (await staff.locator('section[aria-labelledby="mensajes"] li').allInnerTexts()).map(
      (t) => t.replace(/\s+/g, " "),
    );
  };
  // One line of the list: this template, on this channel, to the shopper, delivered.
  const line = (lines, template, channel) =>
    lines.find((l) => l.startsWith(`${template} ${channel} · Cliente`) && l.endsWith("Entregado"));
  // ── 5. Staff see them delivered ─────────────────────────────────────────
  const delivered = await until(
    "the console to show both delivered",
    async () => {
      const lines = await messagesOf();
      return line(lines, "Pedido recibido", "Correo") && line(lines, "Pedido recibido", "WhatsApp")
        ? lines
        : null;
    },
    20,
  );
  log("console:", delivered);
  check(!delivered.join(" ").includes("Hola, María"), "staff do not see the message body");
  check(!delivered.join(" ").includes(MOBILE), "nor the address");
  await staff.screenshot({ path: `${SHOTS}/n03-ops-order-messages.png`, fullPage: true });

  // ── 6. The fake rejects the shopper's address; the message dies ─────────
  await behave([{ mode: "reject", channel: "email", to: SHOPPER }]);
  await shopper.goto(`${WEB}/pedidos/${orderNumber}`, { waitUntil: "networkidle" });
  await shopper.click('button:visible:has-text("Simular pago")');
  await shopper.waitForSelector("text=Su código de entrega", { timeout: 15000 });
  const pin = (
    await shopper.locator('section:visible:has-text("Su código de entrega") p').first().innerText()
  ).trim();
  check(/^\d{4}$/.test(pin), "the shopper sees the delivery code");

  await until("the rejected attempt", async () => {
    const attempts = await (await fake.get(`${FAKE}/_fake/attempts`)).json();
    return attempts.some((a) => a.channel === "email" && a.to === SHOPPER && a.status === 422);
  });
  await staff.goto(`${OPS}/mensajes`, { waitUntil: "networkidle" });
  const deadRow = staff
    .locator("main li", { hasText: "Pago recibido" })
    .filter({ hasText: orderNumber });
  await until(
    "the dead letter in the console",
    async () => {
      await staff.reload({ waitUntil: "networkidle" });
      return (await deadRow.count()) === 1;
    },
    20,
  );
  const deadText = await text(deadRow);
  check(
    /Detenido/.test(deadText) && /el proveedor rechazó el mensaje/.test(deadText),
    `dead letter: ${deadText}`,
  );
  check(!/\b422\b/.test(deadText), "no error code on screen");
  await staff.screenshot({ path: `${SHOTS}/n04-ops-dead-letters.png`, fullPage: true });

  // ── 7. The fake recovers; staff send it again; it soft-bounces once; ────
  //       the worker retries by itself under a new key; it arrives once.
  await behave([{ mode: "bounce_later", channel: "email", to: SHOPPER, times: 1 }]);
  await deadRow.locator('button:has-text("Reenviar")').click();
  await staff.waitForSelector("text=Lo enviamos de nuevo");
  const paidOf = async () =>
    (await fakeGet(`?channel=email&template=payment_received&to=${SHOPPER}`)).filter((m) =>
      m.subject.includes(orderNumber),
    );
  const paidEmail = await until(
    "the e-mail sent again after the soft bounce",
    async () => (await paidOf()).find((m) => m.status === "delivered"),
    60,
  );
  check(paidEmail.subject === `Recibimos el pago de su pedido ${orderNumber}`, "payment e-mail");
  await new Promise((resolve) => setTimeout(resolve, 5000)); // a few more worker ticks
  const accepted = await paidOf();
  check(
    accepted.map((m) => `${m.idempotencyKey.split("/").pop()}:${m.status}`).join(" ") ===
      "1:failed 2:delivered",
    `staff's resend (/1) bounced softly, the worker's own retry (/2) arrived: ${accepted
      .map((m) => `${m.idempotencyKey} ${m.status}`)
      .join(", ")}`,
  );
  check(accepted.filter((m) => m.status === "delivered").length === 1, "delivered once");

  // No message about this order carries the delivery code.
  const all = (await fakeGet("")).filter(
    (m) =>
      (m.subject || "").includes(orderNumber) ||
      (m.parameters && m.parameters.order_number === orderNumber),
  );
  check(all.length >= 3, `messages about the order: ${all.length}`);
  for (const m of all) {
    const blob = [m.subject, m.text, m.html, JSON.stringify(m.parameters || {})].join(" ");
    check(
      !new RegExp(`\\b${pin}\\b`).test(blob),
      `${m.channel} ${m.template} has no delivery code`,
    );
  }

  const settled = await until(
    "the resent message delivered in the console",
    async () => {
      const lines = await messagesOf();
      return line(lines, "Pago recibido", "Correo") ? lines : null;
    },
    20,
  );
  log("console after retry:", settled);
  await staff.screenshot({ path: `${SHOTS}/n05-ops-order-after-retry.png`, fullPage: true });

  // ── 8. What the shopper received, as they would see it ─────────────────
  const mail = await (await browser.newContext(phone)).newPage();
  await mail.goto(`${FAKE}/_fake/messages/${paidEmail.id}/html`, { waitUntil: "load" });
  check((await overflow(mail)) <= 0, "the e-mail fits a 390 px phone");
  await mail.screenshot({ path: `${SHOTS}/n06-email-phone.png`, fullPage: true });
  const mailDesk = await (await browser.newContext(desktop)).newPage();
  await mailDesk.goto(`${FAKE}/_fake/messages/${placedEmail.id}/html`, { waitUntil: "load" });
  await mailDesk.screenshot({ path: `${SHOTS}/n07-email-desktop.png`, fullPage: true });

  // ── 9. The shop's settings, and the console at phone width ─────────────
  const seller = await (await browser.newContext(phone)).newPage();
  watch(seller);
  await seller.goto(`${SELLER}/ingresar`, { waitUntil: "networkidle" });
  await seller.fill('main input[name="email"]', "vendedor@yuntera.example");
  await seller.fill('main input[name="password"]', PASSWORD);
  await seller.click('main form button[type="submit"]');
  await seller.waitForURL((u) => new URL(u).pathname === "/");
  await seller.goto(`${SELLER}/cuenta/notificaciones`, { waitUntil: "networkidle" });
  await seller.waitForSelector('h1:has-text("Notificaciones")');
  check(await seller.locator("#aviso-email").isDisabled(), "a shop's e-mail is always on");
  check(
    (await seller.locator("#aviso-sms").count()) === 0,
    "a shop is not offered SMS, which it would never get",
  );
  await seller.check("#aviso-whatsapp");
  await seller.fill('main input[name="phone"]', "8702-3344");
  await seller.click('main button:has-text("Guardar preferencias")');
  await seller.waitForSelector("text=Guardamos las preferencias de su tienda");
  check((await overflow(seller)) <= 0, "the shop's settings fit 390 px");
  await seller.screenshot({ path: `${SHOTS}/n08-seller-settings-phone.png`, fullPage: true });

  const staffPhone = await (await browser.newContext(phone)).newPage();
  watch(staffPhone);
  await staffPhone.goto(`${OPS}/ingresar`, { waitUntil: "networkidle" });
  await staffPhone.fill('main input[name="email"]', "central@yuntera.example");
  await staffPhone.fill('main input[name="password"]', PASSWORD);
  await staffPhone.click('main form button[type="submit"]');
  await staffPhone.waitForURL((u) => new URL(u).pathname === "/");
  await staffPhone.goto(`${OPS}/pedidos/${orderNumber}`, { waitUntil: "networkidle" });
  check((await overflow(staffPhone)) <= 0, "the order's messages fit 390 px");
  await staffPhone.goto(`${OPS}/mensajes`, { waitUntil: "networkidle" });
  check((await overflow(staffPhone)) <= 0, "the dead letters fit 390 px");
  await staffPhone.screenshot({ path: `${SHOTS}/n09-ops-messages-phone.png`, fullPage: true });

  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  await fake.dispose();
  if (errors.length) process.exit(1);
})().catch((e) => {
  console.error("FAILED:", e.message.slice(0, 600));
  process.exit(1);
});
