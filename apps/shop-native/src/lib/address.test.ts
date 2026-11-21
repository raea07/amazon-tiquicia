import { describe, expect, it } from "vitest";
import { validateAddress, validateProfile } from "./address";

const good = {
  recipientName: "Ana Mora Solís",
  phone: "8888-1234",
  postalCode: "10101",
  senas: "De la iglesia 200 metros al sur, casa esquinera con portón negro",
  pin: { lat: 9.9325, lng: -84.0795, plusCode: "77FWWW6C+X5" },
};

describe("validateAddress", () => {
  it("turns a complete address into the API's input, with the phone in E.164", () => {
    const result = validateAddress(good);
    expect(result.error).toBeUndefined();
    expect(result.input?.phone).toBe("+50688881234");
    expect(result.input?.makeDefault).toBe(true);
  });

  it("says what is missing, one thing at a time, in the website's words", () => {
    expect(validateAddress({ ...good, recipientName: "Al" }).error).toMatch(/nombre completo/);
    expect(validateAddress({ ...good, phone: "123" }).error).toMatch(/8 dígitos/);
    expect(validateAddress({ ...good, postalCode: "" }).error).toMatch(/provincia/);
    expect(validateAddress({ ...good, senas: "Casa azul" }).error).toMatch(/más detalle/);
    expect(validateAddress({ ...good, pin: null }).error).toMatch(/Marque la ubicación/);
    expect(validateAddress({ ...good, pin: { lat: 40, lng: -3, plusCode: "" } }).error).toMatch(
      /Marque la ubicación/,
    );
  });
});

describe("validateProfile", () => {
  it("accepts an empty phone and checks a written one", () => {
    expect(validateProfile({ fullName: "Ana Mora", phone: "" })).toEqual({
      fullName: "Ana Mora",
      phone: null,
    });
    expect(validateProfile({ fullName: "Ana Mora", phone: "abc" })).toEqual({
      error: "Escriba un teléfono costarricense de 8 dígitos.",
    });
    expect(validateProfile({ fullName: "A", phone: "" })).toEqual({
      error: "Escriba su nombre completo.",
    });
  });
});
