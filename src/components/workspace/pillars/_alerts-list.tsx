'use client';

/**
 * PillarAlertsList — render de las alertas activas de un pilar (cuando
 * `metrics.alerts.length > 0`). Si no hay alertas, no renderiza nada.
 */

import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PillarAlert, PillarSeverity } from '@/lib/pillars/types';

const SEV_STYLES: Record<PillarSeverity, string> = {
  success: 'border-success/30 bg-success/8 text-success',
  warning: 'border-warning/30 bg-warning/8 text-warning',
  danger: 'border-danger/30 bg-danger/8 text-danger',
  neutral: 'border-n-200 bg-n-50 text-n-700',
};

interface Props {
  alerts: PillarAlert[];
  language: 'es' | 'en';
}

export function PillarAlertsList({ alerts, language }: Props) {
  if (alerts.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2">
      {alerts.map((a) => (
        <li
          key={a.code}
          className={cn(
            'flex items-start gap-2.5 px-3 py-2 rounded-md border',
            SEV_STYLES[a.severity],
          )}
        >
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium leading-snug">
              {language === 'es' ? a.titleEs : a.titleEn}
            </p>
            <p className="text-xs leading-relaxed mt-0.5 text-n-700">
              {language === 'es' ? a.messageEs : a.messageEn}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
