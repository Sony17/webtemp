"use client";

import { ThemeProvider } from "./ThemeProvider";
import { CartProvider } from "@/hooks/use-cart";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <CartProvider>{children}</CartProvider>
    </ThemeProvider>
  );
}
