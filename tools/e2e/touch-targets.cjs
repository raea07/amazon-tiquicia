// Lists every link and button shorter than 44 px on a phone (390 px wide,
// touch), over the main pages the journeys visit in the four web apps, that is
// not part of running text (a link inside a sentence is measured by the line,
// as the accessibility rules allow). Not a journey: it prints a list and exits
// 1 when the list is not empty, so it can be run by hand against a lane:
//
//   eval "$(tools/dev/stack.sh env 15)" && node tools/e2e/touch-targets.cjs
//
// Pages are read signed in as the demo account of each app. Since the wave 8
// follow-ups it also reads a category page of the shop (its breadcrumb) and a
// refunded order in the console ("Ver en Cobros"), and since wave 9 the
// complaint form, «Sus consultas», Casos with a case, its saved answers and
// monthly report, and Salud del sistema. The seed has no refunded
// order: when the console lists none, the script makes one first, as the
// demo shopper comprador3 through the API (a card order paid in the
// simulation and cancelled at once), and says so. Likewise, when Casos lists
// no case, it files a complaint as comprador3 first.

const { chromium, request } = require("playwright");

const WEB = process.env.WEB_URL || "http://127.0.0.1:3000";
const SELLER = process.env.SELLER_URL || "http://127.0.0.1:3001";
const OPS = process.env.OPS_URL || "http://127.0.0.1:3002";
const FIELD = process.env.FIELD_URL || "http://127.0.0.1:3003";
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";

/** A refunded order for the console to show, made through the API when there is none. */
async function refundedOrder() {
  const ctx = await request.newContext();
  const token = await ctx.post(`${API}/auth/v1/token?grant_type=password`, {
    headers: { apikey: KEY },
    data: { email: "comprador3@yuntera.example", password: PASSWORD },
  });
  const { access_token } = await token.json();
  const rpc = async (fn, args = {}) => {
    const r = await ctx.post(`${API}/rest/v1/rpc/${fn}`, {
      headers: { apikey: KEY, authorization: `Bearer ${access_token}` },
      data: args,
    });
    const body = await r.json().catch(() => null);
    if (r.status() >= 400) throw new Error(`${fn}: ${r.status()} ${JSON.stringify(body)}`);
    return body;
  };
  try {
    const address = (await rpc("my_addresses")).find((a) => a.is_default);
    const product = await rpc("get_product", { p_slug: "libreta-tapa-dura-a5" });
    const offer = product.skus.flatMap((k) => k.offers).find((o) => o.fulfillment === "platform");
    const placed = await rpc("place_order", {
      p_items: [{ offer_id: offer.offer_id, quantity: 1 }],
      p_address_id: address.id,
      p_payment_method: "card",
      p_idempotency_key: `touch-targets-${Date.now()}`,
    });
    await rpc("confirm_sandbox_payment", { p_order_id: placed.order_id });
    await rpc("cancel_order", {
      p_order_id: placed.order_id,
      p_reason: "Cancelado por el cliente",
    });
    console.log(`Made the refunded order ${placed.order_number} for the console's page.`);
  } finally {
    await ctx.dispose();
  }
}

/** A case for Casos to show, filed as comprador3 through the API when Casos lists none. */
async function aCase() {
  const ctx = await request.newContext();
  try {
    const token = await ctx.post(`${API}/auth/v1/token?grant_type=password`, {
      headers: { apikey: KEY },
      data: { email: "comprador3@yuntera.example", password: PASSWORD },
    });
    const { access_token } = await token.json();
    const r = await ctx.post(`${API}/rest/v1/rpc/file_complaint`, {
      headers: { apikey: KEY, authorization: `Bearer ${access_token}` },
      data: { p_category: "other", p_description: "Consulta de prueba para medir los controles." },
    });
    if (r.status() >= 400) throw new Error(`file_complaint: ${r.status()} ${await r.text()}`);
    console.log("Filed a complaint for Casos to list.");
  } finally {
    await ctx.dispose();
  }
}

const APPS = [
  {
    base: WEB,
    who: "comprador@yuntera.example",
    pages: [
      "/",
      "/buscar?q=libreta",
      "/c/cafe",
      "/p/libreta-tapa-dura-a5",
      "/carrito",
      "/zona",
      "/ayuda",
      "/cuenta",
      "/cuenta/notificaciones",
      "/pedidos",
      "#first-order",
      "/reclamo",
      "/cuenta/casos",
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
      "/pedidos?estado=refunded",
      "#refunded-order",
      "/catalogo",
      "/despacho",
      "/operacion/cierres",
      "/pagos-vendedores",
      "/casos",
      "#first-case",
      "/casos/respuestas",
      "/casos/informe",
      "/salud",
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
    let box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    // A link stretched over its card (an absolute ::after filling the nearest
    // positioned ancestor, as the shop's product cards do): the card is the target.
    const after = getComputedStyle(el, "::after");
    if (after.position === "absolute" && after.content !== "none") {
      let holder = el.parentElement;
      while (holder && getComputedStyle(holder).position === "static")
        holder = holder.parentElement;
      if (holder) box = holder.getBoundingClientRect();
    }
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
          "#refunded-order": /\/pedidos\/YT-/,
          "#first-case": /\/casos\/[0-9a-f-]{36}/,
          "#first-location": /\/bodega\/ubicacion\?codigo=/,
          "#first-stop": /\/ruta\/[0-9a-f-]{36}/,
        }[path];
        const links = () =>
          page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
        let hrefs = await links();
        if (path === "#refunded-order" && !hrefs.some((h) => pattern.test(h ?? ""))) {
          await refundedOrder();
          await page.reload({ waitUntil: "networkidle" });
          hrefs = await links();
        }
        if (path === "#first-case" && !hrefs.some((h) => pattern.test(h ?? ""))) {
          await aCase();
          await page.reload({ waitUntil: "networkidle" });
          hrefs = await links();
        }
        const wanted = path;
        path = hrefs.find((h) => pattern.test(h ?? "")) ?? "";
        if (!path) {
          if (wanted === "#refunded-order") found.push(`${app.base} | no refunded order listed`);
          if (wanted === "#first-case") found.push(`${app.base} | no case listed in Casos`);
          continue;
        }
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
