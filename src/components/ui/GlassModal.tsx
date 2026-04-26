'use client';

import { cn } from '@/lib/utils';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';

/**
 * GlassModal — Premium modal with backdrop blur, fade+scale entrance, and
 * gold glow. Scoped to the elite theme aesthetic (dark glass), but renders
 * at the document top-level via a fixed positioned layer so it works inside
 * any subtree.
 *
 * Behaviors:
 *  - ESC to close
 *  - optional click-on-backdrop to close (`dismissOnBackdrop`, default true)
 *  - body scroll lock while open
 *  - focus trap: focus first focusable on mount, restore focus on unmount
 *  - ARIA: role="dialog", aria-modal, labelled by title when provided
 *  - Respects prefers-reduced-motion
 */

export type GlassModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

export interface GlassModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  size?: GlassModalSize;
  dismissOnBackdrop?: boolean;
  showCloseButton?: boolean;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  panelClassName?: string;
  /**
   * Optional explicit aria-label, used when `title` is not provided or is
   * not a plain string.
   */
  ariaLabel?: string;
}

const SIZE_CLASSES: Record<GlassModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-[min(96vw,1200px)]',
};

const FOCUSABLE_SELECTORS =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function GlassModal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  dismissOnBackdrop = true,
  showCloseButton = true,
  children,
  footer,
  className,
  panelClassName,
  ariaLabel,
}: GlassModalProps) {
  const shouldReduce = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();

  // Body scroll lock + restore previously focused element on close.
  useEffect(() => {
    if (!open) return;

    previouslyFocused.current =
      typeof document !== 'undefined' ? (document.activeElement as HTMLElement) : null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = prevOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  // Focus first focusable element when the panel mounts.
  useEffect(() => {
    if (!open) return;
    // Defer one frame so the node is in the DOM.
    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS);
      const first = focusables[0] ?? panel;
      first.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS),
      ).filter((el) => !el.hasAttribute('aria-hidden'));
      if (focusables.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  const handleBackdropClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!dismissOnBackdrop) return;
      if (event.target === event.currentTarget) {
        onClose();
      }
    },
    [dismissOnBackdrop, onClose],
  );

  const hasStringTitle = typeof title === 'string';
  const labelledBy = title ? titleId : undefined;
  const describedBy = description ? descId : undefined;

  const backdropMotion = shouldReduce
    ? { initial: { opacity: 1 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: 0.2, ease: 'easeOut' as const },
      };

  const panelMotion = shouldReduce
    ? { initial: { opacity: 1, scale: 1 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, scale: 0.97, y: 8 },
        animate: { opacity: 1, scale: 1, y: 0 },
        exit: { opacity: 0, scale: 0.97, y: 4 },
        transition: { duration: 0.24, ease: [0.16, 1, 0.3, 1] as const },
      };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="glass-modal-backdrop"
          className={cn(
            'fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6',
            'bg-n-1000/60 backdrop-blur-[20px]',
            className,
          )}
          onMouseDown={handleBackdropClick}
          onKeyDown={handleKeyDown}
          role="presentation"
          {...backdropMotion}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={!labelledBy ? ariaLabel : undefined}
            aria-labelledby={labelledBy}
            aria-describedby={describedBy}
            tabIndex={-1}
            className={cn(
              'relative w-full outline-none',
              'glass-elite-elevated glow-gold-soft',
              'text-n-100',
              SIZE_CLASSES[size],
              'max-h-[90vh] flex flex-col',
              panelClassName,
            )}
            {...panelMotion}
          >
            {(title || showCloseButton) && (
              <div className="shrink-0 flex items-start justify-between gap-4 px-6 pt-6 pb-4">
                <div className="flex-1 min-w-0">
                  {title && (
                    <div
                      id={hasStringTitle ? titleId : undefined}
                      className={cn(
                        'font-serif-elite text-2xl leading-tight font-normal text-n-100',
                      )}
                    >
                      {title}
                    </div>
                  )}
                  {description && (
                    <p
                      id={descId}
                      className="mt-1.5 text-sm text-n-500 leading-relaxed"
                    >
                      {description}
                    </p>
                  )}
                </div>
                {showCloseButton && (
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Cerrar"
                    className={cn(
                      'shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-md',
                      'text-n-500 hover:text-n-100',
                      'bg-transparent hover:bg-n-0/5',
                      'transition-colors duration-150',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2 focus-visible:ring-offset-n-900',
                    )}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            )}

            <div
              className={cn(
                'flex-1 min-h-0 overflow-y-auto',
                'px-6',
                title || showCloseButton ? 'pb-4' : 'py-6',
              )}
              // Let nested wheel events reach this container instead of being
              // consumed by Lenis smooth scroll at the document level.
              data-lenis-prevent=""
            >
              {children}
            </div>

            {footer && (
              <div
                className={cn(
                  'shrink-0 px-6 py-4 border-t border-gold-500/20',
                  'flex items-center justify-end gap-2',
                )}
              >
                {footer}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
