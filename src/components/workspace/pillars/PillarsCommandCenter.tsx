'use client';

/**
 * PillarsCommandCenter — Vista Dueño v2.
 *
 * Centro de mando con telemetría completa de los 4 pilares: hero con score
 * global, tarjetas de salud por pilar, y los 4 micro-dashboards apilados.
 *
 * Si no se le pasan datos (props undefined), usa MOCK_PILLARS y mock series
 * para que la página NUNCA salga vacía — el usuario puede ver el formato
 * y entender qué viene cuando suba un balance real.
 */

import Link from 'next/link';
import { Bell, FileUp, Sparkles } from 'lucide-react';

import { Card } from '@/components/ui/Card';
import { InsightInboxButton } from '@/components/notifications/InsightInboxButton';
import { useLanguage } from '@/context/LanguageContext';
import type { PillarsResult } from '@/lib/pillars/types';
import type { ValorBarSeries } from '@/lib/pillars/valor-bars';
import type { EscudoBarSeries } from '@/lib/pillars/escudo-bars';
import type { VerdadBarSeries } from '@/lib/pillars/verdad-bars';
import type { FuturoBarSeries } from '@/lib/pillars/futuro-bars';
import type { PreprocessedBalance } from '@/lib/preprocessing/trial-balance';
import type {
  CashInflectionPoint,
  DuPontSegment,
  PnLWaterfallData,
  RunwayMonth,
} from '@/components/charts';

import { EscudoMicroDashboard } from './EscudoMicroDashboard';
import { ValorMicroDashboard } from './ValorMicroDashboard';
import { VerdadMicroDashboard } from './VerdadMicroDashboard';
import { FuturoMicroDashboard } from './FuturoMicroDashboard';
import { PillarHealthBadge } from './PillarHealthBadge';
import {
  MOCK_DUPONT_SEGMENTS,
  MOCK_ESCUDO_TREND,
  MOCK_FUTURO_TREND,
  MOCK_INFLECTION_SERIES,
  MOCK_PILLARS,
  MOCK_PNL_WATERFALL,
  MOCK_RUNWAY,
  MOCK_VALOR_TREND,
  MOCK_VERDAD_TREND,
} from './mock-data';

export interface PillarsCommandCenterProps {
  pillars?: PillarsResult;
  liquidity?: {
    razonCorriente: number | null;
    pruebaAcida?: number | null;
    diasAutonomia: number | null;
  };
  pnlBridge?: PnLWaterfallData;
  segments?: DuPontSegment[];
  inflectionSeries?: CashInflectionPoint[];
  runway?: RunwayMonth[];
  gapAttribution?: {
    accountCode: string;
    accountName: string;
    amountCop: number;
    zScore: number;
  };
  /** Serie temporal EBITDA/FCF/Ingresos para el gráfico de barras del pilar Valor. */
  valorTrend?: ValorBarSeries[];
  /** Serie temporal Caja/Activo Corriente/Solvencia para el gráfico de barras del pilar Escudo. */
  escudoTrend?: EscudoBarSeries[];
  /** Serie temporal Errores/Descalces/Anomalías para el gráfico de barras del pilar Verdad. */
  verdadTrend?: VerdadBarSeries[];
  /** Serie de caja proyectada 12 meses (3 escenarios) para el gráfico de líneas del pilar Futuro. */
  futuroTrend?: FuturoBarSeries[];
  /** Si no hay datos reales, marca los charts con un badge "DEMO". */
  demo?: boolean;
  /** Balance preprocesado — habilita el selector interactivo de crecimiento en FuturoTrendBars. */
  balance?: PreprocessedBalance;
}

