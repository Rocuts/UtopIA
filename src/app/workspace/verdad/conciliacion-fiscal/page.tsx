'use client';

/**
 * Submódulo Conciliación Fiscal.
 *
 * El puente entre NIIF y Estatuto Tributario colombiano. Cobertura:
 *  - Art. 772-1 ET (conciliación fiscal obligatoria)
 *  - Formato 2516 DIAN (reporte de conciliación)
 *  - NIC 12 (Impuesto a las ganancias / tax deferred)
 *  - Decreto 2235/2017 (conciliación)
 *  - Tasa IR sociedades 2026 = 35%
 *
 * Incluye tabla de partidas conciliatorias con mock realista, totales y
 * CTA hacia `/api/tax-reconciliation` via IntakeModal.
 */

import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import { useMemo } from 'react';
import {
  Scale,
  ArrowLeft,
  ArrowRight,
  Sparkles,
  FileText,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';

import { useLanguage } from '@/context/LanguageContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { EliteCard } from '@/components/ui/EliteCard';
import { EliteButton } from '@/components/ui/EliteButton';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { cn } from '@/lib/utils';

// ─── Tipos ───────────────────────────────────────────────────────────────────

type DiferenciaTipo = 'permanente' | 'temporaria';
type DiferenciaDireccion = 'positiva' | 'negativa';

interface PartidaConciliatoria {
  concepto: { es: string; en: string };
  niif: number;
  fiscal: number;
  tipo: DiferenciaTipo;
  direccion: DiferenciaDireccion;
  impuestoDiferido?: number;
}

// ─── Tasa 2026 ───────────────────────────────────────────────────────────────

const TAX_RATE = 0.35;

// ─── Mock partidas conciliatorias ────────────────────────────────────────────

const PARTIDAS: PartidaConciliatoria[] = [
  {
    concepto: { es: 'Ingresos no constitutivos de renta', en: 'Non-taxable income' },
    niif: 150_000_000,
    fiscal: 0,
    tipo: 'permanente',
    direccion: 'negativa',
  },
  {
    concepto: { es: 'Gastos no deducibles (multas, sanciones)', en: 'Non-deductible expenses' },
    niif: 45_000_000,
    fiscal: 0,
    tipo: 'permanente',
    direccion: 'positiva',
  },
  {
    concepto: { es: 'Deducción especial Art. 158-3 (I+D+i)', en: 'R&D deduction (Art. 158-3)' },
    niif: 0,
    fiscal: 80_000_000,
    tipo: 'permanente',
    direccion: 'negativa',
  },
  {
    concepto: { es: 'Depreciación contable vs. fiscal', en: 'Accounting vs. tax depreciation' },
    niif: 320_000_000,
    fiscal: 240_000_000,
    tipo: 'temporaria',
    direccion: 'positiva',
    impuestoDiferido: 28_000_000,
  },
  {
    concepto: {
      es: 'Provisión cartera — deterioro NIIF 9',
      en: 'Allowance for ECL — IFRS 9',
    },
    niif: 65_000_000,
    fiscal: 0,
    tipo: 'temporaria',
    direccion: 'positiva',
    impuestoDiferido: 22_750_000,
  },
  {
    concepto: {
      es: 'Ajuste a valor razonable instrumentos',
      en: 'Fair value adjustment — financial instruments',
    },
    niif: 40_000_000,
    fiscal: 0,
    tipo: 'temporaria',
    direccion: 'positiva',
    impuestoDiferido: 14_000_000,
  },
  {
    concepto: { es: 'Ingresos diferidos (contratos)', en: 'Deferred revenue (contracts)' },
    niif: 180_000_000,
    fiscal: 220_000_000,
    tipo: 'temporaria',
    direccion: 'negativa',
    impuestoDiferido: -14_000_000,
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCOP(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  return `${sign}$${abs.toLocaleString('es-CO', { maximumFractionDigits: 0 })}`;
}

function formatDiff(niif: number, fiscal: number): { value: number; formatted: string } {
  const diff = fiscal - niif;
  return {
    value: diff,
    formatted: (diff >= 0 ? '+' : '') + formatCOP(diff),
  };
}

// ─── Componente ──────────────────────────────────────────────────────────────

export default function ConciliacionFiscalPage() {
  const { language } = useLanguage();
  const { openIntakeForType } = useWorkspace();
  const shouldReduce = useReducedMotion();

  const totals = useMemo(() => {
    let permanente = 0;
    let temporaria = 0;
    let impuestoDiferidoTotal = 0;
    for (const p of PARTIDAS) {
      const diff = Math.abs(p.fiscal - p.niif);
      const signed = p.direccion === 'positiva' ? diff : -diff;
      if (p.tipo === 'permanente') permanente += signed;
      else temporaria += signed;
      if (typeof p.impuestoDiferido === 'number') {
        impuestoDiferidoTotal += p.impuestoDiferido;
      }
    }
    return {
      permanente,
      temporaria,
      impuestoDiferido: impuestoDiferidoTotal,
      total: permanente + temporaria,
    };
  }, []);

  const launchReconciliation = () => {
    openIntakeForType('tax_reconciliation');
  };

  return (
    <div
      data-theme="elite"
      data-lenis-prevent
      className="min-h-full w-full overflow-y-auto bg-[#030303]"
    >
      <div className="mx-auto w-full max-w-[1280px] px-5 md:px-8 py-8 md:py-12 flex flex-col gap-8">
        {/* Back link */}
        <Link
          href="/workspace/verdad"
          className="inline-flex items-center gap-2 text-[12px] uppercase tracking-[0.22em] text-[#A8A8A8] hover:text-[#E8B42C] transition-colors w-fit"
        >
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
          {language === 'es' ? 'Volver a La Verdad' : 'Back to The Truth'}
        </Link>

        {/* Hero */}
        <SectionHeader
          eyebrow={language === 'es' ? 'Art. 772-1 ET · Formato 2516' : 'Art. 772-1 · Form 2516'}
          title={language === 'es' ? 'Conciliación Fiscal' : 'Tax Reconciliation'}
          subtitle={
            language === 'es'
              ? 'El puente exacto entre NIIF y el Estatuto Tributario colombiano'
              : 'The precise bridge between IFRS and the Colombian Tax Statute'
          }
          align="left"
          accent="gold"
          divider
        />

        {/* Marco normativo */}
        <EliteCard variant="glass" padding="lg">
          <EliteCard.Body>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
              {[
                {
                  title: 'Art. 772-1 ET',
                  desc:
                    language === 'es'
                      ? 'Conciliación fiscal obligatoria para contribuyentes obligados a llevar contabilidad.'
                      : 'Mandatory tax reconciliation for taxpayers required to keep accounting.',
                },
                {
                  title: 'Formato 2516',
                  desc:
                    language === 'es'
                      ? 'Reporte DIAN de conciliación contable-fiscal.'
                      : 'DIAN reconciliation report.',
                },
                {
                  title: 'NIC 12',
                  desc:
                    language === 'es'
                      ? 'Impuesto a las ganancias — activos y pasivos por impuesto diferido.'
                      : 'Income taxes — deferred tax assets and liabilities.',
                },
                {
                  title: 'Decreto 2235/2017',
                  desc:
                    language === 'es'
                      ? 'Reglamenta la conciliación fiscal para efectos del ET.'
                      : 'Regulates tax reconciliation under the Tax Statute.',
                },
              ].map((n) => (
                <div key={n.title} className="flex flex-col gap-1.5">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-[#D4A017] font-medium">
                    {n.title}
                  </p>
                  <p className="text-[12.5px] text-[#D4D4D4] leading-relaxed">{n.desc}</p>
                </div>
              ))}
            </div>
          </EliteCard.Body>
        </EliteCard>

        {/* Tabla de partidas */}
        <EliteCard variant="glass" padding="md">
          <EliteCard.Header>
            <span className="flex items-center gap-2">
              <Scale
                className="w-4 h-4 text-[#E8B42C]"
                strokeWidth={2}
                aria-hidden="true"
              />
              <span className="font-serif-elite text-[20px]">
                {language === 'es' ? 'Partidas conciliatorias' : 'Reconciliation items'}
              </span>
            </span>
          </EliteCard.Header>
          <EliteCard.Body>
            <div className="overflow-x-auto -mx-2">
              <table className="w-full min-w-[760px] text-[12.5px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-[0.16em] text-[#A8A8A8] border-b border-[rgba(212,160,23,0.18)]">
                    <th className="py-3 px-3 font-medium">
                      {language === 'es' ? 'Concepto' : 'Concept'}
                    </th>
                    <th className="py-3 px-3 font-medium text-right">NIIF</th>
                    <th className="py-3 px-3 font-medium text-right">
                      {language === 'es' ? 'Fiscal' : 'Tax'}
                    </th>
                    <th className="py-3 px-3 font-medium text-right">
                      {language === 'es' ? 'Diferencia' : 'Difference'}
                    </th>
                    <th className="py-3 px-3 font-medium text-center">
                      {language === 'es' ? 'Tipo' : 'Type'}
                    </th>
                    <th className="py-3 px-3 font-medium text-right">
                      {language === 'es' ? 'Imp. Diferido' : 'Deferred Tax'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {PARTIDAS.map((p, idx) => {
                    const diff = formatDiff(p.niif, p.fiscal);
                    const zebra = idx % 2 === 1;
                    return (
                      <motion.tr
                        key={p.concepto.es}
                        initial={shouldReduce ? undefined : { opacity: 0, y: 6 }}
                        animate={shouldReduce ? undefined : { opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.04, duration: 0.3 }}
                        className={cn(
                          'border-b border-[rgba(212,160,23,0.08)] text-[#F5F5F5]',
                          zebra ? 'bg-[rgba(212,160,23,0.03)]' : '',
                        )}
                      >
                        <td className="py-3 px-3 align-top">
                          <span className="block leading-tight">
                            {language === 'es' ? p.concepto.es : p.concepto.en}
                          </span>
                        </td>
                        <td className="py-3 px-3 tabular-nums text-right text-[#D4D4D4]">
                          {formatCOP(p.niif)}
                        </td>
                        <td className="py-3 px-3 tabular-nums text-right text-[#D4D4D4]">
                          {formatCOP(p.fiscal)}
                        </td>
                        <td
                          className={cn(
                            'py-3 px-3 tabular-nums text-right font-medium',
                            diff.value > 0 ? 'text-[#86EFAC]' : 'text-[#FCA5A5]',
                          )}
                        >
                          {diff.formatted}
                        </td>
                        <td className="py-3 px-3 text-center">
                          <span
                            className={cn(
                              'inline-block px-2 py-0.5 rounded-full text-[10px] uppercase tracking-[0.12em] font-medium',
                              p.tipo === 'permanente'
                                ? 'bg-[rgba(114,47,55,0.18)] text-[#C46A76]'
                                : 'bg-[rgba(212,160,23,0.14)] text-[#E8B42C]',
                            )}
                          >
                            {p.tipo === 'permanente'
                              ? language === 'es'
                                ? 'Permanente'
                                : 'Permanent'
                              : language === 'es'
                                ? 'Temporaria'
                                : 'Temporary'}
                          </span>
                        </td>
                        <td className="py-3 px-3 tabular-nums text-right text-[#D4D4D4]">
                          {typeof p.impuestoDiferido === 'number'
                            ? formatCOP(p.impuestoDiferido)
                            : '—'}
                        </td>
                      </motion.tr>
                    );
                  })}
                  <tr className="border-t-2 border-[rgba(212,160,23,0.35)]">
                    <td className="py-3 px-3 font-serif-elite text-[14px] text-[#F5F5F5]">
                      {language === 'es' ? 'Totales' : 'Totals'}
                    </td>
                    <td className="py-3 px-3" colSpan={2}></td>
                    <td
                      className={cn(
                        'py-3 px-3 tabular-nums text-right font-serif-elite text-[16px]',
                        totals.total >= 0 ? 'text-[#E8B42C]' : 'text-[#FCA5A5]',
                      )}
                    >
                      {(totals.total >= 0 ? '+' : '') + formatCOP(totals.total)}
                    </td>
                    <td className="py-3 px-3"></td>
                    <td
                      className={cn(
                        'py-3 px-3 tabular-nums text-right font-serif-elite text-[16px]',
                        totals.impuestoDiferido >= 0 ? 'text-[#E8B42C]' : 'text-[#FCA5A5]',
                      )}
                    >
                      {(totals.impuestoDiferido >= 0 ? '+' : '') +
                        formatCOP(totals.impuestoDiferido)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </EliteCard.Body>
        </EliteCard>

        {/* Resumen + Formato 2516 + CTA */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr,1fr,auto] gap-6">
          <EliteCard variant="glass" padding="lg">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp
                className="w-4 h-4 text-[#C46A76]"
                strokeWidth={2}
                aria-hidden="true"
              />
              <span className="text-[11px] uppercase tracking-[0.22em] text-[#C46A76] font-medium">
                {language === 'es' ? 'Diferencias permanentes' : 'Permanent differences'}
              </span>
            </div>
            <p className="font-serif-elite text-[36px] leading-none tabular-nums text-[#F5F5F5]">
              {formatCOP(totals.permanente)}
            </p>
            <p className="text-[12px] text-[#A8A8A8] mt-3 leading-relaxed">
              {language === 'es'
                ? 'No generan impuesto diferido — se absorben en el período.'
                : 'Do not generate deferred tax — absorbed in the period.'}
            </p>
          </EliteCard>

          <EliteCard variant="glass" padding="lg">
            <div className="flex items-center gap-2 mb-4">
              <TrendingDown
                className="w-4 h-4 text-[#E8B42C]"
                strokeWidth={2}
                aria-hidden="true"
              />
              <span className="text-[11px] uppercase tracking-[0.22em] text-[#D4A017] font-medium">
                {language === 'es' ? 'Diferencias temporarias' : 'Temporary differences'}
              </span>
            </div>
            <p className="font-serif-elite text-[36px] leading-none tabular-nums text-[#F5F5F5]">
              {formatCOP(totals.temporaria)}
            </p>
            <p className="text-[12px] text-[#A8A8A8] mt-3 leading-relaxed">
              {language === 'es' ? (
                <>
                  Generan impuesto diferido al {(TAX_RATE * 100).toFixed(0)}% (NIC 12).
                </>
              ) : (
                <>
                  Generate deferred tax at {(TAX_RATE * 100).toFixed(0)}% (IAS 12).
                </>
              )}
            </p>
          </EliteCard>

          <EliteCard
            variant="glass"
            padding="lg"
            className="flex flex-col gap-3 justify-center min-w-[260px]"
          >
            <div className="flex items-center gap-2">
              <Sparkles
                className="w-4 h-4 text-[#E8B42C]"
                strokeWidth={2}
                aria-hidden="true"
              />
              <span className="uppercase tracking-[0.22em] text-[11px] text-[#D4A017] font-medium">
                {language === 'es' ? 'Ejecutar' : 'Execute'}
              </span>
            </div>
            <h4 className="font-serif-elite text-[18px] leading-tight text-[#F5F5F5]">
              {language === 'es'
                ? 'Ejecutar conciliación AI'
                : 'Run AI reconciliation'}
            </h4>
            <p className="text-[12.5px] text-[#A8A8A8] leading-relaxed">
              {language === 'es'
                ? 'Dispara el pipeline: identificador de diferencias → calculador de impuesto diferido.'
                : 'Triggers the pipeline: difference identifier → deferred tax calculator.'}
            </p>
            <EliteButton
              variant="primary"
              size="lg"
              elevated
              onClick={launchReconciliation}
              rightIcon={<ArrowRight className="w-4 h-4" />}
            >
              {language === 'es' ? 'Ejecutar conciliación' : 'Run reconciliation'}
            </EliteButton>
          </EliteCard>
        </div>

        {/* Formato 2516 simulado */}
        <EliteCard variant="glass" padding="lg">
          <EliteCard.Header>
            <span className="flex items-center gap-2">
              <FileText
                className="w-4 h-4 text-[#E8B42C]"
                strokeWidth={2}
                aria-hidden="true"
              />
              <span className="font-serif-elite text-[20px]">
                {language === 'es'
                  ? 'Formato 2516 — resumen ejecutivo'
                  : 'Form 2516 — executive summary'}
              </span>
            </span>
          </EliteCard.Header>
          <EliteCard.Body>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                {
                  label: language === 'es' ? 'Utilidad contable (NIIF)' : 'Book income (IFRS)',
                  value: '$1.250.000.000',
                },
                {
                  label: language === 'es' ? 'Total conciliaciones' : 'Total reconciliations',
                  value: formatCOP(totals.total),
                },
                {
                  label: language === 'es' ? 'Renta líquida fiscal' : 'Taxable income',
                  value: formatCOP(1_250_000_000 + totals.total),
                },
                {
                  label:
                    language === 'es'
                      ? `Impuesto renta ${(TAX_RATE * 100).toFixed(0)}%`
                      : `Income tax ${(TAX_RATE * 100).toFixed(0)}%`,
                  value: formatCOP((1_250_000_000 + totals.total) * TAX_RATE),
                },
              ].map((f) => (
                <div
                  key={f.label}
                  className="p-3 rounded-[8px] bg-[rgba(212,160,23,0.04)] border border-[rgba(212,160,23,0.12)]"
                >
                  <p className="text-[11px] uppercase tracking-[0.16em] text-[#A8A8A8] mb-1.5">
                    {f.label}
                  </p>
                  <p className="font-serif-elite text-[18px] leading-tight tabular-nums text-[#F5F5F5]">
                    {f.value}
                  </p>
                </div>
              ))}
            </div>
          </EliteCard.Body>
        </EliteCard>
      </div>
    </div>
  );
}
