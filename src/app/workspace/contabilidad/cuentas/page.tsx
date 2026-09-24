'use client';

/**
 * /workspace/contabilidad/cuentas — Plan Único de Cuentas del workspace.
 *
 * Integración IW5b (auditoría 2026-09-24): la página era un árbol PUC de
 * demostración con saldos literales («Saldos de demostración»). Se monta el
 * árbol real `ChartOfAccountsTree`, que lee /api/accounting/accounts (y ofrece
 * sembrar el PUC base si el workspace aún no lo tiene). No muestra saldos.
 */

import Link from 'next/link';
import { ArrowLeft, BookOpen } from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { ChartOfAccountsTree } from '@/components/workspace/accounting/ChartOfAccountsTree';

export default function CuentasPage() {
  const { t } = useLanguage();
  const ac = t.accounting;
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8 md:py-10">
      <Link
        href="/workspace/contabilidad"
        className="inline-flex items-center gap-1.5 mb-6 text-xs font-mono uppercase tracking-widest text-n-600 hover:text-n-1000 transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        {ac.backToOverview}
      </Link>
      <header className="mb-8">
        <p className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-gold-600 font-medium">
          <BookOpen className="h-4 w-4" aria-hidden="true" />
          {ac.title}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-n-1000">
          {ac.chartOfAccounts}
        </h1>
        <p className="mt-1.5 text-sm text-n-700 max-w-2xl">{ac.chartOfAccountsDesc}</p>
      </header>
      <ChartOfAccountsTree />
    </div>
  );
}
