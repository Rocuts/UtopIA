'use client';

/**
 * ReservaContingenciaCard (Módulo 8 submódulo) — Reserva de Contingencia.
 * Provisión sugerida y % sobre utilidad.
 */

import { PiggyBank } from 'lucide-react';
import { SurvivalCard } from '@/components/workspace/cards/SurvivalCard';
import { formatCopFromCents } from '@/lib/agents/financial/contracts/money';
import type { SupervivenciaModuleResult } from '@/lib/agents/financial/escudo-survival/fiscal-agent';

function fmtCop(cents: string): string {
  try {
    return formatCopFromCents(BigInt(cents));
  } catch {
    return cents;
  }
}

interface ReservaContingenciaCardProps {
  data?: SupervivenciaModuleResult['data']['reservaContingencia'];
  loading?: boolean;
  error?: string;
  t: { title: string; metric: string; norma: string };
  language?: 'es' | 'en';
}

export function ReservaContingenciaCard({ data, loading, error, t, language = 'es' }: ReservaContingenciaCardProps) {
  return (
    <SurvivalCard
      title={t.title}
      alertLevel="verde"
      primaryMetric={{
        label: t.metric,
        value: data ? fmtCop(data.sugerida) : '—',
      }}
      description={
        data
          ? language === 'es'
            ? `${data.pctUtilidad.toFixed(1)}% de la utilidad neta — mantenga en cuenta de alta liquidez.`
            : `${data.pctUtilidad.toFixed(1)}% of net income — keep in high-liquidity account.`
          : undefined
      }
      norma={t.norma}
      loading={loading}
      error={error}
      icon={PiggyBank}
      language={language}
    />
  );
}
