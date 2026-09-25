'use client';

/**
 * MacroIndicatorsView — indicadores macro con procedencia por campo.
 *
 * Auditoría valoracion-02: la página de Macroeconomía mostraba constantes
 * (TRM $4.120, IPC 5,2 %, tasa 9,25 %, PIB +1,8 %) y proyecciones atribuidas a
 * "Banco de la República, DANE — Actualizado 9 jun 2026", más una
 * recomendación "~84bps" sin fuente. Esta vista sólo pinta lo que devuelve
 * /api/macro/current: valor, fuente y vigencia de CADA campo, o N/D con motivo.
 * No publica proyecciones ni recomendaciones.
 */

import type { MacroFactors, MacroIndicator, MacroSource } from '@/lib/pillars/types';
import type { Dictionary } from '@/lib/i18n/dictionaries';

export type MacroViewState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: MacroFactors };

interface Props {
  state: MacroViewState;
  language: 'es' | 'en';
  t: Dictionary['elite']['dataStatus'];
}

function formatDate(iso: string | null, language: 'es' | 'en'): string | null {
  if (!iso) return null;
  const d = new Date(iso.length === 7 ? `${iso}-01T00:00:00` : iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(language === 'es' ? 'es-CO' : 'en-US', {
    day: iso.length === 7 ? undefined : 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

function formatValue(field: 'trm' | 'ipc' | 'tasa', v: number, language: 'es' | 'en'): string {
  const locale = language === 'es' ? 'es-CO' : 'en-US';
  if (field === 'trm') {
    return `$${v.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `${(v * 100).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

export function MacroIndicatorsView({ state, language, t }: Props) {
  const m = t.macro;
  const sourceLabel = (s: MacroSource | null): string | null =>
    s === 'superfinanciera'
      ? m.sourceSuperfinanciera
      : s === 'dane'
        ? m.sourceDane
        : s === 'banrep'
          ? m.sourceBanrep
          : null;

  if (state.status === 'loading') {
    return (
      <p role="status" className="text-sm text-n-700">
        {m.loading}
      </p>
    );
  }
  if (state.status === 'error') {
    return (
      <p role="status" className="rounded-xl border border-n-300 bg-n-100 px-4 py-3 text-sm text-n-800">
        {m.error} {t.notAvailable}
      </p>
    );
  }

  const cards: Array<{ key: 'trm' | 'ipc' | 'tasa'; label: string; ind: MacroIndicator }> = [
    { key: 'trm', label: m.trm, ind: state.data.trm },
    { key: 'ipc', label: m.ipc, ind: state.data.ipc },
    { key: 'tasa', label: m.tasa, ind: state.data.tasaBanRep },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {cards.map(({ key, label, ind }) => {
        const src = sourceLabel(ind.source);
        const asOf = formatDate(ind.asOf, language);
        const fetched = formatDate(ind.fetchedAt, language);
        return (
          <div
            key={key}
            className="rounded-xl border border-n-200 bg-n-50 px-4 py-4"
            data-testid={`macro-${key}`}
          >
            <div className="text-xs text-n-700 mb-1">{label}</div>
            <div className="text-xl font-semibold tabular-nums text-n-1000">
              {ind.value === null ? t.notAvailable : formatValue(key, ind.value, language)}
            </div>
            <dl className="mt-2 space-y-0.5 text-[11px] text-n-700">
              {src && (
                <div>
                  <dt className="inline">{m.source}: </dt>
                  <dd className="inline">{src}</dd>
                </div>
              )}
              {asOf && (
                <div>
                  <dt className="inline">{m.asOf}: </dt>
                  <dd className="inline">{asOf}</dd>
                </div>
              )}
              {fetched && (
                <div>
                  <dt className="inline">{m.fetchedAt}: </dt>
                  <dd className="inline">{fetched}</dd>
                </div>
              )}
            </dl>
            {ind.stale && <p className="mt-2 text-[11px] font-medium text-n-800">{m.stale}</p>}
            {ind.value === null && ind.reason && (
              <p className="mt-2 text-[11px] leading-snug text-n-700">
                {t.reason}: {ind.reason}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default MacroIndicatorsView;
