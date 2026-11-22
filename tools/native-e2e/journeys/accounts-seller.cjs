// The seller app's account screens (apps/seller-native, "Yuntera Vende"),
// web export, at phone size:
//
// 1. The demo seller, owner of the shop the app opens on, invites a
//    throwaway account (a wrong address first) and withdraws a second
//    invitation.
// 2. The invited account signs in to the app, sees the invitation on the
//    screen for an account without a shop, accepts it and lands in the shop.
// 3. The owner makes the new member an administrator.
// 4. The member leaves the shop (the box first), is back on the screen for
//    an account without a shop, which says so, and deletes the account
//    there: nothing of it stays on the phone.
// 5. The owner asks to rename the shop (a name too short first) and
//    withdraws the request.
// 6. The owner saves the shop's notification settings.
// 7. The owner is told why the account cannot be deleted while running the
//    shop, and the sign-in screen offers the password reset.
//
// Fails on any console error, uncaught exception or 5xx, except refusals a
// step provokes on purpose (lib/accounts.cjs, `expect`).

const { chromium } = require("playwright");
const {
  check,
  deleteThroughScreen,
  log,
  phone,
  rpcAs,
  signIn,
  throwaway,
} = require("../lib/accounts.cjs");

const BASE = process.env.NATIVE_SELLER_URL || "http://127.0.0.1:3011";
const OWNER = "vendedor@yuntera.example";

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const roles = await rpcAs(OWNER, "my_roles");
  const shop = roles.sellers[0];
  check(shop.role === "owner", `the app opens on ${shop.trade_name}, which the demo seller owns`);

  // ── 1. The owner invites ────────────────────────────────────────────────
  const member = await throwaway("equipo", "Mario Miembro");
  const other = await throwaway("otra", "Olivia Otra");
  const o = await phone(browser, "seller-owner", errors);
  await o.page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await signIn(o, OWNER);
  await o.on("seller-overview").waitFor();
  await o.page.goto(`${BASE}/cuenta`, { waitUntil: "networkidle" });
  await o.on("account-links").waitFor();
  await o.on("open-team").click();
  await o.page.waitForURL(/\/equipo/);
  await o.on("team-members").waitFor();
  check(
    /\(usted\)/.test(await o.said("team-members")) && /Dueño/.test(await o.said("team-members")),
    "the team lists the owner, marked as the person using the app",
  );
  await o.on("invite-email").fill("mario@correo");
  await o.on("invite-submit").click();
  check(
    (await o.said("invite-message")) === "Escriba el correo con que la persona ingresa a Yuntera.",
    "a wrong address is refused before anything is sent",
  );
  await o.on("invite-email").fill(member.toUpperCase());
  await o.on("invite-role-staff").click();
  await o.on("invite-submit").click();
  await o.page
    .getByTestId("invite-message")
    .filter({ visible: true, hasText: "Invitación enviada" })
    .first()
    .waitFor();
  check(
    (await o.said("invite-message")).includes(member) &&
      /Vence en 14 días/.test(await o.said("invite-message")),
    "the invitation is sent, in the seller centre's words",
  );
  await o.on("invite-email").fill(other);
  await o.on("invite-submit").click();
  await o.page
    .getByTestId("team-invitation")
    .filter({ visible: true, hasText: other })
    .first()
    .waitFor();
  await o.noSideways("team");
  await o.shot("accounts-seller-01-team-invited", true);
  await o.page
    .getByTestId("team-invitation")
    .filter({ visible: true, hasText: other })
    .getByTestId("invitation-revoke")
    .click();
  await o.page
    .getByTestId("team-invitation")
    .filter({ visible: true, hasText: other })
    .waitFor({ state: "detached" });
  check(true, "a second invitation is withdrawn and leaves the list");
  const pending = (await rpcAs(OWNER, "seller_team", { p_seller_id: shop.id })).invitations;
  check(
    pending.length === 1 && pending[0].email === member,
    "the database holds only the invitation still waiting",
  );

  // ── 2. The invited account accepts in the app ───────────────────────────
  const m = await phone(browser, "seller-member", errors);
  await m.page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await signIn(m, member);
  await m.on("invitation").waitFor();
  const card = await m.said("invitation");
  check(
    card.includes(shop.trade_name) && /le invitó a unirse como personal/.test(card),
    "the invited account sees the invitation: which shop, who and as what",
  );
  await m.noSideways("invitation");
  await m.shot("accounts-seller-02-invitation");
  await m.on("invitation-accept").click();
  await m.on("team-joined").waitFor();
  await m.on("seller-overview").waitFor();
  check(
    (await m.said("seller-overview")).includes(shop.trade_name),
    "accepting opens the app on that shop, which says the person joined",
  );
  await m.shot("accounts-seller-03-joined");

  // ── 3. The owner changes the member's role ─────────────────────────────
  await o.page.reload({ waitUntil: "networkidle" });
  const row = o.page.getByTestId("team-member").filter({ visible: true, hasText: member });
  await row.waitFor();
  await row.getByTestId("member-role-admin").click();
  await row.getByTestId("member-role-save").click();
  await row.getByText("Rol actualizado.").waitFor();
  const team = await rpcAs(OWNER, "seller_team", { p_seller_id: shop.id });
  check(
    team.members.find((person) => person.email === member)?.role === "admin",
    "the owner makes the member an administrator",
  );

  // ── 4. The member leaves, then deletes the account ─────────────────────
  await m.page.goto(`${BASE}/equipo`, { waitUntil: "networkidle" });
  const mine = m.page.getByTestId("team-member").filter({ visible: true, hasText: "(usted)" });
  await mine.waitFor();
  check((await mine.innerText()).includes("Administración"), "the member sees the new role");
  await mine.getByTestId("member-leave").click();
  await mine.getByText("Marque la casilla").waitFor();
  check(true, "leaving needs the box ticked");
  await m.shot("accounts-seller-04-leave", true);
  await mine.getByTestId("member-leave-confirm").click();
  await mine.getByTestId("member-leave").click();
  await m.on("team-left").waitFor();
  check(
    (await m.said("team-left")).includes(shop.trade_name) &&
      (await m.page.getByTestId("no-access").filter({ visible: true }).count()) === 1,
    "out of the team, the member is back on the screen for an account without a shop, which says so",
  );
  check(
    (await rpcAs(OWNER, "seller_team", { p_seller_id: shop.id })).members.every(
      (person) => person.email !== member,
    ),
    "and is no longer in the team",
  );
  await m.on("no-access-delete").click();
  const keys = await deleteThroughScreen(m, member, "seller");
  check(
    !keys.some((key) => key.startsWith("yuntera-vende:shop:")),
    "the remembered shop is gone from the phone",
  );
  await m.on("sign-in-email").waitFor();
  await m.shot("accounts-seller-05-deleted");
  await m.context.close();

  // ── 5. A shop change, requested and withdrawn ──────────────────────────
  await o.page.goto(`${BASE}/cuenta`, { waitUntil: "networkidle" });
  await o.on("shop-name-new").waitFor();
  await o.on("shop-name-new").fill("F");
  await o.on("shop-name-submit").click();
  check(
    /entre 2 y 80 letras/.test(await o.said("shop-name-message")),
    "a name too short is refused",
  );
  const newName = `${shop.trade_name} Express`;
  await o.on("shop-name-new").fill(newName);
  await o.on("shop-name-submit").click();
  await o.on("shop-change-pending").waitFor();
  check(
    (await o.said("shop-change-pending")).includes(newName),
    "the request waits for review and says what was asked for",
  );
  let changes = await rpcAs(OWNER, "seller_shop_changes", { p_seller_id: shop.id });
  check(
    changes.requests.some((r) => r.kind === "shop_name" && r.status === "pending"),
    "the database holds the request, pending",
  );
  await o.noSideways("account");
  await o.shot("accounts-seller-06-shop-change-pending");
  await o.on("shop-change-withdraw").click();
  await o.on("shop-change-pending").waitFor({ state: "detached" });
  changes = await rpcAs(OWNER, "seller_shop_changes", { p_seller_id: shop.id });
  check(
    !changes.requests.some((r) => r.kind === "shop_name" && r.status === "pending"),
    "the request is withdrawn",
  );

  // ── 6. The shop's notification settings ────────────────────────────────
  await o.on("open-shop-notifications").click();
  await o.page.waitForURL(/\/notificaciones/);
  await o.on("notify-whatsapp").waitFor();
  check(!(await o.page.getByTestId("notify-sms").count()), "a shop is offered no SMS");
  if ((await o.on("notify-whatsapp").getAttribute("aria-checked")) !== "true") {
    await o.on("notify-whatsapp").click();
  }
  await o.on("notify-phone").fill("8777-0101");
  await o.on("notify-save").click();
  await o.page
    .getByTestId("notify-message")
    .filter({ visible: true, hasText: "Guardamos las preferencias de su tienda." })
    .first()
    .waitFor();
  const settings = await rpcAs(OWNER, "seller_notification_settings", { p_seller_id: shop.id });
  check(
    settings.whatsapp_enabled === true && settings.phone === "+50687770101",
    "the shop's WhatsApp and number are stored",
  );
  await o.noSideways("shop notifications");
  await o.shot("accounts-seller-07-shop-notifications", true);

  // ── 7. The owner cannot delete the account yet ─────────────────────────
  await o.page.goto(`${BASE}/eliminar-cuenta`, { waitUntil: "networkidle" });
  await o.on("deletion-blockers").waitFor();
  const blocked = await o.said("deletion-blockers");
  check(
    /Todavía no podemos eliminar su cuenta/.test(blocked) && !/account_/.test(blocked),
    `the owner is told what stands in the way: ${blocked.slice(0, 160)}`,
  );
  await o.shot("accounts-seller-08-deletion-blocked", true);
  await o.on("delete-cancel").click();
  await o.context.close();

  const r = await phone(browser, "seller-reset", errors);
  await r.page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await r.on("forgot-password").click();
  await r.on("reset-email").fill(OWNER);
  await r.on("reset-submit").click();
  await r.on("reset-sent").waitFor();
  check(true, "the seller app's sign-in screen sends the reset e-mail too");
  await r.context.close();

  log("\nERRORS:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((error) => {
  console.error("FAILED:", String(error.message ?? error).slice(0, 800));
  process.exit(1);
});
