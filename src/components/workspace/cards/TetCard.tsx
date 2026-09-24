'use client';

/**
 * TetCard — Tasa efectiva CONTABLE (impuesto causado clase 54 / UAI).
 * La TTD (Art. 240 par. 6 E.T.) es ID/UD: sin esos datos se muestra N/D.
 * Sin UAI positiva la TET no es medible: N/D y alerta neutra (nunca «verde»
 * por defecto). Auditoría 2026-09, tributario-modulos-06.
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
  const nd = language === 'es' ? 'N/D' : 'N/A';
  const tet = data?.data.tet ?? null;
  const ttd = data?.data.ttd ?? null;
  return (
    <SurvivalCard
      title={t.title}
      alertLevel={data?.data.nivelAlerta ?? 'amarillo'}
      primaryMetric={{
        label: t.metric,
        value: data ? (tet === null ? nd : formatPct(tet)) : '—',
      }}
      description={data && data.data.nivelAlerta === null
        ? (language === 'es'
          ? 'Tasa efectiva contable no medible: la utilidad antes de impuestos no es positiva.'
          : 'Accounting effective rate not measurable: pre-tax income is not positive.')
        : data?.data.nivelAlerta === 'rojo'
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
            <span className="text-n-600">TTD {language === 'es' ? '(Tasa de Tributación Depurada, Art. 240 par. 6)' : '(Adjusted Tax Rate, Art. 240 par. 6)'}</span>
            <span className="font-medium text-n-700 num">{ttd === null ? nd : formatPct(ttd)}</span>
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
                  <span className="flex-1 text-n-700 dark:text-n-600">
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
