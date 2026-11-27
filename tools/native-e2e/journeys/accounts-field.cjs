// The account screens of the drivers' app (Yuntera Ruta) and the warehouse
// app (Yuntera Bodega), web export, at phone size. For each app:
//
// 1. The sign-in screen sends a password-reset e-mail.
// 2. The demo driver or warehouse worker opens Su cuenta, sees the password
//    change, and is told that the account cannot be deleted while it holds
//    that role, and what to do.
// 3. A throwaway account the app is not for signs in, is offered the
//    deletion on the screen that says so, and deletes the account: the app
//    returns to its sign-in screen, which says so, and nothing of the
//    account stays on the phone.
//
// Fails on any console error, uncaught exception or 5xx, except refusals a
// step provokes on purpose (lib/accounts.cjs, `expect`).

const { chromium } = require("playwright");
const {
  check,
  deleteThroughScreen,
  log,
  mail,
  openAccount,
  phone,
  requestReset,
  signIn,
  throwaway,
} = require("../lib/accounts.cjs");

const APPS = [
  {
    name: "driver",
    url: process.env.NATIVE_DRIVER_URL || "http://127.0.0.1:3012",
    member: "repartidor@yuntera.example",
    home: "driver-route",
    blocker: /registrada como repartidor.*operaciones/,
  },
  {
    name: "warehouse",
    url: process.env.NATIVE_WAREHOUSE_URL || "http://127.0.0.1:3013",
    member: "bodega@yuntera.example",
    home: "warehouse-board",
    blocker: /asignada a una bodega.*operaciones/,
  },
];

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  for (const app of APPS) {
    log(`  ${app.name}:`);

    // 1. The reset request from the sign-in screen
    const r = await phone(browser, `${app.name}-reset`, errors);
    await r.page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await requestReset(r, app.member);
    await r.on("reset-sent").waitFor();
    check(
      /Si esa dirección tiene una cuenta/.test(await r.said("reset-sent")) &&
        (await mail(app.member, "recovery")) !== null,
      "the sign-in screen sends the reset e-mail, with the same answer as everywhere",
    );
    await r.noSideways("reset");
    await r.shot(`accounts-${app.name}-01-reset`);
    await r.on("reset-back").click();
    await r.on("sign-in-email").waitFor();

    // 2. The demo member: Su cuenta, and why the account cannot go yet
    await signIn(r, app.member);
    await r.on(app.home).waitFor();
    await openAccount(r);
    await r.on("account-email").waitFor();
    check(
      (await r.said("account-email")) === app.member &&
        (await r.on("password-current").isVisible()) &&
        (await r.on("password-new").isVisible()),
      "Su cuenta shows the account and the password change, as the field app does",
    );
    await r.noSideways("account");
    await r.shot(`accounts-${app.name}-02-account`, true);
    await r.on("open-delete-account").click();
    await r.on("deletion-blockers").waitFor();
    const blocked = await r.said("deletion-blockers");
    check(
      app.blocker.test(blocked) && !/account_/.test(blocked),
      `the ${app.name} is told the role stands in the way and what to do`,
    );
    check(!(await r.page.getByTestId("delete-submit").count()), "and there is no delete button");
    await r.noSideways("deletion blocked");
    await r.shot(`accounts-${app.name}-03-deletion-blocked`, true);
    await r.on("delete-cancel").click();
    await r.on("account-email").waitFor();
    check(true, "«Volver a su cuenta sin eliminarla» goes back");
    await r.context.close();

    // 3. An account this app is not for deletes itself from the no-access screen
    const stray = await throwaway(`${app.name}-ajeno`, "Andrés Ajeno");
    const p = await phone(browser, `${app.name}-delete`, errors);
    await p.page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await signIn(p, stray);
    await p.on("no-access").waitFor();
    await p.on("no-access-delete").waitFor();
    const link = await p.on("no-access-delete").boundingBox();
    check(
      link !== null && link.height >= 44,
      "the screen for an account the app is not for offers the deletion (44 px or more)",
    );
    await p.on("no-access-delete").click();
    await deleteThroughScreen(p, stray, app.name);
    await p.on("sign-in-email").waitFor();
    check(true, "the app is back on its sign-in screen");
    await p.shot(`accounts-${app.name}-04-deleted`);
    await p.context.close();
  }
  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((error) => {
  console.error("FAILED:", String(error.message ?? error).slice(0, 800));
  process.exit(1);
});
