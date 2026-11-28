// Error reports journey: what each website sends to the error tracker when
// something fails, and that nothing is sent when no tracker is configured.
//
// In each of the four websites it signs in (typing an e-mail and a password),
// opens the page with the most personal data on it (the shopper's order with
// its delivery code, the seller's orders, the console's order page, the
// driver's route), makes an error happen in the browser on purpose, and opens
// /prueba-de-errores, a page that fails on the server on purpose (it exists
// only on this machine and in the lanes) and shows the website's error page,
// at 390 px wide. Then it makes a page fail while rendering in the browser
// (/prueba-de-errores?en=navegador), and checks that "Intentar de nuevo"
// fetches a page that failed once on the server again
// (/prueba-de-errores?una-vez=<mark>).
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
//
// Screen steps are in lib/kit.cjs (the error pages and the sign-in form are
// next-kit's, the same in the four websites), lib/web.cjs and lib/ops.cjs.

const { chromium } = require("playwright");
const kit = require("../lib/kit.cjs");
const web = require("../lib/web.cjs");
const ops = require("../lib/ops.cjs");
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

/** The path of a reported page address, or undefined if it is not one. */
const pathOf = (url) => /^https?:\/\/[^/?#\s]+(\/[^?#\s]*)$/.exec(url)?.[1];

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

/**
 * 7. The support desk's pages (wave 9), whose screens hold the most personal
 * text of all: the web shop's complaint form while text is typed in it, a
 * case page with the complaint, an internal note and an answer, and the
 * customer view after "Mostrar contacto" showed the e-mail and phone. On
 * each, an error in the browser; on the two console pages also a failure on
 * the server (the function behind the page renamed for a moment, as a broken
 * deploy would leave it). No report may carry any of those texts, the reason
 * typed for the reveal, the customer's name, phone, e-mail or address, the
 * order's delivery code or a query string.
 */
async function supportDesk(browser, order) {
  const { spawnSync } = require("node:child_process");
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not set: run through tools/dev/stack.sh e2e");
  const sql = (statement) => {
    const run = spawnSync(
      "psql",
      [DATABASE_URL, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", statement],
      { encoding: "utf8" },
    );
    if (run.status !== 0) throw new Error(`psql: ${run.stderr}`);
    return run.stdout.trim();
  };
  const shop = SITES[0];
  const console_ = SITES[2];
  const secret = {
    complaint: "Zafiro del reclamo",
    note: "Ónix de la nota interna",
    answer: "Turquesa de la respuesta",
    reason: "Ámbar del motivo para llamar",
  };
  const words = [...Object.values(secret), "nota=", "correo%40", order.pin];
  const before = arrivals().length;
  const context = async () => {
    const c = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "es-CR",
      isMobile: true,
      hasTouch: true,
    });
    const page = await c.newPage();
    // Here the failures are on purpose: only an unexpected page error counts.
    // React's error #419 is how the browser hears that the server could not
    // finish a Suspense boundary, which failOnServer causes on purpose.
    page.on("pageerror", (e) => {
      if (!deliberate(String(e)) && !/Minified React error #419/.test(String(e)))
        errors.push(`support desk pageerror: ${String(e).slice(0, 200)}`);
    });
    return { c, page };
  };
  const signIn = async (page, site) => {
    await page.goto(`${site.base}/ingresar`, { waitUntil: "networkidle" });
    await kit.typeSignIn(page, site.email, PASSWORD);
    await kit.sendSignIn(page);
    await page.waitForURL((u) => !new URL(u).pathname.startsWith("/ingresar"), { timeout: 20_000 });
  };
  const browserError = (page, what) =>
    page.evaluate((w) => {
      setTimeout(() => {
        throw new Error(`Prueba en ${w}`);
      });
    }, what);
  // Breaks the function behind a console page while it is reloaded.
  const failOnServer = async (page, fn, signature) => {
    sql(`alter function public.${fn}(${signature}) rename to ${fn}_prueba_196`);
    try {
      await page.reload({ waitUntil: "networkidle" });
      await kit.waitForErrorPage(page);
    } finally {
      sql(`alter function public.${fn}_prueba_196(${signature}) rename to ${fn}`);
    }
  };

  // The shopper types a complaint with their delivery code in it; an error
  // happens while the text is in the form; then it is sent.
  const shopper = await context();
  await signIn(shopper.page, shop);
  await web.openComplaintForm(shopper.page, order.number);
  await web.fillComplaint(shopper.page, {
    category: "delivery",
    description: `${secret.complaint}: el repartidor no llegó. Mi código es ${order.pin}.`,
  });
  await browserError(shopper.page, "reclamo");
  await shopper.page.waitForTimeout(ON ? 2500 : 500);
  await web.sendComplaint(shopper.page);
  const caseId =
    sql(`select k.id from private.cases k join public.complaints c on c.id = k.complaint_id
    where c.description like '${secret.complaint}%' order by k.created_at desc limit 1`);
  const userId = sql(`select user_id from private.cases where id = '${caseId}'`);
  await shopper.c.close();

  // The administrator notes and answers the case, opens it with a query in
  // its address, and an error happens there; then the server fails.
  const staff = await context();
  await signIn(staff.page, console_);
  await ops.openCase(staff.page, caseId);
  await ops.writeCaseNote(staff.page, `${secret.note}, llamar en la tarde.`);
  await ops.caseNoteSaved(staff.page);
  await ops.typeCaseAnswer(staff.page, `${secret.answer}: le enviamos el pedido mañana.`);
  await ops.answerCase(staff.page);
  await ops.open(staff.page, `/casos/${caseId}?nota=${encodeURIComponent(secret.note)}`);
  const shownCase = await ops.mainText(staff.page);
  expect(
    shownCase.includes(secret.note) && shownCase.includes(secret.answer),
    "support desk: the case page shows the note and the answer",
  );
  expect(
    !shownCase.includes(order.pin) && shownCase.includes("••••"),
    "support desk: staff read the customer's own delivery code masked",
  );
  await browserError(staff.page, "caso");
  await staff.page.waitForTimeout(ON ? 2500 : 500);
  await failOnServer(staff.page, "ops_case", "uuid");
  await staff.page.screenshot({ path: `${SHOTS}/er-ops-case-failed.png`, fullPage: true });

  // The customer view, after "Mostrar contacto": then the browser and the
  // server fail with the contact on the screen.
  await ops.openCustomer(staff.page, userId);
  await ops.revealContact(staff.page, secret.reason, shop.email);
  await browserError(staff.page, "cliente");
  await staff.page.waitForTimeout(ON ? 2500 : 500);
  await failOnServer(staff.page, "ops_customer", "uuid");
  await staff.c.close();

  if (!ON) return;
  // Web: the complaint form's browser report. Console: two browser reports and
  // two from the server.
  const shopReports = await waitForEvents(shop.project, 1, before);
  const consoleReports = await waitForEvents(console_.project, 4, before);
  const fromDesk = [...shopReports.events, ...consoleReports.events].filter((e) =>
    /Prueba en (reclamo|caso|cliente)|ops_(case|customer)/.test(JSON.stringify(e.payload)),
  );
  expect(
    shopReports.events.some((e) =>
      /Prueba en reclamo/.test(e.payload.exception?.values?.[0]?.value || ""),
    ),
    "support desk: the complaint form's error was reported",
  );
  expect(
    consoleReports.events.filter((e) => e.payload.platform === "node").length >= 2,
    `support desk: the two server failures were reported (${consoleReports.events.length} console reports)`,
  );
  log(
    "support desk:",
    fromDesk.length,
    "reports:",
    fromDesk
      .map((e) => `${e.payload.platform}: ${e.payload.exception?.values?.[0]?.value}`)
      .join(" | "),
  );
  const body = sentText([...shopReports.mine, ...consoleReports.mine].map((a) => a.body));
  for (const word of [...FORBIDDEN, ...words]) {
    expect(!body.includes(word), `support desk: "${word.slice(0, 14)}…" reached the tracker`);
  }
  for (const { payload } of [...shopReports.events, ...consoleReports.events]) {
    const where =
      payload.platform === "node"
        ? `http://host${payload.contexts?.nextjs?.request_path || ""}`
        : payload.request?.url || "";
    expect(!/[?#]/.test(where), `support desk: a report names the page with a query: ${where}`);
  }
}

(async () => {
  // The order whose delivery code the shopper sees.
  const shopper = await rpcAs("comprador@yuntera.example");
  let order = null;
  for (const o of await shopper("my_orders")) {
    const detail = await shopper("get_order", {
      p_order_number: o.order_number,
    });
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
    const onDrill = (text) =>
      page.url().includes("/prueba-de-errores") && /error #(441|419)\b/.test(text);
    page.on("console", (m) => {
      // On the failing page, React says (as error #441 in a production build,
      // and as the recoverable error #419 when it renders the failed part again)
      // that a server render failed: that is the drill itself.
      const drill = onDrill(m.text());
      if (m.type() === "error" && !deliberate(m.text()) && !drill) {
        errors.push(`${site.app} console: ${m.text().slice(0, 200)}`);
      }
    });
    page.on("pageerror", (e) => {
      if (!deliberate(String(e)) && !onDrill(String(e)))
        errors.push(`${site.app} pageerror: ${String(e).slice(0, 200)}`);
    });
    page.on("response", (r) => {
      if (r.status() >= 500 && !r.url().includes("/prueba-de-errores")) {
        errors.push(`${site.app} HTTP ${r.status()} ${r.url()}`);
      }
    });

    // Only what arrives from here on counts for this website.
    const before = arrivals().length;

    // 1. Sign-in: an error while the e-mail and the password are in the form.
    const signIn = await page.goto(`${site.base}/ingresar`, {
      waitUntil: "networkidle",
    });
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
    await kit.typeSignIn(page, site.email, PASSWORD);
    await page.evaluate((email) => {
      setTimeout(() => {
        throw new Error(`Prueba en ingreso: ${email}, teléfono 8888-1234`);
      });
    }, site.email);
    await sent(1);
    await kit.sendSignIn(page);
    await page.waitForURL((u) => !new URL(u).pathname.startsWith("/ingresar"), {
      timeout: 20_000,
    });
    for (const cookie of await context.cookies()) {
      if (cookie.value.length >= 12) FORBIDDEN.push(cookie.value.slice(0, 24));
    }

    // 2. The page with the most personal data, and an error on it. The
    // address carries a query, which must not reach the tracker.
    const dataPage = site.page || new URL(page.url()).pathname;
    await page.goto(`${site.base}${dataPage}?correo=ana.prueba%40example.com`, {
      waitUntil: "networkidle",
    });
    let shown = "";
    if (site.app === "web") {
      shown = await web.deliveryPin(page);
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
    const screen = await kit.pageText(page);
    expect(
      screen.includes("Algo falló de nuestro lado"),
      `${site.app}: error page says "${screen.slice(0, 160)}"`,
    );
    expect(
      !/digest|Error:|stack|\bat \w+/.test(screen),
      `${site.app}: the error page shows technical detail`,
    );
    const told = async (where) => {
      if (!ON) await page.waitForTimeout(500);
      const says = await kit.teamToldShown(page, ON ? 15_000 : 0);
      expect(
        says === ON,
        `${site.app} ${where}: "team told" should appear only with a tracker (${ON ? "on" : "off"})`,
      );
    };
    await told("server failure");
    const over = await kit.overflowPx(page);
    expect(over <= 0, `${site.app}: the error page is ${over} px wider than 390`);
    await page.screenshot({
      path: `${SHOTS}/er-${site.app}-error-page.png`,
      fullPage: true,
    });
    log(`${site.app}: error page:`, screen.slice(0, 200));

    // 4. A failure while rendering in the browser: the error page catches it
    // and reports it from there.
    await page.goto(`${site.base}/prueba-de-errores?en=navegador`, { waitUntil: "load" });
    await kit.waitForErrorPage(page);
    await told("browser failure");
    await sent(3);

    // 5. "Intentar de nuevo" fetches the page from the server again: this
    // one fails the first time only.
    const mark = Date.now().toString(36);
    await page.goto(`${site.base}/prueba-de-errores?una-vez=${mark}`, { waitUntil: "load" });
    await kit.waitForErrorPage(page);
    const recovered = await kit.retryErrorPage(page);
    expect(recovered, `${site.app}: "Intentar de nuevo" did not fetch the page again`);

    if (!ON) {
      await page.waitForTimeout(1500);
      expect(
        toTracker.length === 0,
        `${site.app}: ${toTracker.length} requests went to the tracker's port`,
      );
      await context.close();
      continue;
    }

    // 6. What arrived: the three browser errors and the server's two.
    const { mine, events } = await waitForEvents(site.project, 5, before);
    log(
      `${site.app}: ${events.length} reports arrived:`,
      events
        .map((e) => `${e.payload.platform}: ${e.payload.exception?.values?.[0]?.value}`)
        .join(" | "),
    );
    expect(events.length >= 5, `${site.app}: expected 5 reports, ${events.length} arrived`);
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
      // React's own word that the drill's failed part was rendered again
      // (#419) may also arrive from the drill page.
      const drillEcho =
        /error #419\b/.test(value) && pathOf(payload.request?.url || "") === "/prueba-de-errores";
      expect(
        value.startsWith("Prueba") || drillEcho,
        `${site.app}: unexpected report "${value.slice(0, 80)}"`,
      );
      // Which page failed, without its query: the browser names the page's
      // address (here the host is 127.0.0.1, which the IP rule replaces), the
      // server the request's path.
      const where =
        payload.platform === "node"
          ? `http://host${payload.contexts?.nextjs?.request_path || ""}`
          : payload.request?.url || "";
      expect(
        pathOf(where) !== undefined && !/[?#]/.test(where),
        `${site.app}: report names the page as "${where}"`,
      );
      // None of these was handled by the page's code.
      const mechanism = payload.exception?.values?.[0]?.mechanism || {};
      expect(
        mechanism.handled === false,
        `${site.app}: report marked handled (${JSON.stringify(mechanism)})`,
      );
    }
    const browserPaths = events
      .filter((e) => e.payload.platform === "javascript")
      .map((e) => pathOf(e.payload.request?.url || ""));
    expect(
      browserPaths.includes(dataPage) && browserPaths.includes("/prueba-de-errores"),
      `${site.app}: browser reports name the pages ${JSON.stringify(browserPaths)}`,
    );
    expect(
      events.some(
        (e) =>
          e.payload.platform === "javascript" &&
          e.payload.exception?.values?.[0]?.mechanism?.type === "auto.browser.error_page",
      ),
      `${site.app}: the error page did not report the browser failure`,
    );
    const server = events.find((e) => e.payload.platform === "node")?.payload;
    expect(
      /^Prueba de errores: pedido de \[email\], teléfono \[phone\]\. Cédula \[number\]\. Código de entrega \[code\]\. token \[token\] \(vez [0-9a-z]+\)$/.test(
        server?.exception?.values?.[0]?.value || "",
      ),
      `${site.app}: the server's report reads "${server?.exception?.values?.[0]?.value}"`,
    );
    await context.close();
  }
  await supportDesk(browser, order);
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
