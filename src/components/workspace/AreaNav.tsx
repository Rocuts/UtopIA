'use client';

/**
 * AreaNav — Horizontal nav for the 4 areas of the Centro de Comando Elite.
 *
 * Each pill routes to `/workspace/{slug}`:
 *   Escudo → /workspace/escudo
 *   Valor  → /workspace/valor
 *   Verdad → /workspace/verdad
 *   Futuro → /workspace/futuro
 *
 * Active route is detected via usePathname() with `startsWith` so sub-routes
 * (e.g. /workspace/escudo/defensa-dian) stay highlighted.
 *
 * Responsive: collapses to a dropdown under md.
 *
 * Tokens: migrated to bg-n-* / text-n-* / bg-gold-* / border-gold-* so both
 * light (landing, if ever embedded) and dark (workspace shell) render correctly.
 */
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Shield,
  TrendingUp,
  CheckCircle,
  Compass,
  ChevronDown,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { cn } from '@/lib/utils';

// ─── Config ──────────────────────────────────────────────────────────────────

type AreaKey = 'escudo' | 'valor' | 'verdad' | 'futuro';

interface AreaItem {
  key: AreaKey;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  href: string;
  /** Tailwind color class for the icon/underline when active. */
  accentClass: string;
}

const AREAS: AreaItem[] = [
  { key: 'escudo', icon: Shield, href: '/workspace/escudo', accentClass: 'text-area-escudo' },
  { key: 'valor', icon: TrendingUp, href: '/workspace/valor', accentClass: 'text-gold-500' },
  { key: 'verdad', icon: CheckCircle, href: '/workspace/verdad', accentClass: 'text-area-verdad' },
  { key: 'futuro', icon: Compass, href: '/workspace/futuro', accentClass: 'text-area-futuro' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function useActiveArea(pathname: string): AreaKey | null {
  for (const a of AREAS) {
    if (pathname === a.href || pathname.startsWith(a.href + '/')) return a.key;
  }
  return null;
}

// ─── Component ───────────────────────────────────────────────────────────────

export interface AreaNavProps {
  className?: string;
}

export function AreaNav({ className }: AreaNavProps) {
  const { t } = useLanguage();
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const prefersReduced = useReducedMotion();
  const activeKey = useActiveArea(pathname);

  // Mobile dropdown state
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      const el = menuRef.current;
      if (!el) return;
      if (!el.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  // Close dropdown when route changes
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const areas = t.elite.areas;
  const activeLabel = activeKey ? areas[activeKey].concept : (areas.escudo.concept);

  return (
    <nav
      className={cn('relative', className)}
      aria-label="Centro de Comando — Áreas"
    >
      {/* Desktop: horizontal pills */}
      <ul
        role="list"
        className="hidden md:flex items-center gap-1"
      >
        {AREAS.map(({ key, icon: Icon, href, accentClass }) => {
          const isActive = activeKey === key;
          const areaCopy = areas[key];
          return (
            <li key={key}>
              <Link
                href={href}
                prefetch={false}
                aria-current={isActive ? 'page' : undefined}
                title={`${areaCopy.concept} — ${areaCopy.subtitle}`}
                className={cn(
                  'group relative flex items-center gap-1.5 px-3 py-1.5 rounded-md',
                  'font-mono text-xs-mono font-medium uppercase tracking-eyebrow',
                  'transition-colors duration-200',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2 focus-visible:ring-offset-n-0',
                  isActive
                    ? 'text-n-900'
                    : 'text-n-500 hover:text-n-900',
                )}
              >
                <Icon
                  aria-hidden="true"
                  className={cn(
                    'w-3.5 h-3.5 shrink-0 transition-colors',
                    isActive
                      ? accentClass
                      : cn('text-n-500 group-hover:', accentClass),
                  )}
                  strokeWidth={2}
                />
                <span className="whitespace-nowrap">{areaCopy.concept}</span>
                {isActive && (
                  <motion.span
                    layoutId="area-nav-underline"
                    aria-hidden="true"
                    className="absolute left-3 right-3 -bottom-0.5 h-[2px] rounded-full bg-gold-500"
                    transition={
                      prefersReduced
                        ? { duration: 0 }
                        : { type: 'spring', stiffness: 500, damping: 35 }
                    }
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Mobile: dropdown trigger */}
      <div ref={menuRef} className="md:hidden relative">
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={t.elite.areas[activeKey ?? 'escudo'].concept}
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-md',
            'text-xs font-medium uppercase tracking-eyebrow',
            'text-n-900 border border-gold-500/25 bg-n-50/60',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2 focus-visible:ring-offset-n-0',
          )}
        >
          <span className="truncate max-w-[120px]">{activeLabel}</span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'w-3.5 h-3.5 transition-transform text-gold-500',
              menuOpen ? 'rotate-180' : '',
            )}
          />
        </button>

        <AnimatePresence>
          {menuOpen && (
            <motion.ul
              role="menu"
              aria-label="Áreas"
              initial={prefersReduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={prefersReduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className={cn(
                'absolute top-full left-0 mt-2 min-w-[200px] py-1 z-[60]',
                'glass-elite-elevated',
              )}
            >
              {AREAS.map(({ key, icon: Icon, href, accentClass }) => {
                const isActive = activeKey === key;
                const areaCopy = areas[key];
                return (
                  <li key={key} role="none">
                    <button
                      role="menuitem"
                      type="button"
                      aria-current={isActive ? 'page' : undefined}
                      onClick={() => {
                        setMenuOpen(false);
                        router.push(href);
                      }}
                      className={cn(
                        'w-full flex items-start gap-2.5 px-3 py-2 text-left',
                        'hover:bg-gold-500/8 transition-colors',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold-500',
                        isActive ? 'bg-gold-500/12' : '',
                      )}
                    >
                      <Icon
                        aria-hidden="true"
                        className={cn(
                          'w-4 h-4 mt-0.5 shrink-0',
                          isActive ? accentClass : 'text-n-500',
                        )}
                        strokeWidth={2}
                      />
                      <span className="flex-1 min-w-0">
                        <span
                          className={cn(
                            'block text-sm font-semibold uppercase tracking-eyebrow',
                            isActive ? 'text-n-900' : 'text-n-800',
                          )}
                        >
                          {areaCopy.concept}
                        </span>
                        <span className="block text-2xs text-n-500 mt-0.5 normal-case tracking-normal">
                          {areaCopy.subtitle}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>
    </nav>
  );
}

export default AreaNav;
