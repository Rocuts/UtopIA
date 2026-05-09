'use client';

/**
 * RetentionShieldCard — Escudo de Retenciones.
 * Shows projected net balance (saldo a favor / en contra) and available actions
 * under Art. 670 E.T.: certif. no retención, autorretenedor, compensación, devolución.
 */

import { Shield, ArrowUpRight } from 'lucide-react';
import { SurvivalCard } from './SurvivalCard';
import { cn } from '@/lib/utils';
import type {
  RetentionShieldResult,
  RetentionAction,
  AlertLevel,
} from '@/lib/agents/financial/escudo-survival/types';
import { formatCOP } from '@/hooks/useEscudoSurvival';

const DIFFICULTY_LABEL: Record<RetentionAction['dificultad'], { es: string; en: string; cls: string }> = {
  baja: { es: 'Fácil', en: 'Easy', cls: 'text-success' },
  media: { es: 'Moderado', en: 'Moderate', cls: 'text-warning' },
  alta: { es: 'Complejo', en: 'Complex', cls: 'text-danger' },
};

const ACTION_LABEL: Record<RetentionAction['tipo'], { es: string; en: string }> = {
  certif_no_retencion: { es: 'Certificado de no retención', en: 'Non-withholding certificate' },
  autorretenedor: { es: 'Solicitar autorretenedor', en: 'Apply for self-withholding' },
  compensacion: { es: 'Compensación', en: 'Compensation' },
  devolucion: { es: 'Devolución DIAN', en: 'DIAN refund' },
};

interface RetentionShieldCardProps {
  data?: RetentionShieldResult;
  loading?: boolean;
  error?: string;
  t: {
    title: string;
    metric: string;
    norma: string;
  };
  language?: 'es' | 'en';
}

export function RetentionShieldCard({ data, loading, error, t, language = 'es' }: RetentionShieldCardProps) {
  const saldo = data?.data.saldoAFavorProyectado ?? 0;

  // Derive alert level from balance
  let alertLevel: AlertLevel = 'verde';
  if (saldo < 0) alertLevel = 'rojo';
  else if (saldo === 0) alertLevel = 'amarillo';

  return (
    <SurvivalCard
      title={t.title}
      alertLevel={alertLevel}
      primaryMetric={{
        label: t.metric,
        value: data ? formatCOP(saldo) : '—',
      }}
      description={
        saldo > 0
          ? (language === 'es'
            ? 'La empresa tiene dinero atrapado en retenciones. Puede recuperarlo mediante las acciones listadas.'
            : 'The company has money trapped in withholdings. It can be recovered through the listed actions.')
          : (language === 'es'
            ? 'Sin saldo a favor proyectado. Retenciones dentro de la carga tributaria esperada.'
            : 'No projected balance in your favor. Withholdings within expected tax burden.')
      }
      norma={t.norma}
      loading={loading}
      error={error}
      icon={Shield}
      language={language}
    >
      {data && data.data.acciones.length > 0 && (
        <ul
          role="list"
          aria-label={language === 'es' ? 'Acciones disponibles' : 'Available actions'}
          className="flex flex-col gap-1.5"
        >
          {data.data.acciones.map((accion, i) => {
            const diff = DIFFICULTY_LABEL[accion.dificultad];
            const label = ACTION_LABEL[accion.tipo];
            return (
              <li
                key={i}
                className={cn(
                  'flex items-start justify-between gap-3 p-2.5 rounded-md text-xs',
                  'bg-[rgb(168_56_56_/_0.07)] ring-1 ring-[rgb(168_56_56_/_0.15)]',
                )}
              >
                <div className="flex items-start gap-2 flex-1 min-w-0">
                  <ArrowUpRight
                    className="h-3 w-3 text-area-escudo shrink-0 mt-0.5"
                    strokeWidth={2.5}
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <span className="block font-medium text-n-800 dark:text-n-200 truncate">
                      {language === 'es' ? label.es : label.en}
                    </span>
                    <span className="block text-[10px] text-n-500 font-[family-name:var(--font-geist-mono,monospace)] mt-0.5">
                      {accion.norma}
                    </span>
                  </div>
                </div>
                <span className={cn('shrink-0 font-medium', diff.cls)}>
                  {language === 'es' ? diff.es : diff.en}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </SurvivalCard>
  );
}
