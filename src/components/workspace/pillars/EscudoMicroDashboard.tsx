'use client';

/**
 * EscudoMicroDashboard — micro-dashboard del Pilar Escudo.
 * Combina velocímetro + 3 KPIs (Días Autonomía, Solvencia Real, Cobertura
 * Fiscal) + alertas activas.
 */

import Link from 'next/link';
import { ArrowRight, Shield } from 'lucide-react';

import { Card } from '@/components/ui/Card';
import { SpeedometerLiquidityGauge } from '@/components/charts';
import { useLanguage } from '@/context/LanguageContext';
import type { PillarMetrics } from '@/lib/pillars/types';

import { PillarHealthBadge } from './PillarHealthBadge';
import { PillarKpiList } from './_kpi-list';
import { PillarAlertsList } from './_alerts-list';

interface Props {
  metrics: PillarMetrics;
  /** Datos para el velocímetro. Si null, oculta el chart. */
  liquidity?: {
    razonCorriente: number | null;
    pruebaAcida?: number | null;
    diasAutonomia: number | null;
  };
  density?: 'comfortable' | 'compact';
}

export function EscudoMicroDashboard({ metrics, liquidity, density }: Props) {
  const { language } = useLanguage();
  const isEs = language === 'es';

  return (
    <div className="flex flex-col gap-4">
      <Card variant="glass" padding={density === 'compact' ? 'sm' : 'md'}>
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-area-escudo" aria-hidden="true" />
            <h2 className="font-serif-elite text-xl font-normal text-n-1000 tracking-tight">
              {isEs ? 'Pilar Escudo' : 'Shield Pillar'}
            </h2>
          </div>
          <PillarHealthBadge
            pillar="escudo"
            score={metrics.healthScore}
            status={metrics.status}
            language={language}
          />
        </div>
        <p className="text-xs text-n-700 leading-relaxed">
          {isEs
            ? 'Resiliencia: ¿qué tan protegida está la empresa ante una crisis mañana?'
            : 'Resilience: how protected is the company against tomorrow’s crisis?'}
        </p>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {liquidity && (
          <SpeedometerLiquidityGauge
            data={liquidity}
            density={density}
            title={isEs ? 'Velocímetro de Resiliencia' : 'Resilience Speedometer'}
            subtitle={isEs ? 'Razón Corriente + Días de Autonomía' : 'Current Ratio + Days of Runway'}
          />
        )}
        <Card variant="glass" padding={density === 'compact' ? 'sm' : 'md'}>
          <h3 className="font-serif-elite text-base font-normal text-n-1000 mb-2">
            {isEs ? 'KPIs Maestros' : 'Master KPIs'}
          </h3>
          <PillarKpiList kpis={metrics.kpis} language={language} />
        </Card>
      </div>

      <PillarAlertsList alerts={metrics.alerts} language={language} />

      <Link
        href="/workspace/escudo"
        className="inline-flex items-center gap-1 text-xs-mono uppercase tracking-eyebrow text-area-escudo hover:underline self-start"
      >
        {isEs ? 'Drill-down a El Escudo' : 'Drill-down to Shield'}
        <ArrowRight className="h-3 w-3" aria-hidden="true" />
      </Link>
    </div>
  );
}

export default EscudoMicroDashboard;
