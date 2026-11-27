import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The fonts come from the framework's font loader, which only runs in a build.
vi.mock("../fonts", () => ({ fontClassName: "font-test" }));

const { ErrorScreen, GlobalErrorDocument, TEAM_TOLD } = await import("./pages");

const ADVICE = "Si acaba de guardar un cambio, revise si quedó aplicado antes de repetirlo.";

describe("the error pages", () => {
  it("say what happened and what to do next, in Spanish, with no code or stack", () => {
    const html = renderToStaticMarkup(
      <ErrorScreen advice={ADVICE} onRetry={() => undefined} told={false} />,
    );
    expect(html).toContain("Algo falló de nuestro lado");
    expect(html).toContain("No es culpa suya.");
    expect(html).toContain(ADVICE);
    expect(html).toContain("Intentar de nuevo");
    expect(html).toContain('href="/"');
    expect(html).toContain("Volver al inicio");
    expect(html).not.toMatch(/digest|stack|Error:|at \w+ \(/i);
  });

  it("say the team was told only when the report was handed to the tracker", () => {
    const off = renderToStaticMarkup(<ErrorScreen advice={ADVICE} told={false} />);
    expect(off).not.toContain(TEAM_TOLD);
    const on = renderToStaticMarkup(<ErrorScreen advice={ADVICE} told />);
    expect(on).toContain("Ya le avisamos al equipo de Yuntera.");
    // The default, until useReportError says the report was handed over, is not to claim it.
    expect(renderToStaticMarkup(<ErrorScreen advice={ADVICE} />)).not.toContain(TEAM_TOLD);
  });

  it("the global page brings its own document, in Spanish, without the error's text", () => {
    const error = Object.assign(new Error("insufficient_stock at ana.prueba@example.com"), {
      digest: "1234",
    });
    const html = renderToStaticMarkup(
      <GlobalErrorDocument error={error} retry={() => undefined} advice={ADVICE} />,
    );
    expect(html).toMatch(/^<html lang="es-CR" class="font-test">(<head><\/head>)?<body /);
    expect(html).toContain("Algo falló de nuestro lado");
    expect(html).not.toContain("insufficient_stock");
    expect(html).not.toContain("ana.prueba");
    expect(html).not.toContain("1234");
  });
});
