'use client';

/**
 * TetCard (Módulo 8 — submódulo Supervivencia) — Tasa Efectiva de Tributación.
 * Muestra TET actual, brecha con 15% y impuesto adicional si aplica.
 */

import { BarChart3 } from 'lucide-react';
import { SurvivalCard } from '@/components/workspace/cards/SurvivalCard';
import type { SupervivenciaModuleResult } from '@/lib/agents/financial/escudo-survival/fiscal-agent';

function fmtPct(n: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  }).format(n / 100);
}

interface TetCardProps {
  data?: SupervivenciaModuleResult['data']['tet'];
  loading?: boolean;
  error?: string;
  t: { title: string; metric: string; norma: string };
  language?: 'es' | 'en';
}

export function TetCard({ data, loading, error, t, language = 'es' }: TetCardProps) {

  return (
    <SurvivalCard
      title={t.title}
      alertLevel="amarillo"
      primaryMetric={{
        label: t.metric,
        value: data ? fmtPct(data.tetActual) : '—',
      }}
      description={language === 'es'
        ? 'Razón contable F09. TTD e impuesto adicional no determinables sin ID, UD y verificación de aplicabilidad.'
        : 'Accounting ratio F09. TTD and additional tax require adjusted tax, adjusted profit and verified applicability.'}
      norma={t.norma}
      loading={loading}
      error={error}
      icon={BarChart3}
      language={language}
    />
  );
}
