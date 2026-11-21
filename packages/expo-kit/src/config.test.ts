import { apps } from "@yuntera/brand";
import { afterEach, describe, expect, it } from "vitest";
import { defineAppConfig, fontsPlugin, variantOf } from "./config";

const original = process.env.APP_VARIANT;
afterEach(() => {
  if (original === undefined) delete process.env.APP_VARIANT;
  else process.env.APP_VARIANT = original;
});

function configFor(variant?: string) {
  if (variant) process.env.APP_VARIANT = variant;
  else delete process.env.APP_VARIANT;
  return defineAppConfig("driver", { slug: "yuntera-ruta" });
}

describe("defineAppConfig", () => {
  it("names and identifies the store build from @yuntera/brand", () => {
    const config = configFor();
    expect(config.name).toBe(apps.driver.name);
    expect(config.ios?.bundleIdentifier).toBe(apps.driver.bundleId);
    expect(config.android?.package).toBe(apps.driver.bundleId);
    expect(config.scheme).toBe("yuntera-ruta");
  });

  it("gives each variant its own identifier, name and scheme", () => {
    const dev = configFor("development");
    const preview = configFor("preview");
    expect(dev.ios?.bundleIdentifier).toBe("cr.yuntera.ruta.dev");
    expect(dev.name).toBe("Yuntera Ruta (Dev)");
    expect(preview.android?.package).toBe("cr.yuntera.ruta.preview");
    expect(preview.name).toBe("Yuntera Ruta (Prueba)");
    expect(new Set([dev.scheme, preview.scheme, configFor().scheme]).size).toBe(3);
  });

  it("allows plain HTTP only in the development build", () => {
    const cleartext = (variant?: string) =>
      JSON.stringify(configFor(variant).plugins).includes('"usesCleartextTraffic":true');
    expect(cleartext("development")).toBe(true);
    expect(cleartext("preview")).toBe(false);
    expect(cleartext()).toBe(false);
    expect(configFor().ios?.infoPlist).toBeUndefined();
  });

  it("treats anything unknown as the store build", () => {
    expect(variantOf(undefined)).toBe("production");
    expect(variantOf("staging")).toBe("production");
  });

  it("has an identifier for every native app, the seller app included", () => {
    for (const app of ["shop", "seller", "driver", "warehouse"] as const) {
      expect(apps[app].bundleId).toMatch(/^cr\.yuntera\.[a-z]+$/);
      expect(() => defineAppConfig(app, { slug: `yuntera-${app}` })).not.toThrow();
    }
    expect(apps.seller.bundleId).toBe("cr.yuntera.vende");
  });

  it("carries no secret and no placeholder permission text", () => {
    const text = JSON.stringify(configFor());
    expect(text).not.toMatch(/secret|service_role|sb_secret/i);
    expect(text).not.toContain("$(PRODUCT_NAME)");
    expect(text).toContain('"faceIDPermission":false');
  });

  it("adds the EAS project only when it exists", () => {
    expect(configFor().updates).toBeUndefined();
    const config = defineAppConfig("shop", { slug: "yuntera", easProjectId: "abc" });
    expect(config.updates?.url).toBe("https://u.expo.dev/abc");
    expect((config.extra as { eas: { projectId: string } }).eas.projectId).toBe("abc");
  });
});

describe("fontsPlugin", () => {
  it("embeds a face for every weight the text styles use", () => {
    const [name, options] = fontsPlugin() as [string, { android: { fonts: unknown[] } }];
    expect(name).toBe("expo-font");
    const families = options.android.fonts as Array<{
      fontFamily: string;
      fontDefinitions: Array<{ weight: number }>;
    }>;
    expect(families.map((f) => f.fontFamily)).toEqual(["Inter", "Bricolage Grotesque"]);
    expect(families[0]?.fontDefinitions.map((d) => d.weight)).toEqual([400, 500, 600, 700]);
    expect(families[1]?.fontDefinitions.map((d) => d.weight)).toEqual([600, 700, 800]);
  });
});
