import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The session lives only in the phone's secure store. client.ts is the one
 * Auth client that keeps a session, and it keeps it in `sessionStorage` (the
 * secure store); probe.ts checks a retyped password on a client that keeps
 * nothing. A third client, or a client given another storage, would put a
 * refresh token somewhere else (AsyncStorage is a plain file on the phone),
 * so this fails if any native source creates one, or reaches AsyncStorage
 * other than through the kit's `appStorage`.
 */

const ROOT = resolve(__dirname, "../../../..");

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

const CLIENT = "packages/expo-kit/src/supabase/client.ts";
const PROBE = "packages/expo-kit/src/supabase/probe.ts";
const APP_STORAGE = "packages/expo-kit/src/supabase/session-storage.ts";

/** Ways to make an Auth client that could hold a session. */
const MAKES_A_CLIENT =
  /\bcreateClient\s*\(|\bnew\s+(SupabaseClient|GoTrueClient|AuthClient)\b|@supabase\/(auth-js|gotrue-js)|require\(\s*["']@supabase\//;
const ASYNC_STORAGE = /@react-native-async-storage\/async-storage/;

/** What the lines of a file say about making clients and using AsyncStorage. */
function problemsOf(name: string, source: string): string[] {
  const problems: string[] = [];
  if (MAKES_A_CLIENT.test(source) && name !== CLIENT && name !== PROBE) {
    problems.push(`${name} makes an Auth client: only ${CLIENT} and ${PROBE} may`);
  }
  if (ASYNC_STORAGE.test(source) && name !== APP_STORAGE) {
    problems.push(`${name} uses AsyncStorage directly: use the kit's appStorage`);
  }
  const flat = source.replace(/\s+/g, " ");
  if (name === CLIENT) {
    const calls = flat.match(/createClient\(/g) ?? [];
    if (calls.length !== 1) problems.push(`${CLIENT} must make exactly one client`);
    if (!/auth: \{ storage: sessionStorage, persistSession: true,/.test(flat))
      problems.push(`${CLIENT} must keep the session in sessionStorage (the secure store)`);
  }
  if (name === PROBE) {
    const calls = flat.match(/createClient\(/g) ?? [];
    if (calls.length !== 1) problems.push(`${PROBE} must make exactly one client`);
    if (!/persistSession: false, autoRefreshToken: false,/.test(flat) || /\bstorage:/.test(flat))
      problems.push(`${PROBE} must keep nothing: no storage, no persisted or refreshed session`);
  }
  if (name === APP_STORAGE && /createClient|persistSession/.test(flat)) {
    problems.push(`${APP_STORAGE} must not make a client`);
  }
  return problems;
}

describe("where a session can be kept", () => {
  it("only the kit's client keeps one, in the secure store; the password check keeps none", () => {
    const files = sources();
    expect(files.length).toBeGreaterThan(20);
    const names = files.map((file) => relative(ROOT, file));
    expect(names).toContain(CLIENT);
    expect(names).toContain(PROBE);
    const found = files.flatMap((file) =>
      problemsOf(relative(ROOT, file), readFileSync(file, "utf8")),
    );
    expect(found).toEqual([]);
  });

  it("would catch a second client that persists the session, wherever it is added", () => {
    const planted = `import AsyncStorage from "@react-native-async-storage/async-storage";
      import { createClient } from "@supabase/supabase-js";
      export const other = createClient(u, k, { auth: { storage: AsyncStorage, persistSession: true } });`;
    expect(problemsOf("packages/expo-kit/src/supabase/zz-extra.ts", planted)).toHaveLength(2);
    expect(problemsOf("apps/shop-native/src/lib/extra.ts", planted)).toHaveLength(2);
    expect(
      problemsOf("apps/seller-native/src/lib/x.ts", 'const c = require("@supabase/supabase-js");'),
    ).toHaveLength(1);
  });

  it("would catch the kit's own clients changed to keep a session elsewhere", () => {
    const client = readFileSync(join(ROOT, CLIENT), "utf8");
    const probe = readFileSync(join(ROOT, PROBE), "utf8");
    expect(problemsOf(CLIENT, client)).toEqual([]);
    expect(problemsOf(PROBE, probe)).toEqual([]);
    expect(
      problemsOf(CLIENT, client.replace("storage: sessionStorage", "storage: appStorage")),
    ).toHaveLength(1);
    expect(
      problemsOf(PROBE, probe.replace("persistSession: false", "persistSession: true")),
    ).toHaveLength(1);
    expect(
      problemsOf(
        PROBE,
        probe.replace("persistSession: false,", "storage: appStorage, persistSession: false,"),
      ),
    ).toHaveLength(1);
    expect(problemsOf(CLIENT, `${client}\nexport const b = createClient(u, k);`)).toHaveLength(1);
  });
});
