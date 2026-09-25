'use client';

/**
 * AccountingModuleInPreparation — estado honesto para las subpáginas de
 * Contabilidad que aún no tienen una vista conectada a los datos de la empresa.
 *
 * Integración IW5b (auditoría 2026-09-24): las páginas de /workspace/contabilidad
 * eran maquetas con cifras literales (asientos de demostración, saldo de caja,
 * «Período actual: Junio 2026»…) sin rótulo. Mismo criterio que
 * `ModuleInPreparation` de las áreas (WP07): título y descripción del
 * submódulo, rótulo «Módulo en preparación — sin datos de su empresa» y, si
 * existe un flujo real, el enlace que lo abre. Nunca muestra números.
 */

import Link from 'next/link';
import { ArrowLeft, ArrowRight, Construction } from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';

export interface AccountingModuleInPreparationProps {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  /** Flujo real existente (p. ej. «Nuevo asiento»). */
  cta?: { href: string; label: string };
}

export function AccountingModuleInPreparation({
  title,
  description,
  icon: Icon,
  cta,
}: AccountingModuleInPreparationProps) {
  const { t } = useLanguage();
  const ds = t.elite.dataStatus;
  const ac = t.accounting;

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8 md:py-10" data-module-status="in-preparation">
      <Link
        href="/workspace/contabilidad"
        className="inline-flex items-center gap-1.5 mb-6 text-xs font-mono uppercase tracking-widest text-n-600 hover:text-n-1000 transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        {ac.backToOverview}
      </Link>

      <header className="space-y-2 mb-8">
        <p className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-gold-600 font-medium">
          <Icon className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          {ac.title}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-n-1000">{title}</h1>
        <p className="max-w-xl text-base leading-relaxed text-n-700">{description}</p>
      </header>

      <section
        role="status"
        aria-live="polite"
        className="flex items-start gap-4 rounded-xl border border-n-300 bg-n-100 px-5 py-4"
      >
        <span
          aria-hidden="true"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gold-500/15 text-gold-600"
        >
          <Construction className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-n-1000">{ds.moduleInPreparationNotice}</p>
          <p className="text-sm leading-relaxed text-n-700">{ds.moduleInPreparationBody}</p>
        </div>
      </section>

      {cta && (
        <Link
          href={cta.href}
          className="mt-6 inline-flex items-center gap-2 rounded-md bg-gold-500 px-4 py-2 text-sm font-semibold text-n-0 hover:bg-gold-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2 focus-visible:ring-offset-n-0"
        >
          {cta.label}
          <ArrowRight className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

export default AccountingModuleInPreparation;
