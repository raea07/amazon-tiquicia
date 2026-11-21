// Product-photos journey: a seller adds photos to a new listing (and is refused a file
// that is too large, an SVG and a text file renamed to .jpg), the files are not publicly
// retrievable while they wait, staff publish the listing and its photos, and the shop
// shows them with their alternative text. Then the seller changes the photos of the
// published listing: the shop keeps the approved set until staff approve, staff reject one
// new photo with a reason the seller reads, and another seller can touch none of it.
// A client that skips the browser's checks is played from Node with the seller's own
// session: the storage service refuses what is too large or not an allowed type, and a
// text file declared as a JPEG is caught before it is published.
//
// A journey drives the real apps in a real browser against a freshly seeded
// database. It fails when a step does not arrive where it should, when the
// browser logs an error, or when any response is a 5xx.

const { chromium } = require("playwright");
const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const WEB = process.env.WEB_URL || "http://127.0.0.1:3000";
const SELLER = process.env.SELLER_URL || "http://127.0.0.1:3001";
const OPS = process.env.OPS_URL || "http://127.0.0.1:3002";
const API = process.env.API_URL || "http://127.0.0.1:54321";
const KEY = process.env.API_KEY || "sb_publishable_local_development_only";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const log = (...a) => console.log(...a);
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, " ").trim();

