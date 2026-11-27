import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The configuration each app really gets after every config plugin has run,
 * including the ones Expo applies on its own (expo-notifications,
 * expo-task-manager, expo-dev-client). `config.test.ts` checks what
 * defineAppConfig is given; this checks what comes out, which is what the
 * stores read. It runs `expo config --type introspect` offline in each app.
 */

const APPS = ["shop", "seller", "driver", "warehouse"] as const;
const ROOT = resolve(__dirname, "../../../apps");

/** expo-dev-client's own English text, which no variant may carry. */
const DEV_LAUNCHER_TEXT = /^Expo Dev Launcher uses the local network/;

interface Resolved {
  ios: { infoPlist: Record<string, unknown>; entitlements?: Record<string, unknown> };
  android: { blockedPermissions?: string[]; permissions?: string[]; allowBackup?: boolean };
}

const cache = new Map<string, Resolved>();

function introspect(app: string, variant?: string): Resolved {
  const key = `${app}:${variant ?? ""}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const dir = join(ROOT, `${app}-native`);
  const env: NodeJS.ProcessEnv = { ...process.env, EXPO_OFFLINE: "1", CI: "1" };
  if (variant) env.APP_VARIANT = variant;
  else delete env.APP_VARIANT;
  const out = execFileSync(
    join(dir, "node_modules/.bin/expo"),
    ["config", "--type", "introspect", "--json"],
    { cwd: dir, env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  const resolved = JSON.parse(out) as Resolved;
  cache.set(key, resolved);
  return resolved;
}

/** Every purpose string in the resolved Info.plist, by key. */
function purposeStrings(plist: Record<string, unknown>): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(plist)) {
    if (/UsageDescription$/.test(key) && typeof value === "string") found.push([key, value]);
    if (/UsageDescriptionDictionary$/.test(key) && value && typeof value === "object") {
      for (const [sub, text] of Object.entries(value)) found.push([`${key}.${sub}`, String(text)]);
    }
  }
  return found;
}

const available = APPS.every((app) =>
  existsSync(join(ROOT, `${app}-native/node_modules/.bin/expo`)),
);

describe.skipIf(!available)("resolved app configuration", () => {
  for (const app of APPS) {
    for (const variant of [undefined, "preview", "development"] as const) {
      const label = `${app} (${variant ?? "store build"})`;

      it(`${label}: purpose strings are Spanish and say why`, () => {
        const { ios } = introspect(app, variant);
        for (const [key, text] of purposeStrings(ios.infoPlist)) {
          expect(text, key).not.toMatch(DEV_LAUNCHER_TEXT);
          expect(text, key).not.toContain("$(PRODUCT_NAME)");
          expect(text, key).not.toMatch(/\b(Allow|your|uses the)\b/);
          expect(text, key).toMatch(/^(Yuntera|La versión de desarrollo)/);
        }
        // No app uses the motion sensors.
        expect(ios.infoPlist.NSMotionUsageDescription).toBeUndefined();
        // Only the development build looks for a dev server on the local network.
        if (variant === "development") {
          expect(ios.infoPlist.NSLocalNetworkUsageDescription).toMatch(/^La versión de desarrollo/);
        } else {
          expect(ios.infoPlist.NSLocalNetworkUsageDescription).toBeUndefined();
          expect(ios.infoPlist.NSBonjourServices ?? []).not.toContain("_expo._tcp");
        }
      }, 30_000);

      it(`${label}: no push entitlement, plain HTTP only in development`, () => {
        const { ios, android } = introspect(app, variant);
        expect(ios.entitlements?.["aps-environment"]).toBeUndefined();
        expect(ios.infoPlist.NSAppTransportSecurity).toEqual({
          NSAllowsArbitraryLoads: false,
          NSAllowsLocalNetworking: variant === "development",
        });
        // Only the drivers' app may post notifications (its location
        // service's notice on Android 13+); for the others it stays blocked.
        if (app === "driver") {
          expect(android.blockedPermissions).not.toContain("android.permission.POST_NOTIFICATIONS");
          expect(android.permissions).toContain("android.permission.POST_NOTIFICATIONS");
        } else {
          expect(android.blockedPermissions).toContain("android.permission.POST_NOTIFICATIONS");
          expect(android.permissions ?? []).not.toContain("android.permission.POST_NOTIFICATIONS");
        }
        expect(ios.infoPlist.RCTAsyncStorageExcludeFromBackup).toBe(true);
        expect(android.blockedPermissions).toEqual(
          expect.arrayContaining([
            "android.permission.RECEIVE_BOOT_COMPLETED",
            // added by androidx.biometric (through expo-secure-store), never used
            "android.permission.USE_BIOMETRIC",
            "android.permission.USE_FINGERPRINT",
            // added by expo-haptics (driver, warehouse); no screen vibrates yet
            "android.permission.VIBRATE",
          ]),
        );
        expect(android.permissions ?? []).not.toContain("android.permission.VIBRATE");
      }, 30_000);
    }
  }

  // What App Store Connect reads to skip the export-compliance question
  // (config.ts explains why "no" is the true answer).
  for (const app of APPS) {
    for (const variant of [undefined, "preview", "development"] as const) {
      it(`${app} (${variant ?? "store build"}): declares no non-exempt encryption`, () => {
        const { ios } = introspect(app, variant);
        expect(ios.infoPlist.ITSAppUsesNonExemptEncryption).toBe(false);
      }, 30_000);
    }
  }

  it("drivers' app runs in the background for location only", () => {
    const { ios } = introspect("driver");
    expect(ios.infoPlist.UIBackgroundModes).toEqual(["location"]);
  }, 30_000);

  it("drivers' app keeps its data out of Android's cloud backup", () => {
    for (const variant of [undefined, "preview", "development"] as const) {
      expect(introspect("driver", variant).android.allowBackup).toBe(false);
    }
  }, 30_000);

  it("the three staff apps belong to the company's Expo account, with no project yet", () => {
    for (const app of ["seller", "driver", "warehouse"] as const) {
      const resolved = introspect(app) as Resolved & { owner?: string; extra?: { eas?: unknown } };
      expect(resolved.owner).toBe("raulea07s-team");
      expect(resolved.extra?.eas).toBeUndefined();
    }
  }, 30_000);

  it("the shop declares no background mode and no shared-storage access", () => {
    const { ios, android } = introspect("shop");
    expect(ios.infoPlist.UIBackgroundModes).toBeUndefined();
    expect(android.blockedPermissions).toEqual(
      expect.arrayContaining([
        "android.permission.ACCESS_BACKGROUND_LOCATION",
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.WRITE_EXTERNAL_STORAGE",
      ]),
    );
  }, 30_000);
});
