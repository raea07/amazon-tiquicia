/**
 * What every native app's `app.config.ts` shares.
 *
 * Runs in Node when Expo reads an app's configuration (`expo config`,
 * `expo export`, EAS builds), so it must not import React Native. Names and
 * identifiers come from @yuntera/brand; colours from the brand tokens.
 *
 * Nothing secret belongs here: the whole resolved configuration is readable
 * inside the app at run time.
 *
 * Variants (docs/research/expo-native-apps.md §2). `APP_VARIANT` is set by the
 * build profile in each app's eas.json:
 *
 *   development  com.yuntera.ruta.dev      "Yuntera Ruta (Dev)"     dev client, plain HTTP to a LAN API allowed
 *   preview      com.yuntera.ruta.preview  "Yuntera Ruta (Prueba)"  installable test build
 *   (unset)      com.yuntera.ruta          "Yuntera Ruta"           the store build
 *
 * Each variant has its own identifier so the three install side by side.
 */

import { type AppId, apps, color, semantic } from "@yuntera/brand";
import type { ExpoConfig } from "expo/config";
import { type ConfigPlugin, withEntitlementsPlist, withInfoPlist } from "expo/config-plugins";
import { fontFamily } from "./theme/tokens";

export type Variant = "development" | "preview" | "production";

export function variantOf(value: string | undefined): Variant {
  return value === "development" || value === "preview" ? value : "production";
}

const SUFFIX: Record<Variant, { id: string; name: string }> = {
  development: { id: ".dev", name: " (Dev)" },
  preview: { id: ".preview", name: " (Prueba)" },
  production: { id: "", name: "" },
};

type PluginEntry = string | [string, Record<string, unknown>];

export interface AppConfigOptions {
  /** URL-safe project name in Expo, e.g. "yuntera-ruta". Also the link scheme. */
  slug: string;
  /** Config plugins this app adds (camera, location…), with their Spanish permission texts. */
  plugins?: PluginEntry[];
  /** Android permissions to remove even if a library asks for them. */
  blockedPermissions?: string[];
  /**
   * Android permissions this app declares itself. Only one may also be taken
   * off the kit's always-blocked list: POST_NOTIFICATIONS, which the drivers'
   * app needs on Android 13 and later so the notice of its location
   * foreground service is shown. Anything else on that list stays blocked.
   */
  androidPermissions?: string[];
  /**
   * False removes the app's data from Android's cloud backup
   * (`android:allowBackup`). The drivers' app sets it: it keeps customers'
   * details for the day in ordinary app storage. Default: Expo's (true); the
   * secure store is excluded from backups in every app regardless.
   */
  androidBackup?: boolean;
  /**
   * iOS background modes to remove although a plugin Expo applies on its own
   * adds them (expo-task-manager always adds "fetch").
   */
  removeBackgroundModes?: string[];
  /** The EAS project id, once `eas init` has created the project. Not secret. */
  easProjectId?: string;
  /** The Expo account that owns the project, once it exists. */
  owner?: string;
  version?: string;
}

const FONT_FILES = {
  body: {
    400: "@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf",
    500: "@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf",
    600: "@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf",
    700: "@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf",
  },
  display: {
    600: "@expo-google-fonts/bricolage-grotesque/600SemiBold/BricolageGrotesque_600SemiBold.ttf",
    700: "@expo-google-fonts/bricolage-grotesque/700Bold/BricolageGrotesque_700Bold.ttf",
    800: "@expo-google-fonts/bricolage-grotesque/800ExtraBold/BricolageGrotesque_800ExtraBold.ttf",
  },
} as const;

/**
 * Embeds Inter and Bricolage Grotesque in the binary. Android gets one family
 * per typeface with a face per weight, so `fontFamily: "Inter"` plus
 * `fontWeight: "600"` works; iOS reads the family name from the files, which
 * is the same "Inter" and "Bricolage Grotesque" (checked in the TTFs).
 */
export function fontsPlugin(): PluginEntry {
  const path = (file: string) => `./node_modules/${file}`;
  const family = (name: string, files: Record<number, string>) => ({
    fontFamily: name,
    fontDefinitions: Object.entries(files).map(([weight, file]) => ({
      path: path(file),
      weight: Number(weight),
      style: "normal",
    })),
  });
  return [
    "expo-font",
    {
      android: {
        fonts: [
          family(fontFamily.body, FONT_FILES.body),
          family(fontFamily.display, FONT_FILES.display),
        ],
      },
      ios: {
        fonts: [...Object.values(FONT_FILES.body), ...Object.values(FONT_FILES.display)].map(path),
      },
    },
  ];
}

