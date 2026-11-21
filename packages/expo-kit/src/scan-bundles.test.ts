import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanDirs, scanText } from "../scripts/scan-bundles.mjs";

/**
 * The bundle scan (scripts/scan-bundles.mjs) runs on every export in
 * tools/dev/stack.sh native and in CI. These check that it recognises the
 * cipher implementations it is there to catch, wherever they came from, and
 * leaves the operating system's own cryptography alone.
 */

describe("bundle scan: what it finds", () => {
  const caught: Array<[string, string]> = [
    ["aes-js", "var e={AES:c,Counter:u,ModeOfOperation:{ecb:h,cbc:f,cfb:d,ofb:p,ctr:g}};"],
    ["the aes-js name", '/* aes-js v3.1.2 */ module.exports = require("aes-js");'],
    [
      "an AES S-box, minified",
      "var S=[99,124,119,123,242,107,111,197,48,1,103,43,254,215,171,118];",
    ],
    ["an AES S-box, as written", "const S = [0x63, 0x7c, 0x77, 0x7b,\n  0xf2, 0x6b, 0x6f, 0xc5];"],
    ["crypto-js", "var CryptoJS=CryptoJS||function(u,p){};CryptoJS.AES.encrypt(m,k)"],
    ["tweetnacl", "nacl.lowlevel.crypto_secretbox=crypto_secretbox;"],
    ["libsodium", "sodium_init();t.crypto_aead_xchacha20poly1305_ietf_encrypt(m)"],
    ["node-forge", "var c=forge.cipher.createCipher('AES-CBC',k);"],
    ["a Node crypto polyfill", "exports.createCipheriv=function(){};"],
    ["@noble/ciphers", "export const xchacha20poly1305 = wrap(...)"],
    ["a pure SHA-256", "var H=[1779033703,3144134277,1013904242,2773480762];"],
  ];
  for (const [label, text] of caught) {
    it(`finds ${label}`, () => {
      expect(scanText(text)).not.toEqual([]);
    });
  }
});

describe("bundle scan: what it leaves alone", () => {
  const fine: Array<[string, string]> = [
    [
      "auth-js asking WebCrypto for the PKCE challenge",
      'const h=await crypto.subtle.digest("SHA-256",e);const s="sha256";',
    ],
    [
      "expo-crypto's wrappers around the operating system",
      "class AESEncryptionKey extends n.EncryptionKey{};var AESKeySize={AES128:16};" +
        'requireNativeModule("ExpoCrypto").randomUUID();',
    ],
    ["expo-secure-store", 'requireNativeModule("ExpoSecureStore").getValueWithKeyAsync(k,o)'],
    [
      "ordinary code",
      "function forgetCallback(){} const description='Encryption at rest is the platform\\'s';",
    ],
  ];
  for (const [label, text] of fine) {
    it(`does not flag ${label}`, () => {
      expect(scanText(text)).toEqual([]);
    });
  }
});

describe("bundle scan: export directories", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("reads JavaScript and Hermes bundles in nested folders", () => {
    const dir = mkdtempSync(join(tmpdir(), "scan-bundles-"));
    dirs.push(dir);
    mkdirSync(join(dir, "_expo", "static", "js", "ios"), { recursive: true });
    writeFileSync(join(dir, "_expo", "static", "js", "ios", "clean.js"), "console.log(1)");
    // A Hermes bundle: binary, with the identifier in its string table.
    const hbc = Buffer.concat([
      Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0x00, 0xff]),
      Buffer.from("ModeOfOperation", "latin1"),
      Buffer.from([0x00, 0x80, 0xfe]),
    ]);
    writeFileSync(join(dir, "_expo", "static", "js", "ios", "entry.hbc"), hbc);
    writeFileSync(join(dir, "metadata.json"), '{"ModeOfOperation":1}'); // not a bundle

    const result = scanDirs([dir]);
    expect(result.files).toBe(2);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.file).toMatch(/entry\.hbc$/);
  });
});
