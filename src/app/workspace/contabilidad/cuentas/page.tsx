/**
 * /workspace/contabilidad/cuentas — explorador del PUC.
 *
 * Wrapper SSR delgado. El árbol completo + búsqueda + acción "Inicializar PUC"
 * lo gestiona `<ChartOfAccountsTree />` (Client Component) que consume
 * `/api/accounting/accounts` con la cookie del workspace.
 */
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ChartOfAccountsTree } from '@/components/workspace/accounting/ChartOfAccountsTree';

export default function ChartOfAccountsPage() {
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
        <p className="font-mono text-xs-mono uppercase tracking-eyebrow text-area-escudo font-medium">
          Plan Único de Cuentas
        </p>
        <h1 className="mt-1 font-serif-elite text-3xl text-n-1000 tracking-tight">
          PUC del workspace
        </h1>
        <p className="mt-1.5 text-sm text-n-700 max-w-2xl">
          Explora la jerarquía de cuentas y marca cuáles son auxiliares
          (postables). Si aún no hay catálogo, inicialízalo con la base PUC
          colombiana.
        </p>
      </header>
      <ChartOfAccountsTree />
    </div>
  );
}
