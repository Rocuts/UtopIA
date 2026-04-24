/**
 * Shared motion transition tokens for the 1+1 Centro de Comando.
 *
 * These presets subsume the ad-hoc `{ type: 'spring', stiffness, damping }`
 * literals scattered across `src/components/sections/*` (NOVA_SPRING) and
 * `src/components/workspace/*` (SPRING). Future refactors can migrate call
 * sites; new code should prefer these tokens.
 *
 * Ease curve `[0.4, 0, 0.2, 1]` is Material-style "standard" (the same one
 * used by Tailwind's `ease-in-out` shim and the Lenis docs recommendation).
 */

import type { Transition } from 'motion/react';

/** Quick micro-interactions (hover tint, chip pop). */
export const FAST: Transition = { duration: 0.18, ease: 'easeOut' };

/** Reveal / layout transitions (modals, sidebars, list items). */
export const SMOOTH: Transition = { duration: 0.34, ease: [0.4, 0, 0.2, 1] };

/**
 * Default spring — matches the legacy `NOVA_SPRING`/`SPRING` constants that
 * landed at `{ stiffness: 400, damping: 25 }`. Bumped damping slightly so
 * stacked animations don't visibly overshoot in sequence.
 */
export const SPRING: Transition = { type: 'spring', stiffness: 320, damping: 28 };

/** Softer, slower spring for hero/intro reveals. */
export const GENTLE_SPRING: Transition = { type: 'spring', stiffness: 180, damping: 22 };

/** Instant transition for reduced-motion users. */
export const INSTANT: Transition = { duration: 0 };

/**
 * Choose between a normal transition and the instant one based on the
 * `useReducedMotion()` hook result.
 */
export function pickTransition(t: Transition, reduced: boolean | null | undefined): Transition {
  return reduced ? INSTANT : t;
}
