// The team and the shop-change requests give the seller centre's answers,
// and follow its rules for who may do what. The seller centre's own files
// are read so a change on one side shows up here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  CHANGE_SENT,
  CONTACT_SENT,
  canRevoke,
  checkContact,
  checkFiscal,
  checkInvite,
  checkShopName,
  INVITATION_REVOKED,
  invitationSent,
  LEAVE_UNTICKED,
  MEMBER_REMOVED,
  memberActions,
  ROLE_LABEL,
} from "./team";

const centre = (path: string) =>
  readFileSync(join(__dirname, "../../../seller/src", path), "utf8").replace(/\s+/g, " ");
const has = (text: string, part: string) => assert.ok(text.includes(part), part);

const member = (role: "owner" | "admin" | "staff", isYou = false) => ({
  user_id: "6f0a2f5e-1111-4c1a-9d7a-2f1e8a6b4c3d",
  full_name: "Ana",
  email: "ana@correo.example",
  role,
  since: "2026-11-01T00:00:00Z",
  is_you: isYou,
});
const owner = { is_owner: true, can_manage: true };
const admin = { is_owner: false, can_manage: true };
const staff = { is_owner: false, can_manage: false };

describe("who may do what in the team", () => {
  it("lets the owner change roles and remove anyone but the owner", () => {
    assert.deepEqual(memberActions(owner, member("admin")), {
      changeRole: true,
      remove: true,
      leave: false,
    });
    assert.deepEqual(memberActions(owner, member("owner", true)), {
      changeRole: false,
      remove: false,
      leave: false,
    });
  });

  it("lets an administrator remove staff only, and change no role", () => {
    assert.deepEqual(memberActions(admin, member("staff")), {
      changeRole: false,
      remove: true,
      leave: false,
    });
    assert.deepEqual(memberActions(admin, member("admin")), {
      changeRole: false,
      remove: false,
      leave: false,
    });
  });

  it("lets anyone but the owner leave", () => {
    assert.deepEqual(memberActions(staff, member("staff", true)), {
      changeRole: false,
      remove: false,
      leave: true,
    });
    assert.equal(memberActions(admin, member("admin", true)).leave, true);
  });

  it("lets only the owner withdraw an invitation to administration", () => {
    const invitation = (role: "admin" | "staff") => ({
      id: "6f0a2f5e-2222-4c1a-9d7a-2f1e8a6b4c3d",
      email: "b@c.cr",
      role,
      created_at: "2026-11-01T00:00:00Z",
      expires_at: "2026-11-15T00:00:00Z",
      invited_by_name: "Ana",
    });
    assert.equal(canRevoke(owner, invitation("admin")), true);
    assert.equal(canRevoke(admin, invitation("admin")), false);
    assert.equal(canRevoke(admin, invitation("staff")), true);
  });

  it("is the seller centre's rule", () => {
    const page = centre("app/equipo/page.tsx");
    has(page, 'const canChange = team.is_owner && member.role !== "owner";');
    has(
      page,
      'member.role !== "owner" && (team.is_owner || (team.can_manage && member.role === "staff"));',
    );
    has(page, 'team.is_owner || invitation.role === "staff"');
    for (const label of Object.values(ROLE_LABEL)) has(page, `"${label}"`);
  });
});

describe("inviting", () => {
  it("checks the address and the role, and lowers the address", () => {
    assert.deepEqual(checkInvite({ email: " Ana@Correo.Example ", role: "staff" }, false), {
      email: "ana@correo.example",
      role: "staff",
    });
    assert.deepEqual(checkInvite({ email: "ana@correo", role: "staff" }, true), {
      error: "Escriba el correo con que la persona ingresa a Yuntera.",
    });
    assert.deepEqual(checkInvite({ email: "a@b.cr", role: null }, true), {
      error: "Elija qué podrá hacer la persona en la tienda.",
    });
    // Only the owner offers "administración".
    assert.deepEqual(checkInvite({ email: "a@b.cr", role: "admin" }, false), {
      error: "Elija qué podrá hacer la persona en la tienda.",
    });
  });

  it("says what the seller centre says", () => {
    const actions = centre("app/team-actions.ts");
    // The seller centre's template literal, with its placeholder left in.
    has(actions, invitationSent(["$", "{email}"].join("")));
    has(actions, LEAVE_UNTICKED);
    has(actions, `"${MEMBER_REMOVED}"`);
    has(actions, `"${INVITATION_REVOKED}"`);
    has(actions, "Escriba el correo con que la persona ingresa a Yuntera.");
  });
});

