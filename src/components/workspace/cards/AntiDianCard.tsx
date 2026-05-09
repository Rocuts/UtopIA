'use client';

/**
 * AntiDianCard — Anti-DIAN Preventivo.
 * Surfaces cash payment violations (Art. 771-5 §2 E.T.) and estimated
 * additional tax exposure if unaddressed.
 * Alert: rojo if any violations or excess, amarillo if exogena crosses detected.
 */

import { Eye, AlertTriangle } from 'lucide-react';
import { SurvivalCard } from './SurvivalCard';
import { cn } from '@/lib/utils';
import type { AntiDianResult, AlertLevel } from '@/lib/agents/financial/escudo-survival/types';
import { formatCOP } from '@/hooks/useEscudoSurvival';

interface AntiDianCardProps {
  data?: AntiDianResult;
  loading?: boolean;
  error?: string;
  t: {
    title: string;
    metric: string;
    norma: string;
  };
  language?: 'es' | 'en';
}

export function AntiDianCard({ data, loading, error, t, language = 'es' }: AntiDianCardProps) {
  const violations = data?.data.pagosNoDeduciblesIndividuales ?? [];
  const crosses = data?.data.crucesExogenaSospechosos ?? [];
  const mayorImpuesto = data?.data.mayorImpuestoEstimado ?? 0;

  let alertLevel: AlertLevel = 'verde';
  if (violations.length > 0 || (data?.data.excesoNoDeducibleGeneral ?? 0) > 0) {
    alertLevel = 'rojo';
  } else if (crosses.length > 0) {
    alertLevel = 'amarillo';
  }

  return (
    <SurvivalCard
      title={t.title}
      alertLevel={alertLevel}
      primaryMetric={{
        label: t.metric,
        value: data ? formatCOP(mayorImpuesto) : '—',
      }}
      description={
        alertLevel === 'rojo'
          ? (language === 'es'
            ? 'Se detectaron pagos en efectivo no deducibles o exceso sobre el tope general. Corrija antes de la declaración.'
            : 'Non-deductible cash payments or general excess detected. Correct before filing.')
          : alertLevel === 'amarillo'
          ? (language === 'es'
            ? 'Existen cruces de información exógena que pueden generar requerimientos. Revise los soportes.'
            : 'Exogenous information crosses detected. Review supporting documents.')
          : (language === 'es'
            ? 'Sin inconsistencias detectadas en bancarización ni exógena.'
            : 'No inconsistencies detected in banking or exogenous information.')
      }
      norma={t.norma}
      loading={loading}
      error={error}
      icon={Eye}
      language={language}
    >
      {data && violations.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-n-500 uppercase tracking-eyebrow">
            {language === 'es'
              ? `${violations.length} pago(s) no deducible(s)`
              : `${violations.length} non-deductible payment(s)`}
          </p>
          <ul role="list" className="flex flex-col gap-1.5">
            {violations.slice(0, 3).map((v, i) => (
              <li
                key={i}
                className={cn(
                  'flex items-center justify-between gap-3 p-2 rounded-md text-xs',
                  'bg-[rgb(239_68_68_/_0.08)] ring-1 ring-[rgb(239_68_68_/_0.2)]',
                )}
              >
                <div className="flex items-start gap-2 flex-1 min-w-0">
                  <AlertTriangle
                    className="h-3 w-3 text-danger shrink-0 mt-0.5"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                  <span className="text-n-700 dark:text-n-400 truncate">
                    {v.beneficiarioNombre ?? v.beneficiarioNit ?? (language === 'es' ? 'Beneficiario' : 'Payee')}
                  </span>
                </div>
                <span className="shrink-0 font-medium text-danger num">
                  {formatCOP(v.monto)}
                </span>
              </li>
            ))}
            {violations.length > 3 && (
              <li className="text-[11px] text-n-500 pl-2">
                {language === 'es'
                  ? `+${violations.length - 3} más en el dictamen completo`
                  : `+${violations.length - 3} more in the full report`}
              </li>
            )}
          </ul>
        </div>
      )}
    </SurvivalCard>
  );
}
