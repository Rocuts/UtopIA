'use client';

import Link from 'next/link';
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Landmark,
  LayoutDashboard,
  Scale,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { cn } from '@/lib/utils';
import type { PymeModule, PymeModuleId, Tone } from '../types';

const MODULE_ICON: Record<PymeModuleId, LucideIcon> = {
  dashboard: LayoutDashboard,
  libro: BookOpen,
  obligaciones: Scale,
  empleados: Users,
  banco: Landmark,
  fechas: CalendarDays,
};

const BADGE_TONE: Record<Tone, string> = {
  neutral: 'border-n-300 bg-n-100 text-n-700',
  positive: 'border-success/30 bg-success/10 text-success',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  danger: 'border-danger/30 bg-danger/10 text-danger',
};

/**
 * Tarjeta de acceso del panel Pyme (mismo idioma que ActionTile de
 * ContabilidadLanding: chip gold h-12, ícono lucide h-6 stroke 1.6).
 *
 * Si `module.href` existe es un Link interactivo con su badge de datos. Si no,
 * es un tile inerte que muestra SOLO "Próximamente" (sin badge de datos, para
 * no aparentar que es accionable). Sin opacity extra — el texto se mantiene en
 * un tinte que cumple AA.
 */
export function PymeAccessTile({ module }: { module: PymeModule }) {
  const { t } = useLanguage();
  const c = t.pyme.cockpit;
  const Icon = MODULE_ICON[module.id];
  const label = c[`module_${module.id}`];
  const ready = module.href != null;

  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span
          aria-hidden="true"
          className={cn(
            'inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-lg',
            ready ? 'bg-area-pyme/10 text-area-pyme' : 'bg-n-100 text-n-500',
          )}
        >
          <Icon className="h-6 w-6" strokeWidth={1.6} />
        </span>
        {ready && module.badge ? (
          <span
            className={cn(
              'inline-flex items-center rounded-full border px-2 py-0.5',
              'font-mono text-2xs uppercase tracking-eyebrow tabular-nums',
              BADGE_TONE[module.badgeTone],
            )}
          >
            {module.badge}
          </span>
        ) : !ready ? (
          <span className="inline-flex items-center rounded-full border border-n-300 bg-n-100 px-2 py-0.5 font-mono text-2xs uppercase tracking-eyebrow text-n-700">
            {c.coming_soon}
          </span>
        ) : null}
      </div>

      <div className="mt-4 flex items-end justify-between gap-2">
        <h3
          className={cn(
            'font-serif-elite text-base font-normal',
            ready ? 'text-n-1000' : 'text-n-700',
          )}
        >
          {label}
        </h3>
        {ready && (
          <ArrowRight
            className="h-4 w-4 shrink-0 text-n-500 transition-transform group-hover:translate-x-0.5 group-hover:text-area-pyme"
            strokeWidth={1.75}
            aria-hidden="true"
          />
        )}
      </div>
    </>
  );

  const base = 'group relative flex flex-col rounded-xl border bg-n-0 p-5 min-h-[120px]';

  if (!ready || !module.href) {
    return <div className={cn(base, 'border-n-200/70')}>{inner}</div>;
  }

  return (
    <Link
      href={module.href}
      className={cn(
        base,
        'border-area-pyme/20 transition-all duration-200',
        'hover:-translate-y-0.5 hover:border-area-pyme/50 hover:shadow-e3',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-area-pyme focus-visible:ring-offset-2 focus-visible:ring-offset-n-0',
      )}
    >
      {inner}
    </Link>
  );
}
