"use client";

import * as React from "react";
import {
  motion,
  AnimatePresence,
  useReducedMotion,
  type Variants,
  type HTMLMotionProps,
} from "framer-motion";
import { cn } from "@/lib/utils";

export { motion, AnimatePresence, useReducedMotion };

export const EASE = [0.22, 1, 0.36, 1] as const;

/** Fade + slide-up on scroll into view (once). */
export function Reveal({
  children,
  delay = 0,
  y = 14,
  once = true,
  className,
  as = "div",
}: {
  children: React.ReactNode;
  delay?: number;
  y?: number;
  once?: boolean;
  className?: string;
  as?: "div" | "section" | "li" | "ul";
}) {
  const reduce = useReducedMotion();
  const MotionTag = motion[as] as React.ComponentType<HTMLMotionProps<"div">>;
  return (
    <MotionTag
      className={className}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y }}
      whileInView={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
      viewport={{ once, margin: "-60px" }}
      transition={{ duration: 0.5, ease: EASE, delay }}
    >
      {children}
    </MotionTag>
  );
}

/** Container that staggers its <StaggerItem> children on view. */
export function Stagger({
  children,
  className,
  gap = 0.06,
  once = true,
}: {
  children: React.ReactNode;
  className?: string;
  gap?: number;
  once?: boolean;
}) {
  const container: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: gap } },
  };
  return (
    <motion.div
      className={className}
      variants={container}
      initial="hidden"
      whileInView="show"
      viewport={{ once, margin: "-40px" }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
  y = 16,
}: {
  children: React.ReactNode;
  className?: string;
  y?: number;
}) {
  const reduce = useReducedMotion();
  const item: Variants = {
    hidden: reduce ? { opacity: 0 } : { opacity: 0, y },
    show: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.45, ease: EASE },
    },
  };
  return (
    <motion.div className={className} variants={item}>
      {children}
    </motion.div>
  );
}

/** Press + hover micro-interaction wrapper. */
export function Pressable({
  children,
  className,
  lift = true,
  ...props
}: HTMLMotionProps<"div"> & { lift?: boolean }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      whileHover={reduce || !lift ? undefined : { y: -4 }}
      whileTap={reduce ? undefined : { scale: 0.985 }}
      transition={{ type: "spring", stiffness: 350, damping: 24 }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/** Animated number that rolls when the value changes (price updates). */
export function AnimatedNumber({
  value,
  format = (v) => String(Math.round(v)),
  className,
}: {
  value: number;
  format?: (v: number) => string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <span className={cn("relative inline-block tabular-nums", className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
          transition={{ duration: 0.25, ease: EASE }}
          className="inline-block"
        >
          {format(value)}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
