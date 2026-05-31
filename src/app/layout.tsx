import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import WhatsAppContact from "@/components/WhatsAppContact";
import { extractSubdomain } from "@/proxy";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Open Idea EcoSyz — AI Innovation Platform",
  description: "Pre-built websites for 50+ Indian business categories. Pick a template, customize, launch.",
};

// Tenant subdomains where the platform's own WhatsApp widget should not appear,
// because they have their own branded contact button inside the tenant iframe.
const HIDE_WHATSAPP_SUBDOMAINS = new Set(["candle-sample", "sai"]);

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const host = (await headers()).get("host") ?? "";
  // Use the proxy's resolver so custom domains (saiwalldecor.com → sai) match.
  const tenant = extractSubdomain(host);
  const subdomain = tenant ?? host.split(":")[0].split(".")[0].toLowerCase();
  const showWhatsApp = !HIDE_WHATSAPP_SUBDOMAINS.has(subdomain);

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        {showWhatsApp && <WhatsAppContact />}
      </body>
    </html>
  );
}
