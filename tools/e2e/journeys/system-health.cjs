// System health journey (Salud del sistema, /salud, migration 084800).
//
//   1. a visitor is sent to sign in; the uptime robot's ping answers
//      {"ok": true} with the publishable key alone; /api/version tells a
//      visitor nothing;
//   2. an administrator opens /salud with everything in order: no line asks
//      for attention, the scheduled jobs say there is no history here (never
//      "on time"), and the Versiones panel names the commit of the four web
//      apps and the newest migration;
//   3. a message stops and Hacienda rejects a document (made through psql, as
//      the worker and the fake would leave them): both lines turn, say so in
//      words, and lead to the pages where they are fixed;
//   4. the administrator records a phone build by hand, after a wrong
//      version is refused with what was typed kept; then records one with a
//      typo in its number, sees it shown as the current build, removes it,
//      and the right one is shown;
//   5. a support person sees only the message and case lines, and no
//      Versiones;
//   6. screenshots at 1280 and 390 px, without sideways scrolling.
//
// Needs `tools/dev/stack.sh up <lane>`. Fails on any browser error or 5xx.

const { execFileSync, spawnSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { chromium, request } = require("playwright");

const SHOTS = process.env.E2E_SHOTS || require("node:os").tmpdir();
const OPS = process.env.OPS_URL || "http://127.0.0.1:3002";
const API = process.env.API_URL || "http://127.0.0.1:54321";
const API_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_local_development_only";
const HACIENDA = process.env.HACIENDA_FAKE_URL || "http://127.0.0.1:54325";
const PASSWORD = process.env.SEED_PASSWORD || "yuntera-local-dev";
const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5432/yuntera_local";
const ADMIN = "central@yuntera.example";
const SUPPORT = "comprador2@yuntera.example";

const log = (...a) => console.log(...a);
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, " ").trim();
function check(condition, message) {
  if (!condition) throw new Error(`check failed: ${message}`);
  log("ok:", message);
}
async function until(what, fn, seconds = 60) {
  for (let i = 0; i < seconds * 2; i++) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`timed out waiting for ${what}`);
}
function sql(statement) {
  const run = spawnSync(
    "psql",
    [DATABASE_URL, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", statement],
    { encoding: "utf8" },
  );
  if (run.status !== 0) throw new Error(`psql: ${run.stderr}`);
  return run.stdout.trim();
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (page) => {
    page.on("console", (m) => {
      if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200));
    });
    page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 200)));
    page.on("response", (r) => {
      if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`);
    });
  };
  const desktop = { viewport: { width: 1280, height: 900 }, locale: "es-CR" };
  const phone = {
    viewport: { width: 390, height: 844 },
    locale: "es-CR",
    isMobile: true,
    hasTouch: true,
  };
  const overflow = (page) =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  async function signIn(email, path, options = desktop) {
    const page = await (await browser.newContext(options)).newPage();
    watch(page);
    await page.goto(`${OPS}/ingresar?siguiente=${encodeURIComponent(path)}`, {
      waitUntil: "networkidle",
    });
    await page.fill('main input[name="email"]', email);
    await page.fill('main input[name="password"]', PASSWORD);
    await page.click('main form button[type="submit"]');
    await page.waitForURL((u) => new URL(u).pathname === path, {
      timeout: 30000,
    });
    return page;
  }
  const states = (page) =>
    page.$$eval("[data-health]", (rows) =>
      Object.fromEntries(rows.map((row) => [row.dataset.health, row.dataset.state])),
    );

  // ── 1. Visitors ───────────────────────────────────────────────────────────
  const visitor = await (await browser.newContext(desktop)).newPage();
  watch(visitor);
  await visitor.goto(`${OPS}/salud`, { waitUntil: "networkidle" });
  check(new URL(visitor.url()).pathname === "/ingresar", "a visitor is sent to sign in");
  check(
    new URL(visitor.url()).searchParams.get("siguiente") === "/salud",
    "and comes back to /salud afterwards",
  );

  const http = await request.newContext();
  const ping = await http.post(`${API}/rest/v1/rpc/health_ping`, {
    headers: { apikey: API_KEY, "content-type": "application/json" },
    data: {},
  });
  check(ping.status() === 200, `the ping answers 200 (${ping.status()})`);
  check(JSON.stringify(await ping.json()) === '{"ok":true}', 'with {"ok":true} and nothing else');
  const health = await http.post(`${API}/rest/v1/rpc/ops_system_health`, {
    headers: { apikey: API_KEY, "content-type": "application/json" },
    data: {},
  });
  check(
    health.status() >= 400 && health.status() < 500,
    "a visitor cannot read the health page's data",
  );
  const version = await http.get(`${OPS}/api/version`);
  check(version.status() === 404, "/api/version tells a visitor nothing");

  // The seed's messages and documents are handled by the workers when the
  // stack starts: wait for them, so "everything in order" is about this journey.
  const fake = await request.newContext();
  await until(
    "the seed's documents to be answered",
    async () => {
      const docs = await (await fake.get(`${HACIENDA}/_fake/documents`)).json();
      return (
        docs.length > 0 && docs.every((d) => d.state === "aceptado" || d.state === "rechazado")
      );
    },
    120,
  );
  await until(
    "the seed's events to be planned",
    async () =>
      sql(
        "select count(*) from private.outbox_jobs where status = 'pending' and created_at < now() - interval '1 minute'",
      ) === "0",
    120,
  );

  // ── 2. Everything in order ────────────────────────────────────────────────
  const admin = await signIn(ADMIN, "/salud");
  await admin.waitForSelector("[data-health]");
  let seen = await states(admin);
  log("lines:", JSON.stringify(seen));
  check(Object.keys(seen).length === 14, "an administrator sees every line (14)");
  check(
    Object.values(seen).every((state) => state === "ok" || state === "unknown"),
    "nothing asks for attention",
  );
  check(
    (await text(admin.locator('[role="status"]').first())).includes(
      "Todo en orden en lo que se puede comprobar",
    ),
    "and the page says so",
  );
  check(seen.jobs === "unknown", "the jobs line is unknown without a scheduler, not ok");
  check(
    (await admin.locator('[data-jobs="unavailable"] [data-job]').count()) === 7,
    "seven jobs listed",
  );
  check(
    (await text(admin.locator("section:has(#tareas)"))).includes(
      "Eso no quiere decir que corrieran a tiempo",
    ),
    "and the page says there is no history, not that they ran on time",
  );
  // The commit the lane's apps were built from (tools/dev/stack.sh writes it), else this checkout's.
  const built = (() => {
    try {
      const env = readFileSync(`${__dirname}/../../../apps/ops/.env.local`, "utf8");
      return /^YUNTERA_BUILD_COMMIT=([0-9a-f]{7,40})$/m.exec(env)?.[1];
    } catch {
      return undefined;
    }
  })();
  const head = (
    built || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  ).slice(0, 7);
  for (const app of ["ops", "web", "seller", "field"]) {
    const row = await text(admin.locator(`[data-version="${app}"]`));
    check(row.includes(`versión ${head}`), `${app} runs ${head}: "${row}"`);
  }
  const database = await text(admin.locator('[data-version="database"]'));
  check(
    /Último cambio aplicado: 2026112108\d{4}/.test(database),
    `the newest migration: "${database}"`,
  );
  check(!(await text(admin.locator("main"))).includes("@"), "no e-mail on the page");
  await admin.screenshot({
    path: `${SHOTS}/h01-health-good.png`,
    fullPage: true,
  });

  // ── 3. A stopped message and a rejected document ──────────────────────────
  const delivery = sql(
    "select id from private.notification_deliveries where status in ('sent', 'delivered') order by created_at limit 1",
  );
  check(delivery.length === 36, "the seed's messages were sent");
  sql(
    `update private.notification_deliveries set status = 'dead', last_error_code = 'recipient_invalid',
       last_error = 'La dirección no existe' where id = '${delivery}'`,
  );
  const document = sql(
    "select id from public.electronic_invoices where kind = 'delivery' and status = 'accepted' order by issued_at limit 1",
  );
  check(document.length === 36, "the seed has a document Hacienda accepted");
  sql(
    `set session_replication_role = replica;
     update public.electronic_invoices set status = 'rejected', hacienda_state = 'rechazado',
       rejection_source = 'validation', rejected_at = now(), accepted_at = null,
       hacienda_message = 'Rechazado para la prueba de salud del sistema' where id = '${document}'`,
  );
  await admin.goto(`${OPS}/salud`, { waitUntil: "networkidle" });
  seen = await states(admin);
  check(seen.messages_stopped === "problem", "the stopped message turns its line");
  check(seen.invoices === "problem", "the rejected document turns its line");
  const others = Object.entries(seen).filter(
    ([key]) => !["messages_stopped", "invoices"].includes(key),
  );
  check(
    others.every(([, state]) => state === "ok" || state === "unknown"),
    "and only those two",
  );
  check(
    (await text(admin.locator('[role="alert"]').first())).includes(
      "2 comprobaciones necesitan atención",
    ),
    "the page counts them",
  );
  const stopped = await text(admin.locator('[data-health="messages_stopped"]'));
  check(stopped.includes("1 aviso no llegó a la persona"), `in words: "${stopped}"`);
  const invoices = await text(admin.locator('[data-health="invoices"]'));
  check(invoices.includes("1 rechazado por Hacienda"), `in words: "${invoices}"`);
  check(
    (await admin.locator("[data-health]").first().getAttribute("data-state")) === "problem",
    "problems come first",
  );
  await admin.screenshot({
    path: `${SHOTS}/h02-health-problems.png`,
    fullPage: true,
  });
  await admin.click('[data-health="messages_stopped"] a:has-text("Ver los mensajes detenidos")');
  await admin.waitForURL((u) => new URL(u).pathname === "/mensajes");
  await admin.waitForSelector("text=1 mensaje detenido");
  check(true, "the link leads to the stopped message");
  await admin.goto(`${OPS}/salud`, { waitUntil: "networkidle" });
  await admin.click('[data-health="invoices"] a:has-text("Ver los comprobantes")');
  await admin.waitForURL((u) => new URL(u).pathname === "/comprobantes");
  await admin.waitForSelector("text=Rechazado para la prueba de salud del sistema");
  check(true, "the link leads to the rejected document");

  // ── 4. A phone build entered by hand ──────────────────────────────────────
  await admin.goto(`${OPS}/salud`, { waitUntil: "networkidle" });
  check(
    (await text(admin.locator("section:has(#versiones)"))).includes(
      "Todavía no se registró ninguna versión",
    ),
    "no phone build yet",
  );
  const form = admin.locator('form:has(button:has-text("Guardar la versión"))');
  await form.locator('select[name="app"]').selectOption("shop");
  await form.locator('select[name="platform"]').selectOption("android");
  await form.locator('input[name="version"]').fill("0.1");
  await form.locator('input[name="buildNumber"]').fill("4");
  await form.locator('input[name="releasedOn"]').fill("2026-11-23");
  await form.locator('select[name="track"]').selectOption("internal");
  await form.locator('button:has-text("Guardar la versión")').click();
  await admin.waitForSelector("text=Escriba la versión con tres números");
  check(
    (await form.locator('input[name="version"]').inputValue()) === "0.1",
    "a wrong version is refused, kept",
  );
  check((await form.locator('select[name="app"]').inputValue()) === "shop", "and so is the rest");
  await form.locator('input[name="version"]').fill("0.1.0");
  await form.locator('button:has-text("Guardar la versión")').click();
  await admin.waitForSelector("text=Guardamos Yuntera 0.1.0 (4) para Android");
  const listed = await until("the build to be listed", async () => {
    const row = admin.locator('[data-store-build="shop/android"]');
    return (await row.count()) > 0 ? text(row) : null;
  });
  check(
    listed.includes("versión 0.1.0 (4), prueba interna desde el 23 de noviembre de 2026"),
    `listed: "${listed}"`,
  );
  check(
    sql("select count(*) from private.audit_log where table_name = 'store_builds'") === "1",
    "in the audit trail",
  );

  // A typo in the build number (40 for 4) on a later day: it shows as the
  // current build until it is removed.
  await form.locator('select[name="app"]').selectOption("shop");
  await form.locator('select[name="platform"]').selectOption("android");
  await form.locator('input[name="version"]').fill("0.1.0");
  await form.locator('input[name="buildNumber"]').fill("40");
  await form.locator('input[name="releasedOn"]').fill("2026-11-24");
  await form.locator('select[name="track"]').selectOption("internal");
  await form.locator('button:has-text("Guardar la versión")').click();
  await admin.waitForSelector("text=Guardamos Yuntera 0.1.0 (40) para Android");
  const typo = await until("the typo to be listed", async () => {
    const row = await text(admin.locator('[data-store-build="shop/android"]'));
    return row.includes("(40)") ? row : null;
  });
  check(typo.includes("versión 0.1.0 (40)"), `the typo shows as the current build: "${typo}"`);
  const current = admin.locator('[data-store-build="shop/android"]');
  await current.locator('summary:has-text("Quitar esta versión")').click();
  await current.locator('button:has-text("Quitar 0.1.0 (40)")').click();
  await admin.waitForSelector("text=Quitamos Yuntera 0.1.0 (40) para Android");
  const fixed = await until("the right build to be current again", async () => {
    const row = await text(admin.locator('[data-store-build="shop/android"]'));
    return row.includes("(4),") ? row : null;
  });
  check(
    fixed.includes("versión 0.1.0 (4), prueba interna desde el 23 de noviembre de 2026"),
    `after removing the typo, the right build is current: "${fixed}"`,
  );
  check(
    (await admin
      .locator("[data-store-build], [data-store-build-old]")
      .filter({ hasText: "(40)" })
      .count()) === 0,
    "the typo is no longer listed",
  );
  check(
    sql(
      "select string_agg(action, ',' order by id) from private.audit_log where table_name = 'store_builds'",
    ) === "INSERT,INSERT,DELETE",
    "both entries and the removal are in the audit trail",
  );
  await admin.screenshot({
    path: `${SHOTS}/h03-health-versions.png`,
    fullPage: true,
  });

  // At phone width.
  const small = await signIn(ADMIN, "/salud", phone);
  await small.waitForSelector("[data-health]");
  check((await overflow(small)) <= 0, "390 px: no sideways scrolling");
  await small.screenshot({
    path: `${SHOTS}/h04-health-phone.png`,
    fullPage: true,
  });

  // ── 5. A support person ───────────────────────────────────────────────────
  sql(
    `insert into public.staff_members (user_id, role)
     select id, 'support' from auth.users where email = '${SUPPORT}'
     on conflict do nothing`,
  );
  const support = await signIn(SUPPORT, "/salud", phone);
  await support.waitForSelector("[data-health]");
  seen = await states(support);
  check(
    Object.keys(seen).sort().join(",") ===
      "cases_late,events_failed,messages_late,messages_stopped",
    `support sees only the message and case lines: ${Object.keys(seen).join(",")}`,
  );
  check(seen.messages_stopped === "problem", "including the stopped message");
  check((await support.locator("#versiones").count()) === 0, "and no Versiones");
  check((await support.locator("#tareas").count()) === 0, "and no jobs");
  check((await overflow(support)) <= 0, "390 px: no sideways scrolling");
  await support.screenshot({
    path: `${SHOTS}/h05-health-support.png`,
    fullPage: true,
  });

  // Catalogue staff have no lines: the section is not in their console.
  sql(
    `update public.staff_members set role = 'catalog'
     where user_id = (select id from auth.users where email = '${SUPPORT}')`,
  );
  await support.goto(`${OPS}/salud`, { waitUntil: "networkidle" });
  check(
    new URL(support.url()).pathname === "/sin-acceso",
    "catalogue staff are told it is not theirs",
  );

  check(
    errors.length === 0,
    `no browser errors or 5xx${errors.length ? `: ${errors.join(" | ")}` : ""}`,
  );
  await browser.close();
  log("system health journey passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
