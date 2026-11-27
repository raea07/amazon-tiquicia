// Listing-edit journey: a seller edits a published product, catalogue staff review it
// with old and new side by side, the shop changes only on approval, a rejected edit
// reaches the seller with its reason, and an archived product leaves the shop.
//
// A journey drives the real apps in a real browser against a freshly seeded
// database. It fails when a step does not arrive where it should, when the
// browser logs an error, or when any response is a 5xx.

const { chromium } = require("playwright");
const web = require("../lib/web.cjs");
const seller = require("../lib/seller.cjs");
const ops = require("../lib/ops.cjs");
const { word } = require("../lib/words.cjs");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const WEB = web.BASE;
const log = (...a) => console.log(...a);

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
    await web.open(shopper, PRODUCT);
    return web.heading(shopper);
  };

  const sellerContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "es-CR",
  });
  const vendor = await sellerContext.newPage();
  watch(vendor);
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
  await seller.signInHome(vendor, "vendedor@yuntera.example");
  await seller.chooseShop(vendor, "TecnoCasa");
  await seller.open(vendor, "/productos");
  log("row in the list:", (await seller.productRowText(vendor, oldTitle)).all.slice(0, 110));
  await seller.openEdit(vendor, oldTitle);
  const editUrl = vendor.url();
  log("edit page state:", await seller.statusText(vendor));
  await vendor.screenshot({ path: SHOTS + "/le1-edit-published.png", fullPage: true });

  // sending it back unchanged is not an edit
  await seller.sendForReview(vendor);
  log("unchanged:", await seller.editFormError(vendor));

  // a form that comes back with an error keeps everything the seller chose, the category too
  const { current: startCategory, other: otherCategory } = await seller.categoryChoice(vendor);
  await seller.chooseCategory(vendor, otherCategory);
  await seller.typeTitle(vendor, "abc");
  await seller.sendForReview(vendor);
  await seller.editFormError(vendor, "al menos 5 letras");
  const { category: keptCategory, title: keptTitle } = await seller.editTyped(vendor);
  log("after an error, category:", startCategory, "->", keptCategory, "| title:", keptTitle);
  check(keptCategory === otherCategory, `the chosen category was lost: ${keptCategory}`);
  check(keptTitle === "abc", `the typed title was lost: ${keptTitle}`);
  // start the real edit from what is published
  await vendor.goto(editUrl, { waitUntil: "networkidle" });

  // the way back to the list is a full-size touch target
  const back = await seller.backToProducts(vendor).boundingBox();
  log("back link height px:", back?.height);
  check((back?.height ?? 0) >= 44, `the back link is ${back?.height} px high`);

  // 2. The seller changes the title; it goes to review and the listing stays as it is
  await seller.typeTitle(vendor, NEW_TITLE);
  await seller.sendForReview(vendor);
  await seller.waitForEditInReview(vendor);
  log("after sending:", (await seller.editHeader(vendor)).slice(0, 120));
  const proposal = await seller.editProposal(vendor);
  log("seller sees old and new:", proposal.slice(0, 200));
  check(proposal.includes(oldTitle) && proposal.includes(NEW_TITLE), "seller: no before/after");
  await vendor.screenshot({ path: SHOTS + "/le2-edit-in-review.png", fullPage: true });
  await seller.open(vendor, "/productos");
  const { state } = await seller.productRowText(vendor, oldTitle);
  log("state in the list:", state);
  check(
    state.includes(word("product_status", "active")) && state.includes("Cambios en revisión"),
    "list: state missing",
  );

  // 3. The shop still shows the old title
  const stillOld = await shopTitle();
  log("shop while the edit waits:", stillOld);
  check(stillOld === oldTitle, `the shop changed before approval: ${stillOld}`);

  // 4. Catalogue staff see it apart from new products, old and new side by side
  await ops.signInHome(staff, "central@yuntera.example");
  log("dashboard counts it:", (await ops.reviewFigure(staff)).slice(0, 80));
  await ops.open(staff, "/catalogo");
  log("catalogue sections:", await ops.sectionHeadings(staff));
  const card = await ops.firstEditCard(staff);
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
    !(await ops.newProducts(staff)).includes(NEW_TITLE),
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
  await ops.signInHome(m, "central@yuntera.example");
  await ops.open(m, "/catalogo");
  log("mobile /catalogo overflow px:", await overflow(m));
  check((await overflow(m)) <= 0, "ops /catalogo scrolls sideways on a phone");
  await m.screenshot({ path: SHOTS + "/le4-review-mobile.png", fullPage: true });

  // 5. Approved: the shop shows the new title at once
  await ops.approveFirstEdit(staff);
  const nowNew = await shopTitle();
  log("shop after approval:", nowNew);
  check(nowNew === NEW_TITLE, `the shop does not show the approved title: ${nowNew}`);
  await shopper.screenshot({ path: SHOTS + "/le5-shop-new-title.png" });

  // 6. A second edit is rejected, and the seller reads why
  await vendor.goto(editUrl, { waitUntil: "networkidle" });
  log(
    "seller after approval:",
    await seller.heading(vendor),
    "|",
    (await seller.statusText(vendor)).slice(0, 50),
  );
  await seller.typeTitle(vendor, REFUSED_TITLE);
  await seller.sendForReview(vendor);
  await seller.waitForEditInReview(vendor);

  await ops.open(staff, "/catalogo");
  // no reason yet
  log("reject without a reason:", await ops.rejectFirstEditWithoutReason(staff));
  await ops.rejectFirstEdit(staff, REASON);

  await vendor.goto(editUrl, { waitUntil: "networkidle" });
  const refusal = await seller.alertText(vendor);
  log("seller reads:", refusal.slice(0, 200));
  check(refusal.includes(REASON), "seller: the reason for the rejection is not shown");
  await vendor.screenshot({ path: SHOTS + "/le6-edit-rejected.png", fullPage: true });
  await seller.open(vendor, "/productos");
  check(
    (await seller.productRowText(vendor, NEW_TITLE)).all.includes(REASON),
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
  await seller.open(vendor, "/productos");
  await seller.openEdit(vendor, "Teclado");
  await seller.archiveProduct(vendor);
  log("seller after archiving:", (await seller.editHeader(vendor)).slice(0, 90));
  check((await seller.titleFields(vendor)) === 0, "an archived product can still be edited");
  await vendor.screenshot({ path: SHOTS + "/le8-archived.png", fullPage: true });

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
  await web.open(shopper, "/buscar?q=teclado");
  const found = await web.cardTitles(shopper);
  log('search "teclado" finds:', found);
  check(
    !found.some((title) => title.includes("Teclado")),
    "search still lists the archived product",
  );
  await seller.open(vendor, "/productos");
  log("archived row:", (await seller.productRowText(vendor, "Teclado")).state.slice(0, 40));
  check((await seller.editOffered(vendor, "Teclado")) === 0, "list: archived is editable");

  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => {
  console.error("FAILED:", e.message.slice(0, 700));
  process.exit(1);
});
