'use client';

/**
 * PymeSubpageShell — marco común de las subpáginas del área Pyme
 * (Mi Libro, Mis Fechas, Mis Pagos, Mis Empleados).
 *
 * Replica el frame del handoff: fondo tintado verde con blobs + partículas
 * (`AreaFX area="pyme"`), back link "Volver a mi negocio" al hub y la
 * `PymeBottomNav` verde fija abajo.
 */

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { AreaFX } from '@/components/workspace/AreaFX';
import { PymeBottomNav } from '@/components/workspace/pyme/PymeBottomNav';

export function PymeSubpageShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative flex min-h-full w-full flex-col"
      style={{
        background: [
          'radial-gradient(1200px 700px at 84% -14%, color-mix(in srgb, var(--color-area-pyme, #357A28) 24%, transparent), transparent 58%)',
          'linear-gradient(180deg, color-mix(in srgb, var(--color-area-pyme, #357A28) 8%, var(--color-n-0, #FCFBF8)), var(--color-n-0, #FCFBF8) 320px)',
          'color-mix(in srgb, var(--color-area-pyme, #357A28) 9%, var(--color-n-0, #FCFBF8))',
        ].join(', '),
      }}
    >
      <AreaFX area="pyme" />

      <div className="relative z-[2] mx-auto w-full max-w-5xl flex-1 px-4 pt-7 pb-16 sm:px-6 lg:px-8">
        {/* Back link */}
        <Link
          href="/workspace/pyme"
          className="mb-5 inline-flex items-center gap-1.5 rounded-sm text-sm text-n-600 transition-colors hover:text-n-1000 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-area-pyme"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          Volver a mi negocio
        </Link>

        {children}
      </div>

      <PymeBottomNav />
    </div>
  );
}
