'use client';

/**
 * TetCard (Módulo 8 — submódulo Supervivencia) — Tasa Efectiva de Tributación.
 * Muestra TET actual, brecha con 15% y impuesto adicional si aplica.
 */

import { BarChart3 } from 'lucide-react';
import { SurvivalCard } from '@/components/workspace/cards/SurvivalCard';
import { cn } from '@/lib/utils';
import { formatCopFromCents } from '@/lib/agents/financial/contracts/money';
import type { SupervivenciaModuleResult } from '@/lib/agents/financial/escudo-survival/fiscal-agent';

function fmtPct(n: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  }).format(n / 100);
}

function fmtCop(cents: string): string {
  try {
    return formatCopFromCents(BigInt(cents));
  } catch {
    return cents;
  }
}

function tetAlert(tet: number): 'rojo' | 'amarillo' | 'verde' {
  if (tet < 15) return 'rojo';
  if (tet < 25) return 'amarillo';
  return 'verde';
}

interface TetCardProps {
  data?: SupervivenciaModuleResult['data']['tet'];
  loading?: boolean;
  error?: string;
  t: { title: string; metric: string; norma: string };
  language?: 'es' | 'en';
}

export function TetCard({ data, loading, error, t, language = 'es' }: TetCardProps) {
  const alert = data ? tetAlert(data.tetActual) : 'verde';

  return (
    <SurvivalCard
      title={t.title}
      alertLevel={alert}
      primaryMetric={{
        label: t.metric,
        value: data ? fmtPct(data.tetActual) : '—',
      }}
      description={
        data
          ? alert === 'rojo'
            ? (language === 'es'
              ? `Brecha de ${fmtPct(data.brecha15Pct)}pp bajo el mínimo legal. Impuesto adicional estimado: ${fmtCop(data.impuestoAdicional)}.`
              : `${fmtPct(data.brecha15Pct)}pp below the legal minimum. Estimated additional tax: ${fmtCop(data.impuestoAdicional)}.`)
            : alert === 'amarillo'
            ? (language === 'es' ? 'TET en zona de atención. Optimización disponible.' : 'TET in attention zone. Optimization available.')
            : (language === 'es' ? 'TET dentro del rango óptimo.' : 'TET within optimal range.')
          : undefined
      }
      norma={t.norma}
      loading={loading}
      error={error}
      icon={BarChart3}
      language={language}
    >
      {data && data.brecha15Pct > 0 && (
        <div className={cn('flex items-center justify-between text-xs p-2 rounded-md', 'bg-[rgb(239_68_68_/_0.07)] ring-1 ring-[rgb(239_68_68_/_0.15)]')}>
          <span className="text-n-700 dark:text-n-400">
            {language === 'es' ? 'Impuesto adicional estimado' : 'Est. additional tax'}
          </span>
          <span className="font-semibold text-danger tabular-nums">{fmtCop(data.impuestoAdicional)}</span>
        </div>
      )}
    </SurvivalCard>
  );
}
