'use client';

/**
 * /workspace/contabilidad/conciliacion — Conciliación bancaria.
 *
 * Integración IW5b (auditoría 2026-09-24): la página era una maqueta (saldo
 * libro $12.400.000, extracto $12.680.000, cheque 0451…) sin rótulo. Se monta
 * el flujo real `ConciliacionClientShell` (cuentas bancarias, extractos y
 * estado de conciliación del período desde /api/accounting/banking/*), que ya
 * distingue «No conciliable — sin extracto del período» (contab-nomina-09).
 */

import Link from 'next/link';
import { ArrowLeft, ArrowLeftRight } from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { ConciliacionClientShell } from '@/components/workspace/contabilidad/ReconciliationView';

export default function ConciliacionPage() {
  const { t } = useLanguage();
  const ac = t.accounting;
  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8 md:py-10">
      <Link
        href="/workspace/contabilidad"
        className="inline-flex items-center gap-1.5 mb-6 text-xs font-mono uppercase tracking-widest text-n-600 hover:text-n-1000 transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        {ac.backToOverview}
      </Link>
      <header className="mb-8">
        <p className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-gold-600 font-medium">
          <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
          {ac.title}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-n-1000">
          {ac.bankReconciliation}
        </h1>
        <p className="mt-1.5 text-sm text-n-700 max-w-2xl">{ac.bankReconciliationDesc}</p>
      </header>
      <ConciliacionClientShell />
    </div>
  );
}
