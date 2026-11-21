// Seller, driver and warehouse apps (skeletons), web export, at phone size.
//
// For each app: a visitor sees the sign-in screen; an account without the
// app's role (the demo shopper) is told plainly it has no access and can sign
// out; an account with the role reaches the home screen, which reads its data
// from the API. Fails on any console error, uncaught exception or 5xx, except
// the auth server's 400 for a wrong password (not exercised here).

const { chromium } = require("playwright");

const SHOTS = process.env.NATIVE_SHOTS || require("node:os").tmpdir();
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const log = (...args) => console.log(...args);

const APPS = [
  {
    name: "seller",
    url: process.env.NATIVE_SELLER_URL || "http://127.0.0.1:3011",
    member: "vendedor@yuntera.example",
    home: "seller-overview",
  },
  {
    name: "driver",
    url: process.env.NATIVE_DRIVER_URL || "http://127.0.0.1:3012",
    member: "repartidor@yuntera.example",
    home: "driver-route",
  },
  {
    name: "warehouse",
    url: process.env.NATIVE_WAREHOUSE_URL || "http://127.0.0.1:3013",
    member: "bodega@yuntera.example",
    home: "warehouse-board",
  },
];

function check(condition, message) {
  if (!condition) throw new Error(message);
  log("  ok:", message);
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  for (const app of APPS) {
    log(`  ${app.name}:`);
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: "es-CR",
    });
    const page = await context.newPage();
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`${app.name} console: ${m.text().slice(0, 300)}`);
    });
    page.on("pageerror", (e) => errors.push(`${app.name} pageerror: ${String(e).slice(0, 300)}`));
    page.on("response", (r) => {
      if (r.status() >= 500) errors.push(`${app.name} HTTP ${r.status()} ${r.url()}`);
    });
    const byId = (id) => page.getByTestId(id).first();
    const signIn = async (email) => {
      await byId("sign-in-email").fill(email);
      await byId("sign-in-password").fill(PASSWORD);
      await byId("sign-in-submit").click();
    };

    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await byId("sign-in-email").waitFor();
    check(true, "a visitor sees the sign-in screen");
    await page.screenshot({ path: `${SHOTS}/native-${app.name}-01-sign-in.png` });

    await signIn("comprador@yuntera.example");
    await byId("no-access").waitFor();
    const text = (await byId("no-access").innerText()).replace(/\s+/g, " ");
    check(/no (tiene acceso|administra)/.test(text), "an account without the role is told so");
    check(/pídale|registre/i.test(text), "and what to do next");
    await page.screenshot({ path: `${SHOTS}/native-${app.name}-02-no-access.png` });
    await page.getByText("Salir e ingresar con otra cuenta").first().click();
    await byId("sign-in-email").waitFor();

    await signIn(app.member);
    await byId(app.home).waitFor();
    log("   ", (await byId(app.home).innerText()).replace(/\s+/g, " ").slice(0, 140));
    check(true, "an account with the role reaches the home screen and its data");
    check(
      (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0,
      "no sideways scrolling at 390 px",
    );
    await page.screenshot({ path: `${SHOTS}/native-${app.name}-03-home.png` });
    await byId("sign-out").click();
    await byId("sign-in-email").waitFor();
    check(true, "signed out");
    await context.close();
  }
  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((error) => {
  console.error("FAILED:", String(error.message ?? error).slice(0, 800));
  process.exit(1);
});
