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
const web = require("../lib/web.cjs");
const ops = require("../lib/ops.cjs");
const kit = require("../lib/kit.cjs");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const WEB = web.BASE;
const log = (...a) => console.log(...a);

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
  const overflow = (page) => kit.overflowPx(page);

  // The shop, as a visitor who is not signed in. Each visit is a fresh browser (see
  // listing-edit.cjs: Chromium's own cache of prefetches stalls "networkidle" otherwise).
  let shopper;
  const shop = async (path) => {
    await shopper?.context().close();
    shopper = await (await browser.newContext({ locale: "es-CR" })).newPage();
    watch(shopper);
    await web.open(shopper, path);
    return shopper;
  };
  const status = async (path) => {
    const context = await browser.newContext();
    const response = await context.request.get(WEB + path, { maxRedirects: 0 });
    const result = { status: response.status(), location: response.headers().location ?? "" };
    await context.close();
    return result;
  };
  // The menu sits in every page's prepared shell and is refreshed in the
  // background: the first visitor after a change may still get the old one.
  const menu = async (expected) => {
    let items = [];
    for (let visit = 0; visit < 4; visit += 1) {
      const page = await shop("/");
      items = await web.categoryMenu(page);
      if (expected === undefined || expected(items)) break;
      await page.waitForTimeout(1000);
    }
    return items;
  };
  const found = async (query) => {
    const page = await shop(`/buscar?q=${encodeURIComponent(query)}`);
    return web.resultTitles(page);
  };

  const staffContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "es-CR",
  });
  const staff = await staffContext.newPage();
  watch(staff);
  await ops.signIn(staff, "central@yuntera.example");

  // ── 1. A new department, empty ────────────────────────────────────────────
  await ops.openCatalogue(staff, "/categorias");
  const nav = await ops.catalogueNav(staff);
  log("catalogue pages:", nav);
  check(
    nav.includes("Categorías") && nav.includes("Reseñas"),
    "the catalogue section has no subpages",
  );
  const created = await ops.createCategory(staff, "Regalos ticos");
  log("created:", created);
  check(created.includes("/c/regalos-ticos"), `category not created: ${created}`);
  // The same name again, address left empty: the refusal says the address is
  // the one made from the name, which the person never typed.
  const again = await ops.createCategory(staff, "Regalos ticos");
  log("same name, no address:", again);
  check(
    again.includes("a partir del nombre «Regalos ticos»"),
    `the refusal does not say where the address came from: ${again}`,
  );
  await ops.clearNewCategory(staff);
  await staff.screenshot({ path: SHOTS + "/cc1-categories.png", fullPage: true });

  const empty = await shop("/c/regalos-ticos");
  log("shop /c/regalos-ticos:", await web.heading(empty));
  check((await web.mainText(empty)).includes("Todavía no hay productos aquí"), "new category page");
  check(
    !(await menu((items) => !items.includes("Regalos ticos"))).includes("Regalos ticos"),
    "an empty department is in the menu",
  );

  // ── 2. A product's category corrected by staff ─────────────────────────────
  await ops.openCatalogue(staff, "/productos?producto=chorreador-madera-artesanal");
  log("product found:", (await ops.productFound(staff)).slice(0, 80));
  const short = await ops.correctCategory(staff, "Regalos ticos", "abc");
  log("short reason:", short);
  check(short.includes("al menos 10"), "a correction without a reason was accepted");
  const corrected = await ops.correctCategory(
    staff,
    "Regalos ticos",
    "Es un regalo típico, no un utensilio de cocina.",
  );
  log("corrected:", corrected);
  check(corrected.includes("Corrección guardada"), `correction refused: ${corrected}`);
  await ops.waitForCurrentCategory(staff, "regalos-ticos");
  await staff.screenshot({ path: SHOTS + "/cc2-product-corrected.png", fullPage: true });

  const inMenu = await menu((items) => items.includes("Regalos ticos"));
  log("menu after the correction:", inMenu);
  check(inMenu.includes("Regalos ticos"), "the department with a product is not in the menu");
  const filed = await shop("/c/regalos-ticos");
  const filedTitles = await web.resultTitles(filed);
  log("in /c/regalos-ticos:", filedTitles);
  check(
    filedTitles.some((t) => t.includes("Chorreador")),
    "the corrected product is not in its category",
  );
  const artesania = await shop("/c/artesania");
  check(
    !(await web.resultTitles(artesania)).some((t) => t.includes("Chorreador")),
    "the corrected product is still in its old category",
  );

  // ── 3. Moved: refused where the commission would change, done where it does not ──
  await ops.openCatalogue(staff, "/categorias");
  await ops.openCategoryChange(staff, "regalos-ticos");
  const refusedMove = await ops.moveCategory(staff, "regalos-ticos", "Electrónica");
  log("move under Electrónica:", refusedMove);
  check(
    refusedMove.includes("otra comisión"),
    `a move that changes commission was not refused: ${refusedMove}`,
  );
  const moved = await ops.moveCategory(staff, "regalos-ticos", "Hogar y cocina");
  log("move under Hogar y cocina:", moved);
  check(moved.includes("movida"), `move refused: ${moved}`);

  check(
    !(await menu((items) => !items.includes("Regalos ticos"))).includes("Regalos ticos"),
    "a sub-category is still a department in the menu",
  );
  const hogar = await shop("/c/hogar");
  const chips = await web.subCategories(hogar);
  log("/c/hogar sub-categories:", chips);
  check(chips.includes("Regalos ticos"), "the moved category is not under its new parent");

  // ── 4. Renamed: the old address leads to the new one ────────────────────────
  await ops.openCatalogue(staff, "/categorias");
  await ops.openCategoryChange(staff, "regalos-ticos");
  const renamed = await ops.renameCategory(staff, "regalos-ticos", {
    name: "Regalos hechos a mano",
    newSlug: "regalos-hechos-a-mano",
  });
  log("renamed:", renamed);
  check(renamed.includes("/c/regalos-ticos"), `rename refused: ${renamed}`);

  const old = await status("/c/regalos-ticos");
  log("old address:", old);
  check(
    old.status === 308 && old.location.endsWith("/c/regalos-hechos-a-mano"),
    "the old address does not redirect",
  );
  const renamedPage = await shop("/c/regalos-ticos");
  log("followed to:", new URL(renamedPage.url()).pathname, "|", await web.heading(renamedPage));
  check(
    (await web.heading(renamedPage)) === "Regalos hechos a mano",
    "the renamed category's page",
  );
  await renamedPage.screenshot({ path: SHOTS + "/cc3-renamed-category.png" });

  // ── 5. Hidden: out of the menus and pages, its product still sold ───────────
  await ops.openCatalogue(staff, "/categorias");
  // The form gives way to "Mostrar en la tienda" once it worked.
  await ops.hideCategory(staff, "regalos-hechos-a-mano");
  const badge = await ops.categoryVisibility(staff, "regalos-hechos-a-mano");
  log("hidden:", badge);
  check(badge === "Oculta", `hide did not take: ${badge}`);
  await staff.screenshot({ path: SHOTS + "/cc4-category-hidden.png", fullPage: true });

  // ── 5b. Before the console's scripts run (or when they never load) a
  // catalogue form is an ordinary form that posts to its server action. The
  // app's script files are refused here, so React never takes over and the
  // browser posts the form itself. (What Next.js sends back for such a post
  // is a page without content, as for every form of the apps, the sign-in
  // included; so the outcome is read on the next visit.)
  const plainContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "es-CR",
  });
  await plainContext.route("**/_next/static/chunks/**", (route) => route.abort());
  const plain = await plainContext.newPage();
  // The refused script files are logged as failed loads; only server errors count here.
  plain.on("response", (r) => {
    if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`);
  });
  await ops.signInWithoutScripts(plain, "central@yuntera.example");
  check(new URL(plain.url()).pathname !== "/ingresar", "sign-in without the app's scripts");
  await ops.openCatalogue(plain, "/categorias", "load");
  const plainMarkup = await ops.newCategoryFormMarkup(plain);
  log("the create form before scripts:", plainMarkup);
  check(
    plainMarkup.method === "post" && plainMarkup.action,
    "the catalogue form does not post to its action without scripts",
  );
  await ops.createCategoryWithoutScripts(plain, "Pruebas sin guion");
  await ops.openCatalogue(plain, "/categorias", "load");
  check(
    (await ops.categoryRows(plain, "pruebas-sin-guion")) === 1,
    "a category posted without scripts was not created",
  );
  await plainContext.close();

  // A category hidden by one above it names the nearest hidden one.
  const createUnder = async (name, parent) => {
    await ops.openCatalogue(staff, "/categorias");
    return ops.createCategory(staff, name, { parent });
  };
  const hideCategory = async (slug) => {
    await ops.openCatalogue(staff, "/categorias");
    await ops.hideCategory(staff, slug);
  };
  const badgeOf = (slug) => ops.categoryVisibility(staff, slug);
  const madeTwo = await createUnder("Nivel dos", "Pruebas sin guion");
  check(madeTwo.includes("/c/nivel-dos"), `level two not created: ${madeTwo}`);
  await hideCategory("pruebas-sin-guion");
  const madeThree = await createUnder("Nivel tres", "Nivel dos");
  log("under a hidden department:", madeThree);
  check(
    madeThree.includes("/c/nivel-tres") && madeThree.includes("No se ve en la tienda"),
    `a category made under a hidden one says it does not show: ${madeThree}`,
  );
  // Nivel dos is active itself: the badge of Nivel tres names the department.
  await ops.openCatalogue(staff, "/categorias");
  const byDept = await badgeOf("nivel-tres");
  log("badge, department hidden:", byDept);
  check(
    byDept === "Oculta: Pruebas sin guion está oculta",
    `the badge does not name the hidden department: ${byDept}`,
  );
  // Nivel dos hidden too: now it is the nearest hidden one above.
  await hideCategory("nivel-dos");
  await ops.openCatalogue(staff, "/categorias");
  const byParent = await badgeOf("nivel-tres");
  log("badge, its parent hidden too:", byParent);
  check(
    byParent === "Oculta: Nivel dos está oculta",
    `the badge does not name the nearest hidden category: ${byParent}`,
  );
  await staff.screenshot({ path: `${SHOTS}/cc4b-hidden-by-above.png`, fullPage: true });

  const gone = await status("/c/regalos-hechos-a-mano");
  log("hidden category page:", gone.status);
  check(gone.status === 404, "a hidden category still has a page");
  const hogarAfter = await shop("/c/hogar");
  check(
    !(await web.subCategories(hogarAfter)).includes("Regalos hechos a mano"),
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
  const optionsBefore = await web.brandOptions(brandsBefore);
  log("brand filter before:", optionsBefore);
  check(
    optionsBefore.some((o) => o.startsWith("Luma")),
    "Luma is not in the brand filter",
  );
  await ops.openCatalogue(staff, "/marcas");
  await ops.mergeBrand(staff, "luma", "Volcán");
  // Luma leaves the list of brands for the list of merged ones.
  const merged = await ops.mergedBrand(staff, "Luma");
  log("merged:", merged);
  check(merged.includes("Volcán"), `merge did not take: ${merged}`);
  // The form that was merged is gone; the page still says what happened.
  const mergeSaid = await ops.pageOutcome(staff, "Marcas unidas");
  log("merge outcome:", mergeSaid);
  check(mergeSaid.includes("Marcas unidas"), `the merge's outcome is not shown: ${mergeSaid}`);
  await staff.screenshot({ path: SHOTS + "/cc5-brands-merged.png", fullPage: true });

  const brandsAfter = await shop("/buscar");
  const optionsAfter = await web.brandOptions(brandsAfter);
  log("brand filter after:", optionsAfter);
  check(!optionsAfter.some((o) => o.startsWith("Luma")), "a merged brand is still in the filter");
  check(
    optionsAfter.includes("Volcán (5)"),
    "the brand that remains does not count the moved product",
  );
  await web.filterByBrand(brandsAfter, "Volcán (5)");
  await brandsAfter.waitForURL(/marca=volcan/);
  await brandsAfter.waitForLoadState("networkidle");
  const volcan = await web.resultTitles(brandsAfter);
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
  // The old brand's filter address selects and names the brand it went into.
  const oldAddress = await shop("/buscar?marca=luma");
  const selected = await web.chosenBrand(oldAddress);
  const summary = await web.brandFilterSummary(oldAddress);
  log("?marca=luma selects:", selected, "|", summary);
  check(
    selected === "volcan" && summary.includes("de Volcán"),
    `the merged brand's old address: ${selected} ${summary}`,
  );

  // ── 7. A synonym that makes a search find something ──────────────────────────
  const before = await found("pichinga");
  log('search "pichinga" before:', before);
  check(before.length === 0, "pichinga already finds something");
  await ops.openCatalogue(staff, "/busqueda?q=pichinga");
  log("preview before:", await ops.searchPreview(staff));
  const common = await ops.addSynonym(staff, { term: "Pichinga", expansions: "de la" });
  log("a stopword:", common);
  check(common.includes("común"), "a synonym that matches nothing specific was accepted");
  const added = await ops.addSynonym(staff, { expansions: "botella térmica" });
  log("added:", added);
  check(added.includes("«pichinga»"), `synonym refused: ${added}`);
  await ops.openCatalogue(staff, "/busqueda?q=pichinga");
  const preview = await ops.searchPreview(staff);
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
  const ratingBefore = await web.reviewsSection(product);
  log("hamaca reviews before:", ratingBefore.slice(0, 90));
  check(!ratingBefore.includes("Todavía no tiene reseñas"), "the hamaca has no review to hide");
  await ops.openCatalogue(staff, "/resenas");
  const card = ops.reviewCard(staff, "Hamaca de algodón");
  log("review card:", (await ops.text(card)).slice(0, 160));
  check(!(await ops.text(card)).includes("@"), "staff see an e-mail of the reviewer");
  // No reason is chosen for staff: the form does not go without one.
  const required = await ops.openHideReview(card);
  log("the reason must be chosen:", required);
  check(required, "a review can be hidden without choosing a reason");
  await ops.hideReview(card, "personal_data");
  const hiddenReview = await ops.text(card);
  log("hidden:", hiddenReview.slice(0, 160));
  check(hiddenReview.includes("Oculta: Datos personales"), `review not hidden: ${hiddenReview}`);
  const hideSaid = await ops.pageOutcome(staff, "Reseña oculta");
  log("hide outcome:", hideSaid);
  check(hideSaid.includes("Reseña oculta"), `the hide's outcome is not shown: ${hideSaid}`);

  const productHidden = await shop("/p/hamaca-algodon-doble");
  const ratingHidden = await web.reviewsSection(productHidden);
  log("hamaca reviews after hiding:", ratingHidden.slice(0, 90));
  check(
    ratingHidden.includes("Todavía no tiene reseñas"),
    "the hidden review still counts on the product page",
  );
  const results = await shop("/buscar?q=hamaca");
  const resultCard = await web.resultCard(results, "Hamaca");
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
  await web.signIn(author, "comprador@yuntera.example");
  await web.openOrder(author, "YT-100007");
  const noticeText = await web.reviewWithdrawnNotice(author);
  log("the author reads:", noticeText);
  check(noticeText.includes("datos personales"), "the author is not told why");
  log("order page overflow px:", await overflow(author));
  check((await overflow(author)) <= 0, "the order page scrolls sideways on a phone");
  await author.screenshot({ path: SHOTS + "/cc7-author-order.png", fullPage: true });

  // Shown again.
  await ops.openCatalogue(staff, "/resenas?filtro=hidden");
  // Shown again, it leaves the list of hidden reviews.
  await ops.showReview(ops.reviewCard(staff, "Hamaca de algodón"));
  log("shown: it left the hidden list");
  const productShown = await shop("/p/hamaca-algodon-doble");
  const ratingShown = await web.reviewsSection(productShown);
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
    ["/catalogo/logotipos", "cc8b-mobile-logos"],
    ["/catalogo/categorias", "cc9-mobile-categories"],
    ["/catalogo/marcas", "cc10-mobile-brands"],
    ["/catalogo/busqueda?q=refri", "cc11-mobile-search"],
    ["/catalogo/resenas", "cc12-mobile-reviews"],
    ["/catalogo/productos?producto=licuadora-volcan-600w", "cc13-mobile-product"],
  ]) {
    await ops.open(m, path);
    // Open every disclosure, so what it hides is measured too.
    await m.evaluate(() => {
      for (const details of document.querySelectorAll("main details")) details.open = true;
    });
    const px = await overflow(m);
    log(`mobile ${path} overflow px:`, px);
    check(px <= 0, `ops ${path} scrolls sideways on a phone`);
    // One page title, no heading said twice, and every control a full touch
    // target (a checkbox or radio counts with its label).
    const layout = await m.evaluate(() => {
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
      };
      const headings = [...document.querySelectorAll("main h1, main h2")]
        .filter(visible)
        .map((h) => `${h.tagName}:${h.innerText.trim()}`);
      const small = [];
      for (const el of document.querySelectorAll(
        "main button, main select, main input, main textarea, nav[aria-label='Catálogo'] a",
      )) {
        if (!visible(el) || el.type === "hidden") continue;
        let box = el.getBoundingClientRect();
        if (el.type === "checkbox" || el.type === "radio") {
          const label = el.closest("label") ?? document.querySelector(`label[for="${el.id}"]`);
          if (label) box = label.getBoundingClientRect();
        }
        if (box.height < 44)
          small.push(
            `${el.tagName}:${(el.innerText || el.name || "").trim().slice(0, 30)}:${Math.round(box.height)}`,
          );
      }
      return {
        h1: headings.filter((h) => h.startsWith("H1")).length,
        repeated: headings.filter((h, i) => headings.indexOf(h) !== i),
        small,
      };
    });
    log(`mobile ${path} headings and targets:`, JSON.stringify(layout));
    check(layout.h1 === 1, `ops ${path} has ${layout.h1} page titles`);
    check(layout.repeated.length === 0, `ops ${path} repeats a heading: ${layout.repeated}`);
    check(layout.small.length === 0, `ops ${path} has controls under 44 px: ${layout.small}`);
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
  await web.open(shopPhone, "/buscar?marca=volcan");
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
