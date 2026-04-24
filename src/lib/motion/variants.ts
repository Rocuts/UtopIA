/**
 * Reusable motion variants for the 1+1 Centro de Comando.
 *
 * Each variant has a "normal" and a "reduced" form. The reduced form collapses
 * durations/transforms so `prefers-reduced-motion` users see an instant swap
 * with no transform-based motion sickness triggers.
 *
 * Usage:
 *   const reduced = useReducedMotion();
 *   <motion.div variants={pickVariant(fadeUp, reduced)} initial="hidden" animate="visible" />
 *
 * For child-stagger parents:
 *   <motion.ul variants={pickVariant(staggerContainer(), reduced)} initial="hidden" animate="visible">
 *     {items.map(i => (
 *       <motion.li key={i.id} variants={pickVariant(staggerChild, reduced)}>…</motion.li>
 *     ))}
 *   </motion.ul>
 */

import type { Variants } from 'motion/react';
import { SMOOTH, SPRING, INSTANT } from './transitions';

// ─── Primitive variants (normal + reduced pairs) ────────────────────────────

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: SMOOTH },
};

export const fadeInReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: INSTANT },
};

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: SPRING },
};

export const fadeUpReduced: Variants = {
  hidden: { opacity: 0, y: 0 },
  visible: { opacity: 1, y: 0, transition: INSTANT },
};

export const fadeDown: Variants = {
  hidden: { opacity: 0, y: -8 },
  visible: { opacity: 1, y: 0, transition: SPRING },
};

export const fadeDownReduced: Variants = {
  hidden: { opacity: 0, y: 0 },
  visible: { opacity: 1, y: 0, transition: INSTANT },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1, transition: SPRING },
};

export const scaleInReduced: Variants = {
  hidden: { opacity: 0, scale: 1 },
  visible: { opacity: 1, scale: 1, transition: INSTANT },
};

export const slideInLeft: Variants = {
  hidden: { opacity: 0, x: -12 },
  visible: { opacity: 1, x: 0, transition: SPRING },
};

export const slideInLeftReduced: Variants = {
  hidden: { opacity: 0, x: 0 },
  visible: { opacity: 1, x: 0, transition: INSTANT },
};

export const slideInRight: Variants = {
  hidden: { opacity: 0, x: 12 },
  visible: { opacity: 1, x: 0, transition: SPRING },
};

export const slideInRightReduced: Variants = {
  hidden: { opacity: 0, x: 0 },
  visible: { opacity: 1, x: 0, transition: INSTANT },
};

// ─── Stagger container (factory) ────────────────────────────────────────────

/**
 * Stagger-children container variant. `delayChildren` gives a small initial
 * pause so the parent itself finishes fading before kids pop.
 */
export function staggerContainer(staggerChildren = 0.06, delayChildren = 0.04): Variants {
  return {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren,
        delayChildren,
        ...SMOOTH,
      },
    },
  };
}

export function staggerContainerReduced(): Variants {
  return {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: INSTANT },
  };
}

/** Default child variant to pair with `staggerContainer()`. */
export const staggerChild: Variants = fadeUp;
export const staggerChildReduced: Variants = fadeUpReduced;

// ─── Helper ─────────────────────────────────────────────────────────────────

/**
 * Pick the reduced variant when the user prefers reduced motion.
 *
 * Pass the normal variant as the first arg and optionally the reduced variant
 * as the third. If no reduced variant is provided, the helper infers the
 * standard pair (e.g. `fadeUp` → `fadeUpReduced`) from a lookup map.
 */
const REDUCED_MAP = new Map<Variants, Variants>([
  [fadeIn, fadeInReduced],
  [fadeUp, fadeUpReduced],
  [fadeDown, fadeDownReduced],
  [scaleIn, scaleInReduced],
  [slideInLeft, slideInLeftReduced],
  [slideInRight, slideInRightReduced],
  [staggerChild, staggerChildReduced],
]);

export function pickVariant(
  variant: Variants,
  reduced: boolean | null | undefined,
  reducedVariant?: Variants,
): Variants {
  if (!reduced) return variant;
  if (reducedVariant) return reducedVariant;
  return REDUCED_MAP.get(variant) ?? variant;
}
