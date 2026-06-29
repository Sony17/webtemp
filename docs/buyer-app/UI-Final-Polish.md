# OpenIdea Buyer App — Final UX Polish (Before → After)

**Scope:** the 10 pre-backend polish items. No routing, architecture, or `src/services/*` changes; no backend calls.
**Verification:** `tsc` clean · `next build` clean (0 warnings) · browser console clean on all 8 pages · responsive sweep at **320 / 375 / 390 / 414 / 768 / 1024 / 1280 / 1440 / 1920** (73 screenshots in [`scripts/shots2/`](scripts/shots2/)).

---

## 1. Mobile sticky purchase CTA — ✅
**Before:** mobile users had to scroll back to the inline card to buy.
**After:** `MobilePurchaseBar` ([src/components/MobilePurchaseBar.tsx](src/components/MobilePurchaseBar.tsx)) — fixed bottom bar showing **price + MRP, ETA + seller, quantity, Add to Cart, Buy Now**. Slides in (spring) only once the inline purchase card scrolls out of view (IntersectionObserver), honors `env(safe-area-inset-bottom)`, and is `lg:hidden`. The mobile **bottom tab bar is now hidden on PDPs** so there is no overlap. Verified: [mobile-sticky-bar.png](scripts/shots2/mobile-sticky-bar.png).

## 2. Pricing consistency — ✅
**Before:** Cart showed "Discount −₹317" above an already-net "Item total" (read as double-counting); the order mock total even re-subtracted the discount (₹779 → ₹751).
**After:** one `PriceCard` hierarchy everywhere — **Total MRP → Discount on MRP → Selling price → Delivery → Platform fee → Taxes → Estimated total**, plus a single "You save ₹X" note and *"Final payable amount will be confirmed during ONDC checkout."* The discount now visibly subtracts **from MRP to reach the selling price**, so it can't double-count. `PriceBreakup` gained optional `mrpTotal` + `platformFee`; the cart computes them; the mislabeled order total was corrected (₹791). Verified identical model on [cart](scripts/shots2/w1440-cart.png) and [order details](scripts/shots2/w1440-order-details.png).

## 3. Desktop layouts — ✅
**Before:** Orders, Profile, Order Details sat in a narrow centered column; large screens felt empty.
**After:**
- **Orders** → `[1fr_300px]` with a helper rail (active-deliveries count, support card, "Continue shopping", IGM badge). [w1440-orders](scripts/shots2/w1440-orders.png)
- **Profile** → `[360px_1fr]` two-column: sticky left rail (profile, stats, quick links, logout) + right content (addresses in a 2-col grid, payments, notifications). [w1440-profile](scripts/shots2/w1440-profile.png)
- **Order Details** → `[1fr_360px]`: left (timeline, items, IGM) + sticky right (actions, seller, delivery, payment, bill). [w1440-order-details](scripts/shots2/w1440-order-details.png)
- **Search** → new **desktop filter sidebar** (`FilterControls`, live-applied) + 4-col grid; the sheet is now mobile-only. [w1440-search](scripts/shots2/w1440-search.png)

## 4. Home — Deals vs Trending — ✅
**Before:** both used the same blue product card → repetitive.
**After:** **Deals** get a distinct warm treatment — amber section header (flame badge), `DealCard` ([src/components/DealCard.tsx](src/components/DealCard.tsx)) with corner discount flag, "Limited time" chip, amber price + "Save ₹X". **Trending** keeps the blue `ProductCard` grid. Carousels gained **edge-fade masks** + existing peek/arrows for clearer scroll affordance. [w1440-home](scripts/shots2/w1440-home.png)

## 5. Checkout — ✅
**Before:** completed steps were static; no way to jump back from Review.
**After:** `Stepper` accepts `onStepClick`; **completed steps are clickable** (with hover ring + animated connector fill). The Review step's "Delivering to" / "Paying with" cards gained **Edit** links that jump to the right step. Step transitions remain directional slides.

## 6. Placeholder links — ✅
**Before:** `href="#"` on Profile "Help & Support", `trackingUrl: "#"`.
**After:** no dead links remain. "Help & Support" is a **disabled button with a "Soon" badge**; "Track order" links to the in-page **`#order-status`** timeline when no live URL exists (and opens a real URL when present); the mock `trackingUrl: "#"` was removed. Grep confirms only the valid in-page anchor remains.

## 7. Motion & accessibility — ✅
- **Skip-to-content** link + focusable `<main id="main-content">` landmark in the app shell.
- Consistent easing token `[0.22, 1, 0.36, 1]`; springs reserved for press/spatial; **all motion is `useReducedMotion`-gated**.
- Focus-visible rings on the new interactive elements (filter pills, stepper buttons, support items); `aria-pressed` on filter/sort pills; `aria-label`s on the sticky bar, favourite, and switches; touch targets ≥44px on the sticky bar and bottom nav.

## 8. Responsive QA — ✅
Swept 320 → 1920. No overflow, clipping, or misalignment found. 320px checkout/cart/search reflow cleanly; 768 tablet keeps the inline purchase box; ≥1024 switches to the sticky desktop card and 2-column layouts.

---

## Status
| Check | Result |
|---|---|
| `tsc --noEmit` | ✅ clean |
| `next build` | ✅ clean, 0 warnings, 10/10 routes |
| Browser console (8 pages) | ✅ 0 errors / 0 warnings |
| Responsive 320–1920 | ✅ no overflow |

## Remaining polish (optional, non-blocking)
- **Live order tracking** map/widget (needs backend) — currently links to the status timeline.
- **Functional** address add/edit, payment add, profile edit, coupon field, delivery-slot — wired to UI, await backend.
- **Deal urgency**: real countdown timer on `DealCard` (currently a "Limited time" chip).
- Replace **placeholder review copy** and the stock avatar with representative content.
- Optional `next/image` **blur placeholders** for a smoother first paint.
- A formal **WCAG AA contrast audit** of muted text on tinted (accent/amber) surfaces.

> Dev-only note: the dark "N"/Issues circle in screenshots is the Next.js dev indicator — absent in production builds.
