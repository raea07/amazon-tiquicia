// Lists every link and button shorter than 44 px on a phone (390 px wide,
// touch), over the main pages the journeys visit in the four web apps, that is
// not part of running text (a link inside a sentence is measured by the line,
// as the accessibility rules allow). Not a journey: it prints a list and exits
// 1 when the list is not empty, so it can be run by hand against a lane:
//
//   eval "$(tools/dev/stack.sh env 15)" && node tools/e2e/touch-targets.cjs
//
// Pages are read signed in as the demo account of each app.

const { chromium } = require("playwright");

const WEB = process.env.WEB_URL || "http://127.0.0.1:3000";
const SELLER = process.env.SELLER_URL || "http://127.0.0.1:3001";
const OPS = process.env.OPS_URL || "http://127.0.0.1:3002";
const FIELD = process.env.FIELD_URL || "http://127.0.0.1:3003";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";

const APPS = [
  {
    base: WEB,
    who: "comprador@yuntera.example",
    pages: [
      "/",
      "/buscar?q=libreta",
      "/p/libreta-tapa-dura-a5",
      "/carrito",
      "/zona",
      "/ayuda",
      "/cuenta",
      "/cuenta/notificaciones",
      "/pedidos",
      "#first-order",
    ],
  },
  {
    base: SELLER,
    who: "vendedor@yuntera.example",
    pages: [
      "/",
      "/productos",
      "/productos/ofrecer",
      "/pedidos",
      "/inventario",
      "/pagos",
      "/cuenta",
      "/cuenta/notificaciones",
    ],
  },
  {
    base: OPS,
    who: "central@yuntera.example",
    pages: [
      "/",
      "/pedidos",
      "#first-order",
      "/catalogo",
      "/despacho",
      "/operacion/cierres",
      "/pagos-vendedores",
    ],
  },
  {
    base: FIELD,
    who: "bodega@yuntera.example",
    pages: ["/bodega", "/bodega/ubicaciones", "#first-location", "/bodega/buscar"],
  },
  { base: FIELD, who: "repartidor@yuntera.example", pages: ["/ruta", "#first-stop"] },
];

/** In the page: the controls under 44 px tall, not inside running text. */
function small() {
  const out = [];
  for (const el of document.querySelectorAll(
    'a[href], button, [role="button"], summary, input[type="submit"], select',
  )) {
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") continue;
    if (box.height >= 43.5) continue;
    // Running text: the block around it says more than the control itself.
    let block = el.parentElement;
    while (block && getComputedStyle(block).display.startsWith("inline"))
      block = block.parentElement;
    const own = (el.innerText || el.value || "").trim();
    const around = (block?.innerText || "").trim();
    if (around.length > own.length + 3) continue;
    out.push({
      text: own.slice(0, 60) || el.getAttribute("aria-label") || el.tagName,
      height: Math.round(box.height),
    });
  }
  return out;
}

(async () => {
  const browser = await chromium.launch();
  const found = [];
  for (const app of APPS) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      locale: "es-CR",
    });
    const page = await context.newPage();
    await page.goto(`${app.base}/ingresar`, { waitUntil: "networkidle" });
    await page.fill('main input[name="email"]', app.who);
    await page.fill('main input[name="password"]', PASSWORD);
    await page.click('main form button[type="submit"]');
    await page.waitForURL((u) => new URL(u).pathname !== "/ingresar");
    let last = "";
    for (let path of app.pages) {
      if (path.startsWith("#")) {
        // The first order, location or stop of the page read before.
        const pattern = {
          "#first-order": /\/pedidos\/YT-/,
          "#first-location": /\/bodega\/ubicacion\?codigo=/,
          "#first-stop": /\/ruta\/[0-9a-f-]{36}/,
        }[path];
        const hrefs = await page
          .locator("a[href]")
          .evaluateAll((as) => as.map((a) => a.getAttribute("href")));
        path = hrefs.find((h) => pattern.test(h ?? "")) ?? "";
        if (!path) continue;
      }
      await page.goto(`${app.base}${path}`, { waitUntil: "networkidle" }).catch(() => undefined);
      last = path;
      for (const s of await page.evaluate(small))
        found.push(`${app.base}${last} | ${s.height} px | ${s.text}`);
    }
    await context.close();
  }
  await browser.close();
  console.log(found.length ? found.join("\n") : "No control under 44 px outside running text.");
  process.exit(found.length ? 1 : 0);
})();
