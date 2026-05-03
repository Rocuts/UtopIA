/**
 * /workspace/contabilidad/apertura — importador de saldos iniciales.
 *
 * SSR shell delgado: el flujo (selector de periodo, drag-and-drop,
 * preview, importación) lo gestiona `<OpeningBalanceUploader />`.
 */
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { OpeningBalanceUploader } from '@/components/workspace/accounting/OpeningBalanceUploader';

export default function OpeningBalancePage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8 md:py-10">
      <Link
        href="/workspace/contabilidad"
        className="inline-flex items-center gap-1.5 text-xs-mono uppercase tracking-eyebrow text-n-700 hover:text-n-1000 mb-6 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 rounded"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Contabilidad
      </Link>
      <header className="mb-6">
        <p className="font-mono text-xs-mono uppercase tracking-eyebrow text-area-verdad font-medium">
          Saldos iniciales
        </p>
        <h1 className="mt-1 font-serif-elite text-3xl text-n-1000 tracking-tight">
          Importar apertura del periodo
        </h1>
        <p className="mt-1.5 text-sm text-n-700">
          Sube un archivo Excel o CSV con los saldos del periodo anterior.
          El servidor mapea cada línea contra el PUC y registra los
          movimientos como asiento de apertura.
        </p>
      </header>
      <OpeningBalanceUploader />
    </div>
  );
}
