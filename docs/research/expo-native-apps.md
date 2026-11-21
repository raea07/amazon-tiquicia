# Native apps with Expo — research note

Researched 21 November 2026 for the "build native apps" phase. Nothing in this
note was installed, built or run in this repository: every claim comes from a
document or package file opened that day, and anything that could not be
confirmed is marked **UNVERIFIED**. Source tags such as `[E1]` and `[N2]` refer
to the [Sources](#sources) section. Fact-checked the same day; what changed is
listed under [Corrections after fact-check](#corrections-after-fact-check) at
the end.

## Bottom line

Real iOS and Android apps for shoppers, sellers, drivers and warehouse staff can
be added to this pnpm monorepo with **Expo SDK 58 (`expo` 58.0.26, React Native
0.88.1, React 19.3.0)** without restructuring it: Expo configures Metro for
pnpm workspaces by itself, resolves our packages' `exports` to raw TypeScript,
and de-duplicates React in the bundle, so `packages/core`, `packages/db` and the
token values in `packages/brand` are reusable as they are, while `packages/ui`
and `packages/next-kit` are not (they are DOM and Next.js code). The native apps
must pin **React 19.3.0** (what SDK 58 ships with) while the web apps stay on
19.3.1; that is supported as long as no single app bundles both. A Linux CI box
can typecheck, unit-test, run `expo-doctor`, and export the JavaScript bundles
for iOS, Android and web (and drive the web export with Playwright), but it
cannot prove that a binary starts: native builds need EAS Build, and running
them needs a phone, a Mac, or Expo's paid cloud simulators. The owner has to
open three accounts before anything reaches a phone — Expo, Apple Developer
Program (US$99 a year) and Google Play Console (US$25 once); an organisation
account on either store needs a D-U-N-S number — plus a Firebase project for
Android push.
Store rules add work that is not screen design: in-app account deletion on both
stores, a web page for deletion requests on Google Play, privacy declarations,
and a location-use declaration with a video for the drivers' app.

> **Naming.** Expo's documentation now calls the hosted services "Expo Build",
> "Expo Update", "Expo Submit" and "Expo Services". The command-line tool is
> still `eas` and `eas.json`. This note says "EAS" throughout. [E13] [E40]

---

## 0. Version baseline

| Thing                | Version                                                                      | Where it comes from                                |
| -------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------- |
| `expo`               | 58.0.26 (`latest` on npm, published 2026-11-17)                              | [N1]                                               |
| `react-native`       | 0.88.1                                                                       | `bundledNativeModules.json` of `expo@58.0.26` [N2] |
| `react`, `react-dom` | **19.3.0** exactly                                                           | [N2], SDK table [E5], default template [N6]        |
| `react-native-web`   | ~0.21.4                                                                      | [N2]                                               |
| Node.js              | ≥ 22.13 (`expo` engines: `^22.13.0 \|\| ^24.3.0 \|\| ^26.0.0 \|\| >=27.0.0`) | [N1]                                               |
| Android              | minimum Android 7 (API 24), `compileSdkVersion` 37, `targetSdkVersion` 36    | [E5]                                               |
| iOS                  | minimum iOS 16.4, Xcode 26.4+ (EAS `sdk-58` image uses Xcode 27.1)           | [E5] [E16]                                         |
| TypeScript           | template uses `~6.0.3`; this repo pins 5.9.3                                 | [N6], `package.json:26`                            |

`expo/tsconfig.base` uses `"module": "preserve"`, `"customConditions":
["react-native"]` and `${configDir}` [N7]. Those need TypeScript ≥ 5.5, so 5.9.3
should work. **UNVERIFIED** until `tsc` runs against a real app in this repo.

**Rule for every package below:** install with `pnpm expo install <pkg>` from
the app directory, not `pnpm add`. It picks the version Expo tested with this
SDK [E35]. Several `latest` versions on npm are **newer than what SDK 58
expects** and must not be used:

| Package                                     | npm `latest` | SDK 58 expects [N2] |
| ------------------------------------------- | ------------ | ------------------- |
| `@react-native-async-storage/async-storage` | 3.1.1        | **2.2.0**           |
| `react-native-reanimated`                   | 4.8.0        | **4.7.1**           |
| `react-native-worklets`                     | 0.14.0       | **0.13.0**          |
| `react-native-gesture-handler`              | 3.5.0        | **~3.3.0**          |
| `react` / `react-dom`                       | 19.3.1       | **19.3.0**          |

---

## 1. Monorepo

### What Expo does by itself

| Topic                    | Fact                                                                                                                                                                                                                                                                                                                             | Source                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Workspace detection      | Expo detects pnpm workspaces from `pnpm-workspace.yaml` and configures Metro. No `metro.config.js` is needed.                                                                                                                                                                                                                    | [E1]                                                    |
| Do not hand-configure    | If a `metro.config.js` exists, it must **not** set `watchFolders`, `resolver.nodeModulesPath`, `resolver.extraNodeModules` or `resolver.disableHierarchicalLookup` (pre-SDK 52 advice, now harmful).                                                                                                                             | [E1]                                                    |
| pnpm isolated installs   | Supported from SDK 54. pnpm's default linker can stay.                                                                                                                                                                                                                                                                           | [E1]                                                    |
| Fallback                 | "If you encounter issues with isolated installations with pnpm, switch to the hoisted installation strategy": add `nodeLinker: hoisted` to `pnpm-workspace.yaml`.                                                                                                                                                                | [E1]                                                    |
| `package.json` `exports` | Metro uses `exports` maps (SDK 53+) and adds the `react-native` condition on native, `browser` on web.                                                                                                                                                                                                                           | [E4]                                                    |
| Duplicate packages       | From SDK 55, `experiments.autolinkingModuleResolution` is on by default in monorepos: Metro resolves native modules, and a built-in list of packages, to a single copy.                                                                                                                                                          | [E1] [E2]                                               |
| The built-in list        | `react`, `react-dom`, `react-native`, `react-native-web`, `react-native-webview`, `@expo/dom-webview`, `expo-asset`, `expo-constants`, `expo-file-system`, `expo-font`, `expo-keep-awake`, `expo-modules-core`, `react-native-gesture-handler`, `react-native-reanimated`, `@react-navigation/core`, `@react-navigation/native`. | `KNOWN_STICKY_DEPENDENCIES` in `@expo/cli@58.1.21` [N4] |
| Other singletons         | Add them to `expo.autolinking.include` in the app's `package.json` (SDK 55+), for example `@tanstack/react-query`.                                                                                                                                                                                                               | [E2]                                                    |

### `.npmrc` and `pnpm-workspace.yaml`

Nothing has to change. The current `.npmrc` (`auto-install-peers=true`,
`strict-peer-dependencies=false`) is compatible. `pnpm-workspace.yaml` already
globs `apps/*`, so new apps under `apps/` join automatically. Keep `nodeLinker:
hoisted` as the documented escape hatch, not the starting point: hoisting would
also change how the four Next.js apps resolve packages.

### Our packages ship raw TypeScript

`@yuntera/core`, `@yuntera/db` and `@yuntera/brand` export `./src/index.ts`
directly (`packages/core/package.json:7-9`, `packages/db/package.json:7-9`,
`packages/brand/package.json:9-13`) and use extensionless relative imports
(`packages/core/src/index.ts:1-14`). Metro transpiles every file it bundles with
Babel, including files outside the app directory, and resolves `exports` [E4],
so this should work with no build step. **UNVERIFIED** in this repo: the first
`expo export` in CI is the test.

What is and is not reusable:

| Package                            | In React Native?      | Why                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@yuntera/core`                    | Yes                   | Pure TypeScript. Uses `Intl.DateTimeFormat` (`packages/core/src/promise.ts:224`), `String.prototype.normalize("NFD")` (`search.ts:21`) and `localeCompare`. Hermes supports `Intl.DateTimeFormat` and `localeCompare` on both platforms [H1]; `normalize` is not covered by that document — **UNVERIFIED**, check on a device with a search for "café". |
| `@yuntera/db`                      | Yes                   | `createApi(transport)` needs only `{ rpc(fn, args) }` (`packages/db/src/api.ts:18-23`); a supabase-js client satisfies it. Depends on `zod` 4.6.7, plain JavaScript.                                                                                                                                                                                    |
| `@yuntera/brand` (`.`)             | Values yes, shapes no | Colours are hex strings (usable as is). `radius` is `"6px"`-style strings and `fontSize` is rem strings (`packages/brand/src/tokens.ts:123-149`): React Native needs numbers. Add a small native token module (see §5).                                                                                                                                 |
| `@yuntera/brand/logo`              | No                    | DOM `<svg>` JSX. Use PNG assets or `react-native-svg` 15.16.0.                                                                                                                                                                                                                                                                                          |
| `@yuntera/ui`, `@yuntera/next-kit` | No                    | DOM elements, Tailwind class names, Next.js server code.                                                                                                                                                                                                                                                                                                |

### React versions: can 19.3.0 and 19.3.1 coexist?

Yes, with one rule: **one app, one React**.

- React Native 0.88.1 declares `react: ^19.3.0` as a peer and bundles renderer
  version 19.3.0 [N3]. Expo SDK 58 pins `react` and `react-dom` to exactly
  19.3.0 [N2] [E5]. `npx expo install --check` and `expo-doctor` flag any other
  version [E35] [E38].
- Expo's rule: "Duplicate React Native versions in a single monorepo are not
  supported. Duplicate React versions in a single app will cause runtime
  errors." [E1] Two React versions in the _repository_ are not forbidden.
- With pnpm's isolated layout each app gets the `react` it declares. Our shared
  packages declare `react` as a peer (`^19.0.0`) and a dev dependency (19.3.1);
  when Metro bundles them for a native app it redirects `react` to the app's
  copy because `react` is on the sticky list [N4].
- The only change in React 19.3.1's release notes is under React Server
  Components ("Improve transport protocol") [R19]. That matters to the Next.js
  apps, not to React Native.

Recommendation: native apps declare `"react": "19.3.0"` and `"react-dom":
"19.3.0"`; web apps stay on 19.3.1. Do **not** add a root `pnpm.overrides` for
`react`, which would drag the web apps down.

Two consequences to plan for:

1. **Jest does not use Metro's resolver.** A Jest test in a native app that
   imports a shared package containing React components would load that
   package's own React 19.3.1 next to the app's 19.3.0. Today only
   `@yuntera/brand/logo` and `@yuntera/ui` contain components and neither is
   used natively, so this does not bite. If shared React code appears later, map
   `react` in the Jest config.
2. **Only one `react-native` version in the repo.** All four native apps must be
   on the same Expo SDK and upgrade together [E1].

Running 19.3.1 in the native apps instead (with `expo.install.exclude:
["react", "react-dom"]` [E38]) is **not recommended**: neither `ReactFabric-dev.js`
nor `ReactFabric-prod.js` in RN 0.88.1 contains the old "must have the exact
same version" check [N3], but the combination is untested by Expo.

### Other repository touch points

| File                 | Change                                                                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `turbo.json`         | Add `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to the build `env`; `dist/**` is already an output.                                                    |
| `.gitignore`         | Per app: `.expo/`, `dist/`, `expo-env.d.ts`, `/ios`, `/android`, `*.jks`, `*.p8`, `*.p12`, `*.mobileprovision` (from the default template [N6]).                                 |
| `biome.json`         | Ignore the same generated paths.                                                                                                                                                 |
| `eas.json` (per app) | EAS build images for SDK 58 ship **pnpm 11.27–11.28** [E16]; this repo is on pnpm 10.28.0 (`package.json:6`). Pin `"pnpm": "10.28.0"` (and `"node"`) in the build profile [E14]. |
| EAS commands         | Run `eas` from the app directory; each app has its own `eas.json` [E15].                                                                                                         |

---

## 2. Project structure

### Layout

```
apps/
  shop-native/        Yuntera          com.yuntera.shop
  seller-native/      Yuntera Vende    (identifier not decided; brand.ts has null)
  driver-native/      Yuntera Ruta     com.yuntera.ruta
  warehouse-native/   Yuntera Bodega   com.yuntera.bodega
packages/
  expo-kit/           everything the four apps share (see below)
```

Identifiers come from `packages/brand/src/brand.ts:77-123`; the seller app's
`bundleId` is `null` there and needs a value. Each app is a separate store
listing, a separate EAS project (`extra.eas.projectId`) and a separate Android
package in Firebase.

Inside each app (matches the SDK 58 default template [N6]):

```
app.config.ts
eas.json
package.json            "main": "expo-router/entry"
tsconfig.json           { "extends": "expo/tsconfig.base", "compilerOptions": { "strict": true, "paths": { "@/*": ["./src/*"] } },
                          "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"] }
assets/
src/
  tasks.ts              TaskManager.defineTask(...) — imported first in app/_layout.tsx
  app/
    _layout.tsx         providers + <Stack> with Stack.Protected
    +native-intent.tsx  rewrite incoming links if needed
    sign-in.tsx
    (app)/
      _layout.tsx
      index.tsx
```

### `packages/expo-kit` — the shared kit

A normal workspace package exporting TypeScript source, with `react`,
`react-native` and `expo` as **peer** dependencies so the app's single copy is
used.

| Export                       | Contents                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `@yuntera/expo-kit/config`   | `defineAppConfig(appId, overrides)` used by each `app.config.ts`; Node-only, no React Native imports |
| `@yuntera/expo-kit/supabase` | client factory, storage adapter, `AppState` refresh hook (§3)                                        |
| `@yuntera/expo-kit/auth`     | `SessionProvider`, `useSession`, role guard                                                          |
| `@yuntera/expo-kit/api`      | `createApi(supabase)` from `@yuntera/db` plus error-message lookup                                   |
| `@yuntera/expo-kit/theme`    | numeric tokens derived from `@yuntera/brand` (§5), font names                                        |
| `@yuntera/expo-kit/ui`       | `Button`, `Text`, `Field`, `Screen`, `Money`… written with `StyleSheet`                              |
| `@yuntera/expo-kit/offline`  | query client, online manager, persisted mutation queue (§4f)                                         |
| `@yuntera/expo-kit/push`     | permission, token registration, channels (§4d)                                                       |

Keep `config` free of React Native imports: `app.config.ts` runs in Node.

### Routing with `expo-router` (~58.0.32)

| Topic           | How                                                                                                                                                                 | Source    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Entry           | `"main": "expo-router/entry"` in `package.json`; routes live in `src/app`                                                                                           | [N6]      |
| Layouts         | `_layout.tsx` per directory; groups in parentheses, e.g. `(app)`                                                                                                    | [E7]      |
| Auth gating     | `<Stack.Protected guard={!!session}>` around the screens that need a session; a screen may be declared only once                                                    | [E6]      |
| Redirect target | `redirectTo="/sign-in"` on `Stack.Protected` — "Available in SDK 58 and later"                                                                                      | [E6]      |
| Tabs            | `Tabs.Protected` works the same way (`import { Tabs } from 'expo-router/js-tabs'`); the template uses `NativeTabs` from `expo-router/native-tabs`                   | [E6] [N6] |
| Splash          | Call `SplashScreen.preventAutoHideAsync()` at module scope; hide when the session has loaded                                                                        | [E7]      |
| Typed routes    | `experiments.typedRoutes: true`. Still labelled beta. Types are generated when the dev server starts; **on CI run `npx expo customize tsconfig.json` before `tsc`** | [E8]      |
| Rewriting links | `src/app/+native-intent.tsx` exporting `redirectSystemPath({ path, initial })`; must never throw                                                                    | [E9]      |
| Web note        | Protected routes are client-side only; they are not access control                                                                                                  | [E6]      |

```tsx
// src/app/_layout.tsx
import "../tasks"; // registers background tasks before navigation
import { Stack } from "expo-router";
import { SessionProvider, useSession } from "@yuntera/expo-kit/auth";

function RootNavigator() {
  const { session, role } = useSession();
  return (
    <Stack>
      <Stack.Protected guard={!!session && role === "driver"} redirectTo="/sign-in">
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  );
}

export default function Root() {
  return (
    <SessionProvider>
      <RootNavigator />
    </SessionProvider>
  );
}
```

The guard is a convenience. What a signed-in person may do is still decided by
the database, as in the web apps.

### `app.config.ts` per app

`app.config.ts` works without setup, but **importing other TypeScript files
(our workspace packages) needs the `tsx` require hook as the first import**
[E10] [E11]. `tsx` 4.23.15 is already in the repo (`packages/brand/package.json`).

```ts
// apps/driver-native/app.config.ts
import "tsx/cjs"; // must be first
import type { ExpoConfig } from "expo/config";
import { defineAppConfig } from "@yuntera/expo-kit/config";

export default (): ExpoConfig =>
  defineAppConfig("driver", {
    slug: "yuntera-ruta",
    scheme: "yuntera-ruta",
    plugins: [
      "expo-router",
      [
        "expo-location",
        {
          locationWhenInUsePermission:
            "Yuntera Ruta usa su ubicación para mostrar su avance en la ruta mientras reparte.",
          // Any iOS string left out gets Expo's English default
          // ("Allow $(PRODUCT_NAME) to access your location") written into
          // Info.plist, which review can reject. Give every one in Spanish.
          locationAlwaysAndWhenInUsePermission:
            "Yuntera Ruta usa su ubicación para mostrar su avance en la ruta mientras reparte.",
          locationAlwaysPermission:
            "Yuntera Ruta usa su ubicación para mostrar su avance en la ruta mientras reparte.",
          locationFullAccuracyPermission:
            "Yuntera Ruta necesita su ubicación exacta para registrar cada entrega.",
          motionUsagePermission: false, // no motion data: removes the string and the motion code
          isIosBackgroundLocationEnabled: true,
          isAndroidForegroundServiceEnabled: true,
          isAndroidBackgroundLocationEnabled: false,
        },
      ],
      [
        "expo-notifications",
        { icon: "./assets/notification.png", color: "#17824f", defaultChannel: "ruta" },
      ],
    ],
  });
```

`defineAppConfig` supplies what is common: `name` from `@yuntera/brand`, `owner`,
`version`, `orientation`, icons, `ios.bundleIdentifier` / `android.package`
with the variant suffix, `ios.config.usesNonExemptEncryption`, `runtimeVersion`,
`updates.url`, `experiments.typedRoutes`, and `extra.eas.projectId`.

Rules from the docs [E10]:

- Never import `app.config.ts` from app code; read `Constants.expoConfig`.
- Nothing secret goes in the config: it is readable at runtime.
- `npx expo config` prints the resolved config. Use it in CI as a cheap check.

### App variants (install dev, preview and store builds side by side)

Each variant needs its own identifier [E12].

| Variant     | `APP_VARIANT` | Identifier (driver example) | Display name          |
| ----------- | ------------- | --------------------------- | --------------------- |
| development | `development` | `com.yuntera.ruta.dev`      | Yuntera Ruta (Dev)    |
| preview     | `preview`     | `com.yuntera.ruta.preview`  | Yuntera Ruta (Prueba) |
| production  | unset         | `com.yuntera.ruta`          | Yuntera Ruta          |

Consequences: push credentials and `google-services.json` are per identifier
(register all three Android packages in the one Firebase project) [E12]; use
`['expo-dev-client', { addGeneratedScheme: IS_DEV }]` so only the development
build answers the dev-server links [E12].

### EAS project and `eas.json`

Once per app: `eas login`, then `eas init` in the app directory to create the
EAS project, then `eas build:configure` to generate `eas.json` [E13] [E18].
Because our config is dynamic (`app.config.ts`), the CLI cannot write to it:
"dynamic configs must be manually updated by the developer" [E10]. Copy the
project id it prints into `extra.eas.projectId` by hand.

```jsonc
// apps/driver-native/eas.json
{
  "cli": { "version": ">= 27.11.0", "appVersionSource": "remote" },
  "build": {
    "base": { "node": "22.23.3", "pnpm": "10.28.0" },
    "development": {
      "extends": "base",
      "developmentClient": true,
      "distribution": "internal",
      "environment": "development",
      "env": { "APP_VARIANT": "development" }
    },
    "development-simulator": {
      "extends": "development",
      "ios": { "simulator": true }
    },
    "preview": {
      "extends": "base",
      "distribution": "internal",
      "channel": "preview",
      "environment": "preview",
      "env": { "APP_VARIANT": "preview" },
      "android": { "buildType": "apk" }
    },
    "production": {
      "extends": "base",
      "channel": "production",
      "environment": "production",
      "autoIncrement": true
    }
  },
  "submit": { "production": {} }
}
```

Field meanings, all from [E13] [E14]:

| Field                                          | Meaning                                                                                                                            |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `developmentClient: true`                      | Build includes `expo-dev-client`; never submitted to a store                                                                       |
| `distribution: "internal"`                     | Installable from a link. Android → APK. iOS → ad hoc provisioning, limited to registered devices                                   |
| `ios.simulator: true`                          | Unsigned iOS Simulator build; needs no Apple credentials [E51]                                                                     |
| `android.buildType`                            | `apk` or `app-bundle` (default; required by Google Play)                                                                           |
| `channel`                                      | Which EAS Update channel the binary listens to; ignored for development builds                                                     |
| `environment`                                  | Which EAS environment's variables are applied (`development` / `preview` / `production`)                                           |
| `appVersionSource: "remote"` + `autoIncrement` | EAS stores and bumps `versionCode` / `buildNumber`                                                                                 |
| `extends`                                      | Profile inheritance; a chain of at most 5 profiles (the CLI throws at depth 5, `@expo/eas-json@27.11.0` `build/build/resolver.js`) |
| `resourceClass: "large"`                       | Paid plans only                                                                                                                    |

Public settings (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`)
go in EAS environment variables with `eas env:set … --visibility plaintext`,
and in `.env.local` for local runs [E18]. `EXPO_PUBLIC_*` values are inlined
into the bundle, so only public values may use that prefix.

---

## 3. Sign-in with supabase-js in React Native

The repo already has `@supabase/supabase-js` 2.119.2; use the same version.
`@supabase/ssr` is not used in native apps.

### Client options

```ts
// packages/expo-kit/src/supabase.ts
import { AppState } from "react-native";
import { createClient } from "@supabase/supabase-js";
import { sessionStorage } from "./session-storage";

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  {
    auth: {
      storage: sessionStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false, // there is no browser URL to read on a phone
    },
  },
);

// Register exactly once, at module scope.
AppState.addEventListener("change", (state) => {
  if (state === "active") supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
```

| Point                       | Fact                                                                                                                                                               | Source                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `detectSessionInUrl: false` | Recommended by both Expo and Supabase for native                                                                                                                   | [E18] [SB1]                                                                     |
| Auto-refresh                | "On non-browser platforms the refresh process works continuously in the background"; tie it to `AppState`                                                          | `auth-js/src/GoTrueClient.ts:5455-5484`                                         |
| `lock` option               | **Deprecated in this version.** Passing `processLock` (older tutorials) logs a warning; "the client now coordinates session refreshes without a lock"              | `auth-js/src/GoTrueClient.ts:461-475`                                           |
| URL polyfill                | `react-native-url-polyfill` is not needed: "Expo installs a `URL` global already"                                                                                  | [E18]                                                                           |
| Token on each call          | `rpc` reads the token through `auth.getSession()`, which refreshes an expired token itself. This is what a background task relies on while auto-refresh is stopped | `supabase-js/src/SupabaseClient.ts:648-660`, `auth-js/src/GoTrueClient.ts:2806` |

### Where to keep the session

`expo-secure-store` on its own is the wrong container:

> "Large payloads can be rejected by the underlying platform. Historically, some
> iOS releases refused values above roughly 2048 bytes. Expo does not enforce a
> limit, so make sure to handle native errors if you plan to store very large
> strings." [E19]

A Supabase session (two tokens plus the user object) is usually larger than
that; Supabase's own examples say "Expo's SecureStore does not support values
larger than 2048 bytes" [SB1].

| Option                                | What it is                                                                                    | Encrypted at rest by us | Documented by        |
| ------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------- | -------------------- |
| A. `LargeSecureStore`                 | A fresh AES-256 key per write kept in SecureStore; the encrypted session kept in AsyncStorage | Yes                     | Supabase [SB1] [SB2] |
| B. `expo-sqlite/localStorage/install` | SQLite-backed `localStorage` in the app sandbox                                               | No                      | Expo [E18]           |
| C. AsyncStorage                       | Plain key-value file in the app sandbox                                                       | No                      | Supabase [SB1]       |

> **What the project does now (21 November 2026).** Option A was built first
> and then replaced: shipping `aes-js` made Apple's export-compliance answer
> a question for an adviser. The apps now keep the session in `expo-secure-store`
> **alone** — option D below — and declare
> `ios.config.usesNonExemptEncryption: false`. See
> [decision 18](../02-architecture/decisions.md#18-the-session-lives-in-the-phones-secure-store-alone)
> and `packages/expo-kit/src/supabase/secure-session-storage.ts`. The original
> recommendation and sample are kept below for the record.

| Option                               | What it is                                                                                                                                                                    | Encrypted at rest by us | Documented by       |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------- |
| D. SecureStore in pieces (**built**) | The session split into pieces of at most 1,024 UTF-8 bytes in SecureStore, a manifest written last; no cipher in the app, the encryption is the Keychain's and the Keystore's | No (the OS encrypts)    | This project; [E19] |

~~Recommendation: option A for all four apps~~ (superseded, see above). The
original text: "option A for all four apps (drivers and warehouse staff hold
operational permissions). Dependencies: `expo-secure-store` ~58.0.3,
`@react-native-async-storage/async-storage` **2.2.0**, `aes-js` 3.1.2,
`@types/aes-js` 3.1.4, and `expo-crypto` ~58.0.8 for `getRandomValues` [E58]
(Supabase's sample uses `react-native-get-random-values` instead; either works)."
`aes-js`, `@types/aes-js` and the kit's `expo-crypto` have since been removed;
`expo-crypto` remains only in the shop app, for a random identifier at checkout.
That package is not cipher-free: since SDK 58 it also exports an AES-GCM API
(`aesEncryptAsync`, `AESEncryptionKey`) over CryptoKit and javax.crypto. The
apps may call only its random-number functions, which a source check in
`packages/expo-kit/src/no-native-cipher.test.ts` enforces.

The superseded sample (option A, no longer in the code):

```ts
// SUPERSEDED: not what the project does. Kept to show what option A was.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import * as aesjs from "aes-js";

const keyOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export const sessionStorage = {
  async getItem(key: string) {
    const encrypted = await AsyncStorage.getItem(key);
    if (!encrypted) return null;
    const keyHex = await SecureStore.getItemAsync(key, keyOptions);
    if (!keyHex) return null;
    const cipher = new aesjs.ModeOfOperation.ctr(
      aesjs.utils.hex.toBytes(keyHex),
      new aesjs.Counter(1),
    );
    return aesjs.utils.utf8.fromBytes(cipher.decrypt(aesjs.utils.hex.toBytes(encrypted)));
  },
  async setItem(key: string, value: string) {
    const aesKey = Crypto.getRandomValues(new Uint8Array(32));
    const cipher = new aesjs.ModeOfOperation.ctr(aesKey, new aesjs.Counter(1));
    const encrypted = cipher.encrypt(aesjs.utils.utf8.toBytes(value));
    await SecureStore.setItemAsync(key, aesjs.utils.hex.fromBytes(aesKey), keyOptions);
    await AsyncStorage.setItem(key, aesjs.utils.hex.fromBytes(encrypted));
  },
  async removeItem(key: string) {
    await AsyncStorage.removeItem(key);
    await SecureStore.deleteItemAsync(key, keyOptions);
  },
};
```

Gotchas (still true for option D):

- SecureStore keys may contain only alphanumerics, `.`, `-`, `_` [E19]
  (expo-secure-store 58.0.3 checks `/^[\w.-]+$/`). The project escapes any
  other character, so a local key such as `sb-127.0.0.1:54321-auth-token`
  still gets a valid, unique name.
- On iOS, keychain items **survive uninstalling the app**; on Android they do
  not [E19]. The project clears what a previous installation left on the
  first start, using a non-secret marker in ordinary app storage.
- Neither `expo-secure-store` nor the adapter works on web [E19]. The web
  export used in tests has `session-storage.web.ts`, which uses `localStorage`.
- App Store Connect asks about encryption. Expo's docs say an app using
  `expo-secure-store` can set `ios.config.usesNonExemptEncryption: false`
  [E19]. With `aes-js` gone the project sets it, for all four apps.

### Password recovery and e-mail confirmation

On a phone there is no page for Supabase to redirect to, so the link in the
e-mail has to be handled deliberately. Three ways, in order of robustness:

| Way                          | E-mail contains                                                         | App does                                                                                    | Needs deep links?          |
| ---------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------- |
| 1. Code entry                | `{{ .Token }}` (6-digit code)                                           | `supabase.auth.verifyOtp({ email, token, type })`                                           | No                         |
| 2. Link with token hash      | `https://<host>/auth/confirm?token_hash={{ .TokenHash }}&type=recovery` | route `auth/confirm` calls `supabase.auth.verifyOtp({ token_hash, type })`                  | Yes (universal / app link) |
| 3. Supabase default redirect | `{{ .ConfirmationURL }}` with `redirectTo: 'yuntera://auth/callback'`   | parse `access_token` and `refresh_token` from the URL, call `supabase.auth.setSession(...)` | Yes (custom scheme)        |

Facts behind the table:

- `verifyOtp` accepts `{ email, token, type }` or `{ token_hash, type }`;
  `type` is `'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change' | 'email'`
  (`auth-js/src/lib/types.ts:877-912`). With `type: 'recovery'` the client emits
  `PASSWORD_RECOVERY` (`auth-js/src/GoTrueClient.ts:2511`); then call
  `supabase.auth.updateUser({ password })`.
- Template variables `{{ .Token }}`, `{{ .TokenHash }}`, `{{ .RedirectTo }}`,
  `{{ .ConfirmationURL }}` are documented in [SB4]. The same page warns that
  mail scanners that pre-fetch links consume `{{ .ConfirmationURL }}`
  ("Token has expired or is invalid") and recommends the code or a
  confirm-button page instead.
- Way 3 is what Supabase's Expo guide shows (`makeRedirectUri()`,
  `QueryParams.getQueryParams(url)`, `Linking.useLinkingURL()`, add the scheme
  under Auth → URL configuration, e.g. `com.supabase://**`) [SB3]. It needs
  `expo-auth-session` and `expo-web-browser` and is mainly for OAuth, which we
  do not use.

**Recommendation: way 1 in the native apps, with way 2 as the link in the same
e-mail** so the message also works on the web. The link opens the app when
universal links are set up (§4e) and the website otherwise.

Local development gaps to close first:

- `tools/dev-api` implements only `POST /auth/v1/token`, `POST /auth/v1/signup`,
  `GET /auth/v1/user` and `POST /auth/v1/logout`
  (`tools/dev-api/src/routes/auth.ts:94-183`). `verifyOtp`,
  `resetPasswordForEmail` and `resend` have nothing to call locally.
- A phone cannot reach `http://127.0.0.1:54321` (`apps/field/.env.example`):
  "A physical device or an Android Emulator can't reach it, so use your
  computer's LAN address" [E18]. Android 9+ also blocks plain HTTP by default;
  `expo-build-properties` has `android.usesCleartextTraffic` [E54] — set it for
  the development variant only. On iOS, the SDK 58 native template already
  sets `NSAppTransportSecurity` → `NSAllowsArbitraryLoads: false`,
  `NSAllowsLocalNetworking: true` (`expo-template-bare-minimum@58.0.35`
  `ios/*/Info.plist`); whether that exemption covers a plain-HTTP request to a
  LAN **IP address** is **UNVERIFIED** (Apple's page could not be read). An
  HTTPS tunnel to the stand-in avoids both questions.

---

## 4. Device features

Which features work where (first line of each module's reference page):

| Module (SDK 58 version)                           | Android         | iOS             | Web                                 | Expo Go                              | Source   |
| ------------------------------------------------- | --------------- | --------------- | ----------------------------------- | ------------------------------------ | -------- |
| `expo-location` ~58.0.22                          | ✓               | ✓               | ✓ foreground                        | background needs a development build | [E20]    |
| `expo-task-manager` ~58.0.14                      | ✓               | ✓               | ✗ (`isAvailableAsync()` is `false`) | not on Android                       | [E21]    |
| `expo-camera` ~58.0.14                            | **device only** | **device only** | ✓                                   | ✓                                    | [E22]    |
| `expo-image-picker` ~58.0.10                      | ✓               | ✓               | ✓                                   | ✓                                    | [E23]    |
| `expo-file-system` ~58.0.14 (`File`)              | ✓               | ✓               | ✗                                   | ✓                                    | [E24]    |
| `expo-notifications` ~58.1.9                      | ✓               | ✓               | ✗                                   | remote push not on Android           | [E25]    |
| `expo-secure-store` ~58.0.3                       | ✓               | ✓               | ✗                                   | ✓                                    | [E19]    |
| `expo-linking` ~58.0.17                           | ✓               | ✓               | ✓                                   | ✓                                    | [E-plat] |
| `expo-network` ~58.0.5                            | ✓               | ✓               | ✓                                   | ✓                                    | [E31]    |
| `@react-native-async-storage/async-storage` 2.2.0 | ✓               | ✓               | ✓                                   | ✓                                    | [E-plat] |

Conclusion: **development builds from day one** (`expo-dev-client` ~58.0.21);
Expo Go cannot run the drivers' app.

### (a) Location: foreground and background

Config plugin keys [E20]:

| Key                                    | Platform | Effect                                                                                                                                            |
| -------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `locationWhenInUsePermission`          | iOS      | `NSLocationWhenInUseUsageDescription`                                                                                                             |
| `locationAlwaysAndWhenInUsePermission` | iOS      | `NSLocationAlwaysAndWhenInUseUsageDescription`                                                                                                    |
| `locationAlwaysPermission`             | iOS      | `NSLocationAlwaysUsageDescription`                                                                                                                |
| `locationFullAccuracyPermission`       | iOS      | temporary full-accuracy purpose string (`false` removes it)                                                                                       |
| `motionUsagePermission`                | iOS      | `NSMotionUsageDescription`; `false` removes it and turns off the motion code                                                                      |
| `isIosBackgroundLocationEnabled`       | iOS      | adds `location` to `UIBackgroundModes`                                                                                                            |
| `isAndroidForegroundServiceEnabled`    | Android  | adds `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION` and `POST_NOTIFICATIONS` (defaults to the value of `isAndroidBackgroundLocationEnabled`) |
| `isAndroidBackgroundLocationEnabled`   | Android  | adds `ACCESS_BACKGROUND_LOCATION` and `RECEIVE_BOOT_COMPLETED`                                                                                    |
| `androidForegroundServiceIcon`         | Android  | 96×96 all-white PNG for the service notification                                                                                                  |

Always added on Android: `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION` [E20].

Every iOS string key that is **left out** is written with Expo's English
default (`Allow $(PRODUCT_NAME) to access your location`, `… detect your
current motion activity`, `… access your precise location`); only `false`
removes a key (`expo-location@58.0.22` `plugin/build/withLocation.js`,
`@expo/config-plugins@58.0.13` `build/ios/Permissions.js` [N5]). Set each one
in Spanish or to `false`, as in the `app.config.ts` example in §2.

API:

| Call                                                    | Use                                                                                                              |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `Location.requestForegroundPermissionsAsync()`          | "While using" permission. On iOS "Allow Once" is indistinguishable and blocks a later background prompt          |
| `Location.requestBackgroundPermissionsAsync()`          | iOS "Always"; on Android 11+ opens system settings. Explain first                                                |
| `Location.getCurrentPositionAsync({ accuracy })`        | One fix (delivery confirmation)                                                                                  |
| `Location.watchPositionAsync(options, cb)`              | Foreground only                                                                                                  |
| `Location.startLocationUpdatesAsync(taskName, options)` | Continues when the app is not on screen                                                                          |
| `Location.stopLocationUpdatesAsync(taskName)`           | Stop at end of route and at sign-out                                                                             |
| `TaskManager.defineTask(name, ({ data, error }) => …)`  | Must run at module scope; in Expo Router put it in `src/tasks.ts` imported at the top of `app/_layout.tsx` [E21] |

**The finding that shapes the drivers' app:** tracking that continues while the
phone is in a pocket does **not** require the background ("Always") permission
on either platform, if the driver starts it while the app is open.

- Android source: "There are two ways of starting this service. 1. As a
  background location service, this requires the background location
  permission. 2. As a user-initiated foreground service with notification, this
  does NOT require the background location permission." The check is
  `options.foregroundService != null`; starting it while the app is not on
  screen throws `ForegroundServiceStartNotAllowedException`.
  (`expo-location@58.0.22` `LocationModule.kt:318-340` [N5])
- iOS source: `startLocationUpdatesAsync` checks only the foreground permission
  and that the `location` background mode is present.
  (`LocationModule.swift:255-272` [N5])

```ts
// src/tasks.ts
import * as TaskManager from "expo-task-manager";
import type { LocationObject } from "expo-location";
import { reportPositions } from "@yuntera/expo-kit/offline";

export const ROUTE_TASK = "yuntera-route-location";

TaskManager.defineTask<{ locations: LocationObject[] }>(ROUTE_TASK, async ({ data, error }) => {
  if (error || !data) return;
  // Calls driver_report_position (packages/db/src/api.ts:510-511); queues on failure.
  await reportPositions(data.locations);
});
```

```ts
// when the driver taps "Iniciar ruta" (the app is on screen)
await Location.startLocationUpdatesAsync(ROUTE_TASK, {
  accuracy: Location.Accuracy.High,
  timeInterval: 15_000, // Android only
  distanceInterval: 25, // metres
  deferredUpdatesInterval: 30_000, // batching while in the background
  activityType: Location.ActivityType.AutomotiveNavigation, // iOS
  pausesUpdatesAutomatically: false, // iOS
  showsBackgroundLocationIndicator: true, // iOS status-bar indicator
  foregroundService: {
    notificationTitle: "Yuntera Ruta",
    notificationBody: "Compartiendo su ubicación durante la ruta",
    notificationColor: "#17824f",
    killServiceOnDestroy: true,
  },
});
```

The numbers are starting points, not researched optima.

Platform limits [E20]:

- "Background location will stop if the user terminates the app" and resumes
  when it is reopened. On Android some manufacturers treat swiping the app away
  as killing it.
- The database keeps one row per report (`public.driver_positions`,
  `supabase/migrations/20261121080700_logistics.sql:74`); a 15-second interval
  is about 2,000 rows per driver per 8-hour day.

Store consequences are in §8.

### (b) Barcode scanning with `expo-camera`

```tsx
import { CameraView, useCameraPermissions } from "expo-camera";

const [permission, requestPermission] = useCameraPermissions();
const [locked, setLocked] = useState(false);

<CameraView
  style={{ flex: 1 }}
  facing="back"
  enableTorch={torch}
  barcodeScannerSettings={{
    barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e", "code128", "code39", "itf14", "qr"],
  }}
  onBarcodeScanned={
    locked
      ? undefined
      : ({ type, data }) => {
          setLocked(true);
          onCode(type, data);
        }
  }
/>;
```

| Topic          | Fact                                                                                                                                                                                                                                                            | Source                                                    |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Symbologies    | `'aztec' \| 'ean13' \| 'ean8' \| 'qr' \| 'pdf417' \| 'upc_e' \| 'datamatrix' \| 'code39' \| 'code93' \| 'itf14' \| 'codabar' \| 'code128' \| 'upc_a'`                                                                                                           | [E22]                                                     |
| Result         | `{ type, data, bounds, cornerPoints }`; `data` is the decoded string                                                                                                                                                                                            | [E22]                                                     |
| Repeats        | The callback fires for every frame that sees a code: gate it as above                                                                                                                                                                                           | behaviour implied by the callback design; gate is ours    |
| One preview    | "Only one Camera preview can be active at any given time" — unmount on blur                                                                                                                                                                                     | [E22]                                                     |
| System scanner | `CameraView.launchScanner({ barcodeTypes })` + `CameraView.onModernBarcodeScanned(listener)`: Google code scanner on Android, `DataScannerViewController` on iOS 16+                                                                                            | [E22]                                                     |
| Still image    | `scanFromURLAsync(url, types)`: "Only QR codes are supported on iOS"                                                                                                                                                                                            | [E22]                                                     |
| Permissions    | Android `CAMERA` added automatically; iOS `NSCameraUsageDescription` via plugin key `cameraPermission`. For a scanner-only app set `recordAudioAndroid: false` **and** `microphonePermission: false` (otherwise iOS gets the English default microphone string) | [E22], `expo-camera@58.0.14` `plugin/build/withCamera.js` |
| Emulators      | The module is "device only" on Android and iOS: **camera scanning cannot be verified on a simulator**, local or cloud                                                                                                                                           | [E22]                                                     |

Keep the existing path where a Bluetooth scanner types into a focused text
field; it needs no camera and works in every environment.

### (c) Photos: capture and upload

```ts
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';

await ImagePicker.requestCameraPermissionsAsync();
const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7, exif: false });
if (result.canceled) return;
const asset = result.assets[0];           // { uri, width, height, mimeType?, fileName?, fileSize? }

const bytes = await new File(asset.uri).arrayBuffer();
const { error } = await supabase.storage
  .from('product-photos')
  .upload(path, bytes, { contentType: asset.mimeType ?? 'image/jpeg', upsert: false });
```

| Topic                                         | Fact                                                                                                                                                                                                                                                                      | Source                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Do not pass Blob/File/FormData to supabase-js | "For React Native, using either `Blob`, `File` or `FormData` does not work as intended. Upload file using `ArrayBuffer`…"                                                                                                                                                 | `storage-js/src/packages/StorageFileApi.ts:215`                      |
| Getting bytes                                 | `expo-file-system`'s `File` "implements Blob"; `arrayBuffer()` and `bytes()` read the file without base64                                                                                                                                                                 | [E24]                                                                |
| Alternative                                   | `createSignedUploadUrl(path)` then `new File(uri).upload(url, { httpMethod: 'PUT', headers, onProgress })`; supports progress and an iOS background session                                                                                                               | `StorageFileApi.ts:235-372`, [E24]                                   |
| Web                                           | `asset.file` is a browser `File`; `expo-file-system`'s `File` does not exist on web. Split with `.web.ts`                                                                                                                                                                 | [E23] [E24]                                                          |
| Library picker                                | "No permissions request is necessary for launching the image library"                                                                                                                                                                                                     | [E23]                                                                |
| Android process death                         | Call `ImagePicker.getPendingResultAsync()` on start to recover a result lost when Android killed the activity                                                                                                                                                             | [E23]                                                                |
| Microphone                                    | The plugin adds `RECORD_AUDIO` and an English iOS microphone string by default; `microphonePermission: false` blocks `RECORD_AUDIO` and removes the string. `RECORD_AUDIO` is also blocked if listed in `android.blockedPermissions` (needed if any other module adds it) | [E23], `expo-image-picker@58.0.10` `plugin/build/withImagePicker.js` |
| iOS strings                                   | `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription` via plugin keys `cameraPermission`, `photosPermission`                                                                                                                                                       | [E23]                                                                |
| Size                                          | Use `quality` (0–1) or `expo-image-manipulator` ~58.0.16 to resize before upload                                                                                                                                                                                          | [E23] [N2]                                                           |

Not in place yet: there is no storage bucket and `tools/dev-api` has no
`/storage/v1` route; product photos are a separate pending task.

### (d) Push notifications

Client:

```ts
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerForPush(): Promise<string | null> {
  if (Platform.OS === "android") {
    // Must exist BEFORE asking for a token: on Android 13+ the permission prompt
    // "will not appear until at least one notification channel is created". [E25]
    await Notifications.setNotificationChannelAsync("pedidos", {
      name: "Pedidos",
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") ({ status } = await Notifications.requestPermissionsAsync());
  if (status !== "granted") return null;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data; // "ExponentPushToken[…]"
}
```

| Topic               | Fact                                                                                                                                                                                                                                                                                   | Source                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Packages            | `expo-notifications` ~58.1.9, `expo-constants` ~58.0.16, `expo-device` ~58.0.5                                                                                                                                                                                                         | [E26] [N2]                                                               |
| Plugin keys         | `icon` (96×96 white PNG), `largeIcon`, `color`, `defaultChannel`, `sounds`, `mode` (iOS, `development` / `production`), `enableRemoteNotifications` (iOS, default `true`), `enableBackgroundRemoteNotifications` (iOS, default `false`)                                                | [E25], `expo-notifications@58.1.9` `plugin/build/withNotifications.d.ts` |
| Android credentials | Firebase project → service account JSON (role _Firebase Cloud Messaging API Admin_) uploaded with `eas credentials` → Android → Google Service Account → FCM V1; `google-services.json` referenced by `android.googleServicesFile` (may be committed; the service-account key may not) | [E28]                                                                    |
| iOS credentials     | "A paid Apple Developer Account is required." EAS generates the APNs key during the first `eas build`                                                                                                                                                                                  | [E26]                                                                    |
| iOS permission      | Read `ios.status` (`AUTHORIZED`, `PROVISIONAL`, `DENIED`…) rather than the root `status`                                                                                                                                                                                               | [E25]                                                                    |
| Opening a screen    | Send `data: { url: '/pedidos/YT-123' }`; in the root layout use `Notifications.getLastNotificationResponse()` and `addNotificationResponseReceivedListener` to `router.push(url)`                                                                                                      | [E25]                                                                    |
| Where it runs       | Physical devices, Android emulators with Google Play services, iOS simulators (Xcode 14+). Not in Expo Go on Android                                                                                                                                                                   | [E25] [E26]                                                              |

Server — the Expo Push API [E27]:

| Item           | Value                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Send           | `POST https://exp.host/--/api/v2/push/send`                                                                                                            |
| Headers        | `accept: application/json`, `accept-encoding: gzip, deflate`, `content-type: application/json`                                                         |
| Auth           | None by default. Optional "enhanced push security": `Authorization: Bearer <access token>`; once enabled, requests without it fail with `UNAUTHORIZED` |
| Body           | One message object or an array of **up to 100**, all for the same Expo project                                                                         |
| Receipts       | `POST https://exp.host/--/api/v2/push/getReceipts` with `{ "ids": [...] }`, **up to 1000** ids                                                         |
| Rate limit     | 600 notifications per second per project (`TOO_MANY_REQUESTS`)                                                                                         |
| Payload limit  | 4096 bytes total per notification (`MessageTooBig`)                                                                                                    |
| Receipt timing | Check about 15 minutes after sending; receipts are deleted after 24 hours                                                                              |
| Retries        | Exponential back-off on HTTP 429 and 5xx                                                                                                               |
| SLA            | None                                                                                                                                                   |

Message fields we will use: `to` (token or array), `title`, `body`, `data`,
`sound` (`"default"`, iOS), `channelId` (Android; **if the channel does not
exist on the device the notification is not shown**), `priority`
(`default | normal | high`), `ttl`, `badge`, `collapseId`.

```jsonc
// request
[{ "to": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]", "title": "Su pedido va en camino",
   "body": "YT-123 llega hoy", "data": { "url": "/pedidos/YT-123" }, "channelId": "pedidos", "sound": "default" }]
// response: tickets, in order
{ "data": [{ "status": "ok", "id": "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX" }] }
// or per message: { "status": "error", "message": "...", "details": { "error": "DeviceNotRegistered" } }
// receipts response
{ "data": { "XXXXXXXX-…": { "status": "ok" } } }
```

Errors to handle: `DeviceNotRegistered` (delete the token), `MessageTooBig`,
`MessageRateExceeded`, `MismatchSenderId`, `InvalidCredentials`; request level
`TOO_MANY_REQUESTS`, `PUSH_TOO_MANY_EXPERIENCE_IDS` (tokens from two Expo
projects in one request — **send per app**), `PUSH_TOO_MANY_NOTIFICATIONS`,
`PUSH_TOO_MANY_RECEIPTS` [E27].

What the database lacks today: a table of push tokens (user, app, token,
platform, last seen) and a worker that reads the outbox and calls the API. No
`push` table or function exists in `supabase/migrations`.

### (e) Links into the apps

Three layers, simplest first:

| Layer                                         | Config                                                                       | Verified by the OS?            |
| --------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------ |
| Custom scheme, e.g. `yuntera-ruta://ruta/hoy` | `scheme` in app config                                                       | No; any app can claim a scheme |
| iOS Universal Links                           | `ios.associatedDomains: ["applinks:www.yuntera.cr"]` + a file on the website | Yes                            |
| Android App Links                             | `android.intentFilters` with `autoVerify: true` + a file on the website      | Yes                            |

iOS [E29] — serve at `https://<host>/.well-known/apple-app-site-association`
(HTTPS, no extension, no redirect):

```json
{
  "applinks": {
    "details": [
      {
        "appIDs": ["<TEAM_ID>.com.yuntera.shop"],
        "components": [{ "/": "/p/*" }, { "/": "/pedidos/*" }, { "/": "/auth/confirm" }]
      }
    ]
  }
}
```

- `associatedDomains` must not include `https://`.
- iOS downloads the file when the app is installed or updated; changing paths
  later needs an app update.

Android [E30] — app config:

```json
{
  "android": {
    "intentFilters": [
      {
        "action": "VIEW",
        "autoVerify": true,
        "data": [{ "scheme": "https", "host": "www.yuntera.cr", "pathPrefix": "/p" }],
        "category": ["BROWSABLE", "DEFAULT"]
      }
    ]
  }
}
```

and `https://<host>/.well-known/assetlinks.json`, served as `application/json`:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.yuntera.shop",
      "sha256_cert_fingerprints": ["<SHA256 from `eas credentials -p android`>"]
    }
  }
]
```

For the Next.js apps these are files under `apps/<app>/public/.well-known/`.
Each native app pairs with its own host (`www`, `vende`, `ruta`, `bodega`), and
no domain is bought yet, so universal links cannot be tested until then; custom
schemes can.

In the app, Expo Router maps the path to a route automatically; use
`+native-intent.tsx` to rewrite paths that differ between web and app [E9].

### (f) Offline

Detecting the network:

| Option                                   | API                                                                                                                         | Note                                                                          |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `expo-network` ~58.0.5                   | `useNetworkState()`, `getNetworkStateAsync()`, `addNetworkStateListener(cb)` → `{ type, isConnected, isInternetReachable }` | On iOS `isInternetReachable` "will always be the same as `isConnected`" [E31] |
| `@react-native-community/netinfo` 12.0.1 | `NetInfo.addEventListener(cb)`, `NetInfo.fetch()`                                                                           | Version Expo pins [N2] [E32]                                                  |

Neither proves the Supabase API is reachable; treat a failed request as the
truth and the listener as a hint.

Recommended pattern — a persisted mutation queue with TanStack Query 5.108.2
(`@tanstack/react-query`, `@tanstack/react-query-persist-client`,
`@tanstack/query-async-storage-persister`, all 5.108.2 [N1]):

```ts
// 1. Tell the library when we are online. [T1]
onlineManager.setEventListener((setOnline) => {
  const sub = Network.addNetworkStateListener((s) => setOnline(!!s.isConnected));
  Network.getNetworkStateAsync().then((s) => setOnline(!!s.isConnected)).catch(() => {});
  return sub.remove;
});

// 2. Refetch when the app returns to the foreground. [T1]
AppState.addEventListener('change', (s) => focusManager.setFocused(s === 'active'));

// 3. Every queued action needs a default function: functions cannot be persisted. [T2]
queryClient.setMutationDefaults(['completeStop'], {
  mutationFn: (input: CompleteStopInput) => api.driverCompleteStop(input),   // packages/db/src/api.ts:480
  retry: 3,
  scope: { id: 'route' },      // same scope id → run one at a time, in order
});

// 4. Persist, and resume after restoring. [T2] [N9]
<PersistQueryClientProvider
  client={queryClient}
  persistOptions={{ persister: createAsyncStoragePersister({ storage: AsyncStorage }) }}
  onSuccess={() => queryClient.resumePausedMutations()}
/>
```

Why this fits Yuntera:

- The database functions already make retries safe where it matters:
  `place_order` takes an idempotency key (`packages/db/src/api.ts:34-35`). Give
  each queued driver or warehouse action a client-generated id for the same
  reason. Whether `driver_complete_stop` and the warehouse functions are
  idempotent today was **not checked**.
- A queued delivery confirmation can come back refused (wrong code, stop
  already closed). The queue needs a visible "pendiente / rechazado" state per
  item, not a silent retry.
- The delivery code is checked on the server and never shown to the driver
  (decision 5). Offline, a wrong code cannot be detected at the door. That is a
  product decision, listed below.
- Positions are a different shape: append to a small local buffer and send in
  batches; drop the oldest beyond a cap.

Expo's own local-first guide lists Legend-State, TinyBase, SQLite and others and
calls the area early-stage [E56]. A full sync engine is not justified for two
queues.

---

## 5. Styling and fonts

| Option                        | Version today           | Tailwind                       | Status                                                          | Fit                                                                                 |
| ----------------------------- | ----------------------- | ------------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `StyleSheet` + a token object | part of React Native    | none                           | Stable                                                          | **Recommended**                                                                     |
| NativeWind 4                  | 4.2.7 (stable)          | **v3** (`tailwindcss@^3.4.17`) | Stable, but on the previous Tailwind major                      | The web apps are on Tailwind 4.3.5: two Tailwind majors and two configs in one repo |
| NativeWind 5                  | 5.0.0-rc.1 (2 Nov 2026) | v4, via `react-native-css`     | Release candidate; "It is not intended for production use."     | Not yet                                                                             |
| Uniwind                       | 1.14.0                  | v4 (`tailwindcss >= 4`)        | Newer project; mentioned beside NativeWind in Expo's docs       | Not evaluated in depth — **UNVERIFIED** maturity                                    |
| Unistyles                     | 3.8.2                   | none                           | Needs `react-native-nitro-modules`, `react-native-edge-to-edge` | More native dependencies than the problem needs                                     |

Sources: [NW1] [NW2] [N1] [E4].

For a small team that values stability: plain `StyleSheet` and one theme object.
No Babel plugin, no Metro wrapper, nothing to break on an SDK upgrade, and the
tokens already exist as TypeScript.

```ts
// packages/expo-kit/src/theme.ts
import {
  color,
  semantic,
  radius as cssRadius,
  fontSize as remSize,
  touchTarget,
} from "@yuntera/brand";

const px = (v: string) => Number.parseFloat(v); // "10px" → 10
const rem = (v: string) => Number.parseFloat(v) * 16; // "1.125rem" → 18

export const theme = {
  color,
  semantic,
  radius: {
    sm: px(cssRadius.sm),
    md: px(cssRadius.md),
    lg: px(cssRadius.lg),
    xl: px(cssRadius.xl),
    full: 9999,
  },
  fontSize: Object.fromEntries(Object.entries(remSize).map(([k, v]) => [k, rem(v)])) as Record<
    keyof typeof remSize,
    number
  >,
  font: { body: "Inter", display: "Bricolage Grotesque" },
  touchTarget: px(touchTarget), // "44px" → 44
} as const;
```

A unit test should assert the numeric tokens equal the CSS ones, like
`packages/brand/src/tokens.test.ts` does for `tokens.css`. The `font` and
`shadow` exports in `tokens.ts` are CSS strings and are not usable natively.

### Fonts

| Question              | Answer                                                                                                                                        | Source     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Formats               | OTF and TTF on Android, iOS and web. The config plugin also takes WOFF/WOFF2 **on iOS only**                                                  | [E33]      |
| Our current files     | `packages/next-kit/fonts/*.woff2` (`packages/next-kit/src/fonts.ts`) — not usable on Android. TTF files are needed                            | repo       |
| Variable fonts        | "Android and iOS support variable fonts in SDK 58 and later."                                                                                 | [E33]      |
| Android caveat        | Reads the `wght` axis; "This needs Android 10 or later. On earlier versions the font renders at its default weight." Our minimum is Android 7 | [E33]      |
| iOS caveat            | Only the font's _named instances_ are selectable through `fontWeight`; other positions need `fontVariationSettings` (RN 0.88+)                | [E33]      |
| Recommended loading   | `expo-font` config plugin: embedded at build time, available at first frame, no loading code. Needs a development build (fine for us)         | [E33]      |
| Runtime loading       | `useFonts` hook; works in Expo Go and on web                                                                                                  | [E33]      |
| Google Fonts packages | `@expo-google-fonts/inter` 0.4.2 and `@expo-google-fonts/bricolage-grotesque` 0.4.1 ship static TTFs per weight                               | [N1] [E33] |

So variable fonts are supported on both platforms, with platform-specific
behaviour. Two workable setups:

1. **Static weights (recommended).** Embed Inter 400/500/600/700 and Bricolage
   Grotesque 600/700 as static TTFs through the config plugin, declared on
   Android with `fontFamily` + `fontDefinitions` (`weight`, `style`) so that
   `fontFamily: 'Inter', fontWeight: '600'` works on both platforms. Identical
   on Android 7–16 and iOS.
2. **Variable files.** One TTF per family, Android `fontDefinitions` per weight
   with a shared `path`; on iOS list the file in `ios.fonts`. Fewer files;
   depends on the named instances in the specific font files — inspect them with
   fontTools first [E33]. **UNVERIFIED** for these two fonts.

Naming gotcha: with plain file paths, Android uses the **file name** as the
family and iOS uses the name **inside the font** (for example `Inter_900Black`
versus `Inter-Black`) [E33]. Use the object form with an explicit `fontFamily`.

---

## 6. What can be verified without a Mac or a phone

| Check                           | Command (in the app directory)                                      | Linux CI?  | What it proves                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------- |
| Types                           | `npx expo customize tsconfig.json && tsc --noEmit`                  | Yes        | Code and typed routes compile [E8]                                                                               |
| Lint/format                     | `biome check`                                                       | Yes        | —                                                                                                                |
| Dependency versions             | `CI=1 npx expo install --check`                                     | Yes        | Every package matches SDK 58; exits non-zero in CI [E35]                                                         |
| Project health                  | `npx expo-doctor`                                                   | Yes        | App config, duplicate native modules, React Native Directory compatibility [E36] [E2]                            |
| Config                          | `npx expo config --json`                                            | Yes        | `app.config.ts` evaluates                                                                                        |
| Unit and component tests        | `jest` with the `jest-expo` preset                                  | Yes        | Logic and rendering against mocked native modules [E37]                                                          |
| JS bundle, Android              | `npx expo export --platform android`                                | Yes        | Metro resolves every import, including workspace packages; Hermes bytecode compiles                              |
| JS bundle, iOS                  | `npx expo export --platform ios`                                    | Yes        | Same, for iOS                                                                                                    |
| Web bundle                      | `npx expo export --platform web`                                    | Yes        | A static site in `dist/`                                                                                         |
| Browser journeys                | Playwright against `dist/`                                          | Yes        | Screens, navigation, forms, API calls — through `react-native-web`                                               |
| Native project generation       | `npx expo prebuild --platform android`                              | Probably   | Config plugins run and produce a native project. **UNVERIFIED** on our box; flags per `npx expo prebuild --help` |
| Android binary                  | `eas build -p android` (cloud) or local Gradle with the Android SDK | Cloud: yes | It compiles                                                                                                      |
| iOS binary                      | `eas build -p ios` (cloud, macOS workers)                           | Cloud only | It compiles [E16]                                                                                                |
| App starts, native modules work | Device, emulator, or Expo Simulators                                | **No**     | The only real proof                                                                                              |

Notes:

- **`expo export` needs no Xcode or Android SDK.** It is defined as "export the
  JavaScript and assets for your app using Metro bundler" and is what
  `eas update` runs [E35]; the Hermes compiler package ships a `linux64` binary
  [N8]. Options: `--platform ios|android|web|all`, `--output-dir`,
  `--no-bytecode`, `--dev`. That it passes on _this_ repository is
  **UNVERIFIED** until tried.
- **`jest-expo` 58.0.15** peers: `jest ^29 || ^30` and
  **`@react-native/jest-preset ^0.88.1`** (a separate package now) [N1].
  `@testing-library/react-native` 14.1.0 replaces the deprecated
  `react-test-renderer` [E37]; it has a required peer `test-renderer ^1.0.0`
  (1.3.1 on npm) that must be added next to it [N1]. Under pnpm the docs give a specific
  `transformIgnorePatterns` starting `node_modules/(?!(.pnpm|(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|…))`
  [E37]. The rest of the repo uses Vitest; the native apps would be the only
  Jest users.
- **Web export limits.** `web.output` is `single` unless set (the template sets
  `server`; use `single` or `static` for a Playwright target) [E39]. Web needs
  `react-dom`, `react-native-web`, `@expo/metro-runtime` [E39].

Guards needed for the web export (from the platform table in §4):

| Module                                                  | On web                                                         | Guard                                                          |
| ------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------- |
| `expo-secure-store`                                     | absent                                                         | `session-storage.web.ts` using `localStorage`                  |
| `expo-task-manager`, background location                | absent                                                         | `Platform.OS !== 'web'`; foreground `watchPositionAsync` works |
| `expo-notifications`                                    | absent                                                         | skip registration                                              |
| `expo-file-system` `File`                               | absent                                                         | use `asset.file` from the picker                               |
| `expo-camera`                                           | works with a webcam; Playwright can use Chromium's fake camera | barcode detection on web — **UNVERIFIED** in headless Chromium |
| `expo-updates`, `expo-dev-client`, `expo-splash-screen` | absent                                                         | no-ops or guards                                               |

The web export therefore verifies the screens and data flow, and **none** of the
reasons native apps were asked for (background tracking, push, camera scanning,
offline restart). Say so in the status document.

### What only a build plus a device can show

Start-up without a crash; permission prompts and their wording; background
location with the screen off; the Android service notification; push delivery;
camera scanning (physical device only); fonts; keyboard and safe-area
behaviour; deep and universal links; session survival across restarts; behaviour
after the system kills the app.

Ways to get there without owning a Mac:

| Route                                                    | Needs                                                                                                                                                                                                                 | Covers                                                                                                                   |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| EAS Build → APK on an Android phone                      | Expo account; no Google account                                                                                                                                                                                       | Everything on Android                                                                                                    |
| EAS Build → iOS ad hoc build on an iPhone                | Apple Developer Program; device registered with `eas device:create` (Apple's limit is 100 devices for ad hoc distribution; on new memberships a newly registered device can take 24–72 h to become installable) [E17] | Everything on iOS                                                                                                        |
| EAS Build → TestFlight                                   | Apple Developer Program                                                                                                                                                                                               | Everything on iOS, plus tester distribution                                                                              |
| Expo Simulators (cloud iOS Simulator / Android Emulator) | **Paid Expo plan**; an APK or an iOS _simulator_ build; sessions up to 115 minutes [E49] [E50]                                                                                                                        | Start-up, screens, navigation, simulated location, push on simulators; **not** camera, **not** physical-device behaviour |
| Maestro flows on EAS Workflows                           | EAS build images include Maestro 2.10–2.11 [E16]; free plan includes 60 CI minutes a month [E42]                                                                                                                      | Scripted end-to-end runs on emulators                                                                                    |

---

## 7. EAS: cost, what each build needs, accounts, and the tools here

### Plans (expo.dev/pricing on 21 Nov 2026) [E42]

|                        | Free                                                  | Starter                                                | Production                                             |
| ---------------------- | ----------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| Price                  | US$0                                                  | US$19/month + usage                                    | US$199/month + usage                                   |
| Builds                 | **15 Android + 15 iOS per month**, low-priority queue | US$45 build credit, high priority                      | US$225 build credit, high priority                     |
| Build timeout          | 45 minutes                                            | 2 hours                                                | 2 hours                                                |
| Concurrency            | 5 total, 1 on macOS                                   | 5 total, 2 on macOS                                    | 15 total, 10 on macOS                                  |
| Large workers          | No                                                    | Yes                                                    | Yes                                                    |
| EAS Update             | 1,000 monthly active users, 100 GiB                   | 3,000 MAU then US$0.005/user; 100 GiB then US$0.10/GiB | 50,000 MAU; 1 TiB                                      |
| EAS Submit             | Included                                              | Included                                               | Included                                               |
| CI minutes (Workflows) | 60/month                                              | usage-based                                            | usage-based                                            |
| Expo Simulators        | **Not available** (no sessions)                       | US$0.10/minute; 60 minutes a month included until 2027 | US$0.10/minute; 60 minutes a month included until 2027 |

Usage price per build beyond credit: Android US$1 (medium) / US$2 (large); iOS
US$2 (medium) / US$4 (large) [E41] [E42].

Things that follow for four apps:

- The free allowance is **per account, not per app**: one round of four apps on
  two platforms is 8 of the 30 monthly builds.
- "All commercial projects with >$1,500 USD in monthly revenue are required to
  be on a paid plan." [E43]
- Expo Simulators cost US$0.10 a minute on Starter and Production, with 60
  minutes a month included until 2027 [E42]; a session runs at most 115 minutes
  and keeps running (and billing) until stopped, its idle limit or that maximum,
  even after a `--non-interactive` command or CI job ends [E50]. Always pass a
  maximum duration and an idle limit.

### What each kind of build needs

| Build                  | Command                                            | Credentials                                                                    | Accounts                           |
| ---------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------- |
| Android APK (internal) | `eas build -p android --profile preview`           | Keystore generated and stored by EAS                                           | Expo                               |
| Android AAB (store)    | `eas build -p android --profile production`        | Same keystore                                                                  | Expo (+ Play Console to publish)   |
| iOS Simulator          | `eas build -p ios --profile development-simulator` | None: "iOS Simulator builds are not signed" [E51]                              | Expo                               |
| iOS device, ad hoc     | `eas build -p ios --profile preview`               | Distribution certificate + ad hoc profile listing device UDIDs, created by EAS | Expo + **Apple Developer Program** |
| iOS store / TestFlight | `eas build -p ios --profile production`            | Distribution certificate + App Store profile                                   | Expo + Apple Developer Program     |

iOS builds run on Expo's macOS workers, Android on Linux [E16]; no Mac is
needed to build or to submit: "Expo Submit works on macOS, Linux, and Windows"
[E45].

### EAS Update (over-the-air JavaScript updates)

- `pnpm expo install expo-updates` (~58.0.22), then `eas update:configure`.
  On a static `app.json` it writes `runtimeVersion` and `updates.url` [E46];
  with our dynamic `app.config.ts` it only prints a warning and the values to
  add (`eas-cli@27.11.0` `build/update/configure.js:162-163`), so put them in
  `defineAppConfig` by hand. It also sets `channel` on the `preview` and
  `production` profiles in `eas.json` [E46].
- A binary receives only updates whose runtime version, platform and channel
  match [E14]. Anything that changes native code or app config (a new
  permission string, a new native module) needs a new store build [E53].
- Publish with `eas update --channel production --message "…"`.
- Suggested first policy: `runtimeVersion: { policy: 'appVersion' }` and bump
  `version` whenever a native dependency changes. The alternative policies were
  not compared — **UNVERIFIED** which is best for us.

### EAS Submit

| Store       | Requirements                                                                                                                                                                                                                                                                      | Source |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Google Play | Play Console account; the app created in the console; a **Google service account key** uploaded to EAS; `android.package` set; an `.aab`. First run of `eas submit` creates a release on the internal testing track; the listing stays a draft until store-listing tasks are done | [E44]  |
| App Store   | Paid Apple Developer account; `ios.bundleIdentifier`; `eas submit -p ios` asks for the Apple ID once and uploads to App Store Connect; the build appears in TestFlight after 10–15 minutes; release is submitted for review from App Store Connect                                | [E45]  |

### Accounts the owner must hold

| Account                     | Cost                            | Notes                                                                                                                                                                                                                                                                                                                                                                                                                  | Source    |
| --------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Expo                        | Free to start                   | Owns the four EAS projects                                                                                                                                                                                                                                                                                                                                                                                             | [E42]     |
| Apple Developer Program     | **US$99 per membership year**   | Required for device builds, push, TestFlight, App Store. Enrolment as individual or organisation. An organisation must be a legal entity (no trade names or DBAs, and its name is shown as the seller), have a **D-U-N-S number**, a public working website on its own domain, and a work e-mail on that domain; the enroller needs legal authority to sign for it and an Apple Account with two-factor authentication | [A3] [A5] |
| Google Play Console         | **US$25 once**                  | Government ID and a credit card in the legal name may be required                                                                                                                                                                                                                                                                                                                                                      | [G6]      |
| — personal Play account     |                                 | Created after 13 Nov 2023: **12 testers opted in for 14 consecutive days** in a closed test before production access                                                                                                                                                                                                                                                                                                   | [G5]      |
| — organisation Play account |                                 | "To create a developer account for an organization, you must provide a D-U-N-S number." (free from Dun & Bradstreet)                                                                                                                                                                                                                                                                                                   | [G8]      |
| Firebase (Google Cloud)     | Free for FCM                    | One project; register every Android package (12 with three variants per app)                                                                                                                                                                                                                                                                                                                                           | [E28]     |
| Supabase                    | Decision pending in `STATUS.md` | Add app schemes and hosts to the Auth redirect allow-list                                                                                                                                                                                                                                                                                                                                                              | [SB3]     |

Apple's organisation enrolment **does** require a D-U-N-S number, as Google's
does [A5] [G8]: both store accounts in the company's name wait on the legal
entity, its D-U-N-S number (free from Dun & Bradstreet) and, for Apple, a live
website and e-mail on the company's domain.

### Expo MCP tools available in this session

Found with a tool search for "Expo build simulator" and described in [E47].
None was run for this note.

| Group             | Tools                                                                                                                                  | What they do                                                                                                                                                                                     | Cost / precondition                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Docs              | `search_documentation`, `read_documentation`                                                                                           | Search and read docs.expo.dev                                                                                                                                                                    | The docs say search "requires an Expo Services paid plan"                                                     |
| Builds            | `build_run`, `build_list`, `build_info`, `build_logs`, `build_cancel`, `build_submit`                                                  | Start a build from a git ref and an `eas.json` profile (`platform`, `buildProfile`, `gitRef`, `baseDirectory` for monorepos, e.g. `apps/driver-native`); read status and logs; submit to a store | `build_run` "requires a GitHub repository to be connected to the project". Uses the build allowance or credit |
| Cloud simulators  | `simulator_start`, `simulator_get`, `simulator_list`, `simulator_stop`                                                                 | Start a "billed cloud simulator session" (iOS Simulator or Android Emulator), installing a `buildId`, an archive URL, or Expo Go; `openUrl` points a development build at a tunnelled dev server | Paid plan; billed; idle sessions stop after 10 minutes by default                                             |
| Device automation | `automation_tap`, `automation_type`, `automation_scroll`, `automation_find_view`, `automation_take_screenshot`                         | Drive the cloud device by `testID` or coordinates and take screenshots                                                                                                                           | Needs a running simulator session                                                                             |
| Workflows         | `workflow_run`, `workflow_list`, `workflow_info`, `workflow_logs`, `workflow_cancel`, `workflow_validate`                              | Run and inspect EAS Workflows (CI), including Maestro jobs                                                                                                                                       | CI minutes                                                                                                    |
| Sandboxes         | `sandbox_create`, `sandbox_exec`, `sandbox_read_file`, `sandbox_artifact_*`, `sandbox_stop`…                                           | A billable remote shell environment                                                                                                                                                              | Billed                                                                                                        |
| Budgets           | `usage_budget_create`, `usage_budget_get`                                                                                              | "Creates a usage budget with user-approved limits" to cap metered operations                                                                                                                     | —                                                                                                             |
| After launch      | `testflight_crashes`, `testflight_feedback`, `appstore_reviews`, `playstore_crashes`, `playstore_reviews`, `observe_*`, `sentry_issue` | Crash, review and performance data                                                                                                                                                               | Store accounts linked                                                                                         |

What this means in practice: once the owner has an Expo account on a paid plan
with this GitHub repository connected, an agent in this environment can build
an APK and an iOS simulator build, start cloud devices, tap through each app
with `testID`s and return screenshots. That closes most of the "could not be
verified here" gap that led to decision 4 — except camera scanning and anything
specific to physical devices. **Give every interactive element a `testID` from
the first screen.**

---

## 8. Store rules that change what we build

### Account deletion — both stores, all four apps

| Store  | Rule                                                                                                                                                                                                                                                                                                                                                                                                                | Source |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Apple  | "If your app supports account creation, you must also offer account deletion within the app." (5.1.1(v))                                                                                                                                                                                                                                                                                                            | [A1]   |
| Apple  | Must be _initiated_ in the app and easy to find; a link to a web page to finish is allowed; "only offering to temporarily deactivate or disable an account is insufficient"; requiring a phone call or e-mail is not allowed outside highly regulated industries; a manual process is acceptable if the person is told how long it takes and gets a confirmation; say what is kept when the law requires keeping it | [A2]   |
| Google | Apps that allow account creation must "provide users with an in-app path to delete their app accounts and associated data" **and** "a web link resource where users can request app account deletion and associated data deletion"; the link goes in the Data safety form; data may be retained "for legitimate reasons such as security, fraud prevention or regulatory compliance" if disclosed                   | [G1]   |

To build: a "Eliminar mi cuenta" screen in each app's account area; a database
function that anonymises the person while keeping what tax and consumer law
require (orders, invoices, ledger); a public web page per app for the same
request; a confirmation message. No such function exists today
(`supabase/migrations`, `packages/db/src/api.ts`). Driver and warehouse accounts
are created by staff, not in the app; whether that takes those two apps out of
scope of "supports account creation" is a judgement call — **UNVERIFIED**.
Google's FAQ counts an app as supporting account creation when it "directs the
user to an app account creation flow outside of the app" [G1], so an app that
sends people to the website to sign up is in scope even if it never shows a
sign-up form. The safe reading is to offer the same request path in all four.

### Sign-in

| Rule                                                                                                                                                               | Consequence                                                                                                                       | Source |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------ |
| "If your app doesn't include significant account-based features, let people use it without a login." (5.1.1(v))                                                    | The shop app must allow browsing, search and product pages signed out, asking for an account at checkout — as the website does    | [A1]   |
| 4.8 applies to apps "that use a third-party or social login service"; exempt when "your app exclusively uses your company's own account setup and sign-in systems" | With e-mail and password only, no Sign in with Apple is required. Adding Google or Facebook sign-in later triggers it             | [A1]   |
| 2.1: "include demo account info (and turn on your back-end service!) if your app includes a login"                                                                 | Review needs working demo accounts for a shopper, a seller, a driver with a route, and a warehouse worker, against a live backend | [A1]   |
| 4.2: more than "a repackaged website"                                                                                                                              | Do not ship the sites in a web view                                                                                               | [A1]   |

### Payments — physical goods are outside in-app purchase

| Store                     | Text                                                                                                                                                                                                                                                  | Source |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Apple 3.1.3(e)            | "If your app enables people to purchase physical goods or services that will be consumed outside of the app, you must use purchase methods other than in-app purchase to collect those payments, such as Apple Pay or traditional credit card entry." | [A1]   |
| Google Payments policy §3 | "Google Play's billing system must not be used" when payment is primarily "for the purchase or rental of physical goods (such as groceries, clothing, housewares, electronics)"                                                                       | [G2]   |

So SINPE Móvil, cards through the local gateway and cash on delivery are the
correct methods, and neither store takes a commission on orders. Seller fees
are charged for a physical service (fulfilment and delivery) and settled outside
the app; if a _digital_ seller subscription is ever sold inside the seller app,
revisit this — **UNVERIFIED** how the stores would classify it.

### Location (drivers' app)

| Rule                                                                                                                                                                                                                                                                                                               | Consequence                                                                                    | Source |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ------ |
| Apple 5.1.5: use location "only when it is directly relevant"; explain the purpose                                                                                                                                                                                                                                 | Purpose strings in Spanish that say why: tracking progress on the route while delivering       | [A1]   |
| Apple 2.5.4: background modes only for their intended purpose, location included                                                                                                                                                                                                                                   | The `location` background mode is justified by live route tracking; say so in the review notes | [A1]   |
| Google, Android 14+ targets: declare each foreground service type in Play Console (App content) with a description, the user impact if the task is deferred or interrupted, and **a video** of the user starting the feature; listed location use cases include "user-initiated location sharing" and "navigation" | Record a short video of a driver starting a route                                              | [G7]   |
| Google background location: only for a core feature; Permissions Declaration Form; a prominent in-app disclosure **before** the system prompt containing the word "location" and wording such as "even when the app is closed or not in use"; a video of 30 seconds or less; one feature evaluated at a time       | Applies if we request `ACCESS_BACKGROUND_LOCATION`                                             | [G3]   |
| Google: a foreground service "must be initiated as a continuation of an in-app, user-initiated action" and stop when the use case ends; if its access is equivalent to background location, the background rules apply, "subject to review"                                                                        | Start on "Iniciar ruta", stop on "Terminar ruta" and at sign-out                               | [G3]   |

Recommended design (see §4a): request "while using" only, start tracking from
the route screen, run it as a foreground service with a visible notification on
Android and with the status-bar indicator on iOS. Show our own explanation
screen before the system prompt regardless. This avoids the "Always" prompt on
iOS and the background-location declaration on Google Play, at the cost that
tracking stops if the driver force-closes the app.

The shop app may ask for location once to place the map pin for an address:
foreground only, with its own purpose string. The warehouse and seller apps
should not request location at all.

### Privacy declarations

| Item                            | What to do                                                                                                                                                                                                                                                                                                                                                                                                              | Source                                                 |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Privacy policy                  | A public URL in the store listing **and** a link inside each app; it must name what is collected, how, every use, retention and how to request deletion                                                                                                                                                                                                                                                                 | Apple 5.1.1(i) [A1]                                    |
| Consent and purpose strings     | "Ensure your purpose strings clearly and completely describe your use of the data." Expo's defaults ("Allow $(PRODUCT_NAME) to access your camera") are placeholders and can get an app rejected                                                                                                                                                                                                                        | [A1] [E53]                                             |
| Apple privacy manifest          | Since 1 May 2024 approved reasons are required for "required reason" APIs, third-party SDKs included. Expo SDK packages ship their own `PrivacyInfo.xcprivacy`, but Apple does not always read them from static pods: copy the reasons into `expo.ios.privacyManifests` (for example `NSPrivacyAccessedAPICategoryUserDefaults` with reason `CA92.1`). Apple e-mails within minutes of an upload if a reason is missing | [E52] [A4]                                             |
| Apple privacy "nutrition label" | Answered in App Store Connect per app                                                                                                                                                                                                                                                                                                                                                                                   | App Store Connect process; details **UNVERIFIED** here |
| Google Data safety form         | Required for every app; includes the data-deletion questions and the deletion web link                                                                                                                                                                                                                                                                                                                                  | [G1]                                                   |
| Permissions on Android          | Block what libraries add and we do not use, with `android.blockedPermissions` (for example `android.permission.RECORD_AUDIO`)                                                                                                                                                                                                                                                                                           | [E53]                                                  |

Data to declare, by app: account data (name, e-mail, phone, address) and
purchase history (shop); precise location (drivers continuously during a
route; shop once for the address pin); photos (seller listings; any delivery
photos); device push token (all); business and tax identifiers (seller).

### Operating-system and SDK levels

| Requirement                                                      | Value                                 | SDK 58                           | Source     |
| ---------------------------------------------------------------- | ------------------------------------- | -------------------------------- | ---------- |
| Google Play target API, new apps and updates (since 31 Aug 2026) | Android 16, API 36                    | targets 36 ✓                     | [G4] [E5]  |
| Apple build toolchain (since 28 Apr 2026)                        | Xcode 26 or later with the iOS 26 SDK | EAS `sdk-58` image: Xcode 27.1 ✓ | [A4] [E16] |
| Minimum OS we can support                                        | —                                     | Android 7 (API 24), iOS 16.4     | [E5]       |

Google raises the target level every year, so the apps must move to a new Expo
SDK at least yearly to keep shipping updates.

---

## Recommended stack

Versions are what `expo@58.0.26` pins [N2] or, for packages Expo does not pin,
the current npm version [N1]. Install Expo-pinned packages with
`pnpm expo install`.

| Package                                             | Version          | Purpose                                                        | Apps                                |
| --------------------------------------------------- | ---------------- | -------------------------------------------------------------- | ----------------------------------- |
| `expo`                                              | ~58.0.26         | SDK, CLI, Metro config                                         | all                                 |
| `react` / `react-dom`                               | 19.3.0           | UI runtime (exact pin)                                         | all                                 |
| `react-native`                                      | 0.88.1           | Native runtime                                                 | all                                 |
| `expo-router`                                       | ~58.0.32         | File-based routing, protected routes                           | all                                 |
| `@expo/metro-runtime`                               | ~58.0.17         | **Required** Router peer (not only for web)                    | all                                 |
| `@expo/log-box`                                     | ^58.0.15         | **Required** Router peer (the version `expo` depends on)       | all                                 |
| `react-native-screens`                              | ~4.30.1          | Router peer                                                    | all                                 |
| `react-native-safe-area-context`                    | ~5.11.1          | Router peer                                                    | all                                 |
| `react-native-gesture-handler`                      | ~3.3.0           | Router optional peer (in the template)                         | all                                 |
| `react-native-reanimated` / `react-native-worklets` | 4.7.1 / 0.13.0   | Router optional peer (in the template)                         | all                                 |
| `expo-constants`                                    | ~58.0.16         | Config at runtime, EAS project id                              | all                                 |
| `expo-linking`                                      | ~58.0.17         | Deep links                                                     | all                                 |
| `expo-splash-screen`                                | ~58.0.14         | Hold splash until the session loads                            | all                                 |
| `expo-status-bar`                                   | ~58.0.5          | Status bar                                                     | all                                 |
| `expo-font`                                         | ~58.0.12         | Embed Inter and Bricolage Grotesque                            | all                                 |
| `@expo-google-fonts/inter`                          | 0.4.2            | Static Inter TTFs                                              | all                                 |
| `@expo-google-fonts/bricolage-grotesque`            | 0.4.1            | Static Bricolage Grotesque TTFs                                | all                                 |
| `expo-image`                                        | ~58.0.18         | Cached product images                                          | shop, seller                        |
| `react-native-svg`                                  | 15.16.0          | Logo and icons                                                 | all                                 |
| `@supabase/supabase-js`                             | 2.119.2          | Auth, RPC, storage (same as web)                               | all                                 |
| `expo-secure-store`                                 | ~58.0.3          | Holds the session, in pieces (§3)                              | all                                 |
| `@react-native-async-storage/async-storage`         | 2.2.0            | App state, query cache, queue (never the session)              | all                                 |
| `expo-crypto`                                       | ~58.0.8          | UUIDs for idempotency keys (asks the OS; its AES API unused)   | shop                                |
| ~~`aes-js` (+ `@types/aes-js`)~~ removed, see §3    | 3.1.2 (3.1.4)    | ~~Session encryption~~ (the session is in SecureStore alone)   | none                                |
| `@tanstack/react-query`                             | 5.108.2          | Data fetching and mutation queue                               | all                                 |
| `@tanstack/react-query-persist-client`              | 5.108.2          | Persist cache and paused mutations                             | driver, warehouse (others optional) |
| `@tanstack/query-async-storage-persister`           | 5.108.2          | Persister                                                      | driver, warehouse                   |
| `expo-network`                                      | ~58.0.5          | Online/offline signal                                          | all                                 |
| `expo-location`                                     | ~58.0.22         | Position, route tracking                                       | driver; shop (address pin)          |
| `expo-task-manager`                                 | ~58.0.14         | Background location task                                       | driver                              |
| `expo-camera`                                       | ~58.0.14         | Barcode scanning                                               | warehouse, driver, seller           |
| `expo-image-picker`                                 | ~58.0.10         | Photos                                                         | seller; driver if delivery photos   |
| `expo-file-system`                                  | ~58.0.14         | Read photo bytes for upload (already a dependency of `expo`)   | seller, driver                      |
| `expo-image-manipulator`                            | ~58.0.16         | Resize before upload                                           | seller                              |
| `expo-notifications`                                | ~58.1.9          | Push                                                           | all                                 |
| `expo-device`                                       | ~58.0.5          | Device facts for push registration                             | all                                 |
| `expo-updates`                                      | ~58.0.22         | Over-the-air updates                                           | all                                 |
| `expo-build-properties`                             | ~58.0.12         | Cleartext HTTP in the development variant                      | all (dev)                           |
| `expo-dev-client`                                   | ~58.0.21         | Development builds                                             | all (dev)                           |
| `react-native-web` / `react-dom`                    | ~0.21.4 / 19.3.0 | Web export for browser tests (`@expo/metro-runtime` above)     | all (test)                          |
| `jest-expo`                                         | ~58.0.15         | Jest preset                                                    | dev                                 |
| `jest` / `@types/jest`                              | 30.5.2 / 30.0.0  | Test runner                                                    | dev                                 |
| `@react-native/jest-preset`                         | 0.88.1           | Peer of `jest-expo`                                            | dev                                 |
| `@testing-library/react-native`                     | 14.1.0           | Component tests                                                | dev                                 |
| `test-renderer`                                     | 1.3.1            | Required peer of `@testing-library/react-native` 14 (`^1.0.0`) | dev                                 |
| `tsx`                                               | 4.23.15          | Lets `app.config.ts` import workspace TypeScript               | dev                                 |
| `@types/react`                                      | ~19.3.0          | Types                                                          | dev                                 |
| `typescript`                                        | 5.9.3 (repo)     | Template uses ~6.0.3; see §0                                   | dev                                 |
| `eas-cli`                                           | 27.11.0          | Builds, credentials, submit, update (`pnpm dlx` or global)     | tool                                |
| `expo-doctor`                                       | 1.21.8           | Health check (`pnpm dlx expo-doctor`)                          | tool                                |

Deliberately left out: NativeWind (§5), `react-native-url-polyfill` (not needed
[E18]), `react-native-get-random-values` (replaced by `expo-crypto`),
`@react-native-community/netinfo` (`expo-network` covers it), `expo-sqlite`
(only needed for storage option B), `expo-auth-session` / `expo-web-browser`
(only for OAuth), `expo-background-task` (periodic jobs, not continuous
tracking), map libraries (`react-native-maps` 1.29.11 / `expo-maps` ~58.0.11 —
not researched; needed only if the apps draw maps instead of opening Waze or
Google Maps as the web app does).

---

## Decisions needed from the owner

1. **Accounts and money.** Open an Expo account, the Apple Developer Program
   (US$99 a year) and Google Play Console (US$25 once). Decide whether the
   stores list a person or the company: an organisation account on **both**
   stores needs a D-U-N-S number (Apple also needs a live website and work
   e-mail on the company's own domain), a personal Google account needs 12
   testers for 14 days before production.
2. **Expo plan.** Free gives 30 low-priority builds a month for all four apps
   together and no cloud simulators. Starter (US$19 a month) is the minimum for
   an agent to run the apps on cloud devices from here; simulator time is
   US$0.10 a minute beyond 60 included minutes a month (until 2027). Free also stops being
   allowed above US$1,500 of monthly revenue.
3. **Four apps or three.** Separate driver and warehouse apps (as `brand.ts`
   names them) keep the location review to one small app, but mean four
   listings, four reviews and four sets of credentials. One combined "field"
   app, like `apps/field` today, would be three.
4. **Order of work.** The drivers' app is where native features pay off most
   (tracking, offline, push). The shop app has the largest review surface
   (browsing without sign-in, account deletion, payments). Which first?
5. **Identifiers.** Decided by the owner on 21 November 2026:
   `com.yuntera.shop`, `com.yuntera.vende`, `com.yuntera.ruta` and
   `com.yuntera.bodega`. Identifiers cannot be changed after the first upload,
   and they assume the name survives the trademark search.
6. **Domains.** Universal links need the real hosts serving the association
   files. Until a domain is bought, links into the apps use custom schemes only.
7. **Driver tracking model.** Recommended: "while using" permission with
   tracking started from the route screen (no "Always" prompt, simpler review;
   stops if the app is force-closed). The alternative, full background
   permission, survives more but needs Google's background-location approval
   and a harder permission conversation with drivers. Also confirm how often a
   position is recorded and for how long positions are kept.
8. **Offline deliveries.** May a driver record a delivery without signal, to be
   confirmed when signal returns? The customer's code is checked on the server
   and is never shown to the driver, so an offline delivery cannot be validated
   at the door.
9. **Session storage.** Encrypted (recommended; adds an AES library, which may
   change the answer to Apple's export-compliance question — to confirm with
   whoever files it) or Expo's simpler unencrypted store. (Decided: neither;
   the session is kept in SecureStore alone, with no AES library, see §3.)
10. **Account deletion policy.** What is erased, what is kept and for how long
    (invoices, ledger, order history), and how long a request takes. Needs the
    lawyer and accountant already mentioned in `STATUS.md`; both stores require
    the feature at first submission.
11. **Minimum phones.** SDK 58 supports Android 7+ and iOS 16.4+. Is that
    acceptable for drivers' and warehouse phones, or will the company supply
    devices?
12. **Review accounts.** Apple and Google reviewers need working demo sign-ins
    for each role against a live backend, which depends on the pending decision
    about where the database lives.
13. **Photos at delivery.** Whether drivers photograph a delivery decides if the
    drivers' app needs camera and photo permissions beyond scanning.

---

## Not verified — summary

- That `expo export` and `tsc` pass in this repository with pnpm 10 isolated
  installs, raw-TypeScript workspace packages and TypeScript 5.9.3 (nothing was
  installed).
- `String.prototype.normalize("NFD")` on Hermes (used by `packages/core` search).
- React 19.3.1 with React Native 0.88.1 (not recommended anyway).
- `expo prebuild` on Linux for both platforms.
- Barcode detection in the web export under headless Chromium.
- Inter and Bricolage Grotesque variable files' named instances on iOS.
- Whether the connected Expo account is on a paid plan.
- Whether `aes-js` changes Apple's export-compliance answer. (Moot: `aes-js` was removed, see §3.)
- Whether staff-created driver and warehouse accounts fall under the stores'
  account-deletion rules.
- Idempotency of the driver and warehouse database functions under retry.
- iOS handling of plain-HTTP requests to a LAN IP address in development builds
  (the template sets `NSAllowsLocalNetworking`; its coverage of IP addresses is
  unconfirmed).
- Whether leaving the "Always" location strings out (`false`) instead of
  giving them in Spanish draws an App Store Connect upload warning; the note
  gives them in Spanish to avoid the question.
- Which `runtimeVersion` policy suits us; Uniwind's maturity; map libraries.

---

## Sources

All opened on 21 November 2026. Expo pages were read as Markdown (`<url>.md`)
or through the Expo documentation tools.

### Expo documentation

- [E1] https://docs.expo.dev/guides/monorepos/
- [E2] https://docs.expo.dev/modules/autolinking/
- [E3] https://docs.expo.dev/guides/customizing-metro/
- [E4] https://docs.expo.dev/versions/latest/config/metro/
- [E5] https://docs.expo.dev/versions/latest/ (SDK ↔ React Native table; Android and iOS support table)
- [E6] https://docs.expo.dev/router/advanced/protected/
- [E7] https://docs.expo.dev/router/advanced/authentication/
- [E8] https://docs.expo.dev/router/reference/typed-routes/
- [E9] https://docs.expo.dev/router/advanced/native-intent/
- [E10] https://docs.expo.dev/workflow/configuration/
- [E11] https://docs.expo.dev/guides/typescript/
- [E12] https://docs.expo.dev/build-reference/variants/
- [E13] https://docs.expo.dev/build/eas-json/
- [E14] https://docs.expo.dev/eas/json/
- [E15] https://docs.expo.dev/build-reference/build-with-monorepos/
- [E16] https://docs.expo.dev/build-reference/infrastructure/ and https://docs.expo.dev/build/introduction/
- [E17] https://docs.expo.dev/build/internal-distribution/
- [E18] https://docs.expo.dev/guides/using-supabase/
- [E19] https://docs.expo.dev/versions/latest/sdk/securestore/
- [E20] https://docs.expo.dev/versions/latest/sdk/location/
- [E21] https://docs.expo.dev/versions/latest/sdk/task-manager/
- [E22] https://docs.expo.dev/versions/latest/sdk/camera/
- [E23] https://docs.expo.dev/versions/latest/sdk/imagepicker/
- [E24] https://docs.expo.dev/versions/latest/sdk/filesystem/
- [E25] https://docs.expo.dev/versions/latest/sdk/notifications/
- [E26] https://docs.expo.dev/push-notifications/push-notifications-setup/
- [E27] https://docs.expo.dev/push-notifications/sending-notifications/
- [E28] https://docs.expo.dev/push-notifications/fcm-credentials/
- [E29] https://docs.expo.dev/linking/ios-universal-links/
- [E30] https://docs.expo.dev/linking/android-app-links/
- [E31] https://docs.expo.dev/versions/latest/sdk/network/
- [E32] https://docs.expo.dev/versions/latest/sdk/netinfo/
- [E33] https://docs.expo.dev/develop/user-interface/fonts/
- [E34] https://docs.expo.dev/versions/latest/sdk/font/
- [E35] https://docs.expo.dev/more/expo-cli/
- [E36] https://docs.expo.dev/develop/tools/
- [E37] https://docs.expo.dev/develop/unit-testing/
- [E38] https://docs.expo.dev/versions/latest/config/package-json/
- [E39] https://docs.expo.dev/workflow/web/ and https://docs.expo.dev/guides/publishing-websites/
- [E40] https://docs.expo.dev/billing/plans/
- [E41] https://docs.expo.dev/billing/usage-based-pricing/
- [E42] https://expo.dev/pricing
- [E43] https://expo.dev/acceptable-use
- [E44] https://docs.expo.dev/submit/android/
- [E45] https://docs.expo.dev/submit/ios/
- [E46] https://docs.expo.dev/eas-update/getting-started/
- [E47] https://docs.expo.dev/mcp/
- [E48] https://docs.expo.dev/eas/simulators/introduction/
- [E49] https://docs.expo.dev/eas/simulators/limitations/
- [E50] https://docs.expo.dev/eas/simulators/reference/usage-and-billing/
- [E51] https://docs.expo.dev/eas/simulators/how-to/work-without-a-mac/
- [E52] https://docs.expo.dev/guides/apple-privacy/
- [E53] https://docs.expo.dev/guides/permissions/
- [E54] https://docs.expo.dev/versions/latest/sdk/build-properties/
- [E55] https://docs.expo.dev/versions/latest/sdk/sqlite/
- [E56] https://docs.expo.dev/guides/local-first/
- [E57] https://docs.expo.dev/eas/workflows/examples/e2e-tests/
- [E58] https://docs.expo.dev/versions/latest/sdk/crypto/
- [E-plat] Platform lines of https://docs.expo.dev/versions/latest/sdk/linking/ and https://docs.expo.dev/versions/latest/sdk/async-storage/

### npm registry and published package files

- [N1] `npm view <package> version | peerDependencies | dist-tags | time` against registry.npmjs.org for every package named in this note
- [N2] https://unpkg.com/expo@58.0.26/bundledNativeModules.json
- [N3] https://unpkg.com/react-native@0.88.1/package.json and `Libraries/Renderer/implementations/ReactFabric-prod.js` (line 11747: `version: "19.3.0"`) and `ReactFabric-dev.js`
- [N4] https://unpkg.com/@expo/cli@58.1.21/build/src/start/server/metro/createExpoAutolinkingResolver.js (lines 37-63)
- [N5] https://unpkg.com/expo-location@58.0.22/android/src/main/java/expo/modules/location/LocationModule.kt (lines 318-340), `ios/LocationModule.swift` (lines 255-272), `android/src/main/AndroidManifest.xml`
- [N6] https://unpkg.com/expo-template-default@58.0.35/ (`package.json`, `app.json`, `tsconfig.json`, `gitignore`, `src/app/_layout.tsx`)
- [N7] https://unpkg.com/expo@58.0.26/tsconfig.base.json
- [N8] https://unpkg.com/hermes-compiler@260318099.0.5/?meta (contains `hermesc/linux64-bin/hermesc`)
- [N9] https://unpkg.com/@tanstack/query-async-storage-persister@5.108.2/build/legacy/index.d.ts (`createAsyncStoragePersister({ storage, key, throttleTime })`)

### Supabase

- [SB1] https://supabase.com/docs/reference/javascript/initializing ("React Native options with Expo SecureStore")
- [SB2] https://supabase.com/docs/guides/getting-started/tutorials/with-expo-react-native
- [SB3] https://supabase.com/docs/guides/auth/native-mobile-deep-linking
- [SB4] https://supabase.com/docs/guides/auth/auth-email-templates
- Installed sources in this repository:
  `node_modules/.pnpm/@supabase+auth-js@2.119.2/node_modules/@supabase/auth-js/src/GoTrueClient.ts`
  (lines 461-475, 2479-2511, 2806, 5455-5519), `…/auth-js/src/lib/types.ts`
  (lines 85-171, 877-912),
  `node_modules/.pnpm/@supabase+supabase-js@2.119.2/node_modules/@supabase/supabase-js/src/SupabaseClient.ts`
  (lines 648-660),
  `node_modules/.pnpm/@supabase+storage-js@2.119.2/node_modules/@supabase/storage-js/src/packages/StorageFileApi.ts`
  (lines 215, 235-372)

### Other libraries

- [T1] https://tanstack.com/query/latest/docs/framework/react/react-native
- [T2] https://tanstack.com/query/latest/docs/framework/react/guides/mutations
- [NW1] https://www.nativewind.dev/docs/getting-started/installation
- [NW2] https://www.nativewind.dev/v5
- [H1] https://github.com/facebook/hermes/blob/main/doc/IntlAPIs.md
- [R19] https://github.com/facebook/react/releases/tag/v19.3.1

### Apple

- [A1] https://developer.apple.com/app-store/review/guidelines/ (2.1, 2.5.4, 3.1.3(e), 4.2, 4.8, 5.1.1, 5.1.5)
- [A2] https://developer.apple.com/support/offering-account-deletion-in-your-app/
- [A3] https://developer.apple.com/programs/whats-included/
- [A4] https://developer.apple.com/news/upcoming-requirements/
- [A5] https://developer.apple.com/programs/enroll/ (organisation requirements, D-U-N-S)

### Google Play

- [G1] https://support.google.com/googleplay/android-developer/answer/13327111 (account deletion)
- [G2] https://support.google.com/googleplay/android-developer/answer/9858738 (payments)
- [G3] https://support.google.com/googleplay/android-developer/answer/9799150 (background location)
- [G4] https://support.google.com/googleplay/android-developer/answer/11926878 (target API level)
- [G5] https://support.google.com/googleplay/android-developer/answer/14151465 (testing for new personal accounts)
- [G6] https://support.google.com/googleplay/android-developer/answer/6112435 (registration)
- [G7] https://support.google.com/googleplay/android-developer/answer/13392821 (foreground service types)
- [G8] https://support.google.com/googleplay/android-developer/answer/13634885 (account types)

### This repository

- `package.json`, `.npmrc`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`
- `packages/core/package.json`, `packages/core/src/index.ts`, `packages/core/src/promise.ts:224`, `packages/core/src/search.ts:21`
- `packages/db/package.json`, `packages/db/src/api.ts:18-35, 480, 510-511`
- `packages/brand/package.json`, `packages/brand/src/brand.ts:57-123`, `packages/brand/src/tokens.ts:123-158`
- `packages/next-kit/src/fonts.ts`
- `tools/dev-api/src/routes/auth.ts:94-183`, `apps/field/.env.example`
- `supabase/migrations/20261121080700_logistics.sql:74`, `supabase/migrations/20261121081100_fulfillment.sql:550-564`
- `docs/02-architecture/decisions.md` (decision 4), `STATUS.md`

---

## Corrections after fact-check

Fact-check of 21 November 2026. About 150 claims were re-checked against
primary sources: the published package files (`expo@58.0.26`
`bundledNativeModules.json` and `tsconfig.base.json`, `@expo/cli@58.1.21`,
`expo-location@58.0.22`, `expo-camera@58.0.14`, `expo-image-picker@58.0.10`,
`expo-notifications@58.1.9`, `@expo/config-plugins@58.0.13`,
`@expo/eas-json@27.11.0`, `eas-cli@27.11.0`, `expo-template-default@58.0.35`,
`expo-template-bare-minimum@58.0.35`, `react-native@0.88.1`,
`hermes-compiler@260318099.0.5`, TanStack Query 5.108.2), `npm view` for every
version and peer range in §0 and the recommended stack, the Expo documentation
pages [E1]–[E58] as Markdown, `expo.dev/pricing`, `expo.dev/acceptable-use`,
the installed Supabase client sources, Supabase's docs [SB1] [SB4], Apple's
pages [A1]–[A5] and Google Play's [G1]–[G8]. Every version pairing in §0 and in
the recommended stack matched `bundledNativeModules.json` and npm exactly, and
every re-checked claim not listed here was confirmed as written, including the
EAS `sdk-58` images (Android: Node 22.23.2, pnpm 11.27.0, Maestro 2.10.0; iOS:
Xcode 27.1, Node 22.23.3, pnpm 11.28.2, Maestro 2.11.0), the `pnpm` and `node`
keys in `eas.json`, the push API limits, the SecureStore wording, the sticky
dependency list, the Expo plan prices, and the store rules quoted in §8.

| #   | Where                                | What the note said                                                           | What is right                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Source                                                                                                                  |
| --- | ------------------------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | §2 `app.config.ts`, §4a              | Only `locationWhenInUsePermission` set for iOS                               | Every iOS string the plugin knows (`locationAlwaysAndWhenInUsePermission`, `locationAlwaysPermission`, `motionUsagePermission`, `locationFullAccuracyPermission`) is written with Expo's **English default** unless given or set to `false`, which App Review can reject. Example now gives them in Spanish and sets `motionUsagePermission: false`; plugin-key table completed (foreground service also adds `POST_NOTIFICATIONS`; background adds `RECEIVE_BOOT_COMPLETED`) | `expo-location@58.0.22` `plugin/build/withLocation.js`; `@expo/config-plugins@58.0.13` `build/ios/Permissions.js:37-51` |
| 2   | §4b                                  | Scanner-only app: set `recordAudioAndroid: false`                            | Also set `microphonePermission: false`, or iOS gets the English default `NSMicrophoneUsageDescription`                                                                                                                                                                                                                                                                                                                                                                        | `expo-camera@58.0.14` `plugin/build/withCamera.js:22-47`; [E22]                                                         |
| 3   | Recommended stack                    | `@expo/metro-runtime` listed for "all (test)" only; `@expo/log-box` absent   | Both are **required** (non-optional) peers of `expo-router@58.0.32` on every platform; listed for all apps                                                                                                                                                                                                                                                                                                                                                                    | `npm view expo-router@58.0.32 peerDependencies peerDependenciesMeta`                                                    |
| 4   | §6, stack                            | `@testing-library/react-native` 14.1.0 alone                                 | It has a required peer `test-renderer ^1.0.0` (1.3.1); added                                                                                                                                                                                                                                                                                                                                                                                                                  | `npm view @testing-library/react-native@14.1.0 peerDependencies`                                                        |
| 5   | §7 EAS Update                        | `eas update:configure` writes `runtimeVersion` and `updates.url`             | Only for static `app.json`; with `app.config.ts` it warns and prints the values to add by hand                                                                                                                                                                                                                                                                                                                                                                                | `eas-cli@27.11.0` `build/update/configure.js:162-163`; [E10] [E46]                                                      |
| 6   | §7 plans, decision 2                 | Expo Simulators per-minute price **UNVERIFIED**                              | US$0.10/minute on Starter and Production, 60 minutes a month included until 2027; sessions keep billing until stopped, idle limit or 115 minutes                                                                                                                                                                                                                                                                                                                              | [E42]; [E50]                                                                                                            |
| 7   | §7 accounts, bottom line, decision 1 | Whether Apple's organisation enrolment needs a D-U-N-S number **UNVERIFIED** | It does; also a legal entity (no DBAs), a public website on its own domain, a work e-mail on that domain, an enroller with signing authority and two-factor authentication                                                                                                                                                                                                                                                                                                    | [A5]                                                                                                                    |
| 8   | §2 `eas.json` table                  | `extends` "up to 5 levels"                                                   | A chain of at most 5 profiles: the resolver throws at depth 5                                                                                                                                                                                                                                                                                                                                                                                                                 | `@expo/eas-json@27.11.0` `build/build/resolver.js:15-17`                                                                |
| 9   | §3 local development                 | iOS plain-HTTP equivalent **UNVERIFIED**                                     | The SDK 58 template sets `NSAllowsLocalNetworking: true`; whether that covers a LAN IP address is still unverified                                                                                                                                                                                                                                                                                                                                                            | `expo-template-bare-minimum@58.0.35` `ios/*/Info.plist:29-35`                                                           |
| 10  | §4c                                  | Image picker microphone                                                      | `microphonePermission: false` also removes the iOS string, not only `RECORD_AUDIO`                                                                                                                                                                                                                                                                                                                                                                                            | `expo-image-picker@58.0.10` `plugin/build/withImagePicker.js:35-95`                                                     |
| 11  | §4d                                  | Notifications plugin keys                                                    | Also `largeIcon`, `mode`, `enableRemoteNotifications` (default `true`)                                                                                                                                                                                                                                                                                                                                                                                                        | `expo-notifications@58.1.9` `plugin/build/withNotifications.d.ts`                                                       |
| 12  | §8 location                          | Quote "must start as a continuation of a user-initiated in-app action"       | Verbatim: "must be initiated as a continuation of an in-app, user-initiated action"; meaning unchanged                                                                                                                                                                                                                                                                                                                                                                        | [G3]                                                                                                                    |
| 13  | §8 account deletion                  | Staff-created accounts: judgement call                                       | Still a judgement call, but Google counts an app that directs people to sign up outside it as supporting account creation                                                                                                                                                                                                                                                                                                                                                     | [G1] FAQ                                                                                                                |

Still unverified after this pass (each also marked in the text or in "Not
verified — summary"): everything that needs an install, build or device
(`expo export`, `tsc` with TypeScript 5.9.3, `expo prebuild` on Linux, Hermes
`String.prototype.normalize`, barcode detection in headless Chromium, variable
font named instances); `NSAllowsLocalNetworking` and LAN IP addresses; whether
`false` instead of Spanish "Always" strings triggers an upload warning; the
`aes-js` export-compliance answer; staff-created accounts and deletion rules;
idempotency of the driver and warehouse functions; the `runtimeVersion`
policy; Uniwind's maturity; map libraries; whether the connected Expo account
is on a paid plan. The 19.3.1 release notes [R19], the Supabase quotes [SB1]
[SB4] and the line references into this repository and the installed
`auth-js`, `supabase-js` and `storage-js` were re-opened and matched.
