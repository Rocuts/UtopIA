/**
 * /workspace/contabilidad/conciliacion — conciliación bancaria.
 *
 * SSR shell delgado. El flujo completo (lista de cuentas, importación de
 * extractos, reconciliación automática) lo gestiona <ConciliacionClientShell />
 * que vive en ReconciliationView.tsx.
 *
 * Si el feature flag UTOPIA_ENABLE_BANK_RECON no está activo, muestra un
 * empty state amigable — nunca un 404 ni un 500.
 */
import Link from 'next/link';
import { ArrowLeft, Landmark } from 'lucide-react';
import { ConciliacionClientShell } from '@/components/workspace/contabilidad/ReconciliationView';

export default function ConciliacionPage() {
  const enabled = process.env.UTOPIA_ENABLE_BANK_RECON === 'true';

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8 md:py-10">
      {/* Breadcrumb */}
      <Link
        href="/workspace/contabilidad"
        className="inline-flex items-center gap-1.5 text-xs-mono uppercase tracking-eyebrow text-n-700 hover:text-n-1000 mb-6 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 rounded"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Contabilidad
      </Link>

      {/* Header */}
      <header className="mb-8">
        <p className="font-mono text-xs-mono uppercase tracking-eyebrow text-gold-600 font-medium">
          Tesorería · WS3
        </p>
        <h1 className="mt-1 font-serif-elite text-3xl text-n-1000 tracking-tight">
          Conciliación bancaria
        </h1>
        <p className="mt-1.5 text-sm text-n-700 max-w-2xl">
          Importa tus extractos bancarios y reconcilia automáticamente contra
          el libro mayor. La diferencia bancaria es uno de los gates del cierre
          mensual — debe estar en cero (o dentro de la tolerancia de{' '}
          <span className="font-mono text-n-900">$1.000</span> / 0,1%) para
          poder bloquear el período.
        </p>
      </header>

      {/* Content */}
      {enabled ? (
        <ConciliacionClientShell />
      ) : (
        <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/50 py-20 text-center px-6">
          <Landmark className="h-10 w-10 text-zinc-600 mb-4" aria-hidden="true" />
          <p className="text-sm font-medium text-zinc-400 mb-1">
            Función deshabilitada en este workspace
          </p>
          <p className="text-xs text-zinc-600 max-w-xs">
            Activa la variable de entorno{' '}
            <code className="font-mono bg-zinc-800 px-1 rounded">
              UTOPIA_ENABLE_BANK_RECON=true
            </code>{' '}
            para habilitar el módulo de conciliación bancaria.
          </p>
        </div>
      )}
    </div>
  );
}
