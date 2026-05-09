'use client';

/**
 * TetCard — Tasa Efectiva de Tributación card.
 * Displays TET %, TTD %, alert level, and optimization suggestions.
 * Art. 240 E.T. — tasa general 35%, TET óptima < 25% para PyME colombiana.
 */

import { BarChart3, ChevronRight } from 'lucide-react';
import { SurvivalCard } from './SurvivalCard';
import { cn } from '@/lib/utils';
import type { TetCalculatorResult } from '@/lib/agents/financial/escudo-survival/types';
import { formatPct } from '@/hooks/useEscudoSurvival';

interface TetCardProps {
  data?: TetCalculatorResult;
  loading?: boolean;
  error?: string;
  t: {
    title: string;
    metric: string;
    norma: string;
  };
  language?: 'es' | 'en';
}

export function TetCard({ data, loading, error, t, language = 'es' }: TetCardProps) {
  return (
    <SurvivalCard
      title={t.title}
      alertLevel={data?.data.nivelAlerta ?? 'verde'}
      primaryMetric={{
        label: t.metric,
        value: data ? formatPct(data.data.tet) : '—',
      }}
      description={data?.data.nivelAlerta === 'rojo'
        ? (language === 'es'
          ? 'La empresa tributa por encima del umbral óptimo. Se detectaron oportunidades de optimización.'
          : 'The company is over-taxed. Optimization opportunities detected.')
        : data?.data.nivelAlerta === 'amarillo'
        ? (language === 'es'
          ? 'TET en zona de atención. Revisar gastos deducibles y descuentos tributarios disponibles.'
          : 'TET in attention zone. Review deductible expenses and available tax discounts.')
        : (language === 'es'
          ? 'Tasa efectiva dentro del rango óptimo para su perfil tributario.'
          : 'Effective rate within optimal range for your tax profile.')
      }
      norma={t.norma}
      loading={loading}
      error={error}
      icon={BarChart3}
      language={language}
    >
      {data && (
        <div className="flex flex-col gap-3">
          {/* TTD secondary */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-n-500">TTD {language === 'es' ? '(Tasa Tributación Dividendos)' : '(Dividend Tax Rate)'}</span>
            <span className="font-medium text-n-700 num">{formatPct(data.data.ttd)}</span>
          </div>

          {/* Optimization suggestions */}
          {data.data.sugerenciasOptimizacion.length > 0 && (
            <ul
              role="list"
              aria-label={language === 'es' ? 'Optimizaciones disponibles' : 'Available optimizations'}
              className="flex flex-col gap-1.5"
            >
              {data.data.sugerenciasOptimizacion.slice(0, 3).map((sug, i) => (
                <li
                  key={i}
                  className={cn(
                    'flex items-start gap-2 p-2 rounded-md text-xs',
                    'bg-[rgb(168_56_56_/_0.07)] ring-1 ring-[rgb(168_56_56_/_0.15)]',
                  )}
                >
                  <ChevronRight
                    className="h-3 w-3 text-area-escudo shrink-0 mt-0.5"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                  <span className="flex-1 text-n-700 dark:text-n-400">
                    <span className="font-medium text-area-escudo">{sug.norma}</span>
                    {' — '}
                    {sug.factibilidad === 'alta'
                      ? (language === 'es' ? 'Alta factibilidad' : 'High feasibility')
                      : sug.factibilidad === 'media'
                      ? (language === 'es' ? 'Factibilidad media' : 'Medium feasibility')
                      : (language === 'es' ? 'Baja factibilidad' : 'Low feasibility')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </SurvivalCard>
  );
}
