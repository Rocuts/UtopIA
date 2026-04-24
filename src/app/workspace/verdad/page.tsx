'use client';

/**
 * Ventana III — La Verdad (Aseguramiento y Dictamen).
 *
 * Esta es la página overview que consume el componente reutilizable
 * `VerdadArea`. Se envuelve con `data-theme="elite"` para que todas las
 * utilidades `.glass-elite-*`, `border-elite-gold` y la escala de color
 * gold/wine se comporten con el contexto correcto.
 */

import { VerdadArea } from '@/components/workspace/areas/VerdadArea';
import { mockCompliance } from '@/lib/kpis/mocks';

export default function VerdadOverviewPage() {
  return (
    <div
      data-theme="elite"
      data-lenis-prevent
      className="min-h-full w-full overflow-y-auto bg-n-1000"
    >
      <div className="mx-auto w-full max-w-[1280px] px-5 md:px-8 py-8 md:py-12">
        <VerdadArea kpi={mockCompliance} lastOpinion="favorable" />
      </div>
    </div>
  );
}
