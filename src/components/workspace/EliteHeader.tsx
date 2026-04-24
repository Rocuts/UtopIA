'use client';

/**
 * EliteHeader — Sticky top header of the Centro de Comando.
 *
 * Layout (64px):
 *   [Brand "1+1" serif]  [Search (Cmd+K)]  [AreaNav — hidden on home]
 *   [NiifEliteButton | Lang | User]
 *
 * - Brand in font-serif-elite, gold accent, click → /workspace (home dashboard)
 * - Cmd+K search trigger is ALWAYS visible from lg+ so the command palette is
 *   discoverable. Clicking it fires a synthesized keydown that the shell's
 *   global listener (src/app/workspace/layout.tsx) catches and toggles on.
 * - On `/workspace` (home) the AreaNav is hidden — the 4 AreaCards below are
 *   the canonical nav. Showing both doubles the visual weight for no benefit.
 *
 * Subcomponents:
 *   - BrandMark: wordmark 1+1 with gold-accented "+"
 *   - SearchTrigger: visible Cmd+K button with kbd glyph
 *   - LanguageToggle: ES/EN pill
 *   - UserMenu: initials avatar → dropdown (settings, logout stubs)
 *
 * Accessibility:
 *   - role="banner" on header
 *   - AreaNav has its own aria-label
 *   - All interactive elements have focus-visible
 */
import { useState, useEffect, useRef, useCallback } from 'react';
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
  Search,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { cn } from '@/lib/utils';
import { AreaNav } from './AreaNav';
import { NiifEliteButton } from './NiifEliteButton';
import { ThemeToggle } from './ThemeToggle';

// ─── Brand ───────────────────────────────────────────────────────────────────

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/workspace"
      prefetch={false}
      className={cn(
        'group flex items-center gap-2 rounded-md px-1.5 py-1',
        'transition-colors hover:bg-gold-500/6',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2 focus-visible:ring-offset-n-0',
      )}
      aria-label="1+1 — Centro de Comando"
    >
      <span
        className={cn(
          'font-serif-elite leading-none tracking-tight text-n-900',
          compact ? 'text-xl' : 'text-2xl md:text-3xl',
        )}
      >
        1
        <span
          className="bg-clip-text text-transparent"
          style={{
            backgroundImage:
              'linear-gradient(135deg, var(--color-gold-500) 0%, var(--color-gold-600) 50%, var(--color-gold-500) 100%)',
          }}
        >
          +
        </span>
        1
      </span>
      <span
        className={cn(
          'hidden lg:inline-block h-5 w-px bg-gold-500/35',
          compact ? 'hidden' : '',
        )}
        aria-hidden="true"
      />
      <span
        className={cn(
          'hidden lg:inline font-mono text-xs-mono uppercase tracking-eyebrow text-n-500 font-medium',
          compact ? 'hidden' : '',
        )}
      >
        Command
      </span>
    </Link>
  );
}

// ─── Search Trigger (Cmd+K) ─────────────────────────────────────────────────

