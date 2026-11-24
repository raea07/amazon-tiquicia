import { describe, expect, it } from "vitest";
import { endSentence } from "./sentence";

const time = (iso: string) =>
  new Intl.DateTimeFormat("es-CR", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Costa_Rica",
  }).format(new Date(iso));

describe("endSentence", () => {
  it("adds one full stop after a time that already ends with one", () => {
    const morning = time("2026-11-24T06:32:00Z");
    const afternoon = time("2026-11-24T21:05:00Z");
    expect(morning.endsWith(".")).toBe(true);
    expect(endSentence(`Completado el ${morning}`)).toBe(`Completado el ${morning}`);
    expect(endSentence(`Completado el ${afternoon}`)).not.toMatch(/\.\.$/);
  });

  it("adds a full stop where there is none", () => {
    expect(endSentence("Completado el 24 de noviembre")).toBe("Completado el 24 de noviembre.");
    expect(endSentence("Listo ")).toBe("Listo.");
  });

  it("leaves a question or an exclamation as it is", () => {
    expect(endSentence("¿Listo?")).toBe("¿Listo?");
    expect(endSentence("¡Listo!")).toBe("¡Listo!");
  });
});
