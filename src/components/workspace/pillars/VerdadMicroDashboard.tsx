'use client';

/**
 * VerdadMicroDashboard — micro-dashboard del Pilar Verdad.
 * Score de integridad + brecha de cuadratura + KPIs + alertas.
 */

import Link from 'next/link';
import { ArrowRight, Scale } from 'lucide-react';

import { Card } from '@/components/ui/Card';
import { useLanguage } from '@/context/LanguageContext';
import type { PillarMetrics } from '@/lib/pillars/types';
import type { VerdadBarSeries } from '@/lib/pillars/verdad-bars';
import { cn } from '@/lib/utils';

import { PillarHealthBadge } from './PillarHealthBadge';
import { PillarKpiList } from './_kpi-list';
import { PillarAlertsList } from './_alerts-list';
import { VerdadTrendBars } from './VerdadTrendBars';
import { VerdadExecutiveCards } from './VerdadExecutiveCards';

interface Props {
  metrics: PillarMetrics;
  /** Cuenta atípica detectada por R3 del Curator (si la hay). */
  gapAttribution?: {
    accountCode: string;
    accountName: string;
    amountCop: number;
    zScore: number;
  };
  density?: 'comfortable' | 'compact';
  /** Serie temporal Errores/Descalces/Anomalías para el gráfico de barras. */
  verdadTrend?: VerdadBarSeries[];
}

export function VerdadMicroDashboard({ metrics, gapAttribution, density, verdadTrend }: Props) {
  const { language } = useLanguage();
  const isEs = language === 'es';

  const integridadKpi = metrics.kpis.find((k) => k.key === 'score_integridad');
  const integridadValue = integridadKpi?.value ?? null;

  return (
    <div className="flex flex-col gap-4">
      <Card variant="glass" padding={density === 'compact' ? 'sm' : 'md'}>
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-area-verdad" aria-hidden="true" />
            <h2 className="font-serif-elite text-xl font-normal text-n-1000 tracking-tight">
              {isEs ? 'Pilar Verdad' : 'Truth Pillar'}
            </h2>
          </div>
          <PillarHealthBadge
            pillar="verdad"
            score={metrics.healthScore}
            status={metrics.status}
            language={language}
          />
        </div>
        <p className="text-xs text-n-700 leading-relaxed">
          {isEs
            ? 'Integridad: ¿qué tan fiables son los datos que estamos viendo?'
            : 'Integrity: how trustworthy is the data we are looking at?'}
        </p>
      </Card>

      {/* Tarjetas ejecutivas (vista dueño): Ecuación · Consistencia · Anomalías · Salud */}
      <VerdadExecutiveCards
        cards={metrics.verdadCards}
        language={language}
        density={density}
      />

      {verdadTrend && verdadTrend.length > 0 && (
        <Card variant="glass" padding={density === 'compact' ? 'sm' : 'md'}>
          <VerdadTrendBars series={verdadTrend} language={language} density={density} />
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card variant="glass" padding={density === 'compact' ? 'sm' : 'md'} className="text-center">
          <span className="font-mono text-xs-mono uppercase tracking-eyebrow text-n-500 font-medium">
            {isEs ? 'ADN Contable' : 'Accounting DNA'}
          </span>
          <div className="mt-2 flex items-end justify-center gap-1 font-mono">
            <span
              className={cn(
                'text-7xl tabular-nums font-semibold leading-none',
                integridadValue !== null && integridadValue >= 80 ? 'text-success' : integridadValue !== null && integridadValue >= 50 ? 'text-warning' : 'text-danger',
              )}
            >
              {integridadValue !== null ? Math.round(integridadValue) : '—'}
            </span>
            <span className="text-base text-n-500 mb-2">/100</span>
          </div>
          <p className="text-xs text-n-700 mt-2">
            {isEs
              ? 'Limpieza forense: Benford, gaps, montos repetidos, asientos en fin de semana, terceros nuevos.'
              : 'Forensic cleanliness: Benford, gaps, repeated amounts, weekend postings, new third parties.'}
          </p>
        </Card>
        <Card variant="glass" padding={density === 'compact' ? 'sm' : 'md'}>
          <h3 className="font-serif-elite text-base font-normal text-n-1000 mb-2">
            {isEs ? 'KPIs Maestros NIIF' : 'NIIF Master KPIs'}
          </h3>
          <PillarKpiList kpis={metrics.kpis} language={language} />
        </Card>
      </div>

      {gapAttribution && (
        <Card variant="glass" padding={density === 'compact' ? 'sm' : 'md'} className="border-l-2 border-l-danger">
          <span className="font-mono text-xs-mono uppercase tracking-eyebrow text-danger font-medium">
            {isEs ? 'Cuenta atípica detectada · Curator R3' : 'Atypical account detected · Curator R3'}
          </span>
          <p className="mt-2 text-sm text-n-1000">
            <strong>
              {gapAttribution.accountCode} — {gapAttribution.accountName}
            </strong>
          </p>
          <p className="text-xs text-n-700 mt-1">
            {isEs ? 'Monto:' : 'Amount:'}{' '}
            <span className="font-mono tabular-nums">
              ${Math.abs(gapAttribution.amountCop).toLocaleString('es-CO')}
            </span>{' '}
            · z-score{' '}
            <span className="font-mono tabular-nums">{gapAttribution.zScore.toFixed(2)}</span>
          </p>
        </Card>
      )}

      <PillarAlertsList alerts={metrics.alerts} language={language} />

      <Link
        href="/workspace/verdad"
        className="inline-flex items-center gap-1 text-xs-mono uppercase tracking-eyebrow text-area-verdad hover:underline self-start"
      >
        {isEs ? 'Drill-down a La Verdad' : 'Drill-down to Truth'}
        <ArrowRight className="h-3 w-3" aria-hidden="true" />
      </Link>
    </div>
  );
}

export default VerdadMicroDashboard;
