'use client';

/**
 * /workspace/contabilidad/apertura — Saldos iniciales.
 *
 * Integración IW5b (auditoría 2026-09-24): la página simulaba la carga con
 * setTimeout («412 cuentas cargadas», período «Ene 2026» fijo) y mostraba una
 * vista previa con saldos de ejemplo. Se monta el flujo real
 * `OpeningBalanceUploader`: elige el período del workspace y envía el archivo a
 * /api/accounting/opening-balance, que crea el asiento de apertura.
 */

import Link from 'next/link';
import { ArrowLeft, Upload } from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { OpeningBalanceUploader } from '@/components/workspace/accounting/OpeningBalanceUploader';

export default function AperturaPage() {
  const { t } = useLanguage();
  const ac = t.accounting;
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8 md:py-10">
      <Link
        href="/workspace/contabilidad"
        className="inline-flex items-center gap-1.5 mb-6 text-xs font-mono uppercase tracking-widest text-n-600 hover:text-n-1000 transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        {ac.backToOverview}
      </Link>
      <header className="mb-8">
        <p className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-gold-600 font-medium">
          <Upload className="h-4 w-4" aria-hidden="true" />
          {ac.title}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-n-1000">
          {ac.openingBalance}
        </h1>
        <p className="mt-1.5 text-sm text-n-700 max-w-2xl">{ac.openingBalanceDesc}</p>
      </header>
      <OpeningBalanceUploader />
    </div>
  );
}
