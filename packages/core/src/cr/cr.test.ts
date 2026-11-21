import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  decodePlusCode,
  encodePlusCode,
  haversineKm,
  isInCostaRica,
  isValidPlusCode,
  parsePostalCode,
  roadDistanceKm,
  validateDeliveryAddress,
} from "./geo";
import {
  canReceiveSinpeMovil,
  HACIENDA_ID_CODE,
  type IdentificationType,
  isValidIdentification,
  parseIdentification,
  parsePhone,
} from "./identity";

describe("identification", () => {
  it("parses a cédula física in any common format", () => {
    for (const input of ["1-0234-0567", "102340567", "1 0234 0567"]) {
      expect(parseIdentification(input)).toEqual({
        type: "fisica",
        value: "102340567",
        formatted: "1-0234-0567",
      });
    }
  });

  it("parses a cédula jurídica", () => {
    expect(parseIdentification("3-101-123456")).toEqual({
      type: "juridica",
      value: "3101123456",
      formatted: "3-101-123456",
    });
  });

  it("parses DIMEX and NITE", () => {
    expect(parseIdentification("155812345678")?.type).toBe("dimex");
    expect(parseIdentification("12345678901")?.type).toBe("dimex");
    expect(parseIdentification("1234567890")?.type).toBe("nite");
  });

  it("rejects malformed identifiers", () => {
    expect(parseIdentification("012340567")).toBeNull(); // física cannot start with 0
    expect(parseIdentification("12345")).toBeNull();
    expect(parseIdentification("1-0234-05A7")).toBeNull();
    expect(parseIdentification("")).toBeNull();
    expect(parseIdentification("9101123456", "juridica")).toBeNull();
    expect(isValidIdentification("102340567", "juridica")).toBe(false);
  });

  it("maps to Hacienda's type codes", () => {
    expect(HACIENDA_ID_CODE).toEqual({ fisica: "01", juridica: "02", dimex: "03", nite: "04" });
  });
});

describe("phone", () => {
  it("normalises to E.164", () => {
    const expected = {
      e164: "+50688881234",
      national: "88881234",
      formatted: "8888-1234",
      kind: "mobile",
    };
    for (const input of [
      "8888-1234",
      "88881234",
      "+506 8888 1234",
      "506 8888-1234",
      "0050688881234",
    ]) {
      expect(parsePhone(input)).toEqual(expected);
    }
  });

  it("classifies line types", () => {
    expect(parsePhone("2222-3333")?.kind).toBe("landline");
    expect(parsePhone("4000-1234")?.kind).toBe("voip");
    expect(parsePhone("6000-1234")?.kind).toBe("mobile");
  });

  it("rejects invalid numbers", () => {
    expect(parsePhone("1234-5678")).toBeNull();
    expect(parsePhone("8888-123")).toBeNull();
    expect(parsePhone("+1 415 555 0100")).toBeNull();
    expect(parsePhone("ochenta")).toBeNull();
  });

  it("allows SINPE Móvil only on mobile lines", () => {
    expect(canReceiveSinpeMovil("8888-1234")).toBe(true);
    expect(canReceiveSinpeMovil("2222-3333")).toBe(false);
    expect(canReceiveSinpeMovil("nope")).toBe(false);
  });
});

describe("postal codes", () => {
  it("decodes the administrative hierarchy", () => {
    expect(parsePostalCode("10101")).toEqual({
      code: "10101",
      province: 1,
      canton: 1,
      district: 1,
      cantonCode: "101",
    });
    expect(parsePostalCode("40203")?.cantonCode).toBe("402");
  });

  it("rejects impossible codes", () => {
    for (const bad of ["80101", "00101", "1010", "101011", "10001", "10100", "abcde"]) {
      expect(parsePostalCode(bad)).toBeNull();
    }
  });
});

describe("distance", () => {
  const sanJose = { lat: 9.9333, lng: -84.0833 };
  const cartago = { lat: 9.8644, lng: -83.9194 };

  it("measures San José–Cartago at about 19.5 km in a straight line", () => {
    expect(haversineKm(sanJose, cartago)).toBeGreaterThan(18.5);
    expect(haversineKm(sanJose, cartago)).toBeLessThan(20.5);
  });

  it("is symmetric and zero for the same point", () => {
    expect(haversineKm(sanJose, cartago)).toBeCloseTo(haversineKm(cartago, sanJose), 10);
    expect(haversineKm(sanJose, sanJose)).toBe(0);
  });

  it("applies circuity for road distance", () => {
    expect(roadDistanceKm(sanJose, cartago, 1.5)).toBeCloseTo(
      haversineKm(sanJose, cartago) * 1.5,
      10,
    );
  });

  it("knows what is inside the country", () => {
    expect(isInCostaRica(sanJose)).toBe(true);
    expect(isInCostaRica({ lat: 25.76, lng: -80.19 })).toBe(false);
  });
});

