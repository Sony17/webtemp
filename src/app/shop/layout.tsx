// Buyer-app (ONDC RET10) shell. Lives inside the main webtemp Next app so it
// shares the origin with the /api/ondc/* backend (no CORS, one deploy) and is
// version-controlled — unlike the original orphaned buyer-app whose source was
// lost. The blue-primary shadcn theme is scoped via `.shop-theme` (see Chrome
// + globals.css) so the SaaS pages are untouched.
import type { Metadata } from "next";
import { ShopProvider } from "@/lib/shop/store";
import { ThemeProvider } from "@/lib/shop/theme";
import Chrome from "@/components/shop/Chrome";

export const metadata: Metadata = {
  title: "OpenIdea — Shop on ONDC",
  description: "Discover and buy from sellers across the ONDC network.",
};

export default function ShopLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ThemeProvider>
      <ShopProvider>
        <Chrome>{children}</Chrome>
      </ShopProvider>
    </ThemeProvider>
  );
}
