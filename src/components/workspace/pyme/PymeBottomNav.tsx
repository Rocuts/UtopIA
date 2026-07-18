'use client';

/**
 * PymeBottomNav — barra de navegación inferior del área Pyme.
 *
 * Port del `.pnav` del handoff (Pyme - Mi Libro / Mis Fechas / Mis Pagos /
 * Mis Empleados): barra verde oscura #1a2e0d con 4 tabs (Inicio, Fechas,
 * Mi Libro, Pagos). El tab activo se resalta en #7BC95B.
 *
 * Se monta `sticky bottom-0` dentro del <main> scrolleable del workspace
 * shell, equivalente al `position:absolute; bottom:0` del prototipo.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, CalendarClock, Home, Scale } from 'lucide-react';
import { cn } from '@/lib/utils';

const TABS = [
  { label: 'Inicio', href: '/workspace/pyme', icon: Home },
  { label: 'Fechas', href: '/workspace/pyme/fechas', icon: CalendarClock },
  { label: 'Mi Libro', href: '/workspace/pyme/libro', icon: BookOpen },
  { label: 'Pagos', href: '/workspace/pyme/pagos', icon: Scale },
] as const;

export function PymeBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegación Pyme"
      className="sticky bottom-0 z-30 grid w-full grid-cols-4 bg-[#1a2e0d] pt-2.5 pb-3.5 shadow-[0_-8px_24px_-16px_rgb(0_0_0_/_0.5)]"
    >
      {TABS.map((tab) => {
        const Icon = tab.icon;
        // "Inicio" solo activo en el hub exacto; el resto por prefijo.
        const active =
          tab.href === '/workspace/pyme'
            ? pathname === tab.href
            : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex flex-col items-center gap-1 text-[10px] font-semibold transition-colors',
              active
                ? 'text-[#7BC95B]'
                : 'text-white/60 hover:text-white/90',
            )}
          >
            <Icon className="h-[22px] w-[22px]" strokeWidth={1.75} aria-hidden="true" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