const TITLE = "Cafetera de goteo Nimbo 12 tazas con jarra de vidrio";
const SLUG = "/p/cafetera-de-goteo-nimbo-12-tazas-con-jarra-de-vidrio";
const ALT_1 = "Cafetera Nimbo vista de frente con la jarra puesta";
const ALT_2 = "Jarra de vidrio de la cafetera servida en una taza";
const ALT_3 = "Panel de botones de la cafetera de cerca";
const ALT_4 = "Cafetera junto a una caja de otra marca";
const REASON = "Se ve la caja de otra marca junto al producto; tómela sin ella.";

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const check = (condition, message) => {
    if (!condition) errors.push(message);
  };
  const watch = (page) => {
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 200)}`);
    });
    page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));
    page.on("response", (r) => {
      if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`);
    });
  };
  const signIn = async (page, base, email) => {
    await page.goto(`${base}/ingresar`, { waitUntil: "networkidle" });
    await page.fill('main input[name="email"]', email);
    await page.fill('main input[name="password"]', PASSWORD);
    await page.click('main form button[type="submit"]');
    await page.waitForURL((u) => new URL(u).pathname === "/");
    await page.waitForSelector("main h1:visible, main h2:visible");
  };
  const overflow = (page) =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  // The session the apps keep in their cookie, for playing a client of our own.
  const tokenOf = async (context) => {
    const cookie = (await context.cookies()).find((c) => /^sb-.*-auth-token$/.test(c.name));
    const json = Buffer.from(cookie.value.replace(/^base64-/, ""), "base64url").toString("utf8");
    return JSON.parse(json).access_token;
  };
  const rpc = async (token, fn, args) => {
    const response = await fetch(`${API}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: KEY,
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(args),
    });
    const body = await response.text();
    return { status: response.status, body: body ? JSON.parse(body) : null };
  };
  const storage = async (method, path, { token, body, type, headers = {} } = {}) => {
    const response = await fetch(`${API}/storage/v1${path}`, {
      method,
      headers: {
        apikey: KEY,
        authorization: `Bearer ${token ?? KEY}`,
        ...(type ? { "content-type": type } : {}),
        ...headers,
      },
      body,
    });
    const raw = await response.text();
    let json = null;
    try {
      json = JSON.parse(raw);
    } catch {}
    return { status: response.status, json, bytes: raw.length };
  };

  // Pictures to upload, drawn by the browser itself: real JPEGs of a phone-like size.
  const painter = await (await browser.newContext()).newPage();
  const picture = (hue, width, height) =>
    painter
      .evaluate(
        ({ hue, width, height }) => {
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const g = canvas.getContext("2d");
          g.fillStyle = `hsl(${hue} 60% 55%)`;
          g.fillRect(0, 0, width, height);
          g.fillStyle = `hsl(${(hue + 180) % 360} 70% 35%)`;
          g.beginPath();
          g.arc(width / 2, height / 2, Math.min(width, height) / 3, 0, Math.PI * 2);
          g.fill();
          return canvas.toDataURL("image/jpeg", 0.92).split(",")[1];
        },
        { hue, width, height },
      )
      .then((b64) => Buffer.from(b64, "base64"));
  const photo1 = await picture(20, 2400, 1800);
  const photo2 = await picture(140, 1800, 2400);
  const photo3 = await picture(220, 2000, 2000);
  const photo4 = await picture(300, 1600, 1200);
  await painter.context().close();
  const jpeg = (name, buffer) => ({ name, mimeType: "image/jpeg", buffer });

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
  let shopper;
  const openShop = async (path, viewport = { width: 1280, height: 900 }) => {
    await shopper?.context().close();
    shopper = await (await browser.newContext({ locale: "es-CR", viewport })).newPage();
    watch(shopper);
    await shopper.goto(WEB + path, { waitUntil: "networkidle" });
    return shopper;
  };
  /** Alternative texts of the gallery's photos, in order, and whether each loaded. */
  const gallery = async (page) =>
    page.locator('main section[aria-roledescription="carrusel"] li img').evaluateAll((imgs) =>
      imgs.map((img) => ({
        alt: img.alt,
        loaded: img.complete && img.naturalWidth > 0,
        src: img.currentSrc || img.src,
        srcset: img.srcset,
      })),
    );

  // 1. A new listing with two photos, as a draft
  await signIn(seller, SELLER, "vendedor@yuntera.example");
  if (!(await seller.locator("main h1:visible").innerText()).includes("TecnoCasa")) {
    await seller.selectOption("#shop", { label: "TecnoCasa" });
    await seller.click('header button:has-text("Cambiar")');
    await seller.waitForSelector('main h1:visible:has-text("TecnoCasa")');
  }
  await seller.goto(`${SELLER}/productos/nuevo`, { waitUntil: "networkidle" });
  await seller.fill('input[name="title"]', TITLE);
  const hogar = await seller
    .locator('select[name="categorySlug"] optgroup[label^="Hogar"] option')
    .first()
    .getAttribute("value");
  await seller.selectOption('select[name="categorySlug"]', hogar);
  await seller.fill('textarea[name="bullets"]', "12 tazas\nJarra de vidrio");
  await seller.fill('input[name="price"]', "25 000");
  await seller.fill('input[name="weightGrams"]', "1800");
  await seller.fill('input[name="lengthCm"]', "30");
  await seller.fill('input[name="widthCm"]', "20");
  await seller.fill('input[name="heightCm"]', "35");

  // Three files that are not photos it can use, and two that are.
  const chooser = seller.locator('main:visible input[type="file"][multiple]');
  await chooser.setInputFiles([
    {
      name: "enorme.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.concat([photo1.subarray(0, 4), Buffer.alloc(26 * 1024 * 1024)]),
    },
    {
      name: "logo.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      ),
    },
    {
      name: "notas.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from("Esto es texto, no una foto."),
    },
  ]);
  const refusals = seller.locator('main:visible [role="alert"]', {
    hasText: "no se pudieron agregar",
  });
  await refusals.waitFor();
  const refused = await text(refusals);
  log("refused files:", refused);
  check(
    refused.includes("enorme.jpg") && refused.includes("25 MB"),
    "a file that is too large was not refused",
  );
  check(refused.includes("logo.svg") && refused.includes("SVG"), "an SVG was not refused");
  check(
    refused.includes("notas.jpg") && refused.includes("no es una foto"),
    "a text file renamed to .jpg was not refused",
  );
  check(
    (await seller.locator("main:visible [data-queued-photo]").count()) === 0,
    "a refused file was queued",
  );

  await chooser.setInputFiles([
    jpeg("cafetera-frente.jpg", photo1),
    jpeg("cafetera-jarra.jpg", photo2),
  ]);
  await seller.locator("main:visible [data-queued-photo]").nth(1).waitFor();
  log("queued:", await text(seller.locator("main:visible [data-queued-photo]").first()));
  // Text is required before anything is sent.
  await seller.click('main:visible button:has-text("Guardar como borrador")');
  await seller.locator('main:visible [data-queued-photo] [role="alert"]').first().waitFor();
  log(
    "without text:",
    await text(seller.locator('main:visible [data-queued-photo] [role="alert"]').first()),
  );
  await seller.getByLabel("Texto alternativo de la foto nueva 1").fill(ALT_1);
  await seller.getByLabel("Texto alternativo de la foto nueva 2").fill(ALT_2);
  await seller.screenshot({ path: `${SHOTS}/pp1-new-listing-photos.png`, fullPage: true });
  await seller.click('main:visible button:has-text("Guardar como borrador")');
  await seller.waitForURL((u) => new URL(u).pathname === "/productos", { timeout: 30000 });
  log("after saving:", await text(seller.locator('main:visible [role="status"]').first()));

  // 2. The draft's edit page: two photos waiting, in order, then sent to review
  const row = seller.locator("main:visible tbody tr", { hasText: TITLE });
  await row.locator('a:has-text("Editar")').click();
  await seller.locator("main h1:visible", { hasText: TITLE }).waitFor();
  const editUrl = seller.url();
  const productId = new URL(editUrl).pathname.split("/").pop();
  const managed = seller.locator("main:visible [data-photo]");
  check((await managed.count()) === 2, `the draft has ${await managed.count()} photos, not 2`);
  log("photo 1:", await text(managed.first()));
  check(
    (await managed.first().locator("input").inputValue()) === ALT_1,
    "the first photo is not the first one chosen",
  );
  check(
    (await text(managed.first())).includes("Se revisa con el producto"),
    "draft photo state not shown",
  );
  const previewSrc = await managed.first().locator("img").getAttribute("src");
  check(
    previewSrc?.includes("/storage/v1/object/sign/product-photos-pending/"),
    `preview is not a signed link: ${previewSrc}`,
  );
  await seller.screenshot({ path: `${SHOTS}/pp2-draft-photos.png`, fullPage: true });

  // The waiting files are not retrievable by anyone who only knows where they are.
  const waitingPath = decodeURIComponent(
    new URL(previewSrc).pathname.replace("/storage/v1/object/sign/product-photos-pending/", ""),
  );
  const sizes = ["400", "800", "1600"];
  for (const size of sizes) {
    const path = waitingPath.replace(/\/400\.jpg$/, `/${size}.jpg`);
    const pub = await storage("GET", `/object/public/product-photos-pending/${path}`);
    const approvedBucket = await storage("GET", `/object/public/product-photos/${path}`);
    const anonymous = await storage("GET", `/object/product-photos-pending/${path}`);
    const signed = await storage("POST", `/object/sign/product-photos-pending/${path}`, {
      type: "application/json",
      body: JSON.stringify({ expiresIn: 60 }),
    });
    check(
      pub.json?.code === "NoSuchBucket",
      `waiting ${size} public address answered ${pub.status} ${pub.json?.code}`,
    );
    check(approvedBucket.json?.code === "NoSuchKey", `waiting ${size} is in the public bucket`);
    check(anonymous.json?.code === "NoSuchKey", `waiting ${size} downloadable by a visitor`);
    check(!signed.json?.signedURL, `a visitor could sign a link to waiting ${size}`);
  }
  log("waiting files: public address", "NoSuchBucket", "| visitor download", "NoSuchKey");

  // A client that skips the browser: the storage service and the server still decide.
  const sellerToken = await tokenOf(sellerContext);
  const reserved = await rpc(sellerToken, "seller_reserve_photo", { p_product_id: productId });
  check(reserved.status === 200, `reserve answered ${reserved.status}`);
  const files = reserved.body.files;
  const signUpload = async (path) =>
    (
      await storage("POST", `/object/upload/sign/product-photos-pending/${path}`, {
        token: sellerToken,
        type: "application/json",
        body: "{}",
      })
    ).json;
  const big = await signUpload(files[0].path);
  const tooLarge = await storage(
    "PUT",
    `/object/upload/sign/product-photos-pending/${files[0].path}?token=${big.token}`,
    {
      type: "image/jpeg",
      body: Buffer.concat([photo1.subarray(0, 4), Buffer.alloc(3 * 1024 * 1024)]),
    },
  );
  check(tooLarge.json?.code === "EntityTooLarge", `3 MB upload answered ${tooLarge.json?.code}`);
  const svg = await storage(
    "PUT",
    `/object/upload/sign/product-photos-pending/${files[0].path}?token=${big.token}`,
    {
      type: "image/svg+xml",
      body: "<svg xmlns='http://www.w3.org/2000/svg'/>",
    },
  );
  check(svg.json?.code === "InvalidMimeType", `SVG upload answered ${svg.json?.code}`);
  const otherPath = await storage(
    "PUT",
    `/object/upload/sign/product-photos-pending/${files[1].path}?token=${big.token}`,
    {
      type: "image/jpeg",
      body: photo1,
    },
  );
  check(
    otherPath.json?.code === "InvalidSignature",
    `upload to another path answered ${otherPath.json?.code}`,
  );
  log("hostile uploads:", tooLarge.json?.code, svg.json?.code, otherPath.json?.code);
  // Text declared as a JPEG: storage cannot tell, so it is accepted there...
  for (const file of files) {
    const signed = file === files[0] ? big : await signUpload(file.path);
    const put = await storage(
      "PUT",
      `/object/upload/sign/product-photos-pending/${file.path}?token=${signed.token}`,
      {
        type: "image/jpeg",
        body: Buffer.from("texto que dice ser una foto"),
      },
    );
    check(put.status === 200, `text-as-jpeg upload answered ${put.status}`);
  }
  // ...and finishing it directly (not through the seller centre, which reads the bytes) works too,
  // so it reaches review: the console must catch it before it is published.
  const finished = await rpc(sellerToken, "seller_finish_photo", {
    p_photo_id: reserved.body.photo_id,
    p_alt: "Foto falsa enviada sin el navegador",
    p_width: 1600,
    p_height: 1200,
  });
  check(finished.body?.state === "pending", `fake photo finish: ${JSON.stringify(finished.body)}`);

  await seller.reload({ waitUntil: "networkidle" });
  await seller.click('main:visible button:has-text("Guardar y enviar a revisión")');
  const sent = seller.locator('main:visible [role="status"]', {
    hasText: "En revisión; todavía no está publicado",
  });
  await sent.waitFor();
  log("sent:", await text(sent));

  // 3. Staff publish the listing: the photos are approved with it, the fake one is refused
  await signIn(staff, OPS, "central@yuntera.example");
  await staff.goto(`${OPS}/catalogo`, { waitUntil: "networkidle" });
  const card = staff.locator("main li", { hasText: TITLE }).first();
  const reviewPhotos = card.locator("[data-review-photo]");
  check(
    (await reviewPhotos.count()) === 3,
    `staff see ${await reviewPhotos.count()} photos, not 3`,
  );
  check(
    await reviewPhotos
      .first()
      .locator("img")
      .evaluate((img) => img.complete && img.naturalWidth > 0),
    "staff cannot see the first waiting photo",
  );
  log("staff see:", (await text(card)).slice(0, 220));
  await staff.screenshot({ path: `${SHOTS}/pp3-staff-new-listing.png`, fullPage: true });
  await card.locator('button:has-text("Publicar")').click();
  // Once published the listing leaves the queue (and its message with it).
  await staff
    .locator("main li", { hasText: TITLE })
    .first()
    .waitFor({ state: "detached", timeout: 30000 });
  log("published: the listing left the queue");

  // 4. The shop shows both photos, in order, with their text, from the public bucket
  let shop = await openShop(SLUG);
  let shown = await gallery(shop);
  log(
    "shop gallery:",
    shown.map((p) => `${p.alt} [${p.loaded ? "ok" : "not loaded"}]`).join(" | "),
  );
  check(shown.length === 2, `the shop shows ${shown.length} photos, not 2`);
  check(
    shown[0]?.alt === ALT_1 && shown[1]?.alt === ALT_2,
    "the shop's photos or their text are wrong",
  );
  check(
    shown.every((p) => p.loaded),
    "a photo did not load",
  );
  check(
    shown.every((p) => p.src.includes("/storage/v1/object/public/product-photos/")),
    "a photo is not from the public bucket",
  );
  check(shown[0]?.srcset.includes("400w") && shown[0]?.srcset.includes("1600w"), "no srcset");
  const first = shop.locator('main section[aria-roledescription="carrusel"] li img').first();
  check((await first.getAttribute("fetchpriority")) === "high", "first photo is not prioritised");
  check(
    (await shop
      .locator('main section[aria-roledescription="carrusel"] li img')
      .nth(1)
      .getAttribute("loading")) === "lazy",
    "second photo is not lazy",
  );
  // keyboard: arrow right moves to the second photo
  await shop.locator('main section[aria-roledescription="carrusel"] ul').focus();
  await shop.keyboard.press("ArrowRight");
  await shop
    .locator('main section[aria-roledescription="carrusel"] [aria-live]', {
      hasText: "Foto 2 de 2",
    })
    .waitFor();
  await shop.locator('main button[aria-label^="Ver foto 1"]').click();
  await shop
    .locator('main section[aria-roledescription="carrusel"] [aria-live]', {
      hasText: "Foto 1 de 2",
    })
    .waitFor();
  // the fake photo's file never reached the public bucket
  const fakePath = files[0].path;
  check(
    (await storage("GET", `/object/public/product-photos/${fakePath}`)).json?.code === "NoSuchKey",
    "the fake photo is public",
  );

  // On a phone: right-sized photo, nothing moves sideways, and the search shows the thumbnail.
  shop = await openShop(SLUG, { width: 390, height: 844 });
  shown = await gallery(shop);
  log("phone picks:", shown[0]?.src.split("/").pop(), "| sideways:", await overflow(shop));
  check(
    !shown[0]?.src.endsWith("/1600.jpg") || (await shop.evaluate(() => devicePixelRatio)) > 2,
    "a phone downloads the largest copy",
  );
  check((await overflow(shop)) <= 0, "the product page scrolls sideways at 390 px");
  await shop.screenshot({ path: `${SHOTS}/pp4-shop-gallery-390.png`, fullPage: true });
  shop = await openShop(`/buscar?q=${encodeURIComponent("cafetera nimbo jarra")}`, {
    width: 390,
    height: 844,
  });
  const thumb = shop
    .locator("main article", { hasText: "Cafetera de goteo Nimbo" })
    .locator("img")
    .first();
  const thumbSrc = await thumb.evaluate((img) => img.currentSrc || img.src).catch(() => "");
  log("search thumbnail:", thumbSrc.split("/").slice(-2).join("/"));
  check(thumbSrc.includes("/storage/v1/object/public/product-photos/"), "search shows no photo");

  // 5. The seller sees the rejected fake with its reason, then changes the published photos
  await seller.goto(editUrl, { waitUntil: "networkidle" });
  const rejected = seller.locator("main:visible [data-rejected-photo]");
  check((await rejected.count()) === 1, "the rejected photo is not shown to the seller");
  log("rejected:", await text(rejected.first()));
  check(
    (await text(rejected.first())).includes("no es una foto válida"),
    "the rejection has no reason",
  );
  await rejected.first().locator('button:has-text("Quitar de la lista")').click();
  await seller.locator("main:visible [data-rejected-photo]").waitFor({ state: "detached" });

  const approvedBefore = await managed.first().getAttribute("data-photo");
  check(
    (await text(managed.first())).includes("Aprobada"),
    "the approved photo state is not shown",
  );
  await seller
    .locator('main:visible input[type="file"][multiple]')
    .setInputFiles([jpeg("cafetera-botones.jpg", photo3), jpeg("cafetera-caja.jpg", photo4)]);
  await seller.locator("main:visible [data-queued-photo]").nth(1).waitFor();
  await seller.getByLabel("Texto alternativo de la foto nueva 1").fill(ALT_3);
  await seller.getByLabel("Texto alternativo de la foto nueva 2").fill(ALT_4);
  await seller.click('main:visible button:has-text("Subir 2 fotos")');
  await seller
    .locator('main:visible [role="status"]', { hasText: "Fotos subidas" })
    .waitFor({ timeout: 30000 });
  await seller.locator("main:visible [data-photo]").nth(3).waitFor();
  check(
    (await text(seller.locator("main:visible [data-photo]").nth(2))).includes("En revisión"),
    "a new photo of a published listing is not waiting",
  );
  await seller.click('main:visible button:has-text("Quitar la foto 1")');
  await seller
    .locator('main:visible [role="status"]', { hasText: "se quitará cuando aprobemos" })
    .waitFor();
  await seller.locator("main:visible [data-leaving-photo]").waitFor();
  log(
    "seller after the change:",
    (await text(seller.locator('main:visible section[aria-labelledby="fotos"]'))).slice(0, 300),
  );
  await seller.setViewportSize({ width: 390, height: 844 });
  await seller.screenshot({ path: `${SHOTS}/pp5-seller-photos-390.png`, fullPage: true });
  check((await overflow(seller)) <= 0, "the seller's photo page scrolls sideways at 390 px");
  await seller.setViewportSize({ width: 1280, height: 900 });

  // The shop still shows the approved two.
  shop = await openShop(SLUG);
  shown = await gallery(shop);
  log("shop while the change waits:", shown.map((p) => p.alt).join(" | "));
  check(
    shown.length === 2 && shown[0]?.alt === ALT_1 && shown[1]?.alt === ALT_2,
    "the shop changed before review",
  );

  // 6. Another seller can touch none of it
  const otherContext = await browser.newContext({ locale: "es-CR" });
  const other = await otherContext.newPage();
  watch(other);
  await signIn(other, SELLER, "cafetal@yuntera.example");
  await other.goto(editUrl, { waitUntil: "networkidle" });
  // The page streams, so "not found" arrives as the page's content rather than its status.
  const otherSees = await text(other.locator("main:visible").first());
  check(
    otherSees.includes("No encontramos esa página") && !otherSees.includes(TITLE),
    `another seller opened the edit page: ${otherSees.slice(0, 80)}`,
  );
  const otherToken = await tokenOf(otherContext);
  const theirs = await rpc(otherToken, "seller_photos", { p_product_id: productId });
  check(
    theirs.body?.message === "listing_not_found",
    `another seller read the photos: ${theirs.status}`,
  );
  const theirRemove = await rpc(otherToken, "seller_remove_photo", { p_photo_id: approvedBefore });
  check(theirRemove.body?.message === "photo_not_found", "another seller removed a photo");
  const theirReserve = await rpc(otherToken, "seller_reserve_photo", { p_product_id: productId });
  check(theirReserve.body?.message === "listing_not_found", "another seller reserved a photo");
  const theirSign = await storage(
    "POST",
    `/object/upload/sign/product-photos-pending/${files[1].path.replace(/\/[^/]+\/800\.jpg$/, "/00000000-0000-4000-8000-000000000000/400.jpg")}`,
    { token: otherToken, type: "application/json", body: "{}" },
  );
  check(
    theirSign.json?.code === "AccessDenied",
    `another seller could sign an upload: ${theirSign.json?.code}`,
  );
  const theirDelete = await storage("DELETE", "/object/product-photos", {
    token: otherToken,
    type: "application/json",
    body: JSON.stringify({
      prefixes: sizes.map((s) =>
        shown[0].src.split("/product-photos/")[1].replace(/\/\d+\.jpg$/, `/${s}.jpg`),
      ),
    }),
  });
  check(
    Array.isArray(theirDelete.json) && theirDelete.json.length === 0,
    "another seller deleted a public file",
  );
  const theirCopy = await storage("POST", "/object/copy", {
    token: otherToken,
    type: "application/json",
    body: JSON.stringify({
      bucketId: "product-photos-pending",
      sourceKey: files[1].path,
      destinationKey: files[1].path,
      destinationBucket: "product-photos",
    }),
  });
  check(
    theirCopy.json?.code === "NoSuchKey" || theirCopy.json?.code === "AccessDenied",
    `another seller copied a file: ${theirCopy.json?.code}`,
  );
  log(
    "another seller:",
    otherSees.slice(0, 30),
    theirs.body?.message,
    theirRemove.body?.message,
    theirSign.json?.code,
    theirCopy.json?.code,
  );
  await otherContext.close();

  // 7. Staff: reject the photo with the other brand's box, approve the rest
  await staff.goto(`${OPS}/catalogo`, { waitUntil: "networkidle" });
  const change = staff.locator(`[data-photo-change="${productId}"]`);
  await change.waitFor();
  log("change for review:", (await text(change)).slice(0, 260));
  check((await text(change)).includes("Se quita"), "the removal is not shown");
  await staff.screenshot({ path: `${SHOTS}/pp6-staff-photo-change.png`, fullPage: true });
  const boxed = change.locator("[data-review-photo]", { hasText: ALT_4 }).last();
  await boxed.locator("summary").click();
  await boxed.locator('textarea[name="note"]').fill(REASON);
  await boxed.locator('button:has-text("Rechazar foto")').click();
  // A refused photo is no longer proposed, so it leaves the card.
  await change.locator("[data-review-photo]", { hasText: ALT_4 }).waitFor({ state: "detached" });
  await change.locator('button:has-text("Aprobar fotos")').click();
  await staff.waitForSelector(
    'main section[aria-labelledby="fotos"] >> text=No hay fotos por revisar',
    {
      timeout: 30000,
    },
  );
  log("approved: the photo change left the queue");

  // 8. The shop shows the new set: the second photo first, then the third
  shop = await openShop(SLUG);
  shown = await gallery(shop);
  log(
    "shop after approval:",
    shown.map((p) => `${p.alt} [${p.loaded ? "ok" : "not loaded"}]`).join(" | "),
  );
  check(
    shown.length === 2 && shown[0]?.alt === ALT_2 && shown[1]?.alt === ALT_3,
    "the shop does not show the new set",
  );
  check(
    shown.every((p) => p.loaded),
    "a new photo did not load",
  );
  const removedPublic = await storage("GET", `/object/public/product-photos/${waitingPath}`);
  check(
    removedPublic.json?.code === "NoSuchKey",
    `the removed photo is still served: ${removedPublic.status}`,
  );
  await shop.screenshot({ path: `${SHOTS}/pp7-shop-new-set.png`, fullPage: true });

  // 9. The seller reads why the fourth photo was refused
  await seller.goto(editUrl, { waitUntil: "networkidle" });
  const reason = seller.locator("main:visible [data-rejected-photo]", { hasText: ALT_4 });
  await reason.waitFor();
  log("seller reads:", await text(reason));
  check((await text(reason)).includes(REASON), "the seller does not see the rejection reason");
  await seller.screenshot({ path: `${SHOTS}/pp8-seller-rejected-reason.png`, fullPage: true });

  await browser.close();
  if (errors.length > 0) {
    console.error(`\n${errors.length} problem(s):\n- ${errors.join("\n- ")}`);
    process.exit(1);
  }
  log("\nproduct-photos journey passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
