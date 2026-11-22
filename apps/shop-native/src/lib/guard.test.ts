import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { needsSignIn } from "./guard";

const appDir = join(__dirname, "../app");

function screens(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? screens(path) : path.endsWith(".tsx") ? [path] : [];
  });
}

describe("screens for signed-in shoppers", () => {
  it("send a session halfway through the second step to /ingresar, as a signed-out one", () => {
    expect(needsSignIn("signedOut")).toBe(true);
    expect(needsSignIn("secondStep")).toBe(true);
    expect(needsSignIn("signedIn")).toBe(false);
    // The stored session is still being read: wait, do not send anyone away.
    expect(needsSignIn("loading")).toBe(false);
  });

  it("all use that guard, never a check for signedOut alone", () => {
    const guarded: string[] = [];
    for (const path of screens(appDir)) {
      const name = relative(appDir, path);
      const source = readFileSync(path, "utf8");
      // The sign-in screen itself decides what to ask for by status.
      if (name === "ingresar.tsx") continue;
      // A check for signedOut alone leaves a half-signed-in session on a
      // screen whose personal reads never start: a spinner forever.
      expect(source, name).not.toMatch(/status\s*===\s*"signedOut"/);
      if (/signInPath\(/.test(source)) {
        expect(source, name).toMatch(/needsSignIn\(status\)/);
        guarded.push(name);
      }
    }
    expect(guarded.sort()).toEqual(
      [
        "cuenta/contrasena.tsx",
        "cuenta/eliminar.tsx",
        "cuenta/notificaciones.tsx",
        "direcciones/nueva.tsx",
        "pagar.tsx",
        "pedidos/[numero].tsx",
        "pedidos/index.tsx",
      ].sort(),
    );
  });
});
