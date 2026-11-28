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
const web = require("../lib/web.cjs");
const seller = require("../lib/seller.cjs");
const ops = require("../lib/ops.cjs");
const { word } = require("../lib/words.cjs");
const kit = require("../lib/kit.cjs");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const FAKE = process.env.FAKE_PROVIDERS_URL || "http://127.0.0.1:54323";
const SHOPPER = "comprador@yuntera.example";
const MOBILE = "+50688881234";
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
  const overflow = (page) => kit.overflowPx(page);

  // ── 1. The shopper chooses WhatsApp ─────────────────────────────────────
  const shopper = await (await browser.newContext(desktop)).newPage();
  watch(shopper);
  await web.signIn(shopper, SHOPPER, { next: "/cuenta/notificaciones" });
  await shopper.waitForURL((u) => new URL(u).pathname === "/cuenta/notificaciones");
  await web.waitForNotificationSettings(shopper);
  check(
    (await web.channelState(shopper, "email")).disabled,
    "e-mail cannot be switched off with an order open",
  );
  check(
    (await web.mainText(shopper)).includes(
      "No se puede desactivar mientras tenga un pedido en curso",
    ),
    "and the page says why",
  );
  check(
    !(await web.channelState(shopper, "commercial")).checked,
    "commercial consent starts unticked",
  );
  check(!(await web.channelState(shopper, "whatsapp")).checked, "WhatsApp starts off");

  await web.setChannel(shopper, "whatsapp", true);
  await web.typeMobile(shopper, "2222-1234");
  const refusal = await web.savePreferencesRefused(shopper);
  check(/celular costarricense/.test(refusal), `a landline is refused: "${refusal}"`);
  check((await web.mobileTyped(shopper)) === "2222-1234", "the form keeps what was typed");
  check((await web.channelState(shopper, "whatsapp")).checked, "and the choice");

  await web.typeMobile(shopper, "8888-1234");
  await web.savePreferencesUntil(shopper, /Guardamos sus preferencias/);
  await shopper.reload({ waitUntil: "networkidle" });
  check((await web.channelState(shopper, "whatsapp")).checked, "WhatsApp saved");
  check((await web.mobileTyped(shopper)) === "88881234", "the number saved");
  await shopper.screenshot({ path: `${SHOTS}/n01-shopper-settings.png`, fullPage: true });

  const shopperPhone = await (await browser.newContext(phone)).newPage();
  watch(shopperPhone);
  await web.signIn(shopperPhone, SHOPPER, { next: "/cuenta/notificaciones" });
  await shopperPhone.waitForURL((u) => new URL(u).pathname === "/cuenta/notificaciones");
  await web.waitForNotificationSettings(shopperPhone);
  check((await overflow(shopperPhone)) <= 0, "settings fit 390 px");
  const box = await web.channelLabel(shopperPhone, "whatsapp").boundingBox();
  check(box && box.height >= 44, `choices are at least 44 px tall (${box && box.height})`);
  await shopperPhone.screenshot({
    path: `${SHOTS}/n02-shopper-settings-phone.png`,
    fullPage: true,
  });

  // A tab left open does not silently undo what another tab saved since.
  await web.setChannel(shopper, "commercial", true);
  await web.savePreferencesUntil(shopper, /Lo aceptó el/);
  await web.setChannel(shopperPhone, "whatsapp", false);
  check(
    /cambiaron en otra ventana/.test(await web.savePreferencesRefused(shopperPhone)),
    "a save from an out-of-date tab is refused, with a request to reload",
  );
  await shopperPhone.reload({ waitUntil: "networkidle" });
  check(
    (await web.channelState(shopperPhone, "whatsapp")).checked &&
      (await web.channelState(shopperPhone, "commercial")).checked,
    "and nothing saved in the other tab was lost",
  );
  await web.setChannel(shopper, "commercial", false);
  await web.savePreferencesUntil(shopper, /Si no marca la casilla/);

  // ── 2. The shopper orders, by SINPE Móvil ───────────────────────────────
  await web.open(shopper, "/p/cafe-molido-tarrazu-340g");
  await web.addToCart(shopper);
  await web.openCheckout(shopper);
  await web.choosePayment(shopper, "sinpe_movil");
  // The provider will accept the first WhatsApp message and later report it undelivered.
  await behave([{ mode: "fail_later", channel: "whatsapp", to: MOBILE, times: 1 }]);
  await web.confirmOrder(shopper);
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
  await ops.signInHome(staff, "central@yuntera.example");
  check(
    (await ops.sectionsNav(staff)).includes("Mensajes"),
    "the console lists Mensajes for an admin",
  );
  await ops.open(staff, "/mensajes");
  await until(
    "the undelivered WhatsApp message among the stuck ones",
    async () => {
      await staff.reload({ waitUntil: "networkidle" });
      return (await ops.stuckCount(staff, "order_placed", "whatsapp", orderNumber)) === 1;
    },
    20,
  );
  const failedText = await ops.stuckText(staff, "order_placed", "whatsapp", orderNumber);
  check(
    failedText.includes(word("notification_deliveries", "failed", { viewer: "staff" })) &&
      /no llegó a la persona/.test(failedText),
    `failed after sending: ${failedText}`,
  );
  check(!/message_undeliverable/.test(failedText), "no provider code on screen");
  await ops.resend(staff, "order_placed", "whatsapp", orderNumber);
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
    await ops.openOrder(staff, orderNumber);
    return ops.orderMessages(staff);
  };
  // One line of the list: this template, on this channel, to the shopper, delivered.
  const line = (lines, template, channel) => ops.deliveredLine(lines, template, channel);
  // ── 5. Staff see them delivered ─────────────────────────────────────────
  const delivered = await until(
    "the console to show both delivered",
    async () => {
      const lines = await messagesOf();
      return line(lines, "order_placed", "email") && line(lines, "order_placed", "whatsapp")
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
  await web.openOrder(shopper, orderNumber);
  await web.simulatePayment(shopper);
  const pin = await web.deliveryPin(shopper);
  check(/^\d{4}$/.test(pin), "the shopper sees the delivery code");

  await until("the rejected attempt", async () => {
    const attempts = await (await fake.get(`${FAKE}/_fake/attempts`)).json();
    return attempts.some((a) => a.channel === "email" && a.to === SHOPPER && a.status === 422);
  });
  await ops.open(staff, "/mensajes");
  await until(
    "the dead letter in the console",
    async () => {
      await staff.reload({ waitUntil: "networkidle" });
      return (await ops.stuckCount(staff, "payment_received", "email", orderNumber)) === 1;
    },
    20,
  );
  const deadText = await ops.stuckText(staff, "payment_received", "email", orderNumber);
  check(
    deadText.includes(word("notification_deliveries", "dead", { viewer: "staff" })) &&
      /el proveedor rechazó el mensaje/.test(deadText),
    `dead letter: ${deadText}`,
  );
  check(!/\b422\b/.test(deadText), "no error code on screen");
  await staff.screenshot({ path: `${SHOTS}/n04-ops-dead-letters.png`, fullPage: true });

  // ── 7. The fake recovers; staff send it again; it soft-bounces once; ────
  //       the worker retries by itself under a new key; it arrives once.
  await behave([{ mode: "bounce_later", channel: "email", to: SHOPPER, times: 1 }]);
  await ops.resend(staff, "payment_received", "email", orderNumber);
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
      return line(lines, "payment_received", "email") ? lines : null;
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
  const shopOwner = await (await browser.newContext(phone)).newPage();
  watch(shopOwner);
  await seller.signInHome(shopOwner, "vendedor@yuntera.example");
  await seller.open(shopOwner, "/cuenta/notificaciones");
  await seller.waitForNotificationSettings(shopOwner);
  check((await seller.channelState(shopOwner, "email")).disabled, "a shop's e-mail is always on");
  check(
    (await seller.channelState(shopOwner, "sms")).offered === 0,
    "a shop is not offered SMS, which it would never get",
  );
  await seller.setChannel(shopOwner, "whatsapp", true);
  await seller.typeMobile(shopOwner, "8702-3344");
  await seller.savePreferencesUntil(shopOwner, /Guardamos las preferencias de su tienda/);
  check((await overflow(shopOwner)) <= 0, "the shop's settings fit 390 px");
  await shopOwner.screenshot({ path: `${SHOTS}/n08-seller-settings-phone.png`, fullPage: true });

  const staffPhone = await (await browser.newContext(phone)).newPage();
  watch(staffPhone);
  await ops.signInHome(staffPhone, "central@yuntera.example");
  await ops.openOrder(staffPhone, orderNumber);
  check((await overflow(staffPhone)) <= 0, "the order's messages fit 390 px");
  await ops.open(staffPhone, "/mensajes");
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
