'use client';

/**
 * EliteHeader — Top sticky header del Centro de Comando.
 *
 * Layout (64px):
 *   [Brand "1+1" serif]  [AreaNav centro]  [NiifEliteButton | Lang | User]
 *
 * - Brand en font-serif-elite, gold accent, click → /workspace (home dashboard)
 * - glass-elite background, border-bottom dorado sutil
 * - Skip-to-content link preservado arriba (sr-only hasta focus)
 * - No se oculta al scroll down — siempre sticky (decisión: el shell es un centro
 *   de mando, la barra es parte de la identidad; ocultarla sólo confunde al usuario)
 *
 * Subcomponentes privados:
 *   - BrandMark: wordmark 1+1 con acento dorado en "+"
 *   - LanguageToggle: ES/EN pill
 *   - UserMenu: avatar iniciales → dropdown (settings, logout stubs)
 *
 * Accesibilidad:
 *   - Banner role en el header
 *   - AreaNav ya tiene su propio aria-label
 *   - Todos los interactivos con focus-visible
 */
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  Globe,
  User as UserIcon,
  Settings,
  LogOut,
  FileText,
  ChevronDown,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { cn } from '@/lib/utils';
import { AreaNav } from './AreaNav';
import { NiifEliteButton } from './NiifEliteButton';

// ─── Brand ───────────────────────────────────────────────────────────────────

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/workspace"
      prefetch={false}
      className={cn(
        'group flex items-center gap-2 rounded-md px-1.5 py-1',
        'transition-colors hover:bg-[rgba(212,160,23,0.06)]',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A017] focus-visible:ring-offset-2 focus-visible:ring-offset-[#030303]',
      )}
      aria-label="1+1 — Centro de Comando"
    >
      <span
        className={cn(
          'font-serif-elite leading-none tracking-tight text-[#F5F5F5]',
          compact ? 'text-[22px]' : 'text-[26px] md:text-[28px]',
        )}
      >
        1
        <span
          className="bg-clip-text text-transparent"
          style={{
            backgroundImage:
              'linear-gradient(135deg, #D4A017 0%, #E8B42C 50%, #D4A017 100%)',
          }}
        >
          +
        </span>
        1
      </span>
      <span
        className={cn(
          'hidden lg:inline-block h-5 w-px bg-[rgba(212,160,23,0.35)]',
          compact ? 'hidden' : '',
        )}
        aria-hidden="true"
      />
      <span
        className={cn(
          'hidden lg:inline text-[10px] uppercase tracking-[0.18em] text-[#A8A8A8] font-medium',
          compact ? 'hidden' : '',
        )}
      >
        Command
      </span>
    </Link>
  );
}

// ─── Language Toggle ─────────────────────────────────────────────────────────

function LanguageToggle() {
  const { language, setLanguage } = useLanguage();
  const next = language === 'es' ? 'en' : 'es';
  return (
    <button
      type="button"
      onClick={() => setLanguage(next)}
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md',
        'text-[11px] font-medium font-[family-name:var(--font-geist-mono)] uppercase',
        'text-[#A8A8A8] hover:text-[#F5F5F5] transition-colors',
        'border border-transparent hover:border-[rgba(212,160,23,0.25)]',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A017] focus-visible:ring-offset-2 focus-visible:ring-offset-[#030303]',
      )}
      aria-label={language === 'es' ? 'Switch to English' : 'Cambiar a Español'}
      title={next.toUpperCase()}
    >
      <Globe className="w-3.5 h-3.5" />
      <span>{next}</span>
    </button>
  );
}

// ─── User Menu ───────────────────────────────────────────────────────────────

