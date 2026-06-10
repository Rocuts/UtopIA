'use client';

/**
 * PymeGreenHero — hero verde oscuro (#1a2e0d) de las subpáginas Pyme.
 *
 * Port del `.ghero` del handoff: tarjeta verde con círculo decorativo,
 * título display, subtítulo y una fila de métricas con borde izquierdo.
 * `children` permite contenido extra (CTA de foto en Mi Libro, barra de
 * meses en Mis Fechas).
 */

import { cn } from '@/lib/utils';

export interface GreenHeroMetric {
  value: string;
  label: string;
  /** Tinte del valor: blanco (default), verde quedó, rojo urgente, ámbar próximo. */
  tone?: 'default' | 'green' | 'red' | 'amber';
}

const TONE_CLASS: Record<NonNullable<GreenHeroMetric['tone']>, string> = {
  default: 'text-white',
  green: 'text-[#7BC95B]',
  red: 'text-[#FCA5A5]',
  amber: 'text-[#FDE68A]',
};

export function PymeGreenHero({
  title,
  subtitle,
  metrics,
  children,
}: {
  title: string;
  subtitle: string;
  metrics: GreenHeroMetric[];
  children?: React.ReactNode;
}) {
  return (
    <section className="relative mb-6 overflow-hidden rounded-2xl bg-[#1a2e0d] p-6 text-white shadow-[0_24px_48px_-28px_rgb(26_46_13_/_0.6)] sm:p-7">
      {/* Círculo decorativo */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -top-10 h-[170px] w-[170px] rounded-full bg-[#7BC95B]/[0.14]"
      />

      <div className="relative z-[1]">
        <h1 className="font-serif-elite text-2xl font-medium">{title}</h1>
        <p className="mt-1 text-sm text-white/70">{subtitle}</p>

        <div className="mt-5 grid grid-cols-1 gap-3 min-[521px]:grid-cols-3 min-[521px]:gap-4">
          {metrics.map((m) => (
            <div key={m.label} className="border-l-2 border-white/15 pl-3.5">
              <div
                className={cn(
                  'font-mono text-2xl font-semibold tabular-nums',
                  TONE_CLASS[m.tone ?? 'default'],
                )}
              >
                {m.value}
              </div>
              <div className="mt-0.5 text-xs text-white/70">{m.label}</div>
            </div>
          ))}
        </div>

        {children}
      </div>
    </section>
  );
}