/**
 * Permissions no Yuntera app uses, removed even when a library adds them.
 *
 * expo-notifications is installed in every app so the lockfile is final, and
 * Expo applies its plugin and merges its Android manifest whether or not it is
 * listed. Push is not built yet, so its permissions are removed here and its
 * iOS entitlement by `withoutUnbuiltCapabilities`. The push workstream deletes
 * both lines.
 *
 * expo-secure-store depends on androidx.biometric, whose Android manifest asks
 * for USE_BIOMETRIC and USE_FINGERPRINT; the manifest merger adds them to
 * every app (the first Android build of the shopper app requested them). No
 * app unlocks anything with a fingerprint or face (the session is stored
 * without `requireAuthentication`), so both are removed and the stores do not
 * list a biometric permission. An app that adds a biometric feature deletes
 * them here.
 *
 * POST_NOTIFICATIONS is the one exception an app may lift, by declaring it in
 * `androidPermissions`: the drivers' app, whose location foreground service
 * must show its notice on Android 13 and later. It asks for it, after its
 * own explanation, only when the driver starts sharing the position.
 */
const ALWAYS_BLOCKED = [
  "android.permission.RECORD_AUDIO",
  "android.permission.SYSTEM_ALERT_WINDOW",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.RECEIVE_BOOT_COMPLETED",
  "android.permission.USE_BIOMETRIC",
  "android.permission.USE_FINGERPRINT",
];

/** The only always-blocked permission an app may declare (see ALWAYS_BLOCKED). */
const MAY_BE_DECLARED = new Set(["android.permission.POST_NOTIFICATIONS"]);

/** The always-blocked list less what this app declares, and the app's own additions. */
export function blockedFor(
  options: Pick<AppConfigOptions, "blockedPermissions" | "androidPermissions">,
): string[] {
  const declared = new Set(options.androidPermissions ?? []);
  for (const permission of declared) {
    if (ALWAYS_BLOCKED.includes(permission) && !MAY_BE_DECLARED.has(permission)) {
      throw new Error(`${permission} is blocked for every app and cannot be declared.`);
    }
  }
  return [
    ...ALWAYS_BLOCKED.filter((permission) => !declared.has(permission)),
    ...(options.blockedPermissions ?? []),
  ];
}

/**
 * Removes what plugins Expo applies automatically add for features that are
 * not built: the push entitlement (expo-notifications) and any background
 * mode the app does not use. Applied to the config before Expo applies the
 * listed and automatic plugins, so its mods run after theirs (mods registered
 * first run last). resolved-config.test.ts checks the outcome.
 *
 * Outside the development build it also removes what expo-dev-client adds
 * for finding the dev server: its English local-network text and its
 * "_expo._tcp" Bonjour service. Its own build phase deletes both from release
 * builds, but only at build time, so `expo config --type introspect` (and
 * anyone reading the preview or store configuration) saw an English purpose
 * string; removing them here makes the resolved configuration say what the
 * store build ships.
 */
export function withoutUnbuiltCapabilities(
  removeBackgroundModes: string[],
  development = false,
): ConfigPlugin {
  return (config) => {
    let next = withEntitlementsPlist(config, (mod) => {
      delete mod.modResults["aps-environment"];
      return mod;
    });
    next = withInfoPlist(next, (mod) => {
      const modes = mod.modResults.UIBackgroundModes;
      if (Array.isArray(modes)) {
        const kept = modes.filter((mode) => !removeBackgroundModes.includes(mode));
        if (kept.length > 0) mod.modResults.UIBackgroundModes = kept;
        else delete mod.modResults.UIBackgroundModes;
      }
      if (!development) {
        delete mod.modResults.NSLocalNetworkUsageDescription;
        const services = mod.modResults.NSBonjourServices;
        if (Array.isArray(services)) {
          const kept = services.filter((service) => service !== "_expo._tcp");
          if (kept.length > 0) mod.modResults.NSBonjourServices = kept;
          else delete mod.modResults.NSBonjourServices;
        }
      }
      return mod;
    });
    return next;
  };
}

