// Error reports journey: what each website sends to the error tracker when
// something fails, and that nothing is sent when no tracker is configured.
//
// In each of the four websites it signs in (typing an e-mail and a password),
// opens the page with the most personal data on it (the shopper's order with
// its delivery code, the seller's orders, the console's order page, the
// driver's route), makes an error happen in the browser on purpose, and opens
// /prueba-de-errores, a page that fails on the server on purpose (it exists
// only on this machine and in the lanes) and shows the website's error page,
// at 390 px wide.
//
// With the tracker off (every ordinary lane): the error page does not claim
// the team was told, the security policy names no tracker, and the browser
// asks nothing of the stand-in's port (and, as in every journey, of no host
// that is not this machine: lib/local-only.cjs).
//
// With the stand-in (ERROR_TRACKER=standin tools/dev/stack.sh up <lane>): the
// reports of each website arrive at its own project number, say which
// website, environment and commit they come from, and carry none of the
// personal data that was typed, shown or sent: no e-mail, phone, name,
// address, delivery code, password, session cookie, query string, header,
// user or breadcrumb.

const { chromium } = require("playwright");
const { readFileSync, existsSync } = require("node:fs");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const ON = process.env.ERROR_TRACKER_ON === "1";
const LOG = process.env.ERROR_TRACKER_LOG || "";
const TRACKER = process.env.ERROR_TRACKER_URL || "http://127.0.0.1:54327";
const log = (...a) => console.log(...a);

const SITES = [
  {
    app: "web",
    base: process.env.WEB_URL || "http://127.0.0.1:3000",
    project: 1,
    email: "comprador@yuntera.example",
  },
  {
    app: "seller",
    base: process.env.SELLER_URL || "http://127.0.0.1:3001",
    project: 2,
    email: "vendedor@yuntera.example",
    page: "/pedidos",
  },
  {
    app: "ops",
    base: process.env.OPS_URL || "http://127.0.0.1:3002",
    project: 3,
    email: "central@yuntera.example",
  },
  {
    app: "field",
    base: process.env.FIELD_URL || "http://127.0.0.1:3003",
    project: 4,
    email: "repartidor@yuntera.example",
    page: "/ruta",
  },
];

// The seed's people and the shopper's address (supabase/seed.sql): none of it
// may reach the tracker. More is added as the journey goes (the delivery code
// read off the screen, the session cookies).
const FORBIDDEN = [
  PASSWORD,
  "yuntera.example",
  "María",
  "Fernández",
  "Solís",
  "Andrés",
  "Sofía",
  "Roberto",
  "Jiménez",
  "Carlos",
  "Méndez",
  "Gabriela",
  "88881234",
  "8888-1234",
  "+50688881234",
  "Hispanidad",
  "portón",
  "66XQWWMX",
  "ana.prueba",
  "1-0234-0567",
  "eyJ",
  "sb-",
  "correo=",
  "tel=",
  "Mozilla",
  "cookie",
];

const errors = [];
const expect = (condition, message) => {
  if (!condition) errors.push(message);
  return condition;
};
// The errors this journey causes on purpose are not failures.
const deliberate = (text) =>
  /Prueba (de errores|en )|Server Components render|digest|prueba-de-errores/.test(text);

async function rpcAs(email) {
  const token = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: KEY, "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  }).then((r) => r.json());
  return async (fn, args = {}) => {
    const r = await fetch(`${API}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: KEY,
        authorization: `Bearer ${token.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(args),
    });
    if (!r.ok) throw new Error(`${fn}: ${r.status}`);
    return r.json();
  };
}

/**
 * The text of what was sent, without the fields that are numbers by nature
 * (event ids, times, line and column numbers), so a 4-digit delivery code is
 * not found by chance inside one of them.
 */
