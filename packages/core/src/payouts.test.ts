import { describe, expect, it } from "vitest";
import { csvCell, plainAmount, transferListCsv } from "./payouts";

describe("plainAmount", () => {
  it("writes céntimos as a decimal with two places and no separators", () => {
    expect(plainAmount(8_635_977)).toBe("86359.77");
    expect(plainAmount(500_000)).toBe("5000.00");
    expect(plainAmount(5)).toBe("0.05");
    expect(plainAmount(0)).toBe("0.00");
    expect(plainAmount(-150)).toBe("-1.50");
  });

  it("refuses anything that is not a whole number of céntimos", () => {
    expect(() => plainAmount(10.5)).toThrow(RangeError);
    expect(() => plainAmount(Number.NaN)).toThrow(RangeError);
  });
});

describe("csvCell", () => {
  it("quotes every cell and doubles the quotes inside", () => {
    expect(csvCell("TecnoCasa de Costa Rica S.A.")).toBe('"TecnoCasa de Costa Rica S.A."');
    expect(csvCell('Ferretería "El Higuerón", Heredia')).toBe(
      '"Ferretería ""El Higuerón"", Heredia"',
    );
    expect(csvCell("")).toBe('""');
  });

  it("stops a spreadsheet from running a name as a formula", () => {
    expect(csvCell('=HYPERLINK("http://x.example","Banco")')).toBe(
      '"\'=HYPERLINK(""http://x.example"",""Banco"")"',
    );
    for (const start of ["+", "-", "@", "\t", "\r"]) {
      expect(csvCell(`${start}cmd`)).toBe(`"'${start}cmd"`);
    }
    // A hyphen inside a name is just a hyphen.
    expect(csvCell("Jiménez-Arce")).toBe('"Jiménez-Arce"');
  });
});

describe("transferListCsv", () => {
  it("writes a header and one row per transfer", () => {
    const csv = transferListCsv([
      {
        iban: "CR05015202001026284066",
        holderName: "Cafetal Los Santos S.R.L.",
        idNumber: "3102700101",
        amountMinor: 4_811_562,
        reference: "YUNTERA PV-20261121-001",
        shop: "Cafetal Los Santos",
      },
      {
        iban: "CR23015108410026012345",
        holderName: "Roberto Jiménez Arce",
        idNumber: "401230456",
        amountMinor: 500_000,
        reference: "YUNTERA PV-20261121-002",
        shop: "TecnoCasa",
      },
    ]);
    expect(csv.split("\r\n")).toEqual([
      '"Cuenta IBAN","Titular","Identificación","Monto (CRC)","Detalle","Tienda"',
      '"CR05015202001026284066","Cafetal Los Santos S.R.L.","3102700101","48115.62","YUNTERA PV-20261121-001","Cafetal Los Santos"',
      '"CR23015108410026012345","Roberto Jiménez Arce","401230456","5000.00","YUNTERA PV-20261121-002","TecnoCasa"',
      "",
    ]);
  });

  it("writes only the header when there is nothing to transfer", () => {
    expect(transferListCsv([]).trim().split("\r\n")).toHaveLength(1);
  });
});
