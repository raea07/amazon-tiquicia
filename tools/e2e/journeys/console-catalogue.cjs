// Console catalogue journey: catalogue staff create a category, file a product in it
// by correcting the product, move it, rename it (the old address redirects) and hide it;
// merge a duplicate brand; add a search synonym that only then finds a product; hide a
// review and show it again. After each step the shop follows: menu, category pages,
// brand filter, search, rating, and the author's order page.
//
// A journey drives the real apps in a real browser against a freshly seeded
// database. It fails when a step does not arrive where it should, when the
// browser logs an error, or when any response is a 5xx.

const { chromium } = require("playwright");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const WEB = process.env.WEB_URL || "http://127.0.0.1:3000";
const OPS = process.env.OPS_URL || "http://127.0.0.1:3002";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const log = (...a) => console.log(...a);
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, " ").trim();

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
    await page.waitForURL((u) => new URL(u).pathname !== "/ingresar");
    await page.waitForLoadState("networkidle");
  };
  const overflow = (page) =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

  // The shop, as a visitor who is not signed in. Each visit is a fresh browser (see
  // listing-edit.cjs: Chromium's own cache of prefetches stalls "networkidle" otherwise).
  let shopper;
  const shop = async (path) => {
    await shopper?.context().close();
    shopper = await (await browser.newContext({ locale: "es-CR" })).newPage();
    watch(shopper);
    await shopper.goto(WEB + path, { waitUntil: "networkidle" });
    return shopper;
  };
  const status = async (path) => {
    const context = await browser.newContext();
    const response = await context.request.get(WEB + path, { maxRedirects: 0 });
    const result = { status: response.status(), location: response.headers().location ?? "" };
    await context.close();
    return result;
  };
  const menu = async () => {
    const page = await shop("/");
    return page.locator('header nav[aria-label="Categorías"] a').allInnerTexts();
  };
  const found = async (query) => {
    const page = await shop(`/buscar?q=${encodeURIComponent(query)}`);
    return page.locator("main article h3").allInnerTexts();
  };

  const staffContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "es-CR",
  });
  const staff = await staffContext.newPage();
  watch(staff);
  await signIn(staff, OPS, "central@yuntera.example");

  // Submits an ActionForm and waits for its new outcome (success or refusal): the
  // form's message once it differs from before. `after` is where to read it when the
  // change itself moves the form (a renamed category's row has a new address).
  const submit = async (scope, button, after = scope) => {
    const outcomes = () => after.locator('[role="status"], [role="alert"]');
    const before = (await scope.locator('[role="status"], [role="alert"]').allInnerTexts()).join(
      "|",
    );
    await scope.locator(`button:has-text("${button}")`).last().click();
    const deadline = Date.now() + 15000;
    let now = "";
    while (Date.now() < deadline) {
      await staff.waitForTimeout(250);
      now = (await outcomes().allInnerTexts()).join("|");
      if (now && now !== before) break;
    }
    return (await outcomes().allInnerTexts()).at(-1)?.replace(/\s+/g, " ").trim() ?? "";
  };

  // ── 1. A new department, empty ────────────────────────────────────────────
  await staff.goto(OPS + "/catalogo/categorias", { waitUntil: "networkidle" });
  const nav = await staff.locator('nav[aria-label="Catálogo"] a').allInnerTexts();
  log("catalogue pages:", nav);
  check(
    nav.includes("Categorías") && nav.includes("Reseñas"),
    "the catalogue section has no subpages",
  );
  const create = staff.locator('section[aria-labelledby="nueva"]');
  await create.locator('input[name="name"]').fill("Regalos ticos");
  const created = await submit(create, "Crear categoría");
  log("created:", created);
  check(created.includes("/c/regalos-ticos"), `category not created: ${created}`);
  await staff.screenshot({ path: SHOTS + "/cc1-categories.png", fullPage: true });

  const empty = await shop("/c/regalos-ticos");
  log("shop /c/regalos-ticos:", await text(empty.locator("main h1")));
  check(
    (await text(empty.locator("main"))).includes("Todavía no hay productos aquí"),
    "new category page",
  );
  check(!(await menu()).includes("Regalos ticos"), "an empty department is in the menu");

  // ── 2. A product's category corrected by staff ─────────────────────────────
  await staff.goto(OPS + "/catalogo/productos?producto=chorreador-madera-artesanal", {
    waitUntil: "networkidle",
  });
  log("product found:", (await text(staff.locator("main h2").first())).slice(0, 80));
  const correct = staff.locator('section[aria-labelledby="corregir"]');
  const categoryOption = await correct
    .locator('select[name="categoryId"] option', { hasText: "Regalos ticos" })
    .getAttribute("value");
  await correct.locator('select[name="categoryId"]').selectOption(categoryOption);
  await correct.locator('textarea[name="note"]').fill("abc");
  const short = await submit(correct, "Guardar la corrección");
  log("short reason:", short);
  check(short.includes("al menos 10"), "a correction without a reason was accepted");
  await correct
    .locator('textarea[name="note"]')
    .fill("Es un regalo típico, no un utensilio de cocina.");
  const corrected = await submit(correct, "Guardar la corrección");
  log("corrected:", corrected);
  check(corrected.includes("Corrección guardada"), `correction refused: ${corrected}`);
  await staff.waitForSelector('main dd[data-current-category="regalos-ticos"]');
  await staff.screenshot({ path: SHOTS + "/cc2-product-corrected.png", fullPage: true });

  const inMenu = await menu();
  log("menu after the correction:", inMenu);
  check(inMenu.includes("Regalos ticos"), "the department with a product is not in the menu");
  const filed = await shop("/c/regalos-ticos");
  const filedTitles = await filed.locator("main article h3").allInnerTexts();
  log("in /c/regalos-ticos:", filedTitles);
  check(
    filedTitles.some((t) => t.includes("Chorreador")),
    "the corrected product is not in its category",
  );
  const artesania = await shop("/c/artesania");
  check(
    !(await artesania.locator("main article h3").allInnerTexts()).some((t) =>
      t.includes("Chorreador"),
    ),
    "the corrected product is still in its old category",
  );

  // ── 3. Moved: refused where the commission would change, done where it does not ──
  await staff.goto(OPS + "/catalogo/categorias", { waitUntil: "networkidle" });
  const row = () => staff.locator('li[data-category="regalos-ticos"]');
  await row().locator("summary", { hasText: "Cambiar «Regalos ticos»" }).click();
  const moveForm = row().locator("form", { has: staff.locator('select[name="parentId"]') });
  await moveForm.locator('select[name="parentId"]').selectOption({ label: "Electrónica" });
  const refusedMove = await submit(moveForm, "Mover");
  log("move under Electrónica:", refusedMove);
  check(
    refusedMove.includes("otra comisión"),
    `a move that changes commission was not refused: ${refusedMove}`,
  );
  await moveForm.locator('select[name="parentId"]').selectOption({ label: "Hogar y cocina" });
  const moved = await submit(moveForm, "Mover");
  log("move under Hogar y cocina:", moved);
  check(moved.includes("movida"), `move refused: ${moved}`);

  check(
    !(await menu()).includes("Regalos ticos"),
    "a sub-category is still a department in the menu",
  );
  const hogar = await shop("/c/hogar");
  const chips = await hogar.locator('main a[href^="/c/"]').allInnerTexts();
  log("/c/hogar sub-categories:", chips);
  check(chips.includes("Regalos ticos"), "the moved category is not under its new parent");

  // ── 4. Renamed: the old address leads to the new one ────────────────────────
  await staff.goto(OPS + "/catalogo/categorias", { waitUntil: "networkidle" });
  await row().locator("summary", { hasText: "Cambiar «Regalos ticos»" }).click();
  const renameForm = row().locator("form", { has: staff.locator('input[name="slug"]') });
  await renameForm.locator('input[name="name"]').fill("Regalos hechos a mano");
  await renameForm.locator('input[name="slug"]').fill("regalos-hechos-a-mano");
  const renamed = await submit(
    renameForm,
    "Guardar nombre y dirección",
    staff.locator('li[data-category="regalos-hechos-a-mano"] form', {
      has: staff.locator('input[name="slug"]'),
    }),
  );
  log("renamed:", renamed);
  check(renamed.includes("/c/regalos-ticos"), `rename refused: ${renamed}`);

  const old = await status("/c/regalos-ticos");
  log("old address:", old);
  check(
    old.status === 308 && old.location.endsWith("/c/regalos-hechos-a-mano"),
    "the old address does not redirect",
  );
  const renamedPage = await shop("/c/regalos-ticos");
  log(
    "followed to:",
    new URL(renamedPage.url()).pathname,
    "|",
    await text(renamedPage.locator("main h1")),
  );
  check(
    (await text(renamedPage.locator("main h1"))) === "Regalos hechos a mano",
    "the renamed category's page",
  );
  await renamedPage.screenshot({ path: SHOTS + "/cc3-renamed-category.png" });

  // ── 5. Hidden: out of the menus and pages, its product still sold ───────────
  await staff.goto(OPS + "/catalogo/categorias", { waitUntil: "networkidle" });
  const hidden = staff.locator('li[data-category="regalos-hechos-a-mano"]');
  await hidden.locator("summary", { hasText: "Cambiar «Regalos hechos a mano»" }).click();
  await hidden.locator("summary", { hasText: "Ocultar de la tienda" }).click();
  const hideForm = hidden.locator("form", {
    has: staff.locator('button:has-text("Ocultar la categoría")'),
  });
  await hideForm.locator('button:has-text("Ocultar la categoría")').click();
  // The form gives way to "Mostrar en la tienda" once it worked.
  await hidden.locator('button:has-text("Mostrar en la tienda")').waitFor();
  const badge = await text(hidden.locator("span", { hasText: "Oculta" }).first());
  log("hidden:", badge);
  check(badge === "Oculta", `hide did not take: ${badge}`);
  await staff.screenshot({ path: SHOTS + "/cc4-category-hidden.png", fullPage: true });

  const gone = await status("/c/regalos-hechos-a-mano");
  log("hidden category page:", gone.status);
  check(gone.status === 404, "a hidden category still has a page");
  const hogarAfter = await shop("/c/hogar");
  check(
    !(await hogarAfter.locator('main a[href^="/c/"]').allInnerTexts()).includes(
      "Regalos hechos a mano",
    ),
    "a hidden category is still listed under its parent",
  );
  const stillFound = await found("chorreador");
  log('search "chorreador":', stillFound);
  check(
    stillFound.some((t) => t.includes("Chorreador")),
    "a product of a hidden category is not found",
  );
  check(
    (await status("/p/chorreador-madera-artesanal")).status === 200,
    "its product page is gone",
  );

  // ── 6. A duplicate brand merged ──────────────────────────────────────────────
  const brandsBefore = await shop("/buscar");
  const optionsBefore = await brandsBefore.locator('select[name="marca"] option').allInnerTexts();
  log("brand filter before:", optionsBefore);
  check(
    optionsBefore.some((o) => o.startsWith("Luma")),
    "Luma is not in the brand filter",
  );
  await staff.goto(OPS + "/catalogo/marcas", { waitUntil: "networkidle" });
  const luma = staff.locator('li[data-brand="luma"]');
  await luma.locator("summary", { hasText: "Cambiar «Luma»" }).click();
  await luma.locator("summary", { hasText: "unirlas" }).click();
  const mergeForm = luma.locator("form", { has: staff.locator('select[name="intoId"]') });
  await mergeForm.locator('select[name="intoId"]').selectOption({ label: "Volcán" });
  await mergeForm.locator('button:has-text("Unir «Luma» a la elegida")').click();
  // Luma leaves the list of brands for the list of merged ones.
  const mergedRow = staff.locator('section[aria-labelledby="unidas"] li', { hasText: "Luma" });
  await mergedRow.waitFor();
  const merged = await text(mergedRow);
  log("merged:", merged);
  check(merged.includes("Volcán"), `merge did not take: ${merged}`);
  await staff.screenshot({ path: SHOTS + "/cc5-brands-merged.png", fullPage: true });

  const brandsAfter = await shop("/buscar");
  const optionsAfter = await brandsAfter.locator('select[name="marca"] option').allInnerTexts();
  log("brand filter after:", optionsAfter);
  check(!optionsAfter.some((o) => o.startsWith("Luma")), "a merged brand is still in the filter");
  check(
    optionsAfter.includes("Volcán (5)"),
    "the brand that remains does not count the moved product",
  );
  await brandsAfter.locator('select[name="marca"]').selectOption({ label: "Volcán (5)" });
  await brandsAfter.click('button:has-text("Filtrar por marca")');
  await brandsAfter.waitForURL(/marca=volcan/);
  await brandsAfter.waitForLoadState("networkidle");
  const volcan = await brandsAfter.locator("main article h3").allInnerTexts();
  log(
    "filtered by Volcán:",
    volcan.length,
    volcan.some((t) => t.includes("Bombillo")),
  );
  check(volcan.length === 5 && volcan.some((t) => t.includes("Bombillo")), "the brand filter");
  const byOldName = await found("luma");
  log('search "luma":', byOldName);
  check(
    byOldName.some((t) => t.includes("Bombillo")),
    "searching the merged brand's name finds nothing",
  );

  // ── 7. A synonym that makes a search find something ──────────────────────────
  const before = await found("pichinga");
  log('search "pichinga" before:', before);
  check(before.length === 0, "pichinga already finds something");
  await staff.goto(OPS + "/catalogo/busqueda?q=pichinga", { waitUntil: "networkidle" });
  log("preview before:", await text(staff.locator("#vista-previa")));
  const add = staff.locator('section[aria-labelledby="nuevo-sinonimo"]');
  await add.locator('input[name="term"]').fill("Pichinga");
  await add.locator('textarea[name="expansions"]').fill("de la");
  const common = await submit(add, "Agregar sinónimo");
  log("a stopword:", common);
  check(common.includes("común"), "a synonym that matches nothing specific was accepted");
  await add.locator('textarea[name="expansions"]').fill("botella térmica");
  const added = await submit(add, "Agregar sinónimo");
  log("added:", added);
  check(added.includes("«pichinga»"), `synonym refused: ${added}`);
  await staff.goto(OPS + "/catalogo/busqueda?q=pichinga", { waitUntil: "networkidle" });
  const preview = await text(staff.locator("#vista-previa"));
  log("preview after:", preview.slice(0, 200));
  check(preview.includes("Botella térmica"), "the preview does not show what the synonym finds");
  await staff.screenshot({ path: SHOTS + "/cc6-synonyms.png", fullPage: true });
  const after = await found("pichinga");
  log('search "pichinga" after:', after);
  check(
    after.some((t) => t.includes("Botella térmica")),
    "the synonym does not make search find the product",
  );

  // ── 8. A review hidden and shown, the rating following ───────────────────────
  const product = await shop("/p/hamaca-algodon-doble");
  const ratingBefore = await text(product.locator("#resenas"));
  log("hamaca reviews before:", ratingBefore.slice(0, 90));
  check(!ratingBefore.includes("Todavía no tiene reseñas"), "the hamaca has no review to hide");
  await staff.goto(OPS + "/catalogo/resenas", { waitUntil: "networkidle" });
  const card = staff.locator("main li[data-review]", { hasText: "Hamaca de algodón" });
  log("review card:", (await text(card)).slice(0, 160));
  check(!(await text(card)).includes("@"), "staff see an e-mail of the reviewer");
  await card.locator("summary", { hasText: "Ocultar la reseña" }).click();
  const hideReview = card.locator("form", { has: staff.locator('select[name="reason"]') }).first();
  // No reason is chosen for staff: the form does not go without one.
  const required = await hideReview
    .locator('select[name="reason"]')
    .evaluate((select) => select.required && select.value === "");
  log("the reason must be chosen:", required);
  check(required, "a review can be hidden without choosing a reason");
  await hideReview.locator('select[name="reason"]').selectOption("personal_data");
  await hideReview.locator('button:has-text("Ocultar la reseña")').click();
  await card.locator('button:has-text("Mostrar la reseña de nuevo")').waitFor();
  const hiddenReview = await text(card);
  log("hidden:", hiddenReview.slice(0, 160));
  check(hiddenReview.includes("Oculta: Datos personales"), `review not hidden: ${hiddenReview}`);

  const productHidden = await shop("/p/hamaca-algodon-doble");
  const ratingHidden = await text(productHidden.locator("#resenas"));
  log("hamaca reviews after hiding:", ratingHidden.slice(0, 90));
  check(
    ratingHidden.includes("Todavía no tiene reseñas"),
    "the hidden review still counts on the product page",
  );
  const results = await shop("/buscar?q=hamaca");
  const resultCard = await text(results.locator("main article", { hasText: "Hamaca" }).first());
  log("hamaca in search:", resultCard.slice(0, 120));
  check(
    resultCard.includes("Sin reseñas todavía"),
    "the hidden review still counts in search results",
  );

  // The author reads it on their order page.
  const author = await (
    await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      locale: "es-CR",
    })
  ).newPage();
  watch(author);
  await signIn(author, WEB, "comprador@yuntera.example");
  await author.goto(WEB + "/pedidos/YT-100007", { waitUntil: "networkidle" });
  const notice = author.locator("main", { hasText: "Retiramos su reseña" });
  await notice.waitFor();
  const noticeText = await text(
    author.locator('[role="status"]', { hasText: "Retiramos su reseña" }),
  );
  log("the author reads:", noticeText);
  check(noticeText.includes("datos personales"), "the author is not told why");
  log("order page overflow px:", await overflow(author));
  check((await overflow(author)) <= 0, "the order page scrolls sideways on a phone");
  await author.screenshot({ path: SHOTS + "/cc7-author-order.png", fullPage: true });

  // Shown again.
  await staff.goto(OPS + "/catalogo/resenas?filtro=hidden", { waitUntil: "networkidle" });
  const hiddenCard = staff.locator("main li[data-review]", { hasText: "Hamaca de algodón" });
  await hiddenCard.locator('button:has-text("Mostrar la reseña de nuevo")').click();
  // Shown again, it leaves the list of hidden reviews.
  await hiddenCard.waitFor({ state: "detached" });
  log("shown: it left the hidden list");
  const productShown = await shop("/p/hamaca-algodon-doble");
  const ratingShown = await text(productShown.locator("#resenas"));
  log("hamaca reviews after showing:", ratingShown.slice(0, 90));
  check(!ratingShown.includes("Todavía no tiene reseñas"), "the review shown again does not count");

  // ── 9. Every catalogue screen on a phone ─────────────────────────────────────
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: "es-CR",
    storageState: await staffContext.storageState(),
  });
  const m = await phone.newPage();
  watch(m);
  for (const [path, shot] of [
    ["/catalogo", "cc8-mobile-review-queue"],
    ["/catalogo/categorias", "cc9-mobile-categories"],
    ["/catalogo/marcas", "cc10-mobile-brands"],
    ["/catalogo/busqueda?q=refri", "cc11-mobile-search"],
    ["/catalogo/resenas", "cc12-mobile-reviews"],
    ["/catalogo/productos?producto=licuadora-volcan-600w", "cc13-mobile-product"],
  ]) {
    await m.goto(OPS + path, { waitUntil: "networkidle" });
    // Open every disclosure, so what it hides is measured too.
    await m.evaluate(() => {
      for (const details of document.querySelectorAll("main details")) details.open = true;
    });
    const px = await overflow(m);
    log(`mobile ${path} overflow px:`, px);
    check(px <= 0, `ops ${path} scrolls sideways on a phone`);
    await m.screenshot({ path: `${SHOTS}/${shot}.png`, fullPage: true });
  }
  const shopPhone = await (
    await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      locale: "es-CR",
    })
  ).newPage();
  watch(shopPhone);
  await shopPhone.goto(WEB + "/buscar?marca=volcan", { waitUntil: "networkidle" });
  log("shop brand filter on a phone overflow px:", await overflow(shopPhone));
  check((await overflow(shopPhone)) <= 0, "the shop's brand filter scrolls sideways on a phone");
  await shopPhone.screenshot({
    path: SHOTS + "/cc14-shop-brand-filter-mobile.png",
    fullPage: true,
  });

  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => {
  console.error("FAILED:", e.message.slice(0, 700));
  process.exit(1);
});
