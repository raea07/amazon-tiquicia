import { createRequire } from "node:module";
import { createElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The provider reads only useColorScheme from React Native; the test answers
// it with the phone setting each case asks for.
const phone = vi.hoisted(() => ({ scheme: "light" as "light" | "dark" | null }));
vi.mock("react-native", () => ({ useColorScheme: () => phone.scheme }));

const { ThemeProvider, useTheme } = await import("./provider");
const { theme, themeDark } = await import("./tokens");
type Theme = import("./tokens").Theme;
type Scheme = import("./tokens").Scheme;

// The kit has no types for react-dom (only the server renderer is needed here).
const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as {
  renderToStaticMarkup: (element: ReactElement) => string;
};

// createElement passes the probe as the third argument; this view of the
// provider lets the props object leave children out.
const Provider = ThemeProvider as (props: { scheme?: Scheme; children?: ReactNode }) => ReactNode;

let seen: Theme | undefined;
function Probe() {
  seen = useTheme();
  return null;
}

/** Renders a component that calls useTheme() and returns what it got. */
function themeSeen(wrap: "none" | { scheme?: Scheme }): Theme {
  seen = undefined;
  const probe = createElement(Probe);
  renderToStaticMarkup(
    wrap === "none" ? probe : createElement(Provider, { scheme: wrap.scheme }, probe),
  );
  if (!seen) throw new Error("the probe did not render");
  return seen;
}

describe("useTheme and ThemeProvider", () => {
  beforeEach(() => {
    phone.scheme = "light";
  });

  it("the light and dark themes differ, so the checks below can tell them apart", () => {
    expect(theme.colors).not.toEqual(themeDark.colors);
  });

  it("gives the light theme outside a provider, whatever the phone says", () => {
    phone.scheme = "dark";
    expect(themeSeen("none")).toBe(theme);
  });

  it("follows the phone's setting when no scheme is forced", () => {
    phone.scheme = "light";
    expect(themeSeen({})).toBe(theme);
    phone.scheme = "dark";
    expect(themeSeen({})).toBe(themeDark);
  });

  it("treats an unknown phone setting as light", () => {
    phone.scheme = null;
    expect(themeSeen({})).toBe(theme);
  });

  it("uses a forced scheme over the phone's setting", () => {
    phone.scheme = "light";
    expect(themeSeen({ scheme: "dark" })).toBe(themeDark);
    phone.scheme = "dark";
    expect(themeSeen({ scheme: "light" })).toBe(theme);
  });
});
