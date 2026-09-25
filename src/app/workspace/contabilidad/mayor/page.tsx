'use client';

/**
 * /workspace/contabilidad/mayor — Libro mayor.
 *
 * Integración IW5b (auditoría 2026-09-24): la página mostraba una cuenta T de
 * demostración (1105 · Caja, junio 2026) con saldos literales y luego quedó
 * «Módulo en preparación» porque la API no exponía líneas del mayor.
 * Integración W3-C: `GET /api/accounting/journal?view=ledger` ya devuelve las
 * líneas contabilizadas con el saldo acumulado por cuenta (desde el saldo
 * anterior al período, en centavos exactos), así que se monta el componente
 * real `LedgerView`. Sin movimientos muestra el estado vacío, nunca cifras.
 */

import Link from 'next/link';
import { ArrowLeft, BookOpen } from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { LedgerView } from '@/components/workspace/accounting/LedgerView';

export default function MayorPage() {
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
          <BookOpen className="h-4 w-4" aria-hidden="true" />
          {ac.title}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-n-1000">{ac.ledger}</h1>
        <p className="mt-1.5 text-sm text-n-700 max-w-2xl">{ac.ledgerDesc}</p>
      </header>
      <LedgerView />
    </div>
  );
}
