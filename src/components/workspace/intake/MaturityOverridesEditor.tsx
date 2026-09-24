'use client';

// ---------------------------------------------------------------------------
// Excepciones de vencimiento por cuenta (P4-b, pendiente #4 de la auditoría
// integral 2026-09-24).
//
// La clasificación corriente / no corriente es por grupo PUC (supuesto
// revelado). Aquí el usuario declara, de forma OPCIONAL, las cuentas cuyo
// vencimiento real es distinto (`2105` → no corriente). El intake las escribe
// como directiva en `rawData` al enviar; el preprocesador las aplica de forma
// determinista y el informe las revela con su monto. Sin excepciones las
// cifras son idénticas a la clasificación por grupo.
// ---------------------------------------------------------------------------

import { CalendarClock, Plus, X } from 'lucide-react';
import { useState } from 'react';

import type { Dictionary } from '@/lib/i18n/dictionaries';
import { MAX_VENCIMIENTOS_DECLARADOS, type Vencimiento } from '@/lib/upload/ingest-directives';

import { parseMaturityOverrideCode } from './niifIntakeValidation';

type Copy = Dictionary['niifIntake'];

export function MaturityOverridesEditor({
  value,
  onChange,
  t,
}: {
  value: Readonly<Record<string, Vencimiento>>;
  onChange: (next: Record<string, Vencimiento>) => void;
  t: Copy;
}) {
  const [code, setCode] = useState('');
  const [term, setTerm] = useState<Vencimiento>('no_corriente');
  const [error, setError] = useState<string | null>(null);
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));

  const add = () => {
    const parsed = parseMaturityOverrideCode(code);
    if (!parsed.ok) {
      setError(parsed.reason);
      return;
    }
    if (!(parsed.code in value) && entries.length >= MAX_VENCIMIENTOS_DECLARADOS) {
      setError(`Máximo ${MAX_VENCIMIENTOS_DECLARADOS}.`);
      return;
    }
    onChange({ ...value, [parsed.code]: term });
    setCode('');
    setError(null);
  };

  const remove = (codigo: string) => {
    const next = { ...value };
    delete next[codigo];
    onChange(next);
  };

  return (
    <details className="rounded-lg border border-n-200 bg-n-0 px-4 py-3" open={entries.length > 0}>
      <summary className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-n-1000">
        <CalendarClock className="w-4 h-4 text-gold-500" aria-hidden />
        {t.maturityTitle}
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-n-700">{t.maturityHint}</p>

        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="niif-maturity-code" className="block text-xs font-medium text-n-700 mb-1">
              {t.maturityCodeLabel}
            </label>
            <input
              id="niif-maturity-code"
              type="text"
              inputMode="numeric"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add();
                }
              }}
              placeholder={t.maturityCodePlaceholder}
              aria-invalid={error !== null}
              aria-describedby={error ? 'niif-maturity-error' : undefined}
              className="w-32 px-3 py-2 rounded-lg border border-n-200 text-sm text-n-1000 bg-n-0 placeholder:text-n-400 focus:outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
            />
          </div>
          <div>
            <label htmlFor="niif-maturity-term" className="block text-xs font-medium text-n-700 mb-1">
              {t.maturityTermLabel}
            </label>
            <select
              id="niif-maturity-term"
              value={term}
              onChange={(e) => setTerm(e.target.value as Vencimiento)}
              className="px-3 py-2 rounded-lg border border-n-200 text-sm text-n-1000 bg-n-0 focus:outline-none focus:border-gold-500 focus:ring-1 focus:ring-gold-500"
            >
              <option value="corriente">{t.maturityCurrent}</option>
              <option value="no_corriente">{t.maturityNonCurrent}</option>
            </select>
          </div>
          <button
            type="button"
            onClick={add}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-n-300 text-xs font-medium text-n-800 hover:border-gold-500 hover:text-n-1000 focus:outline-none focus:ring-1 focus:ring-gold-500"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden />
            {t.maturityAdd}
          </button>
        </div>
        {error && (
          <p id="niif-maturity-error" className="text-2xs text-danger">
            {error}
          </p>
        )}

        {entries.length === 0 ? (
          <p className="text-xs text-n-600">{t.maturityEmpty}</p>
        ) : (
          <ul className="space-y-1">
            {entries.map(([codigo, plazo]) => (
              <li
                key={codigo}
                className="flex items-center justify-between gap-2 rounded-md bg-n-50 px-3 py-1.5 text-xs text-n-800"
              >
                <span>
                  <span className="font-mono font-medium text-n-1000">{codigo}</span>
                  {' → '}
                  {plazo === 'corriente' ? t.maturityCurrent : t.maturityNonCurrent}
                </span>
                <button
                  type="button"
                  onClick={() => remove(codigo)}
                  aria-label={`${t.maturityRemove} ${codigo}`}
                  className="text-n-700 hover:text-n-1000 focus:outline-none focus:ring-1 focus:ring-gold-500 rounded"
                >
                  <X className="w-3.5 h-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
