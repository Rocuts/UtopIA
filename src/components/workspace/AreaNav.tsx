'use client';

/**
 * AreaNav — Nav horizontal de las 4 áreas del Centro de Comando Elite.
 *
 * Cada pill navega a `/workspace/{slug}`:
 *   Escudo → /workspace/escudo
 *   Valor  → /workspace/valor
 *   Verdad → /workspace/verdad
 *   Futuro → /workspace/futuro
 *
 * Ruta activa se detecta con usePathname() — `startsWith` para soportar
 * sub-rutas (p.ej. /workspace/escudo/defensa-dian).
 *
 * Responsive: en viewport <md colapsa a dropdown.
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
}

const AREAS: AreaItem[] = [
  { key: 'escudo', icon: Shield, href: '/workspace/escudo' },
  { key: 'valor', icon: TrendingUp, href: '/workspace/valor' },
  { key: 'verdad', icon: CheckCircle, href: '/workspace/verdad' },
  { key: 'futuro', icon: Compass, href: '/workspace/futuro' },
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
        {AREAS.map(({ key, icon: Icon, href }) => {
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
                  'group relative flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium uppercase tracking-wider',
                  'transition-colors duration-200',
                  isActive
                    ? 'text-[#F5F5F5]'
                    : 'text-[#A8A8A8] hover:text-[#F5F5F5]',
                )}
              >
                <Icon
                  className={cn(
                    'w-3.5 h-3.5 shrink-0 transition-colors',
                    isActive ? 'text-[#D4A017]' : 'text-[#A8A8A8] group-hover:text-[#D4A017]',
                  )}
                  strokeWidth={2}
                />
                <span className="whitespace-nowrap">{areaCopy.concept}</span>
                {isActive && (
                  <motion.span
                    layoutId="area-nav-underline"
                    aria-hidden="true"
                    className="absolute left-3 right-3 -bottom-0.5 h-[2px] rounded-full"
                    style={{
                      background:
                        'linear-gradient(90deg, rgba(212,160,23,0) 0%, #D4A017 40%, #722F37 100%)',
                    }}
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
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium uppercase tracking-wider',
            'text-[#F5F5F5] border border-[rgba(212,160,23,0.25)] bg-[rgba(10,10,10,0.6)]',
          )}
        >
          <span className="truncate max-w-[120px]">{activeLabel}</span>
          <ChevronDown
            className={cn(
              'w-3.5 h-3.5 transition-transform text-[#D4A017]',
              menuOpen ? 'rotate-180' : '',
            )}
          />
        </button>

        <AnimatePresence>
          {menuOpen && (
            <motion.ul
              role="menu"
              initial={prefersReduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={prefersReduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className={cn(
                'absolute top-full left-0 mt-2 min-w-[200px] py-1 z-[60]',
                'glass-elite-elevated',
              )}
            >
              {AREAS.map(({ key, icon: Icon, href }) => {
                const isActive = activeKey === key;
                const areaCopy = areas[key];
                return (
                  <li key={key} role="none">
                    <button
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        router.push(href);
                      }}
                      className={cn(
                        'w-full flex items-start gap-2.5 px-3 py-2 text-left',
                        'hover:bg-[rgba(212,160,23,0.08)] transition-colors',
                        isActive ? 'bg-[rgba(212,160,23,0.12)]' : '',
                      )}
                    >
                      <Icon
                        className={cn(
                          'w-4 h-4 mt-0.5 shrink-0',
                          isActive ? 'text-[#D4A017]' : 'text-[#A8A8A8]',
                        )}
                        strokeWidth={2}
                      />
                      <span className="flex-1 min-w-0">
                        <span
                          className={cn(
                            'block text-sm font-semibold uppercase tracking-wider',
                            isActive ? 'text-[#F5F5F5]' : 'text-[#E5E5E5]',
                          )}
                        >
                          {areaCopy.concept}
                        </span>
                        <span className="block text-[10px] text-[#A8A8A8] mt-0.5 normal-case tracking-normal">
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
