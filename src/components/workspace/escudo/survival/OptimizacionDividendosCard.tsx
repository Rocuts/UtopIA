'use client';

/**
 * OptimizacionDividendosCard (Módulo 8 submódulo) — Optimización de Dividendos.
 * Capitalizar (Art. 36-3) vs distribuir gravados (Art. 242).
 */

import { TrendingUp } from 'lucide-react';
import { SurvivalCard } from '@/components/workspace/cards/SurvivalCard';
import { cn } from '@/lib/utils';
import type { SupervivenciaModuleResult } from '@/lib/agents/financial/escudo-survival/fiscal-agent';

const REC_LABEL: Record<
  SupervivenciaModuleResult['data']['dividendos']['recomendacion'],
  { es: string; en: string }
> = {
  capitalizar: { es: 'Capitalizar (Art. 36-3 E.T.)', en: 'Capitalize (Art. 36-3 T.S.)' },
  distribuir: { es: 'Distribuir dividendos', en: 'Distribute dividends' },
  hibrido: { es: 'Estrategia híbrida', en: 'Hybrid strategy' },
};

interface OptimizacionDividendosCardProps {
  data?: SupervivenciaModuleResult['data']['dividendos'];
  loading?: boolean;
  error?: string;
  t: { title: string; metric: string; norma: string };
  language?: 'es' | 'en';
}

export function OptimizacionDividendosCard({ data, loading, error, t, language = 'es' }: OptimizacionDividendosCardProps) {
  const rec = data ? REC_LABEL[data.recomendacion] : null;

  return (
    <SurvivalCard
      title={t.title}
      alertLevel="verde"
      primaryMetric={{
        label: t.metric,
        value: rec ? rec[language] : '—',
      }}
      description={
        data
          ? language === 'es'
            ? 'Comparativa capitalización Art. 36-3 E.T. vs distribución gravada Art. 242 E.T.'
            : 'Comparison: capitalize Art. 36-3 T.S. vs taxable distribution Art. 242 T.S.'
          : undefined
      }
      norma={data?.norma ?? t.norma}
      loading={loading}
      error={error}
      icon={TrendingUp}
      language={language}
    >
      {data && (
        <div
          className={cn(
            'flex items-center gap-2 p-2 rounded-md text-xs',
            'bg-[rgb(34_197_94_/_0.07)] ring-1 ring-[rgb(34_197_94_/_0.2)]',
          )}
        >
          <span className="text-n-700 dark:text-n-400 flex-1">
            {language === 'es' ? 'Recomendación: ' : 'Recommendation: '}
          </span>
          <span className="font-semibold text-success">{rec?.[language]}</span>
        </div>
      )}
    </SurvivalCard>
  );
}
