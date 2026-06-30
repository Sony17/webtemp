"use client";

// Route transition for the buyer app — migrated from the prototype's
// app/template.tsx. Scoped to /shop (not the global app) so SaaS pages are
// unaffected. Subtle fade/slide on navigation, reduced-motion aware.
import { motion, useReducedMotion } from "framer-motion";

export default function ShopTemplate({
  children,
}: {
  children: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
