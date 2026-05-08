'use client';

/**
 * PillarKpiList — render compacto de los 3 KPIs maestros de un pilar.
 * Usado dentro de cada micro-dashboard. Formatea según `unit`.
 */

import { cn } from '@/lib/utils';
import type { PillarKpi, PillarStatus } from '@/lib/pillars/types';
import { formatBigCop, formatDays, formatMonths, formatPct } from '@/components/charts';

const STATUS_COLOR: Record<PillarStatus, string> = {
  healthy: 'text-success',
  watch: 'text-gold-500',
  warning: 'text-warning',
  critical: 'text-danger',
};

function formatValue(kpi: PillarKpi): string {
  if (kpi.value === null) return '—';
  switch (kpi.unit) {
    case 'cop':
      return formatBigCop(kpi.value);
    case 'pct':
      return formatPct(kpi.value, 1);
    case 'days':
      return formatDays(kpi.value);
    case 'months':
      return formatMonths(kpi.value);
    case 'ratio':
      return kpi.value.toFixed(2);
    case 'score':
      return Math.round(kpi.value).toString();
    case 'count':
      return Math.round(kpi.value).toString();
    default:
      return String(kpi.value);
  }
}

interface Props {
  kpis: PillarKpi[];
  language: 'es' | 'en';
}

export function PillarKpiList({ kpis, language }: Props) {
  return (
    <ul className="flex flex-col gap-2">
      {kpis.map((k) => (
        <li
          key={k.key}
          className="flex items-center justify-between gap-3 py-1.5 border-b border-n-200 last:border-b-0"
        >
          <div className="min-w-0 flex-1">
            <p className="text-xs text-n-700 font-medium">
              {language === 'es' ? k.labelEs : k.labelEn}
            </p>
            {(language === 'es' ? k.descriptionEs : k.descriptionEn) && (
              <p className="text-[10px] text-n-500 leading-relaxed mt-0.5">
                {language === 'es' ? k.descriptionEs : k.descriptionEn}
              </p>
            )}
          </div>
          <span className={cn('font-mono tabular-nums text-base font-semibold shrink-0', STATUS_COLOR[k.status])}>
            {formatValue(k)}
          </span>
        </li>
      ))}
    </ul>
  );
}
