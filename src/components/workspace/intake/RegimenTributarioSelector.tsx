'use client';

// ---------------------------------------------------------------------------
// Régimen del impuesto de renta en el intake NIIF (I3-2, auditoria-calidad-31).
//
// El gate de emitibilidad no exige V10 (Tasa de Tributación Depurada, par. 6
// Art. 240 E.T.) al Régimen Simple, que sustituye el impuesto de renta
// (Art. 903 E.T.). Sin dato (`null`, opción por defecto) el informe se evalúa
// como régimen ordinario: V10 exigido. El régimen nunca se infiere del balance.
// ---------------------------------------------------------------------------

import { cn } from '@/lib/utils';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { RegimenTributarioIntake } from '@/types/platform';

type Copy = Dictionary['niifIntake'];

export function RegimenTributarioSelector({
  value,
  onChange,
  t,
}: {
  value: RegimenTributarioIntake | null;
  onChange: (next: RegimenTributarioIntake | null) => void;
  t: Copy;
}) {
  const options: Array<{ value: RegimenTributarioIntake | null; label: string }> = [
    { value: null, label: t.regimenNone },
    { value: 'ordinario', label: t.regimenOrdinario },
    { value: 'simple', label: t.regimenSimple },
  ];
  return (
    <div>
      <label
        id="niif-regimen-tributario-label"
        className="flex items-center gap-1.5 text-xs font-medium text-n-600 mb-2"
      >
        {t.regimenTitle}
      </label>
      <div
        role="radiogroup"
        aria-labelledby="niif-regimen-tributario-label"
        aria-describedby="niif-regimen-tributario-hint"
        className="flex flex-wrap gap-2"
      >
        {options.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value ?? 'none'}
              type="button"
              role="radio"
              aria-checked={active}
              data-regimen={opt.value ?? 'none'}
              onClick={() => onChange(opt.value)}
              className={cn(
                'px-3.5 py-1.5 rounded-full text-xs font-medium border transition-colors',
                active
                  ? 'bg-n-900 text-n-0 border-n-900'
                  : 'bg-n-0 text-n-700 border-n-200 hover:border-n-400 hover:text-n-1000',
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      <p id="niif-regimen-tributario-hint" className="mt-1.5 text-2xs text-n-600">
        {t.regimenHint}
      </p>
    </div>
  );
}
