"use client";

import * as React from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  ShoppingCart,
  Zap,
  Store,
  ShieldCheck,
  Truck,
  RotateCcw,
  Check,
  ListChecks,
  Info,
} from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { BackButton } from "@/components/BackButton";
import { SellerCard } from "@/components/SellerCard";
import { ProductCard } from "@/components/ProductCard";
import { Carousel } from "@/components/Carousel";
import { Rating } from "@/components/Rating";
import { QuantitySelector } from "@/components/QuantitySelector";
import { FavouriteButton } from "@/components/FavouriteButton";
import { Disclosure } from "@/components/Disclosure";
import { Reviews } from "@/components/Reviews";
import { MobilePurchaseBar } from "@/components/MobilePurchaseBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useCart } from "@/hooks/use-cart";
import { recordView } from "@/hooks/use-recently-viewed";
import { formatINR, formatEta } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Product } from "@/types";

export function ProductDetailClient({ product, related }: { product: Product; related: Product[] }) {
  const router = useRouter();
  const { addItem, lines } = useCart();
  const reduce = useReducedMotion();

  React.useEffect(() => {
    recordView(product.id);
  }, [product.id]);

  const sortedSellers = React.useMemo(
    () => [...product.sellers].sort((a, b) => a.price - b.price),
    [product.sellers]
  );
  const [sellerId, setSellerId] = React.useState(sortedSellers[0].id);
  const [activeImg, setActiveImg] = React.useState(0);
  const [qty, setQty] = React.useState(1);

  const seller = product.sellers.find((s) => s.id === sellerId) ?? sortedSellers[0];
  const inCart = lines.some((l) => l.productId === product.id && l.sellerId === seller.id);
  const discount =
    seller.mrp && seller.mrp > seller.price
      ? Math.round(((seller.mrp - seller.price) / seller.mrp) * 100)
      : 0;

  // Shared purchase actions (used by inline card + mobile sticky bar).
  const addToCart = () => addItem(product, seller, qty);
  const buyNow = () => {
    addItem(product, seller, qty);
    router.push("/cart");
  };

  // Show the mobile sticky bar only once the inline purchase card scrolls away.
  const inlineBoxRef = React.useRef<HTMLDivElement>(null);
  const [barVisible, setBarVisible] = React.useState(false);
  React.useEffect(() => {
    const el = inlineBoxRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setBarVisible(!entry.isIntersecting),
      { rootMargin: "-80px 0px 0px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const specs: { label: string; value: string }[] = [
    { label: "Brand", value: product.brand ?? "Generic" },
    { label: "Pack / Unit", value: product.unit ?? "—" },
    { label: "Category", value: product.categoryId.replace(/^\w/, (c) => c.toUpperCase()) },
    { label: "Sellers on network", value: String(product.sellers.length) },
    { label: "Average rating", value: `${product.rating.toFixed(1)} / 5` },
    { label: "In stock", value: product.inStock ? "Yes" : "No" },
  ];

  function PurchaseBox() {
    return (
      <div className="space-y-4 rounded-2xl border border-border bg-card/70 p-5 shadow-soft backdrop-blur-sm">
        <div className="flex items-end gap-3">
          <motion.span
            key={seller.price}
            initial={reduce ? false : { y: 8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.25 }}
            className="text-3xl font-semibold tracking-tight"
          >
            {formatINR(seller.price)}
          </motion.span>
          {seller.mrp && seller.mrp > seller.price && (
            <>
              <span className="pb-1 text-base text-muted-foreground line-through">{formatINR(seller.mrp)}</span>
              <span className="pb-1 text-base font-semibold text-success">{discount}% off</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-border bg-background p-3 text-sm">
          <Truck className="h-5 w-5 text-primary" />
          <span>
            Delivery in{" "}
            <span className="font-semibold text-foreground">
              {formatEta(seller.etaMinMins, seller.etaMaxMins)}
            </span>{" "}
            from {seller.name}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <QuantitySelector value={qty} min={1} onChange={setQty} className="h-12 w-fit" />
          <span className="text-sm text-muted-foreground">
            Subtotal{" "}
            <span className="font-semibold text-foreground">{formatINR(seller.price * qty)}</span>
          </span>
        </div>

        <div className="grid gap-2.5">
          <Button size="lg" variant={inCart ? "success" : "default"} onClick={addToCart}>
            {inCart ? <Check className="h-5 w-5" /> : <ShoppingCart className="h-5 w-5" />}
            {inCart ? "Added — add more" : "Add to cart"}
          </Button>
          <Button size="lg" variant="outline" onClick={buyNow}>
            <Zap className="h-5 w-5" /> Buy now
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-2 pt-1">
          {[
            { icon: ShieldCheck, label: "Secure" },
            { icon: RotateCcw, label: "Easy returns" },
            { icon: Truck, label: "Network" },
          ].map(({ icon: Icon, label }) => (
            <div key={label} className="flex flex-col items-center gap-1 text-center text-[11px] text-muted-foreground">
              <Icon className="h-4 w-4 text-primary" />
              {label}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <PageContainer className="space-y-12">
      <BackButton />

      <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] xl:gap-12">
        {/* ── Left: gallery + details ── */}
        <div className="space-y-8">
          {/* Gallery */}
          <div className="grid gap-3 sm:grid-cols-[88px_1fr] sm:items-start">
            {/* Thumbnails */}
            <div className="order-2 flex gap-3 sm:order-1 sm:flex-col">
              {product.images.map((img, i) => (
                <button
                  key={img}
                  type="button"
                  aria-label={`View image ${i + 1}`}
                  onClick={() => setActiveImg(i)}
                  className={cn(
                    "relative h-20 w-20 overflow-hidden rounded-xl border-2 transition-all",
                    activeImg === i
                      ? "border-primary ring-2 ring-primary/20"
                      : "border-border opacity-70 hover:opacity-100"
                  )}
                >
                  <Image src={img} alt="" fill sizes="80px" className="object-cover" />
                </button>
              ))}
            </div>

            {/* Main image */}
            <div className="relative order-1 aspect-square overflow-hidden rounded-2xl border border-border bg-muted sm:order-2">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={activeImg}
                  initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 1.04 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                  className="absolute inset-0"
                >
                  <Image
                    src={product.images[activeImg]}
                    alt={product.title}
                    fill
                    priority
                    sizes="(max-width: 1024px) 100vw, 50vw"
                    className="object-cover"
                  />
                </motion.div>
              </AnimatePresence>
              {discount > 0 && (
                <Badge className="absolute left-4 top-4 shadow-soft">{discount}% OFF</Badge>
              )}
              <div className="absolute right-4 top-4">
                <FavouriteButton productId={product.id} />
              </div>
            </div>
          </div>

          {/* Title block — mobile shows here, desktop too */}
          <div className="space-y-3">
            {product.brand && <p className="text-sm font-medium text-primary">{product.brand}</p>}
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{product.title}</h1>
            <div className="flex flex-wrap items-center gap-3">
              <Rating value={product.rating} count={product.ratingCount} size="md" />
              {product.unit && <span className="text-sm text-muted-foreground">{product.unit}</span>}
              {product.tags?.map((t) => (
                <Badge key={t} variant="muted">{t}</Badge>
              ))}
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">{product.description}</p>
          </div>

          {/* Purchase box — mobile only (desktop is sticky on the right) */}
          <div className="lg:hidden" ref={inlineBoxRef}>
            <PurchaseBox />
          </div>

          {/* Seller comparison (animated) */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <Store className="h-4 w-4" /> Compare sellers ({product.sellers.length})
              </h2>
              <span className="text-xs text-muted-foreground">Tap to choose</span>
            </div>
            <motion.div layout className="space-y-2.5">
              <AnimatePresence initial={false}>
                {sortedSellers.map((s) => (
                  <motion.div
                    key={s.id}
                    layout
                    initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <SellerCard
                      seller={s}
                      selected={s.id === sellerId}
                      onSelect={() => setSellerId(s.id)}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>
          </div>

          {/* Specifications + delivery (expandable) */}
          <div className="space-y-3">
            <Disclosure title="Specifications" icon={<ListChecks className="h-4 w-4 text-primary" />} defaultOpen>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                {specs.map((s) => (
                  <div key={s.label} className="flex items-center justify-between border-b border-border/60 py-2 text-sm">
                    <dt className="text-muted-foreground">{s.label}</dt>
                    <dd className="font-medium text-foreground">{s.value}</dd>
                  </div>
                ))}
              </dl>
            </Disclosure>
            <Disclosure title="Delivery & returns" icon={<Truck className="h-4 w-4 text-primary" />}>
              <ul className="space-y-2">
                <li>Delivery ETAs vary by seller and are confirmed at checkout.</li>
                <li>Easy 7-day returns on eligible items via the seller.</li>
                <li className="flex items-start gap-1.5">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  Final price is confirmed during checkout as per the ONDC protocol.
                </li>
              </ul>
            </Disclosure>
          </div>
        </div>

        {/* ── Right: sticky purchase card (desktop) ── */}
        <div className="hidden lg:block">
          <div className="sticky top-24">
            <PurchaseBox />
          </div>
        </div>
      </div>

      <Separator />

      {/* Reviews */}
      <Reviews product={product} />

      {/* Similar products carousel */}
      {related.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-semibold tracking-tight">Similar products</h2>
          <Carousel ariaLabel="Similar products" itemClassName="w-[160px] sm:w-[200px]">
            {related.map((p, i) => (
              <ProductCard key={p.id} product={p} index={i} />
            ))}
          </Carousel>
        </section>
      )}

      {/* Mobile sticky purchase bar */}
      <MobilePurchaseBar
        visible={barVisible}
        seller={seller}
        qty={qty}
        setQty={setQty}
        inCart={inCart}
        onAddToCart={addToCart}
        onBuyNow={buyNow}
      />
    </PageContainer>
  );
}