function SearchTrigger() {
  const { language } = useLanguage();

  const handleClick = useCallback(() => {
    // The shell listens for Cmd+K on window; synthesize the event so the
    // trigger is a discoverable visual surface without duplicating state.
    // Using KeyboardEvent constructor (not `new KeyboardEvent('keydown', {...})`
    // directly because `metaKey`/`ctrlKey` aren't on `KeyboardEventInit` in
    // older TS libs — we cast to the DOM standard init dict).
    const isMac = typeof navigator !== 'undefined'
      ? navigator.platform.toLowerCase().includes('mac')
      : true;
    const event = new KeyboardEvent('keydown', {
      key: 'k',
      code: 'KeyK',
      bubbles: true,
      cancelable: true,
      ...(isMac ? { metaKey: true } : { ctrlKey: true }),
    } as KeyboardEventInit);
    window.dispatchEvent(event);
  }, []);

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={language === 'es' ? 'Abrir búsqueda' : 'Open search'}
      className={cn(
        'hidden lg:flex items-center gap-2 w-72 px-3 h-9 rounded-md',
        'bg-n-50 border border-n-200 text-n-500 text-sm',
        'hover:border-gold-500/40 hover:text-n-700 transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2 focus-visible:ring-offset-n-0',
      )}
    >
      <Search className="w-4 h-4" />
      <span className="truncate">
        {language === 'es' ? 'Buscar caso, cliente, norma…' : 'Search case, client, norm…'}
      </span>
      <kbd
        className={cn(
          'ml-auto font-mono text-xs-mono px-1.5 py-0.5 rounded-xs',
          'bg-n-100 text-n-600 border border-n-200',
        )}
      >
        {typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')
          ? '⌘K'
          : 'Ctrl K'}
      </kbd>
    </button>
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
        'font-mono text-xs-mono font-medium uppercase',
        'text-n-500 hover:text-n-900 transition-colors',
        'border border-transparent hover:border-gold-500/25',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2 focus-visible:ring-offset-n-0',
      )}
      aria-label={language === 'es' ? 'Switch to English' : 'Cambiar a Español'}
      title={next.toUpperCase()}
    >
      <Globe className="w-3.5 h-3.5" aria-hidden="true" />
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

  const initials = 'YO'; // Placeholder — no auth yet.

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
          'hover:bg-gold-500/8 transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2 focus-visible:ring-offset-n-0',
        )}
      >
        <span
          className={cn(
            'inline-flex items-center justify-center w-7 h-7 rounded-full',
            'bg-gradient-to-br from-gold-500 to-area-escudo text-n-0',
            'font-mono text-xs-mono font-bold',
          )}
          aria-hidden="true"
        >
          {initials}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'w-3 h-3 text-n-500 transition-transform',
            open ? 'rotate-180' : '',
          )}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label={labels.menu}
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
                  'text-n-800 hover:bg-gold-500/8 transition-colors',
                )}
              >
                <FileText className="w-3.5 h-3.5 text-gold-500" />
                <span className="flex-1 min-w-0">
                  <span className="block font-medium truncate">{labels.lastReport}</span>
                  <span className="block text-2xs text-n-500 truncate">
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
                'text-n-800 hover:bg-gold-500/8 transition-colors',
              )}
            >
              <Settings className="w-3.5 h-3.5 text-n-500" />
              <span>{labels.settings}</span>
            </Link>
            <button
              role="menuitem"
              type="button"
              onClick={() => setOpen(false)}
              disabled
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-xs text-left',
                'text-n-400 cursor-not-allowed opacity-70',
              )}
              title={language === 'es' ? 'Próximamente' : 'Coming soon'}
            >
              <UserIcon className="w-3.5 h-3.5" />
              <span>{labels.profile}</span>
            </button>
            <div
              className="my-1 mx-2 h-px bg-gold-500/18"
              aria-hidden="true"
            />
            <button
              role="menuitem"
              type="button"
              onClick={() => setOpen(false)}
              disabled
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-xs text-left',
                'text-n-400 cursor-not-allowed opacity-70',
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
  const prefersReduced = useReducedMotion();
  // Reserved for future: some surfaces may want a compact header.
  const compact = false;

  // On workspace home the dashboard itself presents the 4-area grid. Rendering
  // AreaNav there duplicates navigation weight for zero signal gain — we hide
  // it entirely instead of dimming it.
  const isHome = pathname === '/workspace' || pathname === '/workspace/';

  return (
    <motion.header
      role="banner"
      aria-label="1+1"
      initial={prefersReduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={prefersReduced ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 30 }}
      className={cn(
        'sticky top-0 z-50 w-full h-16 shrink-0',
        'flex items-center gap-3 px-4 md:px-6',
        'glass-elite',
        'border-b border-gold-500/18',
        className,
      )}
    >
      {/* Brand — left */}
      <div className="flex items-center shrink-0">
        <BrandMark compact={compact} />
      </div>

      {/* Search (Cmd+K) — visible on lg+, between brand and nav */}
      <div className="shrink-0">
        <SearchTrigger />
      </div>

      {/* AreaNav — center; hidden on home */}
      <div
        className={cn(
          'flex-1 flex items-center justify-center min-w-0',
          isHome ? 'hidden' : '',
        )}
      >
        <AreaNav />
      </div>

      {/* Flex spacer when nav is hidden, so right cluster stays right */}
      {isHome && <div className="flex-1" />}

      {/* Actions cluster — right */}
      <div className="flex items-center gap-2 md:gap-3 shrink-0">
        <NiifEliteButton size="md" />
        <span
          className="hidden md:inline-block h-6 w-px bg-gold-500/22"
          aria-hidden="true"
        />
        <LanguageToggle />
        <ThemeToggle />
        <UserMenu />
      </div>
    </motion.header>
  );
}

export default EliteHeader;
