// Limits journey: a shop invites someone who accepts; a seller asks for a new contact phone
// and a new shop name, staff approve one and reject the other with a reason the seller reads;
// a visitor's report about a listing that does not exist is refused politely and a repeated
// report is counted once; a suspended driver is told the account has no access.
//
// A journey drives the real app in a real browser against a freshly seeded
// database. It fails when a step does not arrive where it should, when the
// browser logs an error, or when any response is a 5xx.

const { chromium, request } = require("playwright");
const web = require("../lib/web.cjs");
const seller = require("../lib/seller.cjs");
const ops = require("../lib/ops.cjs");
const field = require("../lib/field.cjs");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const log = (...a) => console.log(...a);
const expect = (condition, message) => {
  if (!condition) throw new Error("expected: " + message);
};

// Asks the API directly, as a given person, what the database now says.
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
  const overflow = (page) =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const phone = () =>
    browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      locale: "es-CR",
    });

  // 1. A shop invites a member, who accepts
  const ownerContext = await phone();
  const owner = await ownerContext.newPage();
  watch(owner);
  await seller.signInLandingOn(owner, "sendero@yuntera.example", "/");
  await seller.open(owner, "/equipo");
  log("invitation to a malformed address:", await seller.inviteRefused(owner, "persona@correo"));
  const sent = await seller.invite(owner, "comprador2@yuntera.example", "staff");
  log("invitation sent:", sent);
  expect(sent.includes("comprador2@yuntera.example"), "the owner is told the invitation went out");
  await owner.reload({ waitUntil: "networkidle" });
  const waiting = await seller.pendingInvitations(owner);
  log("waiting:", waiting.slice(0, 160));
  expect(waiting.includes("comprador2@yuntera.example"), "the invitation waits for an answer");
  expect((await overflow(owner)) <= 0, "the team page fits a phone");
  await owner.screenshot({ path: SHOTS + "/l1-team-invited.png", fullPage: true });
  const before = await rpcAs("comprador2@yuntera.example", "my_roles");
  expect(before.sellers.length === 0, "being invited does not make anyone a member");

  const memberContext = await phone();
  const member = await memberContext.newPage();
  watch(member);
  // Someone with no shop lands on registration, which points to the invitation.
  await seller.signInLandingOn(member, "comprador2@yuntera.example", "/registro");
  log("registration says:", await seller.followInvitationNotice(member));
  log("invitation:", (await seller.invitationFrom(member, "Tienda Sendero")).slice(0, 200));
  expect((await overflow(member)) <= 0, "the invitation fits a phone");
  await member.screenshot({ path: SHOTS + "/l2-invitation.png", fullPage: true });
  log("after accepting:", await seller.acceptInvitation(member, "Tienda Sendero"));
  const after = await rpcAs("comprador2@yuntera.example", "my_roles");
  expect(
    after.sellers.some((s) => s.slug === "tienda-sendero" && s.role === "staff"),
    "accepting makes them staff of the shop",
  );
  // Leaving asks for a confirmation, and says afterwards what happened.
  await seller.open(member, "/equipo");
  log("after leaving:", await seller.leaveTeam(member));
  const gone = await rpcAs("comprador2@yuntera.example", "my_roles");
  expect(gone.sellers.length === 0, "leaving ends the membership");
  await memberContext.close();

  // 2. The seller asks for a new contact phone and a new shop name
  await seller.open(owner, "/cuenta");
  const refusedName = await seller.askShopNameRefused(owner, "Yuntera Oficial");
  log("a name that imitates the platform:", refusedName);
  expect(
    refusedName.includes("parece de Yuntera"),
    "a name like the platform's is refused, plainly",
  );
  await seller.askShopName(owner, "Sendero Aventura");
  await seller.askContactPhone(owner, "2289-0999");
  // While the contact change waits, the payout account cannot be changed.
  await owner.reload({ waitUntil: "networkidle" });
  const payout = await seller.payoutSection(owner);
  expect(
    payout.text.includes("Hay un cambio del teléfono o el correo de la tienda en revisión"),
    "the payout form waits for the contact change",
  );
  expect(payout.ibanFields === 0, "and is not offered meanwhile");
  // A fiscal change that only touches the address keeps the postal code on file.
  const postal = await seller.fiscalPostalCode(owner);
  log("postal code the fiscal form starts from:", postal);
  expect(postal === "10203", "the fiscal form starts from the postal code on file");
  await seller.askFiscalAddress(owner, "Escazú, San Rafael, Plaza Colonial local 5, segundo piso");
  const shopNow = await seller.shopDetailsText(owner);
  log("waiting for staff:", shopNow.all.slice(0, 300));
  expect(shopNow.facts.includes("Tienda Sendero"), "the name does not change before staff decide");
  expect((await overflow(owner)) <= 0, "the account page fits a phone");
  await owner.screenshot({ path: SHOTS + "/l3-account-requests.png", fullPage: true });

  // 3. Staff approve the phone and reject the name, with a reason
  const staffContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "es-CR",
  });
  const staff = await staffContext.newPage();
  watch(staff);
  await ops.signIn(staff, "central@yuntera.example");
  const nav = await ops.sectionsNav(staff);
  expect(nav.includes("Cambios de tienda"), "the console has the queue in its menu");
  await ops.open(staff, "/cambios-tienda");
  const queued = await ops.changesWaiting(staff);
  log("staff queue:", queued);
  expect(queued === 3, "the three requests wait");
  await staff.screenshot({ path: SHOTS + "/l4a-staff-queue-waiting.png", fullPage: true });
  const contactCard = await ops.changeCardText(staff, "contact");
  log("contact card:", contactCard.slice(0, 260));
  expect(contactCard.includes("2289-0404"), "the number to call is the one on file");
  await ops.approveChange(staff, "contact");
  await ops.approveChange(staff, "fiscal");
  log("rejection without a reason:", await ops.rejectChangeWithoutReason(staff, "shop_name"));
  await ops.rejectChange(
    staff,
    "shop_name",
    "El nombre debe coincidir con el que tiene inscrito en Hacienda.",
  );
  await staff.screenshot({ path: SHOTS + "/l4b-staff-queue-decided.png", fullPage: true });

  // 4. The seller reads the outcome
  await seller.open(owner, "/cuenta");
  const outcome = (await seller.shopDetailsText(owner)).all;
  log("seller reads:", outcome.slice(0, 420));
  expect(outcome.includes("No aprobamos el cambio de nombre"), "the rejection is shown");
  expect(outcome.includes("inscrito en Hacienda"), "with the reason staff wrote");
  expect(outcome.includes("2289-0999"), "and the approved phone is the shop's now");
  const onFile = await rpcAs("sendero@yuntera.example", "seller_shop_changes", {
    p_seller_id: (await rpcAs("sendero@yuntera.example", "my_roles")).sellers[0].id,
  });
  log("fiscal details on file now:", JSON.stringify(onFile.current.fiscal));
  expect(
    onFile.current.fiscal.postal_code === "10203" &&
      onFile.current.fiscal.fiscal_address.includes("segundo piso"),
    "the approved address is applied and the postal code survived",
  );
  await owner.screenshot({ path: SHOTS + "/l5-account-outcome.png", fullPage: true });
  await ownerContext.close();

  // 5. A visitor reports: a listing that does not exist, then the same listing twice
  const visitorContext = await phone();
  const visitor = await visitorContext.newPage();
  watch(visitor);
  const queueBefore = await rpcAs("central@yuntera.example", "ops_care_queues");
  await web.open(visitor, "/reportar?producto=00000000-0000-4000-8000-000000000000");
  const fillReport = (email) =>
    web.sendReport(visitor, {
      reason: "counterfeit",
      details: "La marca del empaque no es la original.",
      email,
    });
  await fillReport("ana@correo.example");
  const missing = await web.firstMessage(visitor, "alert");
  log("report about a listing that does not exist:", missing);
  expect(missing.includes("No encontramos eso en la tienda"), "it is refused, politely");
  expect(!/report_target|not_found/.test(missing), "and no code is shown");
  expect((await web.reportReason(visitor)) === "counterfeit", "what was typed is kept");
  await visitor.screenshot({ path: SHOTS + "/l6-report-refused.png", fullPage: true });

  for (const attempt of [1, 2]) {
    await web.open(visitor, "/p/licuadora-volcan-600w");
    await web.openReport(visitor);
    await fillReport("Ana@Correo.example");
    log(`report ${attempt}:`, await web.firstMessage(visitor, "status"));
  }
  expect((await overflow(visitor)) <= 0, "the report page fits a phone");
  await visitor.screenshot({ path: SHOTS + "/l7-report-sent.png", fullPage: true });
  const queueAfter = await rpcAs("central@yuntera.example", "ops_care_queues");
  log("reports waiting:", queueBefore.totals.reports, "->", queueAfter.totals.reports);
  expect(
    queueAfter.totals.reports === queueBefore.totals.reports + 1,
    "the same report twice is counted once",
  );
  await visitorContext.close();

  // 6. A driver is suspended, and the field app says so
  await ops.open(staff, "/repartidores");
  const luis = await ops.setDriverStatus(staff, "Luis Alvarado Cruz", "suspended");
  log("driver row:", luis.slice(0, 120));
  await staffContext.close();

  const driverContext = await phone();
  const driver = await driverContext.newPage();
  watch(driver);
  await field.signInLandingOn(driver, "repartidor2@yuntera.example", "/sin-acceso");
  const said = await field.suspendedNotice(driver);
  log("the suspended driver sees:", said.slice(0, 260));
  expect(said.includes("Su cuenta de repartidor está suspendida"), "the driver is told plainly");
  expect(!said.includes("Mi ruta"), "and sees no route");
  await field.open(driver, "/ruta");
  expect(new URL(driver.url()).pathname === "/sin-acceso", "the route page is closed to them");
  const day = await rpcAs("repartidor2@yuntera.example", "driver_today");
  expect(Array.isArray(day.routes) && day.routes.length === 0, "and the API gives no stops");
  expect((await overflow(driver)) <= 0, "the explanation fits a phone");
  await driver.screenshot({ path: SHOTS + "/l8-driver-suspended.png", fullPage: true });
  await driverContext.close();

  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => {
  console.error("FAILED:", e.message.slice(0, 700));
  process.exit(1);
});
