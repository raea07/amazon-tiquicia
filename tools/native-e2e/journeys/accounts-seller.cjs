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
// 4b. Offline, removing a member or sending an invitation fails at once with
//    the network message, and nothing is sent once the connection is back.
//    The owner then removes that member, and the list says so; a third
//    account declines its invitation in the app.
// 5. The owner asks to rename the shop (a name too short first; offline,
//    nothing is sent) and withdraws the request.
// 5b. A description the owner asked for (in the seller centre) shows on the
//    account screen with the seller centre's words, says where the
//    description and the logo are changed, and is withdrawn from the app.
// 6. The owner saves the shop's notification settings, the consent recorded
//    as given in the app; a save after a change elsewhere is refused and the
//    screen shows what is stored now.
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
  check(
    (await o.said("team-notice")) === "Invitación retirada.",
    "a second invitation is withdrawn, leaves the list, and the list says so",
  );
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

  // ── 4b. The owner removes a member; another invitation is declined ─────
  await o.page.goto(`${BASE}/equipo`, { waitUntil: "networkidle" });
  await o.on("invite-email").fill(other);
  await o.on("invite-submit").click();
  await o.page
    .getByTestId("team-invitation")
    .filter({ visible: true, hasText: other })
    .first()
    .waitFor();
  const offered = (await rpcAs(other, "my_invitations")).find((i) => i.shop.id === shop.id);
  await rpcAs(other, "seller_answer_invitation", {
    p_invitation_id: offered.id,
    p_accept: true,
  });
  await o.page.reload({ waitUntil: "networkidle" });
  const otherRow = o.page.getByTestId("team-member").filter({ visible: true, hasText: other });
  await otherRow.waitFor();

  // Offline: nothing waits to be sent later.
  const unsent = `sin-red-${Date.now()}@correo.example`;
  await o.context.setOffline(true);
  o.expect(/ERR_INTERNET_DISCONNECTED|Failed to fetch/);
  await otherRow.getByTestId("member-remove").click();
  await otherRow
    .getByTestId("member-message")
    .filter({ hasText: "No pudimos conectarnos" })
    .waitFor({ timeout: 10_000 });
  await o.on("invite-email").fill(unsent);
  await o.on("invite-submit").click();
  await o.page
    .getByTestId("invite-message")
    .filter({ visible: true, hasText: "No pudimos conectarnos" })
    .first()
    .waitFor({ timeout: 10_000 });
  await o.shot("accounts-seller-04c-offline", true);
  await o.context.setOffline(false);
  await o.page.waitForTimeout(3000);
  o.expect(null);
  const untouched = await rpcAs(OWNER, "seller_team", { p_seller_id: shop.id });
  check(
    untouched.members.some((person) => person.email === other) &&
      untouched.invitations.every((invitation) => invitation.email !== unsent),
    "offline, a removal and an invitation fail at once, and neither is sent when the connection returns",
  );

  await otherRow.getByTestId("member-remove").click();
  await otherRow.waitFor({ state: "detached" });
  check(
    (await rpcAs(OWNER, "seller_team", { p_seller_id: shop.id })).members.every(
      (person) => person.email !== other,
    ),
    "the owner removes a member, who leaves the list and the team",
  );
  check(
    (await o.said("team-notice")) === "La persona ya no es parte del equipo.",
    "and the list says so after the row is gone",
  );

  const declines = await throwaway("rechaza", "Rita Rechaza");
  await o.on("invite-email").fill(declines);
  await o.on("invite-submit").click();
  await o.page
    .getByTestId("team-invitation")
    .filter({ visible: true, hasText: declines })
    .first()
    .waitFor();
  const d = await phone(browser, "seller-declines", errors);
  await d.page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await signIn(d, declines);
  await d.on("invitation").waitFor();
  await d.on("invitation-decline").click();
  await d.page
    .getByTestId("invitation-message")
    .filter({ visible: true, hasText: "Rechazó la invitación" })
    .first()
    .waitFor();
  await d.noSideways("invitation declined");
  await d.shot("accounts-seller-05b-declined");
  const after = await rpcAs(OWNER, "seller_team", { p_seller_id: shop.id });
  check(
    after.members.every((person) => person.email !== declines) &&
      after.invitations.every((invitation) => invitation.email !== declines) &&
      (await rpcAs(declines, "my_invitations")).length === 0,
    "a declined invitation leaves no member and no invitation waiting",
  );
  await d.context.close();

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
  await o.context.setOffline(true);
  o.expect(/ERR_INTERNET_DISCONNECTED|Failed to fetch/);
  await o.on("shop-name-new").fill(newName);
  await o.on("shop-name-submit").click();
  await o.page
    .getByTestId("shop-name-message")
    .filter({ visible: true, hasText: "No pudimos conectarnos" })
    .first()
    .waitFor({ timeout: 10_000 });
  await o.context.setOffline(false);
  await o.page.waitForTimeout(3000);
  o.expect(null);
  check(
    !(await rpcAs(OWNER, "seller_shop_changes", { p_seller_id: shop.id })).requests.some(
      (r) => r.kind === "shop_name" && r.status === "pending",
    ),
    "offline, the request fails at once and is not sent when the connection returns",
  );
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

  // ── 5b. The shop's description and logo ────────────────────────────────
  await rpcAs(OWNER, "seller_request_shop_description", {
    p_seller_id: shop.id,
    p_description: "Muebles de cenízaro hechos a mano en Sarchí.",
  });
  await o.page.goto(`${BASE}/cuenta`, { waitUntil: "networkidle" });
  await o.on("shop-face-description-status").waitFor();
  check(
    /Descripción nueva en revisión/.test(await o.said("shop-face-description-status")) &&
      /la tienda muestra la que ya tenía/.test(await o.said("shop-face-description-status")),
    "a description waiting for review shows with the seller centre's words",
  );
  check(
    /logotipo/i.test(await o.said("shop-face-logo")) &&
      /«Tienda»/.test(await o.said("shop-face-elsewhere")),
    "the logo's state shows, and the card says where the description and logo are changed",
  );
  await o.shot("accounts-seller-06b-shop-face");
  await o.on("shop-face-withdraw").click();
  await o.on("shop-face-withdraw").waitFor({ state: "detached" });
  check(
    !(await rpcAs(OWNER, "seller_shop_changes", { p_seller_id: shop.id })).requests.some(
      (r) => r.kind === "description" && r.status === "pending",
    ),
    "the description request is withdrawn from the app",
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
  if ((await o.on("notify-commercial").getAttribute("aria-checked")) !== "true") {
    await o.on("notify-commercial").click();
  }
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
  check(
    settings.commercial.opt_in === true && settings.commercial.source === "seller_app",
    `the shop's consent is recorded as given in the seller app (${settings.commercial.source})`,
  );
  // Another device saves while the screen is open.
  await rpcAs(OWNER, "seller_set_notification_settings", {
    p_seller_id: shop.id,
    p_whatsapp: true,
    p_push: !settings.push_enabled,
    p_phone: "+50687770101",
  });
  o.expect(/status of 4\d\d/);
  await o.on("notify-save").click();
  await o.page
    .getByTestId("notify-message")
    .filter({ visible: true, hasText: "cambiaron en otro teléfono o en el sitio web" })
    .first()
    .waitFor();
  o.expect(null);
  check(
    (await o.on("notify-push").getAttribute("aria-checked")) === String(!settings.push_enabled),
    "a save after a change elsewhere is refused, and the screen shows what is stored now",
  );
  await o.on("notify-save").click();
  await o.page
    .getByTestId("notify-message")
    .filter({ visible: true, hasText: "Guardamos las preferencias de su tienda." })
    .first()
    .waitFor();
  check(true, "saving again works");
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
