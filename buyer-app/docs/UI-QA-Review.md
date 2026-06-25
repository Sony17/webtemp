# OpenIdea Buyer App — Visual QA & Design Review

**Reviewer roles:** Senior Frontend Engineer · UI Designer · QA Engineer
**Method:** Real headless Chromium (Playwright) against `next dev`. 24 full-page screenshots — **8 pages × {desktop-light, desktop-dark, mobile-light}** — plus a per-page browser-console audit.
**Viewports:** Desktop 1440×900 · Mobile 390×844 (2× DPR). Cart/Checkout seeded with a real 4-item, 2-seller cart.

> 3 genuine defects were found and **fixed during this pass** (see §A). Everything below the fixes is opinion-level critique, prioritized for action before backend integration.

---

## A. Defects found & fixed during QA

| # | Severity | Page | Symptom | Root cause | Fix |
|---|----------|------|---------|-----------|-----|
| 1 | **CRITICAL** | Order Details | Page crashed to the Next.js error overlay: *"Functions cannot be passed directly to Client Components."* | `PriceCard` (Server Component) passed a `format` **function** prop to the client `AnimatedNumber`. Build passed because the route is dynamic & type-valid — it only failed at request time. | Marked `PriceCard` `"use client"`. |
| 2 | **HIGH** | Home, Profile | Console error: *"The result of getServerSnapshot should be cached to avoid an infinite loop."* | `useFavourites` / `useRecentlyViewed` returned a fresh `[]` literal from `getServerSnapshot` each call. | Return a stable module-level `EMPTY` array. |
| 3 | **LOW** | Search | Console warning: above-the-fold product image flagged as LCP without `priority`. | `ProductCard` images were always `loading="lazy"`. | First 5 cards now render with `priority`; rest stay lazy. |

After fixes: **all 8 pages are console-clean (0 errors / 0 warnings)** and the production build compiles with no warnings.

> **Not a bug:** the dark circle ("N" / "Issues") at the bottom-left of every screenshot is the **Next.js dev-mode indicator**. It does not exist in production builds and overlaps only the sidebar's "Powered by ONDC" footer card.
> **Capture caveat:** full-page screenshots required scripted scrolling to trigger `whileInView` reveals; the fixed mobile bottom-nav can render pinned in stitched full-page shots (it behaves correctly in the live viewport).

---

## B. Screenshot gallery

All under [`buyer-app/scripts/shots/`](scripts/shots/). Naming: `{device}-{page}-{theme}.png`.

**Desktop · Light**
[home](scripts/shots/desktop-home-light.png) · [search](scripts/shots/desktop-search-light.png) · [product](scripts/shots/desktop-product-light.png) · [cart](scripts/shots/desktop-cart-light.png) · [checkout](scripts/shots/desktop-checkout-light.png) · [orders](scripts/shots/desktop-orders-light.png) · [order-details](scripts/shots/desktop-order-details-light.png) · [profile](scripts/shots/desktop-profile-light.png)

**Desktop · Dark**
[home](scripts/shots/desktop-home-dark.png) · [search](scripts/shots/desktop-search-dark.png) · [product](scripts/shots/desktop-product-dark.png) · [cart](scripts/shots/desktop-cart-dark.png) · [checkout](scripts/shots/desktop-checkout-dark.png) · [orders](scripts/shots/desktop-orders-dark.png) · [order-details](scripts/shots/desktop-order-details-dark.png) · [profile](scripts/shots/desktop-profile-dark.png)

**Mobile · Light**
[home](scripts/shots/mobile-home-light.png) · [search](scripts/shots/mobile-search-light.png) · [product](scripts/shots/mobile-product-light.png) · [cart](scripts/shots/mobile-cart-light.png) · [checkout](scripts/shots/mobile-checkout-light.png) · [orders](scripts/shots/mobile-orders-light.png) · [order-details](scripts/shots/mobile-order-details-light.png) · [profile](scripts/shots/mobile-profile-light.png)

Re-generate anytime: `node scripts/shots.mjs` (dev server on :3100). Console audit: `node scripts/console-check.mjs`.

---

## C. Per-page design critique

