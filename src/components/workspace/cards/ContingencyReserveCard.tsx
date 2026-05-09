'use client';

/**
 * ContingencyReserveCard — Reserva Fiscal de Contingencia.
 * Shows the recommended fiscal reserve (10% × utilidad neta) and the
 * current legal reserve gap if available. Always informative (alert: verde).
 */

import { PiggyBank } from 'lucide-react';
import { SurvivalCard } from './SurvivalCard';
import { cn } from '@/lib/utils';
import type { ContingencyReserveResult } from '@/lib/agents/financial/escudo-survival/types';
import { formatCOP, formatPct } from '@/hooks/useEscudoSurvival';

interface ContingencyReserveCardProps {
  data?: ContingencyReserveResult;
  loading?: boolean;
  error?: string;
  t: {
    title: string;
    metric: string;
    norma: string;
  };
  language?: 'es' | 'en';
}

export function ContingencyReserveCard({
  data,
  loading,
  error,
  t,
  language = 'es',
}: ContingencyReserveCardProps) {
  const reserva = data?.data.reservaSugerida ?? 0;
  const gap = data?.data.gapReservaLegal;

  return (
    <SurvivalCard
      title={t.title}
      alertLevel="verde"
      primaryMetric={{
        label: t.metric,
        value: data ? formatCOP(reserva) : '—',
      }}
      description={
        language === 'es'
          ? `Se recomienda reservar el ${data ? formatPct(data.data.pctUtilidad) : '10%'} de la utilidad neta como colchón fiscal para obligaciones futuras.`
          : `We recommend reserving ${data ? formatPct(data.data.pctUtilidad) : '10%'} of net income as a fiscal cushion for future obligations.`
      }
      norma={t.norma}
      loading={loading}
      error={error}
      icon={PiggyBank}
      language={language}
    >
      {data && (
        <div className="flex flex-col gap-2">
          {/* Utilidad neta row */}
          <div className={cn('flex items-center justify-between text-xs gap-2 py-1.5 px-2.5 rounded-md', 'bg-[rgb(34_197_94_/_0.07)] ring-1 ring-[rgb(34_197_94_/_0.2)]')}>
            <span className="text-n-500">
              {language === 'es' ? 'Utilidad neta base' : 'Net income base'}
            </span>
            <span className="font-medium text-n-800 dark:text-n-200 num">
              {formatCOP(data.data.utilidadNeta)}
            </span>
          </div>

          {/* Suggested account */}
          <div className="text-xs text-n-500 leading-relaxed">
            <span className="font-medium text-n-700 dark:text-n-300">
              {language === 'es' ? 'Cuenta sugerida: ' : 'Suggested account: '}
            </span>
            {data.data.cuentaSugerida}
          </div>

          {/* Legal reserve gap */}
          {typeof gap === 'number' && gap > 0 && (
            <div className={cn('flex items-center justify-between text-xs gap-2 py-1.5 px-2.5 rounded-md', 'bg-[rgb(234_179_8_/_0.08)] ring-1 ring-[rgb(234_179_8_/_0.25)]')}>
              <span className="text-n-500">
                {language === 'es' ? 'Gap reserva legal (Art. 452)' : 'Legal reserve gap (Art. 452)'}
              </span>
              <span className="font-medium text-warning num">{formatCOP(gap)}</span>
            </div>
          )}
        </div>
      )}
    </SurvivalCard>
  );
}
