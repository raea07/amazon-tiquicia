/**
 * Contract tests for people management and seller payouts: the real functions,
 * called as each role, answer in the shape the client's schemas expect.
 *
 * Unlike the first contract suite these functions cannot all be exercised by
 * reading the seed: there is no bank-detail request and no payout run in it.
 * So this suite creates one of each, and removes exactly what it created when
 * it finishes, leaving the seeded database as it found it. (The audit trail is
 * append-only and keeps its entries.)
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contractDatabase } from "./contract.helpers";
import { ApiError } from "./errors";

const db = contractDatabase();

const STAFF = "central@yuntera.example";
const SELLER = "vendedor@yuntera.example";
const SHOPPER = "comprador@yuntera.example";
const OTHER_SELLER = "cafetal@yuntera.example";
const ANY_ID = "00000000-0000-4000-8000-000000000000";
const FULL_IBAN = /CR\d{20}/;

describe.skipIf(!db.enabled)("people and payouts contract (against a seeded database)", () => {
  let tecnocasa = "";
  let ferreteria = "";
  let cutoff = "";
  let runExistedBefore = true;
  const createdRequests: string[] = [];
  let createdRun: string | null = null;

  beforeAll(async () => {
    await db.connect();
    const sellers = await db.query<{ slug: string; id: string }>(
      "select slug, id from public.sellers where slug in ('tecnocasa', 'ferreteria-el-higueron')",
    );
    tecnocasa = sellers.rows.find((row) => row.slug === "tecnocasa")?.id ?? "";
    ferreteria = sellers.rows.find((row) => row.slug === "ferreteria-el-higueron")?.id ?? "";
    // Yesterday's cut-off: far enough back that nobody is working on it by hand.
    const day = await db.query<{ cutoff: string; exists: boolean }>(
      `select (private.cr_local(now())::date - 1)::text as cutoff,
              exists (select 1 from public.payout_runs
                      where cutoff_on = private.cr_local(now())::date - 1) as exists`,
    );
    cutoff = day.rows[0]?.cutoff ?? "";
    runExistedBefore = day.rows[0]?.exists ?? true;
  });

  afterAll(async () => {
    if (createdRequests.length > 0) {
      await db.query("delete from public.payout_detail_requests where id = any($1::uuid[])", [
        createdRequests,
      ]);
    }
    if (createdRun && !runExistedBefore) {
      await db.query("delete from public.payouts where run_id = $1", [createdRun]);
      await db.query("delete from public.payout_runs where id = $1", [createdRun]);
    }
    await db.close();
  });

  describe("people", () => {
    it("lists the staff with names, for an administrator", async () => {
      const staff = await db.as(STAFF).opsStaff();
      const admin = staff.find((member) => member.email === STAFF);
      expect(admin).toMatchObject({
        full_name: "Gabriela Soto Marín",
        role: "admin",
        active: true,
        is_you: true,
      });
    });

    it("lists each driver's whole record, and saves one", async () => {
      const api = db.as(STAFF);
      const drivers = await api.opsDrivers();
      const carlos = drivers.find((driver) => driver.email === "repartidor@yuntera.example");
      expect(carlos).toMatchObject({
        full_name: "Carlos Méndez Porras",
        id_type: "fisica",
        id_number: "112340567",
        license_class: "A2",
        plate: "MOT-482913",
      });
      if (!carlos) return;

      // Saving the record with its own values changes nothing a person can see.
      const saved = await api.opsSaveDriver({
        driverId: carlos.id,
        fullName: carlos.full_name,
        phone: carlos.phone,
        idType: "fisica",
        idNumber: carlos.id_number,
        vehicleType: carlos.vehicle_type,
        plate: carlos.plate,
        capacityKg: carlos.capacity_kg,
        licenseClass: carlos.license_class,
        licenseExpiresOn: carlos.license_expires_on,
        inspectionExpiresOn: carlos.inspection_expires_on,
        insuranceExpiresOn: carlos.insurance_expires_on,
      });
      expect(saved).toBe(carlos.id);
      expect((await api.opsDrivers()).find((driver) => driver.id === carlos.id)).toEqual(carlos);
    });

    it("lists the warehouses with their workers", async () => {
      const [warehouse] = await db.as(STAFF).opsWarehouseStaff();
      expect(warehouse?.code).toBe("SJO1");
      expect(warehouse?.staff).toContainEqual(
        expect.objectContaining({ email: "bodega@yuntera.example", role: "lead" }),
      );
    });

    it("names who did what in the audit trail", async () => {
      const entries = await db.as(STAFF).auditEntries("drivers", 20);
      expect(entries.length).toBeGreaterThan(0);
      // The save above was made by the administrator, to Carlos's record.
      expect(entries[0]).toMatchObject({
        action: "UPDATE",
        actor_name: "Gabriela Soto Marín",
        subject: "Carlos Méndez Porras",
      });
    });

    it("explains a refusal in words", async () => {
      const error = await db
        .as(STAFF)
        .opsSetStaff("nadie@yuntera.example", "support")
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("account_not_found");
      expect((error as ApiError).userMessage("es-CR")).toMatch(/^No hay ninguna cuenta/);
    });

    it("is closed to everyone who is not staff of the right role", async () => {
      for (const email of [SHOPPER, SELLER]) {
        const api = db.as(email);
        for (const attempt of [
          () => api.opsStaff(),
          () => api.opsSetStaff(SHOPPER, "admin"),
          () => api.opsWarehouseStaff(),
          () => api.opsSetWarehouseStaff(ANY_ID, SHOPPER, "lead"),
        ]) {
          await expect(attempt()).rejects.toMatchObject({ code: "forbidden" });
        }
      }
      await expect(db.as().opsStaff()).rejects.toMatchObject({ code: "not_authenticated" });
    });
  });

  describe("sellers' bank details", () => {
    it("shows the seller masked numbers only, before and after a request", async () => {
      const api = db.as(SELLER);
      const before = await api.sellerPayoutDetails(ferreteria);
      expect(before.can_request).toBe(true);
      expect(before.current.iban_masked).toMatch(/^CR•• .* \d{4}$/);

      const requestId = await api.sellerRequestPayoutDetails({
        sellerId: ferreteria,
        iban: "CR86 0151 0002 0019 6886 37",
        holderName: "Roberto Jiménez Arce",
        sinpeNumber: "+50685550303",
      });
      createdRequests.push(requestId);

      const after = await api.sellerPayoutDetails(ferreteria);
      expect(after.request).toMatchObject({
        id: requestId,
        status: "pending",
        iban_masked: "CR•• •••• •••• •••• 8637",
        note: null,
      });
      expect(JSON.stringify(after)).not.toMatch(FULL_IBAN);
    });

    it("shows finance the requested account in full, and the current one masked", async () => {
      const queue = await db.as(STAFF).opsPayoutDetailRequests();
      const request = queue.find((item) => item.seller.id === ferreteria);
      expect(request).toMatchObject({
        status: "pending",
        requested: { iban: "CR86015100020019688637", holder_name: "Roberto Jiménez Arce" },
        seller: { trade_name: "Ferretería El Higuerón", contact_phone: "+50622610303" },
        signals: { first_account: false, holder_differs: false, used_by_other_shop: false },
      });
      expect(request?.current.iban_masked).toMatch(/^CR•• /);
      expect(JSON.stringify(request?.current)).not.toMatch(FULL_IBAN);
    });

    it("explains an invalid account number", async () => {
      await expect(
        db.as(SELLER).sellerRequestPayoutDetails({
          sellerId: ferreteria,
          iban: "CR86015100020019688638",
          holderName: "Roberto Jiménez Arce",
        }),
      ).rejects.toMatchObject({ code: "invalid_iban" });
    });

    it("is closed to other shops, shoppers and visitors", async () => {
      for (const email of [SHOPPER, OTHER_SELLER]) {
        const api = db.as(email);
        for (const attempt of [
          () => api.sellerPayoutDetails(ferreteria),
          () =>
            api.sellerRequestPayoutDetails({
              sellerId: ferreteria,
              iban: "CR05015202001026284066",
              holderName: "Otra Persona",
            }),
          () => api.opsPayoutDetailRequests(),
          () => api.opsDecidePayoutDetails(ANY_ID, true),
        ]) {
          await expect(attempt()).rejects.toMatchObject({ code: "forbidden" });
        }
      }
      await expect(db.as().sellerPayoutDetails(ferreteria)).rejects.toMatchObject({
        code: "not_authenticated",
      });
    });
  });

  describe("payouts", () => {
    it("previews a cut-off: who would be paid, and why not the others", async () => {
      const preview = await db.as(STAFF).opsPayoutPreview(cutoff);
      expect(preview).toMatchObject({ cutoff_on: cutoff, hold_days: 10, minimum_minor: 500_000 });
      const waiting = preview.sellers.find((seller) => seller.seller_id === ferreteria);
      expect(waiting).toMatchObject({ will_pay: false, reasons: ["below_minimum"] });
      for (const seller of preview.sellers) {
        expect(seller.available_minor + seller.pending_minor + seller.in_transit_minor).toBe(
          seller.payable_minor,
        );
      }
      expect(JSON.stringify(preview)).not.toMatch(FULL_IBAN);
      // Today's preview is the default.
      expect((await db.as(STAFF).opsPayoutPreview()).cutoff_on).toBe(preview.today);
    });

    it("creates a run, lists it and opens it with the transfer list", async () => {
      const api = db.as(STAFF);
      const created = await api.opsCreatePayoutRun(cutoff);
      createdRun = created.run_id;
      expect(created.code).toBe(`PV-${cutoff.replaceAll("-", "")}`);
      if (!runExistedBefore) {
        expect(created.created).toBeGreaterThan(0);
        expect(created.total_minor).toBeGreaterThan(0);
      }
      // The same cut-off again schedules nothing more.
      expect(await api.opsCreatePayoutRun(cutoff)).toMatchObject({
        run_id: created.run_id,
        created: 0,
        total_minor: 0,
      });

      const runs = await api.opsPayoutRuns();
      expect(runs.find((run) => run.id === created.run_id)).toMatchObject({
        code: created.code,
        cutoff_on: cutoff,
      });

      const run = await api.opsPayoutRun(created.run_id);
      expect(run.run.code).toBe(created.code);
      const payout = run.payouts.find((item) => item.seller_id === tecnocasa);
      expect(payout).toMatchObject({
        status: "scheduled",
        trade_name: "TecnoCasa",
        iban: "CR21010200009123456789",
        holder_name: "TecnoCasa de Costa Rica S.A.",
      });
      expect(payout?.reference).toMatch(/^YUNTERA PV-\d{8}-\d{3}$/);
      expect(payout?.amount_minor).toBeGreaterThan(500_000);
    });

    it("shows the seller three balances that add up, and the payout in transit", async () => {
      const money = await db.as(SELLER).sellerPayouts(tecnocasa);
      expect(money.available_minor + money.pending_minor + money.in_transit_minor).toBe(
        money.payable_minor,
      );
      expect(money.in_transit_minor).toBeGreaterThan(0);
      expect(
        money.releases.reduce((sum, release) => sum + release.amount_minor, 0) +
          money.awaiting_delivery_minor,
      ).toBe(money.pending_minor);
      expect(money.payouts[0]).toMatchObject({ status: "scheduled", cutoff_on: cutoff });
      expect(JSON.stringify(money)).not.toMatch(FULL_IBAN);
      // The summary the seller centre already showed agrees with it.
      expect((await db.as(SELLER).sellerOverview(tecnocasa)).payable_minor).toBe(
        money.payable_minor,
      );
    });

    it("explains refusals: an unknown run, a cut-off in the future", async () => {
      const api = db.as(STAFF);
      await expect(api.opsPayoutRun(ANY_ID)).rejects.toMatchObject({
        code: "payout_run_not_found",
      });
      await expect(api.opsCreatePayoutRun("2999-01-01")).rejects.toMatchObject({
        code: "invalid_cutoff",
      });
      await expect(api.opsMarkPayoutPaid(ANY_ID, "BNCR-0001")).rejects.toMatchObject({
        code: "payout_not_found",
      });
    });

    it("is closed to sellers, shoppers and visitors", async () => {
      for (const email of [SHOPPER, SELLER]) {
        const api = db.as(email);
        for (const attempt of [
          () => api.opsPayoutPreview(),
          () => api.opsCreatePayoutRun(cutoff),
          () => api.opsPayoutRuns(),
          () => api.opsPayoutRun(createdRun ?? ANY_ID),
          () => api.opsMarkPayoutPaid(ANY_ID, "BNCR-0001"),
          () => api.opsMarkPayoutFailed(ANY_ID, "cuenta cerrada"),
        ]) {
          await expect(attempt()).rejects.toMatchObject({ code: "forbidden" });
        }
      }
      await expect(db.as(OTHER_SELLER).sellerPayouts(tecnocasa)).rejects.toMatchObject({
        code: "forbidden",
      });
      await expect(db.as(SHOPPER).sellerPayouts(tecnocasa)).rejects.toMatchObject({
        code: "forbidden",
      });
      await expect(db.as().opsPayoutPreview()).rejects.toMatchObject({
        code: "not_authenticated",
      });
    });
  });
});