### 1. Home
**Good:** Strong hero — gradient backdrop, clipped-gradient headline, animated rotating-suggestion search, trust stats. Logical content ladder (categories → deals → recently viewed → trending → sellers → CTA). Carousels and reveal-on-scroll feel premium. Dark mode is well balanced.
**Unpolished:** Hero vertical rhythm is slightly tall on desktop; "Deals of the day" and "Trending" are visually similar (same card, similar products) so the page can read repetitive. Closing CTA inverts to a light block in dark mode — intentional but a strong flash.
**Improve / redesign:** Differentiate Deals (e.g., a countdown chip, a price-drop ribbon, a tinted "deal" card variant) from Trending. Consider a compact "for you" row using recently-viewed categories.
**UX:** Make category chips reflect the active category when arriving from a category link. Add a "see all deals" affordance.
**Priority:** Medium.

### 2. Search
**Good:** Clean 5-column grid, sticky search+filter bar, quick-sort pills, removable animated filter chips, real-time result count. Skeleton + empty states are high quality.
**Unpolished:** Quick-sort pills and the chip row can stack to two control rows on mobile, eating vertical space. No result-grid density toggle. "All products" heading is generic when no query.
**Improve:** Show the applied filter summary inline ("12 results · under ₹500 · 4★+"). Persist scroll position when toggling filters.
**UX:** Debounced live search as you type; recent/suggested queries dropdown on focus.
**Priority:** Medium.

### 3. Product Details
**Good:** Genuinely premium — crossfade gallery with thumbnail rail, **sticky purchase card** on desktop, animated seller-comparison list, expandable specs/delivery, full ratings distribution with animated bars, similar-products carousel. Mobile reflows the purchase box inline correctly.
**Unpolished:** "Similar products" shows one card flush-left with lots of right whitespace until you scroll the carousel — looks under-filled at first glance. Reviews are clearly placeholder copy.
**Improve:** Hint carousel overflow with a peeking next card + edge fade. Add a "from ₹X across N sellers" price range to the title block to foreground the multi-seller value prop.
**UX:** Sticky add-to-cart bar on mobile (currently you must scroll to the purchase box). Image zoom/lightbox on tap.
**Priority:** High (mobile sticky CTA), otherwise Medium.

### 4. Cart
**Good:** Premium seller-grouped cards, savings banner, animated qty + rolling totals, sticky summary, delivery-estimate card, prominent ONDC late-price notice. Math is correct (₹1,212 total, ₹317 saved). Dark mode excellent.
**Unpolished:** In **Price Details**, the green "Discount −₹317" line sits above "Item total" that is *already* the net price, so the discount doesn't visibly subtract — it can read as a double count.
**Improve:** Either show MRP "Item total" then subtract the discount to reach the net, **or** relabel to "You save ₹317" as a non-arithmetic highlight (matches the banner). Pick one model and use it in Cart, Checkout, and Order Details consistently.
**UX:** "Move to favourites" on a line; per-seller subtotal; free-delivery progress ("Add ₹50 for free delivery").
**Priority:** Medium.

### 5. Checkout
**Good:** Best-in-class screen. Clear 3-step indicator, directional slide transitions, persistent **order-summary sidebar** with qty badges + payment summary, tidy address/payment/review cards. Stepper collapses to numerals on mobile. Bottom-nav correctly hidden here.
**Unpolished:** "Add new" address and the billing checkbox are non-functional (expected at this stage, but visually inviting). No explicit "edit" affordance to jump back to a completed step from Review.
**Improve:** Make completed step circles in the indicator clickable to navigate back. Add a slim sticky "Place order · ₹X" bar on mobile.
**UX:** Inline address add/edit; coupon field; delivery-slot selection.
**Priority:** Medium.

