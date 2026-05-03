/**
 * /workspace/contabilidad/asientos/nuevo — formulario de nuevo asiento.
 *
 * Patrón: Server Component wrapper que renderiza un Client Component
 * (`<NewEntryWorkspace />`). El cliente resuelve los periodos via
 * `GET /api/accounting/periods` (cookie httpOnly del workspace) antes de
 * montar `<JournalEntryForm />` con la lista correcta. La cuentas se
 * cargan dentro del propio formulario via `<AccountAutocomplete />`.
 */

import { NewEntryWorkspace } from '@/components/workspace/accounting/NewEntryWorkspace';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function NewEntryPage() {
  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8 md:py-10">
      <Link
        href="/workspace/contabilidad"
        className="inline-flex items-center gap-1.5 text-xs-mono uppercase tracking-eyebrow text-n-700 hover:text-n-1000 mb-6 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 rounded"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Contabilidad
      </Link>
      <NewEntryWorkspace />
    </div>
  );
}
