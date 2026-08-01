'use client';

/**
 * Shared framer-motion animation primitives.
 *
 * Exports reusable `Variants` objects and small wrapper components so each tab
 * can apply consistent stagger animations while respecting the user's
 * `prefers-reduced-motion` setting. All variants gracefully degrade to a no-op
 * (opacity 1, no transform) when the user has reduced-motion enabled because
 * framer-motion automatically respects the OS-level preference via
 * `useReducedMotion()` when `MotionConfig reducedMotion="user"` is set on a
 * parent (see src/lib/providers.tsx).
 */

import type { Variants } from 'framer-motion';
import { motion } from 'framer-motion';
import React from 'react';

/** Parent container — children stagger in 60ms apart, fade + slide up. */
export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.04,
    },
  },
};

/** Child item — fade-in + 8px slide-up. */
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] },
  },
};

/** Smaller, quicker fade-in for nested items (e.g. table rows). */
export const quickFade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
};

/**
 * MotionDiv — thin wrapper around `motion.div` with sensible defaults so call
 * sites don't need to import framer-motion directly. Pass `variants` to
 * customize, otherwise uses `staggerItem`.
 */
export function MotionDiv({
  children,
  className,
  variants = staggerItem,
}: {
  children: React.ReactNode;
  className?: string;
  variants?: Variants;
}) {
  return (
    <motion.div
      className={className}
      variants={variants}
      initial="hidden"
      animate="visible"
    >
      {children}
    </motion.div>
  );
}

/**
 * StaggerGroup — wraps children with the stagger container variants so any
 * direct `MotionDiv`/`motion.*` children animate in sequence.
 */
export function StaggerGroup({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      {children}
    </motion.div>
  );
}
