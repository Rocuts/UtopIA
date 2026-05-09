'use client';

/**
 * DividendOptimizerCard — Optimización de Dividendos.
 * Shows three scenarios: distribute fully, capitalize fully, 50/50 hybrid.
 * Covers Art. 242 E.T. (dividend tax rate) and Art. 36-3 E.T. (capitalization).
 */

import { TrendingUp } from 'lucide-react';
import { SurvivalCard } from './SurvivalCard';
import { cn } from '@/lib/utils';
import type { DividendOptimizerResult } from '@/lib/agents/financial/escudo-survival/types';
import { formatCOP } from '@/hooks/useEscudoSurvival';

interface DividendOptimizerCardProps {
  data?: DividendOptimizerResult;
  loading?: boolean;
  error?: string;
  t: {
    title: string;
    metric: string;
    norma: string;
  };
  language?: 'es' | 'en';
}

type ScenarioKey = 'distribuirTotal' | 'capitalizarTotal' | 'hibrido50_50';

const SCENARIO_LABELS: Record<ScenarioKey, { es: string; en: string }> = {
  distribuirTotal: { es: 'Distribuir todo', en: 'Full distribution' },
  capitalizarTotal: { es: 'Capitalizar todo', en: 'Full capitalization' },
  hibrido50_50: { es: 'Híbrido 50/50', en: '50/50 Hybrid' },
};

export function DividendOptimizerCard({
  data,
  loading,
  error,
  t,
  language = 'es',
}: DividendOptimizerCardProps) {
  // Best saving is the max ahorro across scenarios
  const bestAhorro = data
    ? Math.max(
        data.data.escenarios.distribuirTotal.ahorroSocio,
        data.data.escenarios.capitalizarTotal.ahorroSocio,
        data.data.escenarios.hibrido50_50.ahorroSocio,
      )
    : 0;

  const alertLevel = bestAhorro > 0 ? ('verde' as const) : ('amarillo' as const);

  return (
    <SurvivalCard
      title={t.title}
      alertLevel={alertLevel}
      primaryMetric={{
        label: t.metric,
        value: data ? formatCOP(bestAhorro) : '—',
      }}
      description={data?.data.recomendacion}
      norma={data?.data.norma ?? t.norma}
      loading={loading}
      error={error}
      icon={TrendingUp}
      language={language}
    >
      {data && (
        <div className="flex flex-col gap-1.5">
          {(Object.entries(data.data.escenarios) as [ScenarioKey, typeof data.data.escenarios.distribuirTotal][]).map(
            ([key, scenario]) => {
              const label = SCENARIO_LABELS[key];
              const isCapitalize = key === 'capitalizarTotal';
              const isHybrid = key === 'hibrido50_50';
              const highlight = isCapitalize || isHybrid;

              return (
                <div
                  key={key}
                  className={cn(
                    'flex items-center justify-between gap-3 px-2.5 py-2 rounded-md text-xs',
                    highlight
                      ? 'bg-[rgb(34_197_94_/_0.08)] ring-1 ring-[rgb(34_197_94_/_0.25)]'
                      : 'bg-n-100/30 dark:bg-n-800/20 ring-1 ring-n-200/40 dark:ring-n-700/30',
                  )}
                >
                  <span className={cn('text-n-700 dark:text-n-400', highlight && 'text-n-800 dark:text-n-200 font-medium')}>
                    {language === 'es' ? label.es : label.en}
                  </span>
                  <div className="flex items-center gap-3 shrink-0">
                    {scenario.impuestoSocio > 0 && (
                      <span className="text-danger num">−{formatCOP(scenario.impuestoSocio)}</span>
                    )}
                    {scenario.ahorroSocio > 0 && (
                      <span className="text-success font-medium num">+{formatCOP(scenario.ahorroSocio)}</span>
                    )}
                    {scenario.fortPatrimonio !== undefined && scenario.fortPatrimonio > 0 && (
                      <span className="text-n-500 num">↑{formatCOP(scenario.fortPatrimonio)}</span>
                    )}
                  </div>
                </div>
              );
            },
          )}
        </div>
      )}
    </SurvivalCard>
  );
}
