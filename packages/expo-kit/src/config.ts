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
 *   development  cr.yuntera.ruta.dev      "Yuntera Ruta (Dev)"     dev client, plain HTTP to a LAN API allowed
 *   preview      cr.yuntera.ruta.preview  "Yuntera Ruta (Prueba)"  installable test build
 *   (unset)      cr.yuntera.ruta          "Yuntera Ruta"           the store build
 *
 * Each variant has its own identifier so the three install side by side.
 */

import { type AppId, apps, color, semantic } from "@yuntera/brand";
import type { ExpoConfig } from "expo/config";
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

/** Permissions no Yuntera app uses, removed even when a library adds them. */
const ALWAYS_BLOCKED = [
  "android.permission.RECORD_AUDIO",
  "android.permission.SYSTEM_ALERT_WINDOW",
];

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

  return {
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
      // The development build reaches the local API by the computer's LAN
      // address over plain HTTP. Whether this key covers a bare IP address on
      // current iOS was not verified (no iPhone here); an HTTPS tunnel avoids it.
      ...(development
        ? { infoPlist: { NSAppTransportSecurity: { NSAllowsLocalNetworking: true } } }
        : {}),
    },
    android: {
      package: identifier,
      adaptiveIcon: {
        foregroundImage: "./assets/android-icon-foreground.png",
        monochromeImage: "./assets/android-icon-monochrome.png",
        backgroundColor: color.celeste[600],
      },
      blockedPermissions: [...ALWAYS_BLOCKED, ...(options.blockedPermissions ?? [])],
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
      // The session key stays on this phone: never in a cloud backup, never Face ID.
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
}
