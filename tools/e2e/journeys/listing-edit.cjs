// Listing-edit journey: a seller edits a published product, catalogue staff review it
// with old and new side by side, the shop changes only on approval, a rejected edit
// reaches the seller with its reason, and an archived product leaves the shop.
//
// A journey drives the real apps in a real browser against a freshly seeded
// database. It fails when a step does not arrive where it should, when the
// browser logs an error, or when any response is a 5xx.

const { chromium } = require("playwright");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const WEB = process.env.WEB_URL || "http://127.0.0.1:3000";
const SELLER = process.env.SELLER_URL || "http://127.0.0.1:3001";
const OPS = process.env.OPS_URL || "http://127.0.0.1:3002";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const log = (...a) => console.log(...a);
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, " ").trim();

const PRODUCT = "/p/laptop-14-nimbo-libro";
const NEW_TITLE = "Laptop Nimbo Libro 14 pulgadas, 8 GB de memoria";
const REFUSED_TITLE = "Laptop Nimbo Libro 14 pulgadas, la mejor del país";
const REASON = "El título no puede afirmar que es la mejor del país sin respaldo.";
const ARCHIVED = "/p/teclado-mecanico-compacto-nimbo";

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const check = (condition, message) => {
    if (!condition) errors.push(message);
  };
  const watch = (page) => {
    page.on("console", (m) => {
      if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200));
    });
    page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 200)));
    page.on("response", (r) => {
      if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`);
    });
  };
  const signIn = async (page, base, email) => {
    await page.goto(base + "/ingresar", { waitUntil: "networkidle" });
    await page.fill('main input[name="email"]', email);
    await page.fill('main input[name="password"]', PASSWORD);
    await page.click('main form button[type="submit"]');
    await page.waitForURL((u) => new URL(u).pathname === "/");
    await page.waitForSelector("main h1:visible, main h2:visible");
  };
  const overflow = (page) =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

  // Three people, three browsers: a shopper who is not signed in, the seller, and staff.
  // The shopper comes back several times. Each visit is a fresh browser: on a second
  // visit to the same page Chromium answers the page's link prefetches from its own
  // HTTP cache without ever reporting them finished, so "networkidle" never arrives.
  // (That happens on any page of the shop, /ayuda included, and is no server fault:
  // the same requests over plain HTTP answer at once.)
  let shopper;
  const shopTitle = async () => {
    await shopper?.context().close();
    shopper = await (await browser.newContext({ locale: "es-CR" })).newPage();
    watch(shopper);
    await shopper.goto(WEB + PRODUCT, { waitUntil: "networkidle" });
    return text(shopper.locator("main h1"));
  };

  const sellerContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "es-CR",
  });
  const seller = await sellerContext.newPage();
  watch(seller);
  const staffContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "es-CR",
  });
  const staff = await staffContext.newPage();
  watch(staff);

  // 0. What the shop says before anyone touches anything
  const oldTitle = await shopTitle();
  log("shop title at the start:", oldTitle);

  // 1. The seller opens the product from the list and finds the edit page
  await signIn(seller, SELLER, "vendedor@yuntera.example");
  if (!(await seller.locator("main h1:visible").innerText()).includes("TecnoCasa")) {
    await seller.selectOption("#shop", { label: "TecnoCasa" });
    await seller.click('header button:has-text("Cambiar")');
    await seller.waitForSelector('main h1:visible:has-text("TecnoCasa")');
  }
  await seller.goto(SELLER + "/productos", { waitUntil: "networkidle" });
  const row = seller.locator("main:visible tbody tr", { hasText: oldTitle });
  log("row in the list:", (await text(row)).slice(0, 110));
  await row.locator('a:has-text("Editar")').click();
  // (The title has a double quote in it, so it is matched as text, not inside a selector.)
  await seller.locator("main h1:visible", { hasText: oldTitle }).waitFor();
  const editUrl = seller.url();
  log("edit page state:", await text(seller.locator('main:visible [role="status"]').first()));
  await seller.screenshot({ path: SHOTS + "/le1-edit-published.png", fullPage: true });

  // sending it back unchanged is not an edit
  await seller.click('main:visible button:has-text("Enviar cambios a revisión")');
  await seller.locator('main:visible form [role="alert"]').first().waitFor();
  log("unchanged:", await text(seller.locator('main:visible form [role="alert"]').first()));

  // a form that comes back with an error keeps everything the seller chose, the category too
  const category = seller.locator('main:visible select[name="categorySlug"]');
  const startCategory = await category.inputValue();
  const otherCategory = await category.evaluate(
    (select, current) => [...select.options].find((o) => o.value && o.value !== current)?.value,
    startCategory,
  );
  await category.selectOption(otherCategory);
  await seller.fill('main:visible input[name="title"]', "abc");
  await seller.click('main:visible button:has-text("Enviar cambios a revisión")');
  await seller
    .locator('main:visible form [role="alert"]', { hasText: "al menos 5 letras" })
    .waitFor();
  const keptCategory = await category.inputValue();
  const keptTitle = await seller.locator('main:visible input[name="title"]').inputValue();
  log("after an error, category:", startCategory, "->", keptCategory, "| title:", keptTitle);
  check(keptCategory === otherCategory, `the chosen category was lost: ${keptCategory}`);
  check(keptTitle === "abc", `the typed title was lost: ${keptTitle}`);
  // start the real edit from what is published
  await seller.goto(editUrl, { waitUntil: "networkidle" });

  // the way back to the list is a full-size touch target
  const back = await seller.locator('main:visible a:has-text("← Productos")').boundingBox();
  log("back link height px:", back?.height);
  check((back?.height ?? 0) >= 44, `the back link is ${back?.height} px high`);

  // 2. The seller changes the title; it goes to review and the listing stays as it is
  await seller.fill('main:visible input[name="title"]', NEW_TITLE);
  await seller.click('main:visible button:has-text("Enviar cambios a revisión")');
  await seller.waitForSelector("main:visible >> text=Publicado; sus cambios están en revisión");
  log("after sending:", (await text(seller.locator("main:visible header").first())).slice(0, 120));
  const proposal = await text(seller.locator("main:visible dl").first());
  log("seller sees old and new:", proposal.slice(0, 200));
  check(proposal.includes(oldTitle) && proposal.includes(NEW_TITLE), "seller: no before/after");
  await seller.screenshot({ path: SHOTS + "/le2-edit-in-review.png", fullPage: true });
  await seller.goto(SELLER + "/productos", { waitUntil: "networkidle" });
  const state = await text(
    seller.locator("main:visible tbody tr", { hasText: oldTitle }).locator("td").nth(1),
  );
  log("state in the list:", state);
  check(
    state.includes("Publicado") && state.includes("Cambios en revisión"),
    "list: state missing",
  );

  // 3. The shop still shows the old title
  const stillOld = await shopTitle();
  log("shop while the edit waits:", stillOld);
  check(stillOld === oldTitle, `the shop changed before approval: ${stillOld}`);

  // 4. Catalogue staff see it apart from new products, old and new side by side
  await signIn(staff, OPS, "central@yuntera.example");
  log(
    "dashboard counts it:",
    (await text(staff.locator("main:visible >> text=Productos por revisar >> xpath=..")))
      .replace(/\s+/g, " ")
      .slice(0, 80),
  );
  await staff.goto(OPS + "/catalogo", { waitUntil: "networkidle" });
  log("catalogue sections:", await staff.locator("main:visible h2").allInnerTexts());
  const edit = staff.locator('main:visible section[aria-labelledby="cambios"] article').first();
  const card = await text(edit);
  log("edit card:", card.slice(0, 260));
  check(
    card.includes("Cambio a un producto publicado"),
    "staff: the edit is not marked as an edit",
  );
  // (The column labels are set in capitals by the style sheet, and innerText follows it.)
  const labels = card.toLowerCase();
  check(
    labels.includes("publicado ahora") && labels.includes("propuesto"),
    "staff: no side-by-side",
  );
  check(card.includes(oldTitle) && card.includes(NEW_TITLE), "staff: old or new title missing");
  check(
    !(await text(staff.locator('main:visible section[aria-labelledby="nuevos"]'))).includes(
      NEW_TITLE,
    ),
    "staff: the edit is listed among new products",
  );
  await staff.screenshot({ path: SHOTS + "/le3-review-before-after.png", fullPage: true });

  // the same screen on a phone
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: "es-CR",
  });
  const m = await phone.newPage();
  watch(m);
  await signIn(m, OPS, "central@yuntera.example");
  await m.goto(OPS + "/catalogo", { waitUntil: "networkidle" });
  log("mobile /catalogo overflow px:", await overflow(m));
  check((await overflow(m)) <= 0, "ops /catalogo scrolls sideways on a phone");
  await m.screenshot({ path: SHOTS + "/le4-review-mobile.png", fullPage: true });

  // 5. Approved: the shop shows the new title at once
  await edit.locator('button:has-text("Aprobar cambio")').click();
  await staff.waitForSelector(
    'main:visible section[aria-labelledby="cambios"] >> text=No hay cambios por revisar',
  );
  const nowNew = await shopTitle();
  log("shop after approval:", nowNew);
  check(nowNew === NEW_TITLE, `the shop does not show the approved title: ${nowNew}`);
  await shopper.screenshot({ path: SHOTS + "/le5-shop-new-title.png" });

  // 6. A second edit is rejected, and the seller reads why
  await seller.goto(editUrl, { waitUntil: "networkidle" });
  log(
    "seller after approval:",
    await text(seller.locator("main h1:visible")),
    "|",
    (await text(seller.locator('main:visible [role="status"]').first())).slice(0, 50),
  );
  await seller.fill('main:visible input[name="title"]', REFUSED_TITLE);
  await seller.click('main:visible button:has-text("Enviar cambios a revisión")');
  await seller.waitForSelector("main:visible >> text=Publicado; sus cambios están en revisión");

  await staff.goto(OPS + "/catalogo", { waitUntil: "networkidle" });
  const second = staff.locator('main:visible section[aria-labelledby="cambios"] article').first();
  await second.locator('button:has-text("Rechazar cambio")').click(); // no reason yet
  await second.locator('[role="alert"]').waitFor();
  log("reject without a reason:", await text(second.locator('[role="alert"]')));
  await second.locator('textarea[name="note"]').fill(REASON);
  await second.locator('button:has-text("Rechazar cambio")').click();
  await staff.waitForSelector(
    'main:visible section[aria-labelledby="cambios"] >> text=No hay cambios por revisar',
  );

  await seller.goto(editUrl, { waitUntil: "networkidle" });
  const refusal = await text(seller.locator('main:visible [role="alert"]').first());
  log("seller reads:", refusal.slice(0, 200));
  check(refusal.includes(REASON), "seller: the reason for the rejection is not shown");
  await seller.screenshot({ path: SHOTS + "/le6-edit-rejected.png", fullPage: true });
  await seller.goto(SELLER + "/productos", { waitUntil: "networkidle" });
  check(
    (await text(seller.locator("main:visible tbody tr", { hasText: NEW_TITLE }))).includes(REASON),
    "list: the rejected edit's reason is not shown",
  );
  const afterRefusal = await shopTitle();
  log("shop after the rejection:", afterRefusal);
  check(afterRefusal === NEW_TITLE, "a rejected edit changed the shop");

  // 7. The edit page on a phone
  const sellerPhone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: "es-CR",
    storageState: await sellerContext.storageState(),
  });
  const sm = await sellerPhone.newPage();
  watch(sm);
  await sm.goto(editUrl, { waitUntil: "networkidle" });
  log("mobile edit page overflow px:", await overflow(sm));
  check((await overflow(sm)) <= 0, "the seller's edit page scrolls sideways on a phone");
  await sm.screenshot({ path: SHOTS + "/le7-edit-mobile.png", fullPage: true });
  await sellerPhone.close();

  // 8. The seller archives another product; it leaves the shop
  const archivedBefore = await shopper.request.get(WEB + ARCHIVED);
  log("product to archive, before:", archivedBefore.status());
  check(archivedBefore.status() === 200, "the product to archive was not in the shop");
  await seller.goto(SELLER + "/productos", { waitUntil: "networkidle" });
  await seller
    .locator("main:visible tbody tr", { hasText: "Teclado" })
    .locator('a:has-text("Editar")')
    .click();
  await seller.waitForSelector('main h1:visible:has-text("Teclado")');
  const archive = seller.locator('main:visible section[aria-labelledby="archivar"]');
  await archive.locator('input[name="confirma"]').check();
  await archive.locator('button:has-text("Archivar producto")').click();
  await seller.waitForSelector("main:visible >> text=Este producto está archivado");
  log(
    "seller after archiving:",
    (await text(seller.locator("main:visible header").first())).slice(0, 90),
  );
  check(
    (await seller.locator('main:visible input[name="title"]').count()) === 0,
    "an archived product can still be edited",
  );
  await seller.screenshot({ path: SHOTS + "/le8-archived.png", fullPage: true });

  const archivedAfter = await shopper.request.get(WEB + ARCHIVED);
  const archivedPage = await archivedAfter.text();
  log(
    "archived product in the shop:",
    archivedAfter.status(),
    "| not-found screen:",
    archivedPage.includes("No encontramos esa página"),
  );
  check(
    archivedAfter.status() === 404,
    `the archived product still answers ${archivedAfter.status()}`,
  );
  await shopper.goto(WEB + "/buscar?q=teclado", { waitUntil: "networkidle" });
  const found = await shopper.locator("article h3").allInnerTexts();
  log('search "teclado" finds:', found);
  check(
    !found.some((title) => title.includes("Teclado")),
    "search still lists the archived product",
  );
  await seller.goto(SELLER + "/productos", { waitUntil: "networkidle" });
  const archivedRow = seller.locator("main:visible tbody tr", { hasText: "Teclado" });
  log("archived row:", (await text(archivedRow.locator("td").nth(1))).slice(0, 40));
  check(
    (await archivedRow.locator('a:has-text("Editar")').count()) === 0,
    "list: archived is editable",
  );

  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => {
  console.error("FAILED:", e.message.slice(0, 700));
  process.exit(1);
});
