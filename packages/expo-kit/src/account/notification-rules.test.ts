import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ApiError, COMMERCIAL_CONSENT_VERSION, messageFor } from "@yuntera/db";
import { describe, expect, it, vi } from "vitest";
import {
  CHANGED_ELSEWHERE,
  CHANGED_ELSEWHERE_RELOAD_FAILED,
  type ChoicesInput,
  checkChoices,
  PHONE_INVALID,
  phoneToOffer,
  SAVED,
  saveChoices,
} from "./notification-rules";

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

describe("saving the choices", () => {
  const input: ChoicesInput = {
    email: true,
    whatsapp: false,
    sms: false,
    push: true,
    phone: null,
    commercial: false,
    textVersion: COMMERCIAL_CONSENT_VERSION,
    version: 3,
  };
  const stored = { version: 5, push_enabled: false };

  it("answers what was saved", async () => {
    const reload = vi.fn();
    const outcome = await saveChoices("shopper", input, async () => ({ version: 4 }), reload);
    expect(outcome).toEqual({ kind: "saved", settings: { version: 4 }, message: SAVED.shopper });
    expect(reload).not.toHaveBeenCalled();
  });

  it("after a change elsewhere, loads what is stored now and says so in app terms", async () => {
    const outcome = await saveChoices(
      "shop",
      input,
      async () => {
        throw new ApiError("notify_settings_changed");
      },
      async () => stored,
    );
    expect(outcome).toEqual({
      kind: "refreshed",
      settings: stored,
      message: CHANGED_ELSEWHERE.shop,
    });
    // The website's text says to reload a page; an app has none.
    for (const text of [...Object.values(CHANGED_ELSEWHERE), CHANGED_ELSEWHERE_RELOAD_FAILED]) {
      expect(text).not.toMatch(/recargue|página|ventana/i);
    }
    expect(messageFor("notify_settings_changed", "es-CR")).toMatch(/Recargue la página/);
  });

  it("says to reopen the screen when the current settings cannot be loaded either", async () => {
    const outcome = await saveChoices(
      "shopper",
      input,
      async () => {
        throw new ApiError("notify_settings_changed");
      },
      async () => {
        throw new ApiError("network");
      },
    );
    expect(outcome).toEqual({ kind: "error", message: CHANGED_ELSEWHERE_RELOAD_FAILED });
  });

  it("shows any other refusal as it is, without reloading", async () => {
    const reload = vi.fn();
    const outcome = await saveChoices(
      "shopper",
      input,
      async () => {
        throw new ApiError("notify_phone_opted_out");
      },
      reload,
    );
    expect(outcome).toEqual({
      kind: "error",
      message: messageFor("notify_phone_opted_out", "es-CR"),
    });
    expect(reload).not.toHaveBeenCalled();
  });

  it("is what the form uses, and both apps give it a reload that skips the cache", () => {
    expect(source("./notifications.tsx")).toContain(
      "saveChoices(audience, checked.input, save, reload)",
    );
    for (const screen of [
      "../../../../apps/shop-native/src/app/cuenta/notificaciones.tsx",
      "../../../../apps/seller-native/src/app/(app)/notificaciones.tsx",
    ]) {
      const text = source(screen);
      expect(text, screen).toMatch(/reload=\{async \(\) => \{ const now = await api\.\w+\(/);
      expect(text, screen).toContain("staleTime: 0, gcTime: 0");
      expect(text, screen).toContain("onRefresh=");
    }
  });

  it("records a consent given in the apps as given in the app, not on the website", () => {
    const shopper = source("../../../../apps/shop-native/src/app/cuenta/notificaciones.tsx");
    const seller = source("../../../../apps/seller-native/src/app/(app)/notificaciones.tsx");
    expect(shopper).toContain('api.setMyNotificationSettingsFrom("shop_app", input)');
    expect(shopper).not.toMatch(/api\.setMyNotificationSettings\(/);
    expect(seller).toContain('api.sellerSetNotificationSettingsFrom("seller_app", shop.id, input)');
    expect(seller).not.toMatch(/api\.sellerSetNotificationSettings\(/);
  });
});
