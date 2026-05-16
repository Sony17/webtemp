// Source of truth for live tenant sites at <subdomain>.openidea.co.in.
//
// For local/static demos this file is the registry. In production you'd
// replace this with a DB read (Vercel KV / Postgres / Supabase) so that
// the admin dashboard can write deployments without redeploying the app.

export type Deployment = {
  subdomain: string;
  templateSlug: string;
  brandName: string;
  tagline?: string;
  primaryColor?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  hours?: string;
};

export const deployments: Deployment[] = [
  {
    subdomain: "sony",
    templateSlug: "mobile-repair",
    brandName: "Sony's Mobile Care",
    tagline: "Same-day phone repair with genuine parts and 6-month warranty.",
    primaryColor: "#0ea5e9",
    phone: "+91 78388 32332",
    address: "Shop 4, Sector 50, Noida",
    city: "Noida",
    hours: "Mon–Sat · 10am – 9pm",
  },
  {
    subdomain: "bakery",
    templateSlug: "bakery",
    brandName: "Sweet Crumb Bakery",
    tagline: "Fresh-baked cakes, breads and pastries. Midnight delivery in your city.",
    primaryColor: "#f43f5e",
    phone: "+91 98765 43210",
    address: "B-12, Linking Road, Bandra West, Mumbai",
    city: "Mumbai",
    hours: "Open daily · 8am – 11pm",
  },
  {
    subdomain: "velvet",
    templateSlug: "salon",
    brandName: "Velvet Studio",
    tagline: "Hair, skin & bridal — by award-winning stylists.",
    primaryColor: "#ec4899",
    phone: "+91 99988 77665",
    address: "Plot 24, Indiranagar 100ft Road, Bangalore",
    city: "Bangalore",
    hours: "Tue–Sun · 11am – 8pm",
  },
  {
    subdomain: "spice",
    templateSlug: "restaurant",
    brandName: "Spice Trail",
    tagline: "Modern Indian kitchen. Authentic flavours, delivered hot.",
    primaryColor: "#ef4444",
    phone: "+91 91234 56789",
    address: "C-15, Connaught Place, New Delhi",
    city: "New Delhi",
    hours: "Open daily · 12pm – midnight",
  },
];

export function getDeployment(subdomain: string): Deployment | null {
  const key = subdomain.toLowerCase().trim();
  return deployments.find((d) => d.subdomain === key) ?? null;
}

export function listDeploymentSubdomains(): string[] {
  return deployments.map((d) => d.subdomain);
}
