'use client';

// ---------------------------------------------------------------------------
// Confirmación EXPLÍCITA de la unidad de las cifras (P4-a, pendiente #4 de la
// auditoría integral 2026-09-24).
//
// Un balance que declara "en miles de pesos" / "en millones" se bloquea
// (recalculo-final-03) hasta que el usuario elige la unidad. La elección
// reenvía el archivo a /api/upload con `unitMultiplier`: el servidor reexpresa
// en centavos exactos, devuelve `rawData` con la directiva de la unidad y el
// informe deja la nota "cifras reexpresadas … por confirmación del usuario".
// Nunca se elige una unidad por defecto.
// ---------------------------------------------------------------------------

import { AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';
import { useState } from 'react';

import type { Dictionary } from '@/lib/i18n/dictionaries';
import { UNIDADES_MONETARIAS, type UnidadMonetaria, type UploadUnitInfo } from '@/lib/upload/ingest-directives';
import { cn } from '@/lib/utils';

type Copy = Dictionary['niifIntake'];

function unitName(t: Copy, unidad: UnidadMonetaria): string {
  if (unidad === 'miles') return t.unitNameMiles;
  if (unidad === 'millones') return t.unitNameMillones;
  return t.unitNamePesos;
}

function unitOptionLabel(t: Copy, unidad: UnidadMonetaria): string {
  if (unidad === 'miles') return t.unitMiles;
  if (unidad === 'millones') return t.unitMillones;
  return t.unitPesos;
}

export function UnitConfirmationPanel({
  unit,
  status,
  error,
  onConfirm,
  t,
}: {
  unit: UploadUnitInfo;
  status: 'idle' | 'confirming' | 'error';
  error: string | null;
  onConfirm: (unidad: UnidadMonetaria) => void;
  t: Copy;
}) {
  const [changing, setChanging] = useState(false);
  const pending = unit.requiresConfirmation;
  const confirming = status === 'confirming';
  const showOptions = pending || changing;

  return (
    <div
      role={pending ? 'alert' : undefined}
      aria-live="polite"
      className={cn(
        'rounded-lg border px-4 py-3 space-y-2',
        pending ? 'border-warning bg-warning/10' : 'border-n-200 bg-n-50',
      )}
    >
      <div className="flex items-center gap-2">
        {pending ? (
          <AlertTriangle className="w-4 h-4 text-warning shrink-0" aria-hidden />
        ) : (
          <CheckCircle className="w-4 h-4 text-success shrink-0" aria-hidden />
        )}
        <h4 className="text-sm font-semibold text-n-1000">{t.unitTitle}</h4>
      </div>

      {unit.declared && (
        <p className="text-xs text-n-800">
          {t.unitDeclared.replace('{unit}', unitName(t, unit.declared))}{' '}
          {unit.declaredText && <q className="font-medium text-n-1000">{unit.declaredText}</q>}
        </p>
      )}

      {pending ? (
        <p className="text-xs text-n-700">{t.unitExplain}</p>
      ) : unit.confirmed ? (
        <p className="text-xs text-n-800">
          {unit.confirmed === 'pesos'
            ? t.unitConfirmedPesos
            : t.unitConfirmed.replace('{unit}', unitName(t, unit.confirmed))}
        </p>
      ) : null}

      {showOptions && (
        <div className="flex flex-wrap gap-2 pt-1" role="group" aria-label={t.unitTitle}>
          {UNIDADES_MONETARIAS.map((u) => (
            <button
              key={u}
              type="button"
              disabled={confirming}
              aria-pressed={unit.confirmed === u}
              onClick={() => {
                setChanging(false);
                onConfirm(u);
              }}
              className={cn(
                'px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors',
                'focus:outline-none focus:ring-1 focus:ring-gold-500 disabled:opacity-60 disabled:text-n-600',
                unit.confirmed === u
                  ? 'border-gold-500 bg-gold-500/10 text-n-1000'
                  : 'border-n-300 bg-n-0 text-n-800 hover:border-gold-500 hover:text-n-1000',
              )}
            >
              {unitOptionLabel(t, u)}
            </button>
          ))}
        </div>
      )}

      {!pending && !changing && !confirming && (
        <button
          type="button"
          onClick={() => setChanging(true)}
          className="text-xs font-medium text-n-700 underline underline-offset-2 hover:text-n-1000"
        >
          {t.unitChange}
        </button>
      )}

      {confirming && (
        <p className="flex items-center gap-1.5 text-xs text-n-700">
          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
          {t.unitConfirming}
        </p>
      )}
      {status === 'error' && (
        <p className="text-xs text-danger">
          {t.unitError}
          {error ? ` (${error})` : ''}
        </p>
      )}
    </div>
  );
}