export function PillarsCommandCenter(props: PillarsCommandCenterProps) {
  const { language } = useLanguage();
  const isEs = language === 'es';

  // Fallback a mocks si no se pasaron datos.
  const pillars = props.pillars ?? MOCK_PILLARS;
  const isDemo = props.demo ?? !props.pillars;
  const liquidity = props.liquidity ?? {
    razonCorriente: 1.6,
    pruebaAcida: 1.2,
    diasAutonomia: 65,
  };
  const pnlBridge = props.pnlBridge ?? MOCK_PNL_WATERFALL;
  const segments = props.segments ?? MOCK_DUPONT_SEGMENTS;
  const inflectionSeries = props.inflectionSeries ?? MOCK_INFLECTION_SERIES;
  const runway = props.runway ?? MOCK_RUNWAY;

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8 md:py-10">
      {/* Hero */}
      <header className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div className="flex flex-col gap-2 min-w-0">
          <span className="font-mono text-xs-mono uppercase tracking-eyebrow text-gold-500 font-medium">
            {isEs ? 'Vista Dueño · 1+1' : "Owner's View · 1+1"}
          </span>
          <h1 className="font-serif-elite text-3xl md:text-4xl font-normal leading-tight tracking-tight text-n-1000">
            {isEs ? 'Centro de Mando Financiero' : 'Financial Command Center'}
          </h1>
          <p className="text-sm text-n-700 font-light max-w-[60ch]">
            {isEs
              ? 'Los 4 Pilares en una sola pantalla: Escudo, Valor, Verdad y Futuro. Salud agregada en tiempo real.'
              : 'The 4 Pillars on a single screen: Shield, Value, Truth, Future. Aggregated health in real time.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isDemo && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-gold-500/30 bg-gold-500/10 px-3 py-1.5 text-xs-mono uppercase tracking-eyebrow text-gold-600 font-medium">
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              {isEs ? 'Demo' : 'Demo'}
            </span>
          )}
          <InsightInboxButton />
        </div>
      </header>

      {/* Salud agregada por pilar */}
      <section
        aria-label={isEs ? 'Health Scores por pilar' : 'Health scores by pillar'}
        className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8"
      >
        <PillarHealthBadge pillar="escudo" score={pillars.escudo.healthScore} status={pillars.escudo.status} language={language} variant="card" />
        <PillarHealthBadge pillar="valor" score={pillars.valor.healthScore} status={pillars.valor.status} language={language} variant="card" />
        <PillarHealthBadge pillar="verdad" score={pillars.verdad.healthScore} status={pillars.verdad.status} language={language} variant="card" />
        <PillarHealthBadge pillar="futuro" score={pillars.futuro.healthScore} status={pillars.futuro.status} language={language} variant="card" />
      </section>

      {/* Score global */}
      <Card variant="glass" padding="md" className="mb-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <span className="font-mono text-xs-mono uppercase tracking-eyebrow text-n-500">
              {isEs ? 'Salud Global' : 'Overall Health'}
            </span>
            <p className="mt-1 font-serif-elite text-xl text-n-1000">
              {pillars.overallStatus.toUpperCase()}
            </p>
          </div>
          <div className="font-mono text-6xl tabular-nums font-semibold text-n-1000">
            {pillars.overallScore}
            <span className="text-base text-n-500 ml-2">/100</span>
          </div>
        </div>
      </Card>

      {isDemo && (
        <Card variant="glass" padding="md" className="mb-8 border-l-2 border-l-gold-500">
          <div className="flex items-start gap-3">
            <FileUp className="h-5 w-5 text-gold-500 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="font-medium text-n-1000">
                {isEs ? 'Datos de demostración' : 'Demo data'}
              </p>
              <p className="text-xs text-n-700 mt-1 leading-relaxed">
                {isEs
                  ? 'Estás viendo el formato del Centro de Mando con datos sintéticos. Sube un balance de prueba para ver tu telemetría real.'
                  : 'You are viewing the Command Center format with synthetic data. Upload a trial balance to see your real telemetry.'}
              </p>
              <Link
                href="/workspace/contabilidad/apertura"
                className="inline-flex items-center gap-1 mt-2 text-xs-mono uppercase tracking-eyebrow text-gold-500 hover:underline"
              >
                {isEs ? 'Subir balance ahora' : 'Upload balance now'} →
              </Link>
            </div>
          </div>
        </Card>
      )}

      {/* Micro-dashboards apilados */}
      <div className="flex flex-col gap-10">
        <EscudoMicroDashboard metrics={pillars.escudo} liquidity={liquidity} escudoTrend={props.escudoTrend ?? MOCK_ESCUDO_TREND} />
        <ValorMicroDashboard metrics={pillars.valor} pnlBridge={pnlBridge} segments={segments} valorTrend={props.valorTrend ?? MOCK_VALOR_TREND} />
        <VerdadMicroDashboard metrics={pillars.verdad} gapAttribution={props.gapAttribution} verdadTrend={props.verdadTrend ?? MOCK_VERDAD_TREND} />
        <FuturoMicroDashboard metrics={pillars.futuro} runway={runway} inflectionSeries={inflectionSeries} futuroTrend={props.futuroTrend ?? MOCK_FUTURO_TREND} balance={props.balance} />
      </div>
    </div>
  );
}

export default PillarsCommandCenter;
