#!/usr/bin/env node
/**
 * Searches exported app bundles for the marks of a JavaScript cipher or hash
 * implementation, whatever package brought it in.
 *
 *   node packages/expo-kit/scripts/scan-bundles.mjs <export dir>…
 *
 * The native apps declare to Apple that they use no non-exempt encryption
 * (`usesNonExemptEncryption: false`, packages/expo-kit/src/config.ts). The
 * guard test `src/no-native-cipher.test.ts` checks the packages the apps name
 * directly; this checks what actually ends up in the bundles, so a library
 * pulled in by a dependency of a dependency is caught too. It reads `.js`
 * bundles (web export, or `expo export --no-bytecode`) and Hermes `.hbc`
 * bundles (whose string table keeps identifiers and property names as text).
 *
 * The operating system's own cryptography is not flagged: WebCrypto
 * (`crypto.subtle`, which auth-js uses for the PKCE challenge), expo-crypto's
 * wrappers around CryptoKit / javax.crypto, and expo-secure-store.
 *
 * Exit status 1 and a list of findings when something is found.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Text that only a cipher or hash implementation carries. Each is specific
 * enough not to appear in ordinary code: names that libraries export, and the
 * constant tables an implementation cannot do without.
 * @type {ReadonlyArray<{ name: string, test: RegExp }>}
 */
export const SIGNATURES = [
  { name: "aes-js (ModeOfOperation)", test: /ModeOfOperation/ },
  { name: "aes-js (package name)", test: /\baes-?js\b/ },
  { name: "crypto-js", test: /\bCryptoJS\b/ },
  { name: "tweetnacl / libsodium (secretbox)", test: /crypto_secretbox/ },
  { name: "libsodium", test: /\bsodium_init\b|crypto_aead_/ },
  { name: "sjcl", test: /\bsjcl\b/ },
  { name: "node-forge", test: /\bforge\.(cipher|pki|aes|md)\b/ },
  { name: "Node crypto API polyfill", test: /\bcreateCipheriv\b|\bcreateDecipheriv\b/ },
  { name: "ChaCha20 / XSalsa20", test: /\b(x?chacha20|xsalsa20)(poly1305)?\b/i },
  { name: "PBKDF2 / scrypt / argon2 implementation", test: /\b(pbkdf2Sync|scryptSync|argon2id)\b/ },
  // The AES S-box as a minified array (decimal) or as written (hex).
  { name: "AES S-box", test: /99,124,119,123,242,107,111,197/ },
  { name: "AES S-box (hex)", test: /0x63,0x7c,0x77,0x7b,0xf2,0x6b/i },
  // SHA-256's first initial hash value (0x6a09e667), in decimal and hex.
  { name: "SHA-256 constants", test: /\b1779033703\b|0x6a09e667/i },
];

/**
 * The findings in one bundle's text.
 * @param {string} text
 * @returns {string[]}
 */
export function scanText(text) {
  const compact = text.replace(/\s+/g, "");
  return SIGNATURES.filter(({ test }) => test.test(text) || test.test(compact)).map(
    ({ name }) => name,
  );
}

/**
 * Every bundle under the given directories.
 * @param {string} dir
 * @returns {string[]}
 */
function bundles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...bundles(path));
    else if (/\.(js|hbc)$/.test(entry.name)) found.push(path);
  }
  return found;
}

/**
 * Scans export directories.
 * @param {string[]} dirs
 * @returns {{ files: number, findings: Array<{ file: string, found: string[] }> }}
 */
export function scanDirs(dirs) {
  let files = 0;
  const findings = [];
  for (const dir of dirs) {
    if (!statSync(dir).isDirectory()) throw new Error(`Not a directory: ${dir}`);
    for (const file of bundles(dir)) {
      files++;
      // latin1 keeps every byte, so text inside a Hermes bundle stays findable.
      const found = scanText(readFileSync(file, "latin1"));
      if (found.length > 0) findings.push({ file, found });
    }
  }
  return { files, findings };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dirs = process.argv.slice(2);
  if (dirs.length === 0) {
    console.error("Usage: scan-bundles.mjs <export dir>…");
    process.exit(2);
  }
  const { files, findings } = scanDirs(dirs);
  if (files === 0) {
    console.error(`No bundle found under ${dirs.join(", ")}.`);
    process.exit(2);
  }
  if (findings.length > 0) {
    for (const { file, found } of findings)
      console.error(`${relative(process.cwd(), file)}: ${found.join(", ")}`);
    console.error(
      [
        "",
        "A cipher or hash implementation is in the app bundle. The apps tell Apple they use no",
        "non-exempt encryption (usesNonExemptEncryption: false in packages/expo-kit/src/config.ts).",
        "Find the package that brought it in (pnpm why <name>) and use the operating system",
        "instead: expo-secure-store for secrets on the phone, HTTPS for the network. See",
        "docs/02-architecture/decisions.md §18.",
      ].join("\n"),
    );
    process.exit(1);
  }
  console.log(`No cipher or hash implementation in ${files} bundle file(s).`);
}
