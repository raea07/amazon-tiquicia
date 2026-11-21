// What the phone will ask the seller for, read from the configuration Expo
// really resolves (`expo config --type introspect`, offline), after every
// plugin, including the ones Expo applies on its own. The screens built so far
// use no camera, photo library, microphone or location, so none may be asked
// for, in any variant. packages/expo-kit/src/resolved-config.test.ts checks
// what all four apps share (Spanish texts, no push, plain HTTP only in
// development).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

const app = resolve(__dirname, "../..");
const expo = join(app, "node_modules/.bin/expo");

interface Resolved {
  ios: { infoPlist: Record<string, unknown> };
  _internal?: {
    modResults?: {
      android?: {
        manifest?: {
          manifest?: {
            "uses-permission"?: Array<{ $: { "android:name": string; "tools:node"?: string } }>;
          };
        };
      };
    };
  };
}

function introspect(variant: string | undefined): Resolved {
  const env: NodeJS.ProcessEnv = { ...process.env, EXPO_OFFLINE: "1", CI: "1" };
  if (variant) env.APP_VARIANT = variant;
  else delete env.APP_VARIANT;
  const out = execFileSync(expo, ["config", "--type", "introspect", "--json"], {
    cwd: app,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return JSON.parse(out) as Resolved;
}

const UNUSED_IOS = [
  "NSCameraUsageDescription",
  "NSPhotoLibraryUsageDescription",
  "NSPhotoLibraryAddUsageDescription",
  "NSMicrophoneUsageDescription",
  "NSLocationWhenInUseUsageDescription",
  "NSLocationAlwaysAndWhenInUseUsageDescription",
  "NSMotionUsageDescription",
];

describe("Yuntera Vende asks for nothing its screens do not use", { skip: !existsSync(expo) }, () => {
  for (const variant of [undefined, "preview", "development"]) {
    it(`${variant ?? "store build"}: no camera, photos, microphone or location`, () => {
      const resolved = introspect(variant);
      for (const key of UNUSED_IOS) {
        assert.equal(resolved.ios.infoPlist[key], undefined, `iOS ${key}`);
      }
      const requested = (
        resolved._internal?.modResults?.android?.manifest?.manifest?.["uses-permission"] ?? []
      )
        .filter((entry) => entry.$["tools:node"] !== "remove")
        .map((entry) => entry.$["android:name"]);
      assert.deepEqual(requested.sort(), [
        "android.permission.INTERNET",
        "android.permission.VIBRATE",
      ]);
    });
  }
});
