import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { apps, light, palette } from "@yuntera/brand";
import { afterEach, describe, expect, it } from "vitest";
import { blockedFor, defineAppConfig, fontsPlugin, variantOf } from "./config";
import { fontFamily, fontWeights } from "./theme/tokens";

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
    expect(dev.ios?.bundleIdentifier).toBe("com.yuntera.ruta.dev");
    expect(dev.name).toBe("Yuntera Ruta (Dev)");
    expect(preview.android?.package).toBe("com.yuntera.ruta.preview");
    expect(preview.name).toBe("Yuntera Ruta (Prueba)");
    expect(new Set([dev.scheme, preview.scheme, configFor().scheme]).size).toBe(3);
  });

  it("allows plain HTTP only in the development build", () => {
    const cleartext = (variant?: string) =>
      JSON.stringify(configFor(variant).plugins).includes('"usesCleartextTraffic":true');
    expect(cleartext("development")).toBe(true);
    expect(cleartext("preview")).toBe(false);
    expect(cleartext()).toBe(false);
    const ats = (variant?: string) => configFor(variant).ios?.infoPlist?.NSAppTransportSecurity;
    expect(ats("development")).toEqual({
      NSAllowsArbitraryLoads: false,
      NSAllowsLocalNetworking: true,
    });
    expect(ats("preview")).toEqual({
      NSAllowsArbitraryLoads: false,
      NSAllowsLocalNetworking: false,
    });
    expect(ats()).toEqual({ NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: false });
  });

  it("declares Spanish as the iOS app's language in every variant", () => {
    for (const variant of ["development", "preview", undefined]) {
      expect(configFor(variant).ios?.infoPlist?.CFBundleDevelopmentRegion).toBe("es");
    }
  });

  it("treats anything unknown as the store build", () => {
    expect(variantOf(undefined)).toBe("production");
    expect(variantOf("staging")).toBe("production");
  });

  it("has an identifier for every native app, the seller app included", () => {
    for (const app of ["shop", "seller", "driver", "warehouse"] as const) {
      expect(apps[app].bundleId).toMatch(/^com\.yuntera\.[a-z]+$/);
      expect(() => defineAppConfig(app, { slug: `yuntera-${app}` })).not.toThrow();
    }
    expect(apps.seller.bundleId).toBe("com.yuntera.vende");
    expect(apps.driver.bundleId).toBe("com.yuntera.ruta");
    expect(apps.warehouse.bundleId).toBe("com.yuntera.bodega");
  });

  it("gives the shopper store build the package name registered in Google Play", () => {
    delete process.env.APP_VARIANT;
    const shop = defineAppConfig("shop", { slug: "yuntera" });
    expect(shop.android?.package).toBe("com.yuntera.shop");
    expect(shop.ios?.bundleIdentifier).toBe("com.yuntera.shop");
  });

  it("removes the biometric permissions from every app and variant", () => {
    for (const app of ["shop", "seller", "driver", "warehouse"] as const) {
      for (const variant of ["development", "preview", undefined]) {
        if (variant) process.env.APP_VARIANT = variant;
        else delete process.env.APP_VARIANT;
        const blocked = defineAppConfig(app, {
          slug: `yuntera-${app}`,
          blockedPermissions: ["android.permission.CAMERA"],
        }).android?.blockedPermissions;
        expect(blocked).toEqual(
          expect.arrayContaining([
            "android.permission.USE_BIOMETRIC",
            "android.permission.USE_FINGERPRINT",
            "android.permission.CAMERA",
          ]),
        );
      }
    }
  });

  it("lets an app declare POST_NOTIFICATIONS, and nothing else that is always blocked", () => {
    const declared = blockedFor({ androidPermissions: ["android.permission.POST_NOTIFICATIONS"] });
    expect(declared).not.toContain("android.permission.POST_NOTIFICATIONS");
    expect(declared).toContain("android.permission.USE_BIOMETRIC");
    expect(blockedFor({})).toContain("android.permission.POST_NOTIFICATIONS");
    expect(() => blockedFor({ androidPermissions: ["android.permission.RECORD_AUDIO"] })).toThrow();
    delete process.env.APP_VARIANT;
    const driver = defineAppConfig("driver", {
      slug: "yuntera-ruta",
      androidPermissions: ["android.permission.POST_NOTIFICATIONS"],
      androidBackup: false,
    });
    expect(driver.android?.permissions).toEqual(["android.permission.POST_NOTIFICATIONS"]);
    expect(driver.android?.allowBackup).toBe(false);
    const shop = defineAppConfig("shop", { slug: "yuntera" });
    expect(shop.android?.permissions).toBeUndefined();
    expect(shop.android?.allowBackup).toBeUndefined();
  });

  it("declares in every app and variant that it uses no non-exempt encryption", () => {
    for (const app of ["shop", "seller", "driver", "warehouse"] as const) {
      for (const variant of ["development", "preview", undefined]) {
        if (variant) process.env.APP_VARIANT = variant;
        else delete process.env.APP_VARIANT;
        const config = defineAppConfig(app, { slug: `yuntera-${app}` });
        expect(config.ios?.config?.usesNonExemptEncryption, `${app} ${variant}`).toBe(false);
      }
    }
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
  const kitDir = `${resolve(__dirname, "../")}/`;
  const systemFonts = `${resolve(__dirname, "../../../docs/brand/system/fonts/")}/`;
  const manifest = JSON.parse(readFileSync(`${systemFonts}manifest.json`, "utf8")) as {
    faces: Array<{
      family: string;
      weight: number;
      outputs: Record<string, { sha256: string; bytes: number }>;
    }>;
  };
  const phoneFaces = manifest.faces.flatMap((face) =>
    Object.entries(face.outputs)
      .filter(([path]) => path.startsWith("fonts/ttf/"))
      .map(([path, record]) => ({
        family: face.family,
        weight: face.weight,
        file: path.slice("fonts/ttf/".length),
        record,
      })),
  );
  const [name, options] = fontsPlugin() as [
    string,
    {
      android: {
        fonts: Array<{
          fontFamily: string;
          fontDefinitions: Array<{ path: string; weight: number; style: string }>;
        }>;
      };
      ios: { fonts: string[] };
    },
  ];
  const prefix = "./node_modules/@yuntera/expo-kit/fonts/";

  it("registers exactly the families, weights and files of the specification's manifest", () => {
    expect(name).toBe("expo-font");
    expect(phoneFaces).toHaveLength(7);
    const android = options.android.fonts.flatMap((family) =>
      family.fontDefinitions.map((d) => ({
        family: family.fontFamily,
        weight: d.weight,
        path: d.path,
        style: d.style,
      })),
    );
    const expected = phoneFaces.map((face) => ({
      family: face.family,
      weight: face.weight,
      path: `${prefix}${face.file}`,
      style: "normal",
    }));
    const order = (a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path);
    expect([...android].sort(order)).toEqual([...expected].sort(order));
    expect([...options.ios.fonts].sort()).toEqual(expected.map((face) => face.path).sort());
    expect(options.android.fonts.map((f) => f.fontFamily)).toEqual(["Fira Sans", "Epilogue"]);
  });

  it("embeds a face for every weight today's text styles use, under today's names too", () => {
    const weightsOf = (family: string) =>
      options.android.fonts
        .find((f) => f.fontFamily === family)
        ?.fontDefinitions.map((d) => d.weight);
    expect(weightsOf(fontFamily.body)).toEqual([...fontWeights.body]);
    expect(weightsOf(fontFamily.display)).toEqual([...fontWeights.display]);
  });

  it("ships each file byte for byte as the manifest records it, and no other font", () => {
    const fontsDir = `${kitDir}fonts/`;
    const onDisk = readdirSync(fontsDir).filter((file) => /\.(ttf|otf|woff2?)$/.test(file));
    expect(onDisk.sort()).toEqual(phoneFaces.map((face) => face.file).sort());
    for (const face of phoneFaces) {
      const bytes = readFileSync(`${fontsDir}${face.file}`);
      expect(bytes.length, face.file).toBe(face.record.bytes);
      expect(createHash("sha256").update(bytes).digest("hex"), face.file).toBe(face.record.sha256);
    }
    for (const file of ["OFL-FiraSans.txt", "OFL-epilogue.txt", "MODIFICATIONS.txt"]) {
      expect(readFileSync(`${fontsDir}${file}`, "utf8"), file).toBe(
        readFileSync(`${systemFonts}${file}`, "utf8"),
      );
    }
  });

  it("loads the same files under the same names in the web export", () => {
    const web = readFileSync(`${kitDir}src/ui/fonts.web.ts`, "utf8");
    const required = [...web.matchAll(/require\("\.\.\/\.\.\/fonts\/([^"]+)"\)/g)].map((m) => m[1]);
    expect(required.sort()).toEqual(phoneFaces.map((face) => face.file).sort());
  });
});

describe("icons and splash (SISTEMA.md §15)", () => {
  const apps4 = ["shop", "seller", "driver", "warehouse"] as const;

  it("gives each adaptive icon its app colour and each splash the page colour", () => {
    delete process.env.APP_VARIANT;
    const background = Object.fromEntries(
      apps4.map((app) => [
        app,
        defineAppConfig(app, { slug: `yuntera-${app}` }).android?.adaptiveIcon?.backgroundColor,
      ]),
    );
    expect(background).toEqual({
      shop: light.appShop,
      seller: light.appSeller,
      driver: light.appDriver,
      warehouse: palette.arena,
    });
    for (const app of apps4) {
      const config = defineAppConfig(app, { slug: `yuntera-${app}` });
      const splash = (config.plugins ?? []).find(
        (p): p is [string, Record<string, unknown>] =>
          Array.isArray(p) && p[0] === "expo-splash-screen",
      )?.[1] as { backgroundColor: string; image: string; dark?: unknown };
      expect(splash.backgroundColor, app).toBe(light.page);
      expect(splash.image, app).toBe("./assets/splash-icon.png");
      // No dark splash while the apps stay light (see APP_LOOK in config.ts).
      expect(splash.dark, app).toBeUndefined();
      expect(config.icon).toBe("./assets/icon.png");
      expect(config.web?.favicon).toBe("./assets/favicon.png");
    }
  });

  it("uses the files of packages/brand/assets, byte for byte, in every phone app", () => {
    const appsDir = `${resolve(__dirname, "../../../apps/")}/`;
    const brandIcons = `${resolve(__dirname, "../../brand/assets/app-icons/")}/`;
    const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
    for (const app of apps4) {
      const assets = `${appsDir}${app}-native/assets/`;
      const map: Record<string, string> = {
        "icon.png": `icon-${app}-1024.png`,
        "favicon.png": `icon-${app}-48.png`,
        "android-icon-foreground.png": `icon-${app}-adaptive-foreground-432.png`,
        "android-icon-monochrome.png": `icon-${app}-monochrome-432.png`,
        "splash-icon.png": `icon-${app}-splash-1024.png`,
      };
      expect(readdirSync(assets).sort(), app).toEqual(Object.keys(map).sort());
      for (const [file, source] of Object.entries(map)) {
        expect(sha(`${assets}${file}`), `${app} ${file}`).toBe(sha(`${brandIcons}${source}`));
      }
    }
  });
});
