/**
 * Contract tests for the catalogue follow-ups (areas/catalogue-followups.ts):
 * the brand list with what can be deleted, and deleting a brand. The answers
 * of the real database functions match the schemas, for the right caller, and
 * the wrong caller gets a typed refusal.
 *
 * What these tests change they undo: the brands they create are deleted (by
 * the function under test, or directly if a test stopped half way).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contractDatabase } from "./contract.helpers";

const db = contractDatabase();

describe.skipIf(!db.enabled)("catalogue follow-ups contract (against a seeded database)", () => {
  beforeAll(db.connect);

  afterAll(async () => {
    await db.query("delete from public.brands where slug like 'marca-contrato-borrar%'");
    await db.close();
  });

  const staff = () => db.as("central@yuntera.example", "aal2");

  it("refuses everyone but catalogue staff", async () => {
    const brand = await staff().opsCreateBrand(
      "Marca Contrato Borrar Uno",
      "marca-contrato-borrar-uno",
    );
    await expect(db.as().opsDeleteBrand(brand.id)).rejects.toMatchObject({
      code: "not_authenticated",
    });
    await expect(db.as("comprador@yuntera.example").opsDeleteBrand(brand.id)).rejects.toMatchObject(
      {
        code: "forbidden",
      },
    );
    await expect(db.as("vendedor@yuntera.example").opsDeleteBrand(brand.id)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(db.as("comprador@yuntera.example").opsCatalogBrands()).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(await staff().opsDeleteBrand(brand.id)).toEqual({
      id: brand.id,
      name: "Marca Contrato Borrar Uno",
      slug: "marca-contrato-borrar-uno",
      merged_removed: 0,
    });
  });

  it("lists every brand with its products in any status, and which can go", async () => {
    const brand = await staff().opsCreateBrand(
      "Marca Contrato Borrar Dos",
      "marca-contrato-borrar-dos",
    );
    const brands = await staff().opsCatalogBrands();
    const fresh = brands.find((row) => row.id === brand.id);
    expect(fresh).toMatchObject({ all_product_count: 0, deletable: true, merged_into: null });
    const nimbo = brands.find((row) => row.slug === "nimbo");
    expect(nimbo?.all_product_count).toBeGreaterThan(0);
    expect(nimbo?.all_product_count).toBeGreaterThanOrEqual(nimbo?.product_count ?? 0);
    expect(nimbo?.deletable).toBe(false);
    // A brand in use: refused with the number of products.
    await expect(staff().opsDeleteBrand(nimbo?.id ?? "")).rejects.toMatchObject({
      code: "brand_in_use",
      detail: String(nimbo?.all_product_count),
    });
    await staff().opsDeleteBrand(brand.id);
    await expect(staff().opsDeleteBrand(brand.id)).rejects.toMatchObject({
      code: "brand_not_found",
    });
  });
});
