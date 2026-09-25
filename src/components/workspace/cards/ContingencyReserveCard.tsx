'use client';

/**
 * ContingencyReserveCard — Reserva Fiscal de Contingencia.
 * Shows the recommended fiscal reserve (10% × utilidad neta) and the
 * current legal reserve gap if available. Always informative (alert: verde).
 *
 * tributario-calc-01: la reserva legal es obligatoria para S.A. (Art. 452
 * C.Co.) y Ltda. (Art. 371 C.Co.); en la SAS sólo existe si los estatutos la
 * prevén (Supersociedades 220-069664/2017). La brecha frente al 50 % del
 * capital sólo se presenta como faltante de una reserva OBLIGATORIA cuando el
 * tipo societario lo sustenta; sin tipo societario no se evalúa cumplimiento.
 */

import { PiggyBank } from 'lucide-react';
import { SurvivalCard } from './SurvivalCard';
import { cn } from '@/lib/utils';
import type { ContingencyReserveResult } from '@/lib/agents/financial/escudo-survival/types';
import { formatCOP, formatPct } from '@/hooks/useEscudoSurvival';

interface ContingencyReserveCardProps {
  data?: ContingencyReserveResult;
  loading?: boolean;
  error?: string;
  t: {
    title: string;
    metric: string;
    norma: string;
  };
  language?: 'es' | 'en';
  /** Tipo societario (SAS, S.A., Ltda.). Sin él no se afirma obligatoriedad. */
  entityType?: string | null;
  /** SAS: `true` si los estatutos prevén la reserva legal. */
  bylawsRequireLegalReserve?: boolean | null;
}

type LegalReserveRegime =
  | { kind: 'obligatoria'; article: string }
  | { kind: 'no-obligatoria' }
  | { kind: 'desconocida' };

/** Régimen de la reserva legal según el tipo societario (tributario-calc-01). */
function legalReserveRegime(
  entityType: string | null | undefined,
  bylawsRequireLegalReserve: boolean | null | undefined,
): LegalReserveRegime {
  const kind = (entityType ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  if (kind === 'SAS') {
    return bylawsRequireLegalReserve === true
      ? { kind: 'obligatoria', article: 'estatutos' }
      : { kind: 'no-obligatoria' };
  }
  if (kind === 'SA') return { kind: 'obligatoria', article: 'Art. 452 C.Co.' };
  if (kind === 'LTDA') return { kind: 'obligatoria', article: 'Art. 371 C.Co.' };
  return { kind: 'desconocida' };
}

export function ContingencyReserveCard({
  data,
  loading,
  error,
  t,
  language = 'es',
  entityType,
  bylawsRequireLegalReserve,
}: ContingencyReserveCardProps) {
  const reserva = data?.data.reservaSugerida ?? 0;
  const gap = data?.data.gapReservaLegal;
  const regime = legalReserveRegime(entityType, bylawsRequireLegalReserve);
  const es = language === 'es';

  return (
    <SurvivalCard
      title={t.title}
      alertLevel="verde"
      primaryMetric={{
        label: t.metric,
        value: data ? formatCOP(reserva) : '—',
      }}
      description={
        language === 'es'
          ? `Se recomienda reservar el ${data ? formatPct(data.data.pctUtilidad) : '10%'} de la utilidad neta como colchón fiscal para obligaciones futuras.`
          : `We recommend reserving ${data ? formatPct(data.data.pctUtilidad) : '10%'} of net income as a fiscal cushion for future obligations.`
      }
      norma={t.norma}
      loading={loading}
      error={error}
      icon={PiggyBank}
      language={language}
    >
      {data && (
        <div className="flex flex-col gap-2">
          {/* Utilidad neta row */}
          <div className={cn('flex items-center justify-between text-xs gap-2 py-1.5 px-2.5 rounded-md', 'bg-[rgb(34_197_94_/_0.07)] ring-1 ring-[rgb(34_197_94_/_0.2)]')}>
            <span className="text-n-500">
              {language === 'es' ? 'Utilidad neta base' : 'Net income base'}
            </span>
            <span className="font-medium text-n-800 dark:text-n-700 num">
              {formatCOP(data.data.utilidadNeta)}
            </span>
          </div>

          {/* Suggested account */}
          <div className="text-xs text-n-500 leading-relaxed">
            <span className="font-medium text-n-700 dark:text-n-600">
              {language === 'es' ? 'Cuenta sugerida: ' : 'Suggested account: '}
            </span>
            {data.data.cuentaSugerida}
          </div>

          {/* Legal reserve gap — sólo como faltante obligatorio si el tipo societario lo sustenta */}
          {typeof gap === 'number' && gap > 0 && regime.kind === 'obligatoria' && (
            <div className={cn('flex items-center justify-between text-xs gap-2 py-1.5 px-2.5 rounded-md', 'bg-[rgb(234_179_8_/_0.08)] ring-1 ring-[rgb(234_179_8_/_0.25)]')}>
              <span className="text-n-700">
                {regime.article === 'estatutos'
                  ? es
                    ? 'Brecha reserva legal estatutaria'
                    : 'Bylaws legal reserve gap'
                  : es
                    ? `Brecha reserva legal obligatoria (${regime.article})`
                    : `Mandatory legal reserve gap (${regime.article})`}
              </span>
              <span className="font-medium text-warning num">{formatCOP(gap)}</span>
            </div>
          )}
          {typeof gap === 'number' && gap > 0 && regime.kind === 'desconocida' && (
            <div className="flex items-center justify-between text-xs gap-2 py-1.5 px-2.5 rounded-md ring-1 ring-n-200">
              <span className="text-n-700">
                {es
                  ? 'Diferencia frente al 50 % del capital (referencia)'
                  : 'Difference to 50% of capital (reference)'}
              </span>
              <span className="font-medium text-n-800 num">{formatCOP(gap)}</span>
            </div>
          )}
          {typeof gap === 'number' && regime.kind === 'desconocida' && (
            <p className="text-xs text-n-700 leading-relaxed">
              {es
                ? 'La reserva legal es obligatoria para S.A. y Ltda. (Arts. 452 y 371 C.Co.); en la SAS sólo si los estatutos la prevén. Sin el tipo societario no se evalúa su cumplimiento.'
                : 'The legal reserve is mandatory for S.A. and Ltda. (Arts. 452 and 371 C.Co.); in an SAS only if the bylaws provide for it. Without the entity type, compliance is not assessed.'}
            </p>
          )}
          {typeof gap === 'number' && regime.kind === 'no-obligatoria' && (
            <p className="text-xs text-n-700 leading-relaxed">
              {es
                ? 'En la SAS la reserva legal no es obligatoria salvo que los estatutos la prevean (Supersociedades 220-069664/2017): no hay faltante de reserva obligatoria que reportar.'
                : 'In an SAS the legal reserve is not mandatory unless the bylaws provide for it (Supersociedades 220-069664/2017): there is no mandatory reserve shortfall to report.'}
            </p>
          )}
        </div>
      )}
    </SurvivalCard>
  );
}