export function defineAppConfig(app: AppId, options: AppConfigOptions): ExpoConfig {
  const identity = apps[app];
  if (!identity.bundleId) {
    throw new Error(`apps.${app}.bundleId is not set in packages/brand/src/brand.ts.`);
  }
  const variant = variantOf(process.env.APP_VARIANT);
  const suffix = SUFFIX[variant];
  const identifier = `${identity.bundleId}${suffix.id}`;
  const development = variant === "development";
  const scheme = `${options.slug}${development ? "-dev" : variant === "preview" ? "-prueba" : ""}`;

  const config: ExpoConfig = {
    name: `${identity.name}${suffix.name}`,
    slug: options.slug,
    scheme,
    version: options.version ?? "0.1.0",
    ...(options.owner ? { owner: options.owner } : {}),
    orientation: "portrait",
    // The brand has light tokens only (no contrast-tested dark palette yet).
    userInterfaceStyle: "light",
    icon: "./assets/icon.png",
    backgroundColor: semantic.bg,
    ios: {
      bundleIdentifier: identifier,
      supportsTablet: false,
      config: {
        // Answers Apple's export-compliance question for every build (written
        // to Info.plist as ITSAppUsesNonExemptEncryption), so TestFlight does
        // not hold builds as "Missing Compliance". It is true because the apps
        // ship no encryption of their own: network traffic is HTTPS through
        // the operating system, and the session is kept in the platform's
        // secure store (Keychain, Android Keystore) through expo-secure-store
        // (supabase/session-storage.ts). Both are the operating system's
        // encryption, which is exempt. It becomes FALSE, and must be changed
        // and the question answered anew, if an app adds encryption of its
        // own: a cipher or key-derivation library in JavaScript or native
        // code, end-to-end encrypted messages, encrypted files or a VPN.
        // no-native-cipher.test.ts fails when such a library is added.
        usesNonExemptEncryption: false,
      },
      infoPlist: {
        // The apps are Spanish only. Expo's template sets "en", and the first
        // iOS build carried it with no other language, so text iOS draws
        // inside the app (permission prompt buttons, the copy and paste menu)
        // would follow English rather than Spanish. Not yet checked on a device.
        CFBundleDevelopmentRegion: "es",
        // Ordinary app storage (AsyncStorage: a shopper's cart, the drivers'
        // day kept for a dead zone) stays out of iCloud and computer backups.
        // AsyncStorage already does this when the key is missing; it is
        // written out so the choice is visible and checked.
        RCTAsyncStorageExcludeFromBackup: true,
        // Expo's prebuild template allows plain HTTP to local-network hosts in
        // every build. Only the development build may: it reaches the local API
        // by the computer's LAN address. Whether this key covers a bare IP
        // address on current iOS was not verified (no iPhone here); an HTTPS
        // tunnel avoids it. Preview and store builds use HTTPS only.
        NSAppTransportSecurity: {
          NSAllowsArbitraryLoads: false,
          NSAllowsLocalNetworking: development,
        },
        // Shown by the development build when it looks for the dev server.
        // The other variants carry no local-network text at all
        // (withoutUnbuiltCapabilities removes expo-dev-client's English one).
        ...(development
          ? {
              NSLocalNetworkUsageDescription:
                "La versión de desarrollo usa la red local para encontrar el servidor de desarrollo en su computadora.",
            }
          : {}),
      },
    },
    android: {
      package: identifier,
      adaptiveIcon: {
        foregroundImage: "./assets/android-icon-foreground.png",
        monochromeImage: "./assets/android-icon-monochrome.png",
        backgroundColor: color.celeste[600],
      },
      blockedPermissions: blockedFor(options),
      ...(options.androidPermissions ? { permissions: options.androidPermissions } : {}),
      ...(options.androidBackup === false ? { allowBackup: false } : {}),
    },
    web: {
      // One HTML page and client-side routing: what the browser journeys drive.
      output: "single",
      bundler: "metro",
      favicon: "./assets/favicon.png",
      name: identity.name,
      lang: "es-CR",
      themeColor: semantic.brand,
      backgroundColor: semantic.bg,
    },
    plugins: [
      "expo-router",
      fontsPlugin(),
      [
        "expo-splash-screen",
        {
          backgroundColor: semantic.bg,
          image: "./assets/splash-icon.png",
          imageWidth: 96,
        },
      ],
      // The session stays on this phone: never Face ID, and kept out of
      // Android backups here. On iOS it is stored THIS_DEVICE_ONLY
      // (supabase/session-storage.ts), so it is not restored on another phone.
      ["expo-secure-store", { faceIDPermission: false, configureAndroidBackup: true }],
      // Only the development build answers the dev server's links.
      ["expo-dev-client", { addGeneratedScheme: development }],
      [
        "expo-build-properties",
        {
          // A development build talks to the local API over plain HTTP on the
          // LAN; store and preview builds only ever use HTTPS.
          android: { usesCleartextTraffic: development },
        },
      ],
      ...(options.plugins ?? []),
    ],
    runtimeVersion: { policy: "appVersion" },
    ...(options.easProjectId
      ? { updates: { url: `https://u.expo.dev/${options.easProjectId}` } }
      : {}),
    experiments: { typedRoutes: false },
    extra: {
      app,
      variant,
      ...(options.easProjectId ? { eas: { projectId: options.easProjectId } } : {}),
      router: {},
    },
  };
  return withoutUnbuiltCapabilities(options.removeBackgroundModes ?? [], development)(config);
}
