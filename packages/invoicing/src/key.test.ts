import { describe, expect, it } from "vitest";
import { clave, consecutivo, costaRicaParts, fechaEmision, parseClave } from "./key.ts";

describe("consecutive number and clave (annex nota 3; research note 3.2 and 3.3)", () => {
  it("builds the note's first worked example: tiquete 1532 of legal entity 3101123456", () => {
    const number = consecutivo(1, 1, "04", 1532);
    expect(number).toBe("00100001040000001532");
    // 21 Nov 2026 at 21:30 in Costa Rica is already 22 Nov in UTC.
    const issuedAt = new Date("2026-11-22T03:30:00Z");
    expect(
      clave({
        issuedAt,
        identification: "3101123456",
        consecutivo: number,
        situation: "1",
        security: "48291037",
      }),
    ).toBe("50621112600310112345600100001040000001532148291037");
    expect(fechaEmision(issuedAt)).toBe("2026-11-21T21:30:00-06:00");
  });

  it("builds the second example: factura 27 of individual 109870654 on 5 Jan 2027", () => {
    expect(
      clave({
        issuedAt: new Date("2027-01-05T15:00:00Z"),
        identification: "109870654",
        consecutivo: consecutivo(1, 1, "01", 27),
        situation: "1",
        security: "00000007",
      }),
    ).toBe("50605012700010987065400100001010000000027100000007");
  });

  it("pads identifications to 12 as nota 4.1 says, alphanumeric ones included", () => {
    const base = {
      issuedAt: new Date("2026-11-21T12:00:00Z"),
      situation: "1" as const,
      security: "12345678",
    };
    const number = consecutivo(1, 1, "01", 1);
    expect(clave({ ...base, identification: "109870654", consecutivo: number }).slice(9, 21)).toBe(
      "000109870654",
    );
    expect(
      clave({ ...base, identification: "155812345678", consecutivo: number }).slice(9, 21),
    ).toBe("155812345678");
    expect(clave({ ...base, identification: "3101A00001", consecutivo: number }).slice(9, 21)).toBe(
      "003101A00001",
    );
  });

  it("uses the Costa Rica date, also after 18:00 local time", () => {
    expect(costaRicaParts(new Date("2026-12-01T05:59:59Z"))).toMatchObject({ day: 30, month: 11 });
    expect(costaRicaParts(new Date("2026-12-01T06:00:00Z"))).toMatchObject({ day: 1, month: 12 });
    expect(fechaEmision(new Date("2027-01-01T05:00:00Z"))).toBe("2026-12-31T23:00:00-06:00");
  });

  it("refuses parts that cannot be in a consecutive number", () => {
    expect(() => consecutivo(0, 1, "01", 1)).toThrow();
    expect(() => consecutivo(1, 100_000, "01", 1)).toThrow();
    expect(() => consecutivo(1, 1, "1", 1)).toThrow();
    expect(() => consecutivo(1, 1, "01", 0)).toThrow();
    expect(() => consecutivo(1, 1, "01", 10_000_000_000)).toThrow();
    expect(consecutivo(999, 99_999, "03", 9_999_999_999)).toBe("99999999039999999999");
  });

  it("reads a clave back into its fields", () => {
    const parsed = parseClave("50621112600310112345600100001040000001532148291037");
    expect(parsed).toMatchObject({
      day: 21,
      month: 11,
      year: 2026,
      identification: "003101123456",
      consecutivo: "00100001040000001532",
      establishment: 1,
      terminal: 1,
      documentType: "04",
      sequence: 1532n,
      situation: "1",
      security: "48291037",
    });
  });

  it("refuses Hacienda's own API sample, which does not decompose (situation 9)", () => {
    expect(parseClave("50601011600310112345600100010100000000011999999999")).toBeNull();
  });

  it("refuses wrong lengths, countries and dates", () => {
    expect(parseClave("5062111260031011234560010000104000000153214829103")).toBeNull();
    expect(parseClave("40621112600310112345600100001040000001532148291037")).toBeNull();
    expect(parseClave("50631022600310112345600100001040000001532148291037")).toBeNull();
    expect(parseClave("50621112600310112345600100001040000001532148291a37")).toBeNull();
  });
});
