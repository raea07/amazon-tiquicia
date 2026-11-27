import { createContext, type ReactNode, useContext } from "react";
import { useColorScheme } from "react-native";
import { type Scheme, type Theme, theme, themeDark } from "./tokens";

/*
 * The Carreta appearance for a phone app (SISTEMA.md §5.23). An app moves to
 * it by wrapping its root layout in <ThemeProvider> and reading colours from
 * useTheme() inside its components, never at module level (StyleSheet.create
 * holds sizes and layout only). No app does yet; until one does, nothing here
 * runs. While an app's userInterfaceStyle is "light", useColorScheme()
 * answers "light", so the dark appearance appears only once the app switches
 * to "automatic" (step 4 of the rebuild).
 */

const ThemeContext = createContext<Theme>(theme);

export function ThemeProvider({
  children,
  scheme,
}: {
  children: ReactNode;
  /** Forces one appearance (the story screen); otherwise the phone's setting. */
  scheme?: Scheme;
}) {
  const system = useColorScheme();
  const chosen = scheme ?? (system === "dark" ? "dark" : "light");
  return (
    <ThemeContext.Provider value={chosen === "dark" ? themeDark : theme}>
      {children}
    </ThemeContext.Provider>
  );
}

/** The theme of the nearest ThemeProvider; the light theme outside one. */
export function useTheme(): Theme {
  return useContext(ThemeContext);
}
