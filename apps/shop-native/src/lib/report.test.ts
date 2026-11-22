import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkReport, REPORT_REASONS, REPORT_SENT, reportTarget } from "./report";

const web = (path: string) =>
  readFileSync(join(__dirname, "../../../web/src", path), "utf8").replace(/\s+/g, " ");

const ID = "0b3c5a52-3f5e-4c1a-9d7a-2f1e8a6b4c3d";
const target = { type: "product" as const, id: ID };
const form = { reason: "counterfeit" as const, details: "", email: "" };

describe("reporting a listing", () => {
  it("offers the website's reasons, in its words and order", () => {
    const page = web("components/report-form.tsx");
    const actions = web("app/report-actions.ts");
    for (const [value, label] of REPORT_REASONS) {
      expect(page).toContain(`["${value}", "${label}"]`);
      expect(actions).toContain(`"${value}"`);
    }
    expect(actions).toContain(REPORT_SENT);
  });

  it("reads the target from the link, as the website's page does", () => {
    expect(reportTarget({ producto: ID })).toEqual({
      type: "product",
      id: ID,
      label: "esta publicación",
    });
    expect(reportTarget({ tienda: ID })?.type).toBe("seller");
    expect(reportTarget({ resena: ID })?.type).toBe("review");
    expect(reportTarget({ producto: "1; drop table" })).toBeNull();
    expect(reportTarget({})).toBeNull();
  });

  it("needs a reason, and at most 2000 characters of details", () => {
    expect(checkReport({ ...form, reason: null }, target, true)).toEqual({
      error: "Elija qué problema tiene.",
    });
    expect(checkReport({ ...form, details: "x".repeat(2001) }, target, true)).toEqual({
      error: "Los detalles pueden tener hasta 2000 caracteres.",
    });
  });

  it("asks a visitor for an address, and checks any address given", () => {
    expect(checkReport(form, target, false)).toEqual({
      error: "Escriba su correo para que podamos pedirle más datos si hace falta.",
    });
    expect(checkReport({ ...form, email: "ana@correo" }, target, true)).toEqual({
      error: "Revise el correo: debe tener la forma nombre@dominio.com.",
    });
    const actions = web("app/report-actions.ts");
    expect(actions).toContain(
      "Escriba su correo para que podamos pedirle más datos si hace falta.",
    );
    expect(actions).toContain("Revise el correo: debe tener la forma nombre@dominio.com.");
  });

  it("sends what the API takes: trimmed, lower-case, empty as null", () => {
    expect(
      checkReport(
        { ...form, details: "  Marca falsa. ", email: " Ana@Correo.Example " },
        target,
        false,
      ),
    ).toEqual({
      input: {
        targetType: "product",
        targetId: ID,
        reason: "counterfeit",
        details: "Marca falsa.",
        email: "ana@correo.example",
      },
    });
    expect(checkReport(form, target, true)).toEqual({
      input: {
        targetType: "product",
        targetId: ID,
        reason: "counterfeit",
        details: null,
        email: null,
      },
    });
  });
});
