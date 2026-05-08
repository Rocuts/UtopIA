'use client';

/**
 * FuturoMicroDashboard — micro-dashboard del Pilar Futuro.
 * Runway 36 meses + proyector de inflexión + KPIs.
 */

import Link from 'next/link';
import { ArrowRight, Compass } from 'lucide-react';

import { Card } from '@/components/ui/Card';
import { CashInflectionArea, RunwayProjection } from '@/components/charts';
import type {
  CashInflectionPoint,
  RunwayMonth,
} from '@/components/charts';
import { useLanguage } from '@/context/LanguageContext';
import type { PillarMetrics } from '@/lib/pillars/types';
import type { FuturoBarSeries } from '@/lib/pillars/futuro-bars';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';

import { PillarHealthBadge } from './PillarHealthBadge';
import { PillarKpiList } from './_kpi-list';
import { PillarAlertsList } from './_alerts-list';
import { FuturoTrendBars } from './FuturoTrendBars';
import { FuturoExecutiveCards } from './FuturoExecutiveCards';
import { MonteCarloHistogram } from './MonteCarloHistogram';
import type { MonteCarloResult } from '@/lib/pillars/types';

interface Props {
  metrics: PillarMetrics;
  runway?: RunwayMonth[];
  inflectionSeries?: CashInflectionPoint[];
  futuroTrend?: FuturoBarSeries[];
  density?: 'comfortable' | 'compact';
  /** Balance preprocesado para recalculación reactiva del escenario base. */
  balance?: PreprocessedBalance;
  /** Resultado de Monte Carlo precomputado server-side. */
  monteCarlo?: MonteCarloResult;
}

export function FuturoMicroDashboard({
  metrics,
  runway,
  inflectionSeries,
  futuroTrend,
  density,
  balance,
  monteCarlo,
}: Props) {
  const { language } = useLanguage();
  const isEs = language === 'es';

  return (
    <div className="flex flex-col gap-4">
      <Card variant="glass" padding={density === 'compact' ? 'sm' : 'md'}>
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2">
            <Compass className="h-5 w-5 text-area-futuro" aria-hidden="true" />
            <h2 className="font-serif-elite text-xl font-normal text-n-1000 tracking-tight">
              {isEs ? 'Pilar Futuro' : 'Future Pillar'}
            </h2>
          </div>
          <PillarHealthBadge
            pillar="futuro"
            score={metrics.healthScore}
            status={metrics.status}
            language={language}
          />
        </div>
        <p className="text-xs text-n-700 leading-relaxed">
          {isEs
            ? 'Proyección: ¿hacia dónde va la caja en los próximos 36 meses?'
            : 'Projection: where is the cash going over the next 36 months?'}
        </p>
      </Card>

      {/* Tarjetas ejecutivas (vista dueño): CAGR · Punto Quiebre · Prov. Tributaria · Capacidad Inv. */}
      <FuturoExecutiveCards
        cards={metrics.futuroCards}
        language={language}
        density={density}
      />

      {/* Monte Carlo — ROI Probabilístico (solo si hay datos reales) */}
      {monteCarlo && (
        <Card variant="glass" padding={density === 'compact' ? 'sm' : 'md'}>
          <MonteCarloHistogram
            result={monteCarlo}
            language={language}
            density={density}
          />
        </Card>
      )}

      {runway && runway.length > 0 && (
        <RunwayProjection months={runway} density={density} />
      )}

      {futuroTrend && futuroTrend.length > 0 && (
        <Card variant="glass" padding={density === 'compact' ? 'sm' : 'md'}>
          <FuturoTrendBars series={futuroTrend} language={language} density={density} balance={balance} />
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {inflectionSeries && inflectionSeries.length > 0 && (
          <CashInflectionArea cashSeries={inflectionSeries} density={density} />
        )}
        <Card variant="glass" padding={density === 'compact' ? 'sm' : 'md'}>
          <h3 className="font-serif-elite text-base font-normal text-n-1000 mb-2">
            {isEs ? 'KPIs Maestros NIIF' : 'NIIF Master KPIs'}
          </h3>
          <PillarKpiList kpis={metrics.kpis} language={language} />
        </Card>
      </div>

      <PillarAlertsList alerts={metrics.alerts} language={language} />

      <Link
        href="/workspace/futuro"
        className="inline-flex items-center gap-1 text-xs-mono uppercase tracking-eyebrow text-area-futuro hover:underline self-start"
      >
        {isEs ? 'Drill-down a El Futuro' : 'Drill-down to Future'}
        <ArrowRight className="h-3 w-3" aria-hidden="true" />
      </Link>
    </div>
  );
}

export default FuturoMicroDashboard;
