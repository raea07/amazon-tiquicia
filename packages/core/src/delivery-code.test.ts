import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LOCKED_CODE_MESSAGE } from "./delivery-code";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

describe("the locked delivery code", () => {
  it("tells the driver what to do, not only to call", () => {
    expect(LOCKED_CODE_MESSAGE).toContain("No entregue el paquete");
    expect(LOCKED_CODE_MESSAGE).toContain("código nuevo");
    expect(LOCKED_CODE_MESSAGE).toContain("no entregado");
  });

  it("is the same text in the web field app and the drivers' app", () => {
    const page = read("../../../apps/field/src/app/ruta/[parada]/page.tsx");
    const actions = read("../../../apps/field/src/app/actions.ts");
    const native = read("../../../apps/driver-native/src/lib/route.ts");
    for (const source of [page, actions, native]) {
      expect(source).toContain("LOCKED_CODE_MESSAGE");
      expect(source).not.toContain("Código bloqueado por demasiados intentos. Llame a Central.");
    }
    expect(native).toContain('from "@yuntera/core"');
  });
});
