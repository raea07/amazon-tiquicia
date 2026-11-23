/**
 * Contract tests for the staff operations tools (areas/operations.ts): the
 * answers of the real database functions match the schemas, for the right
 * caller, and the wrong caller gets a typed refusal.
 *
 * What these tests change they undo: the zone they create is deleted, the
 * holiday removed, the closure cancelled and its row deleted, the location
 * they create deleted and the setting put back, so the other contract suites
 * see the seeded data. Removing stops and closing routes is covered by
 * supabase/tests/165_console_operations.sql, which builds its own routes.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SETTING_TEXT } from "./areas/operations";
import { contractDatabase } from "./contract.helpers";

const db = contractDatabase();

/** A day far enough ahead that nothing is planned on it, as YYYY-MM-DD. */
const daysAhead = (days: number) => {
  const date = new Date(Date.now() - 6 * 3600_000 + days * 86_400_000);
  return date.toISOString().slice(0, 10);
};

describe.skipIf(!db.enabled)("operations contract (against a seeded database)", () => {
  beforeAll(db.connect);

  afterAll(async () => {
    // Leave the seed as it was if a test stopped half way.
    await staff()
      .opsDeleteZone("contrato-zona")
      .catch(() => undefined);
    await db.query("delete from public.zone_closure_periods where note = 'Prueba de contrato'");
    await db.query("delete from public.warehouse_locations where code = 'Y-99-99-Z'");
    await db.query(
      "delete from public.holidays where name = 'Feriado de contrato' and day > current_date",
    );
    await db.close();
  });

  const staff = () => db.as("central@yuntera.example");
  const shopper = () => db.as("comprador@yuntera.example");

  it("refuses shoppers and visitors", async () => {
    await expect(shopper().opsDeliveryZones()).rejects.toMatchObject({ code: "forbidden" });
    await expect(shopper().opsSettings()).rejects.toMatchObject({ code: "forbidden" });
    await expect(shopper().opsOpenRoutes()).rejects.toMatchObject({ code: "forbidden" });
    await expect(db.as().opsHolidays()).rejects.toMatchObject({ code: "not_authenticated" });
  });

  it("lists zones, and creates and deletes one", async () => {
    const zones = await staff().opsDeliveryZones();
    const core = zones.find((zone) => zone.id === "gam-core");
    expect(core).toMatchObject({ active: true, in_use: true });
    expect(core?.district_count).toBeGreaterThan(0);
    const created = await staff().opsCreateZone("contrato-zona", {
      name: "Zona de contrato",
      cutoffHour: 12,
      processingWeekdays: [1, 2, 3, 4, 5],
      deliveryWeekdays: [1, 2, 3, 4, 5],
      transitMinDays: 1,
      transitMaxDays: 2,
      shippingFeeMinor: 200_000,
      freeShippingThresholdMinor: null,
      codAvailable: false,
    });
    expect(created).toMatchObject({ id: "contrato-zona", active: false, district_count: 0 });
    await expect(
      staff().opsUpdateZone("contrato-zona", created.revision + 1, {
        name: "Zona de contrato",
        cutoffHour: 12,
        processingWeekdays: [1],
        deliveryWeekdays: [1],
        transitMinDays: 1,
        transitMaxDays: 2,
        shippingFeeMinor: 200_000,
        freeShippingThresholdMinor: null,
        codAvailable: false,
      }),
    ).rejects.toMatchObject({ code: "zone_changed_meanwhile" });
    await staff().opsDeleteZone("contrato-zona");
    await expect(staff().opsDeleteZone("gam-core")).rejects.toMatchObject({ code: "zone_in_use" });
  });

  it("lists cantons and districts, and previews a move", async () => {
    const cantons = await staff().opsDistrictCantons();
    expect(cantons.find((canton) => canton.code === "115")?.zones).toContain("gam-core");
    const canton = await staff().opsCantonDistricts("115");
    expect(canton.districts.length).toBeGreaterThan(1);
    const preview = await staff().opsDistrictMovePreview(["11501"], null);
    expect(preview).toMatchObject({ changing_count: 1, target: null });
    expect(preview.saved_address_count).toBeGreaterThanOrEqual(1);
    await expect(staff().opsCantonDistricts("999")).rejects.toMatchObject({
      code: "canton_not_found",
    });
  });

  it("adds and removes a holiday", async () => {
    const calendar = await staff().opsHolidays();
    expect(calendar.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const free = Array.from({ length: 60 }, (_, i) => daysAhead(300 + i)).find(
      (candidate) => !calendar.holidays.some((holiday) => holiday.day === candidate),
    );
    if (!free) throw new Error("no free day found");
    expect(await staff().opsAddHoliday({ day: free, name: "Feriado de contrato" })).toMatchObject({
      day: free,
      promised_orders: 0,
    });
    await expect(staff().opsAddHoliday({ day: free, name: "Otra vez" })).rejects.toMatchObject({
      code: "holiday_exists",
    });
    expect(await staff().opsRemoveHoliday(free)).toMatchObject({ day: free });
    await expect(
      staff().opsAddHoliday({ day: calendar.today, name: "Hoy mismo" }),
    ).rejects.toMatchObject({ code: "holiday_in_past" });
  });

  it("opens, moves and ends a closure", async () => {
    const opened = await staff().opsOpenZoneClosure({
      zoneId: "gam-extended",
      startsOn: daysAhead(200),
      endsOn: daysAhead(201),
      reason: "other",
      note: "Prueba de contrato",
    });
    expect(opened).toMatchObject({ state: "upcoming", reason: "other", revision: 1 });
    const moved = await staff().opsChangeZoneClosureEnd(opened.id, daysAhead(203), 1);
    expect(moved.ends_on).toBe(daysAhead(203));
    const listed = await staff().opsZoneClosures();
    expect(listed.closures.some((closure) => closure.id === opened.id)).toBe(true);
    const ended = await staff().opsEndZoneClosure(opened.id, moved.revision);
    expect(ended.state).toBe("cancelled");
  });

  it("lists every setting with words for it, and changes an operational one back and forth", async () => {
    const settings = await staff().opsSettings();
    expect(settings.filter((setting) => !(setting.key in SETTING_TEXT)).map((s) => s.key)).toEqual(
      [],
    );
    expect(settings.find((setting) => setting.key === "payments_mode")?.editable).toBe(false);
    const limit = settings.find((setting) => setting.key === "max_open_reports_per_account");
    expect(limit).toMatchObject({ editable: true, unit: "count" });
    const before = Number(limit?.value);
    const changed = await staff().opsUpdateSetting(
      "max_open_reports_per_account",
      before + 1,
      before,
    );
    expect(changed.value).toBe(before + 1);
    await staff().opsUpdateSetting("max_open_reports_per_account", before, before + 1);
    await expect(staff().opsUpdateSetting("payments_mode", 1, "sandbox")).rejects.toMatchObject({
      code: "setting_protected",
    });
  });

  it("lists warehouse locations and creates one", async () => {
    const warehouses = await staff().opsWarehouseLocations();
    const sjo = warehouses.find((warehouse) => warehouse.code === "SJO1");
    expect(sjo?.locations.length).toBeGreaterThan(0);
    const created = await staff().opsCreateLocation(sjo?.id ?? "", "y-99-99-z", "storage");
    expect(created).toMatchObject({ code: "Y-99-99-Z", active: true, editable: true, units: 0 });
    await expect(staff().opsCreateLocation(sjo?.id ?? "", "A01", "storage")).rejects.toMatchObject({
      code: "location_code_invalid",
    });
  });

  it("lists open routes without codes, names or phones", async () => {
    const routes = await staff().opsOpenRoutes();
    for (const route of routes) {
      expect(JSON.stringify(route)).not.toMatch(/"(pin|code_value|recipient_name|phone)"/);
    }
  });
});