describe("the team screen", () => {
  const screen = readFileSync(join(__dirname, "../app/(app)/equipo.tsx"), "utf8").replace(
    /\s+/g,
    " ",
  );
  it("keeps the confirmation of a removal or a withdrawal on the list, not on the row that goes", () => {
    // The rows hand the words up; the list holds and shows them.
    has(screen, "onDone(MEMBER_REMOVED)");
    has(screen, "onDone(INVITATION_REVOKED)");
    has(screen, 'testID="team-notice"');
    assert.ok(!screen.includes("setResult({ ok: MEMBER_REMOVED"), "the row must not hold it");
    assert.ok(!screen.includes('"La persona ya no es parte del equipo."'));
  });
});

describe("requests to change the shop's details", () => {
  it("check the name as the seller centre does", () => {
    assert.deepEqual(checkShopName("  Ferretería   Nueva "), { tradeName: "Ferretería Nueva" });
    assert.deepEqual(checkShopName("F"), {
      error: "Escriba el nombre nuevo de la tienda (entre 2 y 80 letras).",
    });
    assert.ok("error" in checkShopName("x".repeat(81)));
  });

  it("check the contact and send the phone in international form", () => {
    assert.deepEqual(checkContact({ email: "Ventas@Tienda.CR", phone: "2222 3333" }), {
      contactEmail: "ventas@tienda.cr",
      contactPhone: "+50622223333",
    });
    assert.deepEqual(checkContact({ email: "ventas", phone: "22223333" }), {
      error: "Escriba un correo de contacto válido.",
    });
    assert.deepEqual(checkContact({ email: "a@b.cr", phone: "123" }), {
      error: "Escriba un teléfono costarricense de 8 dígitos.",
    });
  });

  it("check the fiscal details, leaving blank codes as they are on file", () => {
    const form = {
      taxRegime: "general",
      fiscalAddress: "San José, Montes de Oca, San Pedro, 200 m norte",
      postalCode: "",
      economicActivityCode: "",
    };
    assert.deepEqual(checkFiscal(form), {
      input: {
        taxRegime: "general",
        fiscalAddress: form.fiscalAddress,
        postalCode: null,
        economicActivityCode: null,
      },
    });
    assert.deepEqual(checkFiscal({ ...form, taxRegime: "" }), {
      error: "Elija el régimen tributario.",
    });
    assert.deepEqual(checkFiscal({ ...form, fiscalAddress: "San José" }), {
      error: "Escriba la dirección fiscal completa: provincia, cantón, distrito y señas.",
    });
    assert.deepEqual(checkFiscal({ ...form, postalCode: "123" }), {
      error: "El código postal tiene 5 dígitos.",
    });
    assert.deepEqual(checkFiscal({ ...form, economicActivityCode: "12" }), {
      error: "El código de actividad económica tiene de 4 a 6 dígitos.",
    });
  });

  it("say what the seller centre says", () => {
    const actions = centre("app/shop-change-actions.ts");
    for (const text of [
      CHANGE_SENT,
      CONTACT_SENT,
      "Escriba el nombre nuevo de la tienda (entre 2 y 80 letras).",
      "Escriba un correo de contacto válido.",
      "Escriba un teléfono costarricense de 8 dígitos.",
      "Escriba la dirección fiscal completa: provincia, cantón, distrito y señas.",
      "El código postal tiene 5 dígitos.",
      "El código de actividad económica tiene de 4 a 6 dígitos.",
    ]) {
      has(actions, text);
    }
  });
});
