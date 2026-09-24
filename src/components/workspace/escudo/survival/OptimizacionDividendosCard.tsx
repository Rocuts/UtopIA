'use client';

/**
 * OptimizacionDividendosCard (Módulo 8 submódulo) — Optimización de Dividendos.
 * Capitalizar vs distribuir (Art. 242). El Art. 36-3 E.T. está derogado
 * (Ley 2277/2022 art. 96): capitalizar tributa como distribuir.
 */

import { TrendingUp } from 'lucide-react';
import { SurvivalCard } from '@/components/workspace/cards/SurvivalCard';
import { cn } from '@/lib/utils';
import type { SupervivenciaModuleResult } from '@/lib/agents/financial/escudo-survival/fiscal-agent';

const REC_LABEL: Record<
  SupervivenciaModuleResult['data']['dividendos']['recomendacion'],
  { es: string; en: string }
> = {
  capitalizar: { es: 'Capitalizar (tributa como distribución)', en: 'Capitalize (taxed as distribution)' },
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
            ? 'Capitalizar o distribuir: misma carga del socio (Art. 242 E.T.; Art. 36-3 derogado por Ley 2277/2022)'
            : 'Capitalize or distribute: same shareholder tax (Art. 242; Art. 36-3 repealed by Ley 2277/2022)'
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
          <span className="text-n-700 flex-1">
            {language === 'es' ? 'Recomendación: ' : 'Recommendation: '}
          </span>
          <span className="font-semibold text-success">{rec?.[language]}</span>
        </div>
      )}
    </SurvivalCard>
  );
}
