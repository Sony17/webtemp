"use client";

// Dark-mode toggle button — migrated from the prototype, wired to the shop
// ThemeProvider. Uses the existing shop Button primitive.
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/shop/ui";
import { useTheme } from "@/lib/shop/theme";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={toggle}
      className="relative h-9 w-9"
    >
      <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">
        {theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      </span>
    </Button>
  );
}
