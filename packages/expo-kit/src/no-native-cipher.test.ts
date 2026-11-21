import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The native apps declare to Apple that they use no non-exempt encryption
 * (`usesNonExemptEncryption: false` in config.ts). That stays true only while
 * they ship no cryptography of their own, so this fails if a cipher, hash,
 * key-derivation or other cryptography library is added to the kit, a native
 * app, or a workspace package they bundle.
 */

const ROOT = resolve(__dirname, "../../..");

/** Libraries named outright: ciphers, key derivation, signatures, crypto polyfills. */
const KNOWN = new Set([
  "aes-js",
  "@types/aes-js",
  "crypto-js",
  "@types/crypto-js",
  "tweetnacl",
  "tweetnacl-util",
  "libsodium",
  "libsodium-wrappers",
  "libsodium-wrappers-sumo",
  "react-native-libsodium",
  "sodium-native",
  "node-forge",
  "sjcl",
  "jsencrypt",
  "openpgp",
  "elliptic",
  "@noble/ciphers",
  "@noble/hashes",
  "@noble/curves",
  "@noble/secp256k1",
  "@noble/ed25519",
  "@stablelib/aes",
  "@stablelib/chacha20poly1305",
  "bcrypt",
  "bcryptjs",
  "scrypt-js",
  "pbkdf2",
  "argon2",
  "argon2-browser",
  "hash-wasm",
  "js-sha256",
  "js-sha3",
  "js-sha512",
  "jssha",
  "md5",
  "sha.js",
  "jose",
  "jsonwebtoken",
  "crypto-browserify",
  "react-native-crypto",
  "react-native-quick-crypto",
  "react-native-aes-crypto",
  "react-native-aes-gcm-crypto",
  "react-native-rsa-native",
  "react-native-simple-crypto",
  "react-native-get-random-values",
  "expo-standard-web-crypto",
  "isomorphic-webcrypto",
  "@peculiar/webcrypto",
]);

/** Words that mark a cryptography package whatever it is called. */
const WORDS =
  /^(crypto|crypt|cipher|ciphers|aes|rsa|ecdsa|ed25519|sodium|nacl|forge|noble|stablelib|pbkdf2|scrypt|argon2|bcrypt|sha256|sha512|hmac|webcrypto|openpgp|pgp|encrypt|encryption)$/;

/**
 * Allowed on purpose, because both only call the operating system.
 * expo-secure-store keeps values in the Keychain and Android Keystore.
 * expo-crypto is NOT cipher-free: since SDK 58 it includes an AES-GCM API
 * (`aesEncryptAsync`, `AESEncryptionKey`…) that wraps CryptoKit on iOS and
 * javax.crypto on Android. The apps may use only its random-number functions
 * (the shop's checkout takes a random identifier from it), which the source
 * check below enforces; encrypting data with it would make
 * `usesNonExemptEncryption: false` untrue.
 */
const ALLOWED = new Set(["expo-secure-store", "expo-crypto"]);

/** The only expo-crypto functions the apps may call: random numbers, not cryptography. */
const EXPO_CRYPTO_ALLOWED = new Set([
  "randomUUID",
  "getRandomBytes",
  "getRandomBytesAsync",
  "getRandomValues",
]);

function isCryptography(name: string): boolean {
  if (ALLOWED.has(name)) return false;
  if (KNOWN.has(name)) return true;
  return name
    .toLowerCase()
    .split(/[@/._-]+/)
    .some((word) => WORDS.test(word));
}

