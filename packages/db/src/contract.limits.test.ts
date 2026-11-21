/**
 * Contract tests for the limits area: the answers of the real database
 * functions match the schemas in areas/limits.ts, for the right caller, and
 * the wrong caller gets a typed refusal.
 *
 * What these tests create they take back (an invitation is revoked, a request
 * withdrawn, a driver made active again), so other suites see the seed.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contractDatabase } from "./contract.helpers";

const db = contractDatabase();

describe.skipIf(!db.enabled)("limits contract (against a seeded database)", () => {
  let tecnocasa = "";
  let sendero = "";

  beforeAll(async () => {
    await db.connect();
    const { rows } = await db.query<{ slug: string; id: string }>(
      "select slug, id from public.sellers where slug in ('tecnocasa', 'tienda-sendero')",
    );
    tecnocasa = rows.find((row) => row.slug === "tecnocasa")?.id ?? "";
    sendero = rows.find((row) => row.slug === "tienda-sendero")?.id ?? "";
    expect(tecnocasa, "database is not seeded — run pnpm db:local:reset").not.toBe("");
  });

  afterAll(async () => {
    await db.query(
      "update public.drivers set status = 'active' where user_id = (select id from auth.users where email = 'repartidor2@yuntera.example')",
    );
    await db.close();
  });

  const staff = () => db.as("central@yuntera.example");
  const shopper = () => db.as("comprador@yuntera.example");

  it("lists the routes that went back to dispatch, for operations only", async () => {
    const routes = await staff().opsReleasedRoutes(30);
    expect(Array.isArray(routes)).toBe(true);
    await expect(shopper().opsReleasedRoutes()).rejects.toMatchObject({ code: "forbidden" });
  });

  it("gives a driver who is not active their record and no routes", async () => {
    await db.query(
      "update public.drivers set status = 'suspended' where user_id = (select id from auth.users where email = 'repartidor2@yuntera.example')",
    );
    const day = await db.as("repartidor2@yuntera.example").driverToday();
    expect(day.driver.status).toBe("suspended");
    expect(day.routes).toEqual([]);
  });

  it("shows staff the shops that share an identification number", async () => {
    const clashes = await staff().opsSellerIdClashes();
    expect(Array.isArray(clashes)).toBe(true);
    await expect(db.as("vendedor@yuntera.example").opsSellerIdClashes()).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("shows a shop's team to its members, and invitations to the invited", async () => {
    const owner = db.as("vendedor@yuntera.example");
    const team = await owner.sellerTeam(tecnocasa);
    expect(team.can_manage).toBe(true);
    expect(team.members.find((member) => member.is_you)?.role).toBe("owner");
    await expect(shopper().sellerTeam(tecnocasa)).rejects.toMatchObject({ code: "forbidden" });

    const invitation = await owner.sellerInviteMember({
      sellerId: tecnocasa,
      email: "comprador3@yuntera.example",
      role: "staff",
    });
    try {
      const invited = await db.as("comprador3@yuntera.example").myInvitations();
      expect(invited.find((item) => item.id === invitation)).toMatchObject({
        role: "staff",
        shop: { trade_name: "TecnoCasa" },
        invited_by_name: "Roberto",
      });
      const withInvitation = await owner.sellerTeam(tecnocasa);
      expect(withInvitation.invitations.map((item) => item.id)).toContain(invitation);
      await expect(
        db.as("comprador2@yuntera.example").sellerAnswerInvitation(invitation, true),
      ).rejects.toMatchObject({ code: "invitation_not_found" });
    } finally {
      await owner.sellerRevokeInvitation(invitation);
    }
    expect(await db.as("comprador3@yuntera.example").myInvitations()).toEqual([]);
  });

  it("queues a change of the shop's contact for staff, and the seller sees it", async () => {
    const owner = db.as("sendero@yuntera.example");
    const request = await owner.sellerRequestShopChange({
      sellerId: sendero,
      kind: "contact",
      contactEmail: "contacto@sendero.example",
      contactPhone: "+50622890999",
    });
    try {
      const mine = await owner.sellerShopChanges(sendero);
      expect(mine.can_request).toBe(true);
      expect(mine.requests.find((item) => item.id === request)).toMatchObject({
        kind: "contact",
        status: "pending",
        proposed: { contact_phone: "+50622890999" },
      });
      const queue = await staff().opsShopChangeRequests();
      expect(queue.find((item) => item.id === request)).toMatchObject({
        can_decide: true,
        current: { contact_phone: "+50622890404" },
        seller: { trade_name: "Tienda Sendero" },
      });
      await expect(shopper().opsShopChangeRequests()).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        db.as("vendedor@yuntera.example").sellerShopChanges(sendero),
      ).rejects.toMatchObject({ code: "forbidden" });
    } finally {
      await owner.sellerWithdrawShopChange(request);
    }
  });

  it("gives an admin the shop's details on file, so a form keeps what is not changed", async () => {
    const mine = await db.as("sendero@yuntera.example").sellerShopChanges(sendero);
    expect(mine.current?.fiscal).toMatchObject({ postal_code: "10203", tax_regime: "general" });
    expect(mine.current?.contact).toMatchObject({ contact_phone: "+50622890404" });
  });

  it("says whether finance approved the payout account on file", async () => {
    const details = await db.as("vendedor@yuntera.example").sellerPayoutDetails(tecnocasa);
    expect(details.current.approved).toBe(true);
    const money = await db.as("vendedor@yuntera.example").sellerPayouts(tecnocasa);
    expect(money.blocked_by).not.toContain("no_bank_details");
  });

  it("pages the staff queues and says how many there are in all", async () => {
    const queues = await staff().opsCareQueuesPaged();
    expect(queues.totals.reports).toBeGreaterThanOrEqual(queues.reports.length);
    expect(queues.totals.complaints).toBeGreaterThanOrEqual(queues.complaints.length);
    const { rows } = await db.query<{ id: string }>(
      "select id from public.warehouses where code = 'SJO1'",
    );
    const board = await db.as("bodega@yuntera.example").wmsBoardPaged(rows[0]?.id ?? "");
    expect(board.inbound_total).toBeGreaterThanOrEqual(board.inbound.length);
    await expect(shopper().opsCareQueuesPaged()).rejects.toMatchObject({ code: "forbidden" });
  });

  it("withdraws a consent and says how many records it closed", async () => {
    expect(await shopper().withdrawConsent("location")).toBe(0);
  });
});