const sentText = (bodies) =>
  bodies
    .join("\n")
    .replace(/"(event_id|trace_id|span_id|debug_id)":"[0-9a-f-]+"/g, "")
    .replace(/"(timestamp|sent_at|lineno|colno)":("[^"]*"|[\d.]+)/g, "");

/** What reached the stand-in so far, as parsed envelopes. */
const arrivals = () =>
  LOG && existsSync(LOG)
    ? readFileSync(LOG, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];

async function waitForEvents(project, count, since, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const mine = arrivals()
      .slice(since)
      .filter((a) => a.path === `/api/${project}/envelope/`);
    const events = mine.flatMap((a) => a.items.filter((i) => i.header.type === "event"));
    if (events.length >= count || Date.now() > deadline) return { mine, events };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

(async () => {
  // The order whose delivery code the shopper sees.
  const shopper = await rpcAs("comprador@yuntera.example");
  let order = null;
  for (const o of await shopper("my_orders")) {
    const detail = await shopper("get_order", { p_order_number: o.order_number });
    if (detail.delivery_pin) {
      order = { number: o.order_number, pin: String(detail.delivery_pin) };
      break;
    }
  }
  if (!order) throw new Error("the seed has no order with a delivery code to show");
  FORBIDDEN.push(order.pin);
  SITES[0].page = `/pedidos/${order.number}`;
  SITES[2].page = `/pedidos/${order.number}`;
  log("mode:", ON ? `stand-in tracker at ${TRACKER}` : "tracker off", "| order:", order.number);

  const browser = await chromium.launch();
  for (const site of SITES) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "es-CR",
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    const toTracker = [];
    page.on("request", (r) => {
      if (r.url().startsWith(TRACKER)) toTracker.push(r);
    });
    // With the stand-in, wait until the browser has posted the report, so
    // leaving the page does not drop it; without it, a moment is enough.
    const sent = async (count) => {
      if (!ON) return page.waitForTimeout(300);
      const deadline = Date.now() + 15_000;
      while (toTracker.length < count && Date.now() < deadline) await page.waitForTimeout(100);
      expect(
        toTracker.length >= count,
        `${site.app}: the browser posted ${toTracker.length} of ${count} reports`,
      );
    };
    page.on("console", (m) => {
      // On the failing page, React says (as error #441 in a production build)
      // that a server render failed: that is the drill itself.
      const drill = page.url().includes("/prueba-de-errores") && /error #441\b/.test(m.text());
      if (m.type() === "error" && !deliberate(m.text()) && !drill) {
        errors.push(`${site.app} console: ${m.text().slice(0, 200)}`);
      }
    });
    page.on("pageerror", (e) => {
      if (!deliberate(String(e))) errors.push(`${site.app} pageerror: ${String(e).slice(0, 200)}`);
    });
    page.on("response", (r) => {
      if (r.status() >= 500 && !r.url().includes("/prueba-de-errores")) {
        errors.push(`${site.app} HTTP ${r.status()} ${r.url()}`);
      }
    });

    // Only what arrives from here on counts for this website.
    const before = arrivals().length;

    // 1. Sign-in: an error while the e-mail and the password are in the form.
    const signIn = await page.goto(`${site.base}/ingresar`, { waitUntil: "networkidle" });
    const csp = signIn.headers()["content-security-policy"] || "";
    const connect = (csp.split("; ").find((d) => d.startsWith("connect-src")) || "").trim();
    if (ON) {
      expect(
        connect.endsWith(`${TRACKER}/api/${site.project}/envelope/`),
        `${site.app}: connect-src should name the stand-in's ingest address, is "${connect}"`,
      );
    } else {
      expect(
        !/envelope|sentry|ingest/.test(csp),
        `${site.app}: the policy names a tracker: ${connect}`,
      );
    }
    await page.fill('main input[name="email"]', site.email);
    await page.fill('main input[name="password"]', PASSWORD);
    await page.evaluate((email) => {
      setTimeout(() => {
        throw new Error(`Prueba en ingreso: ${email}, teléfono 8888-1234`);
      });
    }, site.email);
    await sent(1);
    await page.click('main form button[type="submit"]');
    await page.waitForURL((u) => !new URL(u).pathname.startsWith("/ingresar"), { timeout: 20_000 });
    for (const cookie of await context.cookies()) {
      if (cookie.value.length >= 12) FORBIDDEN.push(cookie.value.slice(0, 24));
    }

    // 2. The page with the most personal data, and an error on it.
    if (site.page) await page.goto(site.base + site.page, { waitUntil: "networkidle" });
    let shown = "";
    if (site.app === "web") {
      shown = await page.locator('section:has-text("Su código de entrega") p').first().innerText();
      expect(
        shown.trim() === order.pin,
        `web: the order page should show the delivery code, shows "${shown}"`,
      );
    }
    await page.evaluate((code) => {
      setTimeout(() => {
        throw new Error(`Prueba en pantalla: código de entrega ${code}`);
      });
    }, shown.trim() || order.pin);
    await sent(2);

    // 3. A page that fails on the server, with personal data in its address.
    await page.goto(
      `${site.base}/prueba-de-errores?correo=ana.prueba%40example.com&tel=8888-1234`,
      { waitUntil: "networkidle" },
    );
    const screen = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    expect(
      screen.includes("Algo falló de nuestro lado"),
      `${site.app}: error page says "${screen.slice(0, 160)}"`,
    );
    expect(
      !/digest|Error:|stack|\bat \w+/.test(screen),
      `${site.app}: the error page shows technical detail`,
    );
    expect(
      screen.includes("Ya le avisamos al equipo de Yuntera.") === ON,
      `${site.app}: "team told" should appear only with a tracker (${ON ? "on" : "off"})`,
    );
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(wide <= 390, `${site.app}: the error page is ${wide} px wide at 390`);
    await page.screenshot({ path: `${SHOTS}/er-${site.app}-error-page.png`, fullPage: true });
    log(`${site.app}: error page:`, screen.slice(0, 200));

    if (!ON) {
      await page.waitForTimeout(1500);
      expect(
        toTracker.length === 0,
        `${site.app}: ${toTracker.length} requests went to the tracker's port`,
      );
      await context.close();
      continue;
    }

    // 4. What arrived: the two browser errors and the server's.
    const { mine, events } = await waitForEvents(site.project, 3, before);
    log(
      `${site.app}: ${events.length} reports arrived:`,
      events
        .map((e) => `${e.payload.platform}: ${e.payload.exception?.values?.[0]?.value}`)
        .join(" | "),
    );
    expect(events.length >= 3, `${site.app}: expected 3 reports, ${events.length} arrived`);
    const body = sentText(mine.map((a) => a.body));
    for (const word of FORBIDDEN) {
      expect(!body.includes(word), `${site.app}: "${word.slice(0, 12)}…" reached the tracker`);
    }
    expect(
      mine.every((a) => a.items.every((i) => i.header.type === "event")),
      `${site.app}: something other than an error was sent`,
    );
    expect(
      mine.every((a) => !a.cookie),
      `${site.app}: a cookie was sent to the tracker`,
    );
    const platforms = new Set(events.map((e) => e.payload.platform));
    expect(
      platforms.has("javascript") && platforms.has("node"),
      `${site.app}: browser and server should both report`,
    );
    for (const { payload } of events) {
      expect(
        payload.tags?.app === site.app,
        `${site.app}: report tagged ${JSON.stringify(payload.tags)}`,
      );
      expect(payload.environment === "local", `${site.app}: environment ${payload.environment}`);
      expect(
        new RegExp(`^yuntera-${site.app}@[0-9a-f]{12}$`).test(payload.release || ""),
        `${site.app}: release ${payload.release}`,
      );
      for (const key of ["user", "breadcrumbs", "extra"]) {
        expect(payload[key] === undefined, `${site.app}: report has ${key}`);
      }
      expect(!payload.request?.headers, `${site.app}: report has request headers`);
      const value = payload.exception?.values?.[0]?.value || "";
      expect(value.startsWith("Prueba"), `${site.app}: unexpected report "${value.slice(0, 80)}"`);
    }
    const server = events.find((e) => e.payload.platform === "node")?.payload;
    expect(
      /^Prueba de errores: pedido de \[email\], teléfono \[phone\], cédula \[number\], código de entrega \[code\], token \[token\] \(vez [0-9a-z]+\)$/.test(
        server?.exception?.values?.[0]?.value || "",
      ),
      `${site.app}: the server's report reads "${server?.exception?.values?.[0]?.value}"`,
    );
    await context.close();
  }
  await browser.close();

  if (errors.length) {
    console.error("FAILED:\n  " + errors.join("\n  "));
    process.exit(1);
  }
  log(`\nerror-reports journey passed (${ON ? "stand-in tracker" : "tracker off"})`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
