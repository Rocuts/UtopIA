'use client';

/**
 * EscudoRetencionesCard (Módulo 8 submódulo) — Escudo de Retenciones.
 * Muestra F03, ratioF10 y recomendación.
 */

import { Shield } from 'lucide-react';
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

function fmtPct(n: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  }).format(n / 100);
}

function retentionAlert(ratio: number): 'rojo' | 'amarillo' | 'verde' {
  if (ratio < 0.5) return 'rojo';
  if (ratio < 0.8) return 'amarillo';
  return 'verde';
}

interface EscudoRetencionesCardProps {
  data?: SupervivenciaModuleResult['data']['escudoRetenciones'];
  loading?: boolean;
  error?: string;
  t: { title: string; metric: string; norma: string };
  language?: 'es' | 'en';
}

export function EscudoRetencionesCard({ data, loading, error, t, language = 'es' }: EscudoRetencionesCardProps) {
  const alert = data ? retentionAlert(data.ratioF10) : 'verde';

  return (
    <SurvivalCard
      title={t.title}
      alertLevel={alert}
      primaryMetric={{
        label: t.metric,
        value: data ? fmtCop(data.f03) : '—',
      }}
      description={data?.recomendacion}
      norma={t.norma}
      loading={loading}
      error={error}
      icon={Shield}
      language={language}
    >
      {data && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-n-500">
            {language === 'es' ? 'Cobertura (F10)' : 'Coverage (F10)'}
          </span>
          <span className="font-medium text-n-800 tabular-nums">
            {fmtPct(data.ratioF10)}
          </span>
        </div>
      )}
    </SurvivalCard>
  );
}