describe("Plus Codes", () => {
  // Reference vectors from the Open Location Code specification's test data.
  it.each([
    [20.3700625, 2.7821875, 10, "7FG49QCJ+2V"],
    [20.3701125, 2.782234375, 11, "7FG49QCJ+2VX"],
    [47.0000625, 8.0000625, 10, "8FVC2222+22"],
    [-41.2730625, 174.7859375, 10, "4VCPPQGP+Q9"],
  ] as const)("encodes (%f, %f) at length %i as %s", (lat, lng, length, expected) => {
    expect(encodePlusCode({ lat, lng }, length)).toBe(expected);
  });

  it("round-trips Costa Rican locations to within a cell", () => {
    const points = [
      { lat: 9.9333, lng: -84.0833 },
      { lat: 10.0162, lng: -84.2116 },
      { lat: 9.8644, lng: -83.9194 },
      { lat: 10.6346, lng: -85.4407 },
      { lat: 9.9907, lng: -83.036 },
    ];
    for (const p of points) {
      const code = encodePlusCode(p);
      expect(isValidPlusCode(code)).toBe(true);
      const back = decodePlusCode(code);
      expect(back).not.toBeNull();
      if (back) expect(haversineKm(p, back) * 1000).toBeLessThan(15);
    }
  });

  it("rejects malformed codes", () => {
    expect(isValidPlusCode("ABCDEFGH+IJ")).toBe(false);
    expect(decodePlusCode("762P+WW")).toBeNull();
    expect(() => encodePlusCode({ lat: Number.NaN, lng: 0 })).toThrow(RangeError);
  });
});

describe("delivery address", () => {
  const good = {
    recipientName: "María Fernández",
    phone: "8888-1234",
    postalCode: "11801",
    senas: "De la antigua pulpería La Luz, 200 metros sur y 50 este, casa verde portón negro",
    pin: { lat: 9.9156, lng: -84.0384 },
  };

  it("accepts a complete address", () => {
    expect(validateDeliveryAddress(good)).toEqual([]);
  });

  it("requires a pin, because señas alone cannot be routed", () => {
    expect(validateDeliveryAddress({ ...good, pin: null })).toEqual(["pin_required"]);
  });

  it("reports every problem at once", () => {
    expect(
      validateDeliveryAddress({
        recipientName: "M",
        phone: "",
        postalCode: "99999",
        senas: "casa",
        pin: { lat: 40.4, lng: -3.7 },
      }),
    ).toEqual([
      "recipient_required",
      "postal_code_invalid",
      "senas_too_short",
      "pin_outside_country",
    ]);
  });
});

describe("identification numbers agree with the database", () => {
  // supabase/tests/120_limits.sql runs these very lines through
  // private.is_valid_identification; here they go through parseIdentification.
  const suite = readFileSync(
    fileURLToPath(new URL("../../../../supabase/tests/120_limits.sql", import.meta.url)),
    "utf8",
  );
  const block = /-- BEGIN identification_cases([\s\S]*?)-- END identification_cases/.exec(suite);
  const cases = [
    ...(block?.[1] ?? "").matchAll(/check_id\('([a-z]+)', '(\d+)', (true|false)\)/g),
  ].map((match) => ({
    type: match[1] as IdentificationType,
    value: match[2] ?? "",
    valid: match[3] === "true",
  }));

  it("finds the shared cases, for every type", () => {
    expect(cases.length).toBeGreaterThanOrEqual(12);
    expect(new Set(cases.map((c) => c.type))).toEqual(
      new Set(["fisica", "juridica", "dimex", "nite"]),
    );
  });

  it("accepts and refuses the same numbers", () => {
    for (const c of cases) {
      expect(parseIdentification(c.value, c.type) !== null, `${c.type} ${c.value}`).toBe(c.valid);
    }
  });
});
