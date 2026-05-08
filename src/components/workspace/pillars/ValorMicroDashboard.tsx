'use client';

/**
 * ValorMicroDashboard — micro-dashboard del Pilar Valor.
 * Cascada P&L + Treemap DuPont + 3 KPIs (Margen, ROE, EVA).
 */

import Link from 'next/link';
import { ArrowRight, TrendingUp } from 'lucide-react';

import { Card } from '@/components/ui/Card';
import { DuPontTreemap, PnLWaterfall } from '@/components/charts';
import type {
  DuPontSegment,
  PnLWaterfallData,
} from '@/components/charts';
import { useLanguage } from '@/context/LanguageContext';
import type { PillarMetrics } from '@/lib/pillars/types';
import type { ValorBarSeries } from '@/lib/pillars/valor-bars';

import { PillarHealthBadge } from './PillarHealthBadge';
import { PillarKpiList } from './_kpi-list';
import { PillarAlertsList } from './_alerts-list';
import { PresumedCostWarning } from './PresumedCostWarning';
import { ValorExecutiveCards } from './ValorExecutiveCards';
import { ValorTrendBars } from './ValorTrendBars';

interface Props {
  metrics: PillarMetrics;
  pnlBridge?: PnLWaterfallData;
  segments?: DuPontSegment[];
  density?: 'comfortable' | 'compact';
  valorTrend?: ValorBarSeries[];
}

export function ValorMicroDashboard({ metrics, pnlBridge, segments, density, valorTrend }: Props) {
  const { language } = useLanguage();
  const isEs = language === 'es';

  return (
    <div className="flex flex-col gap-4">
      <Card variant="glass" padding={density === 'compact' ? 'sm' : 'md'}>
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-area-valor" aria-hidden="true" />
            <h2 className="font-serif-elite text-xl font-normal text-n-1000 tracking-tight">
              {isEs ? 'Pilar Valor' : 'Value Pillar'}
            </h2>
          </div>
          <PillarHealthBadge
            pillar="valor"
            score={metrics.healthScore}
            status={metrics.status}
            language={language}
          />
        </div>
        <p className="text-xs text-n-700 leading-relaxed">
          {isEs
            ? 'Rentabilidad: ¿el negocio crea riqueza real o solo mueve dinero?'
            : 'Profitability: is the business creating real wealth or just moving money?'}
        </p>
      </Card>

      {/* Tarjetas ejecutivas (vista dueño): EBITDA · Margen · Ratio · FCF */}
      <ValorExecutiveCards
        cards={metrics.executiveCards}
        language={language}
        density={density}
      />

      {/* Gráfico de tendencia temporal EBITDA/FCF/Ingresos */}
      {valorTrend && valorTrend.length > 0 && (
        <Card variant="glass" padding={density === 'compact' ? 'sm' : 'md'}>
          <ValorTrendBars series={valorTrend} language={language} density={density} />
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {pnlBridge && <PnLWaterfall data={pnlBridge} density={density} />}
        <Card variant="glass" padding={density === 'compact' ? 'sm' : 'md'}>
          <h3 className="font-serif-elite text-base font-normal text-n-1000 mb-2">
            {isEs ? 'KPIs Maestros NIIF' : 'NIIF Master KPIs'}
          </h3>
          <PillarKpiList kpis={metrics.kpis} language={language} />
        </Card>
      </div>

      {segments && segments.length > 0 && (
        <DuPontTreemap segments={segments} density={density} />
      )}

      {metrics.presumedCostWarning && (
        <PresumedCostWarning
          warning={metrics.presumedCostWarning}
          density={density}
        />
      )}

      <PillarAlertsList alerts={metrics.alerts} language={language} />

      <Link
        href="/workspace/valor"
        className="inline-flex items-center gap-1 text-xs-mono uppercase tracking-eyebrow text-area-valor hover:underline self-start"
      >
        {isEs ? 'Drill-down a El Valor' : 'Drill-down to Value'}
        <ArrowRight className="h-3 w-3" aria-hidden="true" />
      </Link>
    </div>
  );
}

export default ValorMicroDashboard;
