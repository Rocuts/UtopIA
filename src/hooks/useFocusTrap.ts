'use client';

import { useEffect, type RefObject } from 'react';

const FOCUSABLE_SELECTORS =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Traps focus inside the provided ref while active. Restores focus to the previously
 * focused element when deactivated. Calls onEscape when the user presses Escape.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onEscape?: () => void,
) {
  useEffect(() => {
    if (!active) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const node = ref.current;
    if (!node) return;

    const focusables = node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS);
    if (focusables.length > 0) {
      focusables[0].focus();
    } else {
      node.setAttribute('tabindex', '-1');
      node.focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (onEscape) {
          e.preventDefault();
          onEscape();
        }
        return;
      }
      if (e.key !== 'Tab') return;

      const currentFocusables = Array.from(
        node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS),
      );
      if (currentFocusables.length === 0) return;

      const first = currentFocusables[0];
      const last = currentFocusables[currentFocusables.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [ref, active, onEscape]);
}