interface Manifest {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

const read = (dir: string): Manifest =>
  JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Manifest;

const allDeps = (m: Manifest) => ({
  ...m.dependencies,
  ...m.devDependencies,
  ...m.peerDependencies,
  ...m.optionalDependencies,
});

/** Every workspace package by name, to follow `workspace:*` links. */
function workspace(): Map<string, string> {
  const found = new Map<string, string>();
  for (const parent of ["apps", "packages"]) {
    for (const entry of readdirSync(join(ROOT, parent), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(ROOT, parent, entry.name);
      try {
        found.set(read(dir).name, dir);
      } catch {
        // not a package
      }
    }
  }
  return found;
}

/** The native apps and the kit, plus the workspace packages they pull in. */
function checkedPackages(): Map<string, Manifest> {
  const all = workspace();
  const start = [...all.entries()]
    .filter(([name, dir]) => dir.endsWith("-native") || name === "@yuntera/expo-kit")
    .map(([name]) => name);
  const seen = new Map<string, Manifest>();
  const queue = [...start];
  while (queue.length > 0) {
    const name = queue.shift() as string;
    const dir = all.get(name);
    if (!dir || seen.has(name)) continue;
    const manifest = read(dir);
    seen.set(name, manifest);
    for (const [dep, range] of Object.entries(allDeps(manifest))) {
      if (range.startsWith("workspace:")) queue.push(dep);
    }
  }
  return seen;
}

describe("no cryptography of our own in the native apps", () => {
  it("recognises the well-known libraries and leaves ordinary ones alone", () => {
    for (const name of [
      "aes-js",
      "crypto-js",
      "tweetnacl",
      "@noble/ciphers",
      "react-native-quick-crypto",
      "node-forge",
      "some-new-aes-library",
      "@acme/rsa-tools",
    ]) {
      expect(isCryptography(name), name).toBe(true);
    }
    for (const name of [
      "expo-secure-store",
      "expo-crypto",
      "expo-router",
      "@supabase/supabase-js",
      "react-native-safe-area-context",
      "universal-cookie",
      "zod",
    ]) {
      expect(isCryptography(name), name).toBe(false);
    }
  });

  it("covers the kit, the four apps and the workspace packages they bundle", () => {
    const names = [...checkedPackages().keys()];
    expect(names).toEqual(
      expect.arrayContaining([
        "@yuntera/expo-kit",
        "@yuntera/shop-native",
        "@yuntera/seller-native",
        "@yuntera/driver-native",
        "@yuntera/warehouse-native",
        "@yuntera/core",
        "@yuntera/db",
        "@yuntera/brand",
      ]),
    );
  });

  it("finds no cipher, hash or key-derivation library in their dependencies", () => {
    const found: string[] = [];
    for (const [pkg, manifest] of checkedPackages()) {
      for (const dep of Object.keys(allDeps(manifest))) {
        if (isCryptography(dep)) found.push(`${pkg} depends on ${dep}`);
      }
    }
    expect(
      found,
      [
        "A cryptography library was added to a native app or a package it bundles.",
        "The apps tell Apple they use no non-exempt encryption (ios.config.usesNonExemptEncryption:",
        "false in packages/expo-kit/src/config.ts), and shipping a cipher would make that untrue.",
        "Use the operating system instead: expo-secure-store for secrets on the phone, HTTPS for",
        "the network, a database function or a server-side function for anything else.",
        "If the app really needs its own encryption, change usesNonExemptEncryption, answer the",
        "export-compliance question with the owner, and update docs/02-architecture/decisions.md",
        "before allowing the library here.",
      ].join("\n"),
    ).toEqual([]);
  });
});

/** Source files of the native apps and the kit (tests excluded). */
function sources(): string[] {
  const roots = [
    join(ROOT, "packages/expo-kit/src"),
    ...readdirSync(join(ROOT, "apps"))
      .filter((name) => name.endsWith("-native"))
      .map((name) => join(ROOT, "apps", name, "src")),
  ];
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
        found.push(path);
    }
  };
  for (const root of roots) walk(root);
  return found;
}

