// The shopper app's account screens (apps/shop-native), web export, at
// phone size:
//
// 1. "Olvidé mi contraseña": the same answer for an account and for an
//    address without one, a reset e-mail only for the account, whose link
//    opens the shop's website; the new password is set there (on the local
//    shop when the lane's web apps run, otherwise through Auth as that page
//    would) and the shopper signs in to the app with it.
// 2. An account with an authenticator app gives its code in the app.
// 3. A visitor reports a listing, with the website's refusals first; the
//    report reaches staff's queue once.
// 4. The demo shopper chooses WhatsApp and gives the commercial consent;
//    both are saved and read back.
// 5. The password changed while signed in, after a wrong current one.
// 6. Deletion: the demo shopper is told what blocks it; a throwaway shopper
//    with a cart deletes the account, and nothing of it stays on the phone.
//
// Fails on any console error, uncaught exception or 5xx, except refusals a
// step provokes on purpose (lib/accounts.cjs, `expect`).

const { chromium } = require("playwright");
const {
  check,
  codeAt,
  deleteThroughScreen,
  enrolAuthenticator,
  freshCode,
  http,
  log,
  mail,
  phone,
  rpcAs,
  signIn,
  throwaway,
} = require("../lib/accounts.cjs");

const BASE = process.env.NATIVE_SHOP_URL || "http://127.0.0.1:3010";
const WEB = process.env.WEB_URL || "http://127.0.0.1:3000";
const SHOPPER = "comprador@yuntera.example";
const STAFF = "central@yuntera.example";
// The web export is built without EXPO_PUBLIC_SHOP_URL, so the app names the
// shop's planned address; the lane's Auth stand-in is told to accept it.
const WEBSITE = "https://www.yuntera.cr";

