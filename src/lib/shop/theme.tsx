"use client";

// Buyer-app theme (light/dark) — migrated from the prototype's ThemeProvider.
// Adapted to the current architecture: instead of toggling `.dark` on <html>
// (which is shared with the SaaS site), the theme is consumed by the shop
// wrapper element in Chrome, which applies `.shop-theme.dark`. This keeps dark
// mode fully contained to /shop. Persisted to localStorage; defaults to the OS
// preference on first load.
import * as React from "react";

type Theme = "light" | "dark";
const STORAGE_KEY = "openidea.theme";

type ThemeContextValue = {
  theme: Theme;
  toggle: () => void;
  setTheme: (t: Theme) => void;
};

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>("light");

  // Hydrate from localStorage / OS preference (external systems) after the first
  // client render, so the server render stays deterministic.
  /* eslint-disable react-hooks/set-state-in-effect */
  React.useEffect(() => {
    let stored: Theme | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY) as Theme | null;
    } catch {
      stored = null;
    }
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)"
    ).matches;
    setThemeState(stored ?? (prefersDark ? "dark" : "light"));
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  React.useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore quota / private-mode */
    }
  }, [theme]);

  const value = React.useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme: setThemeState,
      toggle: () => setThemeState((t) => (t === "dark" ? "light" : "dark")),
    }),
    [theme]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