/** What a source file uses of expo-crypto, as problems; empty when it uses only random numbers. */
function expoCryptoProblems(source: string): string[] {
  const problems: string[] = [];
  if (/require\(\s*["']expo-crypto["']\s*\)|import\(\s*["']expo-crypto["']\s*\)/.test(source))
    problems.push("loads expo-crypto with require() or import(), which cannot be checked");
  for (const match of source.matchAll(/import\s+([^;]*?)\s+from\s+["']expo-crypto["']/g)) {
    const clause = (match[1] ?? "").trim();
    const namespace = /^\*\s+as\s+([A-Za-z_$][\w$]*)$/.exec(clause);
    const named = /^(?:type\s+)?\{([^}]*)\}$/.exec(clause);
    if (namespace) {
      const alias = namespace[1] as string;
      const uses = [
        ...source.matchAll(new RegExp(`\\b${alias}\\b(\\s*\\.\\s*([A-Za-z_$][\\w$]*))?`, "g")),
      ];
      // The first match is the import itself.
      for (const use of uses.slice(1)) {
        const member = use[2];
        if (!member) problems.push(`passes the whole ${alias} module around`);
        else if (!EXPO_CRYPTO_ALLOWED.has(member)) problems.push(`calls ${alias}.${member}`);
      }
    } else if (named) {
      for (const part of (named[1] ?? "").split(",")) {
        const name = part
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)[0]
          ?.trim();
        if (name && !EXPO_CRYPTO_ALLOWED.has(name)) problems.push(`imports ${name}`);
      }
    } else {
      problems.push(`imports expo-crypto as "${clause}"`);
    }
  }
  if (
    /\bcrypto\s*\.\s*subtle\b|\.subtle\s*\.\s*(encrypt|decrypt|wrapKey|unwrapKey|deriveKey|deriveBits)\b/.test(
      source,
    )
  )
    problems.push("calls WebCrypto (crypto.subtle) directly");
  return problems;
}

describe("no cryptography in the apps' own code", () => {
  it("recognises what is allowed of expo-crypto and what is not", () => {
    expect(
      expoCryptoProblems('import * as Crypto from "expo-crypto";\nCrypto.randomUUID();'),
    ).toEqual([]);
    expect(expoCryptoProblems('import { randomUUID as uuid } from "expo-crypto";')).toEqual([]);
    expect(
      expoCryptoProblems('import * as C from "expo-crypto";\nC.aesEncryptAsync(t, k);'),
    ).toEqual(["calls C.aesEncryptAsync"]);
    expect(expoCryptoProblems('import { AESEncryptionKey } from "expo-crypto";')).toEqual([
      "imports AESEncryptionKey",
    ]);
    expect(expoCryptoProblems('import { digest, randomUUID } from "expo-crypto";')).toEqual([
      "imports digest",
    ]);
    expect(expoCryptoProblems('import Crypto from "expo-crypto";')).toHaveLength(1);
    expect(expoCryptoProblems('const C = require("expo-crypto");')).toHaveLength(1);
    expect(expoCryptoProblems('import * as C from "expo-crypto";\nuse(C);')).toHaveLength(1);
    expect(expoCryptoProblems("await crypto.subtle.encrypt(a, k, d);")).toHaveLength(1);
  });

  it("uses expo-crypto only for random numbers, and no WebCrypto of its own", () => {
    const files = sources();
    expect(files.length).toBeGreaterThan(20);
    const found: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const problem of expoCryptoProblems(source))
        found.push(`${file.slice(ROOT.length + 1)} ${problem}`);
    }
    expect(
      found,
      [
        "Native app code uses cryptography. expo-crypto is allowed only for random numbers",
        `(${[...EXPO_CRYPTO_ALLOWED].join(", ")}); its AES and digest functions, and WebCrypto,`,
        "would make usesNonExemptEncryption: false in packages/expo-kit/src/config.ts untrue.",
        "Keep secrets in expo-secure-store and let HTTPS protect the network instead; if the app",
        "really must encrypt, change the declaration and decisions.md §18 with the owner first.",
      ].join("\n"),
    ).toEqual([]);
  });
});

describe("the web export's session storage", () => {
  it("does not import expo-secure-store or the native adapter", () => {
    const source = readFileSync(join(__dirname, "supabase/session-storage.web.ts"), "utf8");
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(imports).not.toContain("expo-secure-store");
    expect(imports).not.toContain("./session-storage");
    // Its only import is the type, which the bundler erases.
    expect(source).toMatch(/import type \{ SessionStorage \} from "\.\/secure-session-storage";/);
    const module = readFileSync(join(__dirname, "supabase/secure-session-storage.ts"), "utf8");
    expect(module).not.toMatch(/^import /m);
  });
});
