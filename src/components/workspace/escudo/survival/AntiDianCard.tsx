'use client';

/**
 * AntiDianCard (Módulo 8 submódulo) — Auditoría Preventiva Anti-DIAN.
 * Resumen de bancarización Art. 771-5 y norma vinculante.
 */

import { AlertTriangle } from 'lucide-react';
import { SurvivalCard } from '@/components/workspace/cards/SurvivalCard';
import type { SupervivenciaModuleResult } from '@/lib/agents/financial/escudo-survival/fiscal-agent';

interface AntiDianCardProps {
  data?: SupervivenciaModuleResult['data']['antiDian'];
  loading?: boolean;
  error?: string;
  t: { title: string; metric: string; norma: string };
  language?: 'es' | 'en';
}

export function AntiDianCard({ data, loading, error, t, language = 'es' }: AntiDianCardProps) {
  return (
    <SurvivalCard
      title={t.title}
      alertLevel="amarillo"
      primaryMetric={{
        label: t.metric,
        value: language === 'es' ? 'Ver resumen' : 'See summary',
      }}
      description={data?.resumen}
      norma={t.norma}
      loading={loading}
      error={error}
      icon={AlertTriangle}
      language={language}
    />
  );
}
