/**
 * /workspace/contabilidad/periodos — Gestión de períodos contables.
 *
 * Integración IW5b (auditoría 2026-09-24, contab-nomina-04): la página era una
 * maqueta (Ene–Jun 2026 fijos) y su botón «Cerrar período» sólo simulaba el
 * cierre con setTimeout. Se monta el gestor real, que abre períodos (incluido
 * el 13 del cierre anual), cierra los mensuales con /api/accounting/periods/close
 * y corre el cierre anual con el workflow /api/accounting/close/start.
 */

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { PeriodsManagementView } from '@/components/workspace/accounting/PeriodsManagementView';

export default function PeriodosPage() {
  return (
    <div>
      <div className="mx-auto w-full max-w-7xl px-6 pt-8">
        <Link
          href="/workspace/contabilidad"
          className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-widest text-n-600 hover:text-n-1000 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Contabilidad
        </Link>
      </div>
      <PeriodsManagementView />
    </div>
  );
}
