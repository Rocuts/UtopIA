/**
 * /workspace/contabilidad/mayor — libro mayor (general ledger).
 *
 * SSR shell delgado. El cuerpo (filtros + tabla con saldo acumulado) lo
 * gestiona `<LedgerView />`.
 */
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { LedgerView } from '@/components/workspace/accounting/LedgerView';

export const dynamic = 'force-dynamic';

export default function LedgerPage() {
  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8 md:py-10">
      <Link
        href="/workspace/contabilidad"
        className="inline-flex items-center gap-1.5 text-xs-mono uppercase tracking-eyebrow text-n-700 hover:text-n-1000 mb-6 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 rounded"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Contabilidad
      </Link>
      <header className="mb-6">
        <p className="font-mono text-xs-mono uppercase tracking-eyebrow text-gold-600 font-medium">
          Libro mayor
        </p>
        <h1 className="mt-1 font-serif-elite text-3xl text-n-1000 tracking-tight">
          Movimientos por cuenta
        </h1>
        <p className="mt-1.5 text-sm text-n-700">
          Vista del libro mayor con saldo acumulado. Filtra por cuenta,
          periodo, tercero o centro de costo.
        </p>
      </header>
      <LedgerView />
    </div>
  );
}
