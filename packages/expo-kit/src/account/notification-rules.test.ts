import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COMMERCIAL_CONSENT_VERSION } from "@yuntera/db";
import { describe, expect, it } from "vitest";
import { checkChoices, PHONE_INVALID, phoneToOffer, SAVED } from "./notification-rules";

const source = (path: string) => readFileSync(join(__dirname, path), "utf8").replace(/\s+/g, " ");

const form = {
  email: true,
  whatsapp: false,
  sms: false,
  push: false,
  commercial: false,
  phone: "",
};
const shopper = { audience: "shopper" as const, emailLocked: false, version: 3 };
const shop = { audience: "shop" as const, emailLocked: true, version: 0 };

describe("channel choices", () => {
  it("send a mobile number in international form", () => {
    expect(checkChoices({ ...form, whatsapp: true, phone: "8888 1234" }, shopper)).toEqual({
      input: {
        email: true,
        whatsapp: true,
        sms: false,
        push: false,
        phone: "+50688881234",
        commercial: false,
        textVersion: COMMERCIAL_CONSENT_VERSION,
        version: 3,
      },
    });
  });

  it("refuse a landline or a number that is not one", () => {
    expect(checkChoices({ ...form, phone: "2222-3333" }, shopper)).toEqual({
      error: PHONE_INVALID,
    });
    expect(checkChoices({ ...form, phone: "12" }, shop)).toEqual({ error: PHONE_INVALID });
  });

  it("need a number for WhatsApp or SMS", () => {
    expect(checkChoices({ ...form, sms: true }, shopper)).toEqual({
      error: "Para recibir avisos por WhatsApp o SMS, escriba su número de celular.",
    });
    expect(checkChoices({ ...form, whatsapp: true }, shop)).toEqual({
      error: "Para recibir avisos por WhatsApp, escriba un número de celular.",
    });
  });

  it("keep e-mail on while it is locked, and give a shop no SMS", () => {
    const checked = checkChoices({ ...form, email: false, sms: true }, shop);
    expect("input" in checked && checked.input.email).toBe(true);
    expect("input" in checked && checked.input.sms).toBe(false);
  });

  it("offer the saved number, else a mobile from the profile, never a landline", () => {
    expect(phoneToOffer("+50670001111", "+50688881234")).toBe("70001111");
    expect(phoneToOffer(null, "+50688881234")).toBe("88881234");
    expect(phoneToOffer(null, "+50622223333")).toBe("");
    expect(phoneToOffer(null, null)).toBe("");
  });

  it("use the websites' words", () => {
    const shopperActions = source("../../../../apps/web/src/app/notification-actions.ts");
    const shopActions = source("../../../../apps/seller/src/app/notification-actions.ts");
    const webForm = source("../../../next-kit/src/client/notification-settings.tsx");
    const appForm = source("./notifications.tsx");
    expect(shopperActions).toContain(PHONE_INVALID);
    expect(shopperActions).toContain(SAVED.shopper);
    expect(shopperActions).toContain(
      "Para recibir avisos por WhatsApp o SMS, escriba su número de celular.",
    );
    expect(shopActions).toContain(SAVED.shop);
    expect(shopActions).toContain(
      "Para recibir avisos por WhatsApp, escriba un número de celular.",
    );
    // Every hint and label the website's form shows is in the app's form too.
    const strings = [...webForm.matchAll(/"([A-ZÁÉÍÓÚ¿][^"]{20,})"/g)].map((match) => match[1]);
    expect(strings.length).toBeGreaterThan(8);
    for (const text of strings) expect(appForm, text).toContain(text as string);
  });
});
