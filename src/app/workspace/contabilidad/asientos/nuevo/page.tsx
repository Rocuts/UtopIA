/**
 * /workspace/contabilidad/asientos/nuevo — Nuevo asiento contable.
 *
 * Integración IW5b (auditoría 2026-09-24, reportes-export-06): la página
 * anterior enviaba a /api/accounting/journal un payload incompatible (código
 * de cuenta en lugar de accountId, sin periodId, sourceType 'ajuste' /
 * 'apertura' inexistentes), así que toda contabilización respondía 400, y
 * convertía los montos ilegibles en "0" con parseCOP. Se monta el flujo real:
 * `NewEntryWorkspace` → `JournalEntryForm` (período abierto, cuentas del PUC
 * del workspace, montos con parseCOPStrict y error visible).
 */

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { NewEntryWorkspace } from '@/components/workspace/accounting/NewEntryWorkspace';

export default function NuevoAsientoPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 md:px-6 md:py-10">
      <Link
        href="/workspace/contabilidad"
        className="inline-flex items-center gap-1.5 mb-6 text-xs font-mono uppercase tracking-widest text-n-600 hover:text-n-1000 transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Contabilidad
      </Link>
      <NewEntryWorkspace />
    </div>
  );
}