function UserMenu() {
  const { language } = useLanguage();
  const { lastCompletedReport, setActiveCaseType, setActiveMode } = useWorkspace();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const prefersReduced = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const el = rootRef.current;
      if (!el) return;
      if (!el.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const initials = 'YO'; // Placeholder — no hay auth todavía en UtopIA. Futuro: sacar de user profile.

  const labels = {
    profile: language === 'es' ? 'Perfil' : 'Profile',
    settings: language === 'es' ? 'Configuración' : 'Settings',
    reports: language === 'es' ? 'Reportes guardados' : 'Saved reports',
    signOut: language === 'es' ? 'Cerrar sesión' : 'Sign out',
    menu: language === 'es' ? 'Menú de usuario' : 'User menu',
    lastReport: language === 'es' ? 'Último reporte' : 'Last report',
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={labels.menu}
        className={cn(
          'flex items-center gap-1.5 rounded-md pl-1 pr-2 py-1',
          'hover:bg-[rgba(212,160,23,0.08)] transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A017] focus-visible:ring-offset-2 focus-visible:ring-offset-[#030303]',
        )}
      >
        <span
          className={cn(
            'inline-flex items-center justify-center w-7 h-7 rounded-full',
            'bg-gradient-to-br from-[#D4A017] to-[#722F37] text-[#0a0a0a]',
            'text-[11px] font-bold font-[family-name:var(--font-geist-mono)]',
          )}
          aria-hidden="true"
        >
          {initials}
        </span>
        <ChevronDown
          className={cn(
            'w-3 h-3 text-[#A8A8A8] transition-transform',
            open ? 'rotate-180' : '',
          )}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={prefersReduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={prefersReduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className={cn(
              'absolute right-0 top-full mt-2 min-w-[220px] py-1 z-[60]',
              'glass-elite-elevated',
            )}
          >
            {lastCompletedReport && (
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  setOpen(false);
                  setActiveCaseType('niif_report');
                  setActiveMode('result');
                  router.push('/workspace');
                }}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 text-left text-xs',
                  'text-[#E5E5E5] hover:bg-[rgba(212,160,23,0.08)] transition-colors',
                )}
              >
                <FileText className="w-3.5 h-3.5 text-[#D4A017]" />
                <span className="flex-1 min-w-0">
                  <span className="block font-medium truncate">{labels.lastReport}</span>
                  <span className="block text-[10px] text-[#A8A8A8] truncate">
                    {lastCompletedReport.company.name}
                  </span>
                </span>
              </button>
            )}
            <Link
              href="/workspace/settings"
              prefetch={false}
              role="menuitem"
              onClick={() => setOpen(false)}
              className={cn(
                'flex items-center gap-2 px-3 py-2 text-xs',
                'text-[#E5E5E5] hover:bg-[rgba(212,160,23,0.08)] transition-colors',
              )}
            >
              <Settings className="w-3.5 h-3.5 text-[#A8A8A8]" />
              <span>{labels.settings}</span>
            </Link>
            <button
              role="menuitem"
              type="button"
              onClick={() => setOpen(false)}
              disabled
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-xs text-left',
                'text-[#6A6A6A] cursor-not-allowed opacity-70',
              )}
              title={language === 'es' ? 'Próximamente' : 'Coming soon'}
            >
              <UserIcon className="w-3.5 h-3.5" />
              <span>{labels.profile}</span>
            </button>
            <div
              className="my-1 mx-2 h-px bg-[rgba(212,160,23,0.18)]"
              aria-hidden="true"
            />
            <button
              role="menuitem"
              type="button"
              onClick={() => setOpen(false)}
              disabled
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-xs text-left',
                'text-[#6A6A6A] cursor-not-allowed opacity-70',
              )}
              title={language === 'es' ? 'Próximamente' : 'Coming soon'}
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{labels.signOut}</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export interface EliteHeaderProps {
  className?: string;
}

export function EliteHeader({ className }: EliteHeaderProps) {
  const pathname = usePathname() ?? '';
  // En ciertas rutas (ej. full-screen pipeline) podríamos querer compactar el header.
  // Por ahora, compact lo reservamos para futuro.
  const compact = false;

  // Hide the area nav underline on workspace home (/workspace) where the
  // dashboard itself shows the 4-area grid — avoids duplicate emphasis.
  const isHome = pathname === '/workspace' || pathname === '/workspace/';

  return (
    <motion.header
      role="banner"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className={cn(
        'sticky top-0 z-50 w-full h-16 shrink-0',
        'flex items-center gap-3 px-4 md:px-6',
        'glass-elite',
        'border-b',
        className,
      )}
      style={{
        borderBottomColor: 'rgba(212,160,23,0.18)',
      }}
    >
      {/* Brand — left */}
      <div className="flex items-center shrink-0">
        <BrandMark compact={compact} />
      </div>

      {/* AreaNav — center */}
      <div className={cn('flex-1 flex items-center justify-center min-w-0', isHome ? 'opacity-60' : '')}>
        <AreaNav />
      </div>

      {/* Actions cluster — right */}
      <div className="flex items-center gap-2 md:gap-3 shrink-0">
        <NiifEliteButton size="md" />
        <span
          className="hidden md:inline-block h-6 w-px bg-[rgba(212,160,23,0.22)]"
          aria-hidden="true"
        />
        <LanguageToggle />
        <UserMenu />
      </div>
    </motion.header>
  );
}

export default EliteHeader;