async function webIsUp() {
  try {
    const r = await fetch(`${WEB}/ingresar`, { signal: AbortSignal.timeout(3000) });
    return r.status < 500;
  } catch {
    return false;
  }
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  await http("POST", "/dev/settings", { data: { uri_allow_list: `${WEBSITE}/auth/confirm` } });

  // ── 1. Password reset ────────────────────────────────────────────────────
  const forgetful = await throwaway("olvido", "Olga Olvido");
  const a = await phone(browser, "shop-reset", errors);
  await a.page.goto(`${BASE}/ingresar`, { waitUntil: "networkidle" });
  await a.on("forgot-password").waitFor();
  check(
    (await a.said("forgot-password")) === "Olvidé mi contraseña",
    "the sign-in screen offers «Olvidé mi contraseña», with its accent",
  );
  const box = await a.on("forgot-password").boundingBox();
  check(box !== null && box.height >= 44, "and it is at least 44 px tall");
  await a.on("forgot-password").click();
  await a.on("reset-email").waitFor();
  await a.on("reset-email").fill("olga@correo");
  await a.on("reset-submit").click();
  check(
    (await a.said("reset-message")) === "Escriba un correo válido.",
    "an address that is not one is refused before anything is sent",
  );
  await a.on("reset-email").fill(forgetful.toUpperCase());
  await a.on("reset-submit").click();
  await a.on("reset-sent").waitFor();
  const answer = await a.said("reset-sent");
  const next = await a.said("reset-next");
  check(/Si esa dirección tiene una cuenta en Yuntera/.test(answer), `the answer: ${answer}`);
  check(
    /abre el sitio web de Yuntera/.test(next) && /vuelva a esta aplicación e ingrese/.test(next),
    "it explains that the link opens the website, and to sign in here afterwards",
  );
  await a.noSideways("reset sent");
  await a.shot("accounts-shop-01-reset-sent");
  await a.on("reset-back").click();
  await a.on("forgot-password").click();
  const stranger = `nadie-${Date.now()}@prueba.example`;
  await a.on("reset-email").fill(stranger);
  await a.on("reset-submit").click();
  await a.on("reset-sent").waitFor();
  check(
    (await a.said("reset-sent")) === answer,
    "an address without an account gets exactly the same answer",
  );
  check((await mail(stranger)) === null, "and no e-mail goes to it");
  const sent = await mail(forgetful, "recovery");
  check(sent !== null, "the account's address gets the reset e-mail");
  const link = new URL(sent.link);
  check(
    `${link.origin}${link.pathname}` === `${WEBSITE}/auth/confirm` &&
      link.searchParams.get("type") === "recovery" &&
      /^[0-9a-f]{40,}$/.test(link.searchParams.get("token_hash") ?? ""),
    `its link opens the website's confirmation page (${link.origin}${link.pathname})`,
  );

  const NEW_PASSWORD = "nueva-clave-del-sitio";
  if (await webIsUp()) {
    const web = await phone(browser, "shop-website", errors);
    await web.page.goto(`${WEB}/auth/confirm${link.search}`, { waitUntil: "networkidle" });
    await web.page.getByRole("button", { name: "Continuar" }).click();
    await web.page.waitForURL(/\/recuperar\/nueva/);
    await web.page.locator('input[name="password"]').fill(NEW_PASSWORD);
    await web.page.locator('input[name="repeat"]').fill(NEW_PASSWORD);
    await web.page
      .getByRole("button", { name: /contraseña/i })
      .last()
      .click();
    await web.page.getByText("su contraseña cambió").first().waitFor();
    await web.shot("accounts-shop-02-website-new-password");
    check(true, "the link, opened on the shop's website, sets the new password there");
    await web.context.close();
  } else {
    // The lane's web apps are not running: what the website's page does, through Auth.
    const verified = await http("POST", "/auth/v1/verify", {
      data: { type: "recovery", token_hash: link.searchParams.get("token_hash") },
    });
    const changed = await http("PUT", "/auth/v1/user", {
      data: { password: NEW_PASSWORD },
      token: verified.body?.access_token,
    });
    check(
      verified.status === 200 && changed.status === 200,
      "the link's token sets a new password (through Auth: the lane's website is not running)",
    );
  }
  await a.on("reset-back").click();
  await signIn(a, forgetful, NEW_PASSWORD);
  await a.page.waitForURL((url) => new URL(url).pathname === "/");
  check(true, "the shopper signs in to the app with the new password");

  // ── 5. Password change while signed in (this account, now signed in) ──
  await a.page.goto(`${BASE}/cuenta/contrasena`, { waitUntil: "networkidle" });
  await a.on("password-current").waitFor();
  a.expect(/status of 400.*\/auth\/v1\/token/);
  await a.on("password-current").fill("no-es-esta");
  await a.on("password-new").fill("otra-clave-nueva");
  await a.on("password-repeat").fill("otra-clave-nueva");
  await a.on("password-submit").click();
  await a.page
    .getByTestId("password-message")
    .filter({ visible: true, hasText: "La contraseña actual no coincide." })
    .first()
    .waitFor();
  a.expect(null);
  check(true, "a wrong current password is refused");
  await a.on("password-current").fill(NEW_PASSWORD);
  await a.on("password-new").fill("corta");
  await a.on("password-repeat").fill("corta");
  await a.on("password-submit").click();
  await a.page
    .getByTestId("password-message")
    .filter({ visible: true, hasText: "al menos 8 caracteres" })
    .first()
    .waitFor();
  check(true, "a short new password is refused with the rule");
  const LAST_PASSWORD = "clave-cambiada-en-la-app";
  await a.on("password-current").fill(NEW_PASSWORD);
  await a.on("password-new").fill(LAST_PASSWORD);
  await a.on("password-repeat").fill(LAST_PASSWORD);
  await a.on("password-submit").click();
  await a.page
    .getByTestId("password-message")
    .filter({ visible: true, hasText: "su contraseña cambió" })
    .first()
    .waitFor();
  await a.noSideways("password change");
  await a.shot("accounts-shop-03-password-changed", true);
  const withNew = await http("POST", "/auth/v1/token?grant_type=password", {
    data: { email: forgetful, password: LAST_PASSWORD },
  });
  check(withNew.status === 200, "the changed password is the one that works now");

  // ── 6b. Deletion by a throwaway shopper with something in the cart ─────
  await a.page.goto(`${BASE}/p/camiseta-algodon-sendero`, { waitUntil: "networkidle" });
  await a.on("add-to-cart").click();
  await a.on("added-message").waitFor();
  check((await a.stored()).includes("yt_cart"), "the cart is kept on the phone");
  await a.page.goto(`${BASE}/cuenta`, { waitUntil: "networkidle" });
  await a.on("account-delete").click();
  await a.page.waitForURL(/\/cuenta\/eliminar/);
  const keys = await deleteThroughScreen(a, forgetful, "shop", LAST_PASSWORD);
  check(
    !keys.includes("yt_cart") && !keys.includes("yt_cp"),
    "the cart and the chosen district are gone from the phone",
  );
  check(new URL(a.page.url()).pathname === "/", "the app is back on the shop's home");
  await a.shot("accounts-shop-04-deleted");
  await a.context.close();

  // ── 2. The second step in the app ────────────────────────────────────────
  const careful = await throwaway("dospasos", "Diana Dos Pasos");
  const secret = await enrolAuthenticator(careful);
  const b = await phone(browser, "shop-second-step", errors);
  await b.page.goto(`${BASE}/ingresar?siguiente=/cuenta`, { waitUntil: "networkidle" });
  await signIn(b, careful);
  await b.on("second-step").waitFor();
  check(
    /Verificación en dos pasos/.test(await b.said("second-step")) &&
      new URL(b.page.url()).pathname === "/ingresar",
    "the right password leads to the second step, inside the app, not to the website",
  );
  await b.noSideways("second step");
  await b.shot("accounts-shop-05-second-step");
  b.expect(/status of 422/);
  await b.on("second-step-code").fill(codeAt(secret, Math.floor(Date.now() / 30000) - 20));
  await b.on("second-step-submit").click();
  await b.on("second-step-message").waitFor();
  b.expect(null);
  check(
    /Le quedan 4 intentos/.test(await b.said("second-step-message")),
    "a wrong code is refused, saying how many tries are left",
  );
  await b.on("second-step-code").fill(await freshCode(secret));
  await b.on("second-step-submit").click();
  await b.page.waitForURL((url) => new URL(url).pathname === "/cuenta");
  await b.on("account-orders").waitFor();
  check(true, "the right code signs the shopper in and goes on to the account");
  await b.context.close();

  // ── 3. A visitor reports a listing ───────────────────────────────────────
  const before = await rpcAs(STAFF, "ops_care_queues");
  const c = await phone(browser, "shop-report", errors);
  await c.page.goto(`${BASE}/p/camiseta-algodon-sendero`, { waitUntil: "networkidle" });
  await c.on("report-listing").scrollIntoViewIfNeeded();
  await c.on("report-listing").click();
  await c.page.waitForURL(/\/reportar\?producto=/);
  await c.on("report-submit").click();
  check(
    (await c.said("report-message")) === "Elija qué problema tiene.",
    "a report without a reason is refused",
  );
  await c.on("report-reason-counterfeit").click();
  await c.on("report-details").fill("La marca del empaque no es la original.");
  await c.on("report-submit").click();
  check(
    /Escriba su correo/.test(await c.said("report-message")),
    "a visitor is asked for an address to be contacted at",
  );
  await c.on("report-email").fill("Ana@Correo.example");
  await c.noSideways("report form");
  await c.shot("accounts-shop-06-report-form", true);
  await c.on("report-submit").click();
  await c.page
    .getByTestId("report-message")
    .filter({ visible: true, hasText: "Recibimos su reporte" })
    .first()
    .waitFor();
  await c.shot("accounts-shop-07-report-sent");
  const after = await rpcAs(STAFF, "ops_care_queues");
  check(
    after.totals.reports === before.totals.reports + 1,
    `the report reaches staff's queue (${before.totals.reports} → ${after.totals.reports})`,
  );
  await c.context.close();

  // ── 4. Channels for messages, and the commercial consent ────────────────
  const d = await phone(browser, "shop-channels", errors);
  await d.page.goto(`${BASE}/ingresar?siguiente=/cuenta`, { waitUntil: "networkidle" });
  await signIn(d, SHOPPER);
  await d.on("account-notifications").click();
  await d.page.waitForURL(/\/cuenta\/notificaciones/);
  await d.on("notify-whatsapp").waitFor();
  check(
    (await d.on("notify-commercial").getAttribute("aria-checked")) === "false",
    "the commercial consent starts unticked",
  );
  await d.on("notify-phone").fill("");
  await d.on("notify-whatsapp").click();
  await d.on("notify-save").click();
  check(
    /escriba su número de celular/.test(await d.said("notify-message")),
    "WhatsApp without a number is refused, in the website's words",
  );
  await d.on("notify-phone").fill("2222-3333");
  await d.on("notify-save").click();
  check(
    /celular costarricense de 8 dígitos/.test(await d.said("notify-message")),
    "a landline is refused",
  );
  await d.on("notify-phone").fill("8888 1234");
  await d.on("notify-commercial").click();
  await d.on("notify-save").click();
  await d.page
    .getByTestId("notify-message")
    .filter({ visible: true, hasText: "Guardamos sus preferencias" })
    .first()
    .waitFor();
  await d.noSideways("channel settings");
  await d.shot("accounts-shop-08-channels-saved", true);
  const saved = await rpcAs(SHOPPER, "my_notification_settings");
  check(
    saved.whatsapp_enabled === true &&
      saved.phone === "+50688881234" &&
      saved.commercial.opt_in === true,
    "WhatsApp, the number and the consent are stored",
  );
  await d.page.reload({ waitUntil: "networkidle" });
  await d.on("notify-whatsapp").waitFor();
  check(
    (await d.on("notify-whatsapp").getAttribute("aria-checked")) === "true" &&
      (await d.on("notify-phone").inputValue()) === "88881234",
    "and the screen shows them again after a reload",
  );
  check(
    /Lo aceptó el/.test(await d.said("notify-commercial")),
    "the consent says when it was given",
  );

  // ── 6a. The demo shopper is told what stands in the way ──────────────────
  const blockers = (await rpcAs(SHOPPER, "account_deletion_check")).blockers;
  await d.page.goto(`${BASE}/cuenta/eliminar`, { waitUntil: "networkidle" });
  await d.on("deletion-terms").waitFor();
  if (blockers.length > 0) {
    const shown = await d.said("deletion-blockers");
    check(
      /Todavía no podemos eliminar su cuenta/.test(shown) && !/account_/.test(shown),
      `the shopper with ${blockers.join(", ")} is told plainly what stands in the way`,
    );
    check(!(await d.page.getByTestId("delete-submit").count()), "and there is no delete button");
  } else {
    check(await d.on("delete-submit").isVisible(), "nothing blocks it, so the button is there");
  }
  await d.shot("accounts-shop-09-deletion-blocked", true);
  await d.on("delete-cancel").click();
  await d.context.close();

  await http("POST", "/dev/settings", { data: { uri_allow_list: "" } });
  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((error) => {
  console.error("FAILED:", String(error.message ?? error).slice(0, 800));
  process.exit(1);
});