### 6. Orders
**Good:** Order search, status filter pills, current/past tabs, clean order cards with item thumbnails, status chips, ETA line. Animated list add/remove.
**Unpolished:** **Narrow content column leaves the right half of the desktop empty** — the page feels sparse on large screens (the brief's "large screens should not feel empty"). Filter pills + tabs are two separate control rows that do similar filtering and can feel redundant.
**Improve:** On `lg+`, widen to a 2-column order grid or add a right rail (reorder shortcuts, support, active-delivery map placeholder). Merge status pills and tabs into one control, or make tabs the primary and pills secondary.
**UX:** "Reorder" button on past orders; live ETA countdown on active orders.
**Priority:** Medium (desktop emptiness), Low (control redundancy).

### 7. Order Details
**Good (post-fix):** Rich and clear — animated delivery timeline, seller card, delivery info, itemised list, payment + bill breakdown, and a dedicated **IGM grievance card**. Track + Support actions are prominent.
**Unpolished:** Two-column grid (timeline | seller+delivery) leaves an uneven gap when the timeline is taller than the right column. Bill "Discount −₹40" has the same labeling ambiguity as Cart (§4).
**Improve:** Balance the columns (e.g., move Payment up next to Delivery). Apply the unified discount model.
**UX:** Make the timeline reflect "live" state with a subtle pulse on the active node; add an invoice download.
**Priority:** Medium.

### 8. Profile
**Good:** Polished header card, a clean 4-stat strip (Orders/Addresses/Favourites/Cards), quick-link tiles, saved addresses & payments, notification toggles, ONDC NP footer, clear destructive Log out. Toggles and hover lifts feel refined.
**Unpolished:** Same narrow-column desktop emptiness as Orders. Quick-link "Addresses" and "Help & Support" hrefs are placeholders (`#`). Avatar is a stock image.
**Improve:** Use the desktop width (2-column: profile/settings left, activity/stats right). Wire quick-links to real anchors/sections.
**UX:** Inline edit for profile fields; address-as-default action; "default" toggle on payments.
**Priority:** Low–Medium.

---

## D. Cross-cutting assessment

| Area | Verdict | Notes |
|------|---------|-------|
| Broken layouts | ✅ none | No overflow/clipping found across 24 shots. |
| Overflow / misalignment | ✅ clean | Carousels, grids, sticky elements align. |
| Spacing & typography | ✅ strong | Consistent scale, good whitespace; hero a touch tall. |
| Color consistency | ✅ strong | Primary `#2563EB` used consistently; success/warn semantic. |
| Hover states | ✅ present | Cards lift, buttons press, carousel arrows reveal (not visible in static shots; verified in code). |
| Dark mode | ✅ solid | Fully tokenized; verified home + cart; CTA inversion is intentional. |
| Loading states | ✅ good | Shimmer skeletons, route-level `loading.tsx` for product/orders. |
| Animations | ✅ good, reduced-motion aware | One capture caveat (`whileInView` needs scroll), not a runtime issue. |
| Accessibility | ⚠️ mostly good | ARIA labels, focus-visible rings, `aria-current` present. **Gaps:** color-only status reliance in places, placeholder `#` links, no skip-to-content, contrast of muted text on tinted cards should be spot-checked against WCAG AA. |
| Empty states | ✅ high quality | Animated icon, clear copy + CTA. |
| Responsive | ✅ strong | Mobile reflows correctly; **desktop narrow pages feel empty** (Orders/Profile). |

---

## E. Punch list — before backend integration

### 🔴 Critical — ✅ DONE
- [x] Fix Order Details crash (`PriceCard` "use client").

### 🟠 High
- [x] Fix `getServerSnapshot` infinite-loop warning (stable `EMPTY`).
- [ ] **Add a sticky mobile add-to-cart bar** on Product Details.
- [ ] **Unify the discount/savings model** across Cart, Checkout, Order Details (decide: subtract-from-MRP **or** non-arithmetic "you save"). Current line reads as a possible double-count.

### 🟡 Medium
- [ ] **Use desktop width on narrow pages** (Orders, Profile) — 2-column or right rail so large screens don't feel empty.
- [ ] Differentiate **Deals vs Trending** on Home (distinct card treatment / urgency cue).
- [ ] Make **completed checkout steps clickable** to navigate back; add edit affordances.
- [ ] Carousel **overflow affordance** (peek + edge fade) on Product "Similar" and Home rows.
- [ ] Balance the **Order Details two-column** gap.
- [ ] Wire **placeholder `#` links** (Profile quick-links, support) to real anchors before launch.

### 🟢 Low / polish
- [x] Add `priority` to above-the-fold product images (LCP).
- [ ] Add `next/image` blur placeholders to reduce perceived load.
- [ ] Add **skip-to-content** link + audit muted-on-tint contrast for WCAG AA.
- [ ] Replace placeholder review copy and stock avatar with representative content.
- [ ] Tighten hero vertical rhythm on desktop.
- [ ] Free-delivery progress nudge in Cart.

---

## F. Overall

The UI is **production-grade in look and motion** — Apple/Linear/Vercel/Blinkit influences read clearly, dark mode is real, and the motion system is reduced-motion aware. The QA pass caught one **release-blocking runtime crash** (now fixed) plus two console-level issues (now fixed). The remaining items are quality/UX refinements, not blockers. Highest-value next steps: the **mobile sticky add-to-cart**, the **discount-model unification**, and **filling desktop width on narrow pages**.
