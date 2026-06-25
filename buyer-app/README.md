# OpenIdea — ONDC Buyer App (Frontend MVP)

A clean, modern, production-quality frontend for the OpenIdea ONDC Buyer App (BAP).
Design language: **Apple × Linear × Vercel × Blinkit** — minimal, premium, fast, lots of whitespace.

> **Frontend only.** All data is realistic mock JSON. Components are designed so the existing
> ONDC backend APIs can be plugged into `src/services/*` later without touching the UI.

## Tech Stack

- **Next.js 15** (App Router) · React 19 · TypeScript
- **Tailwind CSS v3** + **shadcn/ui** (new-york) · **Lucide** icons
- Primary color: `#2563EB`

## Getting Started

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Project Structure

```
src/
  app/            # App Router pages + layout
    page.tsx              # 1. Home / Landing
    search/               # 2. Search Results
    product/[id]/         # 3. Product Details
    cart/                 # 4. Cart
    checkout/             # 5. Checkout (stepper)
    order/success/        # 6. Order Success
    orders/               # 7. Orders list
    orders/[id]/          # 8. Order Details
    profile/              # 9. Profile
  components/
    ui/             # shadcn/ui primitives
    layout/         # AppShell, Navbar, Sidebar, BottomNav
    *.tsx           # Reusable feature components (ProductCard, SellerCard, ...)
  types/          # Shared TypeScript domain types (ONDC-aligned)
  hooks/          # use-cart, use-mobile
  services/       # API-shaped data access layer (currently returns mock data)
  lib/            # utils, formatters
  mock/           # realistic dummy JSON data
  styles/         # design token reference
```

## Connecting the backend later

Every screen reads data through `src/services/*`. Each service function is `async` and
returns typed domain objects from `src/mock/*` today. To go live, swap the mock import for a
`fetch()` to the ONDC backend — the component layer does not change.

## ONDC notes baked into the UX

- **Late-binding price:** the catalog price is *indicative*. The cart shows an info banner —
  _"Final price will be confirmed during checkout as per ONDC protocol."_ — because the binding
  quote only arrives at `on_select` / `on_init`.
- **Multi-seller:** products roll up multiple sellers ("View Sellers"); the PDP lists per-seller
  price + delivery ETA.
- **Order lifecycle:** order details render a status timeline fed by `status` / `track`.

See `docs/research/ONDC-Buyer-App-Research.md` (repo root) for the full research basis.
